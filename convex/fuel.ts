/*
 * Fuel — inventory + deliveries + sales rolled into one file.
 * All three entities are read together on /services/gas.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

const fuelTypeV = v.union(v.literal("gasoline"), v.literal("diesel"));

// ── Inventory ──────────────────────────────────────────────────

export const inventory = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("fuelInventory")
      .withIndex("by_tenant_fuel", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const updateInventory = mutation({
  args: {
    id: v.id("fuelInventory"),
    patch: v.object({
      current_gallons: v.optional(v.number()),
      tank_capacity: v.optional(v.number()),
      reorder_threshold_pct: v.optional(v.number()),
      current_price_per_gallon: v.optional(v.number()),
      current_cost_per_gallon: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "fuel.inventory.update",
      target_entity: "fuelInventory",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});

// ── Deliveries ─────────────────────────────────────────────────

export const listDeliveries = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("fuelDeliveries")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const logDelivery = mutation({
  args: {
    fuel_type: fuelTypeV,
    gallons_delivered: v.number(),
    cost_per_gallon: v.number(),
    supplier: v.string(),
    delivery_date: v.string(),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const id = await ctx.db.insert("fuelDeliveries", {
      tenantId,
      ...args,
      total_cost: args.gallons_delivered * args.cost_per_gallon,
    });
    // Bump inventory
    const inv = await ctx.db
      .query("fuelInventory")
      .withIndex("by_tenant_fuel", (q) =>
        q.eq("tenantId", tenantId).eq("fuel_type", args.fuel_type),
      )
      .unique();
    if (inv) {
      await ctx.db.patch(inv._id, {
        current_gallons: inv.current_gallons + args.gallons_delivered,
        current_cost_per_gallon: args.cost_per_gallon,
      });
    }
    await logAudit(ctx, {
      action_type: "fuel.delivery",
      target_entity: "fuelDeliveries",
      target_id: id,
      payload_delta: {
        fuel: args.fuel_type,
        gallons: args.gallons_delivered,
      },
    });
    return id;
  },
});

// ── Sales ──────────────────────────────────────────────────────

export const listSales = query({
  args: { boaterId: v.optional(v.id("boaters")) },
  handler: async (ctx, { boaterId }) => {
    const tenantId = await requireTenant(ctx);
    if (boaterId) {
      return await ctx.db
        .query("fuelSales")
        .withIndex("by_tenant_boater", (q) =>
          q.eq("tenantId", tenantId).eq("boater_id", boaterId),
        )
        .collect();
    }
    return await ctx.db
      .query("fuelSales")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});
