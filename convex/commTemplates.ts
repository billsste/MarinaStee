import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("commTemplates")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const getByKind = query({
  args: { kind: v.string() },
  handler: async (ctx, { kind }) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("commTemplates")
      .withIndex("by_tenant_kind", (q) =>
        q.eq("tenantId", tenantId).eq("kind", kind),
      )
      .unique();
  },
});

export const update = mutation({
  args: {
    id: v.id("commTemplates"),
    patch: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      channel: v.optional(
        v.union(v.literal("email"), v.literal("sms"), v.literal("voice")),
      ),
      subject: v.optional(v.string()),
      body_markdown: v.optional(v.string()),
      active: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "comm_template.update",
      target_entity: "commTemplates",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});
