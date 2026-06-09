import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

const valueV = v.object({
  id: v.string(),
  label: v.string(),
  code: v.string(),
  sort_order: v.number(),
  active: v.boolean(),
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("picklists")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const getByFieldKey = query({
  args: { field_key: v.string() },
  handler: async (ctx, { field_key }) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("picklists")
      .withIndex("by_tenant_field", (q) =>
        q.eq("tenantId", tenantId).eq("field_key", field_key),
      )
      .unique();
  },
});

export const updateValues = mutation({
  args: { id: v.id("picklists"), values: v.array(valueV) },
  handler: async (ctx, { id, values }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, { values });
    await logAudit(ctx, {
      action_type: "picklist.update",
      target_entity: "picklists",
      target_id: id,
      payload_delta: { value_count: values.length },
    });
    return id;
  },
});
