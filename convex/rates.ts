import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

const cadenceV = v.union(
  v.literal("daily"),
  v.literal("weekly"),
  v.literal("monthly"),
  v.literal("seasonal"),
  v.literal("annual"),
);

export const list = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, { activeOnly }) => {
    const tenantId = await requireTenant(ctx);
    if (activeOnly) {
      return await ctx.db
        .query("rates")
        .withIndex("by_tenant_active", (q) =>
          q.eq("tenantId", tenantId).eq("active", true),
        )
        .collect();
    }
    return await ctx.db
      .query("rates")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    occupancy_type: v.string(),
    cadence: cadenceV,
    amount: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const id = await ctx.db.insert("rates", {
      tenantId,
      ...args,
      active: true,
    });
    await logAudit(ctx, {
      action_type: "rate.create",
      target_entity: "rates",
      target_id: id,
      payload_delta: { name: args.name, amount: args.amount },
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("rates"),
    patch: v.object({
      name: v.optional(v.string()),
      occupancy_type: v.optional(v.string()),
      cadence: v.optional(cadenceV),
      amount: v.optional(v.number()),
      active: v.optional(v.boolean()),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "rate.update",
      target_entity: "rates",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});
