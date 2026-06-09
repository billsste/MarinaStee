import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("marinaEvents")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    type: v.string(),
    description: v.optional(v.string()),
    start_at: v.string(),
    end_at: v.string(),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const id = await ctx.db.insert("marinaEvents", { tenantId, ...args });
    await logAudit(ctx, {
      action_type: "event.create",
      target_entity: "marinaEvents",
      target_id: id,
      payload_delta: { title: args.title, start: args.start_at },
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("marinaEvents"),
    patch: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      start_at: v.optional(v.string()),
      end_at: v.optional(v.string()),
      location: v.optional(v.string()),
      attendee_count: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "event.update",
      target_entity: "marinaEvents",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});
