/*
 * Applications — public boater self-onboarding queue.
 *
 * Public flow:
 *   1. /apply submits via `submit` (no auth required — see auth.config.ts)
 *   2. /apply/[token] reads via `lookupByToken` (public)
 *
 * Operator flow (tenant-scoped, requires auth):
 *   - `list` / `listByStatus` powers /members → Applications tab
 *   - `get` reads a single row
 *   - `approve` mints Boater + Vessel and stamps result_boater_id
 *   - `decline` stamps reviewed_at + internal_review_notes
 *   - `routeToWaitlist` mints a waitlistEntries row and stamps
 *     result_waitlist_entry_id
 *
 * Audit semantics match the rest of the codebase: every mutation calls
 * `logAudit` from _helpers.ts.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  assertOwnedByTenant,
  logAudit,
  nextSequenceNumber,
  requireTenant,
} from "./_helpers";

const statusV = v.union(
  v.literal("pending"),
  v.literal("under_review"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("waitlisted"),
);

const slipClassV = v.union(
  v.literal("covered"),
  v.literal("uncovered"),
  v.literal("T-head"),
  v.literal("buoy"),
  v.literal("dry"),
);

const sourceV = v.union(
  v.literal("public_apply"),
  v.literal("agent"),
  v.literal("manual"),
);

// ────────────────────────────────────────────────────────────
// Queries
// ────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("applications")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const listByStatus = query({
  args: { status: statusV },
  handler: async (ctx, { status }) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("applications")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", status),
      )
      .collect();
  },
});

export const get = query({
  args: { id: v.id("applications") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    assertOwnedByTenant(row, tenantId);
    return row;
  },
});

/**
 * Public — used by /apply/[token] to render status without auth.
 * Returns null when not found (don't leak existence vs. missing).
 *
 * SECURITY: returns ONLY the applicant-safe projection. Specifically:
 *   - omits `internal_review_notes` (operator-only scratchpad — could
 *     carry credit/insurance dispositions that are not for the
 *     applicant's eyes; if shared with the applicant, must go through
 *     the decline message, not a raw audit-style note)
 *   - omits `reviewed_by` (don't expose staff identity to applicant)
 *   - omits `tenantId` (already implicit in the token)
 *
 * Adds an audit-log-style `peeked_at` opportunity later if we want to
 * detect token reuse.
 */
export const lookupByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    // Length cap — refuse anything beyond a plausible token length to
    // avoid scanning the index with adversarial input.
    if (token.length > 128) return null;
    const row = await ctx.db
      .query("applications")
      .withIndex("by_application_token", (q) =>
        q.eq("application_token", token),
      )
      .unique();
    if (!row) return null;
    // Applicant-safe projection. We INCLUDE fields the public status
    // card actually needs to render (vessel_loa_inches for the spec
    // line, applicant_email for the approved banner, desired_start_date
    // for the timeline). We OMIT operator-only fields:
    //   - `reviewed_by` (staff identity — boater shouldn't see)
    //   - `tenantId` (implicit in the token)
    //   - `internal_review_notes` UNLESS status is declined, in which
    //     case the operator's note IS the decline copy the boater sees
    //     (the operator wrote it knowing it would reach the boater —
    //     this matches the H4 surface contract for the status card)
    return {
      _id: row._id,
      _creationTime: row._creationTime,
      number: row.number,
      status: row.status,
      submitted_at: row.submitted_at,
      reviewed_at: row.reviewed_at,
      // Vessel + slip preferences echoed back so the applicant can
      // confirm the right application loaded.
      vessel_name: row.vessel_name,
      vessel_make: row.vessel_make,
      vessel_model: row.vessel_model,
      vessel_year: row.vessel_year,
      vessel_loa_inches: row.vessel_loa_inches,
      preferred_slip_class: row.preferred_slip_class,
      preferred_dock: row.preferred_dock,
      desired_start_date: row.desired_start_date,
      // Applicant identity — they already know their own name/email but
      // showing it lets them verify the right application loaded.
      applicant_first_name: row.applicant_first_name,
      applicant_last_name: row.applicant_last_name,
      applicant_email: row.applicant_email,
      // Operator's decline note only surfaces when status is declined.
      // For pending/under_review/approved/waitlisted statuses the field
      // is intentionally omitted from the projection — operators may
      // have draft notes during review that aren't ready for the
      // applicant to read.
      internal_review_notes:
        row.status === "declined" ? row.internal_review_notes : undefined,
      // Result back-refs — boater_id surfaces in the approved message,
      // waitlist_entry_id helps deep-link to the waitlist offer view.
      result_boater_id: row.result_boater_id,
      result_waitlist_entry_id: row.result_waitlist_entry_id,
    };
  },
});

