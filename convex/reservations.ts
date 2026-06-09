import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  assertOwnedByTenant,
  logAudit,
  nextSequenceNumber,
  requireTenant,
} from "./_helpers";

const reservationTypeV = v.union(
  v.literal("annual"),
  v.literal("seasonal"),
  v.literal("monthly"),
  v.literal("transient"),
  v.literal("recurring"),
);

const reservationStatusV = v.union(
  v.literal("scheduled"),
  v.literal("occupied"),
  v.literal("completed"),
  v.literal("cancelled"),
);

export const list = query({
  args: { boaterId: v.optional(v.id("boaters")) },
  handler: async (ctx, { boaterId }) => {
    const tenantId = await requireTenant(ctx);
    if (boaterId) {
      return await ctx.db
        .query("reservations")
        .withIndex("by_tenant_boater", (q) =>
          q.eq("tenantId", tenantId).eq("boater_id", boaterId),
        )
        .collect();
    }
    return await ctx.db
      .query("reservations")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const arrivalsForDate = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("reservations")
      .withIndex("by_tenant_arrival", (q) =>
        q.eq("tenantId", tenantId).eq("arrival_date", date),
      )
      .collect();
  },
});

export const get = query({
  args: { id: v.id("reservations") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    assertOwnedByTenant(row, tenantId);
    return row;
  },
});

export const create = mutation({
  args: {
    boater_id: v.id("boaters"),
    slip_id: v.id("slips"),
    vessel_id: v.optional(v.id("vessels")),
    arrival_date: v.string(),
    departure_date: v.string(),
    type: reservationTypeV,
    nightly_rate: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const existing = await ctx.db
      .query("reservations")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const seq = await nextSequenceNumber(ctx, tenantId, "R", 5001);
    const number = `R-${String(seq).padStart(4, "0")}`;
    const id = await ctx.db.insert("reservations", {
      tenantId,
      number,
      boater_id: args.boater_id,
      vessel_id: args.vessel_id,
      slip_id: args.slip_id,
      arrival_date: args.arrival_date,
      departure_date: args.departure_date,
      status: "scheduled",
      type: args.type,
      nightly_rate: args.nightly_rate,
      notes: args.notes,
    });
    await logAudit(ctx, {
      action_type: "reservation.create",
      target_entity: "reservations",
      target_id: id,
      payload_delta: { number, boater_id: args.boater_id },
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("reservations"),
    patch: v.object({
      status: v.optional(reservationStatusV),
      arrival_date: v.optional(v.string()),
      departure_date: v.optional(v.string()),
      slip_id: v.optional(v.id("slips")),
      vessel_id: v.optional(v.id("vessels")),
      notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "reservation.update",
      target_entity: "reservations",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});

export const cancel = mutation({
  args: { id: v.id("reservations") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, { status: "cancelled" });
    await logAudit(ctx, {
      action_type: "reservation.cancel",
      target_entity: "reservations",
      target_id: id,
    });
    return id;
  },
});
