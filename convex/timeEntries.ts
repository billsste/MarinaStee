/*
 * Marina Stee — convex/timeEntries.ts
 *
 * Time clock + audit-adjust mutations. Sibling of convex/staff.ts —
 * intentionally NOT folded into staff.ts so the staffMembers schema
 * owner can move independently of the time-clock surface.
 *
 * Tax + deduction details are deferred to the actual payroll provider
 * integration (Gusto / Rippling). This file captures the gross-hours
 * layer only — clock_in/out, lunch pause/resume, audit-tracked adjust.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

const statusV = v.union(
  v.literal("in_progress"),
  v.literal("paused"),
  v.literal("completed"),
  v.literal("adjusted"),
);

const sourceV = v.union(
  v.literal("mobile"),
  v.literal("web"),
  v.literal("manual"),
);

const provenanceV = v.object({
  agent_prompt: v.optional(v.string()),
});

// ─────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("timeEntries")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const listForStaff = query({
  args: { staff_id: v.id("staffMembers") },
  handler: async (ctx, { staff_id }) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("timeEntries")
      .withIndex("by_tenant_staff", (q) =>
        q.eq("tenantId", tenantId).eq("staff_id", staff_id),
      )
      .collect();
  },
});

/**
 * The open (in_progress or paused) time entry for a given staff
 * member, if any. The mobile clock-in UI uses this to toggle the
 * primary button between "Clock in" and "Clock out".
 */
export const activeForStaff = query({
  args: { staff_id: v.id("staffMembers") },
  handler: async (ctx, { staff_id }) => {
    const tenantId = await requireTenant(ctx);
    const rows = await ctx.db
      .query("timeEntries")
      .withIndex("by_tenant_staff", (q) =>
        q.eq("tenantId", tenantId).eq("staff_id", staff_id),
      )
      .collect();
    return rows.find((r) => !r.clock_out_at) ?? null;
  },
});

// ─────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────

/**
 * Clock-in. Verifies the staff member is active + not already on
 * the clock, then writes a new in_progress entry. PIN verification
 * happens on the client (the staff's `mobile_clock_pin` is part of
 * the staff record); this mutation just trusts the resolved id.
 */
export const clockIn = mutation({
  args: {
    staff_id: v.id("staffMembers"),
    source: v.optional(sourceV),
    position: v.optional(v.string()),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const staff = await ctx.db.get(args.staff_id);
    assertOwnedByTenant(staff, tenantId);
    if (staff.status !== "active") {
      throw new Error("Staff member is not active");
    }
    // Already-open check.
    const open = await ctx.db
      .query("timeEntries")
      .withIndex("by_tenant_staff", (q) =>
        q.eq("tenantId", tenantId).eq("staff_id", args.staff_id),
      )
      .collect();
    if (open.some((t) => !t.clock_out_at)) {
      throw new Error("Already clocked in");
    }
    // Roll into the current open period if there is one.
    const openPeriod = await ctx.db
      .query("payrollPeriods")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "open"),
      )
      .first();
    const now = new Date().toISOString();
    const id = await ctx.db.insert("timeEntries", {
      tenantId,
      staff_id: args.staff_id,
      clock_in_at: now,
      break_minutes: 0,
      status: "in_progress",
      source: args.source ?? "mobile",
      position: args.position ?? staff.default_position,
      payroll_period_id: openPeriod?._id,
      created_at: now,
    });
    await logAudit(ctx, {
      action_type: "time_entry.clock_in",
      target_entity: "timeEntries",
      target_id: id,
      payload_delta: { staff_id: args.staff_id, source: args.source ?? "mobile" },
      via_agent: !!args.provenance,
      agent_prompt: args.provenance?.agent_prompt,
    });
    return id;
  },
});

export const clockOut = mutation({
  args: {
    id: v.id("timeEntries"),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, { id, provenance }) => {
    const tenantId = await requireTenant(ctx);
    const entry = await ctx.db.get(id);
    assertOwnedByTenant(entry, tenantId);
    if (entry.clock_out_at) throw new Error("Already clocked out");
    const now = new Date();
    const inMs = new Date(entry.clock_in_at).getTime();
    const activePauseSec = entry.paused_at
      ? Math.max(
          0,
          Math.floor((now.getTime() - new Date(entry.paused_at).getTime()) / 1000),
        )
      : 0;
    const pauseHours = ((entry.pause_seconds_total ?? 0) + activePauseSec) / 3600;
    const elapsedHours = (now.getTime() - inMs) / 3_600_000;
    const breakHours = (entry.break_minutes ?? 0) / 60;
    const hours = Math.max(0, +(elapsedHours - breakHours - pauseHours).toFixed(2));
    await ctx.db.patch(id, {
      clock_out_at: now.toISOString(),
      calculated_hours: hours,
      paused_at: undefined,
      pause_seconds_total: (entry.pause_seconds_total ?? 0) + activePauseSec,
      status: "completed",
    });
    await logAudit(ctx, {
      action_type: "time_entry.clock_out",
      target_entity: "timeEntries",
      target_id: id,
      payload_delta: { calculated_hours: hours },
      via_agent: !!provenance,
      agent_prompt: provenance?.agent_prompt,
    });
    return id;
  },
});

