"use client";

import { useSyncExternalStore } from "react";
import {
  ADDITIONAL_FEES,
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
  RATES,
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
  state = {
    ...state,
    contracts: state.contracts.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  };
  notify();
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
