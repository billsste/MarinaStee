import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  assertOwnedByTenant,
  logAudit,
  nextSequenceNumber,
  requireTenant,
} from "./_helpers";
import { runWorkOrderCloseout, shouldFireCloseout } from "./_closeout";

const woStatusV = v.union(
  v.literal("open"),
  v.literal("scheduled"),
  v.literal("in_progress"),
  v.literal("blocked"),
  v.literal("completed"),
  v.literal("cancelled"),
);

const woPriorityV = v.union(
  v.literal("low"),
  v.literal("normal"),
  v.literal("high"),
  v.literal("urgent"),
);

const woActivityV = v.union(
  v.literal("winterization"),
  v.literal("bottom_paint"),
  v.literal("service"),
  v.literal("inspection"),
  v.literal("haul_out"),
  v.literal("pump_out"),
  v.literal("task"),
  v.literal("other"),
);

export const list = query({
  args: {
    status: v.optional(woStatusV),
    boaterId: v.optional(v.id("boaters")),
    activeOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, { status, boaterId, activeOnly }) => {
    const tenantId = await requireTenant(ctx);
    let rows;
    if (boaterId) {
      rows = await ctx.db
        .query("workOrders")
        .withIndex("by_tenant_boater", (q) =>
          q.eq("tenantId", tenantId).eq("boater_id", boaterId),
        )
        .collect();
    } else if (status) {
      rows = await ctx.db
        .query("workOrders")
        .withIndex("by_tenant_status", (q) =>
          q.eq("tenantId", tenantId).eq("status", status),
        )
        .collect();
    } else {
      rows = await ctx.db
        .query("workOrders")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .collect();
    }
    if (activeOnly) {
      return rows.filter(
        (w) => !["completed", "cancelled"].includes(w.status),
      );
    }
    return rows;
  },
});

export const get = query({
  args: { id: v.id("workOrders") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    assertOwnedByTenant(row, tenantId);
    return row;
  },
});

export const create = mutation({
  args: {
    boater_id: v.id("boaters"),
    subject: v.string(),
    description: v.optional(v.string()),
    activity_type: v.optional(woActivityV),
    priority: v.optional(woPriorityV),
    vessel_id: v.optional(v.id("vessels")),
    slip_id: v.optional(v.id("slips")),
    due_date: v.optional(v.string()),
    assignee_user_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    // Atomic per-tenant WO-#### counter (race-free under concurrent
    // inserts — see convex/_helpers.ts → nextSequenceNumber).
    const seq = await nextSequenceNumber(ctx, tenantId, "WO", 1001);
    const number = `WO-${String(seq).padStart(4, "0")}`;
    const id = await ctx.db.insert("workOrders", {
      tenantId,
      number,
      boater_id: args.boater_id,
      vessel_id: args.vessel_id,
      slip_id: args.slip_id,
      subject: args.subject,
      description: args.description,
      status: "open",
      priority: args.priority ?? "normal",
      assignee_user_id: args.assignee_user_id,
      activity_type: args.activity_type ?? "other",
      due_date: args.due_date,
    });
    await logAudit(ctx, {
      action_type: "work_order.create",
      target_entity: "workOrders",
      target_id: id,
      payload_delta: { number, subject: args.subject },
    });
    return id;
  },
});

/**
 * Update — handles status, priority, assignee, dates.
 *
 * Closeout chain (status → "completed") fires inline at the tail of
 * this mutation when the transition is detected. Implementation lives
 * in `convex/_closeout.ts` and mirrors `lib/wo-closeout.ts` on the mock
 * side step-for-step. Idempotency: the closeout helper short-circuits
 * when `wo.closed_out_at` is already set; `shouldFireCloseout` gates
 * the call here so we don't even pay the round-trip when nothing's
 * happening.
 *
 * Returns `{ id, closeout? }` so callers can surface the chain's
 * side-effects (posted invoice id, comm id, vessel stamp) without a
 * follow-up query.
 */
export const update = mutation({
  args: {
    id: v.id("workOrders"),
    patch: v.object({
      status: v.optional(woStatusV),
      priority: v.optional(woPriorityV),
      assignee_user_id: v.optional(v.string()),
      subject: v.optional(v.string()),
      description: v.optional(v.string()),
      activity_type: v.optional(woActivityV),
      vessel_id: v.optional(v.id("vessels")),
      slip_id: v.optional(v.id("slips")),
      start_date: v.optional(v.string()),
      end_date: v.optional(v.string()),
      due_date: v.optional(v.string()),
      billable_minutes: v.optional(v.number()),
      flagged: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "work_order.update",
      target_entity: "workOrders",
      target_id: id,
      payload_delta: patch,
    });
    if (shouldFireCloseout(before, patch.status)) {
      const closeout = await runWorkOrderCloseout(ctx, {
        woId: id,
        tenantId,
        todayIso: new Date().toISOString(),
      });
      return { id, closeout };
    }
    return { id };
  },
});
