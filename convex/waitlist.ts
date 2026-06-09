import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

const statusV = v.union(
  v.literal("pending"),
  v.literal("offered"),
  v.literal("converted"),
  v.literal("declined"),
  v.literal("withdrawn"),
  v.literal("expired"),
);

export const list = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("waitlistEntries")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    return await ctx.db
      .query("waitlistEntries")
      .withIndex("by_offer_token", (q) => q.eq("offer_token", token))
      .unique();
  },
});

export const add = mutation({
  args: {
    boater_id: v.optional(v.id("boaters")),
    patron_name: v.optional(v.string()),
    patron_email: v.optional(v.string()),
    patron_phone: v.optional(v.string()),
    preferences: v.object({
      min_loa_inches: v.optional(v.number()),
      max_loa_inches: v.optional(v.number()),
      needs_power: v.optional(v.boolean()),
      needs_water: v.optional(v.boolean()),
      preferred_dock_ids: v.optional(v.array(v.id("docks"))),
    }),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const id = await ctx.db.insert("waitlistEntries", {
      tenantId,
      ...args,
      status: "pending",
    });
    await logAudit(ctx, {
      action_type: "waitlist.add",
      target_entity: "waitlistEntries",
      target_id: id,
      payload_delta: { patron: args.patron_name ?? args.boater_id },
    });
    return id;
  },
});

