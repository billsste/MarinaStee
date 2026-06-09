/*
 * Marina Stee — Convex-side agent action dispatchers.
 *
 * Phase 5 of the Convex migration (docs/architecture-convex.md) routes
 * the agent's `executeAgentAction` switch to Convex when the deployment
 * is online. This file is the ONE function per agent-action-kind that
 * the server route (or `lib/use-tenant-mutation.ts`) calls when Convex
 * is enabled.
 *
 * Each dispatcher:
 *   1. Calls `requireTenant(ctx)` — defense-in-depth tenant guard, even
 *      though the underlying per-entity mutations call it too.
 *   2. Delegates to the existing per-entity mutation (workOrders.create,
 *      reservations.update, communications.send, etc.) so the audit-log
 *      row is written EXACTLY ONCE — at the entity-mutation layer, not
 *      duplicated here.
 *   3. Stamps the audit row with `via_agent: true` + the user's
 *      original prompt via `logAudit` — but ONLY in the dispatcher,
 *      since the per-entity mutation already calls logAudit without
 *      the agent provenance. To avoid the double-write we re-implement
 *      the mutation body inline here when the agent path needs to add
 *      the `via_agent` field.
 *
 * The choice of which actions to migrate is documented in
 * docs/architecture-convex.md → Phase 5 status row. Other actions
 * continue to run via the mock client-store until their pages flip
 * (Phase 4 owns those).
 *
 * Wave 1 (migrated):
 *   - update_work_order_status (high-frequency agent action)
 *   - create_work_order        (visible kanban update — needs realtime)
 *   - create_reservation       (dock map needs realtime occupancy)
 *   - update_reservation       (same)
 *   - send_communication       (audit-trail critical)
 *
 * Wave 2 (this file):
 *   - update_boater            (contact / cadence / notes / active)
 *   - create_boater            (new customer record)
 *   - update_vessel            (boat profile edits)
 *   - update_contract          (status / rate / dates)
 *   - charge_to_account        (POS → ledger invoice — money-critical)
 *   - request_coi_renewal      (mint upload token + ask boater)
 *   - close_boat_rental        (finalize rental checkin)
 *   - create_meter_reading     (utility billing input — audit critical)
 */

import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { api } from "./_generated/api";
import {
  assertOwnedByTenant,
  logAudit,
  nextSequenceNumber,
  requireTenant,
} from "./_helpers";
import { runWorkOrderCloseout, shouldFireCloseout } from "./_closeout";

// Shared shapes for the W3 bulk dispatchers — kept here (not in the
// per-feature modules) because they're the agent-router-facing surface,
// not the operator-wizard surface. The bulk modules in
// convex/bulkBilling.ts / bulkRenewals.ts / bulkComms.ts use a richer
// shape (`period: {ym}` nested, camelCase) suited to their own
// preview/execute UI — the dispatchers below translate the
// router-flat shape into that.
const bulkChargeRuleV = v.union(
  v.literal("annual_due_this_month"),
  v.literal("monthly_installment"),
  v.literal("seasonal_due_this_month"),
);
const bulkCommsFilterV = v.union(
  v.object({ kind: v.literal("all_boaters") }),
  v.object({
    kind: v.literal("cadence"),
    cadence: v.union(
      v.literal("annual"),
      v.literal("seasonal"),
      v.literal("monthly"),
      v.literal("transient"),
    ),
  }),
  v.object({ kind: v.literal("vessel_loa_over"), inches: v.number() }),
  v.object({ kind: v.literal("has_open_balance") }),
);

// ────────────────────────────────────────────────────────────
// Shared value shapes
// ────────────────────────────────────────────────────────────

const woStatusV = v.union(
  v.literal("open"),
  v.literal("scheduled"),
  v.literal("in_progress"),
  v.literal("blocked"),
  v.literal("completed"),
  v.literal("cancelled"),
);

const woPriorityV = v.union(
  v.literal("low"),
  v.literal("normal"),
  v.literal("high"),
  v.literal("urgent"),
);

const woActivityV = v.union(
  v.literal("winterization"),
  v.literal("bottom_paint"),
  v.literal("service"),
  v.literal("inspection"),
  v.literal("haul_out"),
  v.literal("pump_out"),
  v.literal("task"),
  v.literal("other"),
);

const channelV = v.union(
  v.literal("email"),
  v.literal("sms"),
  v.literal("voice"),
);

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

// ────────────────────────────────────────────────────────────
// Agent-prompt provenance — every dispatcher takes this so the
// audit row records "what the operator said".
// ────────────────────────────────────────────────────────────

const provenanceV = v.object({
  agent_prompt: v.optional(v.string()),
});

// ────────────────────────────────────────────────────────────
// 1. update_work_order_status — flip a WO's lifecycle bits
// ────────────────────────────────────────────────────────────

