/*
 * Marina Stee — Bulk billing run.
 *
 * Operator selects a billing period + a billing rule. We compute the
 * candidate set of charges, render a preview, and on confirm fan out
 * one ledger entry + one comm per candidate inside a single tenant-
 * scoped mutation.
 *
 * Audit log strategy:
 *   - One per-batch row written here with action_type =
 *     `bulk_billing.execute`, via_bulk: true, count: N. This is what
 *     /settings/audit-log surfaces as a single "Bulk billing run" line.
 *   - PLUS one per-entity row per invoice (action_type = `ledger.create_via_bulk`).
 *     Drill-into reports + per-boater audit timelines still get a row
 *     each. Matches the rest of the audit-log architecture in
 *     convex/_helpers.ts → logAudit.
 *
 * Mock parity:
 *   - lib/agent-actions.ts → `bulk_charge` branch runs the same fan-out
 *     against the in-memory client-store. The wizard surface calls the
 *     agent action so both paths share one entrypoint.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { logAudit, requireTenant } from "./_helpers";

// ────────────────────────────────────────────────────────────
// Rule / period shapes
// ────────────────────────────────────────────────────────────
//
// The operator-facing rule is intentionally narrow in v1 — every option
// here is a real surface in the UI's Rule step. Additional rules land
// here as new literals (no schema change required).

const billingRuleV = v.union(
  v.literal("annual_due_this_month"),
  v.literal("monthly_installment"),
  v.literal("seasonal_due_this_month"),
);

const billingPeriodV = v.object({
  // YYYY-MM — month the run covers. We don't carry the full date pair
  // because rules currently bucket on month-of-year.
  ym: v.string(),
});

export const previewRun = query({
  args: { rule: billingRuleV, period: billingPeriodV },
  handler: async (ctx, { rule, period }) => {
    const tenantId = await requireTenant(ctx);
    const contracts = await ctx.db
      .query("contracts")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "active"),
      )
      .collect();
    const candidates: Array<{
      contract_id: string;
      boater_id: string;
      slip_id?: string;
      base_amount: number;
      cadence: string;
    }> = [];
    for (const c of contracts) {
      const inScope = matchesRule(c, rule, period);
      if (!inScope) continue;
      const baseAmount =
        rule === "monthly_installment"
          ? Math.round((c.annual_rate ?? 0) / 12)
          : (c.annual_rate ?? 0);
      if (baseAmount <= 0) continue;
      candidates.push({
        contract_id: c._id,
        boater_id: c.boater_id,
        slip_id: c.slip_id,
        base_amount: baseAmount,
        cadence: c.billing_cadence,
      });
    }
    return {
      candidates,
      total: candidates.reduce((s, r) => s + r.base_amount, 0),
    };
  },
});

export const executeRun = mutation({
  args: {
    rule: billingRuleV,
    period: billingPeriodV,
    dryRun: v.optional(v.boolean()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { rule, period, dryRun, agent_prompt }) => {
    const tenantId = await requireTenant(ctx);
    const contracts = await ctx.db
      .query("contracts")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "active"),
      )
      .collect();
    const eligible = contracts.filter((c) => matchesRule(c, rule, period));
    const date = `${period.ym}-01`;

    if (dryRun) {
      const previewTotal = eligible.reduce((s, c) => {
        const base =
          rule === "monthly_installment"
            ? Math.round((c.annual_rate ?? 0) / 12)
            : (c.annual_rate ?? 0);
        return s + Math.max(0, base);
      }, 0);
      return { count: eligible.length, total: previewTotal, invoice_ids: [] };
    }

    const invoiceIds: string[] = [];
    let runningTotal = 0;
    const existing = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    let seq = existing.length;

    for (const c of eligible) {
      const baseAmount =
        rule === "monthly_installment"
          ? Math.round((c.annual_rate ?? 0) / 12)
          : (c.annual_rate ?? 0);
      if (baseAmount <= 0) continue;
      seq += 1;
      const number = `INV-${String(2000 + seq).padStart(4, "0")}`;
      const invoiceId = await ctx.db.insert("ledgerEntries", {
        tenantId,
        boater_id: c.boater_id,
        type: "invoice",
        number,
        date,
        amount: baseAmount,
        open_balance: baseAmount,
        method: undefined,
        status: "open",
        line_items: [
          {
            description: `Bulk billing · ${labelForRule(rule)} · ${period.ym}`,
            amount: baseAmount,
          },
        ],
        linked_contract_id: c._id,
      });
      invoiceIds.push(invoiceId);
      runningTotal += baseAmount;

      // Per-entity audit — the boater's audit timeline still shows
      // one entry per charge, with via_agent provenance carried through.
      await logAudit(ctx, {
        action_type: "ledger.create_via_bulk",
        target_entity: "ledgerEntries",
        target_id: invoiceId,
        payload_delta: {
          rule,
          period: period.ym,
          amount: baseAmount,
          boater_id: c.boater_id,
          contract_id: c._id,
        },
        via_agent: !!agent_prompt,
        agent_prompt,
      });

      // Per-entity comm — "invoice ready" notification. The W2
      // notification-dispatch layer eventually replaces this with a
      // real provider call; for now we write a delivered row.
      const boater = await ctx.db.get(c.boater_id);
      if (boater && boater.tenantId === tenantId) {
        const channel = boater.communication_prefs.preferred_channel;
        const recipient =
          channel === "email"
            ? boater.primary_contact.email ?? "—"
            : boater.primary_contact.phone ?? "—";
        await ctx.db.insert("communications", {
          tenantId,
          boater_id: boater._id,
          type: channel,
          direction: "outbound",
          subject: `Invoice ready — ${labelForRule(rule)}`,
          body_preview: `Your ${labelForRule(rule)} invoice for ${period.ym} is ready (${number}).`,
          body_full: `Hi ${boater.first_name},\n\nYour ${labelForRule(rule)} invoice for ${period.ym} is ready.\n\nInvoice #${number}\nAmount: $${baseAmount}\n\nReply if you have any questions.\n— Marina Stee`,
          sender_label: "Marina Stee",
          sender_is_system: true,
          recipient,
          sent_at: new Date().toISOString(),
          status: "delivered",
          related_entity: { type: "invoice", id: invoiceId },
        });
      }
    }

    // Single batch audit row — what shows up on the /settings/audit-log
    // surface as "Bulk billing run: N charges, $X total".
    await logAudit(ctx, {
      action_type: "bulk_billing.execute",
      target_entity: "bulk_run",
      payload_delta: {
        rule,
        period: period.ym,
        count: invoiceIds.length,
        total: runningTotal,
        via_bulk: true,
      },
      via_agent: !!agent_prompt,
      agent_prompt,
    });

    return { count: invoiceIds.length, total: runningTotal, invoice_ids: invoiceIds };
  },
});

// ────────────────────────────────────────────────────────────
// Rule matching
// ────────────────────────────────────────────────────────────

function matchesRule(
  c: {
    billing_cadence: string;
    effective_start: string;
    effective_end: string;
    annual_rate?: number;
  },
  rule: "annual_due_this_month" | "monthly_installment" | "seasonal_due_this_month",
  period: { ym: string },
): boolean {
  if (rule === "annual_due_this_month") {
    // Annual contracts whose anniversary (effective_start month) falls
    // in the run period. Bills full annual_rate.
    if (c.billing_cadence !== "annual") return false;
    return c.effective_start.slice(0, 7) === period.ym;
  }
  if (rule === "monthly_installment") {
    // Monthly-cadence contracts get billed every period regardless of
    // anniversary. Bills annual_rate / 12.
    return c.billing_cadence === "monthly";
  }
  if (rule === "seasonal_due_this_month") {
    if (c.billing_cadence !== "seasonal") return false;
    return c.effective_start.slice(0, 7) === period.ym;
  }
  return false;
}

function labelForRule(rule: string): string {
  if (rule === "annual_due_this_month") return "Annual slip fee";
  if (rule === "monthly_installment") return "Monthly slip installment";
  if (rule === "seasonal_due_this_month") return "Seasonal slip fee";
  return "Bulk billing";
}