export const updateStatus = mutation({
  args: { id: v.id("waitlistEntries"), status: statusV },
  handler: async (ctx, { id, status }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, { status });
    await logAudit(ctx, {
      action_type: "waitlist.update_status",
      target_entity: "waitlistEntries",
      target_id: id,
      payload_delta: { status },
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// Auto-offer cascade — Phase 5 lifecycle mutations
// ────────────────────────────────────────────────────────────

const offerStatusV = v.union(
  v.literal("none"),
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("declined"),
  v.literal("expired"),
);

function newToken(): string {
  // SECURITY: crypto.randomUUID gives ≥122 bits of CSPRNG entropy. The
  // prior Math.random+timestamp form was ~31 bits — sequential offers
  // share the timestamp prefix, so brute-forcing siblings of one known
  // token is feasible. The token authorizes acceptOffer/declineOffer,
  // so a guessed sibling lets an attacker steal a slip on behalf of
  // another waitlisted boater.
  return `wlo_${crypto.randomUUID()}`;
}

function isoOffsetHours(base: Date, h: number): string {
  return new Date(base.getTime() + h * 3_600_000).toISOString();
}

/**
 * Fire offers to the top-N candidates on a freed slip. Each entry
 * gets a fresh offer_token + 48h expiry, status flips to "offered",
 * offer_status="pending". One batch_id stamped across the cohort so
 * the operator UI can render them grouped + the audit log captures
 * the fan-out as a single event.
 *
 * Returns { batchId, tokens } — the operator UI redirects to the
 * Active Offers panel where the fan-out is now visible.
 */
export const fireOffer = mutation({
  args: {
    slip_id: v.id("slips"),
    entry_ids: v.array(v.id("waitlistEntries")),
    expires_hours: v.optional(v.number()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const now = new Date();
    const expiresHours = args.expires_hours ?? 48;
    const expiresAt = isoOffsetHours(now, expiresHours);
    const batchId = `wlb_${Date.now().toString(36)}_${args.slip_id.slice(-4)}`;
    const tokens: string[] = [];

    for (const id of args.entry_ids) {
      const entry = await ctx.db.get(id);
      assertOwnedByTenant(entry, tenantId);
      if (!entry) continue;
      if (entry.offer_status === "pending") continue; // idempotent
      const token = newToken();
      tokens.push(token);
      await ctx.db.patch(id, {
        status: "offered",
        offered_slip_id: args.slip_id,
        offered_at: now.toISOString(),
        offer_token: token,
        offer_expires_at: expiresAt,
        offer_status: "pending",
        offer_batch_id: batchId,
      });
    }

    await logAudit(ctx, {
      action_type: "waitlist.fire_offer",
      target_entity: "waitlistEntries",
      target_id: batchId,
      payload_delta: {
        slip_id: args.slip_id,
        count: tokens.length,
        expires_hours: expiresHours,
      },
      via_agent: !!args.agent_prompt,
      agent_prompt: args.agent_prompt,
    });

    return { batchId, tokens };
  },
});

/**
 * Accept a fired waitlist offer (called by /apply/waitlist/[token]
 * server-side after token + expiry validation).
 *
 * Stamps offer_status=accepted + status=converted. A draft Contract +
 * onboarding chain is the operator's next step on the boater detail
 * page; we intentionally don't draft here because the contract
 * template + rate selection needs operator review for non-trivial
 * cases (rate exceptions, multi-vessel, etc.).
 */
export const acceptOffer = mutation({
  args: {
    token: v.string(),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // SECURITY: public mutation — the token IS the auth. Cap length
    // to refuse adversarial scans before the index lookup.
    if (args.token.length > 128) {
      throw new Error("Offer token not found.");
    }
    const entry = await ctx.db
      .query("waitlistEntries")
      .withIndex("by_offer_token", (q) => q.eq("offer_token", args.token))
      .unique();
    if (!entry) throw new Error("Offer token not found.");
    const tenantId = entry.tenantId;
    if (entry.offer_status !== "pending") {
      throw new Error(`Offer is ${entry.offer_status ?? "not pending"}.`);
    }
    if (
      entry.offer_expires_at &&
      new Date(entry.offer_expires_at).getTime() < Date.now()
    ) {
      await ctx.db.patch(entry._id, {
        status: "expired",
        offer_status: "expired",
      });
      throw new Error("Offer has expired.");
    }
    const now = new Date().toISOString();
    await ctx.db.patch(entry._id, {
      status: "converted",
      offer_status: "accepted",
      offer_responded_at: now,
    });
    await logAudit(ctx, {
      action_type: "waitlist.accept_offer",
      target_entity: "waitlistEntries",
      target_id: entry._id,
      payload_delta: { slip_id: entry.offered_slip_id },
      via_agent: !!args.agent_prompt,
      agent_prompt: args.agent_prompt,
    });
    return { entry_id: entry._id, tenantId };
  },
});

/**
 * Decline a fired waitlist offer. Stamps offer_status=declined,
 * drops the entry status back to pending (boater stays on the
 * queue — declining one offer doesn't withdraw them), and the
 * server-side caller may follow up with `fireOffer` on the next
 * candidate (auto-advance is a UI/business-policy decision; this
 * mutation only persists the decline).
 */
export const declineOffer = mutation({
  args: {
    token: v.string(),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // SECURITY: see acceptOffer above — token cap before index scan.
    if (args.token.length > 128) {
      throw new Error("Offer token not found.");
    }
    const entry = await ctx.db
      .query("waitlistEntries")
      .withIndex("by_offer_token", (q) => q.eq("offer_token", args.token))
      .unique();
    if (!entry) throw new Error("Offer token not found.");
    if (entry.offer_status !== "pending") {
      throw new Error(`Offer is ${entry.offer_status ?? "not pending"}.`);
    }
    // Decline on an expired offer is a no-op from the boater's
    // perspective — flip to expired (cleaner audit trail) instead of
    // declined since "decline" implies the boater chose to pass.
    if (
      entry.offer_expires_at &&
      new Date(entry.offer_expires_at).getTime() < Date.now()
    ) {
      await ctx.db.patch(entry._id, {
        status: "expired",
        offer_status: "expired",
      });
      throw new Error("Offer has expired.");
    }
    const now = new Date().toISOString();
    await ctx.db.patch(entry._id, {
      status: "pending",
      offer_status: "declined",
      offer_responded_at: now,
    });
    await logAudit(ctx, {
      action_type: "waitlist.decline_offer",
      target_entity: "waitlistEntries",
      target_id: entry._id,
      payload_delta: { slip_id: entry.offered_slip_id },
      via_agent: !!args.agent_prompt,
      agent_prompt: args.agent_prompt,
    });
    return { entry_id: entry._id };
  },
});

/**
 * Cron-style walker — flip any pending offers whose 48h window has
 * lapsed to `expired`. Run on a schedule (Convex `crons.ts`) AND
 * on-demand from the operator panel "Sweep expired" button.
 *
 * Returns the count of expired offers. Idempotent — calling with no
 * stale rows is a no-op.
 */
export const expireStaleOffers = mutation({
  args: {
    now: v.optional(v.string()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const cutoffMs = args.now ? new Date(args.now).getTime() : Date.now();
    const pending = await ctx.db
      .query("waitlistEntries")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    let expired = 0;
    for (const w of pending) {
      if (w.offer_status !== "pending") continue;
      if (!w.offer_expires_at) continue;
      if (new Date(w.offer_expires_at).getTime() >= cutoffMs) continue;
      await ctx.db.patch(w._id, {
        status: "expired",
        offer_status: "expired",
      });
      expired += 1;
    }
    if (expired > 0) {
      await logAudit(ctx, {
        action_type: "waitlist.expire_stale_offers",
        target_entity: "waitlistEntries",
        target_id: "batch",
        payload_delta: { expired },
        via_agent: !!args.agent_prompt,
        agent_prompt: args.agent_prompt,
      });
    }
    return { expired };
  },
});
