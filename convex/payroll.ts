/*
 * Marina Stee — convex/payroll.ts
 *
 * Payroll period lifecycle: open → closed → paid. The "paid" stamp
 * lands when the operator confirms an export to the actual payroll
 * provider (Gusto / Rippling deferred). Per-staff paystub preview
 * runs server-side from time entries inside the window so the
 * Close-Period modal stays in sync with the live data.
 *
 * Sibling of convex/timeEntries.ts — they share the schema tables
 * (timeEntries + payrollPeriods) but each module owns its surface.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

// ─────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────

export const listPeriods = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("payrollPeriods")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const currentPeriod = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("payrollPeriods")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "open"),
      )
      .first();
  },
});

/**
 * Preview the paystubs for a period. Pure read — never writes. Used
 * by the Close-Period modal so the operator sees the breakdown
 * BEFORE confirming the close.
 */
export const paystubPreview = query({
  args: { period_id: v.id("payrollPeriods") },
  handler: async (ctx, { period_id }) => {
    const tenantId = await requireTenant(ctx);
    const period = await ctx.db.get(period_id);
    assertOwnedByTenant(period, tenantId);
    return await computePaystubPreview(ctx, tenantId, period);
  },
});

/**
 * Gross pay calc for the agent's `payroll_summary` answer — pulls
 * the open period and returns the running totals without committing
 * anything. Distinct from paystubPreview because the agent path
 * doesn't have a known period_id at intent time.
 */
export const grossPayCalc = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    const period = await ctx.db
      .query("payrollPeriods")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "open"),
      )
      .first();
    if (!period) return null;
    const preview = await computePaystubPreview(ctx, tenantId, period);
    return {
      period_id: period._id,
      start_date: period.start_date,
      end_date: period.end_date,
      total_gross: preview.totalGross,
      total_hours: preview.totalHours,
      staff_count: preview.rows.length,
    };
  },
});

// ─────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────

export const openPeriod = mutation({
  args: {
    start_date: v.string(),
    end_date: v.string(),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    // Reject a second open period — only one cycle runs at a time.
    const existing = await ctx.db
      .query("payrollPeriods")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "open"),
      )
      .first();
    if (existing) {
      throw new Error("A payroll period is already open");
    }
    const now = new Date().toISOString();
    const id = await ctx.db.insert("payrollPeriods", {
      tenantId,
      start_date: args.start_date,
      end_date: args.end_date,
      status: "open",
      created_at: now,
    });
    await logAudit(ctx, {
      action_type: "payroll_period.open",
      target_entity: "payrollPeriods",
      target_id: id,
      payload_delta: { start_date: args.start_date, end_date: args.end_date },
    });
    return id;
  },
});

export const closePeriod = mutation({
  args: {
    period_id: v.id("payrollPeriods"),
    closer_staff_id: v.id("staffMembers"),
    provenance: v.optional(v.object({ agent_prompt: v.optional(v.string()) })),
  },
  handler: async (ctx, { period_id, closer_staff_id, provenance }) => {
    const tenantId = await requireTenant(ctx);
    const period = await ctx.db.get(period_id);
    assertOwnedByTenant(period, tenantId);
    if (period.status !== "open") {
      throw new Error("Period is not open");
    }
    const preview = await computePaystubPreview(ctx, tenantId, period);
    const now = new Date().toISOString();
    await ctx.db.patch(period_id, {
      status: "closed",
      closed_by: closer_staff_id,
      closed_at: now,
      total_gross: preview.totalGross,
      total_hours: preview.totalHours,
    });
    // Stamp every entry inside the window with the period id so the
    // time-clock view can lock them in the UI.
    const entries = await ctx.db
      .query("timeEntries")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    for (const e of entries) {
      if (!e.clock_out_at) continue;
      const d = e.clock_out_at.slice(0, 10);
      if (d < period.start_date || d > period.end_date) continue;
      if (e.payroll_period_id) continue;
      await ctx.db.patch(e._id, { payroll_period_id: period_id });
    }
    await logAudit(ctx, {
      action_type: "payroll_period.close",
      target_entity: "payrollPeriods",
      target_id: period_id,
      payload_delta: {
        period_start: period.start_date,
        period_end: period.end_date,
        total_gross: preview.totalGross,
        total_hours: preview.totalHours,
        closed_by: closer_staff_id,
      },
      via_agent: !!provenance,
      agent_prompt: provenance?.agent_prompt,
    });
    return { period_id, total_gross: preview.totalGross, total_hours: preview.totalHours };
  },
});

