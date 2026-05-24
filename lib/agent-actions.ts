"use client";

import {
  BOATERS,
  POS_LOCATIONS,
  formatMoney,
} from "@/lib/mock-data";
import {
  addBoater,
  addCardForBoater,
  addCommunication,
  addContract,
  addLedgerEntry,
  addPosOrder,
  addReservation,
  addVessel,
  addWorkOrder,
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
} from "@/lib/client-store";
import type {
  AgentAction,
} from "@/lib/simulated-agent";
import type {
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
 */

export function executeAgentAction(action: AgentAction): void {
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

    // Mark applied invoices as paid if amount covers them
    if (action.applied_to_invoice_ids && action.applied_to_invoice_ids.length > 0) {
      // Note: store doesn't currently expose update; this would close invoices in a fuller impl
    }
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
    return;
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
    return;
  }

  if (action.kind === "create_contract") {
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
    };
    addContract(contract);
    return;
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

}
