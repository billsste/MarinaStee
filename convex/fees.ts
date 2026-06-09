import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

const recurrenceV = v.union(
  v.literal("one_time"),
  v.literal("monthly"),
  v.literal("annual"),
);

const appliesToV = v.union(
  v.literal("slip_contract"),
  v.literal("work_order"),
  v.literal("boat_rental"),
  v.literal("pos"),
  v.literal("annual_billing_run"),
);

export const list = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("additionalFees")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("additionalFees") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    assertOwnedByTenant(row, tenantId);
    return row;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    amount: v.number(),
    recurrence: recurrenceV,
    applies_to: appliesToV,
    accounting_line_item: v.string(),
    description: v.optional(v.string()),
    auto_attach: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const id = await ctx.db.insert("additionalFees", {
      tenantId,
      name: args.name,
      description: args.description,
      amount: args.amount,
      recurrence: args.recurrence,
      applies_to: [args.applies_to],
      accounting_line_item: args.accounting_line_item,
      auto_attach: args.auto_attach ?? true,
    });
    await logAudit(ctx, {
      action_type: "fee.create",
      target_entity: "additionalFees",
      target_id: id,
      payload_delta: { name: args.name, amount: args.amount },
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("additionalFees"),
    patch: v.object({
      name: v.optional(v.string()),
      amount: v.optional(v.number()),
      recurrence: v.optional(recurrenceV),
      applies_to: v.optional(v.array(appliesToV)),
      accounting_line_item: v.optional(v.string()),
      auto_attach: v.optional(v.boolean()),
      description: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "fee.update",
      target_entity: "additionalFees",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});

export const archive = mutation({
  args: { id: v.id("additionalFees") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.delete(id);
    await logAudit(ctx, {
      action_type: "fee.delete",
      target_entity: "additionalFees",
      target_id: id,
    });
    return id;
  },
});