export const markPaid = mutation({
  args: {
    period_id: v.id("payrollPeriods"),
    payroll_run_ref: v.optional(v.string()),
  },
  handler: async (ctx, { period_id, payroll_run_ref }) => {
    const tenantId = await requireTenant(ctx);
    const period = await ctx.db.get(period_id);
    assertOwnedByTenant(period, tenantId);
    if (period.status !== "closed") {
      throw new Error("Period must be closed before it can be marked paid");
    }
    const now = new Date().toISOString();
    await ctx.db.patch(period_id, {
      status: "paid",
      paid_at: now,
      payroll_run_ref,
    });
    await logAudit(ctx, {
      action_type: "payroll_period.mark_paid",
      target_entity: "payrollPeriods",
      target_id: period_id,
      payload_delta: { payroll_run_ref, paid_at: now },
    });
    return period_id;
  },
});

// ─────────────────────────────────────────────────────────────
// Shared paystub preview
// ─────────────────────────────────────────────────────────────

interface PaystubPreviewRow {
  staff_member_id: Id<"staffMembers">;
  period_id: Id<"payrollPeriods">;
  regular_hours: number;
  overtime_hours: number;
  regular_pay: number;
  overtime_pay: number;
  gross: number;
}

async function computePaystubPreview(
  ctx: QueryCtx,
  tenantId: Id<"marinas">,
  period: Doc<"payrollPeriods">,
): Promise<{
  rows: PaystubPreviewRow[];
  totalHours: number;
  totalGross: number;
}> {
  const staff = await ctx.db
    .query("staffMembers")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  const entries = await ctx.db
    .query("timeEntries")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  const rows: PaystubPreviewRow[] = [];
  let totalHours = 0;
  let totalGross = 0;
  for (const s of staff) {
    if (s.status !== "active") continue;
    if (s.salary_annual && s.salary_annual > 0) {
      const gross = +(s.salary_annual / 26).toFixed(2);
      rows.push({
        staff_member_id: s._id,
        period_id: period._id,
        regular_hours: 0,
        overtime_hours: 0,
        regular_pay: gross,
        overtime_pay: 0,
        gross,
      });
      totalGross += gross;
      continue;
    }
    if (!s.hourly_rate || s.hourly_rate <= 0) continue;
    const inWindow = entries.filter((e) => {
      if (e.staff_id !== s._id) return false;
      if (!e.clock_out_at) return false;
      const d = e.clock_out_at.slice(0, 10);
      return d >= period.start_date && d <= period.end_date;
    });
    if (inWindow.length === 0) continue;
    // Per-week OT bucketing (FLSA default: 40 hrs/week).
    const hoursByWeek = new Map<string, number>();
    for (const e of inWindow) {
      const wk = isoWeekKey(e.clock_out_at!);
      hoursByWeek.set(wk, (hoursByWeek.get(wk) ?? 0) + (e.calculated_hours ?? 0));
    }
    let reg = 0;
    let ot = 0;
    for (const h of hoursByWeek.values()) {
      reg += Math.min(40, h);
      ot += Math.max(0, h - 40);
    }
    const rate = s.hourly_rate;
    const otRate = 1.5 * rate;
    const regularPay = +(reg * rate).toFixed(2);
    const overtimePay = +(ot * otRate).toFixed(2);
    const gross = +(regularPay + overtimePay).toFixed(2);
    rows.push({
      staff_member_id: s._id,
      period_id: period._id,
      regular_hours: +reg.toFixed(2),
      overtime_hours: +ot.toFixed(2),
      regular_pay: regularPay,
      overtime_pay: overtimePay,
      gross,
    });
    totalHours += reg + ot;
    totalGross += gross;
  }
  return {
    rows,
    totalHours: +totalHours.toFixed(2),
    totalGross: +totalGross.toFixed(2),
  };
}

function isoWeekKey(iso: string): string {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}