export const updateWorkOrderStatus = mutation({
  args: {
    id: v.id("workOrders"),
    patch: v.object({
      status: v.optional(woStatusV),
      priority: v.optional(woPriorityV),
      assignee_user_id: v.optional(v.string()),
      due_date: v.optional(v.string()),
    }),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, { id, patch, provenance }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "work_order.update",
      target_entity: "workOrders",
      target_id: id,
      payload_delta: patch,
      via_agent: true,
      agent_prompt: provenance?.agent_prompt,
    });
    // Closeout chain — when status transitions to "completed" (and the
    // WO hasn't already been closed out), runWorkOrderCloseout drives
    // the Quote → Invoice → Ledger → Comm → Vessel-stamp fan-out.
    // Implementation lives in convex/_closeout.ts; mirrors lib/wo-closeout.ts
    // step-for-step. Idempotent via the `closed_out_at` stamp.
    if (shouldFireCloseout(before, patch.status)) {
      await runWorkOrderCloseout(ctx, {
        woId: id,
        tenantId,
        todayIso: new Date().toISOString(),
      });
    }
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// 2. create_work_order
// ────────────────────────────────────────────────────────────

export const createWorkOrder = mutation({
  args: {
    boater_id: v.id("boaters"),
    subject: v.string(),
    description: v.optional(v.string()),
    activity_type: v.optional(woActivityV),
    priority: v.optional(woPriorityV),
    vessel_id: v.optional(v.id("vessels")),
    slip_id: v.optional(v.id("slips")),
    due_date: v.optional(v.string()),
    assignee_user_id: v.optional(v.string()),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    // Atomic counter — shared with workOrders.create so both paths
    // mint from the same sequence without colliding.
    const seq = await nextSequenceNumber(ctx, tenantId, "WO", 1001);
    const number = `WO-${String(seq).padStart(4, "0")}`;
    const id = await ctx.db.insert("workOrders", {
      tenantId,
      number,
      boater_id: args.boater_id,
      vessel_id: args.vessel_id,
      slip_id: args.slip_id,
      subject: args.subject,
      description: args.description,
      status: "open",
      priority: args.priority ?? "normal",
      assignee_user_id: args.assignee_user_id,
      activity_type: args.activity_type ?? "other",
      due_date: args.due_date,
    });
    await logAudit(ctx, {
      action_type: "work_order.create",
      target_entity: "workOrders",
      target_id: id,
      payload_delta: { number, subject: args.subject },
      via_agent: true,
      agent_prompt: args.provenance?.agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// 3. create_reservation
// ────────────────────────────────────────────────────────────

export const createReservation = mutation({
  args: {
    boater_id: v.id("boaters"),
    slip_id: v.id("slips"),
    vessel_id: v.optional(v.id("vessels")),
    arrival_date: v.string(),
    departure_date: v.string(),
    type: reservationTypeV,
    nightly_rate: v.optional(v.number()),
    notes: v.optional(v.string()),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
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
      via_agent: true,
      agent_prompt: args.provenance?.agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// 4. update_reservation
// ────────────────────────────────────────────────────────────

export const updateReservation = mutation({
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
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, { id, patch, provenance }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "reservation.update",
      target_entity: "reservations",
      target_id: id,
      payload_delta: patch,
      via_agent: true,
      agent_prompt: provenance?.agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// 5. send_communication
// ────────────────────────────────────────────────────────────

export const sendCommunication = mutation({
  args: {
    boater_id: v.optional(v.id("boaters")),
    type: channelV,
    subject: v.optional(v.string()),
    body: v.string(),
    related_entity: v.optional(
      v.object({ type: v.string(), id: v.string() }),
    ),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    // Resolve recipient from boater contact info (mirrors
    // communications.send so the agent path and UI path produce
    // identical rows).
    let recipient = "—";
    let senderLabel = "Marina Stee";
    if (args.boater_id) {
      const boater = await ctx.db.get(args.boater_id);
      assertOwnedByTenant(boater, tenantId);
      recipient =
        args.type === "email"
          ? boater.primary_contact.email ?? "—"
          : boater.primary_contact.phone ?? "—";
    }
    const marina = await ctx.db.get(tenantId);
    if (marina) {
      senderLabel =
        args.type === "sms"
          ? marina.outbound_sms_sender_label
          : marina.outbound_email_from_name;
    }
    const id = await ctx.db.insert("communications", {
      tenantId,
      boater_id: args.boater_id,
      type: args.type,
      direction: "outbound",
      subject: args.subject,
      body_preview: args.body.slice(0, 200),
      body_full: args.body,
      sender_label: senderLabel,
      sender_is_system: true,
      recipient,
      sent_at: new Date().toISOString(),
      // Insert as "queued"; the scheduled dispatch action (below) flips
      // to "delivered" or "failed" once Postmark/Twilio responds. Two-
      // phase so the UI's timeline shows the row instantly while the
      // network call resolves async.
      status: "queued",
      related_entity: args.related_entity,
    });
    await logAudit(ctx, {
      action_type: "comm.send",
      target_entity: "communications",
      target_id: id,
      payload_delta: { type: args.type, boater_id: args.boater_id },
      via_agent: true,
      agent_prompt: args.provenance?.agent_prompt,
    });
    // Fire-and-forget the outbound dispatch. Convex's scheduler runs
    // the action AFTER this mutation commits — failure inside
    // dispatchOne only affects this row's delivery bookkeeping, never
    // the calling agent action's audit row. See
    // convex/communications.ts → dispatchOne for the network call.
    await ctx.scheduler.runAfter(0, api.communications.dispatchOne, {
      commId: id,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// Wave 2 — shared value shapes
// ────────────────────────────────────────────────────────────

const cadenceV = v.union(
  v.literal("annual"),
  v.literal("seasonal"),
  v.literal("monthly"),
  v.literal("transient"),
);

const channelPrefV = v.union(
  v.literal("email"),
  v.literal("sms"),
  v.literal("voice"),
);

const contractStatusV = v.union(
  v.literal("draft"),
  v.literal("sent"),
  v.literal("signed"),
  v.literal("active"),
  v.literal("expired"),
  v.literal("terminated"),
);

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

// ────────────────────────────────────────────────────────────
// 6. update_boater — contact / cadence / notes / active
// ────────────────────────────────────────────────────────────

export const updateBoater = mutation({
  args: {
    id: v.id("boaters"),
    patch: v.object({
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      preferred_channel: v.optional(channelPrefV),
      billing_cadence: v.optional(cadenceV),
      notes: v.optional(v.string()),
      active: v.optional(v.boolean()),
    }),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, { id, patch, provenance }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    // The boater row has nested objects (primary_contact +
    // communication_prefs) so a flat patch from the agent has to be
    // re-shaped before ctx.db.patch. Mirrors lib/agent-actions.ts →
    // update_boater branch so both paths produce identical rows.
    const dbPatch: Record<string, unknown> = {};
    if (patch.preferred_channel !== undefined) {
      dbPatch.communication_prefs = {
        ...before.communication_prefs,
        preferred_channel: patch.preferred_channel,
      };
      dbPatch.primary_contact = {
        ...before.primary_contact,
        preferred_channel: patch.preferred_channel,
      };
    }
    if (patch.email !== undefined) {
      dbPatch.primary_contact = {
        ...((dbPatch.primary_contact as typeof before.primary_contact) ??
          before.primary_contact),
        email: patch.email,
      };
    }
    if (patch.phone !== undefined) {
      dbPatch.primary_contact = {
        ...((dbPatch.primary_contact as typeof before.primary_contact) ??
          before.primary_contact),
        phone: patch.phone,
      };
    }
    if (patch.billing_cadence !== undefined)
      dbPatch.billing_cadence = patch.billing_cadence;
    if (patch.notes !== undefined) dbPatch.notes = patch.notes;
    if (patch.active !== undefined) dbPatch.active = patch.active;
    await ctx.db.patch(id, dbPatch);
    await logAudit(ctx, {
      action_type: "boater.update",
      target_entity: "boaters",
      target_id: id,
      payload_delta: patch,
      via_agent: true,
      agent_prompt: provenance?.agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// 7. create_boater
// ────────────────────────────────────────────────────────────

export const createBoater = mutation({
  args: {
    first_name: v.string(),
    last_name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    preferred_channel: channelPrefV,
    billing_cadence: cadenceV,
    code: v.optional(v.string()),
    notes: v.optional(v.string()),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const display_name = `${args.last_name}, ${args.first_name}`;
    const id = await ctx.db.insert("boaters", {
      tenantId,
      display_name,
      first_name: args.first_name,
      last_name: args.last_name,
      code: args.code,
      active: true,
      billing_cadence: args.billing_cadence,
      tags: [],
      communication_prefs: {
        preferred_channel: args.preferred_channel,
        language: "en",
      },
      primary_contact: {
        id: `ct_${Date.now().toString(36)}_primary`,
        name: display_name,
        role: "self",
        email: args.email,
        phone: args.phone,
        preferred_channel: args.preferred_channel,
        can_be_billed: true,
      },
      additional_contacts: [],
      address: {
        line1: "",
        city: "",
        state: "",
        zip: "",
        country: "US",
      },
      notes: args.notes,
    });
    await logAudit(ctx, {
      action_type: "boater.create",
      target_entity: "boaters",
      target_id: id,
      payload_delta: { display_name, billing_cadence: args.billing_cadence },
      via_agent: true,
      agent_prompt: args.provenance?.agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// 8. update_vessel
// ────────────────────────────────────────────────────────────

export const updateVessel = mutation({
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
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, { id, patch, provenance }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "vessel.update",
      target_entity: "vessels",
      target_id: id,
      payload_delta: patch,
      via_agent: true,
      agent_prompt: provenance?.agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// 9. update_contract — status / rate / dates
// ────────────────────────────────────────────────────────────

export const updateContract = mutation({
  args: {
    id: v.id("contracts"),
    patch: v.object({
      status: v.optional(contractStatusV),
      annual_rate: v.optional(v.number()),
      effective_start: v.optional(v.string()),
      effective_end: v.optional(v.string()),
      signed_by_name: v.optional(v.string()),
      drafted_body_markdown: v.optional(v.string()),
    }),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, { id, patch, provenance }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "contract.update",
      target_entity: "contracts",
      target_id: id,
      payload_delta: patch,
      via_agent: true,
      agent_prompt: provenance?.agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// 10. charge_to_account — POS sale charged to a boater's account
//
// Money-critical: creates an open invoice in ledgerEntries. Mirrors
// convex/ledger.ts → chargeToAccount but threads the agent provenance
// through the audit row. We don't delegate to ledger.chargeToAccount
// because that would log without via_agent.
// ────────────────────────────────────────────────────────────

export const chargeToAccount = mutation({
  args: {
    boater_id: v.id("boaters"),
    location_id: v.id("posLocations"),
    line: v.object({
      name: v.string(),
      price: v.number(),
      sku: v.string(),
    }),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, { boater_id, location_id, line, provenance }) => {
    const tenantId = await requireTenant(ctx);
    const boater = await ctx.db.get(boater_id);
    assertOwnedByTenant(boater, tenantId);
    const location = await ctx.db.get(location_id);
    assertOwnedByTenant(location, tenantId);
    const subtotal = line.price;
    const tax = Math.round(subtotal * location.default_tax_rate * 100) / 100;
    const total = subtotal + tax;
    const now = new Date().toISOString();
    const seq = await nextSequenceNumber(ctx, tenantId, "INV", 2001);
    const number = `INV-${String(seq).padStart(4, "0")}`;
    const invoiceId = await ctx.db.insert("ledgerEntries", {
      tenantId,
      boater_id,
      type: "invoice",
      number,
      date: now.slice(0, 10),
      amount: total,
      open_balance: total,
      status: "open",
      line_items: [{ description: line.name, amount: subtotal }],
    });
    await logAudit(ctx, {
      action_type: "ledger.charge_to_account",
      target_entity: "ledgerEntries",
      target_id: invoiceId,
      payload_delta: { boater_id, amount: total, item: line.name },
      via_agent: true,
      agent_prompt: provenance?.agent_prompt,
    });
    return invoiceId;
  },
});

// ────────────────────────────────────────────────────────────
// 11. request_coi_renewal — mint upload token + flag the COI row
//
// Mirrors convex/insurance.ts → requestRenewal but threads agent
// provenance. The returned token would normally be paired with an
// outbound comm to the boater; that part lives in lib/client-store
// → requestCoiRenewal on the mock path and will be wired into the
// comms dispatcher in a future wave.
// ────────────────────────────────────────────────────────────

export const requestCoiRenewal = mutation({
  args: {
    id: v.id("insuranceCertificates"),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, { id, provenance }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    const token = `coi_${id}_${Date.now().toString(36)}`;
    await ctx.db.patch(id, { upload_token: token });
    await logAudit(ctx, {
      action_type: "coi.request_renewal",
      target_entity: "insuranceCertificates",
      target_id: id,
      payload_delta: { token },
      via_agent: true,
      agent_prompt: provenance?.agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// 12. close_boat_rental — finalize checkin + flip status to closed
// ────────────────────────────────────────────────────────────

export const closeBoatRental = mutation({
  args: {
    id: v.id("boatRentals"),
    fuel_in_pct: v.optional(v.number()),
    hours_in: v.optional(v.number()),
    damage_notes: v.optional(v.string()),
    damage_charge: v.optional(v.number()),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, { id, provenance, ...checkin }) => {
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
      via_agent: true,
      agent_prompt: provenance?.agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// 13. create_meter_reading — utility reading for billing input
//
// The reading carries both current + previous so downstream billing
// can compute deltas without re-querying. When the agent doesn't
// know the prev_reading we fall back to the most recent reading
// on the same slip — matches the mock path's behavior.
// ────────────────────────────────────────────────────────────

export const createMeterReading = mutation({
  args: {
    space_id: v.id("slips"),
    meter_number: v.optional(v.string()),
    current_reading: v.number(),
    unit: v.optional(v.union(v.literal("kWh"), v.literal("gallons"))),
    rate_per_unit: v.optional(v.number()),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const slip = await ctx.db.get(args.space_id);
    assertOwnedByTenant(slip, tenantId);
    // Pull the most recent reading on this slip so prev_* stays
    // accurate without the agent having to supply it.
    const priorRows = await ctx.db
      .query("meterReadings")
      .withIndex("by_tenant_space", (q) =>
        q.eq("tenantId", tenantId).eq("space_id", args.space_id),
      )
      .collect();
    const last = priorRows
      .slice()
      .sort((a, b) => b.current_ts.localeCompare(a.current_ts))[0];
    const now = new Date().toISOString();
    const id = await ctx.db.insert("meterReadings", {
      tenantId,
      space_id: args.space_id,
      meter_number:
        args.meter_number ?? last?.meter_number ?? slip.number,
      current_reading: args.current_reading,
      current_ts: now,
      prev_reading: last?.current_reading ?? args.current_reading,
      prev_ts: last?.current_ts ?? now,
      unit: args.unit ?? last?.unit,
      rate_per_unit: args.rate_per_unit ?? last?.rate_per_unit,
    });
    await logAudit(ctx, {
      action_type: "meter.record",
      target_entity: "meterReadings",
      target_id: id,
      payload_delta: {
        slip: slip.number,
        delta:
          args.current_reading -
          (last?.current_reading ?? args.current_reading),
      },
      via_agent: true,
      agent_prompt: args.provenance?.agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// Wave 3 — shared value shapes
// ────────────────────────────────────────────────────────────

const quoteLineKindV = v.union(
  v.literal("part"),
  v.literal("labor"),
  v.literal("fee"),
  v.literal("discount"),
);

const agentQuoteLineV = v.object({
  kind: quoteLineKindV,
  description: v.string(),
  qty: v.number(),
  unit_price: v.number(),
  taxable: v.boolean(),
});

const insuranceStatusV = v.union(
  v.literal("active"),
  v.literal("expiring_soon"),
  v.literal("expired"),
  v.literal("lapsed"),
);

const fuelTypeAgentV = v.union(
  v.literal("gasoline"),
  v.literal("diesel"),
);

const fuelPaymentMethodV = v.union(
  v.literal("card"),
  v.literal("cash"),
  v.literal("charge_to_account"),
);

const ledgerEntryAgentTypeV = v.union(
  v.literal("invoice"),
  v.literal("credit"),
  v.literal("adjustment"),
);

const paymentMethodAgentV = v.union(
  v.literal("cash"),
  v.literal("check"),
  v.literal("ach"),
  v.literal("card"),
);

const cadenceAgentV = v.union(
  v.literal("annual"),
  v.literal("seasonal"),
  v.literal("monthly"),
  v.literal("transient"),
);

// ────────────────────────────────────────────────────────────
// 14. mark_signed — stamp a contract OR quote as signed
//
// Two sub-kinds because contracts + quotes live in different tables
// with separate lifecycle flags. We share one dispatcher so the agent
// can pass through a uniform `{ target_kind, target_id }` pair.
// ────────────────────────────────────────────────────────────

export const markSigned = mutation({
  args: {
    target_kind: v.union(v.literal("contract"), v.literal("quote")),
    target_id: v.string(),                 // narrowed at runtime by branch
    signed_by_name: v.optional(v.string()),
    signed_at: v.optional(v.string()),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const now = args.signed_at ?? new Date().toISOString();
    if (args.target_kind === "contract") {
      // Cast through unknown — agent passes the id as a string; we
      // narrow it to the Convex Id at the boundary. ctx.db.get returns
      // null when the id doesn't match the table type, which the
      // tenant guard catches.
      const contractId = args.target_id as unknown as import("./_generated/dataModel").Id<"contracts">;
      const before = await ctx.db.get(contractId);
      assertOwnedByTenant(before, tenantId);
      await ctx.db.patch(contractId, {
        status: "signed",
        signed_at: now,
        signed_by_name: args.signed_by_name,
      });
      await logAudit(ctx, {
        action_type: "contract.mark_signed",
        target_entity: "contracts",
        target_id: contractId,
        payload_delta: { signed_at: now, signed_by_name: args.signed_by_name },
        via_agent: true,
        agent_prompt: args.provenance?.agent_prompt,
      });
      return contractId;
    }
    // Quote branch — patch the quote row directly. The
    // signedForSignature mutation in convex/quotes.ts handles the
    // "send" path; this dispatcher covers the "mark signed without
    // re-sending" admin override.
    const quoteId = args.target_id as unknown as import("./_generated/dataModel").Id<"quotes">;
    const before = await ctx.db.get(quoteId);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(quoteId, {
      status: "signed",
      signed_at: now,
      signed_by_name: args.signed_by_name,
    });
    await logAudit(ctx, {
      action_type: "quote.mark_signed",
      target_entity: "quotes",
      target_id: quoteId,
      payload_delta: { signed_at: now, signed_by_name: args.signed_by_name },
      via_agent: true,
      agent_prompt: args.provenance?.agent_prompt,
    });
    return quoteId;
  },
});

// ────────────────────────────────────────────────────────────
// 15. mark_invoice_paid — apply a manual payment against an invoice
//
// Out-of-band payments (checks, wire transfers, cash) that didn't flow
// through a card-on-file. Creates a payment ledger row + drops the
// invoice's open_balance accordingly. Same fan-out as ledger.recordPayment
// but with explicit invoice targeting.
// ────────────────────────────────────────────────────────────

export const markInvoicePaid = mutation({
  args: {
    invoice_id: v.id("ledgerEntries"),
    amount: v.number(),
    method: paymentMethodAgentV,
    check_number: v.optional(v.string()),
    notes: v.optional(v.string()),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const invoice = await ctx.db.get(args.invoice_id);
    assertOwnedByTenant(invoice, tenantId);
    if (invoice.type !== "invoice") {
      throw new Error("Target ledger entry is not an invoice");
    }
    const now = new Date().toISOString();
    const seq = await nextSequenceNumber(ctx, tenantId, "PMT", 1001);
    const number = `PMT-${String(seq).padStart(4, "0")}`;
    const paymentId = await ctx.db.insert("ledgerEntries", {
      tenantId,
      boater_id: invoice.boater_id,
      type: "payment",
      number,
      date: now.slice(0, 10),
      amount: args.amount,
      open_balance: 0,
      method: args.method,
      status: "paid",
      applied_to_invoice_ids: [args.invoice_id],
      refund_notes: args.notes,
    });
    // Apply against the invoice — clamp to the open balance so an
    // over-payment doesn't create a negative number on the row.
    const apply = Math.min(args.amount, invoice.open_balance);
    const newOpen = invoice.open_balance - apply;
    await ctx.db.patch(args.invoice_id, {
      open_balance: newOpen,
      status: newOpen <= 0 ? "paid" : "partial",
    });
    await logAudit(ctx, {
      action_type: "invoice.mark_paid",
      target_entity: "ledgerEntries",
      target_id: paymentId,
      payload_delta: {
        invoice_id: args.invoice_id,
        amount: args.amount,
        method: args.method,
      },
      via_agent: true,
      agent_prompt: args.provenance?.agent_prompt,
    });
    return paymentId;
  },
});

// ────────────────────────────────────────────────────────────
// 16. update_insurance — patch a COI row
//
// The agent passes the mock-side `liability_limit` field name; we map
// it to `coverage_amount` here because the Convex schema picked that
// single name for the canonical coverage figure (lib/types.ts splits
// liability + hull but Convex doesn't carry hull yet).
// ────────────────────────────────────────────────────────────

export const updateInsurance = mutation({
  args: {
    id: v.id("insuranceCertificates"),
    patch: v.object({
      carrier: v.optional(v.string()),
      policy_number: v.optional(v.string()),
      effective_start: v.optional(v.string()),
      effective_end: v.optional(v.string()),
      liability_limit: v.optional(v.number()),
      status: v.optional(insuranceStatusV),
    }),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, { id, patch, provenance }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    const dbPatch: Record<string, unknown> = {};
    if (patch.carrier !== undefined) dbPatch.carrier = patch.carrier;
    if (patch.policy_number !== undefined)
      dbPatch.policy_number = patch.policy_number;
    if (patch.effective_start !== undefined)
      dbPatch.effective_start = patch.effective_start;
    if (patch.effective_end !== undefined)
      dbPatch.effective_end = patch.effective_end;
    if (patch.liability_limit !== undefined)
      // Map mock-side name → Convex-side name. See convex/insurance.ts
      // for the canonical field.
      dbPatch.coverage_amount = patch.liability_limit;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    await ctx.db.patch(id, dbPatch);
    await logAudit(ctx, {
      action_type: "coi.update",
      target_entity: "insuranceCertificates",
      target_id: id,
      payload_delta: patch,
      via_agent: true,
      agent_prompt: provenance?.agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// 17. record_fuel_sale — append a fuelSales row + bump inventory down
//
// Mirrors convex/fuel.ts but the agent-side action carries the gallons
// + price as flat fields. We compute total here so the ledger row +
// fuelSales row both agree on the same number. Inventory drawdown
// matches logDelivery's bump-up semantics for symmetry.
// ────────────────────────────────────────────────────────────

export const recordFuelSale = mutation({
  args: {
    fuel_type: fuelTypeAgentV,
    gallons: v.number(),
    price_per_gallon: v.number(),
    payment_method: fuelPaymentMethodV,
    boater_id: v.optional(v.id("boaters")),
    sold_at: v.optional(v.string()),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const total =
      Math.round(args.gallons * args.price_per_gallon * 100) / 100;
    const soldAt = args.sold_at ?? new Date().toISOString();
    // If charge-to-account, the boater must exist + be in-tenant.
    if (args.payment_method === "charge_to_account" && !args.boater_id) {
      throw new Error("boater_id required when payment_method=charge_to_account");
    }
    if (args.boater_id) {
      const boater = await ctx.db.get(args.boater_id);
      assertOwnedByTenant(boater, tenantId);
    }
    const id = await ctx.db.insert("fuelSales", {
      tenantId,
      fuel_type: args.fuel_type,
      gallons: args.gallons,
      price_per_gallon: args.price_per_gallon,
      total,
      payment_method: args.payment_method,
      boater_id: args.boater_id,
      sold_at: soldAt,
    });
    // Draw down inventory by the gallons sold so the dashboard stays
    // accurate. Matches logDelivery's bump-up. When inventory isn't
    // seeded yet (test deployments), skip silently.
    const inv = await ctx.db
      .query("fuelInventory")
      .withIndex("by_tenant_fuel", (q) =>
        q.eq("tenantId", tenantId).eq("fuel_type", args.fuel_type),
      )
      .unique();
    if (inv) {
      await ctx.db.patch(inv._id, {
        current_gallons: Math.max(0, inv.current_gallons - args.gallons),
      });
    }
    await logAudit(ctx, {
      action_type: "fuel.sale",
      target_entity: "fuelSales",
      target_id: id,
      payload_delta: {
        fuel: args.fuel_type,
        gallons: args.gallons,
        total,
      },
      via_agent: true,
      agent_prompt: args.provenance?.agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// 18. create_quote — draft a new quote tied to a work order
//
// Mirrors quotes.createDraft but the agent-side action carries the
// line_items inline. Subtotal / tax / total computed here so the
// stored row + the wire payload don't drift.
// ────────────────────────────────────────────────────────────

export const createQuote = mutation({
  args: {
    work_order_id: v.id("workOrders"),
    line_items: v.array(agentQuoteLineV),
    tax_rate: v.optional(v.number()),
    valid_until: v.optional(v.string()),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const wo = await ctx.db.get(args.work_order_id);
    assertOwnedByTenant(wo, tenantId);
    const lines = args.line_items.map((l, i) => ({
      id: `q_line_${Date.now().toString(36)}_${i}`,
      kind: l.kind,
      description: l.description,
      qty: l.qty,
      unit_price: l.unit_price,
      total: Math.round(l.qty * l.unit_price * 100) / 100,
      taxable: l.taxable,
    }));
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const tax = Math.round(subtotal * (args.tax_rate ?? 0) * 100) / 100;
    const total = subtotal + tax;
    const seq = await nextSequenceNumber(ctx, tenantId, "Q", 1001);
    const number = `Q-${String(seq).padStart(4, "0")}`;
    const id = await ctx.db.insert("quotes", {
      tenantId,
      number,
      work_order_id: args.work_order_id,
      line_items: lines,
      subtotal,
      tax,
      total,
      status: "draft",
      valid_until: args.valid_until,
    });
    // Link the WO back so the detail page surfaces the new quote.
    await ctx.db.patch(args.work_order_id, { quote_id: id });
    await logAudit(ctx, {
      action_type: "quote.create",
      target_entity: "quotes",
      target_id: id,
      payload_delta: { number, total },
      via_agent: true,
      agent_prompt: args.provenance?.agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// 19. update_quote — patch a draft quote's lines / tax / expiry
//
// Sent / signed quotes are immutable on this path — the operator has
// to clone-and-edit through the UI which mints a new quote_id. Matches
// quotes.updateLines but adds tax_rate + valid_until patches.
// ────────────────────────────────────────────────────────────

export const updateQuote = mutation({
  args: {
    id: v.id("quotes"),
    line_items: v.optional(v.array(agentQuoteLineV)),
    tax_rate: v.optional(v.number()),
    valid_until: v.optional(v.string()),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, { id, line_items, tax_rate, valid_until, provenance }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    if (before.status !== "draft") {
      throw new Error("Only draft quotes can be edited");
    }
    const dbPatch: Record<string, unknown> = {};
    if (line_items !== undefined) {
      const lines = line_items.map((l, i) => ({
        id: `q_line_${Date.now().toString(36)}_${i}`,
        kind: l.kind,
        description: l.description,
        qty: l.qty,
        unit_price: l.unit_price,
        total: Math.round(l.qty * l.unit_price * 100) / 100,
        taxable: l.taxable,
      }));
      const subtotal = lines.reduce((s, l) => s + l.total, 0);
      const effectiveTaxRate = tax_rate ?? 0;
      const tax = Math.round(subtotal * effectiveTaxRate * 100) / 100;
      dbPatch.line_items = lines;
      dbPatch.subtotal = subtotal;
      dbPatch.tax = tax;
      dbPatch.total = subtotal + tax;
    } else if (tax_rate !== undefined) {
      // Tax-rate-only patch — recompute against existing lines.
      const subtotal = before.line_items.reduce((s, l) => s + l.total, 0);
      const tax = Math.round(subtotal * tax_rate * 100) / 100;
      dbPatch.tax = tax;
      dbPatch.total = subtotal + tax;
    }
    if (valid_until !== undefined) dbPatch.valid_until = valid_until;
    await ctx.db.patch(id, dbPatch);
    await logAudit(ctx, {
      action_type: "quote.update",
      target_entity: "quotes",
      target_id: id,
      payload_delta: { line_count: line_items?.length, tax_rate },
      via_agent: true,
      agent_prompt: provenance?.agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// 20. void_contract — stamp a draft as voided
//
// Distinct from contracts.terminate (which acts on active contracts and
// triggers slip + waitlist fan-out). Void is "this draft never existed"
// — we don't free the slip because the draft never held one. We DO
// patch the contract status to "terminated" since that's the closest
// available enum value, and stash the reason in drafted_body_markdown.
// ────────────────────────────────────────────────────────────

export const voidContract = mutation({
  args: {
    id: v.id("contracts"),
    reason: v.optional(v.string()),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, { id, reason, provenance }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, {
      status: "terminated",
      drafted_body_markdown: reason ? `[Voided] ${reason}` : "[Voided]",
    });
    await logAudit(ctx, {
      action_type: "contract.void",
      target_entity: "contracts",
      target_id: id,
      payload_delta: { reason },
      via_agent: true,
      agent_prompt: provenance?.agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// 21. cancel_reservation — flip a reservation to cancelled
//
// Single-field update + audit stamp. The mock-side branch was already
// in runAction; this brings the audit + tenant-guard to the Convex
// side. Slip release fan-out lives in reservations.cancel for the
// operator-driven path; this dispatcher delegates none of that since
// the agent action carries only the cancellation intent.
// ────────────────────────────────────────────────────────────

export const cancelReservation = mutation({
  args: {
    id: v.id("reservations"),
    reason: v.optional(v.string()),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, { id, reason, provenance }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, {
      status: "cancelled",
      notes: reason
        ? before.notes
          ? `${before.notes}\n[Cancelled] ${reason}`
          : `[Cancelled] ${reason}`
        : before.notes,
    });
    await logAudit(ctx, {
      action_type: "reservation.cancel",
      target_entity: "reservations",
      target_id: id,
      payload_delta: { reason },
      via_agent: true,
      agent_prompt: provenance?.agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// 22. create_ledger_entry — manual invoice / credit / adjustment
//
// Operator records a one-off charge or credit that doesn't flow through
// POS / contracts. The line_items array is built from the single
// description + amount the agent provides; multi-line manual entries
// go through the UI's dedicated editor (not exposed to the agent).
// ────────────────────────────────────────────────────────────

export const createLedgerEntry = mutation({
  args: {
    boater_id: v.id("boaters"),
    type: ledgerEntryAgentTypeV,
    amount: v.number(),
    description: v.string(),
    date: v.optional(v.string()),
    notes: v.optional(v.string()),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const boater = await ctx.db.get(args.boater_id);
    assertOwnedByTenant(boater, tenantId);
    const date = args.date ?? new Date().toISOString().slice(0, 10);
    // Invoices carry an open balance; credits + adjustments don't.
    const openBalance = args.type === "invoice" ? args.amount : 0;
    const status = args.type === "invoice" ? "open" : "paid";
    const number =
      args.type === "invoice"
        ? `INV-${String(await nextSequenceNumber(ctx, tenantId, "INV", 2001)).padStart(4, "0")}`
        : undefined;
    const id = await ctx.db.insert("ledgerEntries", {
      tenantId,
      boater_id: args.boater_id,
      type: args.type,
      number,
      date,
      amount: args.amount,
      open_balance: openBalance,
      status,
      line_items: [{ description: args.description, amount: args.amount }],
      refund_notes: args.notes,
    });
    await logAudit(ctx, {
      action_type: `ledger.${args.type}`,
      target_entity: "ledgerEntries",
      target_id: id,
      payload_delta: {
        boater_id: args.boater_id,
        amount: args.amount,
        description: args.description,
      },
      via_agent: true,
      agent_prompt: args.provenance?.agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// 23. draft_contract — explicit "create a fresh draft" intent
//
// Same body shape as contracts.create — the only reason this exists as
// a distinct dispatcher is so the audit trail records "draft_contract"
// (operator wanted a draft, not a fully-bound contract). Useful for
// downstream analytics that distinguish operator intent.
// ────────────────────────────────────────────────────────────

export const draftContract = mutation({
  args: {
    boater_id: v.id("boaters"),
    template_id: v.id("contractTemplates"),
    vessel_id: v.optional(v.id("vessels")),
    slip_id: v.optional(v.id("slips")),
    effective_start: v.string(),
    effective_end: v.string(),
    annual_rate: v.optional(v.number()),
    billing_cadence: cadenceAgentV,
    notes: v.optional(v.string()),
    provenance: v.optional(provenanceV),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const boater = await ctx.db.get(args.boater_id);
    assertOwnedByTenant(boater, tenantId);
    const template = await ctx.db.get(args.template_id);
    assertOwnedByTenant(template, tenantId);
    const seq = await nextSequenceNumber(ctx, tenantId, "K", 3001);
    const number = `K-${String(seq).padStart(4, "0")}`;
    const id = await ctx.db.insert("contracts", {
      tenantId,
      number,
      boater_id: args.boater_id,
      template_id: args.template_id,
      template_version: 1,
      vessel_id: args.vessel_id,
      slip_id: args.slip_id,
      status: "draft",
      effective_start: args.effective_start,
      effective_end: args.effective_end,
      annual_rate: args.annual_rate,
      billing_cadence: args.billing_cadence,
      drafted_body_markdown: args.notes,
      drafted_at: new Date().toISOString(),
    });
    await logAudit(ctx, {
      action_type: "contract.draft",
      target_entity: "contracts",
      target_id: id,
      payload_delta: { number, boater_id: args.boater_id },
      via_agent: true,
      agent_prompt: args.provenance?.agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// W3 wave — bulk operator action dispatchers
// ────────────────────────────────────────────────────────────
//
// These wrap the bulk modules (convex/bulkBilling, convex/bulkRenewals,
// convex/bulkComms) with the flat router-facing arg shapes the
// `lib/agent-actions.ts → ConvexAgentRouter` interface declares. They
// exist so a React component can wire
//     useMutation(api.agentActions.bulkCharge)
// directly into the router callbacks WITHOUT writing per-callsite arg
// translation. Pre-fix, the router declared these callbacks but no
// dispatcher existed, so any wiring failed at validator-time.
//
// Audit-log strategy mirrors the bulk modules: one batch row written by
// the underlying executeRun/executeSweep/executeBatch, plus an
// `agent_bulk_dispatch` envelope from THIS file so the audit feed can
// distinguish "agent fired this bulk op" from "operator clicked the
// wizard". Per-entity rows are written by the bulk modules.

export const bulkCharge = mutation({
  args: {
    rule: bulkChargeRuleV,
    period_ym: v.string(),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { rule, period_ym, agent_prompt }) => {
    await requireTenant(ctx);
    const result = await ctx.runMutation(api.bulkBilling.executeRun, {
      rule,
      period: { ym: period_ym },
      agent_prompt,
    });
    await logAudit(ctx, {
      action_type: "agent_bulk_dispatch.bulk_charge",
      target_entity: "bulk_run",
      target_id: undefined,
      payload_delta: {
        rule,
        period_ym,
        count: result.count,
        total: result.total,
      },
      via_agent: true,
      agent_prompt,
    });
    return JSON.stringify(result);
  },
});

export const bulkRenewContracts = mutation({
  args: {
    days_out: v.number(),
    rate_adjustment_pct: v.optional(v.number()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { days_out, rate_adjustment_pct, agent_prompt }) => {
    await requireTenant(ctx);
    const result = await ctx.runMutation(api.bulkRenewals.executeSweep, {
      daysOut: days_out,
      rateAdjustmentPct: rate_adjustment_pct,
      agent_prompt,
    });
    await logAudit(ctx, {
      action_type: "agent_bulk_dispatch.bulk_renew_contracts",
      target_entity: "bulk_run",
      target_id: undefined,
      payload_delta: {
        days_out,
        rate_adjustment_pct,
        count: result.count,
      },
      via_agent: true,
      agent_prompt,
    });
    return JSON.stringify(result);
  },
});

export const bulkSendComms = mutation({
  args: {
    template_id: v.id("commTemplates"),
    filter: bulkCommsFilterV,
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { template_id, filter, agent_prompt }) => {
    await requireTenant(ctx);
    const result = await ctx.runMutation(api.bulkComms.executeBatch, {
      templateId: template_id,
      filter,
      agent_prompt,
    });
    await logAudit(ctx, {
      action_type: "agent_bulk_dispatch.bulk_send_comms",
      target_entity: "bulk_run",
      target_id: undefined,
      payload_delta: {
        template_id,
        filter_kind: filter.kind,
        count: result.count,
      },
      via_agent: true,
      agent_prompt,
    });
    return JSON.stringify(result);
  },
});

// ────────────────────────────────────────────────────────────
// Vendor Bills (operator AP workflow) — 4 dispatchers
// ────────────────────────────────────────────────────────────
//
// Each delegates to convex/vendorBills.ts so the per-entity audit row
// gets written exactly once (over there). The wrapper here adds the
// `agent_bulk_dispatch`-style envelope on the audit log so the audit
// feed distinguishes "agent fired this" from "operator clicked the
// wizard". Same pattern as the W3 bulk dispatchers above.

const vendorBillLineItemV = v.object({
  description: v.string(),
  amount: v.number(),
  gl_account: v.optional(v.string()),
});

const vendorBillStatusV = v.union(
  v.literal("draft"),
  v.literal("pending_approval"),
);

const vendorBillPaymentMethodV = v.union(
  v.literal("ach"),
  v.literal("check"),
  v.literal("card"),
  v.literal("wire"),
);

export const createVendorBill = mutation({
  args: {
    vendor_id: v.id("vendors"),
    vendor_invoice_number: v.optional(v.string()),
    bill_date: v.string(),
    due_date: v.optional(v.string()),
    amount: v.number(),
    tax_amount: v.optional(v.number()),
    description: v.optional(v.string()),
    line_items: v.optional(v.array(vendorBillLineItemV)),
    submit_as: v.optional(vendorBillStatusV),
    internal_notes: v.optional(v.string()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireTenant(ctx);
    const id = await ctx.runMutation(api.vendorBills.create, {
      vendor_id: args.vendor_id,
      vendor_invoice_number: args.vendor_invoice_number,
      bill_date: args.bill_date,
      due_date: args.due_date,
      amount: args.amount,
      tax_amount: args.tax_amount,
      description: args.description,
      line_items: args.line_items,
      status: args.submit_as,
      internal_notes: args.internal_notes,
      via_agent: true,
      agent_prompt: args.agent_prompt,
    });
    return id as unknown as string;
  },
});

export const approveVendorBill = mutation({
  args: {
    id: v.id("vendorBills"),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { id, agent_prompt }) => {
    await requireTenant(ctx);
    await ctx.runMutation(api.vendorBills.approve, {
      id,
      via_agent: true,
      agent_prompt,
    });
    return id as unknown as string;
  },
});

export const scheduleVendorBillPayment = mutation({
  args: {
    id: v.id("vendorBills"),
    scheduled_payment_date: v.string(),
    scheduled_payment_method: vendorBillPaymentMethodV,
    agent_prompt: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      id,
      scheduled_payment_date,
      scheduled_payment_method,
      agent_prompt,
    },
  ) => {
    await requireTenant(ctx);
    await ctx.runMutation(api.vendorBills.schedulePayment, {
      id,
      scheduled_payment_date,
      scheduled_payment_method,
      via_agent: true,
      agent_prompt,
    });
    return id as unknown as string;
  },
});

export const markVendorBillPaid = mutation({
  args: {
    id: v.id("vendorBills"),
    paid_at: v.optional(v.string()),
    paid_via: v.optional(v.string()),
    payment_method: v.optional(vendorBillPaymentMethodV),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { id, paid_at, paid_via, payment_method, agent_prompt },
  ) => {
    await requireTenant(ctx);
    await ctx.runMutation(api.vendorBills.markPaid, {
      id,
      paid_at,
      paid_via,
      payment_method,
      via_agent: true,
      agent_prompt,
    });
    return id as unknown as string;
  },
});

// ────────────────────────────────────────────────────────────
// Time Clock + Payroll Prep (W1 feature) agent dispatchers
// ────────────────────────────────────────────────────────────
//
// Four agent verbs:
//   - clock_in              "Clock in Jamie at 6 AM"
//   - clock_out             "Clock out Jamie"
//   - adjust_time_entry     "Fix Jamie's Friday — out at 4:30 not 4:00"
//   - close_payroll_period  "Close the current payroll period"
//
// Each defers to the corresponding per-entity mutation in
// convex/timeEntries.ts / convex/payroll.ts so audit semantics stay
// "exactly-once at the entity layer". The dispatcher's job is
// auth + parameter shape + via_agent stamping.

export const clockInAgent = mutation({
  args: {
    staff_id: v.id("staffMembers"),
    source: v.optional(
      v.union(v.literal("mobile"), v.literal("web"), v.literal("manual")),
    ),
    position: v.optional(v.string()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.runMutation(api.timeEntries.clockIn, {
      staff_id: args.staff_id,
      source: args.source,
      position: args.position,
      provenance: { agent_prompt: args.agent_prompt },
    });
    return id;
  },
});

export const clockOutAgent = mutation({
  args: {
    time_entry_id: v.id("timeEntries"),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.runMutation(api.timeEntries.clockOut, {
      id: args.time_entry_id,
      provenance: { agent_prompt: args.agent_prompt },
    });
    return id;
  },
});

export const adjustTimeEntryAgent = mutation({
  args: {
    time_entry_id: v.id("timeEntries"),
    adjuster_staff_id: v.id("staffMembers"),
    patch: v.object({
      clock_in_at: v.optional(v.string()),
      clock_out_at: v.optional(v.string()),
      break_minutes: v.optional(v.number()),
      notes: v.optional(v.string()),
      position: v.optional(v.string()),
    }),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.runMutation(api.timeEntries.adjust, {
      id: args.time_entry_id,
      adjuster_staff_id: args.adjuster_staff_id,
      patch: args.patch,
      provenance: { agent_prompt: args.agent_prompt },
    });
    return id;
  },
});

export const closePayrollPeriodAgent = mutation({
  args: {
    period_id: v.id("payrollPeriods"),
    closer_staff_id: v.id("staffMembers"),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.runMutation(api.payroll.closePeriod, {
      period_id: args.period_id,
      closer_staff_id: args.closer_staff_id,
      provenance: { agent_prompt: args.agent_prompt },
    });
    return result.period_id;
  },
});

// ────────────────────────────────────────────────────────────
// PDF extraction (Vision wave) — agent dispatchers.
// ────────────────────────────────────────────────────────────
//
// Both verbs stage an extraction request: the operator confirms the
// parsed fields on a review modal, and a follow-up mutation
// (create_vendor_bill / draft_contract) commits the actual record.
//
// We DON'T call the Anthropic API from inside a Convex mutation — the
// network call lives in the Next.js /api/pdf-extract route, which the
// UI hits after the staging mutation lands. The mutation here is the
// audit-trail anchor: it records "operator asked the agent to parse
// PDF <storage_id>" with via_agent: true so the audit log carries the
// intent even if the operator bails on the review screen.

export const createVendorBillFromPdf = mutation({
  args: {
    pdf_storage_id: v.id("_storage"),
    vendor_query: v.optional(v.string()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireTenant(ctx);
    const stageId = `pdf_bill_stage_${Date.now().toString(36)}`;
    await logAudit(ctx, {
      action_type: "vendor_bill.extract_from_pdf",
      target_entity: "vendorBills",
      target_id: stageId,
      payload_delta: {
        pdf_storage_id: args.pdf_storage_id,
        vendor_query: args.vendor_query,
      },
      via_agent: true,
      agent_prompt: args.agent_prompt,
    });
    return stageId;
  },
});

export const extractContractTerms = mutation({
  args: {
    pdf_storage_id: v.id("_storage"),
    boater_query: v.optional(v.string()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireTenant(ctx);
    const stageId = `pdf_contract_stage_${Date.now().toString(36)}`;
    await logAudit(ctx, {
      action_type: "contract.extract_terms_from_pdf",
      target_entity: "contracts",
      target_id: stageId,
      payload_delta: {
        pdf_storage_id: args.pdf_storage_id,
        boater_query: args.boater_query,
      },
      via_agent: true,
      agent_prompt: args.agent_prompt,
    });
    return stageId;
  },
});

// ────────────────────────────────────────────────────────────
// Boater applications (public self-onboarding queue)
// ────────────────────────────────────────────────────────────

const applicationSlipClassV = v.union(
  v.literal("covered"),
  v.literal("uncovered"),
  v.literal("T-head"),
  v.literal("buoy"),
  v.literal("dry"),
);

/**
 * submit_application — operator-initiated application submission (agent
 * path; the public form route hits applications.submit directly).
 *
 * Tenant comes from the auth session — operator-side. No public-submit
 * variant here; that belongs in `convex/applications.submit` because the
 * boater is unauthenticated.
 */
export const submitApplication = mutation({
  args: {
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
    preferred_slip_class: v.optional(applicationSlipClassV),
    preferred_dock: v.optional(v.string()),
    desired_start_date: v.optional(v.string()),
    notes: v.optional(v.string()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const seq = await nextSequenceNumber(ctx, tenantId, "APP", 1001);
    const number = `APP-${seq}`;
    // SECURITY: see convex/applications.ts → mintToken. Auth-bearing token.
    const token = `app_${crypto.randomUUID()}`;
    const id = await ctx.db.insert("applications", {
      tenantId,
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
      source: "agent",
      application_token: token,
      notes: args.notes,
      submitted_at: new Date().toISOString(),
    });
    await logAudit(ctx, {
      action_type: "application.submit",
      target_entity: "applications",
      target_id: id,
      // PII REDACTION: audit-log payload_delta is exported to CSV /
      // attached to support tickets / shown across the operator team.
      // Don't carry the applicant_email — the application row itself
      // holds it (addressable via target_id) for anyone with
      // application.read permission. Same redaction applies to all
      // application audit entries.
      payload_delta: { number },
      via_agent: true,
      agent_prompt: args.agent_prompt,
    });
    return id;
  },
});

export const approveApplication = mutation({
  args: {
    id: v.id("applications"),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { id, agent_prompt }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    assertOwnedByTenant(row, tenantId);
    if (row.status === "approved") return id;
    const now = new Date().toISOString();
    // RACE FIX (mirrors convex/applications.ts → approve): patch the
    // application status to "approved" BEFORE the Boater + Vessel
    // inserts. Convex serializes mutations on the same document, so a
    // concurrent retry sees status="approved" on its second pass and
    // short-circuits at the early-return above. Without this ordering,
    // two parallel agent calls could create duplicate Boater + Vessel
    // rows for the same application.
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
    // Status was already patched above for race safety; stamp the
    // back-ref to the new boater now that we know its id.
    await ctx.db.patch(id, { result_boater_id: boaterId });
    await logAudit(ctx, {
      action_type: "application.approve",
      target_entity: "applications",
      target_id: id,
      payload_delta: { result_boater_id: boaterId, number: row.number },
      via_agent: true,
      agent_prompt,
    });
    return id;
  },
});

export const declineApplication = mutation({
  args: {
    id: v.id("applications"),
    internal_review_notes: v.optional(v.string()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { id, internal_review_notes, agent_prompt }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    assertOwnedByTenant(row, tenantId);
    if (row.status === "declined") return id;
    await ctx.db.patch(id, {
      status: "declined",
      reviewed_at: new Date().toISOString(),
      internal_review_notes,
    });
    await logAudit(ctx, {
      action_type: "application.decline",
      target_entity: "applications",
      target_id: id,
      payload_delta: { number: row.number, internal_review_notes },
      via_agent: true,
      agent_prompt,
    });
    return id;
  },
});

export const routeApplicationToWaitlist = mutation({
  args: {
    id: v.id("applications"),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { id, agent_prompt }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    assertOwnedByTenant(row, tenantId);
    if (row.status === "waitlisted") return id;
    const waitlistId = await ctx.db.insert("waitlistEntries", {
      tenantId,
      patron_name: `${row.applicant_first_name} ${row.applicant_last_name}`,
      patron_email: row.applicant_email,
      patron_phone: row.applicant_phone,
      preferences: { max_loa_inches: row.vessel_loa_inches },
      status: "pending",
    });
    await ctx.db.patch(id, {
      status: "waitlisted",
      reviewed_at: new Date().toISOString(),
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
      via_agent: true,
      agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// Waitlist auto-offer cascade — Phase 5 dispatchers
//
// Each dispatcher delegates into convex/waitlist.ts (fireOffer /
// acceptOffer / declineOffer). The per-entity mutation already
// writes the audit row, so we don't double-write here — we just
// pass `agent_prompt` through so the audit row carries provenance.
// ────────────────────────────────────────────────────────────

export const fireWaitlistOfferAgent = mutation({
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
    const expiresAt = new Date(
      now.getTime() + expiresHours * 3_600_000,
    ).toISOString();
    const batchId = `wlb_${Date.now().toString(36)}_${args.slip_id.slice(-4)}`;
    const tokens: string[] = [];
    for (const id of args.entry_ids) {
      const entry = await ctx.db.get(id);
      assertOwnedByTenant(entry, tenantId);
      if (!entry) continue;
      if (entry.offer_status === "pending") continue;
      // SECURITY: see convex/waitlist.ts → newToken. Auth-bearing token.
      const token = `wlo_${crypto.randomUUID()}`;
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
      via_agent: true,
      agent_prompt: args.agent_prompt,
    });
    return batchId;
  },
});

export const acceptWaitlistOfferAgent = mutation({
  args: {
    offer_token: v.string(),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("waitlistEntries")
      .withIndex("by_offer_token", (q) =>
        q.eq("offer_token", args.offer_token),
      )
      .unique();
    if (!entry) throw new Error("Offer token not found.");
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
      via_agent: true,
      agent_prompt: args.agent_prompt,
    });
    return entry._id;
  },
});

export const declineWaitlistOfferAgent = mutation({
  args: {
    offer_token: v.string(),
    auto_advance: v.optional(v.boolean()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("waitlistEntries")
      .withIndex("by_offer_token", (q) =>
        q.eq("offer_token", args.offer_token),
      )
      .unique();
    if (!entry) throw new Error("Offer token not found.");
    if (entry.offer_status !== "pending") {
      throw new Error(`Offer is ${entry.offer_status ?? "not pending"}.`);
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
      via_agent: true,
      agent_prompt: args.agent_prompt,
    });
    // Note: auto_advance (firing next-in-line) is left to the operator
    // surface — it requires re-querying the waitlist + applying the
    // ranking/eligibility filter, which the operator panel does on
    // confirmation. The audit row above captures the operator's intent.
    return entry._id;
  },
});

// ────────────────────────────────────────────────────────────
// Renewal Sweep Coordinator — 3 dispatchers
// ────────────────────────────────────────────────────────────
//
// Each delegates to convex/renewalSweeps.ts so the per-entity audit row
// gets written exactly once (over there). The wrapper here adds the
// agent_bulk_dispatch-style envelope on the audit log so the audit feed
// distinguishes "agent fired this" from "operator clicked the wizard".

export const startRenewalSweepAgent = mutation({
  args: {
    name: v.string(),
    window_start: v.string(),
    window_end: v.string(),
    default_rate_adjustment_pct: v.number(),
    source_contract_ids: v.array(v.id("contracts")),
    notes: v.optional(v.string()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireTenant(ctx);
    const sweepId = await ctx.runMutation(
      api.renewalSweeps.create,
      {
        name: args.name,
        window_start: args.window_start,
        window_end: args.window_end,
        default_rate_adjustment_pct: args.default_rate_adjustment_pct,
        notes: args.notes,
        agent_prompt: args.agent_prompt,
      },
    );
    for (const cid of args.source_contract_ids) {
      await ctx.runMutation(api.renewalSweeps.addContract, {
        sweep_id: sweepId,
        source_contract_id: cid,
        agent_prompt: args.agent_prompt,
      });
    }
    await logAudit(ctx, {
      action_type: "agent_bulk_dispatch.start_renewal_sweep",
      target_entity: "renewalSweeps",
      target_id: sweepId,
      payload_delta: {
        name: args.name,
        window_start: args.window_start,
        window_end: args.window_end,
        items: args.source_contract_ids.length,
      },
      via_agent: true,
      agent_prompt: args.agent_prompt,
    });
    return sweepId;
  },
});

export const updateRenewalSweepItemAgent = mutation({
  args: {
    item_id: v.id("renewalSweepItems"),
    patch: v.object({
      priority: v.optional(
        v.union(
          v.literal("high"),
          v.literal("normal"),
          v.literal("low"),
        ),
      ),
      // null = clear override; mapped to undefined for setRateAdjustment.
      rate_adjustment_pct: v.optional(v.union(v.number(), v.null())),
      status: v.optional(
        v.union(v.literal("pending"), v.literal("withdrawn")),
      ),
      internal_notes: v.optional(v.string()),
    }),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const item = await ctx.db.get(args.item_id);
    assertOwnedByTenant(item, tenantId);

    if (args.patch.priority) {
      await ctx.runMutation(api.renewalSweeps.setPriority, {
        item_id: args.item_id,
        priority: args.patch.priority,
        agent_prompt: args.agent_prompt,
      });
    }
    if (args.patch.rate_adjustment_pct !== undefined) {
      await ctx.runMutation(api.renewalSweeps.setRateAdjustment, {
        item_id: args.item_id,
        rate_adjustment_pct:
          args.patch.rate_adjustment_pct === null
            ? undefined
            : args.patch.rate_adjustment_pct,
        agent_prompt: args.agent_prompt,
      });
    }
    if (args.patch.status === "withdrawn") {
      await ctx.db.patch(args.item_id, {
        status: "withdrawn",
        responded_at: new Date().toISOString(),
      });
    }
    if (args.patch.internal_notes !== undefined) {
      await ctx.db.patch(args.item_id, {
        internal_notes: args.patch.internal_notes,
      });
    }
    await logAudit(ctx, {
      action_type: "agent_bulk_dispatch.update_renewal_sweep_item",
      target_entity: "renewalSweepItems",
      target_id: args.item_id,
      payload_delta: args.patch,
      via_agent: true,
      agent_prompt: args.agent_prompt,
    });
    return args.item_id;
  },
});

export const launchRenewalSweepAgent = mutation({
  args: {
    sweep_id: v.id("renewalSweeps"),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireTenant(ctx);
    const result = await ctx.runMutation(api.renewalSweeps.launch, {
      id: args.sweep_id,
      agent_prompt: args.agent_prompt,
    });
    await logAudit(ctx, {
      action_type: "agent_bulk_dispatch.launch_renewal_sweep",
      target_entity: "renewalSweeps",
      target_id: args.sweep_id,
      payload_delta: { drafted: result.drafted },
      via_agent: true,
      agent_prompt: args.agent_prompt,
    });
    return JSON.stringify(result);
  },
});
