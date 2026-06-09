/*
 * Marina Stee — Bulk renewal sweep.
 *
 * Operator picks "draft renewal contracts for everyone whose contract
 * expires in N days." Preview returns the candidate list; execute writes
 * one new `status: "draft"` contract per candidate carrying the same
 * boater + vessel + slip + cadence into the next year. Signing remains
 * per-contract (operator dispatches via the existing onboarding flow).
 *
 * Why this lives here (not in convex/contracts.ts):
 *   - It needs the "expiring within N days" classifier from
 *     lib/contracts.ts, but that module is client-only. The classifier
 *     itself is pure (date strings in, status out), so we re-implement
 *     the date math inline here. Keep this in sync with
 *     lib/contracts.ts → classifyContractStatus.
 *
 * Audit log strategy: one per-batch row (`bulk_renewals.execute`) +
 * one per-contract row at create time. Per-contract rows use
 * action_type `contract.create_via_bulk` so the per-boater timeline
 * can surface the renewal under the right boater without conflating
 * with hand-drafted contracts.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { logAudit, requireTenant } from "./_helpers";

export const previewSweep = query({
  args: { daysOut: v.number() },
  handler: async (ctx, { daysOut }) => {
    const tenantId = await requireTenant(ctx);
    const active = await ctx.db
      .query("contracts")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "active"),
      )
      .collect();
    const todayIso = localIsoDateNow();
    const cutoffIso = isoDaysFromNow(daysOut);
    const candidates = active.filter((c) =>
      isExpiringWithinIso(c.effective_end, todayIso, cutoffIso),
    );
    // Skip contracts that already have a draft successor (avoids
    // double-drafting on a re-run). Cheap O(N×M) scan — bulk runs are
    // operator-initiated and bounded by tenant size.
    const drafts = await ctx.db
      .query("contracts")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "draft"),
      )
      .collect();
    const draftedSlipIds = new Set(
      drafts.map((d) => d.slip_id).filter((s): s is string => !!s),
    );
    const filtered = candidates.filter(
      (c) => !c.slip_id || !draftedSlipIds.has(c.slip_id),
    );
    return {
      candidates: filtered.map((c) => ({
        contract_id: c._id,
        boater_id: c.boater_id,
        slip_id: c.slip_id,
        annual_rate: c.annual_rate,
        effective_end: c.effective_end,
        billing_cadence: c.billing_cadence,
      })),
    };
  },
});

export const executeSweep = mutation({
  args: {
    daysOut: v.number(),
    rateAdjustmentPct: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { daysOut, rateAdjustmentPct, dryRun, agent_prompt }) => {
    const tenantId = await requireTenant(ctx);
    const active = await ctx.db
      .query("contracts")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "active"),
      )
      .collect();
    const todayIso = localIsoDateNow();
    const cutoffIso = isoDaysFromNow(daysOut);
    const candidates = active.filter((c) =>
      isExpiringWithinIso(c.effective_end, todayIso, cutoffIso),
    );

    // Skip when a draft successor already exists for the slip.
    const drafts = await ctx.db
      .query("contracts")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "draft"),
      )
      .collect();
    const draftedSlipIds = new Set(
      drafts.map((d) => d.slip_id).filter((s): s is string => !!s),
    );
    const eligible = candidates.filter(
      (c) => !c.slip_id || !draftedSlipIds.has(c.slip_id),
    );

    if (dryRun) {
      return { count: eligible.length, contract_ids: [] };
    }

    const pct = rateAdjustmentPct ?? 0;
    const contractIds: string[] = [];

    const all = await ctx.db
      .query("contracts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    let seq = all.length;

    for (const c of eligible) {
      seq += 1;
      const number = `K-${String(3000 + seq).padStart(4, "0")}`;
      const newStart = addDays(c.effective_end, 1);
      const newEnd = addYears(newStart, 1);
      const newRate = c.annual_rate
        ? Math.round(c.annual_rate * (1 + pct / 100))
        : undefined;
      const id = await ctx.db.insert("contracts", {
        tenantId,
        number,
        boater_id: c.boater_id,
        template_id: c.template_id,
        template_version: c.template_version,
        vessel_id: c.vessel_id,
        slip_id: c.slip_id,
        status: "draft",
        effective_start: newStart,
        effective_end: newEnd,
        annual_rate: newRate,
        billing_cadence: c.billing_cadence,
      });
      contractIds.push(id);

      await logAudit(ctx, {
        action_type: "contract.create_via_bulk",
        target_entity: "contracts",
        target_id: id,
        payload_delta: {
          predecessor_id: c._id,
          boater_id: c.boater_id,
          slip_id: c.slip_id,
          new_rate: newRate,
        },
        via_agent: !!agent_prompt,
        agent_prompt,
      });
    }

    await logAudit(ctx, {
      action_type: "bulk_renewals.execute",
      target_entity: "bulk_run",
      payload_delta: {
        days_out: daysOut,
        rate_adjustment_pct: pct,
        count: contractIds.length,
        via_bulk: true,
      },
      via_agent: !!agent_prompt,
      agent_prompt,
    });

    return { count: contractIds.length, contract_ids: contractIds };
  },
});

// ────────────────────────────────────────────────────────────
// Date math — ported from lib/contracts.ts since that module is
// client-only. The classifier itself is pure (ISO strings only),
// so duplicating it here is safe. Keep in sync with the canonical
// implementation.
// ────────────────────────────────────────────────────────────

function localIsoDateNow(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isExpiringWithinIso(
  effectiveEnd: string | undefined,
  todayIso: string,
  cutoffIso: string,
): boolean {
  if (!effectiveEnd) return false;
  return effectiveEnd > todayIso && effectiveEnd <= cutoffIso;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function addYears(iso: string, years: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}
