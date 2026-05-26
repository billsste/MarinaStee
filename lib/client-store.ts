"use client";

import { useSyncExternalStore } from "react";
import {
  ADDITIONAL_FEES,
  BOAT_RENTALS,
  BOATERS,
  CARDS_ON_FILE,
  COMMUNICATIONS,
  CONTRACT_TEMPLATES,
  CONTRACTS,
  FUEL_INVENTORY,
  INSURANCE_CERTIFICATES,
  LEDGER,
  MARINA_EVENTS,
  METER_READINGS,
  POS_LOCATIONS,
  POS_ORDERS,
  QUOTES,
  RATES,
  RENTAL_BOATS,
  RENTAL_GROUPS,
  RENTAL_SPACES,
  RESERVATIONS,
  STAFF_NOTES,
  VESSELS,
  WAITLIST,
  WORK_ORDERS,
} from "@/lib/mock-data";
import type {
  AdditionalFee,
  BoatRental,
  Boater,
  CardOnFile,
  Communication,
  Contract,
  ContractTemplate,
  FuelInventory,
  InsuranceCertificate,
  LedgerEntry,
  MarinaEvent,
  MeterReading,
  PosOrder,
  QbSyncStatus,
  Rate,
  RentalBoat,
  RentalGroup,
  RentalSpace,
  Reservation,
  StaffNote,
  Vessel,
  WaitlistEntry,
  WaitlistStatus,
  WorkOrder,
} from "@/lib/types";

// GL account derivation — POS location → GL bucket, falls back to A/R for ledger.
function glForOrder(locationId: string): string {
  const loc = POS_LOCATIONS.find((l) => l.id === locationId);
  switch (loc?.key) {
    case "fuel_dock": return "Fuel Sales";
    case "ship_store": return "Retail Sales";
    case "restaurant": return "Restaurant";
    case "harbormaster": return "Services";
    default: return "A/R";
  }
}

// Seed pre-existing entries as already synced — they represent historical
// data that landed in QB previously. Runtime entries default to "pending".
function tagSynced<T extends { id: string; number?: string }>(e: T, prefix: string): T & {
  qb_sync_status: QbSyncStatus; qb_ref: string; qb_synced_at: string;
} {
  return {
    ...e,
    qb_sync_status: "synced" as const,
    qb_ref: `QB-${prefix}-${(e.number ?? e.id).replace(/[^A-Za-z0-9]/g, "")}`,
    qb_synced_at: "2026-05-20T18:30:00Z",
  };
}

/*
 * Lightweight reactive client store. Seeded from mock-data at module-init
 * so SSR + first client paint match (no hydration mismatch). Mutations push
 * to subscribers; pages that need live updates use the hooks below.
 *
 * Intentionally not Zustand — the API surface here is small enough that
 * useSyncExternalStore + a singleton is plenty.
 */

type State = {
  ledger: LedgerEntry[];
  posOrders: PosOrder[];
  communications: Communication[];
  workOrders: WorkOrder[];
  reservations: Reservation[];
  boaters: Boater[];
  vessels: Vessel[];
  contracts: Contract[];
  // Cards are keyed by boater_id so per-boater hooks stay O(1).
  cardsByBoaterId: Record<string, CardOnFile[]>;
  insurance: InsuranceCertificate[];
  waitlist: WaitlistEntry[];
  staffNotes: StaffNote[];
  events: MarinaEvent[];
  rates: Rate[];
  fees: AdditionalFee[];
  templates: ContractTemplate[];
  meters: MeterReading[];
  rentalGroups: RentalGroup[];
  rentalSpaces: RentalSpace[];
  fuelInventory: FuelInventory[];
  // Boat Rentals (own fleet — pontoons, kayaks, jet skis, ...)
  rentalBoats: RentalBoat[];
  boatRentals: BoatRental[];
};

let state: State = {
  ledger: LEDGER.map((l) => ({
    ...tagSynced(l, l.type === "invoice" ? "INV" : l.type === "payment" ? "PMT" : "GEN"),
    gl_account: l.gl_account ?? "A/R",
  })),
  posOrders: POS_ORDERS.map((o) => tagSynced(o, "POS")),
  communications: [...COMMUNICATIONS],
  workOrders: [...WORK_ORDERS],
  reservations: [...RESERVATIONS],
  boaters: [...BOATERS],
  vessels: [...VESSELS],
  contracts: [...CONTRACTS],
  cardsByBoaterId: { ...CARDS_ON_FILE },
  insurance: [...INSURANCE_CERTIFICATES],
  waitlist: [...WAITLIST],
  staffNotes: [...STAFF_NOTES],
  events: [...MARINA_EVENTS],
  rates: [...RATES],
  fees: [...ADDITIONAL_FEES],
  templates: [...CONTRACT_TEMPLATES],
  meters: [...METER_READINGS],
  rentalGroups: [...RENTAL_GROUPS],
  rentalSpaces: [...RENTAL_SPACES],
  fuelInventory: [...FUEL_INVENTORY],
  rentalBoats: [...RENTAL_BOATS],
  boatRentals: [...BOAT_RENTALS],
};

const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach((fn) => fn());
}

function getSnapshot(): State {
  return state;
}

