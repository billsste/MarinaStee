"use client";

import { useSyncExternalStore } from "react";
import {
  BOATERS,
  CARDS_ON_FILE,
  COMMUNICATIONS,
  CONTRACTS,
  LEDGER,
  POS_LOCATIONS,
  POS_ORDERS,
  RESERVATIONS,
  VESSELS,
  WORK_ORDERS,
} from "@/lib/mock-data";
import type {
  Boater,
  CardOnFile,
  Communication,
  Contract,
  LedgerEntry,
  PosOrder,
  QbSyncStatus,
  Reservation,
  Vessel,
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

export function addBoater(b: Boater) {
  state = { ...state, boaters: [b, ...state.boaters] };
  notify();
}

export function addVessel(v: Vessel) {
  state = { ...state, vessels: [v, ...state.vessels] };
  notify();
}

export function addContract(c: Contract) {
  state = { ...state, contracts: [c, ...state.contracts] };
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

export function useContractsForBoater(boaterId: string): Contract[] {
  const s = useStore();
  return s.contracts.filter((c) => c.boater_id === boaterId);
}

export function useCardsForBoater(boaterId: string): CardOnFile[] {
  const s = useStore();
  return s.cardsByBoaterId[boaterId] ?? [];
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