export const pause = mutation({
  args: { id: v.id("timeEntries") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const entry = await ctx.db.get(id);
    assertOwnedByTenant(entry, tenantId);
    if (entry.clock_out_at) throw new Error("Cannot pause a completed entry");
    if (entry.paused_at) return id; // idempotent
    const now = new Date().toISOString();
    await ctx.db.patch(id, { paused_at: now, status: "paused" });
    await logAudit(ctx, {
      action_type: "time_entry.pause",
      target_entity: "timeEntries",
      target_id: id,
    });
    return id;
  },
});

export const resume = mutation({
  args: { id: v.id("timeEntries") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const entry = await ctx.db.get(id);
    assertOwnedByTenant(entry, tenantId);
    if (!entry.paused_at) throw new Error("Entry is not paused");
    const elapsedSec = Math.max(
      0,
      Math.floor((Date.now() - new Date(entry.paused_at).getTime()) / 1000),
    );
    const total = (entry.pause_seconds_total ?? 0) + elapsedSec;
    await ctx.db.patch(id, {
      paused_at: undefined,
      pause_seconds_total: total,
      status: "in_progress",
    });
    await logAudit(ctx, {
      action_type: "time_entry.resume",
      target_entity: "timeEntries",
      target_id: id,
      payload_delta: { pause_seconds_total: total },
    });
    return id;
  },
});

/**
 * Audit-tracked manual adjust. Operator corrects a missed punch /
 * wrong break minutes / wrong position. Recomputes calculated_hours,
 * stamps adjusted_by + adjusted_at, flips status to "adjusted",
 * writes a before/after diff to the audit log.
 *
 * Locked once the entry has been picked up by a closed payroll
 * period.
 */
export const adjust = mutation({
  args: {
    id: v.id("timeEntries"),
    adjuster_staff_id: v.id("staffMembers"),
    patch: v.object({
      clock_in_at: v.optional(v.string()),
      clock_out_at: v.optional(v.string()),
      break_minutes: v.optional(v.number()),
      notes: v.optional(v.string()),
      position: v.optional(v.string()),
    }),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, { id, adjuster_staff_id, patch, provenance }) => {
    const tenantId = await requireTenant(ctx);
    const entry = await ctx.db.get(id);
    assertOwnedByTenant(entry, tenantId);
    if (entry.payroll_period_id) {
      const period = await ctx.db.get(entry.payroll_period_id);
      if (period && period.status !== "open") {
        throw new Error("Cannot adjust — payroll period is closed");
      }
    }
    const before = {
      clock_in_at: entry.clock_in_at,
      clock_out_at: entry.clock_out_at,
      break_minutes: entry.break_minutes,
      calculated_hours: entry.calculated_hours,
    };
    const mergedIn = patch.clock_in_at ?? entry.clock_in_at;
    const mergedOut = patch.clock_out_at ?? entry.clock_out_at;
    const mergedBreak = patch.break_minutes ?? entry.break_minutes ?? 0;
    let calculated = entry.calculated_hours;
    if (mergedOut) {
      const start = new Date(mergedIn).getTime();
      const end = new Date(mergedOut).getTime();
      if (end > start) {
        const breakHrs = mergedBreak / 60;
        calculated = +Math.max(0, (end - start) / 3_600_000 - breakHrs).toFixed(2);
      }
    }
    const now = new Date().toISOString();
    await ctx.db.patch(id, {
      ...patch,
      calculated_hours: calculated,
      adjusted_by: adjuster_staff_id,
      adjusted_at: now,
      status: "adjusted",
    });
    await logAudit(ctx, {
      action_type: "time_entry.adjust",
      target_entity: "timeEntries",
      target_id: id,
      payload_delta: {
        before,
        after: {
          clock_in_at: mergedIn,
          clock_out_at: mergedOut,
          break_minutes: mergedBreak,
          calculated_hours: calculated,
        },
        adjusted_by: adjuster_staff_id,
      },
      via_agent: !!provenance,
      agent_prompt: provenance?.agent_prompt,
    });
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("timeEntries") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const entry = await ctx.db.get(id);
    assertOwnedByTenant(entry, tenantId);
    if (entry.payroll_period_id) {
      const period = await ctx.db.get(entry.payroll_period_id);
      if (period && period.status !== "open") {
        throw new Error("Cannot delete — locked to a closed period");
      }
    }
    await ctx.db.delete(id);
    await logAudit(ctx, {
      action_type: "time_entry.delete",
      target_entity: "timeEntries",
      target_id: id,
    });
    return id;
  },
});
