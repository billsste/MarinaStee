/*
 * POS locations + catalog + orders.
 * Three entities but one file since they're tightly coupled.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

const locationKeyV = v.union(
  v.literal("fuel_dock"),
  v.literal("ship_store"),
  v.literal("restaurant"),
  v.literal("harbormaster"),
);

// ── Locations ──────────────────────────────────────────────────

export const listLocations = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, { activeOnly }) => {
    const tenantId = await requireTenant(ctx);
    const rows = await ctx.db
      .query("posLocations")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const filtered = activeOnly ? rows.filter((l) => l.active) : rows;
    return filtered.sort((a, b) => a.sort_order - b.sort_order);
  },
});

export const createLocation = mutation({
  args: {
    key: locationKeyV,
    name: v.string(),
    icon_key: v.optional(
      v.union(
        v.literal("fuel"),
        v.literal("shop"),
        v.literal("restaurant"),
        v.literal("harbormaster"),
        v.literal("marina"),
      ),
    ),
    default_tax_rate: v.optional(v.number()),
    allows_charge_to_account: v.optional(v.boolean()),
    active: v.optional(v.boolean()),
    sort_order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const id = await ctx.db.insert("posLocations", {
      tenantId,
      key: args.key,
      name: args.name,
      icon_key: args.icon_key,
      default_tax_rate: args.default_tax_rate ?? 0,
      allows_charge_to_account: args.allows_charge_to_account ?? true,
      active: args.active ?? true,
      sort_order: args.sort_order ?? 999,
    });
    await logAudit(ctx, {
      action_type: "pos_location.create",
      target_entity: "posLocations",
      target_id: id,
      payload_delta: { key: args.key, name: args.name },
    });
    return id;
  },
});

export const updateLocation = mutation({
  args: {
    id: v.id("posLocations"),
    patch: v.object({
      name: v.optional(v.string()),
      icon_key: v.optional(
        v.union(
          v.literal("fuel"),
          v.literal("shop"),
          v.literal("restaurant"),
          v.literal("harbormaster"),
          v.literal("marina"),
        ),
      ),
      default_tax_rate: v.optional(v.number()),
      allows_charge_to_account: v.optional(v.boolean()),
      active: v.optional(v.boolean()),
      sort_order: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "pos_location.update",
      target_entity: "posLocations",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});

/**
 * Soft-archive a POS location (flips `active=false`). Historical
 * `posOrders` rows keep their `location_id` reference so reporting
 * still resolves — operators just can't open new orders against it.
 */
export const archiveLocation = mutation({
  args: { id: v.id("posLocations") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, { active: false });
    await logAudit(ctx, {
      action_type: "pos_location.archive",
      target_entity: "posLocations",
      target_id: id,
    });
    return id;
  },
});

/**
 * Hard-delete a POS location. Matches the mock-store `deletePosLocation`
 * semantics — Settings → POS Locations exposes a row-level trash icon
 * that confirms and removes outright. Historical `posOrders` keep
 * their `location_id` link (Convex won't error on the dangling ref —
 * reporting resolves it best-effort).
 *
 * Prefer `archiveLocation` when the operator just wants the row to
 * stop showing up in the POS terminal.
 */
export const removeLocation = mutation({
  args: { id: v.id("posLocations") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.delete(id);
    await logAudit(ctx, {
      action_type: "pos_location.delete",
      target_entity: "posLocations",
      target_id: id,
      payload_delta: { key: before.key, name: before.name },
    });
    return id;
  },
});

// ── Catalog ────────────────────────────────────────────────────

export const listCatalog = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, { activeOnly }) => {
    const tenantId = await requireTenant(ctx);
    if (activeOnly) {
      return await ctx.db
        .query("posCatalog")
        .withIndex("by_tenant_active", (q) =>
          q.eq("tenantId", tenantId).eq("active", true),
        )
        .collect();
    }
    return await ctx.db
      .query("posCatalog")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const searchCatalog = query({
  args: { q: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { q, limit }) => {
    const tenantId = await requireTenant(ctx);
    if (!q.trim()) return [];
    return await ctx.db
      .query("posCatalog")
      .withSearchIndex("search_name", (s) =>
        s.search("name", q).eq("tenantId", tenantId),
      )
      .take(limit ?? 10);
  },
});

export const createItem = mutation({
  args: {
    sku: v.string(),
    name: v.string(),
    category: v.string(),
    price: v.number(),
    cost: v.optional(v.number()),
    location_keys: v.array(locationKeyV),
    taxable: v.optional(v.boolean()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const id = await ctx.db.insert("posCatalog", {
      tenantId,
      sku: args.sku,
      name: args.name,
      category: args.category,
      price: args.price,
      cost: args.cost,
      location_keys: args.location_keys,
      taxable: args.taxable ?? true,
      active: args.active ?? true,
    });
    await logAudit(ctx, {
      action_type: "pos_item.create",
      target_entity: "posCatalog",
      target_id: id,
      payload_delta: { name: args.name, price: args.price },
    });
    return id;
  },
});

export const updateItem = mutation({
  args: {
    id: v.id("posCatalog"),
    patch: v.object({
      sku: v.optional(v.string()),
      name: v.optional(v.string()),
      category: v.optional(v.string()),
      price: v.optional(v.number()),
      cost: v.optional(v.number()),
      location_keys: v.optional(v.array(locationKeyV)),
      taxable: v.optional(v.boolean()),
      active: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "pos_item.update",
      target_entity: "posCatalog",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});

// ── Orders ─────────────────────────────────────────────────────

export const listOrders = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, { status }) => {
    const tenantId = await requireTenant(ctx);
    const rows = await ctx.db
      .query("posOrders")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    return status ? rows.filter((o) => o.status === status) : rows;
  },
});
