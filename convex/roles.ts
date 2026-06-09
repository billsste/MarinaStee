import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    const rows = await ctx.db
      .query("roles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    return rows.sort((a, b) => a.sort_order - b.sort_order);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    permissions: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const existing = await ctx.db
      .query("roles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const id = await ctx.db.insert("roles", {
      tenantId,
      name: args.name,
      description: args.description,
      permissions: args.permissions,
      is_system: false,
      sort_order: existing.length + 1,
    });
    await logAudit(ctx, {
      action_type: "role.create",
      target_entity: "roles",
      target_id: id,
      payload_delta: { name: args.name, perm_count: args.permissions.length },
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("roles"),
    patch: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      permissions: v.optional(v.array(v.string())),
      sort_order: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    if (before.is_system && patch.name) {
      throw new Error("Cannot rename system roles");
    }
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "role.update",
      target_entity: "roles",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});

export const archive = mutation({
  args: { id: v.id("roles") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    if (before.is_system) {
      throw new Error("Cannot delete system roles");
    }
    // Block delete if any staff still references it
    const staff = await ctx.db
      .query("staffMembers")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const using = staff.filter((s) => s.role_id === id);
    if (using.length > 0) {
      throw new Error(
        `Cannot delete role — ${using.length} staff member${using.length === 1 ? "" : "s"} still assigned`,
      );
    }
    await ctx.db.delete(id);
    await logAudit(ctx, {
      action_type: "role.delete",
      target_entity: "roles",
      target_id: id,
    });
    return id;
  },
});
