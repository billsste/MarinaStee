/*
 * Vessels — boater-owned boats.
 * Mirrors convex/boaters.ts pattern.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

export const list = query({
  args: { boaterId: v.optional(v.id("boaters")) },
  handler: async (ctx, { boaterId }) => {
    const tenantId = await requireTenant(ctx);
    if (boaterId) {
      return await ctx.db
        .query("vessels")
        .withIndex("by_tenant_boater", (q) =>
          q.eq("tenantId", tenantId).eq("boater_id", boaterId),
        )
        .collect();
    }
    return await ctx.db
      .query("vessels")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("vessels") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    assertOwnedByTenant(row, tenantId);
    return row;
  },
});

const vesselTypeV = v.union(
  v.literal("powerboat"),
  v.literal("sailboat"),
  v.literal("pontoon"),
  v.literal("houseboat"),
  v.literal("pwc"),
  v.literal("other"),
);

const fuelTypeV = v.union(
  v.literal("gasoline"),
  v.literal("diesel"),
  v.literal("electric"),
  v.literal("none"),
);

export const create = mutation({
  args: {
    boater_id: v.id("boaters"),
    name: v.string(),
    year: v.optional(v.number()),
    make: v.optional(v.string()),
    model: v.optional(v.string()),
    vessel_type: v.optional(vesselTypeV),
    fuel_type: v.optional(fuelTypeV),
    loa_inches: v.optional(v.number()),
    beam_inches: v.optional(v.number()),
    draft_inches: v.optional(v.number()),
    hull_vin: v.optional(v.string()),
    registration: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const boater = await ctx.db.get(args.boater_id);
    assertOwnedByTenant(boater, tenantId);
    const id = await ctx.db.insert("vessels", {
      tenantId,
      boater_id: args.boater_id,
      co_owner_ids: [],
      name: args.name,
      year: args.year,
      make: args.make,
      model: args.model,
      vessel_type: args.vessel_type,
      fuel_type: args.fuel_type,
      loa_inches: args.loa_inches,
      beam_inches: args.beam_inches,
      draft_inches: args.draft_inches,
      hull_vin: args.hull_vin,
      registration: args.registration,
      active: true,
    });
    await logAudit(ctx, {
      action_type: "vessel.create",
      target_entity: "vessels",
      target_id: id,
      payload_delta: { name: args.name, boater_id: args.boater_id },
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("vessels"),
    patch: v.object({
      name: v.optional(v.string()),
      year: v.optional(v.number()),
      make: v.optional(v.string()),
      model: v.optional(v.string()),
      vessel_type: v.optional(vesselTypeV),
      fuel_type: v.optional(fuelTypeV),
      loa_inches: v.optional(v.number()),
      beam_inches: v.optional(v.number()),
      draft_inches: v.optional(v.number()),
      hull_vin: v.optional(v.string()),
      registration: v.optional(v.string()),
      active: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "vessel.update",
      target_entity: "vessels",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});

export const archive = mutation({
  args: { id: v.id("vessels") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, { active: false });
    await logAudit(ctx, {
      action_type: "vessel.archive",
      target_entity: "vessels",
      target_id: id,
    });
    return id;
  },
});
