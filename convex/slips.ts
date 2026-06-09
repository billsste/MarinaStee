import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

const slipClassV = v.union(
  v.literal("covered"),
  v.literal("uncovered"),
  v.literal("t_head"),
  v.literal("buoy"),
  v.literal("dry_storage"),
  v.literal("mooring"),
);

const occupancyV = v.union(
  v.literal("vacant"),
  v.literal("occupied"),
  v.literal("reserved"),
  v.literal("out_of_service"),
);

export const list = query({
  args: {
    dockId: v.optional(v.id("docks")),
    status: v.optional(occupancyV),
  },
  handler: async (ctx, { dockId, status }) => {
    const tenantId = await requireTenant(ctx);
    let rows;
    if (dockId) {
      rows = await ctx.db
        .query("slips")
        .withIndex("by_tenant_dock", (q) =>
          q.eq("tenantId", tenantId).eq("dock_id", dockId),
        )
        .collect();
    } else {
      rows = await ctx.db
        .query("slips")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .collect();
    }
    return status ? rows.filter((s) => s.occupancy_status === status) : rows;
  },
});

export const get = query({
  args: { id: v.id("slips") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    assertOwnedByTenant(row, tenantId);
    return row;
  },
});

export const create = mutation({
  args: {
    dock_id: v.id("docks"),
    number: v.string(),
    slip_class: slipClassV,
    max_loa_inches: v.number(),
    max_beam_inches: v.number(),
    has_power: v.boolean(),
    has_water: v.boolean(),
    default_annual_rate: v.number(),
    invoice_category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const dock = await ctx.db.get(args.dock_id);
    assertOwnedByTenant(dock, tenantId);
    const id = await ctx.db.insert("slips", {
      tenantId,
      dock_id: args.dock_id,
      dock_name_cache: dock.name,
      number: args.number,
      slip_class: args.slip_class,
      invoice_category: args.invoice_category,
      max_loa_inches: args.max_loa_inches,
      max_beam_inches: args.max_beam_inches,
      has_power: args.has_power,
      has_water: args.has_water,
      default_annual_rate: args.default_annual_rate,
      occupancy_status: "vacant",
    });
    await logAudit(ctx, {
      action_type: "slip.create",
      target_entity: "slips",
      target_id: id,
      payload_delta: { dock: dock.name, number: args.number },
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("slips"),
    patch: v.object({
      dock_id: v.optional(v.id("docks")),
      number: v.optional(v.string()),
      slip_class: v.optional(slipClassV),
      invoice_category: v.optional(v.string()),
      max_loa_inches: v.optional(v.number()),
      max_beam_inches: v.optional(v.number()),
      has_power: v.optional(v.boolean()),
      has_water: v.optional(v.boolean()),
      default_annual_rate: v.optional(v.number()),
      default_monthly_rate: v.optional(v.number()),
      default_seasonal_rate: v.optional(v.number()),
      occupancy_status: v.optional(occupancyV),
      current_holder_boater_id: v.optional(v.id("boaters")),
      current_contract_id: v.optional(v.id("contracts")),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);

    // If dock_id changes, refresh the denormalized cache
    const final: typeof patch & { dock_name_cache?: string } = { ...patch };
    if (patch.dock_id) {
      const dock = await ctx.db.get(patch.dock_id);
      assertOwnedByTenant(dock, tenantId);
      final.dock_name_cache = dock.name;
    }
    await ctx.db.patch(id, final);
    await logAudit(ctx, {
      action_type: "slip.update",
      target_entity: "slips",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});
