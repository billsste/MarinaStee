import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

export const list = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, { activeOnly }) => {
    const tenantId = await requireTenant(ctx);
    const rows = await ctx.db
      .query("docks")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const filtered = activeOnly ? rows.filter((d) => d.active) : rows;
    return filtered.sort((a, b) => a.sort_order - b.sort_order);
  },
});

export const get = query({
  args: { id: v.id("docks") },
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
    short_name: v.optional(v.string()),
    prefix: v.optional(v.string()),
    sort_order: v.optional(v.number()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const id = await ctx.db.insert("docks", {
      tenantId,
      name: args.name,
      short_name: args.short_name ?? args.name.replace(/\s*dock\s*$/i, ""),
      prefix: args.prefix?.toUpperCase(),
      sort_order: args.sort_order ?? 999,
      active: args.active ?? true,
    });
    await logAudit(ctx, {
      action_type: "dock.create",
      target_entity: "docks",
      target_id: id,
      payload_delta: { name: args.name, prefix: args.prefix },
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("docks"),
    patch: v.object({
      name: v.optional(v.string()),
      short_name: v.optional(v.string()),
      prefix: v.optional(v.string()),
      sort_order: v.optional(v.number()),
      active: v.optional(v.boolean()),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    // Cascade name change → slip.dock_name_cache
    if (patch.name && patch.name !== before.name) {
      const slips = await ctx.db
        .query("slips")
        .withIndex("by_tenant_dock", (q) =>
          q.eq("tenantId", tenantId).eq("dock_id", id),
        )
        .collect();
      for (const slip of slips) {
        await ctx.db.patch(slip._id, { dock_name_cache: patch.name });
      }
    }
    await logAudit(ctx, {
      action_type: "dock.update",
      target_entity: "docks",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});

export const archive = mutation({
  args: { id: v.id("docks") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    // Block archive if slips still reference this dock
    const slips = await ctx.db
      .query("slips")
      .withIndex("by_tenant_dock", (q) =>
        q.eq("tenantId", tenantId).eq("dock_id", id),
      )
      .take(1);
    if (slips.length > 0) {
      throw new Error(
        `Cannot archive ${before.name} — ${slips.length}+ slips still reference it`,
      );
    }
    await ctx.db.patch(id, { active: false });
    await logAudit(ctx, {
      action_type: "dock.archive",
      target_entity: "docks",
      target_id: id,
    });
    return id;
  },
});

/**
 * Hard-delete a dock. Matches the mock-store `deleteDock` semantics
 * used by Settings → Customization → Docks: refuses to delete while
 * any slip still references the dock, otherwise removes the row.
 *
 * Operators who want to keep history should call `archive` instead.
 */
export const remove = mutation({
  args: { id: v.id("docks") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    const slips = await ctx.db
      .query("slips")
      .withIndex("by_tenant_dock", (q) =>
        q.eq("tenantId", tenantId).eq("dock_id", id),
      )
      .take(1);
    if (slips.length > 0) {
      throw new Error(
        `Can't delete dock — ${slips.length}+ slip(s) still reference it. Move or delete those slips first.`,
      );
    }
    await ctx.db.delete(id);
    await logAudit(ctx, {
      action_type: "dock.delete",
      target_entity: "docks",
      target_id: id,
      payload_delta: { name: before.name, prefix: before.prefix },
    });
    return id;
  },
});
