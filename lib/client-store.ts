"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  ADDITIONAL_FEES,
  ALL_COMM_TEMPLATES,
  ALL_PICKLISTS,
  ALL_PROVIDER_CONFIGS,
  ALL_ROLES,
  ALL_STAFF,
  // Back office seeds
  SHIFTS_SEED,
  TIME_ENTRIES_SEED,
  PAYROLL_PERIODS_SEED,
  PAYROLL_RUNS_SEED,
  PAYSTUBS_SEED,
  CERTIFICATIONS_SEED,
  PTO_REQUESTS_SEED,
  VENDORS_SEED,
  BILLS_SEED,
  BILL_PAYMENTS_SEED,
  VENDOR_BILLS_SEED,
  INBOUND_EMAILS_SEED,
  STOCK_MOVEMENTS_SEED,
  MARINA_ASSETS_SEED,
  PM_SCHEDULES_SEED,
  TENANT_AI_SETTINGS_SEED,
  ATTACHMENTS_SEED,
  EXTRACTION_DRAFTS_SEED,
  BOAT_RENTALS,
  BOATERS,
  CARDS_ON_FILE,
  CLUB_BOOKINGS,
  CLUB_SUBSCRIPTIONS,
  SUPPORT_TICKETS_SEED,
  APPLICATIONS_SEED,
  RENEWAL_SWEEPS_SEED,
  RENEWAL_SWEEP_ITEMS_SEED,
  STORM_ALERTS_SEED,
  COMMUNICATIONS,
  CONTRACT_TEMPLATES,
  CONTRACTS,
  FUEL_INVENTORY,
  INSURANCE_CERTIFICATES,
  LEDGER,
  MARINA_EVENTS,
  MARINA_PROFILE_SEED,
  MARINA_PROFILES_BY_TENANT,
  METER_READINGS,
  POS_CATALOG,
  POS_LOCATIONS,
  POS_ORDERS,
  QUOTES,
  RATES,
  RENTAL_BOATS,
  RENTAL_GROUPS,
  DOCKS,
  RENTAL_SPACES,
  SLIPS,
  SLIP_TYPES,
  RESERVATIONS,
  SEED_TENANT_ID,
  STAFF_NOTES,
  TENANTS,
  VESSELS,
  WAITLIST,
  WORK_ORDERS,
} from "@/lib/mock-data";
import type {
  AdditionalFee,
  AuditLogEntry,
  BoatRental,
  Boater,
  CardOnFile,
  ClubBooking,
  ClubPlanTier,
  ClubSubscription,
  Communication,
  CommunicationChannel,
  Contract,
  ContractTemplate,
  FuelInventory,
  InsuranceCertificate,
  LedgerEntry,
  MarinaEvent,
  MeterReading,
  Picklist,
  PicklistFieldKey,
  PicklistValue,
  PosOrder,
  QbSyncStatus,
  Rate,
  RentalBoat,
  RentalGroup,
  RentalSpace,
  Slip,
  SlipType,
  Dock,
  Reservation,
  StaffNote,
  Tenant,
  Vessel,
  WaitlistEntry,
  WaitlistStatus,
  WorkOrder,
  MarinaProfile,
  CommTemplate,
  CommTemplateKind,
  Role,
  PermissionKey,
  StaffMember,
  Shift,
  TimeEntry,
  TimeEntryStatus,
  PayrollPeriod,
  PayrollPeriodStatus,
  PaystubPreview,
  PayrollRun,
  Paystub,
  Certification,
  PtoRequest,
  Vendor,
  Bill,
  BillLineItem,
  BillPayment,
  VendorBill,
  VendorBillPaymentMethod,
  InboundEmail,
  StockMovement,
  StockMovementKind,
  MarinaAsset,
  PmSchedule,
  AppProviderConfig,
  PosCatalogItem,
  PosLocation,
  // AI foundation
  TenantAiSettings,
  Attachment,
  ExtractionDraft,
  ExtractionModule,
  ExtractionDraftStatus,
  OnboardingStepKey,
  // Support tickets
  SupportTicket,
  SupportTicketAttachment,
  SupportTicketMessage,
  SupportTicketPriority,
  SupportTicketStatus,
  SupportTicketType,
  // Boater applications (public self-onboarding queue)
  Application,
  ApplicationStatus,
  // Renewal Sweep Coordinator
  RenewalSweep,
  RenewalSweepItem,
  RenewalSweepItemStatus,
  // Storm / weather alerts
  StormAlert,
} from "@/lib/types";
import {
  runWorkOrderCloseout,
  type CloseoutAdapter,
  type CloseoutBoaterRef,
} from "@/lib/wo-closeout";
import { deriveSlipStatus, type SlipStatusResult } from "@/lib/slip-status";
import { includedFeesForSlip } from "@/lib/slip-type-helpers";

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
  // Slip-intrinsic data (class, LOA, default annual rate, utilities).
  // Mirrored from the SLIPS seed at boot so the Roster + wizard can
  // edit a slip's defaults without crossing the server/seed boundary.
  slips: Slip[];
  // Slip Types — class × size band × pricing × included fees. Slips
  // resolve to a type via Slip.type_id (explicit) or by deriving from
  // class + max_loa_inches (see lib/slip-type-helpers.ts).
  slipTypes: SlipType[];
  docks: Dock[];
  fuelInventory: FuelInventory[];
  // Boat Rentals (own fleet — pontoons, kayaks, jet skis, ...)
  rentalBoats: RentalBoat[];
  boatRentals: BoatRental[];
  // Rental Club (members + their booked days). See lib/types.ts
  // ClubSubscription / ClubBooking for shape. Surfaces in
  // /members → Rental Club module.
  clubSubscriptions: ClubSubscription[];
  clubBookings: ClubBooking[];
  // Multi-tenant scaffolding
  tenants: Tenant[];
  currentTenantId: string;
  picklists: Picklist[];
  // Operator-configurable surfaces (Batch 1 expansion)
  marinaProfile: MarinaProfile;
  marinaProfilesByTenant: Record<string, MarinaProfile>;
  commTemplates: CommTemplate[];
  roles: Role[];
  staff: StaffMember[];
  providerConfigs: AppProviderConfig[];
  posLocations: PosLocation[];
  posCatalog: PosCatalogItem[];
  // Append-only audit log — populated by lib/agent-actions.ts and
  // any future mutation that calls logAuditLocal(). Surfaces in
  // Settings → Audit Log and (eventually) gets persisted to Convex.
  auditLog: AuditLogEntry[];
  // ── Back office (staffing / vendor / inventory / assets) ──
  shifts: Shift[];
  timeEntries: TimeEntry[];
  payrollPeriods: PayrollPeriod[];
  payrollRuns: PayrollRun[];
  paystubs: Paystub[];
  certifications: Certification[];
  ptoRequests: PtoRequest[];
  vendors: Vendor[];
  bills: Bill[];
  billPayments: BillPayment[];
  vendorBills: VendorBill[];
  inboundEmails: InboundEmail[];
  stockMovements: StockMovement[];
  marinaAssets: MarinaAsset[];
  pmSchedules: PmSchedule[];
  // ── AI-first foundation ──
  aiSettingsByTenant: Record<string, TenantAiSettings>;
  attachments: Attachment[];
  extractionDrafts: ExtractionDraft[];
  // ── Support (carve-out per ../CLAUDE.md §5) ──
  supportTickets: SupportTicket[];
  // ── Boater applications (public self-onboarding queue) ──
  applications: Application[];
  // ── Renewal Sweep Coordinator ──
  // A sweep groups N items (one per source contract). Items are flat
  // here (not nested on the sweep) so the per-item list page can
  // filter/sort efficiently and so per-item mutations don't have to
  // rewrite the whole sweep blob.
  renewalSweeps: RenewalSweep[];
  renewalSweepItems: RenewalSweepItem[];
  // ── Storm / weather alerts ──
  // Pulled from NWS / OpenWeather via Convex cron in production; for
  // now operator + agent can mint them by hand. Wraps the operator
  // app shell + /dock PWA when any alert is active.
  stormAlerts: StormAlert[];
  // Per-session acknowledgement set (storm id). Survives across
  // page navigations within the tab but resets on refresh — so an
  // operator who dismissed Saturday's storm in the morning still
  // sees it after lunch if a fresh tab opens. Matches the
  // "don't bury safety signal" principle.
  acknowledgedStormAlertIds: string[];
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
  slips: [...SLIPS],
  slipTypes: [...SLIP_TYPES],
  docks: [...DOCKS],
  fuelInventory: [...FUEL_INVENTORY],
  rentalBoats: [...RENTAL_BOATS],
  boatRentals: [...BOAT_RENTALS],
  clubSubscriptions: [...CLUB_SUBSCRIPTIONS],
  clubBookings: [...CLUB_BOOKINGS],
  tenants: [...TENANTS],
  currentTenantId: SEED_TENANT_ID,
  picklists: [...ALL_PICKLISTS],
  marinaProfile: { ...MARINA_PROFILE_SEED },
  // Per-tenant overrides preserved across switches. switchTenant()
  // swaps the active marinaProfile slot to whichever profile matches
  // the new tenant; edits get persisted back here on save.
  marinaProfilesByTenant: { ...MARINA_PROFILES_BY_TENANT },
  commTemplates: [...ALL_COMM_TEMPLATES],
  roles: [...ALL_ROLES],
  staff: [...ALL_STAFF],
  providerConfigs: [...ALL_PROVIDER_CONFIGS],
  posLocations: [...POS_LOCATIONS],
  posCatalog: [...POS_CATALOG],
  auditLog: [],
  shifts: [...SHIFTS_SEED],
  timeEntries: [...TIME_ENTRIES_SEED],
  payrollPeriods: [...PAYROLL_PERIODS_SEED],
  payrollRuns: [...PAYROLL_RUNS_SEED],
  paystubs: [...PAYSTUBS_SEED],
  certifications: [...CERTIFICATIONS_SEED],
  ptoRequests: [...PTO_REQUESTS_SEED],
  vendors: [...VENDORS_SEED],
  bills: [...BILLS_SEED],
  billPayments: [...BILL_PAYMENTS_SEED],
  vendorBills: [...VENDOR_BILLS_SEED],
  inboundEmails: [...INBOUND_EMAILS_SEED],
  stockMovements: [...STOCK_MOVEMENTS_SEED],
  marinaAssets: [...MARINA_ASSETS_SEED],
  pmSchedules: [...PM_SCHEDULES_SEED],
  aiSettingsByTenant: Object.fromEntries(
    TENANT_AI_SETTINGS_SEED.map((s) => [s.tenant_id, s])
  ),
  attachments: [...ATTACHMENTS_SEED],
  extractionDrafts: [...EXTRACTION_DRAFTS_SEED],
  supportTickets: [...SUPPORT_TICKETS_SEED],
  applications: [...APPLICATIONS_SEED],
  renewalSweeps: [...RENEWAL_SWEEPS_SEED],
  renewalSweepItems: [...RENEWAL_SWEEP_ITEMS_SEED],
  stormAlerts: [...STORM_ALERTS_SEED],
  acknowledgedStormAlertIds: [],
};

const subscribers = new Set<() => void>();

// ── Persistence ─────────────────────────────────────────────────
//
// Every mutation runs `notify()` to wake subscribers. We also write
// `state` to localStorage at the same boundary so a refresh restores
// everything the operator just did. Reads happen once at module load
// (below) — if a saved snapshot exists, it overrides the seed-derived
// initial state.
//
// The seed (`SEED_VERSION`) is bumped manually whenever the underlying
// types change in a backwards-incompatible way; a mismatch invalidates
// the cached snapshot and we fall back to fresh seeds. Keeps stale
// browser storage from breaking the app after a deploy.
//
// Convex migration will remove this — server is the source of truth
// once Phase 3+ lands. For now this is the persistence story.

const STORAGE_KEY = "marina-stee:store:v1";
// Bumped from 1 → 2 when the Rental Club module landed (adds
// `clubSubscriptions` + `clubBookings` slices to state). Old
// localStorage snapshots will be discarded and re-seeded.
//
// Bumped from 2 → 3 when one seed booking moved to today's date so
// the "Today on the water" check-in panel demos out of the box.
//
// Bumped from 3 → 4 when the second tenant + per-tenant marina
// profile map landed. Old snapshots flush so the new slice seeds
// cleanly.
//
// Bumped from 4 → 5 when picklists got cloned per tenant so the
// switcher doesn't strand new tenants with empty dropdowns.
//
// Bumped from 5 → 6 when ClubSubscription dropped manual fee fields
// in favor of plan_rate_id + joined_at_* snapshots. Old snapshots
// don't carry plan_rate_id and would render as broken memberships,
// so the bump flushes them and we re-seed clean.
// Bumped from 12 → 13 when the AI-first foundation landed
// (TenantAiSettings + Attachment + ExtractionDraft slices). Cached
// snapshots predate these slices and would read as undefined.
// Bumped from 13 → 14 when unified service fees landed — adds
// `cadence` + `applies_to_entities` to AdditionalFee, the
// "Boat Club Join Fee" seed, an "Electric Add-on" monthly seed, and
// `attached_fee_ids` on Reservation / Contract / ClubSubscription.
// Cached snapshots predate the new fee rows and the entity arrays.
// Bumped from 18 → 19 when the support module landed (adds the
// `supportTickets` slice). Cached snapshots predate it so we flush
// + reseed cleanly.
//
// Bumped from 19 → 20 when the VendorBill AP workflow landed (adds
// the `vendorBills` slice + 6 seed fixtures across draft / pending_approval
// / scheduled / paid / disputed). Cached snapshots predate it so we flush
// + reseed cleanly.
// Bumped from 21 → 22 when the boater applications slice landed (public
// self-onboarding queue at /apply + /members → Applications). Cached
// snapshots predate the `applications` slice and would read as undefined.
//
// Bumped from 22 → 23 when the AP-bill email ingest pipeline landed —
// adds the `inboundEmails` slice + 3 seed fixtures (created_draft /
// ingested / failed) so the /vendors → Inbound tab demos out of the
// box. Cached snapshots predate the slice; flush + reseed.
const SEED_VERSION = 23;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function persistState(s: State): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: SEED_VERSION, state: s }),
    );
  } catch {
    // Quota exceeded or storage disabled — silently no-op. The app
    // still works in-memory; the user just loses persistence.
  }
}

function loadPersistedState(): State | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version: number; state: State };
    if (parsed.version !== SEED_VERSION) return null;
    return parsed.state;
  } catch {
    return null;
  }
}