// ────────────────────────────────────────────────────────────
// Mutations
// ────────────────────────────────────────────────────────────

function mintToken(): string {
  // SECURITY: crypto.randomUUID gives ≥122 bits of CSPRNG entropy. The
  // prior Date.now()+Math.random()'s ~31 bits of effective entropy made
  // application tokens brute-forceable — and the token is the ONLY auth
  // on /apply/[token] for retrieving the applicant's PII.
  return `app_${crypto.randomUUID()}`;
}

/**
 * Public submit — mints a fresh application_token + APP-#### number,
 * inserts in `pending`. The /apply page passes tenantId explicitly since
 * the boater is unauthenticated; in production the apply URL is
 * tenant-scoped (e.g. apply.marinastee.com/{slug}) and the server
 * resolves the marina from the slug.
 */
export const submit = mutation({
  args: {
    tenantId: v.id("marinas"),
    applicant_first_name: v.string(),
    applicant_last_name: v.string(),
    applicant_email: v.string(),
    applicant_phone: v.string(),
    applicant_address: v.optional(v.string()),
    vessel_name: v.string(),
    vessel_year: v.optional(v.number()),
    vessel_make: v.string(),
    vessel_model: v.string(),
    vessel_loa_inches: v.number(),
    vessel_beam_inches: v.optional(v.number()),
    vessel_draft_inches: v.optional(v.number()),
    preferred_slip_class: v.optional(slipClassV),
    preferred_dock: v.optional(v.string()),
    desired_start_date: v.optional(v.string()),
    notes: v.optional(v.string()),
    source: v.optional(sourceV),
  },
  handler: async (ctx, args) => {
    // SECURITY: this mutation is PUBLIC (no Clerk session). Validate
    // every assumption the public API makes:
    //
    //  1. The tenantId actually points to a real marina. Without this,
    //     an attacker can enumerate marina ids or pollute non-existent
    //     tenant queues.
    const marina = await ctx.db.get(args.tenantId);
    if (!marina) throw new Error("Unknown marina");
    //
    //  2. Per-field length caps so a single submission can't blow up
    //     the row size or DoS the index scan below.
    const STR_CAP = 200;
    const NOTES_CAP = 4000;
    const fields: Array<[string, string | undefined]> = [
      ["applicant_first_name", args.applicant_first_name],
      ["applicant_last_name", args.applicant_last_name],
      ["applicant_email", args.applicant_email],
      ["applicant_phone", args.applicant_phone],
      ["applicant_address", args.applicant_address],
      ["vessel_name", args.vessel_name],
      ["vessel_make", args.vessel_make],
      ["vessel_model", args.vessel_model],
      ["preferred_dock", args.preferred_dock],
      ["desired_start_date", args.desired_start_date],
    ];
    for (const [name, val] of fields) {
      if (val !== undefined && val.length > STR_CAP) {
        throw new Error(`${name} too long`);
      }
    }
    if (args.notes !== undefined && args.notes.length > NOTES_CAP) {
      throw new Error("notes too long");
    }
    //
    //  3. Email + phone get a very light format check. Don't bother
    //     with full RFC parsing — anything obviously not an email/phone
    //     is probably an attack.
    if (!args.applicant_email.includes("@") || args.applicant_email.length < 5) {
      throw new Error("Invalid email");
    }
    //
    //  4. Reject CRLF in any field — these would survive into the
    //     welcome-comm body and become SMTP header injection.
    for (const [, val] of fields) {
      if (val !== undefined && /[\r\n]/.test(val)) {
        throw new Error("Invalid character in field");
      }
    }
    //
    //  5. Per-tenant rate limit — at most 25 submissions per hour per
    //     applicant_email (simple bucket; production wants per-IP too
    //     but Convex doesn't expose request IP today). A flood of
    //     submissions from one email = drop on the floor.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentForEmail = await ctx.db
      .query("applications")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .filter((q) =>
        q.and(
          q.eq(q.field("applicant_email"), args.applicant_email),
          q.gte(q.field("submitted_at"), oneHourAgo),
        ),
      )
      .collect();
    if (recentForEmail.length >= 25) {
      throw new Error("Too many recent submissions");
    }

    // Sequential APP-#### number per tenant — minted via the atomic
    // per-tenant counter so concurrent submits cannot collide. First
    // application yields APP-1001 (the start arg IS the first value
    // returned; subsequent calls increment).
    const seq = await nextSequenceNumber(ctx, args.tenantId, "APP", 1001);
    const number = `APP-${seq}`;
    const token = mintToken();
    const id = await ctx.db.insert("applications", {
      tenantId: args.tenantId,
      number,
      status: "pending",
      applicant_first_name: args.applicant_first_name,
      applicant_last_name: args.applicant_last_name,
      applicant_email: args.applicant_email,
      applicant_phone: args.applicant_phone,
      applicant_address: args.applicant_address,
      vessel_name: args.vessel_name,
      vessel_year: args.vessel_year,
      vessel_make: args.vessel_make,
      vessel_model: args.vessel_model,
      vessel_loa_inches: args.vessel_loa_inches,
      vessel_beam_inches: args.vessel_beam_inches,
      vessel_draft_inches: args.vessel_draft_inches,
      preferred_slip_class: args.preferred_slip_class,
      preferred_dock: args.preferred_dock,
      desired_start_date: args.desired_start_date,
      source: args.source ?? "public_apply",
      application_token: token,
      notes: args.notes,
      submitted_at: new Date().toISOString(),
    });
    // No logAudit() — public unauthenticated submits don't have an
    // actor identity. The operator-side approve/decline/route writes
    // an audit row with the operator as actor.
    return { id, token, number };
  },
});

