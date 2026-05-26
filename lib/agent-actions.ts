"use client";

import { can, ROLE_META, type Action, type Entity, type Role } from "@/lib/auth";
import {
  BOATERS,
  POS_LOCATIONS,
  formatMoney,
} from "@/lib/mock-data";
import {
  addBoatRental,
  addBoater,
  addCardForBoater,
  addCommunication,
  addContract,
  addLedgerEntry,
  addPosOrder,
  addReservation,
  addVessel,
  addWorkOrder,
  applyPaymentToInvoices,
  closeBoatRental,
  mintBookingPickupToken,
  mintContractSignatureToken,
  nextBoatRentalId,
  nextBoatRentalNumber,
  nextBoaterId,
  nextCardId,
  nextContractId,
  nextContractNumber,
  nextInvoiceNumber,
  nextLedgerId,
  nextPosOrderId,
  nextPosOrderNumber,
  nextReservationId,
  nextReservationNumber,
  nextVesselId,
  nextWorkOrderId,
  nextWorkOrderNumber,
  notifyWaitlistOfSlipOpening,
  requestCoiRenewal,
} from "@/lib/client-store";
import type {
  AgentAction,
} from "@/lib/simulated-agent";
import type {
  BoatRental,
  Boater,
  CardOnFile,
  Communication,
  Contract,
  LedgerEntry,
  PosOrder, // referenced via order construction in charge_to_account branch
  Reservation,
  Vessel,
  WorkOrder,
} from "@/lib/types";

/*
 * Client-only action executor. Lives in its own file so the server-rendered
 * /api/agent route can import the simulated agent (which is server-safe)
 * without dragging in client-store + React hooks.
 *
 * RBAC: when called with a role, the executor first checks the role's
 * permissions for the entity affected by the action. If denied, no mutation
 * happens and a friendly reason is returned for the UI to surface in the
 * action card (instead of silently failing).
 */

const ACTION_PERMISSION: Record<AgentAction["kind"], { entity: Entity; action: Action }> = {
  charge_to_account: { entity: "ledger", action: "create" },
  send_message: { entity: "broadcast", action: "create" },
  create_work_order: { entity: "work_order", action: "create" },
  create_reservation: { entity: "reservation", action: "create" },
  record_payment: { entity: "ledger", action: "create" },
  create_boater: { entity: "boater", action: "create" },
  create_vessel: { entity: "vessel", action: "create" },
  create_contract: { entity: "contract", action: "create" },
  add_card: { entity: "boater", action: "edit" },
  // Boat Rentals / waitlist / COI map onto existing RBAC entities;
  // there's no separate "boat_rental" capability so they piggy-back
  // on the closest functional permission.
  create_boat_rental: { entity: "reservation", action: "create" },
  close_boat_rental: { entity: "ledger", action: "create" },
  send_pickup_link: { entity: "broadcast", action: "create" },
  notify_waitlist: { entity: "broadcast", action: "create" },
  request_coi_renewal: { entity: "broadcast", action: "create" },
};

export type ExecResult =
  | { ok: true; createdId?: string }
  | { ok: false; reason: string };

export function executeAgentAction(action: AgentAction, role?: Role): ExecResult {
  // RBAC: defense-in-depth — even if a tool slips past the prompt-side filter,
  // the executor refuses the mutation.
  if (role) {
    const perm = ACTION_PERMISSION[action.kind];
    if (perm && !can(role, perm.action, perm.entity)) {
      return {
        ok: false,
        reason: `${ROLE_META[role].label} can't ${perm.action} ${perm.entity.replace("_", " ")}s. Switch role in the top bar.`,
      };
    }
  }

  const createdId = runAction(action);
  return { ok: true, createdId };
}