function notify() {
  persistState(state);
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

// Rehydrate from localStorage if a saved snapshot exists. Runs once
// at module load, after `state` has been initialized from seeds.
if (isBrowser()) {
  const saved = loadPersistedState();
  if (saved) {
    state = saved;
    // Don't notify here — subscribers haven't registered yet at
    // module init. They'll read the rehydrated state on first
    // useSyncExternalStore subscribe.
  }
}

// ----- actions -----

/**
 * Lookup a ledger entry by id from the live in-memory store. Used by
 * the mock-side agent action handlers that need to join against an
 * invoice without dragging in a React hook (the executors run in
 * non-component contexts).
 */
export function getLedgerEntryById(id: string): LedgerEntry | undefined {
  return state.ledger.find((l) => l.id === id);
}

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

  // Collect any annual-recurring fees that apply to the annual billing
  // run. These get rolled into the same invoice as additional line
  // items (e.g., Pet Fee surcharge for holders flagged with pets).
  // We apply *all* such fees to every contract for now — once we have
  // boater-level flags (has_pet, etc.), this filter tightens.
  // Scope to the active tenant so a billing run for Marina Stee
  // doesn't pull in Lakeside's annual surcharges.
  const fallbackTenantForFees = state.tenants[0]?.id;
  const annualRecurringFees = state.fees.filter(
    (f) =>
      f.recurrence === "annual" &&
      f.applies_to.includes("annual_billing_run") &&
      (f.tenant_id ?? fallbackTenantForFees) === state.currentTenantId
  );

  const lineItems: { description: string; amount: number }[] = [
    { description: opts.line_item_label, amount: opts.amount },
    ...annualRecurringFees.map((f) => ({
      description: f.name,
      amount: f.amount,
    })),
  ];
  const total = lineItems.reduce((acc, li) => acc + li.amount, 0);

  // 1. Post the invoice
  const invoiceId = nextLedgerId();
  const invoice: LedgerEntry = {
    id: invoiceId,
    boater_id: boater.id,
    type: "invoice",
    number: nextInvoiceNumber(),
    date: opts.date,
    amount: total,
    open_balance: total,
    method: "ach",
    status: "open",
    gl_account: "Slip Fee Revenue",
    qb_sync_status: "pending",
    line_items: lineItems,
    // FKs back to the source — keeps contract↔invoice match from
    // falling back to substring-on-description matching downstream.
    linked_contract_id: opts.contract_id,
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
      amount: total,
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
    // Stamp tenant_id on POS orders so per-tenant reports (revenue,
    // category mix) stay accurate. Mirrors the pattern used by
    // upsertRate / upsertRentalBoat.
    tenant_id: order.tenant_id ?? state.currentTenantId,
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
  // ── Inventory auto-decrement ──
  // For each line item, find the tracked PosCatalogItem by sku and
  // decrement stock_on_hand via a StockMovement. Untracked items
  // (services, fuel by the gallon) skip silently.
  for (const li of o.line_items ?? []) {
    const item = state.posCatalog.find(
      (i) =>
        i.sku === li.sku &&
        (i.tenant_id ?? state.tenants[0]?.id) === state.currentTenantId
    );
    if (item?.tracked) {
      recordStockMovement({
        item_id: item.id,
        delta: -Math.abs(li.qty),
        kind: "sale",
        reference_id: o.id,
      });
    }
  }
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
  // Closeout chain — fire when status transitions to "completed" AND
  // we haven't already fanned out for this WO (closed_out_at guards
  // re-fires inside runWorkOrderCloseout, but this caller-side check
  // saves the microtask hop on the common case).
  if (
    prev &&
    patch.status === "completed" &&
    prev.status !== "completed" &&
    !prev.closed_out_at
  ) {
    queueMicrotask(() => {
      fireWorkOrderCloseoutChain(id);
    });
  }
}

/**
 * Mock-store side of the closeout chain. Builds an adapter against the
 * in-memory state and delegates the orchestration to
 * `lib/wo-closeout.ts`. Same code path runs on the Convex side via a
 * twin adapter inside `convex/workOrders.ts → updateStatus`.
 */
function fireWorkOrderCloseoutChain(id: string): void {
  const wo = state.workOrders.find((w) => w.id === id);
  if (!wo) return;
  const now = new Date().toISOString();

  const adapter: CloseoutAdapter = {
    getBoater(boaterId): CloseoutBoaterRef | undefined {
      const b = state.boaters.find((x) => x.id === boaterId);
      if (!b) return undefined;
      return {
        id: b.id,
        first_name: b.first_name,
        display_name: b.display_name,
        preferred_channel: b.communication_prefs.preferred_channel,
        email: b.primary_contact.email,
        phone: b.primary_contact.phone,
        tenant_id: b.tenant_id ?? state.tenants[0]?.id,
      };
    },
    getQuoteForWorkOrder(workOrder) {
      // Quotes are seeded in mock-data and don't have a runtime mutator
      // surface yet — look up either by the WO's quote_id back-pointer
      // or by scanning for work_order_id (covers seed data that may not
      // have stamped the back-pointer yet).
      if (workOrder.quote_id) {
        const byId = QUOTES.find((q) => q.id === workOrder.quote_id);
        if (byId) return byId;
      }
      return QUOTES.find((q) => q.work_order_id === workOrder.id);
    },
    hasInvoiceForWorkOrder(workOrderId) {
      // Closeout idempotency: scan the ledger for an existing invoice
      // row linked back to this WO. Used by the retry path in
      // runWorkOrderCloseout to avoid double-posting when a prior run
      // partially failed after flipping the quote.
      return state.ledger.some(
        (l) => l.type === "invoice" && l.linked_work_order_id === workOrderId,
      );
    },
    markQuoteInvoiced(quoteId, invoicedAt) {
      // QUOTES is a static seed in mock mode — there's no live store
      // slot for quotes today. Mutate the seed entry in place so subsequent
      // closeout calls see status="invoiced" and short-circuit. This
      // matches how COMMUNICATIONS / CONTRACTS are seeded — write-back
      // to the seed array is the prototype pattern.
      const q = QUOTES.find((x) => x.id === quoteId);
      if (!q) return undefined;
      // Mutate the seed entry in place so subsequent closeout calls see
      // status="invoiced" and short-circuit. Matches how seed-side
      // CONTRACTS/COMMUNICATIONS are mutated as a prototype pattern;
      // a future live `quotes` store slot will swap this for a proper
      // mutator.
      q.status = "invoiced";
      q.paid_at = invoicedAt;
      logAuditLocal({
        actor_label: "Marina Stee Closeout",
        action_type: "work_order.closeout.quote_invoiced",
        target_entity: "quote",
        target_id: quoteId,
        payload_delta: JSON.stringify({ invoiced_at: invoicedAt }),
      });
      return quoteId;
    },
    addLedgerEntry(input) {
      const invoiceId = nextLedgerId();
      const entry: LedgerEntry = {
        id: invoiceId,
        boater_id: input.boaterId,
        type: "invoice",
        number: nextInvoiceNumber(),
        date: input.dateIso.slice(0, 10),
        amount: input.amount,
        open_balance: input.amount,
        method: null,
        status: "open",
        line_items: input.lineItems,
        gl_account: "Services",
        qb_sync_status: "pending",
        linked_work_order_id: input.workOrderId,
        linked_quote_id: input.quoteId,
      };
      state = {
        ...state,
        ledger: [entry, ...state.ledger],
        workOrders: state.workOrders.map((w) =>
          w.id === input.workOrderId
            ? {
                ...w,
                linked_ledger_entry_ids: [
                  ...(w.linked_ledger_entry_ids ?? []),
                  invoiceId,
                ],
              }
            : w
        ),
      };
      notify();
      logAuditLocal({
        actor_label: "Marina Stee Closeout",
        action_type: "work_order.closeout.invoice_posted",
        target_entity: "ledger",
        target_id: invoiceId,
        payload_delta: JSON.stringify({
          amount: input.amount,
          work_order_id: input.workOrderId,
        }),
      });
      return invoiceId;
    },
    addCommunication(input) {
      const commId = `cm_wo_close_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const comm: Communication = {
        id: commId,
        boater_id: input.boaterId,
        type: input.channel,
        direction: "outbound",
        sender_label: "Marina Stee",
        sender_is_system: true,
        recipient: input.recipient,
        subject: input.subject,
        body_preview: input.body.slice(0, 80),
        full_body: input.body,
        sent_at: now,
        status: "delivered",
        related_entity: input.relatedEntity,
      };
      state = {
        ...state,
        communications: [comm, ...state.communications],
      };
      notify();
      // Fire-and-forget through the outbound provider so a configured
      // Postmark/Twilio integration actually dispatches the message.
      // Mirrors the pattern in agent-actions.ts → send_message.
      if (input.recipient && input.channel !== "voice") {
        void fetch("/api/comms/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: input.channel,
            to: input.recipient,
            subject: input.subject,
            body: input.body,
          }),
        }).catch(() => {});
      }
      logAuditLocal({
        actor_label: "Marina Stee Closeout",
        action_type: "work_order.closeout.comm_sent",
        target_entity: "communication",
        target_id: commId,
        payload_delta: JSON.stringify({
          channel: input.channel,
          boater_id: input.boaterId,
        }),
      });
      return commId;
    },
    getVessel(vesselId) {
      return state.vessels.find((v) => v.id === vesselId);
    },
    updateVessel(vesselId, patch) {
      state = {
        ...state,
        vessels: state.vessels.map((v) =>
          v.id === vesselId ? { ...v, ...patch } : v
        ),
      };
      notify();
      logAuditLocal({
        actor_label: "Marina Stee Closeout",
        action_type: "work_order.closeout.vessel_stamped",
        target_entity: "vessel",
        target_id: vesselId,
        payload_delta: JSON.stringify(patch),
      });
    },
    getCommTemplate(kind, tenantId) {
      const tpl = state.commTemplates.find(
        (t) =>
          t.kind === kind &&
          t.active &&
          (t.tenant_id ?? state.tenants[0]?.id) ===
            (tenantId ?? state.tenants[0]?.id)
      );
      if (!tpl) return undefined;
      return {
        subject: tpl.subject,
        body_markdown: tpl.body_markdown,
        channel: tpl.channel,
      };
    },
    stampWorkOrderClosed(workOrderId, closedAtIso) {
      state = {
        ...state,
        workOrders: state.workOrders.map((w) =>
          w.id === workOrderId ? { ...w, closed_out_at: closedAtIso } : w
        ),
      };
      notify();
      logAuditLocal({
        actor_label: "Marina Stee Closeout",
        action_type: "work_order.closeout.completed",
        target_entity: "work_order",
        target_id: workOrderId,
        payload_delta: JSON.stringify({ closed_out_at: closedAtIso }),
      });
    },
    // Lazy-loaded to break the circular dep with lib/recurring-cleaning.ts
    // (it imports updateWorkOrder + executeAgentAction from this module,
    // both of which are safe at runtime — but pulling its spawn helper
    // in at the top of the file would create a static cycle. Inline
    // resolution keeps the closeout chain self-contained.)
    spawnRecurringNext(prev) {
      // Dynamic import equivalent — the agent-actions executor handles
      // the spawn end-to-end. Imported lazily through a runtime require
      // to dodge the static-import cycle that would otherwise form
      // (agent-actions imports recurring-cleaning, which imports
      // updateWorkOrder from this module).
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require("@/lib/agent-actions") as typeof import("@/lib/agent-actions");
        const result = mod.executeAgentAction({
          kind: "create_work_order",
          label: `Closeout recurring spawn from ${prev.number}`,
          boater_id: prev.boater_id,
          subject: prev.subject,
          description: prev.description,
          activity_type: prev.activity_type ?? "other",
          priority: prev.priority,
          vessel_id: prev.vessel_id,
          slip_id: prev.slip_id,
          start_date: prev.recurring_next_date,
          end_date: prev.end_date,
          due_date: prev.due_date,
          assignee_user_id: prev.assignee_user_id,
          work_class: "cleaning",
          estimated_total: prev.estimated_total,
          estimated_hours: prev.estimated_hours,
          checklist: prev.checklist?.map((c) => ({
            id: c.id,
            label: c.label,
          })),
          is_recurring: false,
          cleaning_source_kind: prev.cleaning_source_kind,
          cleaning_source_id: prev.cleaning_source_id,
        });
        return result.ok ? result.createdId : undefined;
      } catch {
        return undefined;
      }
    },
  };

  runWorkOrderCloseout({
    wo,
    todayIso: now,
    actor: {},
    store: adapter,
  });
}

export function addReservation(r: Reservation) {
  // Auto-attach the slip's type-included fees so every reservation
  // booked on, say, a covered slip carries the shore-power fee
  // (whatever the operator configured on SlipType.included_fee_ids).
  // Caller's explicit attached_fee_ids are preserved + deduped.
  const slip = state.slips.find((s) => s.id === r.slip_id);
  const autoFeeIds = slip
    ? includedFeesForSlip(slip, state.slipTypes)
    : [];
  const merged = Array.from(
    new Set([...(r.attached_fee_ids ?? []), ...autoFeeIds]),
  );
  const next: Reservation = {
    ...r,
    attached_fee_ids: merged.length > 0 ? merged : r.attached_fee_ids,
  };
  state = { ...state, reservations: [next, ...state.reservations] };
  notify();
}

/** Partial update — for agent edits that touch a few fields */
export function updateReservation(id: string, patch: Partial<Reservation>) {
  state = {
    ...state,
    reservations: state.reservations.map((r) =>
      r.id === id ? { ...r, ...patch } : r,
    ),
  };
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
  // Stamp tenant scope on every new record. Caller can pass tenant_id
  // explicitly (e.g. a super-admin importing from another tenant) but
  // the default — and what 99% of UI paths hit — is the active tenant.
  const stamped: Boater = { ...b, tenant_id: b.tenant_id ?? state.currentTenantId };
  state = { ...state, boaters: [stamped, ...state.boaters] };
  notify();
}

export function upsertBoater(b: Boater) {
  const exists = state.boaters.some((x) => x.id === b.id);
  // Stamp tenant scope on insert path (new records via upsert). Edit
  // path leaves tenant_id alone so cross-tenant relocation requires
  // an explicit move action, not an accidental save.
  const stamped: Boater = exists
    ? b
    : { ...b, tenant_id: b.tenant_id ?? state.currentTenantId };
  state = {
    ...state,
    boaters: exists
      ? state.boaters.map((x) => (x.id === b.id ? stamped : x))
      : [stamped, ...state.boaters],
  };
  notify();
}

/** Partial update — for agent edits that touch a few fields */
export function updateBoater(id: string, patch: Partial<Boater>) {
  state = {
    ...state,
    boaters: state.boaters.map((b) => (b.id === id ? { ...b, ...patch } : b)),
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

/** Partial update — for agent edits that touch a few fields */
export function updateVessel(id: string, patch: Partial<Vessel>) {
  state = {
    ...state,
    vessels: state.vessels.map((v) => (v.id === id ? { ...v, ...patch } : v)),
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
  // SECURITY: crypto.randomUUID — auth-bearing token surfaces a contract
  // for wet-signature at /onboard/[token]. ≥122 bits CSPRNG vs ~31 bits prior.
  const token = `cont_${crypto.randomUUID()}`;
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
  const stamped: ContractTemplate = exists
    ? t
    : { ...t, tenant_id: t.tenant_id ?? state.currentTenantId };
  state = {
    ...state,
    templates: exists
      ? state.templates.map((x) => (x.id === stamped.id ? stamped : x))
      : [stamped, ...state.templates],
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
  const stamped: MeterReading = exists
    ? m
    : { ...m, tenant_id: m.tenant_id ?? state.currentTenantId };
  state = {
    ...state,
    meters: exists
      ? state.meters.map((x) => (x.id === stamped.id ? stamped : x))
      : [stamped, ...state.meters],
  };
  notify();
}
export function deleteMeter(id: string) {
  state = { ...state, meters: state.meters.filter((m) => m.id !== id) };
  notify();
}

// ── Rates CRUD ───────────────────────────────────────────────
export function upsertRate(r: Rate) {
  // Stamp tenant_id on creates so the new row lands on the active
  // marina's catalog. Edits preserve the existing tenant_id (don't
  // ever let an edit re-tag a rate to a different tenant — that
  // would yank it out from under any subscriptions referencing it).
  const exists = state.rates.some((x) => x.id === r.id);
  const stamped: Rate = exists
    ? r
    : { ...r, tenant_id: r.tenant_id ?? state.currentTenantId };
  state = {
    ...state,
    rates: exists
      ? state.rates.map((x) => (x.id === stamped.id ? stamped : x))
      : [stamped, ...state.rates],
  };
  notify();
}
export function deleteRate(id: string) {
  state = { ...state, rates: state.rates.filter((r) => r.id !== id) };
  notify();
}
export function updateRate(id: string, patch: Partial<Rate>) {
  state = {
    ...state,
    rates: state.rates.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  };
  notify();
}

// ── Audit log ────────────────────────────────────────────────
// Append-only history of every mutation. The local store mirrors the
// production Convex `auditLog` table (see docs/architecture-convex.md §8).
// Once we migrate, every Convex mutation calls logAudit() inside the
// function; the equivalent here lives at the executor boundary
// (lib/agent-actions.ts wraps each branch).

export function logAuditLocal(entry: Omit<AuditLogEntry, "id" | "tenant_id" | "created_at">): void {
  const row: AuditLogEntry = {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    tenant_id: state.currentTenantId,
    created_at: new Date().toISOString(),
    ...entry,
  };
  state = { ...state, auditLog: [row, ...state.auditLog] };
  notify();
}

export function useAuditLog(): AuditLogEntry[] {
  // Filter by current tenant — cross-tenant entries from staff who
  // switched marinas mid-session stay invisible to each tenant's
  // operators. Audit entries without tenant_id (legacy) get treated
  // as primary-tenant for backwards compat.
  const s = useStore();
  return s.auditLog.filter(
    (a) => (a.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId
  );
}

// ─────────────────────────────────────────────────────────────
// Storm / weather alerts
// ─────────────────────────────────────────────────────────────

/**
 * Active (unacknowledged + within window) storm alerts for the
 * current tenant. Wired into the operator app-shell + /dock PWA
 * via <StormAlertBanner /> so the operator always sees marine-
 * safety signal regardless of which screen they're on. Public
 * boater surfaces NEVER mount the banner — marina-internal
 * recommendations shouldn't leak to applicants.
 */
export function useActiveStormAlerts(): StormAlert[] {
  const s = useStore();
  const ackSet = useMemo(
    () => new Set(s.acknowledgedStormAlertIds),
    [s.acknowledgedStormAlertIds],
  );
  const tenantId = s.currentTenantId;
  const fallbackTenantId = s.tenants[0]?.id;
  // Compute `now` once per render; reactivity comes from state
  // changes, not a wall-clock tick — banners auto-clear when an
  // operator dismisses or when the next render happens after
  // `ends_at`. Production version (Convex cron) will mutate the
  // alert row to `archived` at the boundary and remove it from
  // the store entirely.
  const now = Date.now();
  return s.stormAlerts.filter((a) => {
    if (ackSet.has(a.id)) return false;
    const inWindow = new Date(a.ends_at).getTime() >= now;
    if (!inWindow) return false;
    const alertTenant = a.tenant_id ?? fallbackTenantId;
    return alertTenant === tenantId;
  });
}

/**
 * Mark a storm alert as acknowledged for the rest of this browser
 * session. Survives within-tab navigations (state is in-memory)
 * but resets on tab close — operators acknowledging in the
 * morning still see the safety signal after lunch if they open
 * a fresh tab. Public-record audit-log row is written so the
 * operator's "Triggered by" trail captures the dismissal.
 */
export function acknowledgeStormAlert(id: string): void {
  if (state.acknowledgedStormAlertIds.includes(id)) return;
  state = {
    ...state,
    acknowledgedStormAlertIds: [...state.acknowledgedStormAlertIds, id],
  };
  notify();
  logAuditLocal({
    actor_user_id: "u_current",
    actor_label: "Operator",
    action_type: "storm_alert.acknowledge",
    target_entity: "storm_alert",
    target_id: id,
    payload_delta: JSON.stringify({ acknowledged: true }),
  });
}

/**
 * Cross-tenant variant — used by super-admin surfaces (none in the
 * prototype yet) to see every tenant's audit log. The badge in
 * Settings → Audit Log uses this internally to render the tenant
 * label per entry.
 */
export function useAuditLogAllTenants(): AuditLogEntry[] {
  return useStore().auditLog;
}

// ── Audit log explorer — mock-side filter + search ────────────
//
// Shape mirrors `convex/audit.ts:search`'s return so the explorer
// component can swap between mock and live transparently via
// useTenantQuery. Provenance encoding matches the Convex query header
// comment: `via_bulk` and `via_closeout` are encoded in action_type
// substrings (`*_via_bulk`, `*.closeout.*`); only `via_agent` is a
// real column.

export interface AuditSearchArgs {
  text?: string;
  actorUserId?: string;
  entities?: string[];
  actionTypeContains?: string;
  fromIso?: string;
  toIso?: string;
  viaAgent?: boolean;
  viaBulk?: boolean;
  viaCloseout?: boolean;
  cursor?: string;
  pageSize?: number;
}

export interface AuditSearchResult {
  rows: AuditLogEntry[];
  hasMore: boolean;
  nextCursor?: string;
}

export function useAuditLogSearch(args: AuditSearchArgs): AuditSearchResult {
  const s = useStore();
  // Tenant-scoped view of the raw rows. useMemo isolates the heavy
  // filter when the inputs are stable, even though the store is small
  // enough that this is mostly defensive.
  const tenantRows = useMemo(
    () =>
      s.auditLog.filter(
        (a) => (a.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId,
      ),
    [s.auditLog, s.tenants, s.currentTenantId],
  );

  return useMemo(() => {
    const pageSize = Math.min(args.pageSize ?? 50, 200);
    const lc = args.text?.trim().toLowerCase();
    const entitySet =
      args.entities && args.entities.length > 0
        ? new Set(args.entities)
        : null;

    const filtered = tenantRows.filter((r) => {
      if (args.fromIso && r.created_at < args.fromIso) return false;
      if (args.toIso && r.created_at > args.toIso) return false;
      if (args.cursor && r.created_at >= args.cursor) return false;
      if (args.actorUserId && r.actor_user_id !== args.actorUserId)
        return false;
      if (entitySet && !entitySet.has(r.target_entity)) return false;
      if (
        args.actionTypeContains &&
        !r.action_type
          .toLowerCase()
          .includes(args.actionTypeContains.toLowerCase())
      ) {
        return false;
      }
      if (args.viaAgent === true && !r.via_agent) return false;
      if (args.viaAgent === false && r.via_agent) return false;
      if (args.viaBulk === true && !r.action_type.includes("_via_bulk"))
        return false;
      if (args.viaBulk === false && r.action_type.includes("_via_bulk"))
        return false;
      if (args.viaCloseout === true && !r.action_type.includes(".closeout."))
        return false;
      if (args.viaCloseout === false && r.action_type.includes(".closeout."))
        return false;
      if (lc) {
        const hay = [
          r.action_type,
          r.target_entity,
          r.target_id ?? "",
          r.actor_label,
          r.agent_prompt ?? "",
          r.payload_delta ?? "",
        ]
          .join("\n")
          .toLowerCase();
        if (!hay.includes(lc)) return false;
      }
      return true;
    });

    const page = filtered.slice(0, pageSize);
    const hasMore = filtered.length > pageSize;
    const nextCursor =
      page.length > 0 ? page[page.length - 1].created_at : undefined;
    return { rows: page, hasMore, nextCursor };
  }, [tenantRows, args]);
}

/**
 * Drawer-side related-context read — every audit row touching a single
 * (target_entity, target_id) pair, newest first. Mirrors
 * `convex/audit.ts:listByTarget` so the drawer can read the same shape
 * regardless of backend.
 */
export function useAuditLogByTarget(
  targetEntity: string | undefined,
  targetId: string | undefined,
  limit = 100,
): AuditLogEntry[] {
  const s = useStore();
  return useMemo(() => {
    if (!targetEntity || !targetId) return [];
    return s.auditLog
      .filter(
        (a) =>
          (a.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId &&
          a.target_entity === targetEntity &&
          a.target_id === targetId,
      )
      .slice(0, limit);
  }, [s.auditLog, s.tenants, s.currentTenantId, targetEntity, targetId, limit]);
}

/**
 * Single-row fetcher for the drawer's deep-link mode (`?row=audit_xyz`).
 * Mirrors `convex/audit.ts:getById`.
 */
export function useAuditLogById(id: string | undefined): AuditLogEntry | null {
  const s = useStore();
  return useMemo(() => {
    if (!id) return null;
    const row = s.auditLog.find((a) => a.id === id);
    if (!row) return null;
    if (
      row.tenant_id &&
      row.tenant_id !== s.currentTenantId &&
      s.tenants[0]?.id !== s.currentTenantId
    ) {
      return null;
    }
    return row;
  }, [s.auditLog, s.currentTenantId, s.tenants, id]);
}

// ── Fees CRUD ────────────────────────────────────────────────
export function upsertFee(f: AdditionalFee) {
  // Same stamp-on-create rule as upsertRate: new fees inherit the
  // active tenant, edits preserve the original.
  const exists = state.fees.some((x) => x.id === f.id);
  const stamped: AdditionalFee = exists
    ? f
    : { ...f, tenant_id: f.tenant_id ?? state.currentTenantId };
  state = {
    ...state,
    fees: exists
      ? state.fees.map((x) => (x.id === stamped.id ? stamped : x))
      : [stamped, ...state.fees],
  };
  notify();
}
/**
 * Partial-update by id. Use this when the caller only knows a few
 * fields to change — preserves accounting_line_item, applies_to,
 * etc. that a full upsert would otherwise overwrite.
 */
export function updateFee(id: string, patch: Partial<AdditionalFee>) {
  state = {
    ...state,
    fees: state.fees.map((f) => (f.id === id ? { ...f, ...patch } : f)),
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
  const stamped: RentalGroup = exists
    ? g
    : { ...g, tenant_id: g.tenant_id ?? state.currentTenantId };
  state = {
    ...state,
    rentalGroups: exists
      ? state.rentalGroups.map((x) => (x.id === stamped.id ? stamped : x))
      : [...state.rentalGroups, stamped],
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
  const stamped: RentalSpace = exists
    ? s
    : { ...s, tenant_id: s.tenant_id ?? state.currentTenantId };
  state = {
    ...state,
    rentalSpaces: exists
      ? state.rentalSpaces.map((x) => (x.id === stamped.id ? stamped : x))
      : [...state.rentalSpaces, stamped],
  };
  notify();
}
export function deleteRentalSpace(id: string) {
  state = { ...state, rentalSpaces: state.rentalSpaces.filter((s) => s.id !== id) };
  notify();
}

// ── Slip CRUD ───────────────────────────────────────────────
// Slip-intrinsic data (class, max LOA/beam, utilities, default rates).
// Staff edits these from the Roster's row action.
export function updateSlip(id: string, patch: Partial<Slip>) {
  state = {
    ...state,
    slips: state.slips.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  };
  notify();
}
export function upsertSlip(slip: Slip) {
  const exists = state.slips.some((s) => s.id === slip.id);
  const stamped: Slip = exists
    ? slip
    : { ...slip, tenant_id: slip.tenant_id ?? state.currentTenantId };
  state = {
    ...state,
    slips: exists
      ? state.slips.map((s) => (s.id === stamped.id ? stamped : s))
      : [...state.slips, stamped],
  };
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
  const stamped: MarinaEvent = {
    ...e,
    tenant_id: e.tenant_id ?? state.currentTenantId,
  };
  state = { ...state, events: [stamped, ...state.events] };
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
  // Stamp tenant — guests have no boater_id to fall back on.
  const stamped: WaitlistEntry = {
    ...e,
    tenant_id: e.tenant_id ?? state.currentTenantId,
  };
  state = { ...state, waitlist: [stamped, ...state.waitlist] };
  notify();
}

/**
 * Set the boater_id on an existing waitlist entry — used by the lazy-
 * mint path (a guest entry that gets promoted to a real Boater record
 * when an operator clicks through to the profile). Distinct from
 * updateWaitlistEntry's allowed-fields list because boater_id is the
 * tenancy anchor for the entry and shouldn't be quietly editable.
 */
export function linkWaitlistEntryToBoater(
  entryId: string,
  boaterId: string,
): void {
  state = {
    ...state,
    waitlist: state.waitlist.map((w) =>
      w.id === entryId
        ? {
            ...w,
            boater_id: boaterId,
            // Once linked, the guest_* fields are dead weight — the
            // Boater record is the source of truth for name + contact.
            // Clearing them prevents "did the operator edit the
            // boater?" / "did they edit the entry?" drift.
            guest_name: undefined,
            guest_email: undefined,
            guest_phone: undefined,
          }
        : w,
    ),
  };
  notify();
  logAuditLocal({
    actor_user_id: "u_current",
    actor_label: "Operator",
    action_type: "waitlist.link_boater",
    target_entity: "waitlist_entry",
    target_id: entryId,
    payload_delta: JSON.stringify({ boater_id: boaterId }),
  });
}

/**
 * Lazy-mint helper — guarantees the entry has a backing Boater.
 *
 * Returns the boater_id for the entry. If the entry already has one,
 * returns it unchanged. Otherwise:
 *   - Parses the guest_name into first/last (handles both "First Last"
 *     and "Last, First" forms)
 *   - Builds a minimal Boater shell tagged "waitlist-only" so the
 *     /members default-active filter excludes them by default
 *   - Inserts it, links the entry, returns the new id
 *
 * This is the API the row-click handler calls before navigating to
 * /members/[id]. Callers don't need to know whether a mint happened —
 * the return value is the right id to navigate to either way.
 */
export function ensureWaitlistBoater(entry: WaitlistEntry): string {
  if (entry.boater_id) return entry.boater_id;

  const guestName = (entry.guest_name ?? "").trim();
  // Parse "Last, First" → first="First", last="Last"; otherwise split
  // on whitespace and take last token as surname.
  let firstName = "";
  let lastName = "";
  if (guestName.includes(",")) {
    const [last, first] = guestName.split(",").map((s) => s.trim());
    firstName = first ?? "";
    lastName = last ?? "";
  } else if (guestName.length > 0) {
    const parts = guestName.split(/\s+/);
    lastName = parts.pop() ?? "";
    firstName = parts.join(" ");
  }
  if (!firstName) firstName = "—";
  if (!lastName) lastName = guestName || "Prospect";

  const newId = `b_wl_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const display =
    firstName !== "—" ? `${lastName}, ${firstName}` : lastName;

  const boater: Boater = {
    id: newId,
    tenant_id: entry.tenant_id ?? state.currentTenantId,
    display_name: display,
    first_name: firstName,
    last_name: lastName,
    active: true,
    billing_cadence: "transient",
    // Tag so /members can filter waitlist-only prospects out of the
    // default-active list. The /services/waitlist queue is the surface
    // operators use to work this segment.
    tags: ["waitlist-only"],
    communication_prefs: {
      preferred_channel: "email",
      language: "en",
    },
    primary_contact: {
      id: `contact_${newId}_primary`,
      name: display,
      role: "self",
      email: entry.guest_email,
      phone: entry.guest_phone,
      preferred_channel: "email",
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
  };
  addBoater(boater);
  linkWaitlistEntryToBoater(entry.id, newId);
  logAuditLocal({
    actor_user_id: "u_current",
    actor_label: "Operator",
    action_type: "boater.mint_from_waitlist",
    target_entity: "boater",
    target_id: newId,
    payload_delta: JSON.stringify({
      waitlist_entry_id: entry.id,
      source: "lazy_mint_on_profile_click",
    }),
  });
  return newId;
}

export function getWaitlistByClaimToken(token: string): WaitlistEntry | undefined {
  return state.waitlist.find((w) => w.claim_token === token);
}

// ────────────────────────────────────────────────────────────
// Auto-offer cascade
// ────────────────────────────────────────────────────────────
//
// The cascade reuses the existing `offered_at` / `offer_expires_at` /
// `claim_token`-style fields but routes through a separate set of
// fields (`offer_token` / `offer_status` / `offer_batch_id`) so the
// broadcast-style /claim notify path and the operator-driven
// fire-offer wizard don't collide. The two surfaces coexist.
//
// Fired offers land at /apply/waitlist/[token] — distinct from
// /claim/[token] which the broadcast notify path uses.

export function getWaitlistByOfferToken(token: string): WaitlistEntry | undefined {
  return state.waitlist.find((w) => w.offer_token === token);
}

function newOfferToken(seed: string): string {
  // SECURITY: crypto.randomUUID — auth-bearing token grants acceptOffer
  // for a slip. `seed` retained as a non-cryptographic readability prefix
  // (last-4 of slip id helps operator debugging) but ALL entropy comes
  // from randomUUID.
  return `wlo_${seed.slice(-4)}_${crypto.randomUUID()}`;
}

/**
 * Fire offers to the top-N matching waitlisters for a freed slip.
 *
 * Each entry gets a fresh offer_token + 48h expiry + outbound Comm
 * dispatched on the boater's preferred channel (email/sms). All
 * fan-out offers share an offer_batch_id so the audit log + operator
 * panel can render them as one event.
 *
 * Idempotent re-fire: existing pending offers on the same slip are
 * left in place (the operator can hit Resend explicitly).
 *
 * Returns the new offer_tokens fired this batch.
 */
export function fireWaitlistOffer(opts: {
  slip_id: string;
  entry_ids: string[];
  expires_hours?: number;
  agent_prompt?: string;
}): { batch_id: string; tokens: string[] } {
  const { slip_id, entry_ids } = opts;
  const expiresHours = opts.expires_hours ?? 48;
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + expiresHours * 3_600_000,
  ).toISOString();
  const batchId = `wlb_${Date.now().toString(36)}_${slip_id.toLowerCase()}`;
  const tokens: string[] = [];

  // Resolve slip metadata for the comm body. Look in SLIPS first
  // (the roster source), fall back to rentalSpaces.
  const slipFromRoster = SLIPS.find((s) => s.id === slip_id);
  const slipFromSpaces = state.rentalSpaces.find((s) => s.id === slip_id);
  const slipDock =
    slipFromRoster?.dock ?? slipFromSpaces?.group_id ?? slip_id;
  const slipLOAIn = slipFromRoster?.max_loa_inches ?? slipFromSpaces?.length_inches;

  const updatedWaitlist = state.waitlist.map((w) => {
    if (!entry_ids.includes(w.id)) return w;
    // Skip if an offer is already pending on this entry — operator
    // can resend by passing through expireStaleOffers + advance first.
    if (w.offer_status === "pending") return w;
    const token = newOfferToken(w.id);
    tokens.push(token);
    return {
      ...w,
      status: "offered" as const,
      offered_slip_id: slip_id,
      offered_at: now.toISOString(),
      offer_expires_at: expiresAt,
      offer_token: token,
      offer_status: "pending" as const,
      offer_batch_id: batchId,
    };
  });

  // One outbound Comm per offer.
  const newComms: Communication[] = [];
  for (const w of updatedWaitlist) {
    if (!tokens.includes(w.offer_token ?? "")) continue;
    const url = `/apply/waitlist/${w.offer_token}`;
    let commType: Communication["type"] = "email";
    let recipient = "";
    let displayFirst = "there";
    if (w.boater_id) {
      const b = state.boaters.find((x) => x.id === w.boater_id);
      if (b) {
        commType = b.communication_prefs.preferred_channel;
        recipient =
          commType === "email"
            ? b.primary_contact.email ?? ""
            : b.primary_contact.phone ?? "";
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
      displayFirst = (w.guest_name ?? "there").split(/\s+/)[0] ?? "there";
    }

    newComms.push({
      id: `cm_wloffer_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      boater_id: w.boater_id ?? `waitlist:${w.id}`,
      type: commType,
      direction: "outbound",
      sender_label: "Marina Stee",
      sender_is_system: true,
      recipient,
      subject: `A slip just opened — slip ${slip_id}`,
      body_preview: `Slip ${slip_id} matches your waitlist request. Accept or decline within ${expiresHours}h.`,
      full_body:
        `Hi ${displayFirst},\n\n` +
        `A slip just opened up at the marina that matches your waitlist request:\n\n` +
        `  Slip:       ${slip_id}\n` +
        `  Dock:       ${slipDock}\n` +
        (slipLOAIn ? `  Max LOA:    ${Math.round(slipLOAIn / 12)}'\n` : "") +
        `\n` +
        `Accept or decline within ${expiresHours} hours:\n${url}\n\n` +
        `If we don't hear back, we'll roll the offer to the next person in line.\n\nMarina Stee`,
      sent_at: now.toISOString(),
      status: "delivered",
      related_entity: { type: "reservation", id: slip_id },
    });
  }

  state = {
    ...state,
    waitlist: updatedWaitlist,
    communications: [...newComms, ...state.communications],
  };

  logAuditLocal({
    actor_label: "Marina Stee Operator",
    action_type: "waitlist.fire_offer",
    target_entity: "waitlist",
    target_id: batchId,
    payload_delta: JSON.stringify({
      slip_id,
      count: tokens.length,
      expires_hours: expiresHours,
    }),
    via_agent: !!opts.agent_prompt,
    agent_prompt: opts.agent_prompt,
  });

  notify();
  return { batch_id: batchId, tokens };
}

/**
 * Accept a fired waitlist offer.
 *
 * Stamps offer_status=accepted, flips entry status → converted,
 * mints a draft Contract (for known boaters), and fires the
 * onboarding comm chain. Mirrors `claimWaitlistOffer` for the
 * cascade path.
 *
 * Returns the entry + onboard token when the contract draft + comm
 * landed, or null if the token is invalid/expired.
 */
export function acceptWaitlistOffer(
  token: string,
  opts: { agent_prompt?: string } = {},
): { entry: WaitlistEntry; onboardToken?: string; contractId?: string } | null {
  const entry = state.waitlist.find((w) => w.offer_token === token);
  if (!entry || entry.offer_status !== "pending") return null;
  if (
    entry.offer_expires_at &&
    new Date(entry.offer_expires_at).getTime() < Date.now()
  ) {
    state = {
      ...state,
      waitlist: state.waitlist.map((w) =>
        w.id === entry.id
          ? { ...w, status: "expired" as const, offer_status: "expired" as const }
          : w,
      ),
    };
    notify();
    return null;
  }

  const now = new Date().toISOString();
  let convertedContractId: string | undefined;
  let onboardToken: string | undefined;

  const boater = state.boaters.find((b) => b.id === entry.boater_id);
  if (boater && entry.offered_slip_id) {
    const template = state.templates[0];
    const start =
      entry.preferred_arrival ?? new Date().toISOString().slice(0, 10);
    const startMs = new Date(start).getTime();
    const end = new Date(startMs + 365 * 86_400_000)
      .toISOString()
      .slice(0, 10);
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

    const minted = mintContractSignatureToken(contract.id);
    if (minted) {
      onboardToken = minted;
    }
  }

  state = {
    ...state,
    waitlist: state.waitlist.map((w) =>
      w.id === entry.id
        ? {
            ...w,
            status: "converted" as const,
            offer_status: "accepted" as const,
            offer_responded_at: now,
            converted_contract_id: convertedContractId ?? w.converted_contract_id,
          }
        : w,
    ),
  };

  logAuditLocal({
    actor_label: boater?.display_name ?? entry.guest_name ?? "Waitlist applicant",
    action_type: "waitlist.accept_offer",
    target_entity: "waitlist",
    target_id: entry.id,
    payload_delta: JSON.stringify({
      slip_id: entry.offered_slip_id,
      contract_id: convertedContractId,
    }),
    via_agent: !!opts.agent_prompt,
    agent_prompt: opts.agent_prompt,
  });

  notify();
  return { entry, onboardToken, contractId: convertedContractId };
}

/**
 * Decline a fired waitlist offer.
 *
 * Stamps offer_status=declined, drops the entry status back to
 * pending (the applicant stays on the queue — declining a single
 * offer doesn't remove them), and auto-advances the cascade by
 * firing the next eligible candidate on the same slip.
 *
 * Returns the entry + next-fired tokens (for the auto-advance chain).
 */
export function declineWaitlistOffer(
  token: string,
  opts: { agent_prompt?: string; auto_advance?: boolean } = {},
): { entry: WaitlistEntry; advancedTokens: string[] } | null {
  const entry = state.waitlist.find((w) => w.offer_token === token);
  if (!entry || entry.offer_status !== "pending") return null;
  const now = new Date().toISOString();
  const slipId = entry.offered_slip_id;

  state = {
    ...state,
    waitlist: state.waitlist.map((w) =>
      w.id === entry.id
        ? {
            ...w,
            status: "pending" as const,
            offer_status: "declined" as const,
            offer_responded_at: now,
          }
        : w,
    ),
  };

  logAuditLocal({
    actor_label:
      state.boaters.find((b) => b.id === entry.boater_id)?.display_name ??
      entry.guest_name ??
      "Waitlist applicant",
    action_type: "waitlist.decline_offer",
    target_entity: "waitlist",
    target_id: entry.id,
    payload_delta: JSON.stringify({ slip_id: slipId }),
    via_agent: !!opts.agent_prompt,
    agent_prompt: opts.agent_prompt,
  });

  let advancedTokens: string[] = [];
  if ((opts.auto_advance ?? true) && slipId) {
    advancedTokens = advanceToNextCandidate(slipId, entry.id);
  }
  notify();
  return { entry, advancedTokens };
}

/**
 * Cron-style walker — flip any pending offers whose 48h window has
 * lapsed to `expired` and auto-advance to the next-in-line.
 *
 * Idempotent: re-running this with no stale offers is a no-op.
 *
 * Returns the count of expired offers + count of new offers fired.
 */
/**
 * Bulk-stamp `last_contact_at` on the given entries. Powers the
 * "Mark contacted" bulk action in the Waitlist Stale tab — operators
 * who just sent a check-in email or did outbound calls clear the
 * staleness signal in one click.
 */
export function bulkStampLastContact(ids: string[]): { stamped: number } {
  if (ids.length === 0) return { stamped: 0 };
  const idSet = new Set(ids);
  const nowIso = new Date().toISOString();
  let stamped = 0;
  state = {
    ...state,
    waitlist: state.waitlist.map((w) => {
      if (!idSet.has(w.id)) return w;
      stamped += 1;
      return { ...w, last_contact_at: nowIso };
    }),
  };
  notify();
  logAuditLocal({
    actor_user_id: "u_current",
    actor_label: "Operator",
    action_type: "waitlist.bulk_mark_contacted",
    target_entity: "waitlist_entry",
    target_id: `bulk:${ids.length}`,
    payload_delta: JSON.stringify({ ids, last_contact_at: nowIso }),
  });
  return { stamped };
}

/**
 * Update arbitrary fields on a single waitlist entry. Used by the
 * applicant detail sheet's click-to-edit fields (contact, preferences,
 * vessel size, tags, notes).
 *
 * Pass exactly the keys you want to change; everything else is
 * preserved. Does NOT touch last_contact_at — use stampWaitlistContact
 * for that explicitly so the side effect is at the call site, not
 * hidden in the mutator.
 */
export function updateWaitlistEntry(
  id: string,
  patch: Partial<
    Pick<
      WaitlistEntry,
      | "guest_name"
      | "guest_email"
      | "guest_phone"
      | "preferred_dock"
      | "loa_inches"
      | "beam_inches"
      | "reservation_type"
      | "notes"
      | "tags"
    >
  >,
): void {
  state = {
    ...state,
    waitlist: state.waitlist.map((w) => (w.id === id ? { ...w, ...patch } : w)),
  };
  notify();
  logAuditLocal({
    actor_user_id: "u_current",
    actor_label: "Operator",
    action_type: "waitlist.update",
    target_entity: "waitlist_entry",
    target_id: id,
    payload_delta: JSON.stringify(patch),
  });
}

/**
 * Stamp last_contact_at on a single waitlist entry. Called by the
 * applicant sheet's composer-send so the entry leaves the Stale tab
 * automatically when the operator messages the applicant. Also used
 * by confirmWaitlistInterest as a side effect of marking confirmed.
 *
 * Explicit method so the side effect lives at the call site (the
 * composer-send handler) instead of inside updateWaitlistEntry's
 * empty-patch path — which used to claim it stamped but actually
 * didn't.
 */
export function stampWaitlistContact(id: string): void {
  const nowIso = new Date().toISOString();
  state = {
    ...state,
    waitlist: state.waitlist.map((w) =>
      w.id === id ? { ...w, last_contact_at: nowIso } : w,
    ),
  };
  notify();
  logAuditLocal({
    actor_user_id: "u_current",
    actor_label: "Operator",
    action_type: "waitlist.stamp_contact",
    target_entity: "waitlist_entry",
    target_id: id,
    payload_delta: JSON.stringify({ last_contact_at: nowIso }),
  });
}

/**
 * Operator manually flips "I've talked to them, they still want a slip."
 * Gates the Convert-to-slip action. Also stamps last_contact_at so the
 * entry leaves Stale automatically.
 *
 * Passing note=null clears a prior confirmation (operator typo / changed
 * their mind) — `interest_confirmed_at` goes back to undefined.
 */
export function confirmWaitlistInterest(
  id: string,
  note: string | null,
): void {
  const nowIso = new Date().toISOString();
  state = {
    ...state,
    waitlist: state.waitlist.map((w) =>
      w.id === id
        ? {
            ...w,
            interest_confirmed_at: note === null ? undefined : nowIso,
            interest_confirmation_note:
              note === null ? undefined : note.trim() || undefined,
            last_contact_at: note === null ? w.last_contact_at : nowIso,
          }
        : w,
    ),
  };
  notify();
  logAuditLocal({
    actor_user_id: "u_current",
    actor_label: "Operator",
    action_type:
      note === null ? "waitlist.unconfirm_interest" : "waitlist.confirm_interest",
    target_entity: "waitlist_entry",
    target_id: id,
    payload_delta: JSON.stringify({ note }),
  });
}

/**
 * Bulk-archive the given entries with a reason. Moves them out of
 * Queue / Stale into Archive. They remain searchable for
 * re-engagement and stay in the audit trail.
 */
export function archiveWaitlistEntries(
  ids: string[],
  reason:
    | "got_slip"
    | "withdrew"
    | "aged_out"
    | "non_responder"
    | "too_many_declines"
    | "duplicate",
): { archived: number } {
  if (ids.length === 0) return { archived: 0 };
  const idSet = new Set(ids);
  const nowIso = new Date().toISOString();
  let archived = 0;
  state = {
    ...state,
    waitlist: state.waitlist.map((w) => {
      if (!idSet.has(w.id)) return w;
      archived += 1;
      return {
        ...w,
        archived_at: nowIso,
        archive_reason: reason,
        // Stop the cascade from continuing to consider this entry.
        status: w.status === "pending" ? ("withdrawn" as const) : w.status,
      };
    }),
  };
  notify();
  logAuditLocal({
    actor_user_id: "u_current",
    actor_label: "Operator",
    action_type: "waitlist.bulk_archive",
    target_entity: "waitlist_entry",
    target_id: `bulk:${ids.length}`,
    payload_delta: JSON.stringify({ ids, reason, archived_at: nowIso }),
  });
  return { archived };
}

/**
 * Log a phone call the operator made to a waitlist applicant. Drives
 * the new "Log call" per-row action on /services/waitlist — replaces
 * the parallel offer-cascade machinery for marinas that work the list
 * one applicant at a time, in priority order.
 *
 * Outcomes:
 *   - "accept"          → record the call; caller (UI) launches the
 *                         slip-onboarding wizard separately so the
 *                         operator picks the actual slip + drafts the
 *                         contract there.
 *   - "decline_archive" → record + archive entry with the right reason
 *                         (operator-supplied or "non_responder" default).
 *   - "decline_stay"    → record + refresh last_contact_at so the
 *                         applicant falls off the Stale list. Status
 *                         stays "pending".
 */
export function logWaitlistCall(
  entryId: string,
  outcome: "accept" | "decline_archive" | "decline_stay",
  opts: {
    notes?: string;
    accepted_slip_id?: string;
    archive_reason?:
      | "got_slip"
      | "withdrew"
      | "aged_out"
      | "non_responder"
      | "too_many_declines"
      | "duplicate";
  } = {},
): boolean {
  const idx = state.waitlist.findIndex((w) => w.id === entryId);
  if (idx < 0) return false;
  const ts = new Date().toISOString();
  const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const callEntry: NonNullable<WaitlistEntry["calls"]>[number] = {
    id: callId,
    at: ts,
    by_user_id: "u_current",
    outcome,
    notes: opts.notes?.trim() || undefined,
    accepted_slip_id: outcome === "accept" ? opts.accepted_slip_id : undefined,
  };
  const next = { ...state.waitlist[idx] };
  next.calls = [...(next.calls ?? []), callEntry];
  next.last_contact_at = ts; // every call refreshes the staleness clock

  if (outcome === "decline_archive") {
    next.archived_at = ts;
    next.archive_reason = opts.archive_reason ?? "non_responder";
    if (next.status === "pending") next.status = "withdrawn";
  } else if (outcome === "accept" && opts.accepted_slip_id) {
    // Mark converted so the row falls out of the active queue while
    // the operator works the slip-onboarding wizard. If they back out,
    // a follow-up call can flip it back via update.
    next.status = "converted";
    next.offered_slip_id = opts.accepted_slip_id;
  } else if (outcome === "decline_stay") {
    // Increment decline counter to feed the Stale signal.
    next.decline_count = (next.decline_count ?? 0) + 1;
  }
  const list = state.waitlist.slice();
  list[idx] = next;
  state = { ...state, waitlist: list };
  notify();
  logAuditLocal({
    actor_user_id: "u_current",
    actor_label: "Operator",
    action_type: `waitlist.call.${outcome}`,
    target_entity: "waitlist_entry",
    target_id: entryId,
    payload_delta: JSON.stringify({
      outcome,
      notes: opts.notes,
      accepted_slip_id: opts.accepted_slip_id,
      archive_reason: opts.archive_reason,
    }),
  });
  return true;
}

export function expireWaitlistOffers(opts: {
  now?: Date;
  agent_prompt?: string;
} = {}): { expired: number; advanced: number } {
  const now = opts.now ?? new Date();
  const stale = state.waitlist.filter(
    (w) =>
      w.offer_status === "pending" &&
      w.offer_expires_at &&
      new Date(w.offer_expires_at).getTime() < now.getTime(),
  );
  if (stale.length === 0) return { expired: 0, advanced: 0 };

  const staleIds = new Set(stale.map((s) => s.id));
  state = {
    ...state,
    waitlist: state.waitlist.map((w) =>
      staleIds.has(w.id)
        ? {
            ...w,
            status: "expired" as const,
            offer_status: "expired" as const,
          }
        : w,
    ),
  };

  let advanced = 0;
  for (const s of stale) {
    if (!s.offered_slip_id) continue;
    const fired = advanceToNextCandidate(s.offered_slip_id, s.id);
    advanced += fired.length;
  }

  logAuditLocal({
    actor_label: "Marina Stee (cascade walker)",
    action_type: "waitlist.expire_stale_offers",
    target_entity: "waitlist",
    payload_delta: JSON.stringify({ expired: stale.length, advanced }),
    via_agent: !!opts.agent_prompt,
    agent_prompt: opts.agent_prompt,
  });

  notify();
  return { expired: stale.length, advanced };
}

/**
 * Internal helper: after an offer expires/declines, find the next
 * eligible waitlister for the same slip and fire a fresh offer.
 *
 * Returns the new offer_tokens (empty when there's no candidate).
 */
function advanceToNextCandidate(slipId: string, excludeEntryId: string): string[] {
  const slip = SLIPS.find((s) => s.id === slipId);
  const slipLOA = slip?.max_loa_inches ?? Infinity;
  const next = state.waitlist
    .filter((w) => w.id !== excludeEntryId)
    .filter((w) => w.status === "pending")
    .filter((w) => w.offer_status !== "pending")
    .filter((w) => !w.loa_inches || w.loa_inches <= slipLOA)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (!next) return [];
  // Re-enter the firer with the single candidate. We bypass notify by
  // letting fireWaitlistOffer's own notify() commit at the call site.
  const { tokens } = fireWaitlistOffer({
    slip_id: slipId,
    entry_ids: [next.id],
    expires_hours: 48,
  });
  return tokens;
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
    // SECURITY: crypto.randomUUID — auth-bearing token for waitlist claim flow.
    const token = `claim_${crypto.randomUUID()}`;
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
 *
 * SECURITY: rejects tokens past their `upload_token_expires_at` stamp.
 * Without this guard, an attacker who scrapes an old reminder email
 * could replace a current COI via a long-cold link. Lookups for cert
 * rows that pre-date the expiry field (no `upload_token_expires_at`)
 * are accepted for backward compat — those rows can be backfilled by
 * the next `requestCoiRenewal` mint.
 */
export function getInsuranceByUploadToken(token: string): InsuranceCertificate | undefined {
  const row = state.insurance.find((c) => c.upload_token === token);
  if (!row) return undefined;
  if (row.upload_token_expires_at && row.upload_token_expires_at < new Date().toISOString()) {
    return undefined;
  }
  return row;
}

/**
 * Non-hook accessor — used by lib/agent-actions.ts `ingest_coi_pdf`
 * branch and the COI workflow paths that need to read the cert without
 * subscribing through useSyncExternalStore. Not tenant-scoped; callers
 * are already gated through the per-action RBAC + tenant check.
 */
export function getInsuranceById(id: string): InsuranceCertificate | undefined {
  return state.insurance.find((c) => c.id === id);
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
  // Re-mint if the existing token is missing OR already expired — a
  // stale token reused from a months-old reminder would otherwise stay
  // valid forever. crypto.randomUUID gives ≥122 bits of CSPRNG entropy
  // (vs. ~31 bits in the old `Date.now()_Math.random()` form), making
  // the URL unguessable. 7-day expiry is a sane default for "boater
  // opens email, uploads PDF" — beyond that, operator re-sends.
  const existingValid =
    existing.upload_token &&
    existing.upload_token_expires_at &&
    existing.upload_token_expires_at > now;
  const token = existingValid
    ? existing.upload_token!
    : `coi_${crypto.randomUUID()}`;
  const expiresAt = existingValid
    ? existing.upload_token_expires_at!
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Stamp the token + link_sent_at + expiry
  state = {
    ...state,
    insurance: state.insurance.map((c) =>
      c.id === coiId
        ? {
            ...c,
            upload_token: token,
            upload_token_expires_at: expiresAt,
            upload_link_sent_at: now,
          }
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
    // SECURITY: crypto.randomUUID — see lib/types.ts InsuranceCertificate.
    // F1 prior fix covered the upload_token; this is the row id (non-auth)
    // but kept on crypto.randomUUID for consistency with the F1 pattern.
    id: `coi_${crypto.randomUUID()}`,
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

export function useLedger(): LedgerEntry[] {
  // Tenant scope — same boater-id join as useReservations / useContracts
  // so list pages don't see cross-tenant rows.
  const s = useStore();
  return s.ledger.filter((l) => isInActiveTenant(l.boater_id, s));
}

export function useLedgerForBoater(boaterId: string): LedgerEntry[] {
  const s = useStore();
  return s.ledger.filter((l) => l.boater_id === boaterId);
}

export function usePosOrders(): PosOrder[] {
  const s = useStore();
  // Tenant scope — same legacy fallback as Rate/RentalBoat: rows
  // without tenant_id belong to the first seeded tenant.
  return s.posOrders.filter(
    (o) => (o.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId
  );
}

export function useCommunicationsForBoater(boaterId: string): Communication[] {
  const s = useStore();
  return s.communications.filter((c) => c.boater_id === boaterId);
}

export function useWorkOrders(): WorkOrder[] {
  // Tenant scope — joined through boater.tenant_id so the dashboard +
  // /work-orders board reflect only the active tenant's jobs.
  const s = useStore();
  return s.workOrders.filter((w) => isInActiveTenant(w.boater_id, s));
}

/**
 * Non-hook accessor — used by the recurring-cleaning walker
 * (lib/recurring-cleaning.ts → advanceRecurringCleanings) so the cron
 * path can read the current WO slice without sitting on React's
 * useSyncExternalStore subscription. NOT tenant-scoped because the
 * cron runs across every WO and the cross-tenant guard in
 * executeAgentAction is the actual fence.
 */
export function getWorkOrders(): WorkOrder[] {
  return state.workOrders;
}

export function useWorkOrdersForBoater(boaterId: string): WorkOrder[] {
  const s = useStore();
  return s.workOrders.filter((w) => w.boater_id === boaterId);
}

/**
 * Index of cleaning work orders keyed by their source id (the
 * ClubBooking id or BoatRental id that spawned them via the cleaning
 * wizard / agent). Booking surfaces (Bookings kanban, Pending detail,
 * Club Calendar) use this to render a "Cleaning · open/scheduled/done"
 * chip next to each booking without scanning the full WO list per row.
 *
 * Tenant-scoped through the same `isInActiveTenant` filter as
 * `useWorkOrders()` — a cleaning WO only appears in the index when its
 * boater belongs to the active tenant. Only WOs with both
 * `work_class === "cleaning"` AND a `cleaning_source_id` participate;
 * legacy cleaning WOs whose back-reference still lives in
 * `internal_notes` are intentionally not parsed here.
 *
 * If multiple cleaning WOs ever exist for the same source (shouldn't
 * today, but the schema doesn't forbid it), the most recently inserted
 * one wins — `workOrders` is prepended-on-create, so the first match
 * we hit is the newest.
 */
export function useCleaningWoBySource(): Map<string, WorkOrder> {
  const s = useStore();
  const map = new Map<string, WorkOrder>();
  for (const w of s.workOrders) {
    if (w.work_class !== "cleaning") continue;
    if (!w.cleaning_source_id) continue;
    if (!isInActiveTenant(w.boater_id, s)) continue;
    if (map.has(w.cleaning_source_id)) continue;
    map.set(w.cleaning_source_id, w);
  }
  return map;
}

export function useReservations(): Reservation[] {
  // Tenant scope — same join. Drives /reservations + dashboard
  // arrivals/departures KPI strip per-tenant.
  const s = useStore();
  return s.reservations.filter((r) => isInActiveTenant(r.boater_id, s));
}

export function useReservationsForBoater(boaterId: string): Reservation[] {
  const s = useStore();
  return s.reservations.filter((r) => r.boater_id === boaterId);
}

export function useBoaters(): Boater[] {
  const s = useStore();
  // Tenant scope — only return boaters belonging to the active tenant.
  // Legacy seed records without tenant_id are treated as part of the
  // primary tenant so the existing demo data stays visible.
  return s.boaters.filter(
    (b) =>
      (b.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId
  );
}

/*
 * Tenant-agnostic boater lookup. Used by the portal token resolver
 * since the caller doesn't know which tenant the holder belongs to
 * yet — that's literally what they're trying to figure out.
 */
export function useAllBoaters(): Boater[] {
  return useStore().boaters;
}

/*
 * Given a portal token, return the boater + their tenant. Used by the
 * portal landing to switch the active tenant before rendering so the
 * holder sees their marina's branding (not whichever tenant happens
 * to be active in this browser session).
 */
export function getBoaterAndTenantForToken(
  token: string
): { boater: Boater; tenantId: string } | undefined {
  const boater = state.boaters.find((b) => b.portal_token === token);
  if (!boater) return undefined;
  const tenantId = boater.tenant_id ?? state.tenants[0]?.id ?? "";
  return { boater, tenantId };
}

/**
 * Tenant-scoped vessel list. Vessels don't carry tenant_id directly —
 * they ride their boater's tenant. Filters out vessels whose boater
 * doesn't belong to the active tenant so cross-marina /insurance and
 * /dock views can't accidentally surface another tenant's vessels.
 */
export function useVessels(): Vessel[] {
  const s = useStore();
  return s.vessels.filter((v) => isInActiveTenant(v.boater_id, s));
}

export function useVesselsForBoater(boaterId: string): Vessel[] {
  const s = useStore();
  return s.vessels.filter((v) => v.boater_id === boaterId || v.co_owner_ids.includes(boaterId));
}

export function useContracts(): Contract[] {
  // Tenant scope — same join. Drives /services/contracts + renewal
  // pipeline + dashboard expiring-contracts KPI per-tenant.
  const s = useStore();
  return s.contracts.filter((c) => isInActiveTenant(c.boater_id, s));
}

export function useContractsForBoater(boaterId: string): Contract[] {
  const s = useStore();
  return s.contracts.filter((c) => c.boater_id === boaterId);
}

/**
 * Live slip-status hook — wraps deriveSlipStatus over the tenant-
 * scoped contracts slice. Returns occupied/lapsed sets + slip→boater
 * map. The canonical source of truth for "is this slip vacant?"
 * across waitlist sheet, agent reports, and any future surface that
 * needs to know.
 *
 * Memoized on the contracts slice so the derive pass runs once per
 * mutation — not per render of every subscriber.
 */
export function useSlipStatus(): SlipStatusResult {
  const contracts = useContracts();
  return useMemo(() => deriveSlipStatus(contracts), [contracts]);
}

export function useCardsForBoater(boaterId: string): CardOnFile[] {
  const s = useStore();
  return s.cardsByBoaterId[boaterId] ?? [];
}

export function useWaitlist(): WaitlistEntry[] {
  const s = useStore();
  // Filter by explicit tenant_id (guest entries have no boater_id
  // join to fall back on). Legacy rows default to the primary tenant.
  return s.waitlist.filter(
    (w) => (w.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId
  );
}

export function useMarinaEvents(): MarinaEvent[] {
  const s = useStore();
  return s.events.filter(
    (e) => (e.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId
  );
}

export function useRates(): Rate[] {
  const s = useStore();
  // Tenant scope — legacy rows without tenant_id fall back to the
  // first seeded tenant so the pre-multi-tenant rate seeds still
  // surface on the primary marina's catalog.
  return s.rates.filter(
    (r) => (r.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId
  );
}

export function useFees(): AdditionalFee[] {
  const s = useStore();
  return s.fees.filter(
    (f) => (f.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId
  );
}

/**
 * Scoped fee lookup. Returns fees whose `applies_to` includes the given
 * scope. Use in the consumer that needs them (POS palette, slip wizard,
 * annual run, WO closeout, boat rental). Already tenant-scoped because
 * it reads through useFees().
 */
export function useFeesByScope(scope: AdditionalFee["applies_to"][number]): AdditionalFee[] {
  const fees = useFees();
  return fees.filter((f) => f.applies_to.includes(scope));
}

/**
 * Booking-entity scoped fee lookup. Reads the unified `applies_to_entities`
 * field; legacy fees without it are treated as available to all three
 * entity types (reservation, contract, club_subscription).
 *
 * NOTE: this is the non-hook variant used by mutators and serverless
 * helpers; the value is tenant-filtered against the snapshot via
 * `getSnapshot()` so it stays in-tenant without needing a React render.
 */
export function feesForEntity(
  entity: "reservation" | "contract" | "club_subscription" | "rental_boat",
): AdditionalFee[] {
  const s = state;
  const fallback = s.tenants[0]?.id;
  return s.fees.filter((f) => {
    if ((f.tenant_id ?? fallback) !== s.currentTenantId) return false;
    if (!f.applies_to_entities) return true;
    return f.applies_to_entities.includes(entity);
  });
}

/**
 * Reactive variant of `feesForEntity` — subscribes to the fee catalog via
 * `useFees()` so any wizard using it re-renders when fees are added,
 * edited, or removed. Result identity is memoized so callers can pass it
 * straight into `useMemo` deps without thrashing.
 *
 * Use this from React components; use `feesForEntity` from non-React
 * contexts (agent action executor, server helpers).
 */
export function useFeesForEntity(
  entity: "reservation" | "contract" | "club_subscription" | "rental_boat",
): AdditionalFee[] {
  const fees = useFees();
  return useMemo(
    () =>
      fees.filter((f) => {
        if (!f.applies_to_entities) return true;
        return f.applies_to_entities.includes(entity);
      }),
    [fees, entity],
  );
}

/**
 * Roll up attached service fees into one-time / monthly / annual buckets.
 *  - one-time: sum amounts as-is
 *  - monthly:  amount * termMonths
 *  - annual:   prorated as (amount / 12) * termMonths
 *
 * Fees without an explicit `cadence` default to "one_time". Missing ids
 * (stale references) are silently skipped — callers shouldn't fail on
 * a deleted fee.
 */
export function totalFromAttachedFees(
  fee_ids: string[],
  termMonths: number = 1,
): { oneTime: number; monthly: number; annual: number; total: number } {
  const byId = new Map(state.fees.map((f) => [f.id, f] as const));
  let oneTime = 0;
  let monthly = 0;
  let annual = 0;
  for (const id of fee_ids) {
    const fee = byId.get(id);
    if (!fee) continue;
    const cadence = fee.cadence ?? "one_time";
    if (cadence === "one_time") {
      oneTime += fee.amount;
    } else if (cadence === "monthly") {
      monthly += fee.amount * termMonths;
    } else if (cadence === "annual") {
      annual += (fee.amount / 12) * termMonths;
    }
  }
  const total = oneTime + monthly + annual;
  return { oneTime, monthly, annual, total };
}

/**
 * Per-fee usage count across the entire data model. Drives the
 * "X in use" affordance on the Fees Manager. Counts:
 *   - Contracts that included the fee at draft time (via line items name match)
 *   - Work Order closeout invoices (line items name match)
 *   - Linked contract template (1 if linked_template_id is set)
 *   - Boat rentals with the fee as auto-attach line item
 *   - Ledger invoices referencing the fee name
 */
export function useFeeUsage(): Map<string, number> {
  const s = useStore();
  const usage = new Map<string, number>();
  const fallbackTenant = s.tenants[0]?.id;
  // Only count usage of fees belonging to the active tenant. The
  // downstream consumers (ledger, work orders, etc.) are already
  // boater-joined so they implicitly stay in-tenant; gating the
  // outer loop is enough to keep the Manager's counts honest.
  for (const fee of s.fees) {
    if ((fee.tenant_id ?? fallbackTenant) !== s.currentTenantId) continue;
    let count = 0;
    const name = fee.name.toLowerCase();
    // 1. Ledger invoices with a line item matching this fee
    for (const l of s.ledger) {
      if (l.type !== "invoice") continue;
      const items = l.line_items ?? [];
      for (const li of items) {
        if (li.description.toLowerCase().includes(name)) {
          count += 1;
          break;
        }
      }
    }
    // 2. Linked contract template
    if (fee.linked_template_id) count += 1;
    // 3. Work orders matching the linked activity
    if (fee.linked_activity_type) {
      for (const wo of s.workOrders) {
        if (wo.activity_type === fee.linked_activity_type) count += 1;
      }
    }
    usage.set(fee.id, count);
  }
  return usage;
}

export function useContractTemplates(): ContractTemplate[] {
  const s = useStore();
  return s.templates.filter(
    (t) => (t.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId
  );
}

export function useMeters(): MeterReading[] {
  const s = useStore();
  return s.meters.filter(
    (m) => (m.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId
  );
}

export function useRentalGroups(): RentalGroup[] {
  const s = useStore();
  return s.rentalGroups.filter(
    (g) => (g.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId
  );
}

export function useRentalSpaces(): RentalSpace[] {
  const s = useStore();
  return s.rentalSpaces.filter(
    (sp) => (sp.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId
  );
}

export function useRentalSpacesForGroup(groupId: string): RentalSpace[] {
  // group_id ↔ tenant invariant (a RentalSpace can't change groups) — the
  // outer filter via useRentalSpaces() keeps this in-tenant automatically.
  return useRentalSpaces().filter((s) => s.group_id === groupId);
}

export function useFuelInventory(): FuelInventory[] {
  const s = useStore();
  return s.fuelInventory.filter(
    (f) => (f.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId
  );
}

export function useStaffNotesForBoater(boaterId: string): StaffNote[] {
  const s = useStore();
  return s.staffNotes.filter((n) => n.boater_id === boaterId);
}

export function useInsuranceForBoater(boaterId: string): InsuranceCertificate[] {
  const s = useStore();
  return s.insurance.filter((c) => c.boater_id === boaterId);
}

export function useSlips(): Slip[] {
  const s = useStore();
  return s.slips.filter(
    (slip) => (slip.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId
  );
}

export function useSlip(id: string): Slip | undefined {
  // id-keyed lookup — ids are unique across tenants so no scope
  // filter needed. Drawer / detail surfaces use this for resolution.
  return useStore().slips.find((s) => s.id === id);
}

// ── Slip Types ────────────────────────────────────────────────────────
//
// Tenant-scoped, returned sort_order ASC so consumers (Settings page,
// segmented chips, picklists) always render in the configured display
// order without each call site re-sorting.

export function useSlipTypes(): SlipType[] {
  const s = useStore();
  return s.slipTypes
    .filter(
      (t) => (t.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId,
    )
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);
}

export function addSlipType(t: SlipType) {
  const stamped: SlipType = {
    ...t,
    tenant_id: t.tenant_id ?? state.currentTenantId,
  };
  state = { ...state, slipTypes: [stamped, ...state.slipTypes] };
  notify();
  logAuditLocal({
    actor_user_id: "u_current",
    actor_label: "Operator",
    action_type: "slip_type.create",
    target_entity: "slip_type",
    target_id: stamped.id,
    payload_delta: JSON.stringify({
      class: stamped.class,
      display_label: stamped.display_label,
    }),
  });
}

export function updateSlipType(id: string, patch: Partial<SlipType>): void {
  state = {
    ...state,
    slipTypes: state.slipTypes.map((t) =>
      t.id === id ? { ...t, ...patch } : t,
    ),
  };
  notify();
  logAuditLocal({
    actor_user_id: "u_current",
    actor_label: "Operator",
    action_type: "slip_type.update",
    target_entity: "slip_type",
    target_id: id,
    payload_delta: JSON.stringify(patch),
  });
}

export function deleteSlipType(id: string): void {
  // Soft-delete: flip active=false rather than remove. Existing slips
  // referencing this type via Slip.type_id keep their pointer; the
  // resolver gracefully falls through to derived matching when the
  // type is inactive.
  state = {
    ...state,
    slipTypes: state.slipTypes.map((t) =>
      t.id === id ? { ...t, active: false } : t,
    ),
  };
  notify();
  logAuditLocal({
    actor_user_id: "u_current",
    actor_label: "Operator",
    action_type: "slip_type.deactivate",
    target_entity: "slip_type",
    target_id: id,
    payload_delta: JSON.stringify({ active: false }),
  });
}

export function useInsuranceForVessel(vesselId: string): InsuranceCertificate[] {
  const s = useStore();
  return s.insurance.filter((c) => c.vessel_id === vesselId);
}

// ── Boat Rentals (own-fleet) ─────────────────────────────────

export function upsertRentalBoat(b: RentalBoat) {
  // Same tenant-stamp rule as upsertRate: creates inherit the active
  // tenant, edits preserve the original tenant_id.
  const exists = state.rentalBoats.some((x) => x.id === b.id);
  const stamped: RentalBoat = exists
    ? b
    : { ...b, tenant_id: b.tenant_id ?? state.currentTenantId };
  state = {
    ...state,
    rentalBoats: exists
      ? state.rentalBoats.map((x) => (x.id === stamped.id ? stamped : x))
      : [stamped, ...state.rentalBoats],
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
  // Walk-up rentals carry patron_* (no boater_id) so explicit
  // tenant_id is required to keep them in the right marina's list.
  const stamped: BoatRental = {
    ...r,
    tenant_id: r.tenant_id ?? state.currentTenantId,
  };
  state = { ...state, boatRentals: [stamped, ...state.boatRentals] };
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
  // SECURITY: crypto.randomUUID — auth-bearing token for /pickup/[token]
  // boat-rental check-in flow. ≥122 bits CSPRNG entropy.
  const token = `pickup_${crypto.randomUUID()}`;
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

  // Auto-attach fees flagged for boat rentals. Demo-grade: applies any
  // fee with applies_to: boat_rental and auto_attach=true. (Hoist fee
  // intentionally has auto_attach=false in the seed so it doesn't
  // auto-add — it's an opt-in that staff applies when the lift was used.)
  // Club rentals skip auto-fees by default — the membership covers
  // standard add-ons. Staff can still apply a specific fee manually.
  const isClubRental = r.source === "club";
  // Look up the parent ClubSubscription for this club rental — keeps
  // the closeout invoice FK accurate. Non-club rentals leave it
  // undefined.
  const clubSubscriptionIdForRental = isClubRental && r.club_booking_id
    ? state.clubBookings.find((b) => b.id === r.club_booking_id)?.subscription_id
    : undefined;
  const rentalAutoFees = isClubRental
    ? []
    : state.fees.filter(
        (f) =>
          f.applies_to.includes("boat_rental") &&
          f.auto_attach === true &&
          // Scope to the rental's tenant. The boat is the source of
          // truth for which marina the rental belongs to, and walk-up
          // rentals carry tenant_id explicitly — so we trust r.tenant_id.
          (f.tenant_id ?? state.tenants[0]?.id) ===
            (r.tenant_id ?? state.currentTenantId)
      );
  const autoFeesTotal = rentalAutoFees.reduce((acc, f) => acc + f.amount, 0);

  // Base rental: skipped for club rentals (already paid via monthly
  // subscription). Fuel + damage + late fees still apply because the
  // member used actual consumables / time.
  const baseCharge = isClubRental ? 0 : r.base_amount;
  const finalTotal = +(
    baseCharge + fuelCharge + damageCharge + lateFee + autoFeesTotal
  ).toFixed(2);

  // Build the invoice + receipt. For walk-ins, boater_id is synthetic
  // (`walk_in:<rentalId>`) but the ledger still records it for audit.
  const ledgerOwner = r.boater_id ?? `walk_in:${r.id}`;
  const lineItems: { description: string; amount: number }[] = [];
  if (isClubRental) {
    // Audit line — $0, just so the receipt tells the story.
    lineItems.push({
      description: `${boat.name} rental — covered by Rental Club membership`,
      amount: 0,
    });
  } else {
    lineItems.push({
      description: `${boat.name} rental — base`,
      amount: r.base_amount,
    });
  }
  if (fuelCharge > 0) lineItems.push({ description: "Fuel + refueling", amount: fuelCharge });
  if (damageCharge > 0) lineItems.push({ description: "Damage assessment", amount: damageCharge });
  if (lateFee > 0) lineItems.push({ description: "Late return fee", amount: lateFee });
  for (const f of rentalAutoFees) {
    lineItems.push({ description: f.name, amount: f.amount });
  }

  // Skip invoice creation entirely when the club rental owes nothing —
  // no fuel burn, no damage, no late return. Avoids a $0 invoice
  // cluttering the member's ledger when their day was straight-up
  // covered by the subscription. Receipt comm still fires below so
  // the member gets a confirmation.
  let invoiceId: string | undefined;
  if (!(isClubRental && finalTotal === 0)) {
    invoiceId = nextLedgerId();
    const invoiceNumber = nextInvoiceNumber();
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
      gl_account: isClubRental ? "Rental Club Revenue" : "Boat Rental Revenue",
      qb_sync_status: "pending",
      // Connect the closeout invoice back to the rental + the club
      // booking that triggered it (when applicable) so the ledger
      // drawer + boater timeline can drill back.
      linked_boat_rental_id: r.id,
      linked_club_subscription_id: isClubRental ? clubSubscriptionIdForRental : undefined,
      linked_club_booking_ids: isClubRental && r.club_booking_id ? [r.club_booking_id] : undefined,
    };
    state = { ...state, ledger: [invoice, ...state.ledger] };
  }

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
    related_entity: invoiceId
      ? { type: "invoice", id: invoiceId }
      : { type: "boat_rental", id: r.id },
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
  // Coalesce undefined → null so the return type stays string | null.
  // Callers treat null as "no invoice posted" (e.g. a fully-covered
  // club day) — they don't need to distinguish from "rental not found".
  return invoiceId ?? null;
}

// ── Tenants + Picklists ───────────────────────────────────────
//
// Multi-tenant scaffolding. For the prototype there is a single seeded
// tenant; every picklist read/write goes through the active tenant id.
// When the backend lands, the active tenant comes from the session and
// these helpers stay shape-compatible.

export function useCurrentTenant(): Tenant {
  const s = useStore();
  return s.tenants.find((t) => t.id === s.currentTenantId) ?? s.tenants[0];
}

/**
 * Read all picklists for the current tenant (for the Settings manager).
 */
export function usePicklists(): Picklist[] {
  const s = useStore();
  return s.picklists.filter((p) => p.tenant_id === s.currentTenantId);
}

/**
 * Read a single picklist by field_key, scoped to the current tenant.
 * Returns undefined if no picklist exists for the key (consumer should
 * fall back to nothing).
 */
export function usePicklist(key: PicklistFieldKey): Picklist | undefined {
  const s = useStore();
  return s.picklists.find(
    (p) => p.tenant_id === s.currentTenantId && p.field_key === key
  );
}

/**
 * Active (non-archived) values for a picklist, sorted. Use this in
 * dropdowns where the user is choosing a NEW value.
 */
export function usePicklistValues(key: PicklistFieldKey): PicklistValue[] {
  const pl = usePicklist(key);
  if (!pl) return [];
  return pl.values
    .filter((v) => !v.archived)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * Look up the display label for a value code — falls back to the raw
 * code if the picklist (or value) doesn't exist. Archived values still
 * resolve so historical records stay readable.
 */
export function usePicklistLabel(
  key: PicklistFieldKey,
  value: string | null | undefined
): string {
  const pl = usePicklist(key);
  if (!value) return "—";
  if (!pl) return value;
  const v = pl.values.find((x) => x.value === value);
  if (!v) return value;
  return v.archived ? `${v.label} (archived)` : v.label;
}

/**
 * Bulk label lookup — returns a {value → display-label} map for the
 * whole picklist (active + archived). Use this in renderers that
 * iterate over records and need to label many values at once without
 * calling the hook per row. Archived values get a "(archived)" suffix.
 */
export function usePicklistLabelMap(
  key: PicklistFieldKey
): Map<string, string> {
  const pl = usePicklist(key);
  const m = new Map<string, string>();
  if (!pl) return m;
  for (const v of pl.values) {
    m.set(v.value, v.archived ? `${v.label} (archived)` : v.label);
  }
  return m;
}

/**
 * How many records currently reference each value in the named
 * picklist? Used by the Customization manager to warn before archive
 * ("Archive 'Pontoon' — 14 vessels currently use this value").
 *
 * Returns a Map<value, count> keyed by picklist value code. Sources
 * are hard-coded per field because every picklist points at a
 * different entity collection.
 */
export function usePicklistUsage(
  key: PicklistFieldKey
): Map<string, number> {
  const s = useStore();
  const counts = new Map<string, number>();
  const inc = (v: string | undefined) => {
    if (!v) return;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  };
  switch (key) {
    case "vessel_type":
      for (const x of s.vessels) inc(x.vessel_type);
      break;
    case "occupancy_type":
      for (const x of s.rentalSpaces) inc(x.occupancy_type);
      // Scope to the active tenant so the customization manager's
      // archive-warning counts only this marina's rates.
      for (const x of s.rates) {
        if ((x.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId) {
          inc(x.occupancy_type);
        }
      }
      break;
    case "slip_class":
      // SLIPS is a static seed (not in store); count via rentalSpaces fallback.
      // In production every slip would belong to a tenant collection.
      break;
    case "activity_type":
      for (const x of s.workOrders) inc(x.activity_type);
      break;
    case "event_type":
      for (const x of s.events) inc(x.event_type);
      break;
    case "rental_boat_type":
      for (const x of s.rentalBoats) {
        if ((x.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId) {
          inc(x.type);
        }
      }
      break;
    case "contact_role":
      for (const b of s.boaters) {
        inc(b.primary_contact.role);
        for (const c of b.additional_contacts) inc(c.role);
      }
      break;
    case "refund_reason":
      for (const l of s.ledger) inc(l.refund_reason);
      break;
  }
  return counts;
}

// ── Picklist mutations (super-user) ──────────────────────────

function nextPicklistValueId(tenantId: string) {
  return `pv_${tenantId.slice(-6)}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export function addPicklistValue(
  fieldKey: PicklistFieldKey,
  label: string
): void {
  const tenantId = state.currentTenantId;
  const trimmed = label.trim();
  if (!trimmed) return;
  // Derive a stable code from the label — lowercase, snake_case. Staff
  // can rename the label later without invalidating the stored value.
  const baseValue = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  state = {
    ...state,
    picklists: state.picklists.map((p) => {
      if (p.tenant_id !== tenantId || p.field_key !== fieldKey) return p;
      // Avoid collisions on the value code by appending a counter.
      let v = baseValue;
      let counter = 2;
      while (p.values.some((x) => x.value === v)) {
        v = `${baseValue}_${counter}`;
        counter += 1;
      }
      const maxSort = p.values.reduce(
        (m, x) => Math.max(m, x.sort_order),
        -1
      );
      const newValue: PicklistValue = {
        id: nextPicklistValueId(tenantId),
        value: v,
        label: trimmed,
        sort_order: maxSort + 1,
        archived: false,
      };
      return { ...p, values: [...p.values, newValue] };
    }),
  };
  notify();
}

export function updatePicklistValue(
  fieldKey: PicklistFieldKey,
  valueId: string,
  patch: Partial<Pick<PicklistValue, "label" | "archived" | "sort_order">>
): void {
  const tenantId = state.currentTenantId;
  state = {
    ...state,
    picklists: state.picklists.map((p) => {
      if (p.tenant_id !== tenantId || p.field_key !== fieldKey) return p;
      return {
        ...p,
        values: p.values.map((v) => (v.id === valueId ? { ...v, ...patch } : v)),
      };
    }),
  };
  notify();
}

export function archivePicklistValue(
  fieldKey: PicklistFieldKey,
  valueId: string
): void {
  updatePicklistValue(fieldKey, valueId, { archived: true });
}

export function restorePicklistValue(
  fieldKey: PicklistFieldKey,
  valueId: string
): void {
  updatePicklistValue(fieldKey, valueId, { archived: false });
}

/**
 * Move a value up or down in the sort order. Simpler than full
 * drag-reorder; covers the demo use case.
 */
export function movePicklistValue(
  fieldKey: PicklistFieldKey,
  valueId: string,
  direction: "up" | "down"
): void {
  const tenantId = state.currentTenantId;
  state = {
    ...state,
    picklists: state.picklists.map((p) => {
      if (p.tenant_id !== tenantId || p.field_key !== fieldKey) return p;
      const sorted = [...p.values].sort((a, b) => a.sort_order - b.sort_order);
      const idx = sorted.findIndex((v) => v.id === valueId);
      if (idx < 0) return p;
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= sorted.length) return p;
      // Swap sort_order between the two adjacent values.
      const a = sorted[idx];
      const b = sorted[target];
      const newValues = p.values.map((v) => {
        if (v.id === a.id) return { ...v, sort_order: b.sort_order };
        if (v.id === b.id) return { ...v, sort_order: a.sort_order };
        return v;
      });
      return { ...p, values: newValues };
    }),
  };
  notify();
}

// ── hooks (Boat Rentals) ─────────────────────────────────────

export function useRentalBoats(): RentalBoat[] {
  const s = useStore();
  // Same legacy-row default as useRates.
  return s.rentalBoats.filter(
    (b) => (b.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId
  );
}

export function useBoatRentals(): BoatRental[] {
  const s = useStore();
  // Walk-up rentals can have patron_* instead of boater_id, so the
  // boater-join filter used elsewhere doesn't catch them. Filter on
  // explicit tenant_id with the same legacy fallback.
  return s.boatRentals.filter(
    (r) => (r.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId
  );
}

export function useBoatRentalsForBoat(boatId: string): BoatRental[] {
  const s = useStore();
  // Filter by boat_id then by tenant — a boat can only belong to one
  // tenant so this is belt-and-suspenders, but stays consistent with
  // the rest of the read API.
  return s.boatRentals.filter(
    (r) =>
      r.boat_id === boatId &&
      (r.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId
  );
}

export function useBoatRentalsForBoater(boaterId: string): BoatRental[] {
  // boater_id is already tenant-scoped (boater belongs to exactly one
  // tenant) so no additional filter needed.
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

// ════════════════════════════════════════════════════════════
// Support tickets (Marina Stee carve-out per ../CLAUDE.md §5)
// ════════════════════════════════════════════════════════════
//
// Mirror of the convex/support.ts functions for the mock-data path.
// Same semantics — required subject + description, recommended
// type/priority/area, conversation thread, cancel-not-delete.

export function nextSupportTicketId() {
  return `ticket_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function nextSupportMessageId() {
  return `msg_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function nextSupportReferenceForActiveTenant(s: State): string {
  // Match the Convex-side pattern: ST-### sequence per tenant. Counts
  // existing rows in this tenant + 1.
  const tenantId = s.currentTenantId;
  const count = s.supportTickets.filter(
    (t) => t.tenant_id === tenantId,
  ).length;
  return `ST-${String(count + 1).padStart(3, "0")}`;
}

/**
 * Boater creates a new ticket from the portal. Required fields:
 * subject + description. Everything else falls back to safe defaults
 * (type=other, priority=normal). Captures silent context metadata.
 */
export function createSupportTicket(args: {
  boater_id: string;
  subject: string;
  description: string;
  type?: SupportTicketType;
  priority?: SupportTicketPriority;
  page_or_area?: string;
  steps_to_reproduce?: string;
  attachments?: SupportTicketAttachment[];
  context?: SupportTicket["context"];
}): SupportTicket | null {
  const boater = state.boaters.find((b) => b.id === args.boater_id);
  if (!boater) return null;
  if (!args.subject.trim() || !args.description.trim()) return null;

  const tenantId =
    boater.tenant_id ?? state.tenants[0]?.id ?? state.currentTenantId;
  const reference = nextSupportReferenceForActiveTenant({
    ...state,
    currentTenantId: tenantId,
  });
  const created_at = new Date().toISOString();

  const ticket: SupportTicket = {
    id: nextSupportTicketId(),
    tenant_id: tenantId,
    reference,
    boater_id: args.boater_id,
    subject: args.subject.trim(),
    description: args.description.trim(),
    type: args.type ?? "other",
    priority: args.priority ?? "normal",
    page_or_area: args.page_or_area?.trim() || undefined,
    steps_to_reproduce: args.steps_to_reproduce?.trim() || undefined,
    attachments: args.attachments ?? [],
    messages: [
      {
        id: nextSupportMessageId(),
        author_kind: "system",
        author_label: "Marina Stee",
        body: `Ticket ${reference} received. The marina will reply here as soon as they can.`,
        created_at,
      },
    ],
    status: "open",
    context: args.context ?? {},
    created_at,
    updated_at: created_at,
  };

  state = { ...state, supportTickets: [ticket, ...state.supportTickets] };
  notify();
  return ticket;
}

/**
 * Append a message to a ticket's thread. Mirrors the Convex-side
 * status auto-nudge so the UI behaves identically in mock + live mode.
 */
export function addSupportTicketMessage(args: {
  ticket_id: string;
  body: string;
  author_kind: SupportTicketMessage["author_kind"];
  author_label?: string;
  attachment_ids?: string[];
}): SupportTicketMessage | null {
  const ticket = state.supportTickets.find((t) => t.id === args.ticket_id);
  if (!ticket) return null;
  const body = args.body.trim();
  if (!body) return null;

  const created_at = new Date().toISOString();
  const message: SupportTicketMessage = {
    id: nextSupportMessageId(),
    author_kind: args.author_kind,
    author_label:
      args.author_label ??
      (args.author_kind === "system" ? "Marina Stee" : "You"),
    body,
    created_at,
    attachment_ids: args.attachment_ids,
  };

  let nextStatus: SupportTicketStatus = ticket.status;
  if (args.author_kind === "boater" && ticket.status === "resolved") {
    nextStatus = "open";
  } else if (args.author_kind === "staff" && ticket.status === "open") {
    nextStatus = "in_progress";
  } else if (args.author_kind === "staff" && ticket.status === "in_progress") {
    nextStatus = "awaiting_boater";
  } else if (
    args.author_kind === "boater" &&
    ticket.status === "awaiting_boater"
  ) {
    nextStatus = "in_progress";
  }

  const patched: SupportTicket = {
    ...ticket,
    messages: [...ticket.messages, message],
    status: nextStatus,
    updated_at: created_at,
  };
  state = {
    ...state,
    supportTickets: state.supportTickets.map((t) =>
      t.id === ticket.id ? patched : t,
    ),
  };
  notify();
  return message;
}

/**
 * Operator-side status flip. Used by the staff queue. Marks
 * `closed_at` on resolved/cancelled transitions.
 */
export function updateSupportTicketStatus(
  ticketId: string,
  status: SupportTicketStatus,
) {
  const ticket = state.supportTickets.find((t) => t.id === ticketId);
  if (!ticket) return;
  const updated_at = new Date().toISOString();
  const patched: SupportTicket = {
    ...ticket,
    status,
    updated_at,
    closed_at:
      status === "resolved" || status === "cancelled"
        ? updated_at
        : ticket.closed_at,
  };
  state = {
    ...state,
    supportTickets: state.supportTickets.map((t) =>
      t.id === ticket.id ? patched : t,
    ),
  };
  notify();
}

/**
 * Boater cancels their own ticket. Per the global rule: cancel, not
 * delete — preserves the conversation history with a status flip + a
 * system message describing the cancel.
 */
export function cancelSupportTicket(
  ticketId: string,
  opts?: { reason?: string; actor_label?: string },
) {
  const ticket = state.supportTickets.find((t) => t.id === ticketId);
  if (!ticket) return;
  if (ticket.status === "cancelled") return;

  const closed_at = new Date().toISOString();
  const actor = opts?.actor_label ?? "the boater";
  const systemMessage: SupportTicketMessage = {
    id: nextSupportMessageId(),
    author_kind: "system",
    author_label: "Marina Stee",
    body: opts?.reason
      ? `Ticket cancelled by ${actor}. Reason: ${opts.reason}`
      : `Ticket cancelled by ${actor}.`,
    created_at: closed_at,
  };

  const patched: SupportTicket = {
    ...ticket,
    status: "cancelled",
    messages: [...ticket.messages, systemMessage],
    updated_at: closed_at,
    closed_at,
  };
  state = {
    ...state,
    supportTickets: state.supportTickets.map((t) =>
      t.id === ticket.id ? patched : t,
    ),
  };
  notify();
}

/**
 * Hooks — subscribed reads for the support UI.
 */
export function useSupportTicketsForBoater(boaterId: string): SupportTicket[] {
  const s = useStore();
  return s.supportTickets.filter((t) => t.boater_id === boaterId);
}

export function useSupportTicketsForTenant(): SupportTicket[] {
  // Tenant-scoped — same join pattern as useLedger / useWorkOrders.
  // Rows whose boater_id isn't visible in the active tenant are
  // filtered out (defence in depth on top of the tenant_id field).
  const s = useStore();
  return s.supportTickets.filter(
    (t) =>
      t.tenant_id === s.currentTenantId &&
      isInActiveTenant(t.boater_id, s),
  );
}

export function useSupportTicket(id: string | null | undefined): SupportTicket | null {
  const s = useStore();
  if (!id) return null;
  return s.supportTickets.find((t) => t.id === id) ?? null;
}

// ════════════════════════════════════════════════════════════
// Boater applications — public self-onboarding queue
// ════════════════════════════════════════════════════════════
//
// Public flow:
//   1. /apply → submitApplication(input) — mints token + APP-#### number,
//      inserts in `pending`
//   2. /apply/[token] → useApplicationByToken(token) — boater status check
//
// Operator flow:
//   - useApplications() — tenant-scoped queue at /members → Applications
//   - approveApplication / declineApplication / routeApplicationToWaitlist
//     drive the per-row action buttons
//
// Tokens are minted once at submit and don't rotate (yet — see
// mintApplicationToken below for the future rotate path).

function nextApplicationNumber(): string {
  // Per-tenant sequential — derived from current count + 1000 base so
  // the operator queue shows nice round APP-#### numbers even when the
  // first runtime row lands.
  const tenantRows = state.applications.filter(
    (a) => (a.tenant_id ?? state.currentTenantId) === state.currentTenantId,
  );
  const seq = 1000 + tenantRows.length + 1;
  return `APP-${seq}`;
}

function nextApplicationId(): string {
  return `app_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Strip control chars + cap length on a string before interpolating it
 * into a comm body. The applicant controls fields like
 * `applicant_first_name` end-to-end — without this:
 *   - CRLF survives into the welcome comm body and could turn into
 *     SMTP header injection when the comm dispatches via Postmark.
 *   - `{{merge_tokens}}` collide with the comm template engine — an
 *     applicant could submit "}} {{operator_secret_url}} {{x" as their
 *     name and short-circuit a future template render.
 *   - `<<HANDLE_id>>` collide with the PII tokenizer's handle format.
 *   - Raw HTML can XSS in any operator timeline view that renders the
 *     body as HTML.
 *
 * Conservative escape: strip CRLF and control chars, drop `{{` / `<<`,
 * cap length at 80 chars. Caller should pass field-level-validated
 * input; this is defense-in-depth.
 */
function sanitizeCommSegment(input: string | undefined): string {
  if (!input) return "";
  return input
    .replace(/[\r\n\t -]/g, "")
    .replace(/\{\{/g, "")
    .replace(/<</g, "")
    .slice(0, 80)
    .trim();
}

function nextApplicationToken(): string {
  // SECURITY: see convex/applications.ts → mintToken. Auth-bearing token.
  return `app_${crypto.randomUUID()}`;
}

/**
 * Public submit. Mints the APP-#### number + application_token and
 * inserts the row in `pending`. Caller is responsible for any post-
 * submit comm fan-out — the operator queue does the welcome/decline
 * comms at decision time, not at submit.
 */
export function submitApplication(
  input: Omit<
    Application,
    "id" | "number" | "status" | "application_token" | "submitted_at" | "tenant_id"
  > & { tenant_id?: string },
): Application {
  const now = new Date().toISOString();
  const app: Application = {
    ...input,
    id: nextApplicationId(),
    tenant_id: input.tenant_id ?? state.currentTenantId,
    number: nextApplicationNumber(),
    status: "pending",
    application_token: nextApplicationToken(),
    submitted_at: now,
  };
  state = { ...state, applications: [app, ...state.applications] };
  notify();
  return app;
}

export function getApplicationById(id: string): Application | undefined {
  return state.applications.find((a) => a.id === id);
}

export function getApplicationByToken(token: string): Application | undefined {
  return state.applications.find((a) => a.application_token === token);
}

/**
 * Idempotent token rotate. If the application already has a token, we
 * mint a fresh one (invalidates old links). Returns the new token.
 * Used in the future when an operator wants to "resend status link"
 * but doesn't want the prior link to keep working.
 */
export function mintApplicationToken(id: string): string | undefined {
  const app = state.applications.find((a) => a.id === id);
  if (!app) return undefined;
  const token = nextApplicationToken();
  state = {
    ...state,
    applications: state.applications.map((a) =>
      a.id === id ? { ...a, application_token: token } : a,
    ),
  };
  notify();
  return token;
}

export function markApplicationUnderReview(id: string, reviewer?: string) {
  const app = state.applications.find((a) => a.id === id);
  if (!app || app.status !== "pending") return;
  state = {
    ...state,
    applications: state.applications.map((a) =>
      a.id === id
        ? { ...a, status: "under_review" as const, reviewed_by: reviewer ?? a.reviewed_by }
        : a,
    ),
  };
  notify();
}

/**
 * Approve — mints Boater + Vessel, drafts a welcome comm, stamps
 * result_boater_id. Idempotent: a second call on an already-approved
 * row returns the existing result.
 */
export function approveApplication(
  id: string,
  opts: { reviewer?: string } = {},
): { boaterId: string } | undefined {
  const app = state.applications.find((a) => a.id === id);
  if (!app) return undefined;
  if (app.status === "approved" && app.result_boater_id) {
    return { boaterId: app.result_boater_id };
  }
  const now = new Date().toISOString();
  const display = `${app.applicant_last_name}, ${app.applicant_first_name}`;
  const boaterId = nextBoaterId();
  const boater: Boater = {
    id: boaterId,
    tenant_id: app.tenant_id ?? state.currentTenantId,
    display_name: display,
    first_name: app.applicant_first_name,
    last_name: app.applicant_last_name,
    active: true,
    billing_cadence: "annual",
    tags: ["from-apply"],
    communication_prefs: {
      preferred_channel: "email",
      language: "en",
    },
    primary_contact: {
      id: `ct_${boaterId}_primary`,
      name: display,
      role: "self",
      email: app.applicant_email,
      phone: app.applicant_phone,
      preferred_channel: "email",
      can_be_billed: true,
    },
    additional_contacts: [],
    address: {
      line1: app.applicant_address ?? "",
      city: "",
      state: "",
      zip: "",
      country: "US",
    },
    notes: app.notes,
  };
  const vessel: Vessel = {
    id: nextVesselId(),
    boater_id: boaterId,
    co_owner_ids: [],
    name: app.vessel_name,
    year: app.vessel_year,
    make: app.vessel_make,
    model: app.vessel_model,
    loa_inches: app.vessel_loa_inches,
    beam_inches: app.vessel_beam_inches,
    draft_inches: app.vessel_draft_inches,
    active: true,
  };
  // SECURITY: applicant-controlled name flows into a comm body that
  // gets dispatched via Postmark/Twilio. Without escaping, an applicant
  // could inject CRLF (SMTP header injection at the provider layer),
  // HTML/markdown (XSS in operator timeline view), or `{{merge_tokens}}`
  // (template-injection collision with the merge engine). Strip and
  // length-cap before interpolation.
  const safeFirstName = sanitizeCommSegment(app.applicant_first_name);
  const welcomeComm: Communication = {
    id: `cm_apply_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    boater_id: boaterId,
    type: "email",
    direction: "outbound",
    subject: `Welcome to the marina — ${app.number} approved`,
    body_preview: `Hi ${safeFirstName}, your application has been approved. We've set up your account and your slip preferences are noted. We'll follow up with onboarding details and your contract shortly.`,
    sender_label: "Marina Stee",
    sender_is_system: true,
    recipient: app.applicant_email,
    sent_at: now,
    status: "delivered",
  };
  state = {
    ...state,
    boaters: [boater, ...state.boaters],
    vessels: [vessel, ...state.vessels],
    communications: [welcomeComm, ...state.communications],
    applications: state.applications.map((a) =>
      a.id === id
        ? {
            ...a,
            status: "approved" as const,
            reviewed_at: now,
            reviewed_by: opts.reviewer ?? a.reviewed_by,
            result_boater_id: boaterId,
          }
        : a,
    ),
  };
  notify();
  return { boaterId };
}

export function declineApplication(
  id: string,
  opts: { internal_review_notes?: string; reviewer?: string } = {},
) {
  const app = state.applications.find((a) => a.id === id);
  if (!app || app.status === "declined") return;
  const now = new Date().toISOString();
  const declineComm: Communication = {
    id: `cm_apply_dec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    boater_id: `application:${id}`,
    type: "email",
    direction: "outbound",
    subject: `${app.number} — application status`,
    body_preview: `Hi ${app.applicant_first_name}, thank you for applying. Unfortunately we can't accommodate at this time. ${opts.internal_review_notes ?? ""}`.trim(),
    sender_label: "Marina Stee",
    sender_is_system: true,
    recipient: app.applicant_email,
    sent_at: now,
    status: "delivered",
  };
  state = {
    ...state,
    communications: [declineComm, ...state.communications],
    applications: state.applications.map((a) =>
      a.id === id
        ? {
            ...a,
            status: "declined" as const,
            reviewed_at: now,
            reviewed_by: opts.reviewer ?? a.reviewed_by,
            internal_review_notes:
              opts.internal_review_notes ?? a.internal_review_notes,
          }
        : a,
    ),
  };
  notify();
}

/**
 * Route to H1's waitlist. Mints a WaitlistEntry via the existing
 * addWaitlistEntry path, then stamps result_waitlist_entry_id +
 * status → waitlisted on the application.
 */
export function routeApplicationToWaitlist(
  id: string,
  opts: { reviewer?: string } = {},
): { waitlistEntryId: string } | undefined {
  const app = state.applications.find((a) => a.id === id);
  if (!app) return undefined;
  if (app.status === "waitlisted" && app.result_waitlist_entry_id) {
    return { waitlistEntryId: app.result_waitlist_entry_id };
  }
  const now = new Date().toISOString();
  const waitlistId = `wl_apply_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const entry: WaitlistEntry = {
    id: waitlistId,
    tenant_id: app.tenant_id ?? state.currentTenantId,
    guest_name: `${app.applicant_first_name} ${app.applicant_last_name}`,
    guest_email: app.applicant_email,
    guest_phone: app.applicant_phone,
    loa_inches: app.vessel_loa_inches,
    preferred_dock: app.preferred_dock,
    reservation_type: "annual",
    notes: `Routed from application ${app.number}.`,
    status: "pending",
    created_at: now,
  };
  state = {
    ...state,
    waitlist: [entry, ...state.waitlist],
    applications: state.applications.map((a) =>
      a.id === id
        ? {
            ...a,
            status: "waitlisted" as const,
            reviewed_at: now,
            reviewed_by: opts.reviewer ?? a.reviewed_by,
            result_waitlist_entry_id: waitlistId,
          }
        : a,
    ),
  };
  notify();
  return { waitlistEntryId: waitlistId };
}

// ── Hooks ───────────────────────────────────────────────────
export function useApplications(opts: { status?: ApplicationStatus } = {}): Application[] {
  const s = useStore();
  const tenantId = s.currentTenantId;
  return s.applications.filter((a) => {
    if ((a.tenant_id ?? s.tenants[0]?.id) !== tenantId) return false;
    if (opts.status && a.status !== opts.status) return false;
    return true;
  });
}

export function useApplication(id: string | null | undefined): Application | null {
  const s = useStore();
  if (!id) return null;
  return s.applications.find((a) => a.id === id) ?? null;
}

export function useApplicationByToken(
  token: string | null | undefined,
): Application | null {
  const s = useStore();
  if (!token) return null;
  return s.applications.find((a) => a.application_token === token) ?? null;
}

// ════════════════════════════════════════════════════════════
// Renewal Sweep Coordinator
// ════════════════════════════════════════════════════════════
//
// The annual fall renewal workflow. Mirrors convex/renewalSweeps.ts at
// the mock-store level so the wizard / coordinator page work without
// the Convex backend wired. Once Convex flips on, the
// ConvexAgentRouter callbacks (lib/use-tenant-mutation.ts) route the 3
// agent actions to the dispatchers; the React surfaces flip to live
// queries via use-tenant-query.

function nextRenewalSweepId(): string {
  return `rsw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function nextRenewalSweepItemId(): string {
  return `rswi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function mintRenewalLinkToken(): string {
  return `rsw_t_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function createRenewalSweep(input: {
  name: string;
  window_start: string;
  window_end: string;
  default_rate_adjustment_pct: number;
  notes?: string;
}): RenewalSweep {
  const now = new Date().toISOString();
  const sweep: RenewalSweep = {
    id: nextRenewalSweepId(),
    tenant_id: state.currentTenantId,
    name: input.name,
    window_start: input.window_start,
    window_end: input.window_end,
    default_rate_adjustment_pct: input.default_rate_adjustment_pct,
    status: "draft",
    notes: input.notes,
    created_at: now,
  };
  state = { ...state, renewalSweeps: [sweep, ...state.renewalSweeps] };
  notify();
  return sweep;
}

export function addContractToRenewalSweep(
  sweepId: string,
  sourceContractId: string,
  opts: {
    priority?: "high" | "normal" | "low";
    rate_adjustment_pct?: number;
    internal_notes?: string;
  } = {},
): RenewalSweepItem | undefined {
  // Idempotency — don't double-add the same source contract.
  const existing = state.renewalSweepItems.find(
    (i) => i.sweep_id === sweepId && i.source_contract_id === sourceContractId,
  );
  if (existing) return existing;
  const source = state.contracts.find((c) => c.id === sourceContractId);
  if (!source) return undefined;
  const item: RenewalSweepItem = {
    id: nextRenewalSweepItemId(),
    sweep_id: sweepId,
    source_contract_id: sourceContractId,
    boater_id: source.boater_id,
    priority: opts.priority ?? "normal",
    rate_adjustment_pct: opts.rate_adjustment_pct,
    status: "pending",
    internal_notes: opts.internal_notes,
  };
  state = {
    ...state,
    renewalSweepItems: [...state.renewalSweepItems, item],
  };
  notify();
  return item;
}

export function removeContractFromRenewalSweep(itemId: string) {
  state = {
    ...state,
    renewalSweepItems: state.renewalSweepItems.filter((i) => i.id !== itemId),
  };
  notify();
}

export function updateRenewalSweepItem(
  itemId: string,
  patch: {
    priority?: "high" | "normal" | "low";
    rate_adjustment_pct?: number | null;     // null = clear override
    status?: RenewalSweepItemStatus;
    internal_notes?: string;
  },
) {
  state = {
    ...state,
    renewalSweepItems: state.renewalSweepItems.map((i) => {
      if (i.id !== itemId) return i;
      const next: RenewalSweepItem = { ...i };
      if (patch.priority) next.priority = patch.priority;
      if (patch.rate_adjustment_pct !== undefined) {
        next.rate_adjustment_pct =
          patch.rate_adjustment_pct === null
            ? undefined
            : patch.rate_adjustment_pct;
      }
      if (patch.status) {
        next.status = patch.status;
        if (
          patch.status === "accepted" ||
          patch.status === "declined" ||
          patch.status === "withdrawn" ||
          patch.status === "no_response"
        ) {
          next.responded_at = next.responded_at ?? new Date().toISOString();
        }
      }
      if (patch.internal_notes !== undefined) {
        next.internal_notes = patch.internal_notes;
      }
      return next;
    }),
  };
  notify();
}

/**
 * Launch the sweep: flip status → in_progress, mint a draft successor
 * contract per pending item, stamp the renewal_link_token. Mirrors the
 * Convex `launch` mutation.
 */
export function launchRenewalSweep(sweepId: string):
  | { sweep_id: string; drafted: number }
  | undefined {
  const sweep = state.renewalSweeps.find((s) => s.id === sweepId);
  if (!sweep) return undefined;
  if (sweep.status !== "draft") {
    return { sweep_id: sweepId, drafted: 0 };
  }
  const now = new Date().toISOString();
  const defaultPct = sweep.default_rate_adjustment_pct;
  const items = state.renewalSweepItems.filter((i) => i.sweep_id === sweepId);
  const newContracts: Contract[] = [];
  const itemPatches = new Map<string, Partial<RenewalSweepItem>>();
  let drafted = 0;

  for (const item of items) {
    if (item.status !== "pending") continue;
    const source = state.contracts.find(
      (c) => c.id === item.source_contract_id,
    );
    if (!source) continue;
    const pct = item.rate_adjustment_pct ?? defaultPct;
    const startDate = new Date(source.effective_end);
    startDate.setDate(startDate.getDate() + 1);
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 1);
    const newRate = source.annual_rate
      ? Math.round(source.annual_rate * (1 + pct / 100))
      : undefined;
    const token = mintRenewalLinkToken();
    const renewal: Contract = {
      id: nextContractId(),
      number: nextContractNumber(),
      boater_id: source.boater_id,
      template_id: source.template_id,
      template_version: source.template_version,
      vessel_id: source.vessel_id,
      slip_id: source.slip_id,
      status: "draft",
      effective_start: startDate.toISOString().slice(0, 10),
      effective_end: endDate.toISOString().slice(0, 10),
      annual_rate: newRate,
      billing_cadence: source.billing_cadence,
      signature_token: token,
    };
    newContracts.push(renewal);
    itemPatches.set(item.id, {
      renewal_contract_id: renewal.id,
      renewal_link_token: token,
    });
    drafted += 1;
  }

  state = {
    ...state,
    contracts: [...newContracts, ...state.contracts],
    renewalSweeps: state.renewalSweeps.map((s) =>
      s.id === sweepId
        ? { ...s, status: "in_progress" as const, launched_at: now }
        : s,
    ),
    renewalSweepItems: state.renewalSweepItems.map((i) => {
      const patch = itemPatches.get(i.id);
      return patch ? { ...i, ...patch } : i;
    }),
  };
  notify();
  return { sweep_id: sweepId, drafted };
}

/**
 * Stamp an item as "renewal_sent" — used by the per-item Send button
 * + the bulk Send action. Mock side; does not dispatch the actual comm.
 */
export function markRenewalSweepItemSent(itemId: string) {
  const now = new Date().toISOString();
  state = {
    ...state,
    renewalSweepItems: state.renewalSweepItems.map((i) =>
      i.id === itemId && (i.status === "pending" || i.status === "renewal_sent")
        ? { ...i, status: "renewal_sent", sent_at: now }
        : i,
    ),
  };
  notify();
}

/**
 * Fired by the existing `mark_signed` flow when a renewal contract is
 * signed. Looks up the matching sweep item by renewal_contract_id and
 * flips its status to accepted. Idempotent.
 */
export function recordRenewalSweepAcceptance(renewalContractId: string) {
  const now = new Date().toISOString();
  let touched = false;
  const nextItems = state.renewalSweepItems.map((i) => {
    if (i.renewal_contract_id !== renewalContractId) return i;
    if (i.status === "accepted") return i;
    touched = true;
    return { ...i, status: "accepted" as const, responded_at: now };
  });
  if (!touched) return;
  state = { ...state, renewalSweepItems: nextItems };
  notify();
}

export function recordRenewalSweepDecline(
  itemId: string,
  declineNotes?: string,
) {
  const now = new Date().toISOString();
  state = {
    ...state,
    renewalSweepItems: state.renewalSweepItems.map((i) =>
      i.id === itemId
        ? {
            ...i,
            status: "declined" as const,
            responded_at: now,
            internal_notes: declineNotes ?? i.internal_notes,
          }
        : i,
    ),
  };
  notify();
}

/**
 * Close / cancel the sweep. Defaults to flipping remaining pending /
 * renewal_sent items to "withdrawn" (operator-initiated cancel). Pass
 * "no_response" when the close is a natural end-of-window.
 */
export function cancelRenewalSweep(
  sweepId: string,
  markRemainingAs: "withdrawn" | "no_response" = "withdrawn",
) {
  const sweep = state.renewalSweeps.find((s) => s.id === sweepId);
  if (!sweep || sweep.status === "closed") return;
  const now = new Date().toISOString();
  state = {
    ...state,
    renewalSweeps: state.renewalSweeps.map((s) =>
      s.id === sweepId
        ? { ...s, status: "closed" as const, closed_at: now }
        : s,
    ),
    renewalSweepItems: state.renewalSweepItems.map((i) => {
      if (i.sweep_id !== sweepId) return i;
      if (
        i.status === "accepted" ||
        i.status === "declined" ||
        i.status === "withdrawn" ||
        i.status === "no_response"
      ) {
        return i;
      }
      return { ...i, status: markRemainingAs, responded_at: now };
    }),
  };
  notify();
}

// ── Hooks ─────────────────────────────────────────────────────

export function useRenewalSweeps(): RenewalSweep[] {
  const s = useStore();
  return s.renewalSweeps.filter(
    (r) => (r.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId,
  );
}

export function useRenewalSweep(
  sweepId: string | null | undefined,
): { sweep: RenewalSweep | undefined; items: RenewalSweepItem[] } {
  const s = useStore();
  const sweep = sweepId
    ? s.renewalSweeps.find((r) => r.id === sweepId)
    : undefined;
  const items = sweepId
    ? s.renewalSweepItems.filter((i) => i.sweep_id === sweepId)
    : [];
  return { sweep, items };
}

export function useActiveRenewalSweep(): RenewalSweep | undefined {
  const s = useStore();
  return s.renewalSweeps.find(
    (r) =>
      (r.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId &&
      r.status === "in_progress",
  );
}

// ════════════════════════════════════════════════════════════
// Operator-configurable surfaces (Batch 1)
// ════════════════════════════════════════════════════════════

// ── Marina Profile ──────────────────────────────────────────
export function updateMarinaProfile(patch: Partial<MarinaProfile>) {
  // Write back to BOTH the active slot and the per-tenant map so the
  // edit survives a tenant switch + reload.
  const updated = { ...state.marinaProfile, ...patch };
  state = {
    ...state,
    marinaProfile: updated,
    marinaProfilesByTenant: {
      ...state.marinaProfilesByTenant,
      [updated.tenant_id]: updated,
    },
  };
  notify();
}
export function useMarinaProfile(): MarinaProfile {
  return useStore().marinaProfile;
}

/*
 * Switch the active tenant. Swaps the marinaProfile slot to that
 * tenant's stored profile (falls back to the active one if no profile
 * exists for the target tenant — e.g. a brand-new tenant before any
 * setup). Picklists + entity collections already filter by
 * currentTenantId so they update automatically.
 */
export function switchTenant(tenantId: string): boolean {
  const tenantExists = state.tenants.some((t) => t.id === tenantId);
  if (!tenantExists) return false;
  const nextProfile =
    state.marinaProfilesByTenant[tenantId] ?? state.marinaProfile;
  state = {
    ...state,
    currentTenantId: tenantId,
    marinaProfile: nextProfile,
  };
  notify();
  return true;
}

export function useTenants() {
  return useStore().tenants;
}

/**
 * Non-hook accessor for the active tenant id. Used by lib/agent-fetch.ts
 * to thread the tenant through every /api/agent POST so the server-side
 * agent scopes its boater context per tenant.
 */
export function getCurrentTenantId(): string {
  return state.currentTenantId;
}

// ── Comm templates ──────────────────────────────────────────
export function upsertCommTemplate(t: CommTemplate) {
  const exists = state.commTemplates.some((x) => x.id === t.id);
  // Stamp tenant on create — CommTemplate.tenant_id is required by
  // the type but the caller might pass an empty string from a fresh
  // form. Edits preserve the original tenant.
  const stamped: CommTemplate = exists
    ? t
    : { ...t, tenant_id: t.tenant_id || state.currentTenantId };
  state = {
    ...state,
    commTemplates: exists
      ? state.commTemplates.map((x) => (x.id === stamped.id ? stamped : x))
      : [...state.commTemplates, stamped],
  };
  notify();
}
export function updateCommTemplate(id: string, patch: Partial<CommTemplate>) {
  state = {
    ...state,
    commTemplates: state.commTemplates.map((t) =>
      t.id === id ? { ...t, ...patch } : t
    ),
  };
  notify();
}
export function deleteCommTemplate(id: string) {
  state = {
    ...state,
    commTemplates: state.commTemplates.filter((t) => t.id !== id),
  };
  notify();
}
export function nextCommTemplateId() {
  return `ct_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
export function useCommTemplates(): CommTemplate[] {
  const s = useStore();
  return s.commTemplates.filter((t) => t.tenant_id === s.currentTenantId);
}
export function useCommTemplate(kind: CommTemplateKind): CommTemplate | undefined {
  const s = useStore();
  // Tenant-scoped lookup — templates are per-tenant so a Lakeside
  // booking-confirm template never gets pulled into a Marina Stee comm.
  return s.commTemplates.find(
    (t) => t.kind === kind && t.tenant_id === s.currentTenantId
  );
}

// ── Roles ────────────────────────────────────────────────────
export function upsertRole(r: Role) {
  const exists = state.roles.some((x) => x.id === r.id);
  const stamped: Role = exists
    ? r
    : { ...r, tenant_id: r.tenant_id || state.currentTenantId };
  state = {
    ...state,
    roles: exists
      ? state.roles.map((x) => (x.id === stamped.id ? stamped : x))
      : [...state.roles, stamped],
  };
  notify();
}
export function updateRole(id: string, patch: Partial<Role>) {
  state = {
    ...state,
    roles: state.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  };
  notify();
}
export function deleteRole(id: string) {
  const role = state.roles.find((r) => r.id === id);
  if (role?.is_system) return;
  state = { ...state, roles: state.roles.filter((r) => r.id !== id) };
  notify();
}
export function nextRoleId() {
  return `role_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
export function useRoles(): Role[] {
  const s = useStore();
  return s.roles.filter((r) => r.tenant_id === s.currentTenantId);
}

// ── Staff ────────────────────────────────────────────────────
export function upsertStaffMember(s: StaffMember) {
  const exists = state.staff.some((x) => x.id === s.id);
  const stamped: StaffMember = exists
    ? s
    : { ...s, tenant_id: s.tenant_id || state.currentTenantId };
  state = {
    ...state,
    staff: exists
      ? state.staff.map((x) => (x.id === stamped.id ? stamped : x))
      : [...state.staff, stamped],
  };
  notify();
}
export function updateStaffMember(id: string, patch: Partial<StaffMember>) {
  state = {
    ...state,
    staff: state.staff.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  };
  notify();
}
export function deleteStaffMember(id: string) {
  state = { ...state, staff: state.staff.filter((s) => s.id !== id) };
  notify();
}
export function nextStaffId() {
  return `staff_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
export function useStaff(): StaffMember[] {
  const s = useStore();
  return s.staff.filter((x) => x.tenant_id === s.currentTenantId);
}

// ── Provider configs ────────────────────────────────────────
export function upsertProviderConfig(p: AppProviderConfig) {
  const exists = state.providerConfigs.some((x) => x.id === p.id);
  const stamped: AppProviderConfig = exists
    ? p
    : { ...p, tenant_id: p.tenant_id || state.currentTenantId };
  state = {
    ...state,
    providerConfigs: exists
      ? state.providerConfigs.map((x) => (x.id === stamped.id ? stamped : x))
      : [...state.providerConfigs, stamped],
  };
  notify();
}
export function updateProviderConfig(id: string, patch: Partial<AppProviderConfig>) {
  state = {
    ...state,
    providerConfigs: state.providerConfigs.map((p) =>
      p.id === id ? { ...p, ...patch } : p
    ),
  };
  notify();
}
export function useProviderConfigs(): AppProviderConfig[] {
  const s = useStore();
  return s.providerConfigs.filter((p) => p.tenant_id === s.currentTenantId);
}
export function useProviderConfig(kind: AppProviderConfig["kind"]): AppProviderConfig | undefined {
  const s = useStore();
  return s.providerConfigs.find(
    (p) => p.kind === kind && p.tenant_id === s.currentTenantId
  );
}

// ── POS Locations ───────────────────────────────────────────
export function upsertPosLocation(loc: PosLocation) {
  const exists = state.posLocations.some((x) => x.id === loc.id);
  const stamped: PosLocation = exists
    ? loc
    : { ...loc, tenant_id: loc.tenant_id ?? state.currentTenantId };
  state = {
    ...state,
    posLocations: exists
      ? state.posLocations.map((x) => (x.id === stamped.id ? stamped : x))
      : [...state.posLocations, stamped],
  };
  notify();
}
export function updatePosLocation(id: string, patch: Partial<PosLocation>) {
  state = {
    ...state,
    posLocations: state.posLocations.map((l) =>
      l.id === id ? { ...l, ...patch } : l
    ),
  };
  notify();
}
export function deletePosLocation(id: string) {
  state = {
    ...state,
    posLocations: state.posLocations.filter((l) => l.id !== id),
  };
  notify();
}
export function nextPosLocationId() {
  return `loc_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
export function usePosLocations(): PosLocation[] {
  const s = useStore();
  return s.posLocations
    .filter((l) => (l.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId)
    .sort((a, b) => a.sort_order - b.sort_order);
}
export function useActivePosLocations(): PosLocation[] {
  return usePosLocations().filter((l) => l.active);
}

// ── POS Catalog ─────────────────────────────────────────────
export function upsertPosItem(item: PosCatalogItem) {
  const exists = state.posCatalog.some((x) => x.id === item.id);
  const stamped: PosCatalogItem = exists
    ? item
    : { ...item, tenant_id: item.tenant_id ?? state.currentTenantId };
  state = {
    ...state,
    posCatalog: exists
      ? state.posCatalog.map((x) => (x.id === stamped.id ? stamped : x))
      : [...state.posCatalog, stamped],
  };
  notify();
}
export function updatePosItem(id: string, patch: Partial<PosCatalogItem>) {
  state = {
    ...state,
    posCatalog: state.posCatalog.map((i) =>
      i.id === id ? { ...i, ...patch } : i
    ),
  };
  notify();
}
export function deletePosItem(id: string) {
  state = { ...state, posCatalog: state.posCatalog.filter((i) => i.id !== id) };
  notify();
}
export function nextPosItemId() {
  return `pos_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
export function usePosCatalog(): PosCatalogItem[] {
  const s = useStore();
  return s.posCatalog.filter(
    (i) => (i.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId
  );
}
export function usePosCatalogForLocation(
  locationKey: PosLocation["key"]
): PosCatalogItem[] {
  const s = useStore();
  const fallbackTenant = s.tenants[0]?.id;
  return s.posCatalog.filter(
    (i) =>
      i.active &&
      i.location_keys.includes(locationKey) &&
      (i.tenant_id ?? fallbackTenant) === s.currentTenantId
  );
}
// ── Docks (per-tenant inventory grouping) ─────────────────
//
// Operators manage docks via Settings → Customization → Docks. Slip.dock_id references
// these. When a dock is renamed, every slip on it picks up the new name
// at next render (display reads via the lookup hooks below — slip.dock
// stays as a denormalized cache for back-compat with code that still
// reads the string).
export function upsertDock(d: Dock) {
  const exists = state.docks.some((x) => x.id === d.id);
  state = {
    ...state,
    docks: exists
      ? state.docks.map((x) => (x.id === d.id ? d : x))
      : [...state.docks, d],
  };
  // Keep denormalized slip.dock string in sync — anyone editing dock
  // name expects existing slips to reflect it immediately.
  state = {
    ...state,
    slips: state.slips.map((s) =>
      s.dock_id === d.id ? { ...s, dock: d.name } : s
    ),
  };
  notify();
}
export function updateDock(id: string, patch: Partial<Dock>) {
  state = {
    ...state,
    docks: state.docks.map((d) => (d.id === id ? { ...d, ...patch } : d)),
  };
  if (patch.name) {
    const newName = patch.name;
    state = {
      ...state,
      slips: state.slips.map((s) =>
        s.dock_id === id ? { ...s, dock: newName } : s
      ),
    };
  }
  notify();
}
export function deleteDock(id: string) {
  // Soft-safe delete — refuse if any slip still references this dock.
  const slipsOnDock = state.docks.find((d) => d.id === id)
    ? state.slips.filter((s) => s.dock_id === id).length
    : 0;
  if (slipsOnDock > 0) {
    throw new Error(
      `Can't delete dock — ${slipsOnDock} slip(s) still reference it. Move or delete those slips first.`
    );
  }
  state = { ...state, docks: state.docks.filter((d) => d.id !== id) };
  notify();
}
export function nextDockId() {
  return `dock_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
}
export function useDocks(): Dock[] {
  return useStore().docks.sort((a, b) => a.sort_order - b.sort_order);
}
export function useActiveDocks(): Dock[] {
  return useDocks().filter((d) => d.active);
}
export function useDock(id: string | undefined): Dock | undefined {
  const docks = useStore().docks;
  if (!id) return undefined;
  return docks.find((d) => d.id === id);
}

// Permissions util — checks whether the (single) current staff session
// has a permission. Stub: returns true for super-admin role in seed,
// real impl wires session → staff_id → role_id → permissions.
export function hasPermission(
  staffId: string | undefined,
  perm: PermissionKey
): boolean {
  if (!staffId) return false;
  const s = state.staff.find((x) => x.id === staffId);
  if (!s) return false;
  const role = state.roles.find((r) => r.id === s.role_id);
  return role?.permissions.includes(perm) ?? false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rental Club hooks + mutators
// ─────────────────────────────────────────────────────────────────────────────

// Tenant-scoped club hooks — every list view + KPI aggregate is
// joined through Boater.tenant_id so the demo's two tenants don't
// leak data across each other. Per-boater lookups stay unfiltered
// (the boater_id IS the scope) so the portal works regardless of
// which tenant happens to be active in this browser.

/** Returns true when this boater belongs to the active tenant. */
function isInActiveTenant(boaterId: string, s: State): boolean {
  const b = s.boaters.find((x) => x.id === boaterId);
  if (!b) return false;
  return (b.tenant_id ?? s.tenants[0]?.id) === s.currentTenantId;
}

/**
 * Returns the MarinaProfile that owns this boater. Comm helpers use
 * this so the sender_label + body sign-off always reflect the
 * boater's own marina — never whichever tenant happens to be active
 * in this staff session.
 */
function profileForBoater(boaterId: string): MarinaProfile {
  const b = state.boaters.find((x) => x.id === boaterId);
  const tenantId = b?.tenant_id ?? state.tenants[0]?.id ?? state.currentTenantId;
  return state.marinaProfilesByTenant[tenantId] ?? state.marinaProfile;
}

/**
 * Resolves the effective plan amounts for a subscription. Returns
 * the snapshot fields when present (grandfathered pricing), otherwise
 * falls back to the live Rate. Use this everywhere subscription
 * pricing is displayed or computed (KPIs, billing run, cancel sheet
 * math, portal display).
 *
 * Returns null when the subscription points at a Rate that no longer
 * exists AND has no snapshot — that's a data error but we return null
 * so callers can render a safe "—" instead of crashing.
 */
export function effectivePlanFor(sub: ClubSubscription): {
  monthly_fee: number;
  join_fee: number;
  days_per_month: number;
  plan_tier?: ClubPlanTier;
  plan_name?: string;
  plan_rate_id: string;
} | null {
  const rate = state.rates.find((r) => r.id === sub.plan_rate_id);
  const monthlyFee = sub.joined_at_monthly_fee ?? rate?.amount;
  // Setup fee lookup — find the matching one-time Rate by plan_tier.
  // Falls back to 0 when no setup-fee row exists (some tiers are
  // genuinely free to join).
  const setupRate = rate?.plan_tier
    ? state.rates.find(
        (r) =>
          r.occupancy_type === "Rental Club" &&
          r.cadence === "one_time" &&
          r.plan_tier === rate.plan_tier
      )
    : undefined;
  const joinFee = sub.joined_at_join_fee ?? setupRate?.amount ?? 0;
  const daysPerMonth = sub.joined_at_days_per_month ?? rate?.days_per_month;
  if (
    monthlyFee == null ||
    daysPerMonth == null
  ) {
    return null;
  }
  return {
    monthly_fee: monthlyFee,
    join_fee: joinFee,
    days_per_month: daysPerMonth,
    plan_tier: rate?.plan_tier,
    plan_name: rate?.name,
    plan_rate_id: sub.plan_rate_id,
  };
}

/**
 * Hook variant — subscribes to store changes so React components
 * re-render when the operator edits the Rate catalog.
 */
export function useEffectivePlanFor(
  sub: ClubSubscription | undefined
): ReturnType<typeof effectivePlanFor> | null {
  const s = useStore();
  if (!sub) return null;
  // Re-implement inline against the live store snapshot so it
  // re-renders on edits. Same logic as the non-hook variant.
  const rate = s.rates.find((r) => r.id === sub.plan_rate_id);
  const monthlyFee = sub.joined_at_monthly_fee ?? rate?.amount;
  const setupRate = rate?.plan_tier
    ? s.rates.find(
        (r) =>
          r.occupancy_type === "Rental Club" &&
          r.cadence === "one_time" &&
          r.plan_tier === rate.plan_tier
      )
    : undefined;
  const joinFee = sub.joined_at_join_fee ?? setupRate?.amount ?? 0;
  const daysPerMonth = sub.joined_at_days_per_month ?? rate?.days_per_month;
  if (monthlyFee == null || daysPerMonth == null) return null;
  return {
    monthly_fee: monthlyFee,
    join_fee: joinFee,
    days_per_month: daysPerMonth,
    plan_tier: rate?.plan_tier,
    plan_name: rate?.name,
    plan_rate_id: sub.plan_rate_id,
  };
}

/**
 * Returns all Rate rows that are Rental Club plans (monthly cadence,
 * Rental Club service type). Used by the subscription form's plan
 * picker and the Services → Rental Club catalog listing.
 */
export function useClubPlans() {
  const s = useStore();
  const fallbackTenant = s.tenants[0]?.id;
  return s.rates
    .filter(
      (r) =>
        r.occupancy_type === "Rental Club" &&
        r.cadence === "monthly" &&
        (r.tenant_id ?? fallbackTenant) === s.currentTenantId
    )
    .sort((a, b) => a.amount - b.amount);
}

/**
 * Non-hook accessor for club plans — for agent executors / mutators
 * that need to look a plan up off the current store snapshot without
 * a React subscription.
 */
export function getClubPlans(): Rate[] {
  const fallbackTenant = state.tenants[0]?.id;
  return state.rates
    .filter(
      (r) =>
        r.occupancy_type === "Rental Club" &&
        r.cadence === "monthly" &&
        (r.tenant_id ?? fallbackTenant) === state.currentTenantId
    )
    .sort((a, b) => a.amount - b.amount);
}

/**
 * Look up a club plan by tier (basic/plus/premium). Returns the first
 * matching plan or undefined if the operator hasn't seeded one for
 * that tier. Non-hook — safe to call from agent executors.
 */
export function getClubPlanByTier(tier: ClubPlanTier): Rate | undefined {
  return getClubPlans().find((p) => p.plan_tier === tier);
}

/**
 * Look up the setup-fee Rate row for a given plan tier. Setup fees
 * used to be embedded as `join_fee` on the plan Rate itself; they
 * are now standalone catalog rows (cadence="one_time", same plan_tier
 * as the parent plan) so they surface in the unified add-on multi-
 * select alongside everything else.
 *
 * Returns undefined when the operator hasn't seeded a setup-fee row
 * for that tier (zero-charge tiers are valid — no row = no charge).
 */
export function getSetupRateForTier(
  tier: ClubPlanTier | undefined
): Rate | undefined {
  if (!tier) return undefined;
  const fallbackTenant = state.tenants[0]?.id;
  return state.rates.find(
    (r) =>
      r.occupancy_type === "Rental Club" &&
      r.cadence === "one_time" &&
      r.plan_tier === tier &&
      (r.tenant_id ?? fallbackTenant) === state.currentTenantId
  );
}

/**
 * Reactive variant of `getSetupRateForTier` — for React components
 * that want to live-display the setup fee for a tier and re-render
 * when the catalog changes.
 */
export function useSetupRateForTier(
  tier: ClubPlanTier | undefined
): Rate | undefined {
  const rates = useRates();
  return useMemo(
    () =>
      tier
        ? rates.find(
            (r) =>
              r.occupancy_type === "Rental Club" &&
              r.cadence === "one_time" &&
              r.plan_tier === tier
          )
        : undefined,
    [rates, tier]
  );
}

/**
 * Migrate every active sub on a given plan from their grandfathered
 * `joined_at_*` snapshot to the plan's current catalog values, and
 * dispatch a price-change notice to each affected member.
 *
 * Returns the list of subscription IDs that were touched (skips subs
 * that were already at the current price). The Plans catalog table
 * uses this from a "Migrate N members" button per row.
 */
export function migrateMembersToCurrentPrice(planRateId: string): {
  migrated: string[];
  alreadyCurrent: number;
} {
  const plan = state.rates.find((r) => r.id === planRateId);
  if (!plan) return { migrated: [], alreadyCurrent: 0 };

  const affected = state.clubSubscriptions.filter(
    (s) => s.plan_rate_id === planRateId && s.status === "active"
  );

  const migrated: string[] = [];
  let alreadyCurrent = 0;
  const now = new Date().toISOString();

  // Setup fee for this plan's tier — looked up from the catalog (one-
  // time Rate row matching plan_tier). Replaces the legacy embedded
  // plan.join_fee. Undefined plan_tier → no setup row → fee 0.
  const setupRate = plan.plan_tier
    ? state.rates.find(
        (r) =>
          r.occupancy_type === "Rental Club" &&
          r.cadence === "one_time" &&
          r.plan_tier === plan.plan_tier
      )
    : undefined;
  const currentSetup = setupRate?.amount ?? 0;

  for (const sub of affected) {
    const currentMonthly = sub.joined_at_monthly_fee ?? plan.amount;
    const isCurrent =
      currentMonthly === plan.amount &&
      (sub.joined_at_join_fee ?? currentSetup) === currentSetup &&
      (sub.joined_at_days_per_month ?? plan.days_per_month) ===
        plan.days_per_month;
    if (isCurrent) {
      alreadyCurrent += 1;
      continue;
    }
    const oldFee = currentMonthly;

    const updated: ClubSubscription = {
      ...sub,
      joined_at_monthly_fee: plan.amount,
      joined_at_join_fee: currentSetup,
      joined_at_days_per_month: plan.days_per_month ?? 0,
    };
    state = {
      ...state,
      clubSubscriptions: state.clubSubscriptions.map((s) =>
        s.id === sub.id ? updated : s
      ),
    };

    // Dispatch a price-change comm so the member knows. Same shape as
    // the billing-run comm — uses the member's marina profile so
    // multi-tenant comms stay branded correctly.
    const boater = state.boaters.find((b) => b.id === sub.boater_id);
    if (boater) {
      const profile = profileForBoater(boater.id);
      const channel =
        sub.billing_channel ?? boater.communication_prefs.preferred_channel;
      const recipient =
        channel === "email"
          ? boater.primary_contact.email ?? ""
          : boater.primary_contact.phone ?? "";
      const subject = `Rental Club ${plan.name} — updated pricing`;
      const body =
        `Hi ${boater.first_name},\n\n` +
        `Heads up: your Rental Club monthly fee is changing from ` +
        `${formatMoneyInline(oldFee)} to ${formatMoneyInline(plan.amount)} starting on your next billing cycle. ` +
        `Your plan benefits (${plan.days_per_month ?? 0} days/month) stay the same.\n\n` +
        `Questions? Just reply.\n\n${profile.short_name}`;

      const comm: Communication = {
        id: `cm_club_migrate_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        boater_id: boater.id,
        type: channel,
        direction: "outbound",
        sender_label: profile.outbound_email_from_name,
        sender_is_system: true,
        recipient,
        subject,
        body_preview: body.slice(0, 80),
        full_body: body,
        sent_at: now,
        status: "delivered",
        related_entity: { type: "club_subscription", id: sub.id },
      };
      state = { ...state, communications: [comm, ...state.communications] };
    }

    migrated.push(sub.id);
  }

  if (migrated.length > 0 || alreadyCurrent > 0) notify();
  return { migrated, alreadyCurrent };
}

export function useClubSubscriptions(): ClubSubscription[] {
  const s = useStore();
  return s.clubSubscriptions.filter((sub) => isInActiveTenant(sub.boater_id, s));
}

export function useClubSubscriptionForBoater(
  boaterId: string
): ClubSubscription | undefined {
  return useStore().clubSubscriptions.find((s) => s.boater_id === boaterId);
}

export function useClubBookings(): ClubBooking[] {
  const s = useStore();
  return s.clubBookings.filter((b) => isInActiveTenant(b.boater_id, s));
}

export function useClubBookingsForMonth(year: number, month: number): ClubBooking[] {
  // month is 0-indexed to match Date semantics
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const s = useStore();
  return s.clubBookings.filter(
    (b) => b.date.startsWith(prefix) && isInActiveTenant(b.boater_id, s)
  );
}

export function useClubBookingsForBoater(boaterId: string): ClubBooking[] {
  return useStore().clubBookings.filter((b) => b.boater_id === boaterId);
}

export function nextClubSubscriptionId(): string {
  const max = state.clubSubscriptions
    .map((s) => Number(s.id.replace(/[^0-9]/g, "")) || 0)
    .reduce((a, b) => Math.max(a, b), 0);
  return `club_${String(max + 1).padStart(3, "0")}`;
}

/**
 * Member-portal Rental Club signup. Creates the ClubSubscription with
 * snapshot fields from the chosen plan, posts the join-fee invoice
 * (auto-charged if the boater has a default card on file), and
 * dispatches a welcome comm.
 *
 * Distinct from the staff/agent `create_club_subscription` because:
 *   - Boater is implicit (the portal session)
 *   - Auto-charges the join fee right away
 *   - Comm has a member-facing tone ("Welcome to the club")
 *
 * Returns the new sub id or null if the plan / boater is missing.
 */
export function joinClubFromPortal(
  boaterId: string,
  planRateId: string
): string | null {
  const boater = state.boaters.find((b) => b.id === boaterId);
  const plan = state.rates.find((r) => r.id === planRateId);
  if (!boater || !plan) return null;

  // Defense: don't double-enroll. If the member already has an active
  // or paused sub, no-op.
  const existing = state.clubSubscriptions.find(
    (s) =>
      s.boater_id === boaterId &&
      (s.status === "active" || s.status === "past_due" || s.status === "paused")
  );
  if (existing) return existing.id;

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const subId = nextClubSubscriptionId();

  // Snapshot the plan economics at signup so future operator price
  // edits grandfather this member at today's amount. Setup fee is
  // looked up from its own catalog Rate row (cadence: one_time,
  // matching plan_tier) — the legacy plan.join_fee field is gone.
  const setupRate = plan.plan_tier
    ? state.rates.find(
        (r) =>
          r.occupancy_type === "Rental Club" &&
          r.cadence === "one_time" &&
          r.plan_tier === plan.plan_tier
      )
    : undefined;
  const joinFee = setupRate?.amount ?? 0;
  const monthlyFee = plan.amount;
  const daysPerMonth = plan.days_per_month ?? 0;

  // Compute next_billing_date — one month from today.
  const nextBilling = (() => {
    const d = new Date(today);
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  })();

  const sub: ClubSubscription = {
    id: subId,
    boater_id: boaterId,
    plan_rate_id: plan.id,
    joined_at_monthly_fee: monthlyFee,
    joined_at_join_fee: joinFee,
    joined_at_days_per_month: daysPerMonth,
    status: "active",
    member_since: today,
    next_billing_date: nextBilling,
  };

  // Post the join-fee invoice. If a default card is on file, auto-pay
  // it the same way the monthly billing run does. Otherwise leave it
  // open for the member to pay through the portal.
  const invoiceId = nextLedgerId();
  const invoice: LedgerEntry = {
    id: invoiceId,
    boater_id: boater.id,
    type: "invoice",
    number: nextInvoiceNumber(),
    date: today,
    amount: joinFee,
    open_balance: joinFee,
    method: "ach",
    status: joinFee > 0 ? "open" : "paid",
    gl_account: "Rental Club Revenue",
    qb_sync_status: "pending",
    line_items: [
      {
        description: `Rental Club — ${plan.name} (one-time join fee)`,
        amount: joinFee,
      },
    ],
    linked_club_subscription_id: subId,
  };

  let stateNext = {
    ...state,
    clubSubscriptions: [sub, ...state.clubSubscriptions],
    ledger: joinFee > 0 ? [invoice, ...state.ledger] : state.ledger,
  };

  // Auto-charge against the default card if present.
  let autoCharged = false;
  if (joinFee > 0) {
    const defaultCard = stateNext.cardsByBoaterId[boater.id]?.find(
      (c) => c.is_default
    );
    if (defaultCard) {
      const paymentId = nextLedgerId();
      const payment: LedgerEntry = {
        id: paymentId,
        boater_id: boater.id,
        type: "payment",
        number: nextInvoiceNumber(),
        date: today,
        amount: joinFee,
        open_balance: 0,
        method: "card",
        processor_ref: `auto_club_join_${defaultCard.id.slice(-6)}`,
        status: "paid",
        applied_to_invoice_ids: [invoiceId],
        gl_account: "Cash / Credit Card",
        qb_sync_status: "pending",
      };
      stateNext = {
        ...stateNext,
        ledger: [
          payment,
          ...stateNext.ledger.map((l) =>
            l.id === invoiceId ? { ...l, status: "paid" as const, open_balance: 0, method: "card" as const } : l
          ),
        ],
      };
      autoCharged = true;
    }
  }

  // Welcome comm — member-facing tone, tenant-branded sender.
  const profile = profileForBoater(boater.id);
  const channel = boater.communication_prefs.preferred_channel;
  const recipient =
    channel === "email"
      ? boater.primary_contact.email ?? ""
      : boater.primary_contact.phone ?? "";
  const body =
    `Hi ${boater.first_name},\n\n` +
    `Welcome to the ${profile.short_name} Rental Club! You're enrolled in the ${plan.name} plan — ` +
    `${daysPerMonth} days/month on the fleet, ${formatMoneyInline(monthlyFee)}/month.\n\n` +
    (joinFee > 0
      ? autoCharged
        ? `Your ${formatMoneyInline(joinFee)} join fee was charged to the card on file.\n\n`
        : `A ${formatMoneyInline(joinFee)} join-fee invoice is in your portal — pay anytime.\n\n`
      : "") +
    `Book your first day right from the portal. See you on the water.\n\n` +
    `— ${profile.short_name}`;
  const welcome: Communication = {
    id: `cm_club_welcome_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    boater_id: boater.id,
    type: channel,
    direction: "outbound",
    sender_label: profile.outbound_email_from_name,
    sender_is_system: true,
    recipient,
    subject: `Welcome to the ${profile.short_name} Rental Club`,
    body_preview: body.slice(0, 80),
    full_body: body,
    sent_at: now,
    status: "delivered",
    related_entity: { type: "club_subscription", id: subId },
  };
  stateNext = { ...stateNext, communications: [welcome, ...stateNext.communications] };

  state = stateNext;
  notify();
  return subId;
}

export function nextClubBookingId(): string {
  const max = state.clubBookings
    .map((b) => Number(b.id.replace(/[^0-9]/g, "")) || 0)
    .reduce((a, b) => Math.max(a, b), 0);
  return `cb_${String(max + 1).padStart(3, "0")}`;
}

export function upsertClubSubscription(sub: ClubSubscription) {
  const exists = state.clubSubscriptions.some((s) => s.id === sub.id);

  // Reactivation detection — when a NEW active sub appears for a
  // boater who previously had a cancelled sub, mark the prior one
  // with the new sub's id. Reports reads this to attribute MRR
  // recovered to the reactivation campaign. Skips for existing-sub
  // upserts (edit case) since the back-pointer is set at creation.
  const isNewActiveSub =
    !exists && (sub.status === "active" || sub.status === "past_due");
  let updatedSubs = exists
    ? state.clubSubscriptions.map((s) => (s.id === sub.id ? sub : s))
    : [sub, ...state.clubSubscriptions];

  if (isNewActiveSub) {
    const priorCancelled = state.clubSubscriptions.find(
      (s) =>
        s.boater_id === sub.boater_id &&
        s.status === "cancelled" &&
        !s.reactivated_to_subscription_id
    );
    if (priorCancelled) {
      updatedSubs = updatedSubs.map((s) =>
        s.id === priorCancelled.id
          ? { ...s, reactivated_to_subscription_id: sub.id }
          : s
      );
    }
  }

  state = {
    ...state,
    clubSubscriptions: updatedSubs,
  };
  notify();
}

export function deleteClubSubscription(id: string) {
  state = {
    ...state,
    clubSubscriptions: state.clubSubscriptions.filter((s) => s.id !== id),
    // Cascade — bookings under a removed subscription are orphaned, so
    // drop them too. Matches operator expectation of "delete record =
    // wipe their scheduled days too." Reserved for admin cleanup. The
    // normal lifecycle uses cancelClubSubscription() below.
    clubBookings: state.clubBookings.filter((b) => b.subscription_id !== id),
  };
  notify();
}

/*
 * Pause a membership. status='paused', monthly billing stops until
 * resumed. Forward bookings get cancelled (you can't take out a boat
 * while paused) but the subscription record + history stay intact.
 * resume_on can be set for auto-resume after a future date (e.g.
 * "I'm traveling until September 1"). When null, resume is manual.
 *
 * Pause is for the "I'll be away for a month" case — softer than
 * cancel, no refund issued (member chose to pause, not cancel).
 */
export function pauseClubSubscription(id: string, resumeOn?: string): boolean {
  const sub = state.clubSubscriptions.find((s) => s.id === id);
  if (!sub || sub.status !== "active") return false;
  const today = new Date().toISOString().slice(0, 10);
  state = {
    ...state,
    clubSubscriptions: state.clubSubscriptions.map((s) =>
      s.id === id
        ? {
            ...s,
            status: "paused" as const,
            paused_at: today,
            resume_on: resumeOn,
          }
        : s
    ),
    clubBookings: state.clubBookings.map((b) =>
      b.subscription_id === id &&
      (b.status === "requested" || b.status === "confirmed")
        ? { ...b, status: "cancelled" as const }
        : b
    ),
  };
  notify();
  return true;
}

/*
 * Resume a paused membership. status flips back to active; next
 * billing date set to one month from today so they get a fresh
 * billing period start.
 */
export function resumeClubSubscription(id: string): boolean {
  const sub = state.clubSubscriptions.find((s) => s.id === id);
  if (!sub || sub.status !== "paused") return false;
  const nextDate = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  })();
  state = {
    ...state,
    clubSubscriptions: state.clubSubscriptions.map((s) =>
      s.id === id
        ? {
            ...s,
            status: "active" as const,
            next_billing_date: nextDate,
            paused_at: undefined,
            resume_on: undefined,
          }
        : s
    ),
  };
  notify();
  return true;
}

/*
 * Sweep paused subscriptions and auto-resume any whose resume_on date
 * has passed. Returns the count resumed. Idempotent — safe to call on
 * every mount of the rental-club view, which is how the dashboard
 * keeps pause windows honest without a cron. Also dispatches a
 * "welcome back, billing restarts today" comm to each member resumed.
 */
export function checkAutoResumes(): number {
  const today = new Date().toISOString().slice(0, 10);
  const toResume = state.clubSubscriptions.filter(
    (s) =>
      s.status === "paused" &&
      s.resume_on != null &&
      s.resume_on <= today
  );
  if (toResume.length === 0) return 0;
  const nextDate = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  })();
  state = {
    ...state,
    clubSubscriptions: state.clubSubscriptions.map((s) =>
      toResume.some((t) => t.id === s.id)
        ? {
            ...s,
            status: "active" as const,
            next_billing_date: nextDate,
            paused_at: undefined,
            resume_on: undefined,
          }
        : s
    ),
  };

  // Welcome-back comms — one per resumed member, routed through
  // billing_channel preference (the resume IS a billing event). Stays
  // inside the same notify() cycle so subscribers see both the state
  // change and the new comm together.
  for (const sub of toResume) {
    const boater = state.boaters.find((b) => b.id === sub.boater_id);
    if (!boater) continue;
    const profile = profileForBoater(boater.id);
    const channel: CommunicationChannel =
      sub.billing_channel ?? boater.communication_prefs.preferred_channel;
    const recipient =
      channel === "email"
        ? boater.primary_contact.email ?? ""
        : boater.primary_contact.phone ?? "";
    const body =
      `Hi ${boater.first_name},\n\n` +
      `Welcome back — your Rental Club membership has resumed today. ` +
      `Your next monthly invoice will post around ${nextDate}.\n\n` +
      `Ready for a day on the water? Request one through your portal.\n\n` +
      `${profile.short_name}`;
    const comm: Communication = {
      id: `cm_club_resume_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      boater_id: boater.id,
      type: channel,
      direction: "outbound",
      sender_label: profile.outbound_email_from_name,
      sender_is_system: true,
      recipient,
      subject: `Welcome back — Rental Club resumed`,
      body_preview: body.slice(0, 80),
      full_body: body,
      sent_at: new Date().toISOString(),
      status: "delivered",
    };
    state = { ...state, communications: [comm, ...state.communications] };
  }

  notify();
  return toResume.length;
}

/*
 * Send a "come back" reactivation message to members cancelled within
 * the window (default 30–90 days ago). Cap: one reactivation per
 * member ever, tracked via reactivation_sent_at. Returns the boater
 * IDs that received a message.
 */
export function sendClubReactivationComms(opts?: {
  minDaysAgo?: number;
  maxDaysAgo?: number;
}): { sentTo: string[]; skipped: number } {
  const minDays = opts?.minDaysAgo ?? 30;
  const maxDays = opts?.maxDaysAgo ?? 90;
  const today = Date.now();
  const sentTo: string[] = [];
  let skipped = 0;

  // Resolve when each cancelled sub effectively ended. We don't store
  // a cancelled_at — best signal is the most recent member_since +
  // monthly billing for that boater. For the prototype we approximate
  // by using member_since as the floor and treating subs with no
  // reactivation_sent_at as eligible if status='cancelled' for now.
  for (const sub of state.clubSubscriptions) {
    if (sub.status !== "cancelled") continue;
    if (sub.reactivation_sent_at) {
      skipped += 1;
      continue;
    }
    // Approximate "days since cancellation" via member_since.
    const since = new Date(sub.member_since).getTime();
    const daysAgo = Math.floor((today - since) / 86_400_000);
    if (daysAgo < minDays || daysAgo > maxDays) {
      skipped += 1;
      continue;
    }
    const boater = state.boaters.find((b) => b.id === sub.boater_id);
    if (!boater) continue;
    const profile = profileForBoater(boater.id);

    const channel: CommunicationChannel =
      sub.booking_channel ?? boater.communication_prefs.preferred_channel;
    const recipient =
      channel === "email"
        ? boater.primary_contact.email ?? ""
        : boater.primary_contact.phone ?? "";
    const subject = `We miss you, ${boater.first_name} — come back to the club?`;
    const body =
      `Hi ${boater.first_name},\n\n` +
      `It's been a minute since you were on the water with us. ` +
      `If you'd like to come back to the Rental Club, we'll waive the join fee — just say the word.\n\n` +
      `Reply to this message or stop by the marina and we'll take care of the rest.\n\n` +
      `Hope to see you soon,\n${profile.short_name}`;

    const comm: Communication = {
      id: `cm_club_reactivation_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      boater_id: boater.id,
      type: channel,
      direction: "outbound",
      sender_label: profile.outbound_email_from_name,
      sender_is_system: false,
      recipient,
      subject,
      body_preview: body.slice(0, 80),
      full_body: body,
      sent_at: new Date().toISOString(),
      status: "delivered",
    };
    state = { ...state, communications: [comm, ...state.communications] };
    state = {
      ...state,
      clubSubscriptions: state.clubSubscriptions.map((s) =>
        s.id === sub.id
          ? { ...s, reactivation_sent_at: new Date().toISOString() }
          : s
      ),
    };
    sentTo.push(boater.id);
  }

  if (sentTo.length > 0) notify();
  return { sentTo, skipped };
}

/*
 * Capacity check for a given date. Returns:
 *   { fleetSize, booked, available }
 * where booked = bookings on that date with non-cancelled status.
 * Used by the member portal to surface "fully booked" / "limited
 * availability" before a request is submitted.
 */
export function getClubCapacityForDate(date: string): {
  fleetSize: number;
  booked: number;
  available: number;
} {
  // Only club-eligible boats count toward club-day capacity. Walk-up
  // rental boats (available_for_club=false / unset) are excluded so
  // members never see a "fully booked" message that's actually being
  // caused by hourly rentals — the two pools are operationally
  // independent. Also scope to the active tenant so a Lakeside-only
  // capacity check never picks up Marina Stee boats.
  const fallbackTenant = state.tenants[0]?.id;
  const fleetSize = state.rentalBoats.filter(
    (b) =>
      b.available_for_club === true &&
      b.status !== "maintenance" &&
      b.status !== "off_season" &&
      (b.tenant_id ?? fallbackTenant) === state.currentTenantId
  ).length;
  const booked = state.clubBookings.filter(
    (b) =>
      b.date === date &&
      b.status !== "cancelled" &&
      b.status !== "no_show"
  ).length;
  return {
    fleetSize,
    booked,
    available: Math.max(0, fleetSize - booked),
  };
}

/*
 * Soft-cancel a membership. The subscription record stays in place
 * (status='cancelled') so accounting still sees the join + monthly
 * billing history. Future bookings are cancelled (members can't take
 * out a boat without an active sub) but past completed/checked-in
 * bookings stay intact for audit.
 *
 * Pro-rate refund: when the member cancels mid-month, the unused
 * portion of the current billing period is refunded against the most
 * recent monthly invoice. The refund is computed as:
 *     unusedDays / daysInBillingPeriod × monthly_fee
 * where unusedDays = max(0, next_billing_date - today). Days-already-
 * booked are NOT clawed back — the member used part of the month, so
 * they pay for the portion they used. Posts a refund ledger entry
 * tagged to "Rental Club Revenue" so reports see the giveback
 * cleanly. Skips refund if next_billing_date is missing or already
 * passed.
 *
 * This is the canonical lifecycle operation — staff should reach for
 * this in 99% of cases. deleteClubSubscription() is admin-only.
 *
 * Returns { ok, refundAmount, refundId } so the UI can surface
 * "$X.XX refunded" in a confirmation toast.
 */
export function cancelClubSubscription(id: string): {
  ok: boolean;
  refundAmount: number;
  refundId?: string;
} {
  const sub = state.clubSubscriptions.find((s) => s.id === id);
  if (!sub) return { ok: false, refundAmount: 0 };

  // Compute the pro-rate refund. Only applies when:
  //   - status is currently active (cancelled/paused subs already
  //     stopped accruing, past_due owes money instead of being owed)
  //   - next_billing_date is in the future
  //   - we can find the most recent invoice to credit
  const today = new Date().toISOString().slice(0, 10);
  let refundAmount = 0;
  let refundId: string | undefined;

  if (sub.status === "active" && sub.next_billing_date && sub.next_billing_date > today) {
    // Find the most recent invoice for this member's club fee.
    const lastInvoice = state.ledger
      .filter(
        (l) =>
          l.boater_id === sub.boater_id &&
          l.type === "invoice" &&
          l.gl_account === "Rental Club Revenue"
      )
      .sort((a, b) => b.date.localeCompare(a.date))[0];

    if (lastInvoice) {
      // Period length = next_billing_date - last invoice date.
      const periodStart = new Date(lastInvoice.date);
      const periodEnd = new Date(sub.next_billing_date);
      const totalMs = periodEnd.getTime() - periodStart.getTime();
      const unusedMs = periodEnd.getTime() - new Date(today).getTime();
      if (totalMs > 0 && unusedMs > 0) {
        const ratio = Math.min(1, unusedMs / totalMs);
        const subPlan = effectivePlanFor(sub);
        const subMonthlyFee = subPlan?.monthly_fee ?? 0;
        refundAmount = +(subMonthlyFee * ratio).toFixed(2);
        if (refundAmount > 0) {
          refundId = nextLedgerId();
          const refund: LedgerEntry = {
            id: refundId,
            boater_id: sub.boater_id,
            type: "refund",
            number: nextInvoiceNumber(),
            date: today,
            amount: -refundAmount,           // negative per refund convention
            open_balance: 0,
            method: "card",
            status: "paid",
            linked_club_subscription_id: sub.id,
            applied_payment_id: lastInvoice.id,
            refund_reason: "club_cancellation",
            refund_notes: `Pro-rated refund — ${Math.round(ratio * 100)}% of monthly fee unused.`,
            gl_account: "Rental Club Revenue",
            qb_sync_status: "pending",
            line_items: [
              {
                description: `Rental Club — unused portion of ${lastInvoice.date} period`,
                amount: -refundAmount,
              },
            ],
          };
          state = { ...state, ledger: [refund, ...state.ledger] };
        }
      }
    }
  }

  state = {
    ...state,
    clubSubscriptions: state.clubSubscriptions.map((s) =>
      s.id === id ? { ...s, status: "cancelled" as const } : s
    ),
    // Cancel only forward-looking bookings; preserve history.
    clubBookings: state.clubBookings.map((b) =>
      b.subscription_id === id &&
      (b.status === "requested" || b.status === "confirmed")
        ? { ...b, status: "cancelled" as const }
        : b
    ),
  };
  notify();
  return { ok: true, refundAmount, refundId };
}

/*
 * Confirm a pending club booking — flips status to 'confirmed' AND
 * dispatches an outbound comm to the member so they know the day's
 * locked in. Uses sub.booking_channel ?? boater.preferred_channel.
 *
 * Returns the booking id (or undefined if not found / not pending).
 */
export function confirmClubBooking(bookingId: string): string | undefined {
  const booking = state.clubBookings.find((b) => b.id === bookingId);
  if (!booking || booking.status !== "requested") return undefined;
  const sub = state.clubSubscriptions.find((s) => s.id === booking.subscription_id);
  const boater = state.boaters.find((b) => b.id === booking.boater_id);
  if (!sub || !boater) return undefined;

  state = {
    ...state,
    clubBookings: state.clubBookings.map((x) =>
      x.id === bookingId ? { ...x, status: "confirmed" as const } : x
    ),
  };

  dispatchClubBookingComm(boater, sub, booking, "confirmed");
  notify();
  return bookingId;
}

/*
 * Internal helper — dispatches an outbound comm for a club booking
 * event. Routes via sub.booking_channel (member's club-specific
 * channel preference) with fallback to their primary preferred_channel.
 * The recipient field uses email when channel=email, otherwise phone.
 */
function dispatchClubBookingComm(
  boater: Boater,
  sub: ClubSubscription,
  booking: ClubBooking,
  event: "confirmed" | "checked_in"
): void {
  const profile = profileForBoater(boater.id);
  const channel: CommunicationChannel =
    sub.booking_channel ?? boater.communication_prefs.preferred_channel;
  const recipient =
    channel === "email"
      ? boater.primary_contact.email ?? ""
      : boater.primary_contact.phone ?? "";
  const friendlyDate = new Date(booking.date).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const subject =
    event === "confirmed"
      ? `Club day confirmed — ${friendlyDate}`
      : `Welcome aboard — your club day is checked in`;
  const body =
    event === "confirmed"
      ? `Hi ${boater.first_name},\n\nYour Rental Club day on ${friendlyDate} is confirmed. ` +
        `Come by the dock when you're ready — we'll have a boat assigned and ready.\n\n` +
        `If you can't make it, you can cancel from your portal up until the day of.\n\n` +
        `See you on the water,\n${profile.short_name}`
      : `Hi ${boater.first_name},\n\nYou're checked in for your club day. Have a great time on the water!\n\n` +
        `When you return, the dockhand will handle the wrap-up — no paperwork.\n\n${profile.short_name}`;

  const comm: Communication = {
    id: `cm_club_book_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    boater_id: boater.id,
    type: channel,
    direction: "outbound",
    sender_label: profile.outbound_email_from_name,
    sender_is_system: true,
    recipient,
    subject,
    body_preview: body.slice(0, 80),
    full_body: body,
    sent_at: new Date().toISOString(),
    status: "delivered",
    // Point the comm at the booking so the inbox modal "Open …" can
    // deep-link to the day. The booking type is the cleanest target
    // here — a sibling rental_boat entity only exists post-check-in.
    related_entity: { type: "club_booking", id: booking.id },
  };
  state = { ...state, communications: [comm, ...state.communications] };
}

/*
 * Identify members at risk of churning based on recent sentiment.
 * Rule: 2+ consecutive 'sad' ratings on the member's most-recent rated
 * bookings. Excludes already-cancelled subscriptions.
 *
 * Returns an array of { subscription, boater, sadStreak, lastSadDate }
 * sorted by streak length descending so the operator triages worst-first.
 */
export function getClubChurnRisks(): {
  subscription: ClubSubscription;
  boater: Boater;
  sadStreak: number;
  lastSadDate: string;
}[] {
  const out: {
    subscription: ClubSubscription;
    boater: Boater;
    sadStreak: number;
    lastSadDate: string;
  }[] = [];

  for (const sub of state.clubSubscriptions) {
    if (sub.status === "cancelled") continue;
    const memberBookings = state.clubBookings
      .filter((b) => b.boater_id === sub.boater_id && b.sentiment != null)
      .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first

    let streak = 0;
    let lastSadDate = "";
    for (const b of memberBookings) {
      if (b.sentiment === "sad") {
        streak += 1;
        if (!lastSadDate) lastSadDate = b.date;
      } else {
        break; // streak broken
      }
    }

    if (streak >= 2) {
      const boater = state.boaters.find((b) => b.id === sub.boater_id);
      if (!boater) continue;
      out.push({ subscription: sub, boater, sadStreak: streak, lastSadDate });
    }
  }

  return out.sort((a, b) => b.sadStreak - a.sadStreak);
}

/*
 * Set a member's one-tap sentiment on a completed booking. Returns
 * the booking id on success, undefined if the booking can't be found
 * or isn't in a state where rating makes sense. Idempotent — re-rating
 * just overwrites.
 */
export function setClubBookingSentiment(
  bookingId: string,
  sentiment: import("./types").ClubBookingSentiment
): string | undefined {
  const booking = state.clubBookings.find((b) => b.id === bookingId);
  if (!booking) return undefined;
  // Only allow rating once the day has happened. Open requests + future
  // confirmed bookings stay un-ratable.
  if (booking.status !== "completed" && booking.status !== "checked_in") {
    return undefined;
  }
  state = {
    ...state,
    clubBookings: state.clubBookings.map((b) =>
      b.id === bookingId
        ? {
            ...b,
            sentiment,
            sentiment_at: new Date().toISOString(),
          }
        : b
    ),
  };
  notify();
  return bookingId;
}

export function upsertClubBooking(b: ClubBooking) {
  const exists = state.clubBookings.some((x) => x.id === b.id);
  state = {
    ...state,
    clubBookings: exists
      ? state.clubBookings.map((x) => (x.id === b.id ? b : x))
      : [b, ...state.clubBookings],
  };
  notify();
}

export function deleteClubBooking(id: string) {
  state = {
    ...state,
    clubBookings: state.clubBookings.filter((b) => b.id !== id),
  };
  notify();
}

/*
 * Post the current month's club subscription fee to every active
 * member as a single batch. Returns the list of invoice IDs created so
 * the caller can surface "posted N invoices for $X" in the UI.
 *
 * Skips members whose subscription is cancelled. Past-due members are
 * still billed (they'll just stay past-due until they catch up).
 *
 * Auto-charges the default card when one is on file; otherwise the
 * invoice posts as open and shows up in A/R.
 *
 * Bumps each billed subscription's `next_billing_date` to one month
 * out so the operator can run this monthly without double-billing.
 */
export function runClubMonthlyBilling(
  asOfDate?: string
): { invoiceIds: string[]; totalPosted: number; chargedCount: number } {
  const today = asOfDate ?? new Date().toISOString().slice(0, 10);
  const invoiceIds: string[] = [];
  let totalPosted = 0;
  let chargedCount = 0;

  // Paused subs sit out — no billing, no comm. They resume on
  // resumeClubSubscription() or auto-resume when resume_on date passes
  // (the auto-resume check happens elsewhere; this fn just skips them).
  // Cancelled subs naturally skip (filter excludes).
  const subscriptions = state.clubSubscriptions.filter(
    (s) => s.status === "active" || s.status === "past_due"
  );

  for (const sub of subscriptions) {
    const boater = state.boaters.find((b) => b.id === sub.boater_id);
    if (!boater) continue;

    // Resolve current plan from the catalog so this run picks up any
    // operator price changes; fall back to the snapshot when the plan
    // row was deleted out from under the sub.
    const subPlan = effectivePlanFor(sub);
    if (!subPlan) continue;
    const subMonthlyFee = subPlan.monthly_fee;
    const subPlanLabel = subPlan.plan_name ?? "Membership";

    // Apply retention credit if present — % off this month's fee.
    // One-shot: consumed on use so it doesn't keep stacking.
    const creditPct = sub.retention_credit_pct ?? 0;
    const creditAmount = +(subMonthlyFee * (creditPct / 100)).toFixed(2);
    const chargedAmount = +(subMonthlyFee - creditAmount).toFixed(2);

    const lineItems: { description: string; amount: number }[] = [
      {
        description: `Rental Club — ${subPlanLabel} plan (monthly)`,
        amount: subMonthlyFee,
      },
    ];
    if (creditAmount > 0) {
      lineItems.push({
        description: `Retention credit (${creditPct}% off)`,
        amount: -creditAmount,
      });
    }

    // Single-line invoice for the monthly fee. No extra fees rolled in
    // (club membership is a flat subscription, unlike slip billing).
    // Collect the booking ids this invoice's allotment covers so the
    // ledger drawer can link back to the days that were charged for.
    const monthPrefix = today.slice(0, 7);
    const coveredBookingIds = state.clubBookings
      .filter(
        (b) =>
          b.subscription_id === sub.id &&
          b.date.startsWith(monthPrefix) &&
          b.status !== "cancelled" &&
          b.status !== "no_show"
      )
      .map((b) => b.id);

    const invoiceId = nextLedgerId();
    const invoice: LedgerEntry = {
      id: invoiceId,
      boater_id: boater.id,
      type: "invoice",
      number: nextInvoiceNumber(),
      date: today,
      amount: chargedAmount,
      open_balance: chargedAmount,
      method: "ach",
      status: "open",
      gl_account: "Rental Club Revenue",
      qb_sync_status: "pending",
      line_items: lineItems,
      linked_club_subscription_id: sub.id,
      linked_club_booking_ids: coveredBookingIds.length > 0 ? coveredBookingIds : undefined,
    };
    state = { ...state, ledger: [invoice, ...state.ledger] };
    invoiceIds.push(invoiceId);
    totalPosted += chargedAmount;

    // Auto-charge against the default card if present. Mirrors the
    // pattern in postBillingRunInvoice — payment posts immediately,
    // invoice marks paid + zero balance.
    const defaultCard = state.cardsByBoaterId[boater.id]?.find(
      (c) => c.is_default
    );
    if (defaultCard) {
      const paymentId = nextLedgerId();
      const payment: LedgerEntry = {
        id: paymentId,
        boater_id: boater.id,
        type: "payment",
        number: nextInvoiceNumber(),
        date: today,
        amount: chargedAmount,
        open_balance: 0,
        method: "card",
        // Same processor_ref convention used by postBillingRunInvoice +
        // applyPaymentToInvoices so QB sync can reconcile.
        processor_ref: `auto_club_${defaultCard.id.slice(-6)}`,
        status: "paid",
        applied_to_invoice_ids: [invoiceId],
        gl_account: "Cash / Credit Card",
        qb_sync_status: "pending",
      };
      state = {
        ...state,
        ledger: [payment, ...state.ledger].map((l) =>
          l.id === invoiceId
            ? { ...l, status: "paid", open_balance: 0, method: "card" }
            : l
        ),
      };
      chargedCount += 1;
    }

    // Dispatch a billing receipt — honors the member's billing_channel
    // override when set, falls back to their primary preferred_channel.
    // Mirrors postBillingRunInvoice's comm pattern so the inbox treats
    // it consistently. Sender + sign-off come from the boater's own
    // marina profile so multi-tenant comms stay branded correctly.
    const profile = profileForBoater(boater.id);
    const channel =
      sub.billing_channel ?? boater.communication_prefs.preferred_channel;
    const recipient =
      channel === "email"
        ? boater.primary_contact.email ?? ""
        : boater.primary_contact.phone ?? "";
    const subject = defaultCard
      ? `Rental Club ${subPlanLabel} — auto-charged ${formatMoneyInline(chargedAmount)}`
      : `Rental Club ${subPlanLabel} — invoice ready ${formatMoneyInline(chargedAmount)}`;
    const creditLine =
      creditAmount > 0
        ? `  ${creditPct}% retention credit       -${formatMoneyInline(creditAmount)}\n`
        : "";
    const body = defaultCard
      ? `Hi ${boater.first_name},\n\n` +
        `Your Rental Club ${subPlanLabel} membership for this month ` +
        `has been auto-charged to the card on file (****${defaultCard.last4}).\n\n` +
        `  Monthly fee                  ${formatMoneyInline(subMonthlyFee)}\n` +
        creditLine +
        `  Charged                      ${formatMoneyInline(chargedAmount)}\n\n` +
        `Enjoy your days on the water.\n\n${profile.short_name}`
      : `Hi ${boater.first_name},\n\n` +
        `Your Rental Club ${subPlanLabel} membership invoice is ready. ` +
        `Pay through your portal or update your card on file for auto-pay.\n\n${profile.short_name}`;
    const comm: Communication = {
      id: `cm_club_billing_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      boater_id: boater.id,
      type: channel,
      direction: "outbound",
      sender_label: profile.outbound_email_from_name,
      sender_is_system: true,
      recipient,
      subject,
      body_preview: body.slice(0, 80),
      full_body: body,
      sent_at: new Date().toISOString(),
      status: "delivered",
      related_entity: { type: "invoice", id: invoiceId },
    };
    state = { ...state, communications: [comm, ...state.communications] };

    // Advance next_billing_date by 1 month and clear past_due if it
    // got auto-charged successfully. Also clear retention_credit_pct
    // since it's one-shot.
    const nextDate = (() => {
      const d = new Date(today);
      d.setMonth(d.getMonth() + 1);
      return d.toISOString().slice(0, 10);
    })();
    state = {
      ...state,
      clubSubscriptions: state.clubSubscriptions.map((s) =>
        s.id === sub.id
          ? {
              ...s,
              next_billing_date: nextDate,
              status: defaultCard && sub.status === "past_due" ? "active" : s.status,
              retention_credit_pct: undefined,
            }
          : s
      ),
    };
  }

  notify();
  return { invoiceIds, totalPosted, chargedCount };
}

function titleCase(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/*
 * Check a club member into their booked day. Atomic operation:
 *   1. Spins up a BoatRental linked back to the booking
 *      (source='club', club_booking_id=booking.id) — staff can drive
 *      the same /dock pickup flow from there.
 *   2. Flips the booking to status='checked_in'.
 *
 * Pricing notes:
 *   - base_amount = 0 and deposit_hold = 0 because the day is already
 *     paid for by the member's subscription. Closeout logic must
 *     short-circuit invoice generation when source === 'club'.
 *   - rate_kind = 'full_day' since the club allotment is per-day.
 *
 * Returns the new BoatRental.id, or undefined if the booking wasn't
 * found / can't be checked in (e.g. already checked_in / cancelled).
 */
export function checkInClubBooking(
  bookingId: string,
  rentalBoatId: string
): string | undefined {
  const booking = state.clubBookings.find((b) => b.id === bookingId);
  if (!booking) return undefined;
  if (booking.status !== "confirmed" && booking.status !== "requested") {
    return undefined;
  }

  const id = nextBoatRentalId();
  const number = nextBoatRentalNumber();
  const now = new Date().toISOString();
  // Full-day window — 8 AM → 6 PM in the marina's local TZ. We use ISO
  // strings without TZ offset since the prototype isn't TZ-aware.
  const startAt = `${booking.date}T08:00:00`;
  const endAt = `${booking.date}T18:00:00`;
  const rental: BoatRental = {
    id,
    number,
    boat_id: rentalBoatId,
    boater_id: booking.boater_id,
    start_at: startAt,
    end_at: endAt,
    rate_kind: "full_day",
    base_amount: 0,
    deposit_hold: 0,
    status: "checked_out",
    checkin: {
      checked_out_at: now,
      agreement_signed_at: now, // club members sign the master agreement at signup
    },
    source: "club",
    club_booking_id: booking.id,
    notes: `Rental Club day — paid via subscription ${booking.subscription_id}.`,
    created_at: now,
    updated_at: now,
  };
  state = {
    ...state,
    boatRentals: [rental, ...state.boatRentals],
    clubBookings: state.clubBookings.map((b) =>
      b.id === bookingId ? { ...b, status: "checked_in", rental_boat_id: rentalBoatId } : b
    ),
  };

  // Dispatch "welcome aboard" comm using the member's club booking
  // channel preference (falls back to their primary channel).
  const sub = state.clubSubscriptions.find((s) => s.id === booking.subscription_id);
  const boater = state.boaters.find((b) => b.id === booking.boater_id);
  if (sub && boater) {
    dispatchClubBookingComm(
      boater,
      sub,
      { ...booking, status: "checked_in", rental_boat_id: rentalBoatId },
      "checked_in"
    );
  }

  notify();
  return id;
}

// ═════════════════════════════════════════════════════════════════════
// BACK OFFICE — Staffing / Vendor + AP / Inventory / Assets + PM
// ═════════════════════════════════════════════════════════════════════
//
// Hooks below are all tenant-scoped. Mutators stamp tenant_id from
// state.currentTenantId at write time so the caller doesn't need to
// know which marina is active. All financial side-effects (payroll
// runs, bill payments) post LedgerEntry rows that flow through the
// existing QB sync pipeline.

// ── Shifts ────────────────────────────────────────────────────────

export function useShifts(): Shift[] {
  const s = useStore();
  return s.shifts.filter((sh) => sh.tenant_id === s.currentTenantId);
}

export function useShiftsForStaff(staffId: string): Shift[] {
  const s = useStore();
  return s.shifts.filter(
    (sh) => sh.staff_id === staffId && sh.tenant_id === s.currentTenantId
  );
}

export function upsertShift(sh: Shift) {
  const exists = state.shifts.some((x) => x.id === sh.id);
  const stamped: Shift = exists
    ? sh
    : { ...sh, tenant_id: sh.tenant_id || state.currentTenantId };
  state = {
    ...state,
    shifts: exists
      ? state.shifts.map((x) => (x.id === stamped.id ? stamped : x))
      : [stamped, ...state.shifts],
  };
  notify();
}

export function deleteShift(id: string) {
  state = { ...state, shifts: state.shifts.filter((s) => s.id !== id) };
  notify();
}

export function nextShiftId() {
  return `shift_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Time entries + mobile clock-in/out ────────────────────────────

export function useTimeEntries(): TimeEntry[] {
  const s = useStore();
  return s.timeEntries.filter((t) => t.tenant_id === s.currentTenantId);
}

export function useTimeEntriesForStaff(staffId: string): TimeEntry[] {
  const s = useStore();
  return s.timeEntries.filter(
    (t) => t.staff_id === staffId && t.tenant_id === s.currentTenantId
  );
}

/**
 * Active (open) time entry for the given staff member, if any. The
 * mobile clock-in UI uses this to flip between "Clock in" and
 * "Clock out" + show elapsed time.
 */
export function useActiveTimeEntryForStaff(staffId: string): TimeEntry | undefined {
  const s = useStore();
  return s.timeEntries.find(
    (t) =>
      t.staff_id === staffId &&
      t.tenant_id === s.currentTenantId &&
      !t.clock_out_at
  );
}

export function nextTimeEntryId() {
  return `te_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Clock-in handler. Looks up the staff member by mobile PIN. Returns
 * null on bad PIN, or the freshly-created TimeEntry id on success.
 * Used by the /dock Clock tab — PIN-based so a shared tablet works.
 */
export function clockInByPin(pin: string, source: "mobile" | "web" = "mobile"): {
  ok: boolean;
  reason?: "bad_pin" | "already_clocked_in";
  staff?: StaffMember;
  timeEntryId?: string;
} {
  if (!pin || pin.length < 4) return { ok: false, reason: "bad_pin" };
  const staff = state.staff.find(
    (s) =>
      s.tenant_id === state.currentTenantId &&
      s.mobile_clock_pin === pin &&
      s.status === "active"
  );
  if (!staff) return { ok: false, reason: "bad_pin" };
  // Already on the clock?
  const open = state.timeEntries.find(
    (t) => t.staff_id === staff.id && !t.clock_out_at
  );
  if (open) return { ok: false, reason: "already_clocked_in", staff };
  const now = new Date().toISOString();
  // Attach to the open payroll period (if any) — Payroll sub-tab's
  // running totals roll up by period_id, so seeding it on the way in
  // saves a backfill on the way out.
  const openPeriod = state.payrollPeriods.find(
    (p) => p.tenant_id === state.currentTenantId && p.status === "open"
  );
  const entry: TimeEntry = {
    id: nextTimeEntryId(),
    tenant_id: state.currentTenantId,
    staff_id: staff.id,
    clock_in_at: now,
    break_minutes: 0,
    source,
    status: "in_progress",
    position: staff.default_position,
    payroll_period_id: openPeriod?.id,
    created_at: now,
  };
  state = { ...state, timeEntries: [entry, ...state.timeEntries] };
  notify();
  logAuditLocal({
    actor_label: staff.name,
    action_type: "time_entry.clock_in",
    target_entity: "time_entry",
    target_id: entry.id,
    payload_delta: JSON.stringify({
      staff_id: staff.id,
      source,
      payroll_period_id: openPeriod?.id,
    }),
  });
  return { ok: true, staff, timeEntryId: entry.id };
}

/**
 * Clock-out handler. Computes calculated_hours from clock_in_at →
 * now, minus break_minutes. Same PIN-based lookup as clock-in.
 */
export function clockOutByPin(pin: string): {
  ok: boolean;
  reason?: "bad_pin" | "not_clocked_in";
  staff?: StaffMember;
  hours?: number;
} {
  if (!pin || pin.length < 4) return { ok: false, reason: "bad_pin" };
  const staff = state.staff.find(
    (s) =>
      s.tenant_id === state.currentTenantId &&
      s.mobile_clock_pin === pin &&
      s.status === "active"
  );
  if (!staff) return { ok: false, reason: "bad_pin" };
  const open = state.timeEntries.find(
    (t) => t.staff_id === staff.id && !t.clock_out_at
  );
  if (!open) return { ok: false, reason: "not_clocked_in", staff };
  const now = new Date();
  const inMs = new Date(open.clock_in_at).getTime();
  // Subtract any still-active pause window in addition to the
  // accumulated pause_seconds_total. Defensive — clock-out from a
  // paused state shouldn't credit the pause window as worked time.
  const activePauseSec = open.paused_at
    ? Math.max(0, Math.floor((now.getTime() - new Date(open.paused_at).getTime()) / 1000))
    : 0;
  const pauseHours = ((open.pause_seconds_total ?? 0) + activePauseSec) / 3600;
  const elapsedHours = (now.getTime() - inMs) / 3_600_000;
  const breakHours = (open.break_minutes ?? 0) / 60;
  const hours = +(elapsedHours - breakHours - pauseHours).toFixed(2);
  const updated: TimeEntry = {
    ...open,
    clock_out_at: now.toISOString(),
    calculated_hours: Math.max(0, hours),
    paused_at: undefined,
    pause_seconds_total: (open.pause_seconds_total ?? 0) + activePauseSec,
    status: "completed",
  };
  state = {
    ...state,
    timeEntries: state.timeEntries.map((t) => (t.id === open.id ? updated : t)),
  };
  notify();
  logAuditLocal({
    actor_label: staff.name,
    action_type: "time_entry.clock_out",
    target_entity: "time_entry",
    target_id: open.id,
    payload_delta: JSON.stringify({
      staff_id: staff.id,
      calculated_hours: updated.calculated_hours,
    }),
  });
  return { ok: true, staff, hours: updated.calculated_hours };
}

export function approveTimeEntry(id: string, approverStaffId: string) {
  const now = new Date().toISOString();
  state = {
    ...state,
    timeEntries: state.timeEntries.map((t) =>
      t.id === id ? { ...t, approved_at: now, approved_by: approverStaffId } : t
    ),
  };
  notify();
}

/**
 * Manual edit on a time entry — operator correcting a missed punch,
 * fixing miscounted hours, etc. Recalculates calculated_hours when
 * clock_in/out change. Locked once the entry has been picked up by
 * a payroll run.
 */
export function updateTimeEntry(id: string, patch: Partial<TimeEntry>) {
  state = {
    ...state,
    timeEntries: state.timeEntries.map((t) => {
      if (t.id !== id) return t;
      if (t.payroll_run_id) return t; // locked once payroll runs
      const merged = { ...t, ...patch };
      // Recompute hours if either edge changed.
      if (patch.clock_in_at || patch.clock_out_at) {
        const start = new Date(merged.clock_in_at).getTime();
        const end = merged.clock_out_at
          ? new Date(merged.clock_out_at).getTime()
          : null;
        if (end && end > start) {
          merged.calculated_hours = +((end - start) / 3_600_000).toFixed(2);
        }
      }
      return merged;
    }),
  };
  notify();
}

export function deleteTimeEntry(id: string) {
  state = {
    ...state,
    timeEntries: state.timeEntries.filter((t) => t.id !== id),
  };
  notify();
}

// ── Time clock v2 — explicit status + lunch-pause + audit-adjust ──

/**
 * Derive a `TimeEntryStatus` for a row that doesn't carry one yet
 * (legacy seeds). Used by the Time Clock + Payroll views so the
 * shape on screen is consistent across pre-v2 and v2 entries.
 */
export function deriveTimeEntryStatus(t: TimeEntry): TimeEntryStatus {
  if (t.status) return t.status;
  if (t.paused_at) return "paused";
  if (t.clock_out_at) return "completed";
  return "in_progress";
}

/**
 * Pause a clocked-in time entry (lunch break, walk-off, etc.).
 * Stamps `paused_at`, flips status to "paused". No-op if already paused.
 */
export function pauseTimeEntry(id: string): {
  ok: boolean;
  reason?: "not_found" | "not_in_progress";
} {
  const t = state.timeEntries.find((x) => x.id === id);
  if (!t) return { ok: false, reason: "not_found" };
  if (t.clock_out_at) return { ok: false, reason: "not_in_progress" };
  if (t.paused_at) return { ok: true };
  const now = new Date().toISOString();
  state = {
    ...state,
    timeEntries: state.timeEntries.map((x) =>
      x.id === id ? { ...x, paused_at: now, status: "paused" } : x
    ),
  };
  notify();
  logAuditLocal({
    actor_label: "Marina Stee Operator",
    action_type: "time_entry.pause",
    target_entity: "time_entry",
    target_id: id,
    payload_delta: JSON.stringify({ paused_at: now }),
  });
  return { ok: true };
}

/**
 * Resume a paused entry. Rolls the elapsed pause time into
 * `pause_seconds_total` so calculated_hours subtracts it at clock-out.
 */
export function resumeTimeEntry(id: string): {
  ok: boolean;
  reason?: "not_found" | "not_paused";
} {
  const t = state.timeEntries.find((x) => x.id === id);
  if (!t) return { ok: false, reason: "not_found" };
  if (!t.paused_at) return { ok: false, reason: "not_paused" };
  const pausedAt = new Date(t.paused_at).getTime();
  const elapsedSec = Math.max(0, Math.floor((Date.now() - pausedAt) / 1000));
  const total = (t.pause_seconds_total ?? 0) + elapsedSec;
  state = {
    ...state,
    timeEntries: state.timeEntries.map((x) =>
      x.id === id
        ? {
            ...x,
            paused_at: undefined,
            pause_seconds_total: total,
            status: "in_progress",
          }
        : x
    ),
  };
  notify();
  logAuditLocal({
    actor_label: "Marina Stee Operator",
    action_type: "time_entry.resume",
    target_entity: "time_entry",
    target_id: id,
    payload_delta: JSON.stringify({ pause_seconds_total: total }),
  });
  return { ok: true };
}

/**
 * Audit-tracked adjust — operator overrides clock_in / clock_out / break.
 * Stamps `adjusted_by` + `adjusted_at`, flips status to "adjusted",
 * recomputes `calculated_hours`. Locked once a payroll period / run
 * has picked the entry up.
 */
export function adjustTimeEntry(
  id: string,
  patch: {
    clock_in_at?: string;
    clock_out_at?: string;
    break_minutes?: number;
    notes?: string;
    position?: string;
  },
  adjusterStaffId: string
): { ok: boolean; reason?: "not_found" | "locked" } {
  const t = state.timeEntries.find((x) => x.id === id);
  if (!t) return { ok: false, reason: "not_found" };
  if (t.payroll_run_id) return { ok: false, reason: "locked" };
  const before = {
    clock_in_at: t.clock_in_at,
    clock_out_at: t.clock_out_at,
    break_minutes: t.break_minutes,
    calculated_hours: t.calculated_hours,
  };
  const merged: TimeEntry = { ...t, ...patch };
  const start = new Date(merged.clock_in_at).getTime();
  const end = merged.clock_out_at ? new Date(merged.clock_out_at).getTime() : null;
  if (end && end > start) {
    const breakHrs = (merged.break_minutes ?? 0) / 60;
    merged.calculated_hours = +Math.max(0, (end - start) / 3_600_000 - breakHrs).toFixed(2);
  }
  merged.adjusted_by = adjusterStaffId;
  merged.adjusted_at = new Date().toISOString();
  merged.status = "adjusted";
  state = {
    ...state,
    timeEntries: state.timeEntries.map((x) => (x.id === id ? merged : x)),
  };
  notify();
  logAuditLocal({
    actor_label: "Marina Stee Operator",
    action_type: "time_entry.adjust",
    target_entity: "time_entry",
    target_id: id,
    payload_delta: JSON.stringify({
      before,
      after: {
        clock_in_at: merged.clock_in_at,
        clock_out_at: merged.clock_out_at,
        break_minutes: merged.break_minutes,
        calculated_hours: merged.calculated_hours,
      },
      adjusted_by: adjusterStaffId,
    }),
  });
  return { ok: true };
}

// ── Payroll periods (open → closed → paid) ─────────────────────

export function usePayrollPeriods(): PayrollPeriod[] {
  const s = useStore();
  return s.payrollPeriods
    .filter((p) => p.tenant_id === s.currentTenantId)
    .slice()
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
}

/**
 * Current open period for the tenant. If no period is open, returns
 * undefined — callers (Payroll sub-tab) prompt the operator to open
 * a new one. v1 doesn't auto-open; an explicit close emits the run
 * and leaves the next window unbooked until the operator opens it.
 */
export function useCurrentPayrollPeriod(): PayrollPeriod | undefined {
  const s = useStore();
  return s.payrollPeriods.find(
    (p) => p.tenant_id === s.currentTenantId && p.status === "open"
  );
}

export function nextPayrollPeriodId(): string {
  return `pp_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Build a paystub preview for every staff member with logged hours in
 * the period. OT calc is per-week federal default: hours > 40 in a
 * single ISO week get 1.5x. Salaried staff get a flat per-period
 * slice (biweekly = annual / 26).
 *
 * Returns an array of `PaystubPreview` rows + the aggregate totals.
 * Surfaces in the Close Period modal as the per-staff breakdown.
 */
export function computePaystubPreview(periodId: string): {
  rows: PaystubPreview[];
  totalHours: number;
  totalGross: number;
} {
  const period = state.payrollPeriods.find((p) => p.id === periodId);
  if (!period) return { rows: [], totalHours: 0, totalGross: 0 };
  const tenantStaff = state.staff.filter(
    (s) => s.tenant_id === period.tenant_id && s.status === "active"
  );
  const rows: PaystubPreview[] = [];
  let totalHours = 0;
  let totalGross = 0;
  for (const staff of tenantStaff) {
    // Salaried — flat biweekly slice. No OT for salary.
    if (staff.salary_annual && staff.salary_annual > 0) {
      const gross = +(staff.salary_annual / 26).toFixed(2);
      rows.push({
        staff_member_id: staff.id,
        period_id: period.id,
        regular_hours: 0,
        overtime_hours: 0,
        regular_pay: gross,
        overtime_pay: 0,
        gross,
      });
      totalGross += gross;
      continue;
    }
    if (!staff.hourly_rate || staff.hourly_rate <= 0) continue;
    // Pull every completed time entry within the window.
    const staffEntries = state.timeEntries.filter((t) => {
      if (t.staff_id !== staff.id) return false;
      if (t.tenant_id !== period.tenant_id) return false;
      if (!t.clock_out_at) return false;
      const d = t.clock_out_at.slice(0, 10);
      return d >= period.start_date && d <= period.end_date;
    });
    if (staffEntries.length === 0) continue;
    // Bucket hours per ISO week so OT is computed per-week, not per-period.
    const hoursByWeek = new Map<string, number>();
    for (const t of staffEntries) {
      const wk = isoWeekKey(t.clock_out_at!);
      hoursByWeek.set(wk, (hoursByWeek.get(wk) ?? 0) + (t.calculated_hours ?? 0));
    }
    let regular = 0;
    let overtime = 0;
    for (const hours of hoursByWeek.values()) {
      regular += Math.min(40, hours);
      overtime += Math.max(0, hours - 40);
    }
    const otRate = (staff.ot_multiplier ?? 1.5) * staff.hourly_rate;
    const regularPay = +(regular * staff.hourly_rate).toFixed(2);
    const overtimePay = +(overtime * otRate).toFixed(2);
    const gross = +(regularPay + overtimePay).toFixed(2);
    rows.push({
      staff_member_id: staff.id,
      period_id: period.id,
      regular_hours: +regular.toFixed(2),
      overtime_hours: +overtime.toFixed(2),
      regular_pay: regularPay,
      overtime_pay: overtimePay,
      gross,
    });
    totalHours += regular + overtime;
    totalGross += gross;
  }
  return {
    rows,
    totalHours: +totalHours.toFixed(2),
    totalGross: +totalGross.toFixed(2),
  };
}

/**
 * ISO week key (YYYY-Www) for an ISO datetime string. Used by the
 * per-week OT bucketing. Sunday-anchored to match US federal payroll
 * convention (FLSA defaults to a fixed-week 40-hr threshold; operators
 * usually anchor to Sunday).
 */
function isoWeekKey(iso: string): string {
  const d = new Date(iso);
  // Snap to start of the calendar week (Sunday).
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

/**
 * Close an open period. Snapshots running totals + writes audit row.
 * Caller wires this to the "Close period" button on the Payroll
 * sub-tab. The actual PayrollRun (with tax stubs + ledger entry) is
 * emitted by the existing `runPayroll()` once the operator confirms.
 */
export function closePayrollPeriod(
  periodId: string,
  closerStaffId: string
): {
  ok: boolean;
  reason?: "not_found" | "not_open";
  totalGross?: number;
  totalHours?: number;
} {
  const period = state.payrollPeriods.find((p) => p.id === periodId);
  if (!period) return { ok: false, reason: "not_found" };
  if (period.status !== "open") return { ok: false, reason: "not_open" };
  const { totalGross, totalHours } = computePaystubPreview(periodId);
  const now = new Date().toISOString();
  const updated: PayrollPeriod = {
    ...period,
    status: "closed",
    closed_by: closerStaffId,
    closed_at: now,
    total_gross: totalGross,
    total_hours: totalHours,
  };
  state = {
    ...state,
    payrollPeriods: state.payrollPeriods.map((p) =>
      p.id === periodId ? updated : p
    ),
    // Stamp every entry inside the window with the period_id so the
    // Time Clock sub-tab can lock them visually.
    timeEntries: state.timeEntries.map((t) => {
      if (!t.clock_out_at) return t;
      if (t.tenant_id !== period.tenant_id) return t;
      const d = t.clock_out_at.slice(0, 10);
      if (d < period.start_date || d > period.end_date) return t;
      if (t.payroll_period_id) return t;
      return { ...t, payroll_period_id: period.id };
    }),
  };
  notify();
  logAuditLocal({
    actor_label: "Marina Stee Operator",
    action_type: "payroll_period.close",
    target_entity: "payroll_period",
    target_id: periodId,
    payload_delta: JSON.stringify({
      period_start: period.start_date,
      period_end: period.end_date,
      total_gross: totalGross,
      total_hours: totalHours,
      closed_by: closerStaffId,
    }),
  });
  return { ok: true, totalGross, totalHours };
}

/**
 * Open a fresh biweekly period starting the day after the prior
 * period's `end_date` (or today if no prior period exists). No-op
 * when there's already an open period.
 */
export function openNextPayrollPeriod(): {
  ok: boolean;
  reason?: "already_open";
  periodId?: string;
} {
  const tenantId = state.currentTenantId;
  const existing = state.payrollPeriods.find(
    (p) => p.tenant_id === tenantId && p.status === "open"
  );
  if (existing) return { ok: false, reason: "already_open", periodId: existing.id };
  const prior = state.payrollPeriods
    .filter((p) => p.tenant_id === tenantId)
    .slice()
    .sort((a, b) => b.end_date.localeCompare(a.end_date))[0];
  const start = new Date(
    prior
      ? new Date(prior.end_date).getTime() + 86_400_000
      : Date.now()
  );
  const end = new Date(start.getTime() + 13 * 86_400_000); // 14-day biweekly
  const id = nextPayrollPeriodId();
  const now = new Date().toISOString();
  const period: PayrollPeriod = {
    id,
    tenant_id: tenantId,
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
    status: "open",
    created_at: now,
  };
  state = {
    ...state,
    payrollPeriods: [period, ...state.payrollPeriods],
  };
  notify();
  return { ok: true, periodId: id };
}

// ── Payroll ──────────────────────────────────────────────────────

export function usePayrollRuns(): PayrollRun[] {
  const s = useStore();
  return s.payrollRuns.filter((p) => p.tenant_id === s.currentTenantId);
}

export function usePaystubs(): Paystub[] {
  const s = useStore();
  return s.paystubs.filter((p) => p.tenant_id === s.currentTenantId);
}

export function usePaystubsForRun(runId: string): Paystub[] {
  const s = useStore();
  return s.paystubs.filter(
    (p) => p.payroll_run_id === runId && p.tenant_id === s.currentTenantId
  );
}

export function nextPayrollRunId() {
  return `pr_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
export function nextPaystubId() {
  return `ps_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Create + post a payroll run for a date range. Aggregates approved,
 * unpaid TimeEntries per staff into Paystubs (hourly), and adds a
 * salary line for each salaried staff. v1 doesn't compute
 * withholdings — those stay at 0 until v2.
 *
 * Posts a single LedgerEntry of type "payment" with gl_account
 * "Payroll Expense" so existing financial dashboards flow.
 */
export function runPayroll(opts: {
  period_start: string;
  period_end: string;
  pay_date?: string;
}): { runId: string; totalGross: number } {
  const tenantId = state.currentTenantId;
  const periodStart = opts.period_start;
  const periodEnd = opts.period_end;
  const payDate = opts.pay_date ?? new Date().toISOString().slice(0, 10);

  const tenantStaff = state.staff.filter(
    (s) => s.tenant_id === tenantId && s.status === "active"
  );

  // Pull every approved + unpaid TimeEntry in the window
  const eligibleEntries = state.timeEntries.filter((t) => {
    if (t.tenant_id !== tenantId) return false;
    if (!t.clock_out_at) return false;
    if (!t.approved_at) return false;
    if (t.payroll_run_id) return false;
    const d = t.clock_out_at.slice(0, 10);
    return d >= periodStart && d <= periodEnd;
  });

  const runId = nextPayrollRunId();
  const paystubs: Paystub[] = [];
  let totalGross = 0;

  for (const staff of tenantStaff) {
    let hoursRegular = 0;
    let hoursOt = 0;
    let gross = 0;
    let employmentType: "w2" | "1099" = staff.employment_type ?? "w2";

    if (staff.salary_annual && staff.salary_annual > 0) {
      // Biweekly slice (assumes 26 pay periods/yr)
      gross = +(staff.salary_annual / 26).toFixed(2);
    } else if (staff.hourly_rate && staff.hourly_rate > 0) {
      const staffEntries = eligibleEntries.filter((t) => t.staff_id === staff.id);
      const totalHours = staffEntries.reduce(
        (sum, t) => sum + (t.calculated_hours ?? 0),
        0
      );
      // Simple OT: anything over 80 in a biweekly period is OT
      const otThreshold = 80;
      hoursRegular = Math.min(totalHours, otThreshold);
      hoursOt = Math.max(0, totalHours - otThreshold);
      const otRate = (staff.ot_multiplier ?? 1.5) * staff.hourly_rate;
      gross = +(hoursRegular * staff.hourly_rate + hoursOt * otRate).toFixed(2);
    } else {
      // No wage data — skip but don't error
      continue;
    }

    if (gross <= 0) continue;
    totalGross += gross;
    paystubs.push({
      id: nextPaystubId(),
      tenant_id: tenantId,
      payroll_run_id: runId,
      staff_id: staff.id,
      hours_regular: hoursRegular,
      hours_ot: hoursOt,
      hours_pto: 0,
      gross,
      // v1 stubs — v2 will compute these
      fed_withholding: 0,
      state_withholding: 0,
      fica_employee: 0,
      fica_employer: 0,
      net: gross,
      employment_type_snapshot: employmentType,
      created_at: new Date().toISOString(),
    });
  }

  const run: PayrollRun = {
    id: runId,
    tenant_id: tenantId,
    period_start: periodStart,
    period_end: periodEnd,
    pay_date: payDate,
    status: "posted",
    total_gross: +totalGross.toFixed(2),
    total_net: +totalGross.toFixed(2),   // gross == net in v1
    total_employer_taxes: 0,
    gl_account: "Payroll Expense",
    qb_sync_status: "pending",
    created_at: new Date().toISOString(),
    posted_at: new Date().toISOString(),
  };

  // Mark eligible TimeEntries as paid (locked)
  const eligibleIds = new Set(eligibleEntries.map((t) => t.id));
  const updatedTimeEntries = state.timeEntries.map((t) =>
    eligibleIds.has(t.id) ? { ...t, payroll_run_id: runId } : t
  );

  // Post the ledger entry — single payment row for the full run.
  // staff_id isn't a boater_id, so we leave boater_id blank but use
  // an explicit "tenant-level" marker. Future iteration: tenant-level
  // GL entries should have their own type, but reusing LedgerEntry
  // means no schema branch for now.
  const ledgerId = nextLedgerId();
  const ledgerEntry: LedgerEntry = {
    id: ledgerId,
    boater_id: `__payroll__${tenantId}`,
    type: "payment",
    number: `PR-${run.id.slice(-6)}`,
    date: payDate,
    amount: run.total_gross,
    open_balance: 0,
    method: "ach",
    status: "paid",
    gl_account: "Payroll Expense",
    qb_sync_status: "pending",
    line_items: paystubs.map((p) => ({
      description: `${tenantStaff.find((s) => s.id === p.staff_id)?.name ?? p.staff_id} — ${p.hours_regular + p.hours_ot}h`,
      amount: p.gross,
    })),
  };

  state = {
    ...state,
    payrollRuns: [run, ...state.payrollRuns],
    paystubs: [...paystubs, ...state.paystubs],
    timeEntries: updatedTimeEntries,
    ledger: [ledgerEntry, ...state.ledger],
  };
  notify();
  return { runId, totalGross: run.total_gross };
}

// ── Certifications ──────────────────────────────────────────────

export function useCertifications(): Certification[] {
  const s = useStore();
  return s.certifications.filter((c) => c.tenant_id === s.currentTenantId);
}

export function useCertificationsForStaff(staffId: string): Certification[] {
  const s = useStore();
  return s.certifications.filter(
    (c) => c.staff_id === staffId && c.tenant_id === s.currentTenantId
  );
}

export function upsertCertification(c: Certification) {
  const exists = state.certifications.some((x) => x.id === c.id);
  const stamped: Certification = exists
    ? c
    : { ...c, tenant_id: c.tenant_id || state.currentTenantId };
  state = {
    ...state,
    certifications: exists
      ? state.certifications.map((x) => (x.id === stamped.id ? stamped : x))
      : [stamped, ...state.certifications],
  };
  notify();
}

export function deleteCertification(id: string) {
  state = {
    ...state,
    certifications: state.certifications.filter((c) => c.id !== id),
  };
  notify();
}

export function nextCertificationId() {
  return `cert_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── PTO requests ────────────────────────────────────────────────

export function usePtoRequests(): PtoRequest[] {
  const s = useStore();
  return s.ptoRequests.filter((p) => p.tenant_id === s.currentTenantId);
}

export function upsertPtoRequest(r: PtoRequest) {
  const exists = state.ptoRequests.some((x) => x.id === r.id);
  const stamped: PtoRequest = exists
    ? r
    : { ...r, tenant_id: r.tenant_id || state.currentTenantId };
  state = {
    ...state,
    ptoRequests: exists
      ? state.ptoRequests.map((x) => (x.id === stamped.id ? stamped : x))
      : [stamped, ...state.ptoRequests],
  };
  notify();
}

export function nextPtoRequestId() {
  return `pto_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Vendors ─────────────────────────────────────────────────────

export function useVendors(): Vendor[] {
  const s = useStore();
  return s.vendors.filter((v) => v.tenant_id === s.currentTenantId);
}

export function useVendor(id: string): Vendor | undefined {
  return useStore().vendors.find((v) => v.id === id);
}

export function upsertVendor(v: Vendor) {
  const exists = state.vendors.some((x) => x.id === v.id);
  const stamped: Vendor = exists
    ? v
    : { ...v, tenant_id: v.tenant_id || state.currentTenantId };
  state = {
    ...state,
    vendors: exists
      ? state.vendors.map((x) => (x.id === stamped.id ? stamped : x))
      : [stamped, ...state.vendors],
  };
  notify();
}

export function deleteVendor(id: string) {
  state = { ...state, vendors: state.vendors.filter((v) => v.id !== id) };
  notify();
}

export function nextVendorId() {
  return `vend_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Bills + AP ──────────────────────────────────────────────────

export function useBills(): Bill[] {
  const s = useStore();
  return s.bills.filter((b) => b.tenant_id === s.currentTenantId);
}

export function useBillsForVendor(vendorId: string): Bill[] {
  const s = useStore();
  return s.bills.filter(
    (b) => b.vendor_id === vendorId && b.tenant_id === s.currentTenantId
  );
}

export function useBill(id: string): Bill | undefined {
  return useStore().bills.find((b) => b.id === id);
}

export function upsertBill(b: Bill) {
  const exists = state.bills.some((x) => x.id === b.id);
  const stamped: Bill = exists
    ? b
    : { ...b, tenant_id: b.tenant_id || state.currentTenantId };
  state = {
    ...state,
    bills: exists
      ? state.bills.map((x) => (x.id === stamped.id ? stamped : x))
      : [stamped, ...state.bills],
  };
  notify();
}

/** Hard-delete. Use sparingly — paid bills should be retained for audit. */
export function deleteBill(id: string) {
  state = { ...state, bills: state.bills.filter((b) => b.id !== id) };
  notify();
}

export function nextBillId() {
  return `bill_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function useBillPayments(): BillPayment[] {
  const s = useStore();
  return s.billPayments.filter((p) => p.tenant_id === s.currentTenantId);
}

export function nextBillPaymentId() {
  return `bp_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Pay a bill — full or partial. Marks the bill paid/partial, creates
 * a BillPayment, and posts a "payment" LedgerEntry for the cash
 * outflow (negative amount? no — we treat it as a positive payment
 * to the vendor with gl_account = "Cash / Operating"). QB sync
 * picks it up on the next run.
 */
export function payBill(opts: {
  bill_id: string;
  amount: number;
  method: BillPayment["method"];
  paid_at?: string;
  check_number?: string;
  notes?: string;
}): string | null {
  const bill = state.bills.find((b) => b.id === opts.bill_id);
  if (!bill) return null;
  if (opts.amount <= 0) return null;
  const remaining = bill.amount - bill.amount_paid;
  const applied = Math.min(remaining, opts.amount);
  if (applied <= 0) return null;
  const paidAt = opts.paid_at ?? new Date().toISOString().slice(0, 10);

  const payment: BillPayment = {
    id: nextBillPaymentId(),
    tenant_id: state.currentTenantId,
    bill_id: bill.id,
    vendor_id: bill.vendor_id,
    paid_at: paidAt,
    amount: applied,
    method: opts.method,
    check_number: opts.check_number,
    gl_account: "Cash / Operating",
    notes: opts.notes,
    created_at: new Date().toISOString(),
  };
  const newAmountPaid = +(bill.amount_paid + applied).toFixed(2);
  const newStatus: Bill["status"] =
    newAmountPaid >= bill.amount ? "paid" : "partial";

  // Ledger row for the cash outflow. boater_id is the vendor marker
  // so the row clearly isn't customer-billing.
  const ledgerId = nextLedgerId();
  const ledgerEntry: LedgerEntry = {
    id: ledgerId,
    boater_id: `__vendor__${bill.vendor_id}`,
    type: "payment",
    number: `BP-${payment.id.slice(-6)}`,
    date: paidAt,
    amount: applied,
    open_balance: 0,
    method: opts.method === "ach" ? "ach" : opts.method === "card" ? "card" : "check",
    status: "paid",
    gl_account: "Accounts Payable",
    qb_sync_status: "pending",
    line_items: [
      {
        description: `Vendor payment — ${state.vendors.find((v) => v.id === bill.vendor_id)?.display_name ?? bill.vendor_id} (bill ${bill.number})`,
        amount: applied,
      },
    ],
  };

  state = {
    ...state,
    bills: state.bills.map((b) =>
      b.id === bill.id
        ? { ...b, amount_paid: newAmountPaid, status: newStatus }
        : b
    ),
    billPayments: [payment, ...state.billPayments],
    ledger: [ledgerEntry, ...state.ledger],
  };
  notify();
  return payment.id;
}

// ── VendorBill — operator AP workflow (draft → approve → schedule → pay)
//
// Distinct from the legacy `Bill` slice above. `VendorBill` carries the
// full workflow state machine (draft, pending_approval, approved,
// scheduled, paid, disputed, void) + approval/scheduling metadata. Every
// state transition writes a local audit row via logAuditLocal so the
// /settings/audit-log surface tracks operator vs agent provenance.
//
// Payment mark-paid posts a "payment" LedgerEntry mirroring payBill so
// AP cash outflow continues to feed the canonical ledger. The QB sync
// status is set 'pending' so the next run sweeps it.

export function useVendorBills(): VendorBill[] {
  const s = useStore();
  return s.vendorBills.filter((b) => b.tenant_id === s.currentTenantId);
}

export function useVendorBillsForVendor(vendorId: string): VendorBill[] {
  const s = useStore();
  return s.vendorBills.filter(
    (b) => b.vendor_id === vendorId && b.tenant_id === s.currentTenantId,
  );
}

export function useVendorBill(id: string): VendorBill | undefined {
  return useStore().vendorBills.find((b) => b.id === id);
}

export function nextVendorBillId(): string {
  return `vbill_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Generate the next sequential BIL-#### number for a new bill, scoped to
 * the current tenant. Walks existing bills and picks max+1.
 */
export function nextVendorBillNumber(): string {
  const tenantBills = state.vendorBills.filter(
    (b) => b.tenant_id === state.currentTenantId,
  );
  const max = tenantBills.reduce((acc, b) => {
    const m = /^BIL-(\d+)$/.exec(b.number);
    if (!m) return acc;
    return Math.max(acc, Number(m[1]));
  }, 0);
  return `BIL-${String(max + 1).padStart(4, "0")}`;
}

/**
 * Compute due_date from a bill_date + a vendor's payment_terms. Net N
 * adds N days; "due_on_receipt" returns the bill_date itself.
 */
export function computeVendorBillDueDate(
  billDate: string,
  terms:
    | "due_on_receipt"
    | "net_7"
    | "net_15"
    | "net_30"
    | "net_60",
): string {
  if (terms === "due_on_receipt") return billDate;
  const days =
    terms === "net_7" ? 7 : terms === "net_15" ? 15 : terms === "net_30" ? 30 : 60;
  const d = new Date(`${billDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Insert or replace a VendorBill. Stamps tenant_id from the current
 * session when not already set. Used by both the wizard and the agent
 * executor.
 */
export function upsertVendorBill(b: VendorBill): void {
  const exists = state.vendorBills.some((x) => x.id === b.id);
  const stamped: VendorBill = exists
    ? b
    : { ...b, tenant_id: b.tenant_id || state.currentTenantId };
  state = {
    ...state,
    vendorBills: exists
      ? state.vendorBills.map((x) => (x.id === stamped.id ? stamped : x))
      : [stamped, ...state.vendorBills],
  };
  notify();
}

/**
 * Patch a subset of fields on a VendorBill. Bills look up by id; missing
 * id no-ops so callers can fire-and-forget.
 */
export function updateVendorBill(id: string, patch: Partial<VendorBill>): void {
  const exists = state.vendorBills.some((x) => x.id === id);
  if (!exists) return;
  state = {
    ...state,
    vendorBills: state.vendorBills.map((b) =>
      b.id === id ? { ...b, ...patch } : b,
    ),
  };
  notify();
}

/** Hard delete — operator drops a draft. Paid bills should NOT be deleted. */
export function deleteVendorBill(id: string): void {
  state = {
    ...state,
    vendorBills: state.vendorBills.filter((b) => b.id !== id),
  };
  notify();
}

/**
 * Approve a pending bill. Stamps approved_by + approved_at and flips
 * status to "approved". No-op if the bill isn't pending_approval or
 * draft.
 */
export function approveVendorBill(opts: {
  id: string;
  approver_user_id?: string;
  approved_at?: string;
}): boolean {
  const bill = state.vendorBills.find((b) => b.id === opts.id);
  if (!bill) return false;
  if (bill.status !== "pending_approval" && bill.status !== "draft") return false;
  if (bill.amount <= 0) return false;
  const approvedAt = opts.approved_at ?? new Date().toISOString();
  state = {
    ...state,
    vendorBills: state.vendorBills.map((b) =>
      b.id === bill.id
        ? {
            ...b,
            status: "approved",
            approved_by: opts.approver_user_id ?? "u_steven",
            approved_at: approvedAt,
          }
        : b,
    ),
  };
  notify();
  return true;
}

/**
 * Schedule a payment for an approved bill. Sets scheduled_payment_date +
 * method and flips status to "scheduled". Disputed bills are blocked at
 * the UI layer; this is defense-in-depth.
 */
export function scheduleVendorBillPayment(opts: {
  id: string;
  scheduled_payment_date: string;
  scheduled_payment_method: VendorBillPaymentMethod;
}): boolean {
  const bill = state.vendorBills.find((b) => b.id === opts.id);
  if (!bill) return false;
  if (bill.status !== "approved" && bill.status !== "scheduled") return false;
  state = {
    ...state,
    vendorBills: state.vendorBills.map((b) =>
      b.id === bill.id
        ? {
            ...b,
            status: "scheduled",
            scheduled_payment_date: opts.scheduled_payment_date,
            scheduled_payment_method: opts.scheduled_payment_method,
          }
        : b,
    ),
  };
  notify();
  return true;
}

/**
 * Mark a bill as paid. Stamps paid_at + paid_via, posts a "payment"
 * LedgerEntry for the cash outflow, and back-references the ledger row
 * onto the bill via payment_ledger_entry_id.
 *
 * Mirrors `payBill` for the legacy `Bill` slice but writes against the
 * new `VendorBill` slice. Returns the ledger entry id.
 */
export function markVendorBillPaid(opts: {
  id: string;
  paid_at?: string;
  paid_via?: string;
  payment_method?: VendorBillPaymentMethod;
}): string | null {
  const bill = state.vendorBills.find((b) => b.id === opts.id);
  if (!bill) return null;
  if (bill.status === "paid" || bill.status === "void" || bill.status === "disputed") {
    return null;
  }
  if (bill.amount <= 0) return null;
  const paidAt = opts.paid_at ?? new Date().toISOString().slice(0, 10);
  const method =
    opts.payment_method ?? bill.scheduled_payment_method ?? "ach";

  // Ledger row for the cash outflow. Mirrors payBill — boater_id encodes
  // the vendor marker so reports can distinguish AP cash outflow from
  // boater AR. Method maps to ledger's accepted enum.
  const ledgerId = nextLedgerId();
  const ledgerEntry: LedgerEntry = {
    id: ledgerId,
    boater_id: `__vendor__${bill.vendor_id}`,
    type: "payment",
    number: `VBP-${bill.number}`,
    date: paidAt,
    amount: bill.amount,
    open_balance: 0,
    method: method === "ach" ? "ach" : method === "card" ? "card" : "check",
    status: "paid",
    gl_account: "Accounts Payable",
    qb_sync_status: "pending",
    line_items: [
      {
        description: `Vendor payment — ${
          state.vendors.find((v) => v.id === bill.vendor_id)?.display_name ??
          bill.vendor_id
        } (bill ${bill.number})`,
        amount: bill.amount,
      },
    ],
  };

  state = {
    ...state,
    vendorBills: state.vendorBills.map((b) =>
      b.id === bill.id
        ? {
            ...b,
            status: "paid",
            paid_at: paidAt,
            paid_via: opts.paid_via,
            payment_ledger_entry_id: ledgerId,
          }
        : b,
    ),
    ledger: [ledgerEntry, ...state.ledger],
  };
  notify();
  return ledgerId;
}

/**
 * Flip a bill to "disputed" with a required reason. Blocks the bill
 * from the approval / schedule / pay paths until the dispute is cleared
 * (via `clearVendorBillDispute`).
 */
export function disputeVendorBill(opts: {
  id: string;
  reason: string;
}): boolean {
  const bill = state.vendorBills.find((b) => b.id === opts.id);
  if (!bill) return false;
  if (bill.status === "paid" || bill.status === "void") return false;
  state = {
    ...state,
    vendorBills: state.vendorBills.map((b) =>
      b.id === bill.id
        ? { ...b, status: "disputed", dispute_reason: opts.reason }
        : b,
    ),
  };
  notify();
  return true;
}

/**
 * Clear a dispute, returning the bill to pending_approval so the queue
 * picks it back up.
 */
export function clearVendorBillDispute(id: string): boolean {
  const bill = state.vendorBills.find((b) => b.id === id);
  if (!bill || bill.status !== "disputed") return false;
  state = {
    ...state,
    vendorBills: state.vendorBills.map((b) =>
      b.id === id
        ? { ...b, status: "pending_approval", dispute_reason: undefined }
        : b,
    ),
  };
  notify();
  return true;
}

/** Mark a bill void (operator decided not to pay, no dispute). */
export function voidVendorBill(id: string): boolean {
  const bill = state.vendorBills.find((b) => b.id === id);
  if (!bill || bill.status === "paid") return false;
  state = {
    ...state,
    vendorBills: state.vendorBills.map((b) =>
      b.id === id ? { ...b, status: "void" } : b,
    ),
  };
  notify();
  return true;
}

/**
 * Convenience guard — does the legacy Bill module still own this slice?
 * Used by the Bills sub-tab UI to display a "view in approval queue"
 * link when a bill is pending_approval (so the operator doesn't have to
 * scroll). Kept as a separate helper rather than inlined so the UI doesn't
 * import the full `VendorBillStatus` union.
 */
export function vendorBillIsActionable(b: VendorBill): boolean {
  return (
    b.status === "pending_approval" ||
    b.status === "approved" ||
    b.status === "scheduled"
  );
}

// ── Inbound emails (AP-bill ingest provenance) ──────────────────
//
// Read-only on the mock side — every row here comes from the seed
// (Steven's prototype demos). The real ingest path is the Postmark
// webhook at /api/inbound/postmark/[tenantId] which writes through
// Convex's `inboundEmails.ingest` mutation. The two surfaces both
// render via the `useInboundEmails` hook + the live Convex query.

export function useInboundEmails(): InboundEmail[] {
  const s = useStore();
  return s.inboundEmails
    .filter((e) => e.tenant_id === s.currentTenantId)
    .sort((a, b) => (b.received_at < a.received_at ? -1 : 1));
}

export function useInboundEmail(id: string): InboundEmail | undefined {
  return useStore().inboundEmails.find((e) => e.id === id);
}

/** Find the inbound email (if any) that drafted a given VendorBill. */
export function useInboundEmailForBill(
  vendorBillId: string,
): InboundEmail | undefined {
  return useStore().inboundEmails.find(
    (e) => e.vendor_bill_id === vendorBillId,
  );
}

// ── Inventory — stock movements + lookups ───────────────────────

export function useStockMovements(): StockMovement[] {
  const s = useStore();
  return s.stockMovements.filter((m) => m.tenant_id === s.currentTenantId);
}

export function useStockMovementsForItem(itemId: string): StockMovement[] {
  const s = useStore();
  return s.stockMovements.filter(
    (m) => m.item_id === itemId && m.tenant_id === s.currentTenantId
  );
}

export function nextStockMovementId() {
  return `sm_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Record a stock movement and update PosCatalogItem.stock_on_hand.
 * Use kind="receive" with a positive delta when stock arrives,
 * "sale" with a negative delta when POS sells (auto-fired by the
 * POS mutator), "adjust" for inventory counts, "loss" for breakage.
 */
export function recordStockMovement(opts: {
  item_id: string;
  delta: number;
  kind: StockMovementKind;
  reference_id?: string;
  notes?: string;
  recorded_by?: string;
}): string | null {
  const item = state.posCatalog.find((i) => i.id === opts.item_id);
  if (!item) return null;
  // Only act on tracked items — silently noop for untracked services.
  if (!item.tracked) return null;
  const id = nextStockMovementId();
  const now = new Date().toISOString();
  const movement: StockMovement = {
    id,
    tenant_id: state.currentTenantId,
    item_id: opts.item_id,
    delta: opts.delta,
    kind: opts.kind,
    reference_id: opts.reference_id,
    notes: opts.notes,
    occurred_at: now,
    recorded_by: opts.recorded_by,
    created_at: now,
  };
  const newStock = Math.max(0, (item.stock_on_hand ?? 0) + opts.delta);
  state = {
    ...state,
    stockMovements: [movement, ...state.stockMovements],
    posCatalog: state.posCatalog.map((i) =>
      i.id === item.id ? { ...i, stock_on_hand: newStock } : i
    ),
  };
  notify();
  return id;
}

/**
 * Receive stock against a bill — typical AP workflow. Bumps each
 * item's stock_on_hand by the qty received and adds a single
 * StockMovement row per item linked to the bill. The bill itself
 * doesn't change state; this is purely the inventory side.
 */
export function receiveStockAgainstBill(opts: {
  bill_id: string;
  items: { item_id: string; qty: number }[];
  recorded_by?: string;
}): string[] {
  const ids: string[] = [];
  for (const line of opts.items) {
    const id = recordStockMovement({
      item_id: line.item_id,
      delta: line.qty,
      kind: "receive",
      reference_id: opts.bill_id,
      recorded_by: opts.recorded_by,
    });
    if (id) ids.push(id);
  }
  // Track which movements landed against this bill for the bill row.
  if (ids.length > 0) {
    state = {
      ...state,
      bills: state.bills.map((b) =>
        b.id === opts.bill_id
          ? {
              ...b,
              linked_stock_movement_ids: [
                ...(b.linked_stock_movement_ids ?? []),
                ...ids,
              ],
            }
          : b
      ),
    };
    notify();
  }
  return ids;
}

// ── Marina assets + PM ─────────────────────────────────────────

export function useMarinaAssets(): MarinaAsset[] {
  const s = useStore();
  return s.marinaAssets.filter((a) => a.tenant_id === s.currentTenantId);
}

export function useMarinaAsset(id: string): MarinaAsset | undefined {
  return useStore().marinaAssets.find((a) => a.id === id);
}

export function upsertMarinaAsset(a: MarinaAsset) {
  const exists = state.marinaAssets.some((x) => x.id === a.id);
  const stamped: MarinaAsset = exists
    ? a
    : { ...a, tenant_id: a.tenant_id || state.currentTenantId };
  state = {
    ...state,
    marinaAssets: exists
      ? state.marinaAssets.map((x) => (x.id === stamped.id ? stamped : x))
      : [stamped, ...state.marinaAssets],
  };
  notify();
}

export function deleteMarinaAsset(id: string) {
  state = {
    ...state,
    marinaAssets: state.marinaAssets.filter((a) => a.id !== id),
  };
  notify();
}

export function nextMarinaAssetId() {
  return `asset_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function usePmSchedules(): PmSchedule[] {
  const s = useStore();
  return s.pmSchedules.filter((p) => p.tenant_id === s.currentTenantId);
}

export function usePmSchedulesForAsset(assetId: string): PmSchedule[] {
  const s = useStore();
  return s.pmSchedules.filter(
    (p) => p.asset_id === assetId && p.tenant_id === s.currentTenantId
  );
}

export function upsertPmSchedule(p: PmSchedule) {
  const exists = state.pmSchedules.some((x) => x.id === p.id);
  const stamped: PmSchedule = exists
    ? p
    : { ...p, tenant_id: p.tenant_id || state.currentTenantId };
  state = {
    ...state,
    pmSchedules: exists
      ? state.pmSchedules.map((x) => (x.id === stamped.id ? stamped : x))
      : [stamped, ...state.pmSchedules],
  };
  notify();
}

export function nextPmScheduleId() {
  return `pm_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function deletePmSchedule(id: string) {
  state = {
    ...state,
    pmSchedules: state.pmSchedules.filter((p) => p.id !== id),
  };
  notify();
}

/**
 * Scan all active PM schedules for the active tenant. Auto-create a
 * Work Order when next_due_at is within auto_create_wo_days_ahead of
 * today AND there isn't already a WO open for this cycle. Called by
 * the agent tool `run_pm_check` or a daily cron in production.
 */
export function runPmCheck(): { created: string[] } {
  const tenantId = state.currentTenantId;
  const tenantSchedules = state.pmSchedules.filter(
    (p) => p.tenant_id === tenantId && p.active
  );
  const today = new Date();
  const created: string[] = [];

  for (const sched of tenantSchedules) {
    const dueMs = new Date(sched.next_due_at).getTime();
    const triggerMs =
      today.getTime() + sched.auto_create_wo_days_ahead * 86_400_000;
    if (dueMs > triggerMs) continue;
    // Don't double-create — check the existing linked WOs to see if
    // any is still open from the current cycle.
    const existingOpen = (sched.linked_work_order_ids ?? []).some((woId) => {
      const wo = state.workOrders.find((w) => w.id === woId);
      return wo && !["completed", "cancelled"].includes(wo.status);
    });
    if (existingOpen) continue;

    const asset = state.marinaAssets.find((a) => a.id === sched.asset_id);
    if (!asset) continue;

    // Create a synthetic WO. boater_id is the asset marker so the WO
    // lists right but doesn't tie to a customer.
    const woId = `wo_pm_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`;
    const wo: WorkOrder = {
      id: woId,
      number: `PM-${woId.slice(-6)}`,
      boater_id: `__asset__${asset.id}`,
      subject: `${sched.name} — ${asset.name}`,
      description: sched.description,
      status: "scheduled",
      priority: "normal",
      // PM-spawned WOs are operational service work on marina-owned
      // assets — never cleaning or haul/storage.
      work_class: "service",
      activity_type: "service",
      start_date: sched.next_due_at,
      due_date: sched.next_due_at,
      assignee_user_id: sched.assigned_to_staff_id,
      submitted_via: "staff",
    };
    state = {
      ...state,
      workOrders: [wo, ...state.workOrders],
      pmSchedules: state.pmSchedules.map((p) =>
        p.id === sched.id
          ? {
              ...p,
              linked_work_order_ids: [
                ...(p.linked_work_order_ids ?? []),
                woId,
              ],
            }
          : p
      ),
    };
    created.push(woId);
  }

  if (created.length > 0) notify();
  return { created };
}

// ============================================================
// AI-first foundation — hooks + mutators
// ============================================================

// ── TenantAiSettings ────────────────────────────────────────

export function useAiSettings(): TenantAiSettings {
  const s = useStore();
  const settings = s.aiSettingsByTenant[s.currentTenantId];
  // Defensive: a brand new tenant created at runtime gets a default
  // settings record on first read so pages never crash on undefined.
  if (settings) return settings;
  return DEFAULT_AI_SETTINGS(s.currentTenantId);
}

export function getAiSettings(tenantId?: string): TenantAiSettings {
  const id = tenantId ?? state.currentTenantId;
  return state.aiSettingsByTenant[id] ?? DEFAULT_AI_SETTINGS(id);
}

function DEFAULT_AI_SETTINGS(tenantId: string): TenantAiSettings {
  return {
    tenant_id: tenantId,
    bills_inbox_enabled: false,
    bills_auto_approve_enabled: false,
    bills_auto_approve_threshold_cents: 25000,
    bills_auto_approve_requires_familiar_vendor: true,
    vendors_auto_create_from_invoice: false,
    staff_onboarding_doc_intake_enabled: false,
    timecard_anomalies_only: false,
    timecard_max_shift_hours: 12,
    timecard_require_break_after_hours: 6,
    timecard_ot_threshold_hours_per_period: 80,
    certs_photo_intake_enabled: false,
    certs_nudge_days_before_expiration: [30, 14, 7],
    inventory_velocity_reorder_enabled: false,
    inventory_reorder_lead_time_days: 7,
    inventory_velocity_window_days: 30,
    assets_pm_auto_derive_from_manual: false,
    dock_voice_input_enabled: false,
    onboarding_completed_steps: [],
    onboarding_dismissed: false,
  };
}

export function updateAiSettings(patch: Partial<TenantAiSettings>) {
  const tenantId = state.currentTenantId;
  const existing = state.aiSettingsByTenant[tenantId] ?? DEFAULT_AI_SETTINGS(tenantId);
  state = {
    ...state,
    aiSettingsByTenant: {
      ...state.aiSettingsByTenant,
      [tenantId]: { ...existing, ...patch, tenant_id: tenantId },
    },
  };
  notify();
}

export function markOnboardingStepComplete(step: OnboardingStepKey) {
  const tenantId = state.currentTenantId;
  const existing = state.aiSettingsByTenant[tenantId] ?? DEFAULT_AI_SETTINGS(tenantId);
  if (existing.onboarding_completed_steps.includes(step)) return;
  state = {
    ...state,
    aiSettingsByTenant: {
      ...state.aiSettingsByTenant,
      [tenantId]: {
        ...existing,
        onboarding_completed_steps: [...existing.onboarding_completed_steps, step],
      },
    },
  };
  notify();
}

export function dismissOnboarding() {
  const tenantId = state.currentTenantId;
  const existing = state.aiSettingsByTenant[tenantId] ?? DEFAULT_AI_SETTINGS(tenantId);
  state = {
    ...state,
    aiSettingsByTenant: {
      ...state.aiSettingsByTenant,
      [tenantId]: { ...existing, onboarding_dismissed: true },
    },
  };
  notify();
}

// ── Attachments ─────────────────────────────────────────────

export function nextAttachmentId(): string {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function addAttachment(att: Omit<Attachment, "tenant_id"> & { tenant_id?: string }): string {
  const stamped: Attachment = {
    ...att,
    tenant_id: att.tenant_id || state.currentTenantId,
  };
  state = { ...state, attachments: [stamped, ...state.attachments] };
  notify();
  return stamped.id;
}

export function useAttachments(): Attachment[] {
  const s = useStore();
  return s.attachments.filter((a) => a.tenant_id === s.currentTenantId);
}

export function getAttachmentById(id: string): Attachment | undefined {
  return state.attachments.find((a) => a.id === id);
}

// ── ExtractionDrafts ────────────────────────────────────────

export function nextDraftId(): string {
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function addExtractionDraft(
  draft: Omit<ExtractionDraft, "tenant_id"> & { tenant_id?: string }
): string {
  const stamped: ExtractionDraft = {
    ...draft,
    tenant_id: draft.tenant_id || state.currentTenantId,
  };
  state = { ...state, extractionDrafts: [stamped, ...state.extractionDrafts] };
  notify();
  return stamped.id;
}

export function updateExtractionDraft(
  id: string,
  patch: Partial<ExtractionDraft>
) {
  state = {
    ...state,
    extractionDrafts: state.extractionDrafts.map((d) =>
      d.id === id ? { ...d, ...patch } : d
    ),
  };
  notify();
}

export function useExtractionDrafts(module?: ExtractionModule): ExtractionDraft[] {
  const s = useStore();
  return s.extractionDrafts.filter(
    (d) =>
      d.tenant_id === s.currentTenantId &&
      (module === undefined || d.module === module)
  );
}

export function useExtractionDraftsByStatus(
  status: ExtractionDraftStatus,
  module?: ExtractionModule
): ExtractionDraft[] {
  const s = useStore();
  return s.extractionDrafts.filter(
    (d) =>
      d.tenant_id === s.currentTenantId &&
      d.status === status &&
      (module === undefined || d.module === module)
  );
}

export function countDraftsBy(module: ExtractionModule, status: ExtractionDraftStatus): number {
  return state.extractionDrafts.filter(
    (d) => d.tenant_id === state.currentTenantId && d.module === module && d.status === status
  ).length;
}

// ── Lookup helpers for AI extract executor ──────────────────

export function getExtractionDraftById(id: string): ExtractionDraft | undefined {
  return state.extractionDrafts.find((d) => d.id === id);
}

export function findVendorByName(name: string): Vendor | undefined {
  if (!name) return undefined;
  const lc = name.toLowerCase();
  const tenantId = state.currentTenantId;
  return state.vendors.find(
    (v) =>
      v.tenant_id === tenantId &&
      (v.name.toLowerCase() === lc ||
        (v.display_name?.toLowerCase() ?? "") === lc ||
        v.name.toLowerCase().includes(lc))
  );
}

export function findStaffByName(name: string): StaffMember | undefined {
  if (!name) return undefined;
  const lc = name.toLowerCase();
  const tenantId = state.currentTenantId;
  return state.staff.find(
    (s) =>
      s.tenant_id === tenantId &&
      (s.name.toLowerCase() === lc || s.name.toLowerCase().includes(lc))
  );
}

export function findPosItemByHint(skuHint?: string, descHint?: string): PosCatalogItem | undefined {
  const tenantId = state.currentTenantId;
  const pool = state.posCatalog.filter(
    (i) => (i.tenant_id ?? "ten_marina_stee_demo") === tenantId
  );
  if (skuHint) {
    const sLow = skuHint.toLowerCase();
    const skuMatch = pool.find((i) => i.sku.toLowerCase().includes(sLow));
    if (skuMatch) return skuMatch;
  }
  if (descHint) {
    const head = descHint.toLowerCase().split(" ")[0];
    const descMatch = pool.find((i) => i.name.toLowerCase().includes(head));
    if (descMatch) return descMatch;
  }
  return undefined;
}