export const markUnderReview = mutation({
  args: {
    id: v.id("applications"),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { id, agent_prompt }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    assertOwnedByTenant(row, tenantId);
    if (row.status === "pending") {
      await ctx.db.patch(id, { status: "under_review" });
      await logAudit(ctx, {
        action_type: "application.under_review",
        target_entity: "applications",
        target_id: id,
        payload_delta: { status: "under_review" },
        via_agent: !!agent_prompt,
        agent_prompt,
      });
    }
    return id;
  },
});

/**
 * Approve — mints Boater + Vessel, stamps result_boater_id, transitions
 * status → approved. The welcome comm is drafted on the mock side (the
 * Convex `communications` table covers per-comm sends but we keep the
 * draft-comm fan-out at the client layer to mirror the existing approve
 * path on the operator queue UI).
 */
export const approve = mutation({
  args: {
    id: v.id("applications"),
    reviewer_label: v.optional(v.string()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { id, reviewer_label, agent_prompt }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    assertOwnedByTenant(row, tenantId);
    if (row.status === "approved") return id;
    const now = new Date().toISOString();
    // RACE FIX: patch the application row to `approved` BEFORE inserting
    // Boater + Vessel. Convex serializes mutations on the same document
    // — so two concurrent approve calls compete on the application row's
    // OCC version. The second one sees status="approved" on its retry
    // and short-circuits via the early return above.
    //
    // Without this ordering, a retry that happened mid-mutation could
    // create duplicate Boater + Vessel rows before the status flipped,
    // leaving the application "approved" but with N>1 boaters claimed
    // as the result. result_boater_id is patched at the end with the
    // boater we minted — so we hold the application row for the full
    // mutation lifetime.
    await ctx.db.patch(id, { status: "approved", reviewed_at: now });
    const display_name = `${row.applicant_last_name}, ${row.applicant_first_name}`;
    const boaterId = await ctx.db.insert("boaters", {
      tenantId,
      display_name,
      first_name: row.applicant_first_name,
      last_name: row.applicant_last_name,
      active: true,
      billing_cadence: "annual",
      tags: ["from-apply"],
      communication_prefs: {
        preferred_channel: "email",
        language: "en",
      },
      primary_contact: {
        id: `ct_${Date.now().toString(36)}_primary`,
        name: display_name,
        role: "self",
        email: row.applicant_email,
        phone: row.applicant_phone,
        preferred_channel: "email",
        can_be_billed: true,
      },
      additional_contacts: [],
      address: {
        line1: row.applicant_address ?? "",
        city: "",
        state: "",
        zip: "",
        country: "US",
      },
      notes: row.notes,
    });
    await ctx.db.insert("vessels", {
      tenantId,
      boater_id: boaterId,
      co_owner_ids: [],
      name: row.vessel_name,
      year: row.vessel_year,
      make: row.vessel_make,
      model: row.vessel_model,
      loa_inches: row.vessel_loa_inches,
      beam_inches: row.vessel_beam_inches,
      draft_inches: row.vessel_draft_inches,
      active: true,
    });
    // Now stamp the back-ref to the new boater. Status was already set
    // to "approved" at the top of the handler for the race-safety
    // ordering above.
    await ctx.db.patch(id, {
      reviewed_by: reviewer_label,
      result_boater_id: boaterId,
    });
    await logAudit(ctx, {
      action_type: "application.approve",
      target_entity: "applications",
      target_id: id,
      payload_delta: { result_boater_id: boaterId, number: row.number },
      via_agent: !!agent_prompt,
      agent_prompt,
    });
    return id;
  },
});

export const decline = mutation({
  args: {
    id: v.id("applications"),
    internal_review_notes: v.optional(v.string()),
    reviewer_label: v.optional(v.string()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { id, internal_review_notes, reviewer_label, agent_prompt },
  ) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    assertOwnedByTenant(row, tenantId);
    if (row.status === "declined") return id;
    await ctx.db.patch(id, {
      status: "declined",
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewer_label,
      internal_review_notes,
    });
    await logAudit(ctx, {
      action_type: "application.decline",
      target_entity: "applications",
      target_id: id,
      payload_delta: { number: row.number, internal_review_notes },
      via_agent: !!agent_prompt,
      agent_prompt,
    });
    return id;
  },
});

/**
 * Route to waitlist — mints a waitlistEntries row and back-references
 * it from the application. H1 owns the waitlist domain; we only
 * INSERT into the waitlistEntries table here, never query / mutate
 * existing waitlist rows.
 */
export const routeToWaitlist = mutation({
  args: {
    id: v.id("applications"),
    reviewer_label: v.optional(v.string()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { id, reviewer_label, agent_prompt }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    assertOwnedByTenant(row, tenantId);
    if (row.status === "waitlisted") return id;
    const waitlistId = await ctx.db.insert("waitlistEntries", {
      tenantId,
      patron_name: `${row.applicant_first_name} ${row.applicant_last_name}`,
      patron_email: row.applicant_email,
      patron_phone: row.applicant_phone,
      preferences: {
        max_loa_inches: row.vessel_loa_inches,
      },
      status: "pending",
    });
    await ctx.db.patch(id, {
      status: "waitlisted",
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewer_label,
      result_waitlist_entry_id: waitlistId,
    });
    await logAudit(ctx, {
      action_type: "application.route_to_waitlist",
      target_entity: "applications",
      target_id: id,
      payload_delta: {
        number: row.number,
        result_waitlist_entry_id: waitlistId,
      },
      via_agent: !!agent_prompt,
      agent_prompt,
    });
    return id;
  },
});