function runAction(action: AgentAction): string | undefined {
  if (action.kind === "charge_to_account") {
    const now = new Date().toISOString();
    const orderId = nextPosOrderId();
    const orderNumber = nextPosOrderNumber();
    const boater = BOATERS.find((b) => b.id === action.boater_id);
    if (!boater) return;
    const location = POS_LOCATIONS.find((l) => l.id === action.location_id);
    if (!location) return;
    const subtotal = action.line.price;
    const tax = Math.round(subtotal * location.default_tax_rate * 100) / 100;
    const total = subtotal + tax;
    const invoiceId = nextLedgerId();
    const invoiceNum = nextInvoiceNumber();

    const order: PosOrder = {
      id: orderId,
      number: orderNumber,
      location_id: location.id,
      customer_kind: "boater",
      boater_id: boater.id,
      line_items: [{ sku: action.line.sku, name: action.line.name, qty: 1, unit_price: action.line.price, total: subtotal }],
      subtotal,
      tax,
      total,
      payment_method: "charge_to_account",
      status: "paid",
      created_at: now,
      closed_at: now,
      linked_ledger_entry_id: invoiceId,
    };
    const invoice: LedgerEntry = {
      id: invoiceId,
      boater_id: boater.id,
      type: "invoice",
      number: invoiceNum,
      date: now.slice(0, 10),
      amount: total,
      open_balance: total,
      method: null,
      status: "open",
      line_items: [{ description: action.line.name, amount: subtotal }],
      linked_pos_order_id: orderId,
    };
    addLedgerEntry(invoice);
    addPosOrder(order);

    // Auto-receipt
    const receipt: Communication = {
      id: `cm_agent_${Date.now()}`,
      boater_id: boater.id,
      type: boater.communication_prefs.preferred_channel,
      direction: "outbound",
      subject: `Marina Stee Receipt — ${location.name}`,
      body_preview: `Charged ${formatMoney(total)} for ${action.line.name} to your account.`,
      sender_label: "Marina Stee Agent",
      sender_is_system: true,
      recipient:
        boater.communication_prefs.preferred_channel === "email"
          ? boater.primary_contact.email ?? "—"
          : boater.primary_contact.phone ?? "—",
      sent_at: now,
      status: "delivered",
      related_entity: { type: "invoice", id: orderId },
    };
    addCommunication(receipt);
    return;
  }

  if (action.kind === "create_work_order") {
    const wo: WorkOrder = {
      id: nextWorkOrderId(),
      number: nextWorkOrderNumber(),
      boater_id: action.boater_id,
      vessel_id: action.vessel_id,
      slip_id: action.slip_id,
      subject: action.subject,
      description: action.description,
      status: "open",
      priority: action.priority ?? "normal",
      assignee_user_id: action.assignee_user_id,
      start_date: action.start_date,
      end_date: action.end_date,
      due_date: action.due_date,
      activity_type: action.activity_type ?? "other",
    };
    addWorkOrder(wo);
    return;
  }

  if (action.kind === "create_reservation") {
    const r: Reservation = {
      id: nextReservationId(),
      number: nextReservationNumber(),
      seq: "1/1",
      boater_id: action.boater_id,
      vessel_id: action.vessel_id ?? "",
      slip_id: action.slip_id,
      arrival_date: action.arrival_date,
      departure_date: action.departure_date,
      status: "scheduled",
      type: action.type,
    };
    addReservation(r);
    return;
  }

  if (action.kind === "record_payment") {
    const boater = BOATERS.find((b) => b.id === action.boater_id);
    if (!boater) return;
    const now = new Date().toISOString();
    const payment: LedgerEntry = {
      id: nextLedgerId(),
      boater_id: boater.id,
      type: "payment",
      date: now.slice(0, 10),
      amount: action.amount,
      open_balance: 0,
      method: action.method === "ach" ? "ach" : action.method === "check" ? "check" : action.method === "cash" ? "cash" : "card",
      applied_to_invoice_ids: action.applied_to_invoice_ids ?? [],
      status: "paid",
      refund_notes: action.notes,
    };
    addLedgerEntry(payment);
    applyPaymentToInvoices(boater.id, action.amount, action.applied_to_invoice_ids);
    return;
  }

  if (action.kind === "create_boater") {
    const id = nextBoaterId();
    const display = `${action.last_name}, ${action.first_name}`;
    const boater: Boater = {
      id,
      display_name: display,
      first_name: action.first_name,
      last_name: action.last_name,
      code: action.code,
      active: true,
      billing_cadence: action.billing_cadence,
      tags: [],
      communication_prefs: {
        preferred_channel: action.preferred_channel,
        language: "en",
      },
      primary_contact: {
        id: `ct_${id}_primary`,
        name: display,
        role: "self",
        email: action.email,
        phone: action.phone,
        preferred_channel: action.preferred_channel,
        can_be_billed: true,
      },
      additional_contacts: [],
      address: { line1: "", city: "", state: "", zip: "", country: "US" },
      notes: action.notes,
    };
    addBoater(boater);
    return id;
  }

  if (action.kind === "create_vessel") {
    const vessel: Vessel = {
      id: nextVesselId(),
      boater_id: action.boater_id,
      co_owner_ids: [],
      name: action.name,
      year: action.year,
      make: action.make,
      model: action.model,
      vessel_type: action.vessel_type,
      fuel_type: action.fuel_type,
      loa_inches: action.loa_inches,
      beam_inches: action.beam_inches,
      draft_inches: action.draft_inches,
      hull_vin: action.hull_vin,
      registration: action.registration,
      active: true,
    };
    addVessel(vessel);
    return vessel.id;
  }

  if (action.kind === "create_contract") {
    const now = new Date().toISOString();
    const contract: Contract = {
      id: nextContractId(),
      number: nextContractNumber(),
      boater_id: action.boater_id,
      template_id: action.template_id,
      template_version: 1,
      vessel_id: action.vessel_id,
      slip_id: action.slip_id,
      status: "draft",
      effective_start: action.effective_start,
      effective_end: action.effective_end,
      annual_rate: action.annual_rate,
      billing_cadence: action.billing_cadence,
      attachments: action.attachments?.map((a, i) => ({
        id: `att_${Date.now().toString(36)}_${i}`,
        name: a.name,
        type: a.type ?? "supporting_doc",
        url: a.url,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        uploaded_at: now,
      })),
    };
    addContract(contract);
    return contract.id;
  }

  if (action.kind === "add_card") {
    const card: CardOnFile = {
      id: nextCardId(),
      brand: action.brand,
      last4: action.last4,
      exp_month: action.exp_month,
      exp_year: action.exp_year,
      nickname: action.nickname,
      is_default: action.is_default,
      processor_token: `tok_runtime_${Date.now()}`,
    };
    addCardForBoater(action.boater_id, card);
    return;
  }

  if (action.kind === "send_message") {
    const boater = BOATERS.find((b) => b.id === action.boater_id);
    if (!boater) return;
    const comm: Communication = {
      id: `cm_agent_${Date.now()}`,
      boater_id: boater.id,
      type: action.type,
      direction: "outbound",
      subject: action.subject,
      body_preview: action.body,
      sender_label: "Marina Stee Agent",
      sender_is_system: true,
      recipient:
        action.type === "email"
          ? boater.primary_contact.email ?? "—"
          : boater.primary_contact.phone ?? "—",
      sent_at: new Date().toISOString(),
      status: "delivered",
    };
    addCommunication(comm);
    return;
  }

  // ── Boat Rentals: create a booking + auto-dispatch the pickup chain
  if (action.kind === "create_boat_rental") {
    const now = new Date().toISOString();
    const id = nextBoatRentalId();
    const booking: BoatRental = {
      id,
      number: nextBoatRentalNumber(),
      boat_id: action.boat_id,
      boater_id: action.boater_id,
      patron_name: action.patron_name,
      patron_email: action.patron_email,
      patron_phone: action.patron_phone,
      start_at: action.start_at,
      end_at: action.end_at,
      rate_kind: action.rate_kind,
      base_amount: 0,                 // agent passes the boat — UI will derive on render
      deposit_hold: 0,
      status: "reserved",
      checkin: {},
      created_at: now,
      updated_at: now,
    };
    addBoatRental(booking);
    // Mint pickup token immediately so the customer gets the link from
    // a single agent command — same shape as the wizard chain.
    mintBookingPickupToken(id);
    return id;
  }

  // ── Boat Rentals: close out — dockhand can fire from /dock or
  // agent can do it from chat with "close BR-1003, fuel 45%, no damage."
  if (action.kind === "close_boat_rental") {
    closeBoatRental(action.rental_id, {
      fuel_in_pct: action.fuel_in_pct,
      hours_in: action.hours_in,
      damage_notes: action.damage_notes,
      damage_charge: action.damage_charge,
    });
    return action.rental_id;
  }

  // ── Send / resend pickup link for an existing booking
  if (action.kind === "send_pickup_link") {
    mintBookingPickupToken(action.rental_id);
    return action.rental_id;
  }

  // ── Waitlist broadcast: slip just opened, notify top N
  if (action.kind === "notify_waitlist") {
    notifyWaitlistOfSlipOpening(action.slip_id, { topN: action.top_n ?? 5 });
    return action.slip_id;
  }

  // ── COI: ask the boater to upload a renewed certificate
  if (action.kind === "request_coi_renewal") {
    requestCoiRenewal(action.coi_id);
    return action.coi_id;
  }
}
