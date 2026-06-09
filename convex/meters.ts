import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

export const list = query({
  args: { spaceId: v.optional(v.id("slips")) },
  handler: async (ctx, { spaceId }) => {
    const tenantId = await requireTenant(ctx);
    if (spaceId) {
      return await ctx.db
        .query("meterReadings")
        .withIndex("by_tenant_space", (q) =>
          q.eq("tenantId", tenantId).eq("space_id", spaceId),
        )
        .collect();
    }
    return await ctx.db
      .query("meterReadings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const anomalies = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    const all = await ctx.db
      .query("meterReadings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    // Match the heuristic in lib/mock-data → meterAnomaly:
    // delta > 2× the running average for the slip is flagged.
    return all.filter((m) => {
      const delta = m.current_reading - m.prev_reading;
      return m.flagged_anomaly || delta > 200; // simple threshold for now
    });
  },
});

export const recordReading = mutation({
  args: {
    space_id: v.id("slips"),
    meter_number: v.string(),
    current_reading: v.number(),
    prev_reading: v.number(),
    prev_ts: v.string(),
    unit: v.optional(v.union(v.literal("kWh"), v.literal("gallons"))),
    rate_per_unit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const slip = await ctx.db.get(args.space_id);
    assertOwnedByTenant(slip, tenantId);
    const now = new Date().toISOString();
    const id = await ctx.db.insert("meterReadings", {
      tenantId,
      space_id: args.space_id,
      meter_number: args.meter_number,
      current_reading: args.current_reading,
      current_ts: now,
      prev_reading: args.prev_reading,
      prev_ts: args.prev_ts,
      unit: args.unit,
      rate_per_unit: args.rate_per_unit,
    });
    await logAudit(ctx, {
      action_type: "meter.record",
      target_entity: "meterReadings",
      target_id: id,
      payload_delta: {
        slip: slip.number,
        delta: args.current_reading - args.prev_reading,
      },
    });
    return id;
  },
});