function subscribe(cb: () => void) {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

// ----- actions -----

export function addLedgerEntry(entry: LedgerEntry) {
  const e: LedgerEntry = {
    ...entry,
    qb_sync_status: entry.qb_sync_status ?? "pending",
    gl_account: entry.gl_account ?? "A/R",
  };
  state = { ...state, ledger: [e, ...state.ledger] };
  notify();
}

/**
 * Annual billing run helper. For a single contract's worth of slip
 * fees, posts the invoice, dispatches a "your annual invoice is
 * ready" comm to the boater, and (if a default card is on file)
 * auto-charges by posting a matching Payment that zeros the
 * invoice's open balance.
 *
 * Returns the invoice id so callers can build a run summary.
 */
export function postBillingRunInvoice(opts: {
  boater_id: string;
  amount: number;
  date: string;             // ISO YYYY-MM-DD
  line_item_label: string;
  contract_id?: string;
  slip_id?: string;
}): string | null {
  const boater = state.boaters.find((b) => b.id === opts.boater_id);
  if (!boater || opts.amount <= 0) return null;
  const now = new Date().toISOString();

  // 1. Post the invoice
  const invoiceId = nextLedgerId();
  const invoice: LedgerEntry = {
    id: invoiceId,
    boater_id: boater.id,
    type: "invoice",
    number: nextInvoiceNumber(),
    date: opts.date,
    amount: opts.amount,
    open_balance: opts.amount,
    method: "ach",
    status: "open",
    gl_account: "Slip Fee Revenue",
    qb_sync_status: "pending",
    line_items: [{ description: opts.line_item_label, amount: opts.amount }],
  };
  state = { ...state, ledger: [invoice, ...state.ledger] };

  // 2. Auto-charge if a default card is on file
  const defaultCard = state.cardsByBoaterId[boater.id]?.find((c) => c.is_default);
  let autoCharged = false;
  if (defaultCard) {
    const paymentId = nextLedgerId();
    const payment: LedgerEntry = {
      id: paymentId,
      boater_id: boater.id,
      type: "payment",
      number: nextInvoiceNumber(),
      date: opts.date,
      amount: opts.amount,
      open_balance: 0,
      method: "card",
      status: "paid",
      applied_to_invoice_ids: [invoiceId],
      gl_account: "A/R",
      qb_sync_status: "pending",
      processor_ref: `auto_billing_${defaultCard.id.slice(-6)}`,
    };
    state = {
      ...state,
      ledger: [
        payment,
        ...state.ledger.map((l) =>
          l.id === invoiceId
            ? { ...l, open_balance: 0, status: "paid" as const }
            : l
        ),
      ],
    };
    autoCharged = true;
  }

  // 3. Dispatch a comm to the boater
  const channel = boater.communication_prefs.preferred_channel;
  const commType: Communication["type"] = channel;
  const recipient =
    commType === "email"
      ? (boater.primary_contact.email ?? "")
      : (boater.primary_contact.phone ?? "");
  const subject = autoCharged
    ? `Annual invoice paid — ${formatMoneyInline(opts.amount)}`
    : `Annual invoice ready — ${formatMoneyInline(opts.amount)}`;
  const body = autoCharged
    ? `Hi ${boater.first_name},\n\n` +
      `Your annual marina invoice has been auto-charged to the card on file ` +
      `(****${defaultCard?.last4}).\n\n` +
      `  ${opts.line_item_label.padEnd(30, " ")} ${formatMoneyInline(opts.amount)}\n\n` +
      `No action needed. Welcome to another season at Marina Stee.\n\nMarina Stee`
    : `Hi ${boater.first_name},\n\n` +
      `Your annual marina invoice for ${formatMoneyInline(opts.amount)} is ready. ` +
      `Pay through your portal or set up auto-pay so we don't have to bug you ` +
      `again next year.\n\nMarina Stee`;
  state = {
    ...state,
    communications: [
      {
        id: `cm_billing_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        boater_id: boater.id,
        type: commType,
        direction: "outbound",
        sender_label: "Marina Stee",
        sender_is_system: true,
        recipient,
        subject,
        body_preview: body.slice(0, 80),
        full_body: body,
        sent_at: now,
        status: "delivered",
        related_entity: { type: "invoice", id: invoiceId },
      },
      ...state.communications,
    ],
  };
  notify();
  return invoiceId;
}

// Inline money formatter — duplicates lib/mock-data's helper but keeps
// client-store free of cross-deps that pull in seed data at import time.
function formatMoneyInline(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Apply a payment to one or more invoice ids: subtract from each invoice's
// open_balance in oldest-first order until the amount is exhausted. Closes
// any invoice fully covered. Returns the actual amount applied (may be < amount
// if no open balance exists).
export function applyPaymentToInvoices(
  boaterId: string,
  amount: number,
  invoiceIds?: string[]
): number {
  let remaining = amount;
  const targets = state.ledger
    .filter((l) => l.boater_id === boaterId && l.type === "invoice" && l.open_balance > 0)
    .filter((l) => !invoiceIds || invoiceIds.includes(l.id))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  if (targets.length === 0) return 0;

  const updated = state.ledger.map((l) => {
    if (remaining <= 0) return l;
    const target = targets.find((t) => t.id === l.id);
    if (!target) return l;
    const applied = Math.min(remaining, l.open_balance);
    remaining -= applied;
    const newOpenBalance = +(l.open_balance - applied).toFixed(2);
    return {
      ...l,
      open_balance: newOpenBalance,
      status: newOpenBalance === 0 ? ("paid" as const) : l.status,
    };
  });
  state = { ...state, ledger: updated };
  notify();
  return amount - remaining;
}

export function addPosOrder(order: PosOrder) {
  const o: PosOrder = {
    ...order,
    qb_sync_status: order.qb_sync_status ?? "pending",
  };
  // If the order's location maps to a GL bucket, propagate to its linked ledger entry
  if (o.linked_ledger_entry_id) {
    const idx = state.ledger.findIndex((l) => l.id === o.linked_ledger_entry_id);
    if (idx >= 0) {
      const updated = [...state.ledger];
      updated[idx] = { ...updated[idx], gl_account: glForOrder(o.location_id) };
      state = { ...state, ledger: updated };
    }
  }
  state = { ...state, posOrders: [o, ...state.posOrders] };
  notify();
}

// ----- QuickBooks sync simulation -----

export function pendingForQb(): { orders: PosOrder[]; entries: LedgerEntry[] } {
  return {
    orders: state.posOrders.filter((o) => o.qb_sync_status === "pending"),
    entries: state.ledger.filter((l) => l.qb_sync_status === "pending"),
  };
}

let _qbBatchSeq = 100;
const qbBatchLog: { id: string; pushed_at: string; count: number; total: number; outcome: "ok" | "error" }[] = [];

export function getQbBatchLog() {
  return qbBatchLog;
}

export function pushPendingToQuickBooks(): Promise<{ batchId: string; count: number; total: number }> {
  const { orders, entries } = pendingForQb();
  const count = orders.length + entries.length;
  const total =
    entries.filter((l) => l.type === "invoice").reduce((s, l) => s + l.amount, 0) +
    orders.filter((o) => !o.boater_id).reduce((s, o) => s + o.total, 0);
  const now = new Date().toISOString();

  // Flip everything to "syncing"
  state = {
    ...state,
    ledger: state.ledger.map((l) =>
      l.qb_sync_status === "pending" ? { ...l, qb_sync_status: "syncing" } : l
    ),
    posOrders: state.posOrders.map((o) =>
      o.qb_sync_status === "pending" ? { ...o, qb_sync_status: "syncing" } : o
    ),
  };
  notify();

  return new Promise((resolve) => {
    setTimeout(() => {
      _qbBatchSeq += 1;
      const batchId = `QB-BATCH-${_qbBatchSeq}`;
      state = {
        ...state,
        ledger: state.ledger.map((l) =>
          l.qb_sync_status === "syncing"
            ? {
                ...l,
                qb_sync_status: "synced" as const,
                qb_ref: `QB-${l.type === "invoice" ? "INV" : "PMT"}-${(l.number ?? l.id.slice(-6)).replace(/[^A-Za-z0-9]/g, "")}`,
                qb_synced_at: new Date().toISOString(),
              }
            : l
        ),
        posOrders: state.posOrders.map((o) =>
          o.qb_sync_status === "syncing"
            ? {
                ...o,
                qb_sync_status: "synced" as const,
                qb_ref: `QB-POS-${o.number.replace(/[^A-Za-z0-9]/g, "")}`,
                qb_synced_at: new Date().toISOString(),
              }
            : o
        ),
      };
      qbBatchLog.unshift({ id: batchId, pushed_at: now, count, total, outcome: "ok" });
      notify();
      resolve({ batchId, count, total });
    }, 1200);
  });
}

export function addCommunication(comm: Communication) {
  state = { ...state, communications: [comm, ...state.communications] };
  notify();
}

export function addWorkOrder(wo: WorkOrder) {
  state = { ...state, workOrders: [wo, ...state.workOrders] };
  notify();
}

/**
 * Patch a work order. If the patch flips status to "completed" and
 * the WO has a signed quote without an associated invoice yet, fan
 * out the closeout chain: post an invoice from the quote's line
 * items, dispatch a "service complete" comm to the boater, and
 * stamp the WO with linked_ledger_entry_ids.
 *
 * Mirrors updateContract's auto-fire pattern.
 */
export function updateWorkOrder(id: string, patch: Partial<WorkOrder>) {
  const prev = state.workOrders.find((w) => w.id === id);
  state = {
    ...state,
    workOrders: state.workOrders.map((w) =>
      w.id === id ? { ...w, ...patch } : w
    ),
  };
  notify();
  if (
    prev &&
    patch.status === "completed" &&
    prev.status !== "completed"
  ) {
    queueMicrotask(() => {
      fireWorkOrderCloseoutChain(id);
    });
  }
}

function fireWorkOrderCloseoutChain(id: string): void {
  const wo = state.workOrders.find((w) => w.id === id);
  if (!wo) return;
  // Pull the linked quote (from QUOTES static seed). Skip if no quote,
  // no line items, or the WO already has an associated ledger entry.
  const quote = wo.quote_id ? QUOTES.find((q) => q.id === wo.quote_id) : undefined;
  const alreadyInvoiced = (wo.linked_ledger_entry_ids ?? []).some((leid) =>
    state.ledger.some((l) => l.id === leid && l.type === "invoice")
  );
  const boater = state.boaters.find((b) => b.id === wo.boater_id);
  if (!boater) return;
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // If there's a signed quote with line items and no invoice yet,
  // post one now.
  let invoiceId: string | undefined;
  if (
    quote &&
    !alreadyInvoiced &&
    quote.line_items.length > 0 &&
    quote.total > 0
  ) {
    invoiceId = nextLedgerId();
    const invoice: LedgerEntry = {
      id: invoiceId,
      boater_id: wo.boater_id,
      type: "invoice",
      number: nextInvoiceNumber(),
      date: today,
      amount: quote.total,
      open_balance: quote.total,
      method: null,
      status: "open",
      line_items: quote.line_items.map((li) => ({
        description: li.name,
        amount: li.total,
      })),
      gl_account: "Services",
      qb_sync_status: "pending",
      linked_work_order_id: wo.id,
      linked_quote_id: quote.id,
    };
    state = {
      ...state,
      ledger: [invoice, ...state.ledger],
      workOrders: state.workOrders.map((w) =>
        w.id === id
          ? {
              ...w,
              linked_ledger_entry_ids: [
                ...(w.linked_ledger_entry_ids ?? []),
                invoiceId!,
              ],
            }
          : w
      ),
    };
  }

  // Always dispatch a "service complete" comm — even when there's
  // no invoice (some WOs are non-billable / internal tasks).
  const channel = boater.communication_prefs.preferred_channel;
  const commType: Communication["type"] = channel;
  const recipient =
    commType === "email"
      ? (boater.primary_contact.email ?? "")
      : (boater.primary_contact.phone ?? "");
  const subject = invoiceId
    ? `Service complete — ${wo.subject}`
    : `Your work order is complete — ${wo.subject}`;
  const body = invoiceId
    ? `Hi ${boater.first_name},\n\n` +
      `Your ${wo.subject.toLowerCase()} is complete. We've posted invoice for the work — ` +
      `pay through the link below or it'll be charged to your card on file ` +
      `(if one is set up).\n\n` +
      `Thanks for trusting us with the work,\nMarina Stee`
    : `Hi ${boater.first_name},\n\n` +
      `Your work order — ${wo.subject} — is complete. No invoice this time.\n\n` +
      `Marina Stee`;
  state = {
    ...state,
    communications: [
      {
        id: `cm_wo_close_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        boater_id: boater.id,
        type: commType,
        direction: "outbound",
        sender_label: "Marina Stee",
        sender_is_system: true,
        recipient,
        subject,
        body_preview: body.slice(0, 80),
        full_body: body,
        sent_at: now,
        status: "delivered",
        related_entity: invoiceId
          ? { type: "invoice", id: invoiceId }
          : { type: "work_order", id: wo.id },
      },
      ...state.communications,
    ],
  };
  notify();
}

export function addReservation(r: Reservation) {
  state = { ...state, reservations: [r, ...state.reservations] };
  notify();
}

export function updateReservationStatus(id: string, status: Reservation["status"]) {
  state = {
    ...state,
    reservations: state.reservations.map((r) => (r.id === id ? { ...r, status } : r)),
  };
  notify();
}

/**
 * Default transient nightly rate. In production this would resolve from
 * a Rate card by slip / occupancy_type; for the demo we use a flat $75
 * and apply a slight bump for the larger slips when LOA > 30'.
 */
function transientNightlyRate(slipId: string): number {
  const slip = state.rentalSpaces.find((s) => s.id === slipId);
  const loa = slip?.length_inches ?? 0;
  if (loa > 360) return 110;       // 30'+
  if (loa > 240) return 85;        // 20'-30'
  return 75;
}

function nightsBetween(arrival: string, departure: string): number {
  const ms = new Date(departure).getTime() - new Date(arrival).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

/**
 * Transient check-in:
 *   - posts an Invoice for the stay (nights × rate)
 *   - dispatches an arrival comm to the boater
 *   - flips reservation.status → occupied
 *
 * Annual / seasonal reservations don't post an invoice here (they're
 * billed by the contract / billing run instead) — we just mark
 * "occupied" and dispatch a "welcome back, you're in slip X" comm.
 *
 * Returns the created invoice id (transient) or undefined (annual).
 */
export function checkInReservation(id: string): string | undefined {
  const r = state.reservations.find((x) => x.id === id);
  if (!r) return undefined;
  const boater = state.boaters.find((b) => b.id === r.boater_id);
  if (!boater) return undefined;
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // Status transition
  state = {
    ...state,
    reservations: state.reservations.map((x) =>
      x.id === id ? { ...x, status: "occupied" as const } : x
    ),
  };

  let invoiceId: string | undefined;

  // Transient stays: pre-bill the nights up front
  if (r.type === "transient") {
    const nights = nightsBetween(r.arrival_date, r.departure_date);
    const rate = transientNightlyRate(r.slip_id);
    const total = +(nights * rate).toFixed(2);
    invoiceId = nextLedgerId();
    const invoice: LedgerEntry = {
      id: invoiceId,
      boater_id: r.boater_id,
      type: "invoice",
      number: nextInvoiceNumber(),
      date: today,
      amount: total,
      open_balance: total,
      method: null,
      status: "open",
      line_items: [
        {
          description: `Transient dockage · slip ${r.slip_id} · ${nights} night${nights === 1 ? "" : "s"} @ $${rate}`,
          amount: total,
        },
      ],
      gl_account: "Slip Fee Revenue",
      qb_sync_status: "pending",
      linked_reservation_id: id,
    };
    state = { ...state, ledger: [invoice, ...state.ledger] };
  }

  // Arrival comm — boater-facing, friendly tone
  const channel = boater.communication_prefs.preferred_channel;
  const commType: Communication["type"] = channel;
  const recipient =
    commType === "email"
      ? (boater.primary_contact.email ?? "")
      : (boater.primary_contact.phone ?? "");
  const subject =
    r.type === "transient"
      ? `Welcome to Marina Stee — you're in slip ${r.slip_id}`
      : `Checked in at slip ${r.slip_id}`;
  const body =
    r.type === "transient"
      ? `Hi ${boater.first_name},\n\n` +
        `Welcome aboard! Your boat is in slip ${r.slip_id} through ${r.departure_date}.\n\n` +
        `Power + water pedestal codes are on the dock box (last 4 of your phone).\n` +
        `Ice + provisions at the Ship Store, fuel at the Fuel Dock.\n\n` +
        `Reply to this thread if you need anything.\n\n` +
        `Marina Stee`
      : `Hi ${boater.first_name}, you're checked in at slip ${r.slip_id} for the season. Welcome back!`;
  state = {
    ...state,
    communications: [
      {
        id: `cm_arrival_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        boater_id: boater.id,
        type: commType,
        direction: "outbound",
        sender_label: "Marina Stee",
        sender_is_system: true,
        recipient,
        subject,
        body_preview: body.slice(0, 80),
        full_body: body,
        sent_at: now,
        status: "delivered",
        related_entity: invoiceId
          ? { type: "invoice", id: invoiceId }
          : { type: "reservation", id },
      },
      ...state.communications,
    ],
  };
  notify();
  return invoiceId;
}

/**
 * Transient check-out:
 *   - if there's a default card on file → close any open transient
 *     invoice (auto-pay) and post a Payment
 *   - dispatches a departure receipt comm
 *   - flips reservation.status → completed
 *   - auto-fires waitlist for the slip (next-in-line gets a claim link)
 *
 * Returns the receipt's invoice id when applicable.
 */
export function checkOutReservation(id: string): string | undefined {
  const r = state.reservations.find((x) => x.id === id);
  if (!r) return undefined;
  const boater = state.boaters.find((b) => b.id === r.boater_id);
  if (!boater) return undefined;
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // Status transition
  state = {
    ...state,
    reservations: state.reservations.map((x) =>
      x.id === id ? { ...x, status: "completed" as const } : x
    ),
  };

  // Try to auto-close any open invoice linked to this reservation
  let receiptInvoiceId: string | undefined;
  const openInvoice = state.ledger.find(
    (l) =>
      l.linked_reservation_id === id &&
      l.type === "invoice" &&
      l.open_balance > 0
  );
  const defaultCard = state.cardsByBoaterId[boater.id]?.find((c) => c.is_default);
  if (openInvoice && defaultCard) {
    // Post a Payment that closes out the invoice
    const paymentId = nextLedgerId();
    const payment: LedgerEntry = {
      id: paymentId,
      boater_id: boater.id,
      type: "payment",
      number: nextInvoiceNumber(),
      date: today,
      amount: openInvoice.open_balance,
      open_balance: 0,
      method: "card",
      status: "paid",
      applied_to_invoice_ids: [openInvoice.id],
      gl_account: "A/R",
      qb_sync_status: "pending",
      processor_ref: `auto_${defaultCard.id.slice(-6)}`,
    };
    state = {
      ...state,
      ledger: [
        payment,
        ...state.ledger.map((l) =>
          l.id === openInvoice.id
            ? { ...l, open_balance: 0, status: "paid" as const }
            : l
        ),
      ],
    };
    receiptInvoiceId = openInvoice.id;
  }

  // Departure comm — different copy based on transient vs annual
  const channel = boater.communication_prefs.preferred_channel;
  const commType: Communication["type"] = channel;
  const recipient =
    commType === "email"
      ? (boater.primary_contact.email ?? "")
      : (boater.primary_contact.phone ?? "");
  const balanceClosed = !!receiptInvoiceId;
  const subject =
    r.type === "transient"
      ? balanceClosed
        ? `Receipt — Marina Stee · slip ${r.slip_id}`
        : `Checked out — final balance pending`
      : `Checked out — see you next season`;
  const body =
    r.type === "transient"
      ? balanceClosed
        ? `Hi ${boater.first_name},\n\n` +
          `Thanks for staying with us! Your stay at slip ${r.slip_id} has been ` +
          `charged to your card on file. Receipt attached.\n\n` +
          `Come see us again,\nMarina Stee`
        : `Hi ${boater.first_name},\n\n` +
          `You're checked out from slip ${r.slip_id}. Your final balance is on file ` +
          `and will be processed shortly. We'll send a receipt as soon as it clears.\n\n` +
          `Marina Stee`
      : `Hi ${boater.first_name}, checked out from slip ${r.slip_id}. Hope to see you next season!`;
  state = {
    ...state,
    communications: [
      {
        id: `cm_depart_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        boater_id: boater.id,
        type: commType,
        direction: "outbound",
        sender_label: "Marina Stee",
        sender_is_system: true,
        recipient,
        subject,
        body_preview: body.slice(0, 80),
        full_body: body,
        sent_at: now,
        status: "delivered",
        related_entity: receiptInvoiceId
          ? { type: "invoice", id: receiptInvoiceId }
          : { type: "reservation", id },
      },
      ...state.communications,
    ],
  };

  notify();

  // Fire waitlist for the freed slip — transient only. Annual/seasonal
  // stay assigned and the slip isn't actually freed by a check-out.
  if (r.type === "transient" && r.slip_id) {
    queueMicrotask(() => {
      notifyWaitlistOfSlipOpening(r.slip_id);
    });
  }
  return receiptInvoiceId;
}

export function upsertReservation(r: Reservation) {
  const exists = state.reservations.some((x) => x.id === r.id);
  state = {
    ...state,
    reservations: exists
      ? state.reservations.map((x) => (x.id === r.id ? r : x))
      : [r, ...state.reservations],
  };
  notify();
}

export function deleteReservation(id: string) {
  state = { ...state, reservations: state.reservations.filter((r) => r.id !== id) };
  notify();
}

export function addBoater(b: Boater) {
  state = { ...state, boaters: [b, ...state.boaters] };
  notify();
}

export function upsertBoater(b: Boater) {
  const exists = state.boaters.some((x) => x.id === b.id);
  state = {
    ...state,
    boaters: exists
      ? state.boaters.map((x) => (x.id === b.id ? b : x))
      : [b, ...state.boaters],
  };
  notify();
}

export function addVessel(v: Vessel) {
  state = { ...state, vessels: [v, ...state.vessels] };
  notify();
}

export function upsertVessel(v: Vessel) {
  const exists = state.vessels.some((x) => x.id === v.id);
  state = {
    ...state,
    vessels: exists
      ? state.vessels.map((x) => (x.id === v.id ? v : x))
      : [v, ...state.vessels],
  };
  notify();
}

export function deleteVessel(id: string) {
  state = { ...state, vessels: state.vessels.filter((v) => v.id !== id) };
  notify();
}

export function addContract(c: Contract) {
  state = { ...state, contracts: [c, ...state.contracts] };
  notify();
}

export function upsertContract(c: Contract) {
  const exists = state.contracts.some((x) => x.id === c.id);
  state = {
    ...state,
    contracts: exists
      ? state.contracts.map((x) => (x.id === c.id ? c : x))
      : [c, ...state.contracts],
  };
  notify();
}

export function deleteContract(id: string) {
  state = { ...state, contracts: state.contracts.filter((c) => c.id !== id) };
  notify();
}

export function bulkAddContracts(contracts: Contract[]) {
  if (contracts.length === 0) return;
  state = { ...state, contracts: [...contracts, ...state.contracts] };
  notify();
}

export function updateContract(id: string, patch: Partial<Contract>) {
  // Detect a status transition INTO a slip-freeing state — terminated,
  // expired, or cancelled. If the contract holds a slip_id, fire the
  // waitlist auto-notify chain so the next-in-line gets a claim link
  // before the slip even hits the public Roster.
  const prev = state.contracts.find((c) => c.id === id);
  state = {
    ...state,
    contracts: state.contracts.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  };
  notify();
  if (
    prev &&
    patch.status &&
    patch.status !== prev.status &&
    (patch.status === "terminated" || patch.status === "expired") &&
    prev.slip_id
  ) {
    // Don't await — notifyWaitlistOfSlipOpening is synchronous in the
    // mock store, but we still wrap in a microtask so a Roster page
    // that subscribed to the contract update sees that change first
    // (one notify per turn keeps the UI animation clean).
    queueMicrotask(() => {
      notifyWaitlistOfSlipOpening(prev.slip_id!);
    });
  }
}

/**
 * Look up a contract by its signature_token. Used by /onboard/[token] to
 * resolve the boater's URL to the contract record without exposing IDs.
 */
export function getContractByToken(token: string): Contract | undefined {
  return state.contracts.find((c) => c.signature_token === token);
}

/**
 * Mint a fresh signature token and put the contract into `sent` state.
 * Idempotent — if the contract already has a token we keep it.
 */
export function mintContractSignatureToken(id: string): string | null {
  const existing = state.contracts.find((c) => c.id === id);
  if (!existing) return null;
  if (existing.signature_token) {
    // Idempotent — ensure status reflects "sent" but don't rotate the token.
    if (existing.status === "draft") {
      updateContract(id, { status: "sent" });
    }
    return existing.signature_token;
  }
  const token = `cont_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const now = new Date().toISOString();
  updateContract(id, {
    signature_token: token,
    status: "sent",
    onboarding: {
      ...(existing.onboarding ?? {}),
      link_sent_at: now,
    },
  });
  return token;
}

/**
 * Record an onboarding step completion. Centralizes the status
 * progression so the portal "Sign now," the public /onboard/[token]
 * flow, and the staff-side "Mark received" button all advance the
 * contract through the same gates.
 */
export function markContractOnboardingStep(
  id: string,
  step: keyof NonNullable<Contract["onboarding"]>,
  extra?: Partial<Contract>
) {
  const c = state.contracts.find((x) => x.id === id);
  if (!c) return;
  const now = new Date().toISOString();
  const nextOnboarding: NonNullable<Contract["onboarding"]> = {
    ...(c.onboarding ?? {}),
    [step]: now,
  };
  // Auto-promote status based on which gates are met.
  let nextStatus = c.status;
  if (step === "signed_at") {
    nextStatus = "executed";
  }
  if (nextOnboarding.signed_at && nextOnboarding.card_added_at) {
    // Both signature + card on file → ready to go active when the
    // effective_start date has arrived (or immediately if past).
    const startMs = new Date(c.effective_start).getTime();
    if (startMs <= Date.now()) nextStatus = "active";
  }
  updateContract(id, {
    ...extra,
    onboarding: nextOnboarding,
    status: nextStatus,
  });
}

// ── Templates CRUD ────────────────────────────────────────────
export function upsertTemplate(t: ContractTemplate) {
  const exists = state.templates.some((x) => x.id === t.id);
  state = {
    ...state,
    templates: exists
      ? state.templates.map((x) => (x.id === t.id ? t : x))
      : [t, ...state.templates],
  };
  notify();
}
export function deleteTemplate(id: string) {
  state = { ...state, templates: state.templates.filter((t) => t.id !== id) };
  notify();
}

// ── Meters CRUD ──────────────────────────────────────────────
export function upsertMeter(m: MeterReading) {
  const exists = state.meters.some((x) => x.id === m.id);
  state = {
    ...state,
    meters: exists ? state.meters.map((x) => (x.id === m.id ? m : x)) : [m, ...state.meters],
  };
  notify();
}
export function deleteMeter(id: string) {
  state = { ...state, meters: state.meters.filter((m) => m.id !== id) };
  notify();
}

// ── Rates CRUD ───────────────────────────────────────────────
export function upsertRate(r: Rate) {
  const exists = state.rates.some((x) => x.id === r.id);
  state = {
    ...state,
    rates: exists ? state.rates.map((x) => (x.id === r.id ? r : x)) : [r, ...state.rates],
  };
  notify();
}
export function deleteRate(id: string) {
  state = { ...state, rates: state.rates.filter((r) => r.id !== id) };
  notify();
}

// ── Fees CRUD ────────────────────────────────────────────────
export function upsertFee(f: AdditionalFee) {
  const exists = state.fees.some((x) => x.id === f.id);
  state = {
    ...state,
    fees: exists ? state.fees.map((x) => (x.id === f.id ? f : x)) : [f, ...state.fees],
  };
  notify();
}
export function deleteFee(id: string) {
  state = { ...state, fees: state.fees.filter((f) => f.id !== id) };
  notify();
}

// ── Rental Groups CRUD ───────────────────────────────────────
export function upsertRentalGroup(g: RentalGroup) {
  const exists = state.rentalGroups.some((x) => x.id === g.id);
  state = {
    ...state,
    rentalGroups: exists
      ? state.rentalGroups.map((x) => (x.id === g.id ? g : x))
      : [...state.rentalGroups, g],
  };
  notify();
}
export function deleteRentalGroup(id: string) {
  // Delete the group AND any spaces that belonged to it. Contracts/
  // reservations holding orphan slip_ids stay so audit history isn't lost.
  state = {
    ...state,
    rentalGroups: state.rentalGroups.filter((g) => g.id !== id),
    rentalSpaces: state.rentalSpaces.filter((s) => s.group_id !== id),
  };
  notify();
}

// ── Rental Spaces CRUD ───────────────────────────────────────
export function upsertRentalSpace(s: RentalSpace) {
  const exists = state.rentalSpaces.some((x) => x.id === s.id);
  state = {
    ...state,
    rentalSpaces: exists
      ? state.rentalSpaces.map((x) => (x.id === s.id ? s : x))
      : [...state.rentalSpaces, s],
  };
  notify();
}
export function deleteRentalSpace(id: string) {
  state = { ...state, rentalSpaces: state.rentalSpaces.filter((s) => s.id !== id) };
  notify();
}
export function nextRentalGroupId() {
  return `rg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}
export function nextRentalSpaceId() {
  return `rsp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

// ── Fuel inventory CRUD ──────────────────────────────────────
export function upsertFuelInventory(f: FuelInventory) {
  const exists = state.fuelInventory.some((x) => x.id === f.id);
  state = {
    ...state,
    fuelInventory: exists
      ? state.fuelInventory.map((x) => (x.id === f.id ? f : x))
      : [...state.fuelInventory, f],
  };
  notify();
}

export function addMarinaEvent(e: MarinaEvent) {
  state = { ...state, events: [e, ...state.events] };
  notify();
}

export function toggleEventRsvp(eventId: string, boaterId: string) {
  state = {
    ...state,
    events: state.events.map((e) => {
      if (e.id !== eventId) return e;
      const has = e.rsvp_boater_ids.includes(boaterId);
      return {
        ...e,
        rsvp_boater_ids: has
          ? e.rsvp_boater_ids.filter((id) => id !== boaterId)
          : [...e.rsvp_boater_ids, boaterId],
      };
    }),
  };
  notify();
}

export function deleteMarinaEvent(id: string) {
  state = { ...state, events: state.events.filter((e) => e.id !== id) };
  notify();
}

export function addStaffNote(n: StaffNote) {
  state = { ...state, staffNotes: [n, ...state.staffNotes] };
  notify();
}

export function toggleStaffNotePin(id: string) {
  state = {
    ...state,
    staffNotes: state.staffNotes.map((n) =>
      n.id === id ? { ...n, pinned: !n.pinned } : n
    ),
  };
  notify();
}

export function deleteStaffNote(id: string) {
  state = { ...state, staffNotes: state.staffNotes.filter((n) => n.id !== id) };
  notify();
}

export function addWaitlistEntry(e: WaitlistEntry) {
  state = { ...state, waitlist: [e, ...state.waitlist] };
  notify();
}

export function getWaitlistByClaimToken(token: string): WaitlistEntry | undefined {
  return state.waitlist.find((w) => w.claim_token === token);
}

/**
 * Slip just opened — fan out a time-limited offer to the top N
 * matching waitlisters. Each entry gets a fresh claim_token, status
 * flips to "offered" with offer_expires_at = now + windowHours, and
 * an outbound Communication is dispatched.
 *
 * Matching heuristic: same reservation_type + LOA fits the slip's max
 * + (optionally) preferred_dock matches the slip's dock. Sorted by
 * created_at so the oldest waitlister wins the race fairly.
 *
 * Returns the list of offered entry ids.
 */
export function notifyWaitlistOfSlipOpening(
  slipId: string,
  opts: { topN?: number; windowHours?: number } = {}
): string[] {
  const slip = state.rentalSpaces.find((s) => s.id === slipId);
  const altSlip = !slip
    ? // Roster uses SLIPS-style ids ("A01"); accept either source
      undefined
    : undefined;
  if (!slip && !altSlip) return [];

  const topN = opts.topN ?? 5;
  const windowHours = opts.windowHours ?? 24;
  const reservationType: WaitlistEntry["reservation_type"] | undefined =
    slip?.occupancy_type === "Standard" ? "annual" : "transient";
  const slipLOA = slip?.length_inches ?? Infinity;
  const slipDock = slip?.group_id ?? "";

  const candidates = state.waitlist
    .filter((w) => w.status === "pending")
    .filter((w) => !reservationType || w.reservation_type === reservationType)
    .filter((w) => !w.loa_inches || w.loa_inches <= slipLOA)
    .filter((w) => !w.preferred_dock || w.preferred_dock === slipDock)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, topN);

  if (candidates.length === 0) return [];

  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowHours * 3_600_000).toISOString();
  const offered: string[] = [];

  // Pre-build all token + comm updates as one notify pass.
  const updatedWaitlist = state.waitlist.map((w) => {
    if (!candidates.some((c) => c.id === w.id)) return w;
    const token = `claim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    offered.push(w.id);
    return {
      ...w,
      status: "offered" as const,
      offered_slip_id: slipId,
      offered_at: now.toISOString(),
      offer_expires_at: expiresAt,
      claim_token: token,
    };
  });

  const newComms: Communication[] = [];
  for (const w of updatedWaitlist) {
    if (!offered.includes(w.id)) continue;
    const url = `/claim/${w.claim_token}`;
    // Resolve recipient — boater_id wins, else guest_email / guest_phone
    let commType: Communication["type"] = "email";
    let recipient = "";
    let displayFirst = "";
    if (w.boater_id) {
      const b = state.boaters.find((x) => x.id === w.boater_id);
      if (b) {
        commType = b.communication_prefs.preferred_channel;
        recipient =
          commType === "email"
            ? (b.primary_contact.email ?? "")
            : (b.primary_contact.phone ?? "");
        displayFirst = b.first_name;
      }
    } else {
      if (w.guest_email) {
        commType = "email";
        recipient = w.guest_email;
      } else if (w.guest_phone) {
        commType = "sms";
        recipient = w.guest_phone;
      }
      displayFirst = (w.guest_name ?? "").split(/\s+/)[0] ?? "there";
    }

    newComms.push({
      id: `cm_waitlist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      boater_id: w.boater_id ?? `waitlist:${w.id}`,
      type: commType,
      direction: "outbound",
      sender_label: "Marina Stee",
      sender_is_system: true,
      recipient,
      subject: `Slip just opened — first to claim wins`,
      body_preview: `${slipId} matches your waitlist request. Tap to claim — expires in ${windowHours}h.`,
      full_body:
        `Hi ${displayFirst},\n\n` +
        `A slip just opened up that matches what you asked for on the waitlist:\n\n` +
        `  Slip:       ${slipId}\n` +
        `  Dock:       ${slipDock}\n` +
        (slip?.length_inches ? `  Max LOA:    ${Math.round(slip.length_inches / 12)}'\n` : "") +
        (slip?.has_power ? `  Power:      Yes\n` : "") +
        (slip?.has_water ? `  Water:      Yes\n` : "") +
        `\n` +
        `First to confirm gets it — this offer expires in ${windowHours} hours.\n\n` +
        `Claim it: ${url}\n\n` +
        `Marina Stee`,
      sent_at: now.toISOString(),
      status: "delivered",
      related_entity: { type: "reservation", id: slipId },
    });
  }

  state = {
    ...state,
    waitlist: updatedWaitlist,
    communications: [...newComms, ...state.communications],
  };
  notify();
  return offered;
}

/**
 * Customer accepted their waitlist offer.
 *
 * If we already know who they are (boater_id is set), this is the
 * agentic path — we auto-mint a draft Contract for the offered slip,
 * mint a signature_token, and dispatch the onboarding chain (the same
 * chain the slip-assignment wizard kicks off). Returns the onboarding
 * token so the /claim page can route the customer straight to their
 * /onboard/[token] surface.
 *
 * If they're a guest (no boater_id), we just drop a staff-side comm —
 * onboarding a brand-new holder needs a Boater + Vessel record first
 * and that's the staff white-glove path.
 */
export function claimWaitlistOffer(token: string): {
  entry: WaitlistEntry;
  onboardToken?: string;
} | null {
  const entry = state.waitlist.find((w) => w.claim_token === token);
  if (!entry || entry.status !== "offered") return null;
  if (entry.offer_expires_at && new Date(entry.offer_expires_at).getTime() < Date.now()) {
    // Expired in flight — mark it so staff sees why.
    state = {
      ...state,
      waitlist: state.waitlist.map((w) =>
        w.id === entry.id ? { ...w, status: "expired" } : w
      ),
    };
    notify();
    return null;
  }

  const now = new Date().toISOString();
  let convertedContractId: string | undefined;
  let onboardToken: string | undefined;

  // ── Agentic path: existing boater + a real slip → auto-mint contract
  const boater = state.boaters.find((b) => b.id === entry.boater_id);
  if (boater && entry.offered_slip_id) {
    const template = state.templates[0]; // pick a sensible default
    // Default the term to one year from arrival (or today if no arrival
    // preference). Annual marina conventions.
    const start =
      entry.preferred_arrival ?? new Date().toISOString().slice(0, 10);
    const startMs = new Date(start).getTime();
    const end = new Date(startMs + 365 * 86_400_000).toISOString().slice(0, 10);
    const contract: Contract = {
      id: nextContractId(),
      number: nextContractNumber(),
      boater_id: boater.id,
      template_id: template?.id ?? "tpl_default",
      template_version: template?.version ?? 1,
      vessel_id: state.vessels.find((v) => v.boater_id === boater.id)?.id,
      slip_id: entry.offered_slip_id,
      status: "draft",
      effective_start: start,
      effective_end: end,
      billing_cadence:
        entry.reservation_type === "annual"
          ? "annual"
          : entry.reservation_type === "seasonal"
          ? "seasonal"
          : entry.reservation_type === "monthly"
          ? "monthly"
          : "transient",
    };
    state = { ...state, contracts: [contract, ...state.contracts] };
    convertedContractId = contract.id;

    // Mint signature token + dispatch onboarding comm — this is the
    // same chain the slip-assignment wizard uses, just triggered from
    // a different upstream event.
    const minted = mintContractSignatureToken(contract.id);
    if (minted) {
      onboardToken = minted;
      const url = `/onboard/${minted}`;
      const commType: Communication["type"] = boater.communication_prefs.preferred_channel;
      const recipient =
        commType === "email"
          ? (boater.primary_contact.email ?? "")
          : (boater.primary_contact.phone ?? "");
      state = {
        ...state,
        communications: [
          {
            id: `cm_claim_onb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            boater_id: boater.id,
            type: commType,
            direction: "outbound",
            sender_label: "Marina Stee",
            sender_is_system: true,
            recipient,
            subject: `Welcome to your slip ${entry.offered_slip_id} — complete onboarding`,
            body_preview: `Sign your contract + add a card: ${url}`,
            full_body:
              `Hi ${boater.first_name},\n\nThanks for claiming slip ${entry.offered_slip_id}! ` +
              `Two quick steps to activate:\n\n  1. Review + sign your contract\n  2. Add a card on file\n\n` +
              `Takes about 2 minutes: ${url}\n\nMarina Stee`,
            sent_at: now,
            status: "delivered",
            related_entity: { type: "contract", id: contract.id },
          },
          ...state.communications,
        ],
      };
    }
  }

  // ── Always: flip the waitlist entry to converted
  state = {
    ...state,
    waitlist: state.waitlist.map((w) =>
      w.id === entry.id
        ? {
            ...w,
            status: "converted" as const,
            converted_contract_id: convertedContractId,
          }
        : w
    ),
  };

  // ── Staff-side notification — surfaces in Inbox + dashboard feed
  const customerName = boater?.display_name ?? entry.guest_name ?? "Waitlist customer";
  const staffNote: Communication = {
    id: `cm_claim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    boater_id: boater?.id ?? `waitlist:${entry.id}`,
    type: "email",
    direction: "inbound",
    sender_label: customerName,
    sender_is_system: false,
    recipient: "Marina Stee",
    subject: `Waitlist claim — slip ${entry.offered_slip_id ?? "?"}`,
    body_preview: convertedContractId
      ? `${customerName} claimed slip ${entry.offered_slip_id} — contract ${convertedContractId} drafted and onboarding link sent.`
      : `${customerName} claimed slip ${entry.offered_slip_id}. New customer — set up the Boater record before drafting their contract.`,
    full_body: convertedContractId
      ? `${customerName} accepted slip ${entry.offered_slip_id}. Draft contract auto-created (${convertedContractId}) ` +
        `and onboarding link sent. Monitor the progress rail on their holder page.`
      : `${customerName} accepted slip ${entry.offered_slip_id}. They're a new customer — create their Boater + Vessel records, ` +
        `then run the slip-assignment wizard to draft a contract.`,
    sent_at: now,
    status: "delivered",
    related_entity: convertedContractId
      ? { type: "contract", id: convertedContractId }
      : { type: "reservation", id: entry.offered_slip_id ?? entry.id },
  };
  state = { ...state, communications: [staffNote, ...state.communications] };
  notify();
  return { entry, onboardToken };
}

export function updateWaitlistStatus(
  id: string,
  status: WaitlistStatus,
  extra?: { offered_slip_id?: string; converted_reservation_id?: string }
) {
  state = {
    ...state,
    waitlist: state.waitlist.map((w) =>
      w.id === id
        ? {
            ...w,
            status,
            offered_slip_id: extra?.offered_slip_id ?? w.offered_slip_id,
            offered_at: status === "offered" ? new Date().toISOString() : w.offered_at,
            converted_reservation_id:
              extra?.converted_reservation_id ?? w.converted_reservation_id,
          }
        : w
    ),
  };
  notify();
}

export function addInsuranceCertificate(coi: InsuranceCertificate) {
  state = { ...state, insurance: [coi, ...state.insurance] };
  notify();
}

/**
 * Look up a COI by its public upload_token. Used by /coi-upload/[token]
 * to resolve a boater-facing renewal URL to the original certificate.
 */
export function getInsuranceByUploadToken(token: string): InsuranceCertificate | undefined {
  return state.insurance.find((c) => c.upload_token === token);
}

/**
 * Mint a fresh upload token and dispatch an outbound Comm asking the
 * boater to upload a new COI. Idempotent — if a token already exists
 * we reuse it. Mirrors mintContractSignatureToken / mintBookingPickupToken.
 */
export function requestCoiRenewal(coiId: string): string | null {
  const existing = state.insurance.find((c) => c.id === coiId);
  if (!existing) return null;
  const now = new Date().toISOString();
  const token =
    existing.upload_token ??
    `coi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  // Stamp the token + link_sent_at
  state = {
    ...state,
    insurance: state.insurance.map((c) =>
      c.id === coiId
        ? { ...c, upload_token: token, upload_link_sent_at: now }
        : c
    ),
  };

  // Dispatch boater-facing comm
  const boater = state.boaters.find((b) => b.id === existing.boater_id);
  const vessel = state.vessels.find((v) => v.id === existing.vessel_id);
  if (boater) {
    const channel = boater.communication_prefs.preferred_channel;
    const commType: Communication["type"] = channel;
    const recipient =
      commType === "email"
        ? (boater.primary_contact.email ?? "")
        : (boater.primary_contact.phone ?? "");
    const url = `/coi-upload/${token}`;
    state = {
      ...state,
      communications: [
        {
          id: `cm_coi_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          boater_id: boater.id,
          type: commType,
          direction: "outbound",
          sender_label: "Marina Stee",
          sender_is_system: true,
          recipient,
          subject: `COI renewal needed${vessel ? ` — ${vessel.name}` : ""}`,
          body_preview: `Your insurance expires ${existing.effective_end}. Upload the new COI here: ${url}`,
          full_body:
            `Hi ${boater.first_name},\n\n` +
            `Your ${vessel?.name ?? "vessel"}'s certificate of insurance expires on ` +
            `${existing.effective_end}. Please upload the renewed COI here:\n\n${url}\n\n` +
            `Takes about a minute — just drop the PDF and confirm the new effective dates.\n\n` +
            `Marina Stee`,
          sent_at: now,
          status: "delivered",
          related_entity: { type: "invoice", id: existing.id },
        },
        ...state.communications,
      ],
    };
  }

  notify();
  return token;
}

/**
 * Step beat for the COI upload flow. Mirrors markContractOnboardingStep —
 * "viewed" gets stamped when the boater opens /coi-upload/[token].
 */
export function markCoiUploadStep(
  coiId: string,
  step: "viewed",
): void {
  const now = new Date().toISOString();
  state = {
    ...state,
    insurance: state.insurance.map((c) =>
      c.id === coiId
        ? { ...c, upload_link_viewed_at: step === "viewed" ? now : c.upload_link_viewed_at }
        : c
    ),
  };
  notify();
}

/**
 * Boater submits a new COI via /coi-upload/[token]. Creates a fresh
 * InsuranceCertificate (uploaded_by: "boater"), back-links the
 * original via renewed_by_coi_id, and drops an inbound Comm so staff
 * sees the renewal land.
 */
export function submitRenewedCoi(
  originalId: string,
  data: {
    carrier: string;
    policy_number: string;
    liability_limit: number;
    hull_value?: number;
    effective_start: string;
    effective_end: string;
    pdf_url?: string;
  }
): InsuranceCertificate | null {
  const original = state.insurance.find((c) => c.id === originalId);
  if (!original) return null;
  const now = new Date().toISOString();
  const newCoi: InsuranceCertificate = {
    id: `coi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    vessel_id: original.vessel_id,
    boater_id: original.boater_id,
    carrier: data.carrier,
    policy_number: data.policy_number,
    liability_limit: data.liability_limit,
    hull_value: data.hull_value,
    effective_start: data.effective_start,
    effective_end: data.effective_end,
    pdf_url: data.pdf_url,
    uploaded_at: now,
    uploaded_by: "boater",
  };
  state = {
    ...state,
    insurance: [
      newCoi,
      ...state.insurance.map((c) =>
        c.id === originalId ? { ...c, renewed_by_coi_id: newCoi.id } : c
      ),
    ],
  };

  // Inbound comm to staff
  const boater = state.boaters.find((b) => b.id === original.boater_id);
  const vessel = state.vessels.find((v) => v.id === original.vessel_id);
  if (boater) {
    state = {
      ...state,
      communications: [
        {
          id: `cm_coi_in_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          boater_id: boater.id,
          type: "email",
          direction: "inbound",
          sender_label: boater.display_name,
          sender_is_system: false,
          recipient: "Marina Stee",
          subject: `New COI uploaded${vessel ? ` — ${vessel.name}` : ""}`,
          body_preview: `${boater.first_name} submitted renewed COI · ${data.carrier} · expires ${data.effective_end}.`,
          full_body:
            `${boater.display_name} submitted a renewed certificate of insurance for ` +
            `${vessel?.name ?? "their vessel"}.\n\n` +
            `Carrier: ${data.carrier}\nPolicy: ${data.policy_number}\n` +
            `Effective: ${data.effective_start} → ${data.effective_end}\n` +
            `Liability: $${data.liability_limit.toLocaleString()}\n`,
          sent_at: now,
          status: "delivered",
          related_entity: { type: "invoice", id: newCoi.id },
        },
        ...state.communications,
      ],
    };
  }

  notify();
  return newCoi;
}

export function upsertInsuranceCertificate(coi: InsuranceCertificate) {
  const exists = state.insurance.some((x) => x.id === coi.id);
  state = {
    ...state,
    insurance: exists
      ? state.insurance.map((x) => (x.id === coi.id ? coi : x))
      : [coi, ...state.insurance],
  };
  notify();
}

export function deleteInsuranceCertificate(id: string) {
  state = { ...state, insurance: state.insurance.filter((c) => c.id !== id) };
  notify();
}

export function addCardForBoater(boaterId: string, card: CardOnFile) {
  const existing = state.cardsByBoaterId[boaterId] ?? [];
  // If the new card is_default, unset any existing default
  const next = card.is_default
    ? existing.map((c) => ({ ...c, is_default: false }))
    : existing;
  state = {
    ...state,
    cardsByBoaterId: { ...state.cardsByBoaterId, [boaterId]: [card, ...next] },
  };
  notify();
}

export function upsertCardForBoater(boaterId: string, card: CardOnFile) {
  const existing = state.cardsByBoaterId[boaterId] ?? [];
  const exists = existing.some((c) => c.id === card.id);
  // Enforce default mutex — only one card can be the default.
  const updated = exists
    ? existing.map((c) => {
        if (c.id === card.id) return card;
        return card.is_default ? { ...c, is_default: false } : c;
      })
    : (card.is_default ? existing.map((c) => ({ ...c, is_default: false })) : existing).concat(card);
  state = {
    ...state,
    cardsByBoaterId: { ...state.cardsByBoaterId, [boaterId]: updated },
  };
  notify();
}

export function deleteCardForBoater(boaterId: string, cardId: string) {
  const existing = state.cardsByBoaterId[boaterId] ?? [];
  state = {
    ...state,
    cardsByBoaterId: { ...state.cardsByBoaterId, [boaterId]: existing.filter((c) => c.id !== cardId) },
  };
  notify();
}

// ----- hooks -----

export function useStore(): State {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useLedgerForBoater(boaterId: string): LedgerEntry[] {
  const s = useStore();
  return s.ledger.filter((l) => l.boater_id === boaterId);
}

export function usePosOrders(): PosOrder[] {
  return useStore().posOrders;
}

export function useCommunicationsForBoater(boaterId: string): Communication[] {
  const s = useStore();
  return s.communications.filter((c) => c.boater_id === boaterId);
}

export function useWorkOrders(): WorkOrder[] {
  return useStore().workOrders;
}

export function useWorkOrdersForBoater(boaterId: string): WorkOrder[] {
  const s = useStore();
  return s.workOrders.filter((w) => w.boater_id === boaterId);
}

export function useReservations(): Reservation[] {
  return useStore().reservations;
}

export function useReservationsForBoater(boaterId: string): Reservation[] {
  const s = useStore();
  return s.reservations.filter((r) => r.boater_id === boaterId);
}

export function useBoaters(): Boater[] {
  return useStore().boaters;
}

export function useVesselsForBoater(boaterId: string): Vessel[] {
  const s = useStore();
  return s.vessels.filter((v) => v.boater_id === boaterId || v.co_owner_ids.includes(boaterId));
}

export function useContracts(): Contract[] {
  return useStore().contracts;
}

export function useContractsForBoater(boaterId: string): Contract[] {
  const s = useStore();
  return s.contracts.filter((c) => c.boater_id === boaterId);
}

export function useCardsForBoater(boaterId: string): CardOnFile[] {
  const s = useStore();
  return s.cardsByBoaterId[boaterId] ?? [];
}

export function useWaitlist(): WaitlistEntry[] {
  return useStore().waitlist;
}

export function useMarinaEvents(): MarinaEvent[] {
  return useStore().events;
}

export function useRates(): Rate[] {
  return useStore().rates;
}

export function useFees(): AdditionalFee[] {
  return useStore().fees;
}

export function useContractTemplates(): ContractTemplate[] {
  return useStore().templates;
}

export function useMeters(): MeterReading[] {
  return useStore().meters;
}

export function useRentalGroups(): RentalGroup[] {
  return useStore().rentalGroups;
}

export function useRentalSpaces(): RentalSpace[] {
  return useStore().rentalSpaces;
}

export function useRentalSpacesForGroup(groupId: string): RentalSpace[] {
  return useStore().rentalSpaces.filter((s) => s.group_id === groupId);
}

export function useFuelInventory(): FuelInventory[] {
  return useStore().fuelInventory;
}

export function useStaffNotesForBoater(boaterId: string): StaffNote[] {
  const s = useStore();
  return s.staffNotes.filter((n) => n.boater_id === boaterId);
}

export function useInsuranceForBoater(boaterId: string): InsuranceCertificate[] {
  const s = useStore();
  return s.insurance.filter((c) => c.boater_id === boaterId);
}

export function useInsuranceForVessel(vesselId: string): InsuranceCertificate[] {
  const s = useStore();
  return s.insurance.filter((c) => c.vessel_id === vesselId);
}

// ── Boat Rentals (own-fleet) ─────────────────────────────────

export function upsertRentalBoat(b: RentalBoat) {
  const exists = state.rentalBoats.some((x) => x.id === b.id);
  state = {
    ...state,
    rentalBoats: exists
      ? state.rentalBoats.map((x) => (x.id === b.id ? b : x))
      : [b, ...state.rentalBoats],
  };
  notify();
}

export function deleteRentalBoat(id: string) {
  state = {
    ...state,
    rentalBoats: state.rentalBoats.filter((b) => b.id !== id),
  };
  notify();
}

export function addBoatRental(r: BoatRental) {
  state = { ...state, boatRentals: [r, ...state.boatRentals] };
  notify();
}

export function upsertBoatRental(r: BoatRental) {
  const exists = state.boatRentals.some((x) => x.id === r.id);
  state = {
    ...state,
    boatRentals: exists
      ? state.boatRentals.map((x) => (x.id === r.id ? r : x))
      : [r, ...state.boatRentals],
  };
  notify();
}

export function updateBoatRental(id: string, patch: Partial<BoatRental>) {
  state = {
    ...state,
    boatRentals: state.boatRentals.map((r) =>
      r.id === id ? { ...r, ...patch, updated_at: new Date().toISOString() } : r
    ),
  };
  notify();
}

export function deleteBoatRental(id: string) {
  state = { ...state, boatRentals: state.boatRentals.filter((r) => r.id !== id) };
  notify();
}

/**
 * Look up a booking by its public pickup_token. Used by /pickup/[token]
 * to resolve the customer's URL to the booking record.
 */
export function getBoatRentalByToken(token: string): BoatRental | undefined {
  return state.boatRentals.find((r) => r.pickup_token === token);
}

/**
 * Mint a fresh pickup token + stamp link_sent_at. Idempotent — if the
 * booking already has a token we keep it and just bump the timestamp
 * so a "resend" still moves the rail.
 */
export function mintBookingPickupToken(id: string): string | null {
  const existing = state.boatRentals.find((r) => r.id === id);
  if (!existing) return null;
  const now = new Date().toISOString();
  if (existing.pickup_token) {
    updateBoatRental(id, {
      checkin: { ...existing.checkin, link_sent_at: now },
    });
    return existing.pickup_token;
  }
  const token = `pickup_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  updateBoatRental(id, {
    pickup_token: token,
    checkin: { ...existing.checkin, link_sent_at: now },
  });
  return token;
}

/**
 * Record a pickup/checkin step completion. Centralizes the status
 * progression so the staff-side "Mark checked out" button, the public
 * /pickup/[token] flow, and the dockhand /dock surface all advance
 * the booking through the same gates:
 *
 *   reserved   → confirmed     when signed + deposit on file
 *   confirmed  → checked_out   when checked_out_at stamped
 *   checked_out → returned     when returned_at stamped
 *   returned    → closed       (separate explicit step — final charges)
 */
export function markBookingCheckinStep(
  id: string,
  step: keyof BoatRental["checkin"],
  extra?: Partial<BoatRental>
) {
  const r = state.boatRentals.find((x) => x.id === id);
  if (!r) return;
  const now = new Date().toISOString();
  const nextCheckin: BoatRental["checkin"] = {
    ...r.checkin,
    [step]: now,
  };
  let nextStatus = r.status;
  if (
    nextCheckin.agreement_signed_at &&
    nextCheckin.deposit_authorized_at &&
    r.status === "reserved"
  ) {
    nextStatus = "confirmed";
  }
  if (step === "checked_out_at") nextStatus = "checked_out";
  if (step === "returned_at") nextStatus = "returned";
  updateBoatRental(id, {
    ...extra,
    checkin: nextCheckin,
    status: nextStatus,
  });
}

/**
 * Final-charge calculator + closeout. Called when the dockhand records
 * the boat back on /dock (or staff hits "Close" on the booking detail).
 *
 * Computes:
 *   - fuel charge = gallons consumed × current pump price
 *   - damage charge = whatever the dockhand entered
 *   - late fee = $50 per half-hour past scheduled end
 * Then:
 *   - posts an invoice to the ledger (boater account or walk-in synth)
 *   - dispatches a receipt Communication
 *   - flips the BoatRental to "closed"
 *
 * Returns the new invoice id so callers can deep-link to the ledger drawer.
 */
export function closeBoatRental(
  id: string,
  inputs: {
    fuel_in_pct?: number;
    hours_in?: number;
    damage_notes?: string;
    damage_charge?: number;
    returned_at?: string;
  }
): string | null {
  const r = state.boatRentals.find((x) => x.id === id);
  if (!r) return null;
  const boat = state.rentalBoats.find((b) => b.id === r.boat_id);
  if (!boat) return null;

  const now = inputs.returned_at ?? new Date().toISOString();

  // Fuel: gallons consumed = (out% - in%) × capacity. Charge at current
  // gas pump price (boat rentals use gasoline). If no fuel data, $0.
  let fuelCharge = 0;
  if (
    boat.fuel_capacity_gal &&
    r.fuel_out_pct != null &&
    inputs.fuel_in_pct != null
  ) {
    const consumedPct = Math.max(0, r.fuel_out_pct - inputs.fuel_in_pct);
    const consumedGal = (consumedPct / 100) * boat.fuel_capacity_gal;
    const gasInv = state.fuelInventory.find((f) => f.fuel_type === "gasoline");
    const pricePerGal = gasInv?.current_price_per_gallon ?? 4.5;
    fuelCharge = +(consumedGal * pricePerGal).toFixed(2);
    // Refueling fee if returned below 25%
    if (inputs.fuel_in_pct < 25) fuelCharge += 25;
  }

  // Late fee: $50 per half hour past scheduled end
  const lateMs = new Date(now).getTime() - new Date(r.end_at).getTime();
  const lateFee = lateMs > 0 ? Math.ceil(lateMs / (30 * 60_000)) * 50 : 0;

  const damageCharge = inputs.damage_charge ?? 0;
  const finalTotal = +(r.base_amount + fuelCharge + damageCharge + lateFee).toFixed(2);

  // Build the invoice + receipt. For walk-ins, boater_id is synthetic
  // (`walk_in:<rentalId>`) but the ledger still records it for audit.
  const ledgerOwner = r.boater_id ?? `walk_in:${r.id}`;
  const invoiceId = nextLedgerId();
  const invoiceNumber = nextInvoiceNumber();
  const lineItems: { description: string; amount: number }[] = [
    { description: `${boat.name} rental — base`, amount: r.base_amount },
  ];
  if (fuelCharge > 0) lineItems.push({ description: "Fuel + refueling", amount: fuelCharge });
  if (damageCharge > 0) lineItems.push({ description: "Damage assessment", amount: damageCharge });
  if (lateFee > 0) lineItems.push({ description: "Late return fee", amount: lateFee });

  const invoice: LedgerEntry = {
    id: invoiceId,
    boater_id: ledgerOwner,
    type: "invoice",
    number: invoiceNumber,
    date: now.slice(0, 10),
    amount: finalTotal,
    open_balance: 0,            // deposit + card-on-file auto-pays
    method: "card",
    status: "paid",
    line_items: lineItems,
    gl_account: "Boat Rental Revenue",
    qb_sync_status: "pending",
  };
  state = { ...state, ledger: [invoice, ...state.ledger] };

  // Receipt comm
  const recipient =
    state.boaters.find((b) => b.id === r.boater_id)?.primary_contact.email ??
    r.patron_email ??
    r.patron_phone ??
    "—";
  const commType: Communication["type"] = recipient.includes("@") ? "email" : "sms";
  const customerFirst =
    state.boaters.find((b) => b.id === r.boater_id)?.first_name ??
    (r.patron_name ?? "").trim().split(/\s+/)[0] ??
    "there";
  const receipt: Communication = {
    id: `cm_close_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    boater_id: ledgerOwner,
    type: commType,
    direction: "outbound",
    sender_label: "Marina Stee",
    sender_is_system: true,
    recipient,
    subject: `Receipt — ${r.number} · ${boat.name}`,
    body_preview: `${customerFirst}, your ${boat.name} rental closed at ${finalTotal.toFixed(2)}.`,
    full_body:
      `Hi ${customerFirst},\n\nThanks for renting the ${boat.name}!\n\n` +
      lineItems.map((l) => `  ${l.description.padEnd(30, " ")} $${l.amount.toFixed(2)}`).join("\n") +
      `\n  ${"─".repeat(40)}\n  ${"TOTAL".padEnd(30, " ")} $${finalTotal.toFixed(2)}\n\n` +
      `Charged to card ending **** on file. Your deposit of $${r.deposit_hold.toFixed(2)} has been released.\n\n` +
      `Come see us again,\nMarina Stee`,
    sent_at: now,
    status: "delivered",
    related_entity: { type: "invoice", id: invoiceId },
  };
  state = { ...state, communications: [receipt, ...state.communications] };

  // Bump boat fuel snapshot + status back to available
  if (inputs.fuel_in_pct != null) {
    state = {
      ...state,
      rentalBoats: state.rentalBoats.map((b) =>
        b.id === boat.id
          ? {
              ...b,
              current_fuel_pct: inputs.fuel_in_pct,
              hour_meter_reading: inputs.hours_in ?? b.hour_meter_reading,
              status: "available",
              updated_at: now,
            }
          : b
      ),
    };
  }

  // Close the booking
  state = {
    ...state,
    boatRentals: state.boatRentals.map((x) =>
      x.id === id
        ? {
            ...x,
            fuel_in_pct: inputs.fuel_in_pct,
            hours_in: inputs.hours_in,
            damage_notes: inputs.damage_notes,
            fuel_charge: fuelCharge,
            damage_charge: damageCharge,
            late_fee: lateFee,
            final_total: finalTotal,
            status: "closed",
            checkin: { ...x.checkin, returned_at: now },
            related_ledger_entry_id: invoiceId,
            updated_at: now,
          }
        : x
    ),
  };
  notify();
  return invoiceId;
}

// ── hooks (Boat Rentals) ─────────────────────────────────────

export function useRentalBoats(): RentalBoat[] {
  return useStore().rentalBoats;
}

export function useBoatRentals(): BoatRental[] {
  return useStore().boatRentals;
}

export function useBoatRentalsForBoat(boatId: string): BoatRental[] {
  return useStore().boatRentals.filter((r) => r.boat_id === boatId);
}

export function useBoatRentalsForBoater(boaterId: string): BoatRental[] {
  return useStore().boatRentals.filter((r) => r.boater_id === boaterId);
}

// ----- id generators -----

let _seq = 9000;
function nextNum(prefix: string) {
  _seq += 1;
  return `${prefix}${_seq}`;
}

export function nextLedgerId() {
  return `le_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function nextInvoiceNumber() {
  return nextNum("MG");
}

export function nextPosOrderId() {
  return `po_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function nextPosOrderNumber() {
  return nextNum("P-");
}

export function nextWorkOrderId() {
  return `wo_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
export function nextWorkOrderNumber() {
  return nextNum("WO-");
}

export function nextReservationId() {
  return `r_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
export function nextReservationNumber() {
  return nextNum("R");
}

export function nextBoaterId() {
  return `b_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function nextVesselId() {
  return `v_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function nextContractId() {
  return `c_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
export function nextContractNumber() {
  return nextNum("C-");
}

export function nextRentalBoatId() {
  return `rb_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function nextBoatRentalId() {
  return `br_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
export function nextBoatRentalNumber() {
  return nextNum("BR-");
}

export function nextCardId() {
  return `card_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function nextCoiId() {
  return `coi_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function nextWaitlistId() {
  return `wl_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function nextStaffNoteId() {
  return `sn_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function nextEventId() {
  return `ev_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function nextRateId() {
  return `rate_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function nextFeeId() {
  return `fee_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function nextTemplateId() {
  return `tpl_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function nextMeterId() {
  return `m_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
