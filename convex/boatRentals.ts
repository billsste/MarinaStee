/*
 * Boat rentals — bookings + the fleet that produces them.
 * Two entities in one file since they're tightly coupled.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  assertOwnedByTenant,
  logAudit,
  nextSequenceNumber,
  requireTenant,
} from "./_helpers";

const boatTypeV = v.union(
  v.literal("pontoon"),
  v.literal("jet_ski"),
  v.literal("kayak"),
  v.literal("paddleboard"),
  v.literal("fishing_skiff"),
  v.literal("ski_boat"),
  v.literal("other"),
);

const rateKindV = v.union(
  v.literal("hourly"),
  v.literal("half_day"),
  v.literal("full_day"),
);

const rentalStatusV = v.union(
  v.literal("reserved"),
  v.literal("checked_out"),
  v.literal("returned"),
  v.literal("closed"),
  v.literal("cancelled"),
);

// ── Fleet ──────────────────────────────────────────────────────

export const listFleet = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("rentalBoats")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const upsertBoat = mutation({
  args: {
    id: v.optional(v.id("rentalBoats")),
    name: v.string(),
    type: boatTypeV,
    status: v.union(
      v.literal("available"),
      v.literal("rented"),
      v.literal("maintenance"),
      v.literal("out_of_service"),
    ),
    hourly_rate: v.optional(v.number()),
    half_day_rate: v.optional(v.number()),
    full_day_rate: v.optional(v.number()),
    capacity: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const { id, ...rest } = args;
    if (id) {
      const before = await ctx.db.get(id);
      assertOwnedByTenant(before, tenantId);
      await ctx.db.patch(id, rest);
      await logAudit(ctx, {
        action_type: "rental_boat.update",
        target_entity: "rentalBoats",
        target_id: id,
        payload_delta: rest,
      });
      return id;
    }
    const newId = await ctx.db.insert("rentalBoats", { tenantId, ...rest });
    await logAudit(ctx, {
      action_type: "rental_boat.create",
      target_entity: "rentalBoats",
      target_id: newId,
      payload_delta: { name: args.name, type: args.type },
    });
    return newId;
  },
});

// ── Bookings ───────────────────────────────────────────────────

export const listBookings = query({
  args: { status: v.optional(rentalStatusV) },
  handler: async (ctx, { status }) => {
    const tenantId = await requireTenant(ctx);
    if (status) {
      return await ctx.db
        .query("boatRentals")
        .withIndex("by_tenant_status", (q) =>
          q.eq("tenantId", tenantId).eq("status", status),
        )
        .collect();
    }
    return await ctx.db
      .query("boatRentals")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    // Public — used by /pickup/[token]
    return await ctx.db
      .query("boatRentals")
      .withIndex("by_pickup_token", (q) => q.eq("pickup_token", token))
      .unique();
  },
});

export const create = mutation({
  args: {
    boat_id: v.id("rentalBoats"),
    boater_id: v.optional(v.id("boaters")),
    patron_name: v.optional(v.string()),
    patron_email: v.optional(v.string()),
    patron_phone: v.optional(v.string()),
    start_at: v.string(),
    end_at: v.string(),
    rate_kind: rateKindV,
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const boat = await ctx.db.get(args.boat_id);
    assertOwnedByTenant(boat, tenantId);
    const existing = await ctx.db
      .query("boatRentals")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const seq = await nextSequenceNumber(ctx, tenantId, "BR", 1001);
    const number = `BR-${String(seq).padStart(4, "0")}`;
    const baseRate =
      args.rate_kind === "hourly"
        ? boat.hourly_rate ?? 0
        : args.rate_kind === "half_day"
          ? boat.half_day_rate ?? 0
          : boat.full_day_rate ?? 0;
    const id = await ctx.db.insert("boatRentals", {
      tenantId,
      number,
      boat_id: args.boat_id,
      boater_id: args.boater_id,
      patron_name: args.patron_name,
      patron_email: args.patron_email,
      patron_phone: args.patron_phone,
      start_at: args.start_at,
      end_at: args.end_at,
      rate_kind: args.rate_kind,
      base_amount: baseRate,
      deposit_hold: 0,
      status: "reserved",
      checkin: {},
    });
    await logAudit(ctx, {
      action_type: "boat_rental.create",
      target_entity: "boatRentals",
      target_id: id,
      payload_delta: { boat: boat.name, customer: args.patron_name ?? "holder" },
    });
    return id;
  },
});

export const close = mutation({
  args: {
    id: v.id("boatRentals"),
    fuel_in_pct: v.optional(v.number()),
    hours_in: v.optional(v.number()),
    damage_notes: v.optional(v.string()),
    damage_charge: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...checkin }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, {
      status: "closed",
      checkin: {
        ...before.checkin,
        ...checkin,
        checked_in_at: new Date().toISOString(),
      },
    });
    await logAudit(ctx, {
      action_type: "boat_rental.close",
      target_entity: "boatRentals",
      target_id: id,
      payload_delta: checkin,
    });
    return id;
  },
});
