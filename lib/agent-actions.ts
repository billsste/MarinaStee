"use client";

import { can, ROLE_META, type Action, type Entity, type Role } from "@/lib/auth";
import { registeredToolPermissions } from "@/lib/agent-tools";
import {
  ALL_STAFF,
  BOATERS,
  CLUB_BOOKINGS,
  CLUB_SUBSCRIPTIONS,
  CONTRACTS,
  POS_LOCATIONS,
  formatMoney,
} from "@/lib/mock-data";
import {
  addBoatRental,
  addBoater,
  getCurrentTenantId,
  addCardForBoater,
  addCommunication,
  bulkAddContracts,
  deleteCardForBoater,
  addContract,
  addLedgerEntry,
  addPosOrder,
  addReservation,
  addVessel,
  addWorkOrder,
  applyPaymentToInvoices,
  closeBoatRental,
  effectivePlanFor,
  getClubPlanByTier,
  getSetupRateForTier,
  mintBookingPickupToken,
  mintContractSignatureToken,
  nextBoatRentalId,
  nextBoatRentalNumber,
  nextBoaterId,
  nextCardId,
  nextClubBookingId,
  nextClubSubscriptionId,
  runClubMonthlyBilling,
  sendClubReactivationComms,
  nextContractId,
  nextContractNumber,
  nextDockId,
  nextFeeId,
  nextInvoiceNumber,
  nextLedgerId,
  nextPosItemId,
  nextPosOrderId,
  nextPosOrderNumber,
  nextReservationId,
  nextReservationNumber,
  nextStaffId,
  nextVesselId,
  nextWorkOrderId,
  nextWorkOrderNumber,
  notifyWaitlistOfSlipOpening,
  fireWaitlistOffer,
  acceptWaitlistOffer,
  declineWaitlistOffer,
  postBillingRunInvoice,
  requestCoiRenewal,
  logAuditLocal,
  updateBoater,
  updateCommTemplate,
  updateContract,
  updateDock,
  updateFee,
  updateMarinaProfile,
  updatePosItem,
  updatePosLocation,
  updateProviderConfig,
  updateReservation,
  updateReservationStatus,
  updateRole,
  updateStaffMember,
  updateVessel,
  updateWorkOrder,
  upsertClubBooking,
  upsertClubSubscription,
  upsertDock,
  upsertFee,
  upsertMeter,
  upsertPosItem,
  upsertProviderConfig,
  upsertRate,
  upsertRentalBoat,
  upsertRentalGroup,
  upsertRentalSpace,
  upsertRole,
  upsertSlip,
  upsertStaffMember,
  upsertTemplate,
  addInsuranceCertificate,
  upsertInsuranceCertificate,
  getInsuranceById,
  getLedgerEntryById,
  nextCoiId,
  nextMeterId,
  nextRentalBoatId,
  nextRateId,
  nextRentalGroupId,
  nextRentalSpaceId,
  nextTemplateId,
  updateRate,
  // ── Back office ──
  nextShiftId,
  upsertShift,
  nextCertificationId,
  upsertCertification,
  runPayroll,
  approveTimeEntry,
  // ── Time Clock + Payroll Prep (W1 feature) ──
  clockInByPin,
  clockOutByPin,
  adjustTimeEntry,
  closePayrollPeriod,
  nextTimeEntryId,
  nextVendorId,
  upsertVendor,
  nextBillId,
  upsertBill,
  payBill,
  // ── Vendor Bills (operator AP workflow) ──
  nextVendorBillId,
  nextVendorBillNumber,
  computeVendorBillDueDate,
  upsertVendorBill,
  approveVendorBill,
  scheduleVendorBillPayment,
  markVendorBillPaid,
  recordStockMovement,
  nextMarinaAssetId,
  upsertMarinaAsset,
  nextPmScheduleId,
  upsertPmSchedule,
  runPmCheck,
  // ── Boater applications (public self-onboarding queue) ──
  // approveApplication / declineApplication / routeApplicationToWaitlist
  // are aliased on import because this module already has actions named
  // "approve_application" etc. in the switch — the alias keeps the
  // executor body clean.
  submitApplication,
  approveApplication as approveApplicationStore,
  declineApplication as declineApplicationStore,
  routeApplicationToWaitlist as routeApplicationToWaitlistStore,
  // Renewal Sweep Coordinator
  createRenewalSweep,
  addContractToRenewalSweep,
  updateRenewalSweepItem,
  launchRenewalSweep,
  recordRenewalSweepAcceptance,
} from "@/lib/client-store";
import type {
  AgentAction,
} from "@/lib/simulated-agent";
import {
  DOCKS,
  FUEL_SALES,
  METER_READINGS,
  QUOTES,
  RENTAL_BOATS,
  VESSELS,
  ALL_COMM_TEMPLATES,
} from "@/lib/mock-data";
// Notification dispatch for the mock-path send_message fan-out.
// Imported eagerly because lib/notification-dispatch.ts is server-safe
// (no React, no top-level side effects) so it's a one-line cost.
import { dispatchCommunication } from "@/lib/notification-dispatch";
import type {
  AdditionalFee,
  AppProviderConfig,
  BoatRental,
  Boater,
  CardOnFile,
  Communication,
  Contract,
  ContractTemplate,
  Dock,
  FuelSale,
  InsuranceCertificate,
  LedgerEntry,
  MeterReading,
  PermissionKey,
  Quote,
  QuoteLineItem,
  Role as MarinaRole,
  PosCatalogItem,
  PosOrder, // referenced via order construction in charge_to_account branch
  Rate,
  RentalGroup,
  RentalSpace,
  Reservation,
  Slip,
  StaffMember,
  Vessel,
  WorkOrder,
} from "@/lib/types";
import {
  DEFAULT_CLEANING_CHECKLIST,
  SEED_TENANT_ID,
  USERS,
  VENDORS_SEED,
} from "@/lib/mock-data";
// Cadence math lives in lib/recurring-cleaning so the WO action handler
// and the recurrence walker can't drift out of sync. Importing the
// shared helper means a month-end-clamp fix (or any future cadence
// rule) lands in one place. (Circular w/ recurring-cleaning importing
// executeAgentAction is safe — both sides only reference each other
// inside function bodies, never at module init.)
import { nextRecurringDate } from "@/lib/recurring-cleaning";
import { createHelpTicket } from "@/lib/help-desk";

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
  // Auto-offer cascade: fan-out a fired offer + handle accept/decline.
  fire_waitlist_offer: { entity: "broadcast", action: "create" },
  accept_waitlist_offer: { entity: "broadcast", action: "create" },
  decline_waitlist_offer: { entity: "broadcast", action: "create" },
  request_coi_renewal: { entity: "broadcast", action: "create" },
  // Settings — staff management. RBAC uses "boater" entity as a stand-in
  // for any user-profile creation since there is no dedicated "staff"
  // permission key in the existing model. Only Super admin should be
  // adding teammates in practice.
  invite_staff: { entity: "boater", action: "create" },
  // Work order edits — status / priority / assignee / dates.
  // Mark complete fires the closeout chain inside updateWorkOrder.
  update_work_order: { entity: "work_order", action: "edit" },
  // Batch A: operator setup + catalog. All gated on "boater" entity
  // as a stand-in for "settings" permission (no dedicated entity in
  // the existing RBAC model). In a real backend these get their own
  // perm key — only Super admin can hit these in practice.
  update_marina_profile: { entity: "boater", action: "edit" },
  create_dock: { entity: "boater", action: "create" },
  update_dock: { entity: "boater", action: "edit" },
  update_pos_location: { entity: "boater", action: "edit" },
  create_pos_item: { entity: "boater", action: "create" },
  update_pos_item: { entity: "boater", action: "edit" },
  create_fee: { entity: "boater", action: "create" },
  update_fee: { entity: "boater", action: "edit" },
  // Batch B: comm templates + connections + roles + staff edit
  update_comm_template: { entity: "boater", action: "edit" },
  connect_provider: { entity: "boater", action: "edit" },
  disconnect_provider: { entity: "boater", action: "edit" },
  create_role: { entity: "boater", action: "create" },
  update_role: { entity: "boater", action: "edit" },
  update_staff: { entity: "boater", action: "edit" },
  // Batch C: entity edits + lifecycle
  update_boater: { entity: "boater", action: "edit" },
  update_vessel: { entity: "vessel", action: "edit" },
  update_contract: { entity: "contract", action: "edit" },
  terminate_contract: { entity: "contract", action: "edit" },
  update_reservation: { entity: "reservation", action: "edit" },
  cancel_reservation: { entity: "reservation", action: "edit" },
  send_for_signature: { entity: "contract", action: "edit" },
  // Batch D: bulk ops
  bulk_send_message: { entity: "broadcast", action: "create" },
  bulk_draft_renewals: { entity: "contract", action: "create" },
  bulk_apply_fee: { entity: "ledger", action: "create" },
  run_billing_run: { entity: "ledger", action: "create" },
  run_qb_sync: { entity: "ledger", action: "edit" },
  // Batch F: alerts (logged for now; no scheduler infra yet)
  create_threshold_rule: { entity: "boater", action: "edit" },

  // ── Holder portal actions ──────────────────────────────────────
  // Holders manage their own resources — these RBAC entries are
  // intentionally permissive. The /api/agent route is the real gate:
  // mode="holder" only ever exposes holder_* tools, never staff tools.
  holder_message_marina: { entity: "boater", action: "edit" },
  holder_request_work_order: { entity: "work_order", action: "create" },
  holder_schedule_pump_out: { entity: "work_order", action: "create" },
  holder_pay_balance: { entity: "ledger", action: "create" },
  holder_update_contact: { entity: "boater", action: "edit" },
  holder_add_card: { entity: "boater", action: "edit" },
  holder_remove_card: { entity: "boater", action: "edit" },
  holder_request_slip_change: { entity: "boater", action: "edit" },
  holder_request_termination: { entity: "contract", action: "edit" },
  holder_request_renewal_inquiry: { entity: "boater", action: "edit" },

  // ── Rental Club ────────────────────────────────────────────────
  create_club_subscription: { entity: "club_subscription", action: "create" },
  update_club_subscription: { entity: "club_subscription", action: "edit" },
  create_club_booking: { entity: "club_booking", action: "create" },
  // run_club_billing posts invoices, so it gates on ledger.create
  // rather than club_subscription.edit — accounting role can run it
  // even if they can't structurally edit subscriptions.
  run_club_billing: { entity: "ledger", action: "create" },
  // run_club_reactivation dispatches broadcast comms — gates on the
  // same entity used by bulk_send_message + notify_waitlist.
  run_club_reactivation: { entity: "broadcast", action: "create" },
  holder_request_club_booking: { entity: "club_booking", action: "create" },
  holder_cancel_club_booking: { entity: "club_booking", action: "edit" },

  // ── Services catalog parity wave ──
  // All gate on "boater" entity as a stand-in for "settings" — same
  // convention used by the other catalog ops (fees, POS, docks).
  create_club_plan: { entity: "boater", action: "create" },
  update_rate: { entity: "boater", action: "edit" },
  set_boat_club_rotation: { entity: "boater", action: "edit" },
  // No dedicated "rental_boat" RBAC entity yet — piggy-back on the
  // closest functional permission (boater/create) until we carve one out.
  create_rental_boat: { entity: "boater", action: "create" },
  create_meter_reading: { entity: "boater", action: "create" },
  create_slip: { entity: "boater", action: "create" },
  create_rental_group: { entity: "boater", action: "create" },
  create_rental_space: { entity: "boater", action: "create" },
  create_insurance_certificate: { entity: "boater", action: "create" },
  create_contract_template: { entity: "boater", action: "create" },
  // ── Back office (no dedicated RBAC entities yet — piggy-back on
  // boater/ledger as the closest fit). Tighten when we carve out
  // staff/vendor/inventory/asset capability keys.
  create_shift: { entity: "boater", action: "create" },
  run_payroll: { entity: "ledger", action: "create" },
  create_certification: { entity: "boater", action: "create" },
  create_vendor: { entity: "boater", action: "create" },
  create_bill: { entity: "ledger", action: "create" },
  pay_bill: { entity: "ledger", action: "create" },
  receive_stock: { entity: "ledger", action: "create" },
  create_asset: { entity: "boater", action: "create" },
  create_pm_schedule: { entity: "boater", action: "create" },
  run_pm_check: { entity: "work_order", action: "create" },
  // Round 2 — timecards + staff wage + stock adjustments. Piggy-back on
  // the same entity stand-ins until dedicated RBAC keys exist.
  approve_time_entry: { entity: "ledger", action: "create" },
  create_staff: { entity: "boater", action: "create" },
  update_staff_wage: { entity: "boater", action: "edit" },
  adjust_stock: { entity: "ledger", action: "create" },
  log_stock_loss: { entity: "ledger", action: "create" },
  // ── COI auto-renewal: writes the parsed metadata back to the cert.
  // Same RBAC stand-in as create_insurance_certificate (boater/edit).
  ingest_coi_pdf: { entity: "boater", action: "edit" },

  // ── PDF extraction (Vision wave) ──
  // create_vendor_bill_from_pdf gates like create_vendor_bill (ledger.create)
  // since approving the parse fires that mutation downstream.
  // extract_contract_terms is read-only against the PDF — gates on the
  // contract.create permission anyway since the natural follow-up is a
  // draft_contract action, and we want the same role enforcement.
  create_vendor_bill_from_pdf: { entity: "ledger", action: "create" },
  extract_contract_terms: { entity: "contract", action: "create" },

  // ── Wave 3 — lifecycle & money & quotes ─────────────────────────
  // RBAC keeps using the closest existing entity as a stand-in (we
  // haven't carved out dedicated quote/fuel permissions yet — the
  // settings work that adds those gets done alongside the page-level
  // catalog editor for them).
  mark_signed: { entity: "contract", action: "edit" },
  mark_invoice_paid: { entity: "ledger", action: "create" },
  update_insurance: { entity: "boater", action: "edit" },
  record_fuel_sale: { entity: "ledger", action: "create" },
  create_quote: { entity: "work_order", action: "edit" },
  update_quote: { entity: "work_order", action: "edit" },
  void_contract: { entity: "contract", action: "edit" },
  create_ledger_entry: { entity: "ledger", action: "create" },
  draft_contract: { entity: "contract", action: "create" },

  // ── Bulk operator actions (W3 wave) ──
  // RBAC lands on the most-restrictive matching entity for each: the
  // ledger.create gate keeps non-accounting roles out of bulk_charge,
  // contract.create gates the renewal sweep, and broadcast.create
  // mirrors the existing single-recipient send_message check.
  bulk_charge: { entity: "ledger", action: "create" },
  bulk_renew_contracts: { entity: "contract", action: "create" },
  bulk_send_comms: { entity: "broadcast", action: "create" },

  // ── Renewal Sweep Coordinator ──
  // Distinct from bulk_renew_contracts (one-click fan-out). These verbs
  // drive the long-lived /services/renewals coordinator surface. RBAC
  // mirrors bulk_renew_contracts on the create/launch side; per-item
  // updates ride on contract.edit since the items reference + mutate
  // contract artifacts.
  start_renewal_sweep: { entity: "contract", action: "create" },
  update_renewal_sweep_item: { entity: "contract", action: "edit" },
  launch_renewal_sweep: { entity: "contract", action: "create" },

  // ── Time Clock + Payroll Prep (W1 feature) ────────────────────
  // No dedicated "staff_time" RBAC entity yet — clock_in/out + adjust
  // piggy-back on the closest functional permission (boater.edit, the
  // same stand-in used by invite_staff / update_staff). close_payroll
  // gates on ledger.create like the existing run_payroll verb since
  // it commits money-touching totals.
  clock_in: { entity: "boater", action: "edit" },
  clock_out: { entity: "boater", action: "edit" },
  adjust_time_entry: { entity: "boater", action: "edit" },
  close_payroll_period: { entity: "ledger", action: "create" },

  // ── Vendor Bills (operator AP workflow) ──
  // All four gate on `ledger` since they're AP cash-side ops. Approve
  // + schedule + mark_paid in particular should be locked to roles
  // that can already touch the boater-side ledger.
  create_vendor_bill: { entity: "ledger", action: "create" },
  approve_vendor_bill: { entity: "ledger", action: "edit" },
  schedule_vendor_bill_payment: { entity: "ledger", action: "edit" },
  mark_vendor_bill_paid: { entity: "ledger", action: "create" },

  // ── Boater applications (public self-onboarding queue) ──
  // submit_application is operator/agent-initiated — public form
  // submissions hit applications.submit directly, not the agent
  // executor. No dedicated "application" RBAC entity yet — gate on
  // boater since approve mints a Boater + Vessel; the queue verbs
  // are the most-restrictive matching gate.
  submit_application: { entity: "boater", action: "create" },
  approve_application: { entity: "boater", action: "create" },
  decline_application: { entity: "boater", action: "edit" },
  route_application_to_waitlist: { entity: "boater", action: "edit" },

  // ── Navigation ──────────────────────────────────────────────
  // navigate_to has no domain side-effect — opening a page is privilege-free.
  // Gate on boater/view, which every role (including read_only) holds. The
  // audit row still gets written so we can see when the agent successfully
  // directed an operator vs. when they ignored the suggestion.
  navigate_to: { entity: "boater", action: "view" },

  // ── Registry-backed tools ──────────────────────────────────
  // Permissions for tools built via defineTool + registered in
  // lib/agent-tools/index.ts. The hand-written literal is what TS sees
  // (Record<AgentAction["kind"], …> requires every union member at
  // compile time); the spread below overlays the runtime registry on
  // top so a tool's own `permission` field stays the source of truth
  // for future updates. Keep both — the literal is the type witness,
  // the spread is the value.
  schedule_reminder: { entity: "broadcast", action: "create" },
  // Help-desk tickets are a build-side support channel — anyone with
  // a comms permission can open one. Reuses the "broadcast" entity
  // since it's a free-form outbound message.
  create_help_ticket: { entity: "broadcast", action: "create" },
  ...registeredToolPermissions(),
};

export type ExecResult =
  | { ok: true; createdId?: string }
  | { ok: false; reason: string };

// ────────────────────────────────────────────────────────────
// Convex routing layer (Phase 5)
// ────────────────────────────────────────────────────────────

/**
 * Agent actions whose execution Phase 5 has flipped to Convex.
 * Everything else continues to run via the mock client-store until its
 * page migration lands. See docs/architecture-convex.md → Phase 5 status.
 *
 * Wave 1 (kanban / reservations / comms):
 *   - update_work_order: highest-frequency agent verb; kanban needs
 *     realtime so other staff see the status change without refresh.
 *   - create_work_order: same realtime kanban argument + audit-log
 *     critical (every new WO is a billable artifact).
 *   - create_reservation: dock map occupancy needs the realtime push.
 *   - update_reservation: same.
 *   - send_message: audit-trail critical (compliance + customer comms
 *     are the most-replayed evidence in a dispute).
 *
 * Wave 2 (customer + money + ops):
 *   - update_boater / create_boater: roster realtime + audit on every
 *     customer-record change.
 *   - update_vessel: same — vessel rows are co-displayed with the
 *     boater roster and need the same realtime push.
 *   - update_contract: status flips drive the slip-occupancy state
 *     machine; needs to land server-side atomically.
 *   - charge_to_account: money-critical; the open invoice MUST land
 *     in the canonical ledger, not the in-memory mock.
 *   - request_coi_renewal: mints an upload token tied to a server
 *     record; mock path can't outlive a page refresh.
 *   - close_boat_rental: finalizes a billable transaction.
 *   - create_meter_reading: utility billing input — every reading is
 *     a future invoice line item.
 */
export const CONVEX_ROUTED_ACTIONS = [
  "update_work_order",
  "create_work_order",
  "create_reservation",
  "update_reservation",
  "send_message",
  "update_boater",
  "create_boater",
  "update_vessel",
  "update_contract",
  "charge_to_account",
  "request_coi_renewal",
  "close_boat_rental",
  "create_meter_reading",
  // Wave 3 — skipped-from-wave-2 + new lifecycle/money actions.
  //   - mark_signed: contract + quote signature stamps need to land
  //     server-side so the audit row + slip occupancy state stay
  //     consistent.
  //   - mark_invoice_paid: payment ledger entry application — same
  //     money-criticality argument as charge_to_account.
  //   - update_insurance: COI patches outlive a page refresh.
  //   - record_fuel_sale: fuel inventory + sale ledger row are
  //     read together on /services/gas — realtime push matters.
  //   - create_quote / update_quote: drafted on the work order
  //     detail page; status flips are immediately visible.
  //   - cancel_reservation: dock map occupancy push.
  //   - create_ledger_entry: manual money entry — audit-trail
  //     critical.
  //   - draft_contract / void_contract: contract lifecycle.
  "mark_signed",
  "mark_invoice_paid",
  "update_insurance",
  "record_fuel_sale",
  "create_quote",
  "update_quote",
  "void_contract",
  "cancel_reservation",
  "create_ledger_entry",
  "draft_contract",
  // W3 wave — bulk operator actions. These are new kinds with no
  // prior mock implementation; both paths (mock + Convex) live behind
  // the same action shape. The Convex side talks to the new
  // convex/bulkBilling.ts + bulkRenewals.ts + bulkComms.ts modules.
  "bulk_charge",
  "bulk_renew_contracts",
  "bulk_send_comms",
  // ── Time Clock + Payroll Prep (W1 feature) ──
  //   All four ride on the Convex dispatchers added in
  //   convex/agentActions.ts (clockInAgent / clockOutAgent /
  //   adjustTimeEntryAgent / closePayrollPeriodAgent). Audit lands
  //   inside convex/timeEntries.ts + convex/payroll.ts at the
  //   entity layer — the dispatchers just stamp via_agent.
  "clock_in",
  "clock_out",
  "adjust_time_entry",
  "close_payroll_period",
  // ── Vendor Bills (AP workflow) ──
  //   The 4 dispatchers each have a matching Convex mutation in
  //   convex/agentActions.ts that calls into convex/vendorBills.ts.
  //   Money-critical (mark_paid posts a ledger row) + audit-critical
  //   so the Convex path is the canonical path the moment it's wired.
  "create_vendor_bill",
  "approve_vendor_bill",
  "schedule_vendor_bill_payment",
  "mark_vendor_bill_paid",
  // ── PDF extraction (Vision wave) ──
  //   Both dispatchers in convex/agentActions.ts read the PDF bytes via
  //   Convex `_storage`, post to /api/pdf-extract, then return the
  //   typed extraction so the operator can review on the next render.
  //   Audit row is logged inside the Convex dispatcher so the mock path
  //   doesn't double-write.
  "create_vendor_bill_from_pdf",
  "extract_contract_terms",
  // ── Waitlist auto-offer cascade ──
  //   Each dispatcher lives in convex/agentActions.ts and delegates
  //   into convex/waitlist.ts (fireOffer / acceptOffer / declineOffer).
  //   Mock path mirrors via lib/client-store.ts → fireWaitlistOffer
  //   / acceptWaitlistOffer / declineWaitlistOffer.
  "fire_waitlist_offer",
  "accept_waitlist_offer",
  "decline_waitlist_offer",
  // ── Boater applications (public self-onboarding queue) ──
  //   submit_application is operator/agent-initiated; the public
  //   /apply form posts to applications.submit (Convex) directly so
  //   it never lands here. approve/decline/route mirror their
  //   per-entity mutations in convex/applications.ts.
  "submit_application",
  "approve_application",
  "decline_application",
  "route_application_to_waitlist",
  // ── Renewal Sweep Coordinator ──
  //   The 3 dispatchers in convex/agentActions.ts each delegate to a
  //   per-entity mutation in convex/renewalSweeps.ts. Audit lands
  //   server-side at the entity layer; the agent envelope adds the
  //   via_agent + agent_prompt provenance.
  "start_renewal_sweep",
  "update_renewal_sweep_item",
  "launch_renewal_sweep",
] as const satisfies readonly AgentAction["kind"][];

export type ConvexRoutedActionKind = (typeof CONVEX_ROUTED_ACTIONS)[number];

const CONVEX_ROUTED_SET = new Set<string>(CONVEX_ROUTED_ACTIONS);

/**
 * Mutation callbacks supplied by `lib/use-tenant-mutation.ts` (Phase 4
 * agent owns that file) when Convex is enabled. Each callback maps to a
 * Convex mutation in `convex/agentActions.ts`. The router only calls the
 * five we've migrated; missing fields are allowed for incremental rollout.
 *
 * The shape is intentionally narrow — a callback per migrated action —
 * so the executor doesn't have to know whether Convex is "fully wired"
 * vs. "partially wired". If a callback is missing, the router falls
 * through to the mock path for that one action.
 */
export interface ConvexAgentRouter {
  updateWorkOrder?: (args: {
    id: string;
    patch: Record<string, unknown>;
    agent_prompt?: string;
  }) => Promise<string>;
  createWorkOrder?: (args: {
    boater_id: string;
    subject: string;
    description?: string;
    activity_type?: string;
    priority?: string;
    vessel_id?: string;
    slip_id?: string;
    due_date?: string;
    assignee_user_id?: string;
    agent_prompt?: string;
  }) => Promise<string>;
  createReservation?: (args: {
    boater_id: string;
    slip_id: string;
    vessel_id?: string;
    arrival_date: string;
    departure_date: string;
    type: string;
    notes?: string;
    agent_prompt?: string;
  }) => Promise<string>;
  updateReservation?: (args: {
    id: string;
    patch: Record<string, unknown>;
    agent_prompt?: string;
  }) => Promise<string>;
  sendCommunication?: (args: {
    boater_id?: string;
    type: "email" | "sms" | "voice";
    subject?: string;
    body: string;
    agent_prompt?: string;
  }) => Promise<string>;
  // Wave 2 ─────────────────────────────────────────────────────
  updateBoater?: (args: {
    id: string;
    patch: {
      email?: string;
      phone?: string;
      preferred_channel?: "email" | "sms" | "voice";
      billing_cadence?: "annual" | "seasonal" | "monthly" | "transient";
      notes?: string;
      active?: boolean;
    };
    agent_prompt?: string;
  }) => Promise<string>;
  createBoater?: (args: {
    first_name: string;
    last_name: string;
    email?: string;
    phone?: string;
    preferred_channel: "email" | "sms" | "voice";
    billing_cadence: "annual" | "seasonal" | "monthly" | "transient";
    code?: string;
    notes?: string;
    agent_prompt?: string;
  }) => Promise<string>;
  updateVessel?: (args: {
    id: string;
    patch: Record<string, unknown>;
    agent_prompt?: string;
  }) => Promise<string>;
  updateContract?: (args: {
    id: string;
    patch: Record<string, unknown>;
    agent_prompt?: string;
  }) => Promise<string>;
  chargeToAccount?: (args: {
    boater_id: string;
    location_id: string;
    line: { name: string; price: number; sku: string };
    agent_prompt?: string;
  }) => Promise<string>;
  requestCoiRenewal?: (args: {
    id: string;
    agent_prompt?: string;
  }) => Promise<string>;
  closeBoatRental?: (args: {
    id: string;
    fuel_in_pct?: number;
    hours_in?: number;
    damage_notes?: string;
    damage_charge?: number;
    agent_prompt?: string;
  }) => Promise<string>;
  createMeterReading?: (args: {
    space_id: string;
    meter_number?: string;
    current_reading: number;
    unit?: "kWh" | "gallons";
    rate_per_unit?: number;
    agent_prompt?: string;
  }) => Promise<string>;
  // ── Wave 3 ─────────────────────────────────────────────────
  // Each callback under the hood calls a typed mutation in
  // `convex/agentActions.ts`. Optional — pages can wire them
  // incrementally just like wave 1/2.
  markSigned?: (args: {
    target_kind: "contract" | "quote";
    target_id: string;
    signed_by_name?: string;
    signed_at?: string;
    agent_prompt?: string;
  }) => Promise<string>;
  markInvoicePaid?: (args: {
    invoice_id: string;
    amount: number;
    method: "cash" | "check" | "ach" | "card";
    check_number?: string;
    notes?: string;
    agent_prompt?: string;
  }) => Promise<string>;
  updateInsurance?: (args: {
    id: string;
    patch: Record<string, unknown>;
    agent_prompt?: string;
  }) => Promise<string>;
  recordFuelSale?: (args: {
    fuel_type: "gasoline" | "diesel";
    gallons: number;
    price_per_gallon: number;
    payment_method: "card" | "cash" | "charge_to_account";
    boater_id?: string;
    sold_at?: string;
    agent_prompt?: string;
  }) => Promise<string>;
  createQuote?: (args: {
    work_order_id: string;
    line_items: Array<{
      kind: "part" | "labor" | "fee" | "discount";
      description: string;
      qty: number;
      unit_price: number;
      taxable: boolean;
    }>;
    tax_rate?: number;
    valid_until?: string;
    agent_prompt?: string;
  }) => Promise<string>;
  updateQuote?: (args: {
    id: string;
    line_items?: Array<{
      kind: "part" | "labor" | "fee" | "discount";
      description: string;
      qty: number;
      unit_price: number;
      taxable: boolean;
    }>;
    tax_rate?: number;
    agent_prompt?: string;
  }) => Promise<string>;
  voidContract?: (args: {
    id: string;
    reason?: string;
    agent_prompt?: string;
  }) => Promise<string>;
  cancelReservation?: (args: {
    id: string;
    reason?: string;
    agent_prompt?: string;
  }) => Promise<string>;
  createLedgerEntry?: (args: {
    boater_id: string;
    type: "invoice" | "credit" | "adjustment";
    amount: number;
    description: string;
    date?: string;
    notes?: string;
    agent_prompt?: string;
  }) => Promise<string>;
  draftContract?: (args: {
    boater_id: string;
    template_id: string;
    vessel_id?: string;
    slip_id?: string;
    effective_start: string;
    effective_end: string;
    annual_rate?: number;
    billing_cadence: "annual" | "seasonal" | "monthly" | "transient";
    notes?: string;
    agent_prompt?: string;
  }) => Promise<string>;
  // ── W3 wave — bulk operator actions ──
  // Each callback returns a JSON summary (count + total + first id) so
  // the action card can render the post-run toast. Mock path returns
  // the same shape; see runAction below.
  bulkCharge?: (args: {
    rule: "annual_due_this_month" | "monthly_installment" | "seasonal_due_this_month";
    period_ym: string;
    agent_prompt?: string;
  }) => Promise<string>;
  bulkRenewContracts?: (args: {
    days_out: number;
    rate_adjustment_pct?: number;
    agent_prompt?: string;
  }) => Promise<string>;
  bulkSendComms?: (args: {
    template_id: string;
    filter:
      | { kind: "all_boaters" }
      | { kind: "cadence"; cadence: "annual" | "seasonal" | "monthly" | "transient" }
      | { kind: "vessel_loa_over"; inches: number }
      | { kind: "has_open_balance" };
    agent_prompt?: string;
  }) => Promise<string>;
  // ── Vendor Bills (operator AP workflow) ───────────────────
  // Each maps 1:1 to a Convex mutation in convex/agentActions.ts.
  // Returns the created/updated bill id (or ledger id for mark_paid).
  createVendorBill?: (args: {
    vendor_id: string;
    vendor_invoice_number?: string;
    bill_date: string;
    due_date?: string;
    amount: number;
    tax_amount?: number;
    description?: string;
    line_items?: Array<{
      description: string;
      amount: number;
      gl_account?: string;
    }>;
    submit_as?: "draft" | "pending_approval";
    internal_notes?: string;
    agent_prompt?: string;
  }) => Promise<string>;
  approveVendorBill?: (args: {
    id: string;
    agent_prompt?: string;
  }) => Promise<string>;
  scheduleVendorBillPayment?: (args: {
    id: string;
    scheduled_payment_date: string;
    scheduled_payment_method: "ach" | "check" | "card" | "wire";
    agent_prompt?: string;
  }) => Promise<string>;
  markVendorBillPaid?: (args: {
    id: string;
    paid_at?: string;
    paid_via?: string;
    payment_method?: "ach" | "check" | "card" | "wire";
    agent_prompt?: string;
  }) => Promise<string>;
  // ── Time Clock + Payroll Prep (W1 feature) ───────────────────
  // Each maps 1:1 to a Convex mutation in convex/agentActions.ts.
  clockIn?: (args: {
    staff_id: string;
    source?: "mobile" | "web" | "manual";
    position?: string;
    agent_prompt?: string;
  }) => Promise<string>;
  clockOut?: (args: {
    time_entry_id: string;
    agent_prompt?: string;
  }) => Promise<string>;
  adjustTimeEntry?: (args: {
    time_entry_id: string;
    adjuster_staff_id: string;
    patch: {
      clock_in_at?: string;
      clock_out_at?: string;
      break_minutes?: number;
      notes?: string;
      position?: string;
    };
    agent_prompt?: string;
  }) => Promise<string>;
  closePayrollPeriod?: (args: {
    period_id: string;
    closer_staff_id: string;
    agent_prompt?: string;
  }) => Promise<string>;
  // ── PDF extraction (Vision wave) ───────────────────────────
  // Each maps 1:1 to a Convex action in convex/agentActions.ts. Both
  // return a synthetic "stage" id for the audit log; the actual
  // mutation (create_vendor_bill / draft_contract) fires AFTER the
  // operator confirms the extraction in the review UI.
  createVendorBillFromPdf?: (args: {
    pdf_storage_id: string;
    vendor_query?: string;
    agent_prompt?: string;
  }) => Promise<string>;
  extractContractTerms?: (args: {
    pdf_storage_id: string;
    boater_query?: string;
    agent_prompt?: string;
  }) => Promise<string>;
  // ── Waitlist auto-offer cascade ───────────────────────────
  // Each maps 1:1 to a mutation in convex/agentActions.ts which
  // delegates into convex/waitlist.ts. fireOffer returns the batch
  // id (so the UI can deep-link to the cohort); accept/decline
  // return the entry id.
  fireWaitlistOffer?: (args: {
    slip_id: string;
    entry_ids: string[];
    expires_hours?: number;
    agent_prompt?: string;
  }) => Promise<string>;
  acceptWaitlistOffer?: (args: {
    offer_token: string;
    agent_prompt?: string;
  }) => Promise<string>;
  declineWaitlistOffer?: (args: {
    offer_token: string;
    auto_advance?: boolean;
    agent_prompt?: string;
  }) => Promise<string>;
  // ── Boater applications (public self-onboarding queue) ──
  submitApplication?: (args: {
    applicant_first_name: string;
    applicant_last_name: string;
    applicant_email: string;
    applicant_phone: string;
    applicant_address?: string;
    vessel_name: string;
    vessel_year?: number;
    vessel_make: string;
    vessel_model: string;
    vessel_loa_inches: number;
    vessel_beam_inches?: number;
    vessel_draft_inches?: number;
    preferred_slip_class?: "covered" | "uncovered" | "T-head" | "buoy" | "dry";
    preferred_dock?: string;
    desired_start_date?: string;
    notes?: string;
    agent_prompt?: string;
  }) => Promise<string>;
  approveApplication?: (args: {
    id: string;
    agent_prompt?: string;
  }) => Promise<string>;
  declineApplication?: (args: {
    id: string;
    internal_review_notes?: string;
    agent_prompt?: string;
  }) => Promise<string>;
  routeApplicationToWaitlist?: (args: {
    id: string;
    agent_prompt?: string;
  }) => Promise<string>;
  // ── Renewal Sweep Coordinator ───────────────────────────────
  // Each maps 1:1 to a mutation in convex/agentActions.ts which
  // delegates into convex/renewalSweeps.ts. start returns the new
  // sweep id; update returns the item id; launch returns a JSON
  // summary string ({sweep_id, drafted}).
  startRenewalSweep?: (args: {
    name: string;
    window_start: string;
    window_end: string;
    default_rate_adjustment_pct: number;
    source_contract_ids: string[];
    notes?: string;
    agent_prompt?: string;
  }) => Promise<string>;
  updateRenewalSweepItem?: (args: {
    item_id: string;
    patch: {
      priority?: "high" | "normal" | "low";
      rate_adjustment_pct?: number | null;
      status?: "pending" | "withdrawn";
      internal_notes?: string;
    };
    agent_prompt?: string;
  }) => Promise<string>;
  launchRenewalSweep?: (args: {
    sweep_id: string;
    agent_prompt?: string;
  }) => Promise<string>;
}

/**
 * Returns true when this action kind has a Convex implementation AND the
 * router supplied the matching callback. Callers use this to decide
 * whether to await the Convex mutation OR fall through to the
 * synchronous mock path.
 */
export function isConvexRouted(
  action: AgentAction,
  router?: ConvexAgentRouter,
): boolean {
  if (!router) return false;
  if (!CONVEX_ROUTED_SET.has(action.kind)) return false;
  if (action.kind === "update_work_order") return !!router.updateWorkOrder;
  if (action.kind === "create_work_order") return !!router.createWorkOrder;
  if (action.kind === "create_reservation") return !!router.createReservation;
  if (action.kind === "update_reservation") return !!router.updateReservation;
  if (action.kind === "send_message") return !!router.sendCommunication;
  if (action.kind === "update_boater") return !!router.updateBoater;
  if (action.kind === "create_boater") return !!router.createBoater;
  if (action.kind === "update_vessel") return !!router.updateVessel;
  if (action.kind === "update_contract") return !!router.updateContract;
  if (action.kind === "charge_to_account") return !!router.chargeToAccount;
  if (action.kind === "request_coi_renewal") return !!router.requestCoiRenewal;
  if (action.kind === "close_boat_rental") return !!router.closeBoatRental;
  if (action.kind === "create_meter_reading") return !!router.createMeterReading;
  // Wave 3
  if (action.kind === "mark_signed") return !!router.markSigned;
  if (action.kind === "mark_invoice_paid") return !!router.markInvoicePaid;
  if (action.kind === "update_insurance") return !!router.updateInsurance;
  if (action.kind === "record_fuel_sale") return !!router.recordFuelSale;
  if (action.kind === "create_quote") return !!router.createQuote;
  if (action.kind === "update_quote") return !!router.updateQuote;
  if (action.kind === "void_contract") return !!router.voidContract;
  if (action.kind === "cancel_reservation") return !!router.cancelReservation;
  if (action.kind === "create_ledger_entry") return !!router.createLedgerEntry;
  if (action.kind === "draft_contract") return !!router.draftContract;
  // W3 wave — bulk operator actions
  if (action.kind === "bulk_charge") return !!router.bulkCharge;
  if (action.kind === "bulk_renew_contracts") return !!router.bulkRenewContracts;
  if (action.kind === "bulk_send_comms") return !!router.bulkSendComms;
  // Vendor Bills
  if (action.kind === "create_vendor_bill") return !!router.createVendorBill;
  if (action.kind === "approve_vendor_bill") return !!router.approveVendorBill;
  if (action.kind === "schedule_vendor_bill_payment")
    return !!router.scheduleVendorBillPayment;
  if (action.kind === "mark_vendor_bill_paid")
    return !!router.markVendorBillPaid;
  // Time Clock + Payroll Prep (W1 feature)
  if (action.kind === "clock_in") return !!router.clockIn;
  if (action.kind === "clock_out") return !!router.clockOut;
  if (action.kind === "adjust_time_entry") return !!router.adjustTimeEntry;
  if (action.kind === "close_payroll_period")
    return !!router.closePayrollPeriod;
  // PDF extraction
  if (action.kind === "create_vendor_bill_from_pdf")
    return !!router.createVendorBillFromPdf;
  if (action.kind === "extract_contract_terms")
    return !!router.extractContractTerms;
  // Waitlist auto-offer cascade
  if (action.kind === "fire_waitlist_offer") return !!router.fireWaitlistOffer;
  if (action.kind === "accept_waitlist_offer")
    return !!router.acceptWaitlistOffer;
  if (action.kind === "decline_waitlist_offer")
    return !!router.declineWaitlistOffer;
  // Boater applications (public self-onboarding queue)
  if (action.kind === "submit_application") return !!router.submitApplication;
  if (action.kind === "approve_application") return !!router.approveApplication;
  if (action.kind === "decline_application") return !!router.declineApplication;
  if (action.kind === "route_application_to_waitlist")
    return !!router.routeApplicationToWaitlist;
  // Renewal Sweep Coordinator
  if (action.kind === "start_renewal_sweep") return !!router.startRenewalSweep;
  if (action.kind === "update_renewal_sweep_item")
    return !!router.updateRenewalSweepItem;
  if (action.kind === "launch_renewal_sweep")
    return !!router.launchRenewalSweep;
  return false;
}

/**
 * Validate a cleaning back-reference before stamping it onto a new
 * cleaning WO. Returns the same {kind,id} pair when the referenced
 * source exists; returns undefined to silently degrade when the id is
 * phantom — preferable to writing a back-pointer that deep-links to
 * nothing. paid_rental rows live in the live store (not addressable
 * here), so we accept those at face value for now; Convex will close
 * the loop server-side.
 */
function validateCleaningSource(
  kind: "club_booking" | "paid_rental",
  id: string,
): { kind: "club_booking" | "paid_rental"; id: string } | undefined {
  if (kind === "club_booking") {
    return CLUB_BOOKINGS.some((b) => b.id === id) ? { kind, id } : undefined;
  }
  return { kind, id };
}

/**
 * Resolve the tenant that owns an agent action's target. Used by the
 * cross-tenant guard in executeAgentAction to reject mutations that
 * would touch a different marina's data than the one staff is
 * currently viewing.
 *
 * Returns undefined when:
 *   - The action creates a NEW record (no existing target to scope)
 *   - The target can't be resolved (boater not found, etc.)
 *   - The action doesn't carry a tenant-anchored target id
 *
 * In all those cases the guard falls through, since there's nothing
 * to compare against. Defense-in-depth — the RBAC check above is the
 * first line.
 */
function resolveActionTenantId(action: AgentAction): string | undefined {
  // Helper: resolve via a known boater_id.
  function tenantForBoater(boaterId: string): string | undefined {
    const b = BOATERS.find((x) => x.id === boaterId);
    return b?.tenant_id ?? SEED_TENANT_ID;
  }

  // Anything keyed off boater_id directly — most update_/charge_/send_
  // actions land here. The discriminated-union narrowing isn't worth
  // the type churn since we use runtime access.
  const a = action as AgentAction & {
    boater_id?: string;
    target_boater_id?: string;
  };
  if (a.boater_id) return tenantForBoater(a.boater_id);
  if (a.target_boater_id) return tenantForBoater(a.target_boater_id);

  // create_* actions don't have an existing target — no scope to
  // resolve. The new record inherits the active tenant by convention
  // via the mutators (addBoater stamps currentTenantId, etc.).
  return undefined;
}

/**
 * Run the gates that apply to every agent action — RBAC + cross-tenant
 * guard. Returns `null` when both pass; returns an ExecResult error when
 * one fails. Extracted from executeAgentAction so the sync + async
 * variants share identical pre-flight checks.
 */
function preflightAction(action: AgentAction, role?: Role): ExecResult | null {
  if (role) {
    const perm = ACTION_PERMISSION[action.kind];
    if (perm && !can(role, perm.action, perm.entity)) {
      return {
        ok: false,
        reason: `${ROLE_META[role].label} can't ${perm.action} ${perm.entity.replace("_", " ")}s. Switch role in the top bar.`,
      };
    }
  }
  if (!action.kind.startsWith("holder_")) {
    const targetTenantId = resolveActionTenantId(action);
    const activeTenantId = getCurrentTenantId();
    if (
      targetTenantId &&
      activeTenantId &&
      targetTenantId !== activeTenantId
    ) {
      return {
        ok: false,
        reason: `Cross-tenant action blocked — target belongs to a different marina than the one you're viewing. Switch tenant first.`,
      };
    }
  }
  return null;
}

/**
 * Synchronous execution against the mock client-store. The audit-log
 * row gets written here via `logAuditLocal` so the local /settings/audit-log
 * surface stays populated even when the demo is the only path live.
 */
export function executeAgentAction(action: AgentAction, role?: Role): ExecResult {
  // RBAC: defense-in-depth — even if a tool slips past the prompt-side filter,
  // the executor refuses the mutation.
  const gate = preflightAction(action, role);
  if (gate) return gate;

  const createdId = runAction(action);

  // Audit — local-only path. When Convex is online, executeAgentActionAsync
  // skips this branch since the Convex mutation (convex/agentActions.ts)
  // writes the audit row at the entity layer with `via_agent: true`.
  // This guarantees exactly-once audit semantics: mock path → logAuditLocal;
  // Convex path → logAudit (server-side). Never both.
  const perm = ACTION_PERMISSION[action.kind];
  logAuditLocal({
    actor_label: role ? ROLE_META[role].label : "Marina Stee Operator",
    action_type: `${perm?.entity ?? "unknown"}.${action.kind}`,
    target_entity: perm?.entity ?? "unknown",
    target_id: createdId,
    payload_delta: JSON.stringify(actionPayloadSummary(action)),
    via_agent: true,
    agent_prompt: action.label,
  });

  return { ok: true, createdId };
}

/**
 * Async variant that routes the five Phase 5 migrated actions to Convex
 * when a router is supplied AND the matching callback exists. Falls
 * through to the synchronous mock path for everything else.
 *
 * Audit semantics: when Convex handles the action, the convex/agentActions.ts
 * dispatcher writes the audit row server-side (with via_agent: true).
 * This function does NOT call logAuditLocal in that branch — that would
 * be a double-write. For the fall-through path it delegates to
 * executeAgentAction which writes the local audit row as today.
 *
 * Call sites: `lib/use-tenant-mutation.ts` (owned by the Phase 4 agent)
 * wires the React hooks into a ConvexAgentRouter object and passes it
 * here from the action-card "Approve" handler.
 */
export async function executeAgentActionAsync(
  action: AgentAction,
  options: { role?: Role; router?: ConvexAgentRouter } = {},
): Promise<ExecResult> {
  const { role, router } = options;
  const gate = preflightAction(action, role);
  if (gate) return gate;

  // Convex path — only for the five migrated actions when a callback
  // is supplied. Everything else falls through.
  if (router && isConvexRouted(action, router)) {
    try {
      const createdId = await runConvexAction(action, router);
      return { ok: true, createdId };
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Convex mutation failed (unknown error)";
      return { ok: false, reason: message };
    }
  }

  // Mock path — same behavior as the synchronous executor.
  return executeAgentAction(action, role);
}

/**
 * Dispatch a Phase 5 migrated action through Convex. Each branch calls
 * the matching `ConvexAgentRouter` callback (which under the hood calls
 * the typed mutation from `convex/agentActions.ts`).
 *
 * `action.label` becomes `agent_prompt` on the audit row — that's the
 * operator-facing summary of the prompt, which is what `executeAgentAction`
 * already stores locally.
 */
async function runConvexAction(
  action: AgentAction,
  router: ConvexAgentRouter,
): Promise<string | undefined> {
  if (action.kind === "update_work_order" && router.updateWorkOrder) {
    const { assignee_name, ...rest } = action.patch;
    // Mirror the mock branch's USERS lookup so the Convex path stamps
    // the same assignee_user_id field. Without this, the agent-emitted
    // "J. Reyes" would land verbatim on the Convex row, where every
    // other read assumes assignee_user_id is a stable id.
    let assigneeUserId: string | undefined;
    if (assignee_name) {
      const t = assignee_name.toLowerCase().trim();
      const user =
        USERS.find((u) => u.name.toLowerCase() === t) ??
        USERS.find((u) => u.name.toLowerCase().includes(t)) ??
        USERS.find((u) => {
          const [lastRaw, firstRaw] = u.name.split(",");
          const last = (lastRaw ?? "").trim().toLowerCase();
          const first = (firstRaw ?? "").trim().toLowerCase();
          return t.includes(last) || t.includes(first);
        });
      assigneeUserId = user?.id;
    }
    const patch: Record<string, unknown> = { ...rest };
    if (assigneeUserId) patch.assignee_user_id = assigneeUserId;
    return await router.updateWorkOrder({
      id: action.work_order_id,
      patch,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "create_work_order" && router.createWorkOrder) {
    return await router.createWorkOrder({
      boater_id: action.boater_id,
      subject: action.subject,
      description: action.description,
      activity_type: action.activity_type,
      priority: action.priority,
      vessel_id: action.vessel_id,
      slip_id: action.slip_id,
      due_date: action.due_date,
      assignee_user_id: action.assignee_user_id,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "create_reservation" && router.createReservation) {
    return await router.createReservation({
      boater_id: action.boater_id,
      slip_id: action.slip_id,
      vessel_id: action.vessel_id,
      arrival_date: action.arrival_date,
      departure_date: action.departure_date,
      type: action.type,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "update_reservation" && router.updateReservation) {
    return await router.updateReservation({
      id: action.reservation_id,
      patch: action.patch as Record<string, unknown>,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "send_message" && router.sendCommunication) {
    return await router.sendCommunication({
      boater_id: action.boater_id,
      type: action.type,
      subject: action.subject,
      body: action.body,
      agent_prompt: action.label,
    });
  }

  // ── Wave 2 dispatch ────────────────────────────────────────

  if (action.kind === "update_boater" && router.updateBoater) {
    return await router.updateBoater({
      id: action.boater_id,
      patch: action.patch,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "create_boater" && router.createBoater) {
    return await router.createBoater({
      first_name: action.first_name,
      last_name: action.last_name,
      email: action.email,
      phone: action.phone,
      preferred_channel: action.preferred_channel,
      billing_cadence: action.billing_cadence,
      code: action.code,
      notes: action.notes,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "update_vessel" && router.updateVessel) {
    return await router.updateVessel({
      id: action.vessel_id,
      patch: action.patch as Record<string, unknown>,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "update_contract" && router.updateContract) {
    // Normalize the contract status union — the agent type carries a
    // superset (partially_signed / executed / renewed) that the Convex
    // schema doesn't model yet. Map known equivalents; drop unknowns
    // so the patch lands without status churn rather than rejecting.
    const { status, ...rest } = action.patch;
    const patch: Record<string, unknown> = { ...rest };
    if (status !== undefined) {
      const normalized =
        status === "executed"
          ? "signed"
          : status === "partially_signed"
            ? "sent"
            : status === "renewed"
              ? "active"
              : status;
      // After mapping, only forward statuses Convex understands.
      if (
        normalized === "draft" ||
        normalized === "sent" ||
        normalized === "signed" ||
        normalized === "active" ||
        normalized === "expired" ||
        normalized === "terminated"
      ) {
        patch.status = normalized;
      }
    }
    return await router.updateContract({
      id: action.contract_id,
      patch,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "charge_to_account" && router.chargeToAccount) {
    return await router.chargeToAccount({
      boater_id: action.boater_id,
      location_id: action.location_id,
      line: action.line,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "request_coi_renewal" && router.requestCoiRenewal) {
    return await router.requestCoiRenewal({
      id: action.coi_id,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "close_boat_rental" && router.closeBoatRental) {
    return await router.closeBoatRental({
      id: action.rental_id,
      fuel_in_pct: action.fuel_in_pct,
      hours_in: action.hours_in,
      damage_notes: action.damage_notes,
      damage_charge: action.damage_charge,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "create_meter_reading" && router.createMeterReading) {
    return await router.createMeterReading({
      space_id: action.space_id,
      meter_number: action.meter_number,
      current_reading: action.current_reading,
      unit: action.unit,
      rate_per_unit: action.rate_per_unit,
      agent_prompt: action.label,
    });
  }

  // ── Wave 3 dispatch ────────────────────────────────────────

  if (action.kind === "mark_signed" && router.markSigned) {
    return await router.markSigned({
      target_kind: action.target_kind,
      target_id: action.target_id,
      signed_by_name: action.signed_by_name,
      signed_at: action.signed_at,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "mark_invoice_paid" && router.markInvoicePaid) {
    return await router.markInvoicePaid({
      invoice_id: action.invoice_id,
      amount: action.amount,
      method: action.method,
      check_number: action.check_number,
      notes: action.notes,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "update_insurance" && router.updateInsurance) {
    return await router.updateInsurance({
      id: action.coi_id,
      patch: action.patch as Record<string, unknown>,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "record_fuel_sale" && router.recordFuelSale) {
    return await router.recordFuelSale({
      fuel_type: action.fuel_type,
      gallons: action.gallons,
      price_per_gallon: action.price_per_gallon,
      payment_method: action.payment_method,
      boater_id: action.boater_id,
      sold_at: action.sold_at,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "create_quote" && router.createQuote) {
    return await router.createQuote({
      work_order_id: action.work_order_id,
      line_items: action.line_items,
      tax_rate: action.tax_rate,
      valid_until: action.valid_until,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "update_quote" && router.updateQuote) {
    return await router.updateQuote({
      id: action.quote_id,
      line_items: action.patch.line_items,
      tax_rate: action.patch.tax_rate,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "void_contract" && router.voidContract) {
    return await router.voidContract({
      id: action.contract_id,
      reason: action.reason,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "cancel_reservation" && router.cancelReservation) {
    return await router.cancelReservation({
      id: action.reservation_id,
      reason: action.reason,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "create_ledger_entry" && router.createLedgerEntry) {
    return await router.createLedgerEntry({
      boater_id: action.boater_id,
      type: action.type,
      amount: action.amount,
      description: action.description,
      date: action.date,
      notes: action.notes,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "draft_contract" && router.draftContract) {
    return await router.draftContract({
      boater_id: action.boater_id,
      template_id: action.template_id,
      vessel_id: action.vessel_id,
      slip_id: action.slip_id,
      effective_start: action.effective_start,
      effective_end: action.effective_end,
      annual_rate: action.annual_rate,
      billing_cadence: action.billing_cadence,
      notes: action.notes,
      agent_prompt: action.label,
    });
  }

  // ── W3 wave — bulk operator actions ──
  if (action.kind === "bulk_charge" && router.bulkCharge) {
    return await router.bulkCharge({
      rule: action.rule,
      period_ym: action.period_ym,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "bulk_renew_contracts" && router.bulkRenewContracts) {
    return await router.bulkRenewContracts({
      days_out: action.days_out,
      rate_adjustment_pct: action.rate_adjustment_pct,
      agent_prompt: action.label,
    });
  }

  if (action.kind === "bulk_send_comms" && router.bulkSendComms) {
    return await router.bulkSendComms({
      template_id: action.template_id,
      filter: action.filter,
      agent_prompt: action.label,
    });
  }

  // ── Vendor Bills (operator AP workflow) ──
  if (action.kind === "create_vendor_bill" && router.createVendorBill) {
    return await router.createVendorBill({
      vendor_id: action.vendor_id,
      vendor_invoice_number: action.vendor_invoice_number,
      bill_date: action.bill_date,
      due_date: action.due_date,
      amount: action.amount,
      tax_amount: action.tax_amount,
      description: action.description,
      line_items: action.line_items,
      submit_as: action.submit_as,
      internal_notes: action.internal_notes,
      agent_prompt: action.label,
    });
  }
  if (action.kind === "approve_vendor_bill" && router.approveVendorBill) {
    return await router.approveVendorBill({
      id: action.vendor_bill_id,
      agent_prompt: action.label,
    });
  }
  if (
    action.kind === "schedule_vendor_bill_payment" &&
    router.scheduleVendorBillPayment
  ) {
    return await router.scheduleVendorBillPayment({
      id: action.vendor_bill_id,
      scheduled_payment_date: action.scheduled_payment_date,
      scheduled_payment_method: action.scheduled_payment_method,
      agent_prompt: action.label,
    });
  }
  if (action.kind === "mark_vendor_bill_paid" && router.markVendorBillPaid) {
    return await router.markVendorBillPaid({
      id: action.vendor_bill_id,
      paid_at: action.paid_at,
      paid_via: action.paid_via,
      payment_method: action.payment_method,
      agent_prompt: action.label,
    });
  }
  // ── Time Clock + Payroll Prep (W1 feature) ────────────────────
  if (action.kind === "clock_in" && router.clockIn) {
    return await router.clockIn({
      staff_id: action.staff_id,
      position: action.position,
      agent_prompt: action.label,
    });
  }
  if (action.kind === "clock_out" && router.clockOut && action.time_entry_id) {
    return await router.clockOut({
      time_entry_id: action.time_entry_id,
      agent_prompt: action.label,
    });
  }
  if (action.kind === "adjust_time_entry" && router.adjustTimeEntry) {
    return await router.adjustTimeEntry({
      time_entry_id: action.time_entry_id,
      adjuster_staff_id: action.adjuster_staff_id,
      patch: action.patch,
      agent_prompt: action.label,
    });
  }
  if (action.kind === "close_payroll_period" && router.closePayrollPeriod) {
    return await router.closePayrollPeriod({
      period_id: action.period_id,
      closer_staff_id: action.closer_staff_id,
      agent_prompt: action.label,
    });
  }
  // ── PDF extraction (Vision wave) ───────────────────────────
  if (
    action.kind === "create_vendor_bill_from_pdf" &&
    router.createVendorBillFromPdf
  ) {
    return await router.createVendorBillFromPdf({
      pdf_storage_id: action.pdf_storage_id,
      vendor_query: action.vendor_query,
      agent_prompt: action.label,
    });
  }
  if (action.kind === "extract_contract_terms" && router.extractContractTerms) {
    return await router.extractContractTerms({
      pdf_storage_id: action.pdf_storage_id,
      boater_query: action.boater_query,
      agent_prompt: action.label,
    });
  }

  // ── Waitlist auto-offer cascade ──
  if (action.kind === "fire_waitlist_offer" && router.fireWaitlistOffer) {
    return await router.fireWaitlistOffer({
      slip_id: action.slip_id,
      entry_ids: action.entry_ids,
      expires_hours: action.expires_hours,
      agent_prompt: action.label,
    });
  }
  if (action.kind === "accept_waitlist_offer" && router.acceptWaitlistOffer) {
    return await router.acceptWaitlistOffer({
      offer_token: action.offer_token,
      agent_prompt: action.label,
    });
  }
  if (action.kind === "decline_waitlist_offer" && router.declineWaitlistOffer) {
    return await router.declineWaitlistOffer({
      offer_token: action.offer_token,
      auto_advance: action.auto_advance,
      agent_prompt: action.label,
    });
  }
  // ── Boater applications (public self-onboarding queue) ──
  if (action.kind === "submit_application" && router.submitApplication) {
    return await router.submitApplication({
      applicant_first_name: action.applicant_first_name,
      applicant_last_name: action.applicant_last_name,
      applicant_email: action.applicant_email,
      applicant_phone: action.applicant_phone,
      applicant_address: action.applicant_address,
      vessel_name: action.vessel_name,
      vessel_year: action.vessel_year,
      vessel_make: action.vessel_make,
      vessel_model: action.vessel_model,
      vessel_loa_inches: action.vessel_loa_inches,
      vessel_beam_inches: action.vessel_beam_inches,
      vessel_draft_inches: action.vessel_draft_inches,
      preferred_slip_class: action.preferred_slip_class,
      preferred_dock: action.preferred_dock,
      desired_start_date: action.desired_start_date,
      notes: action.notes,
      agent_prompt: action.label,
    });
  }
  if (action.kind === "approve_application" && router.approveApplication) {
    return await router.approveApplication({
      id: action.application_id,
      agent_prompt: action.label,
    });
  }
  if (action.kind === "decline_application" && router.declineApplication) {
    return await router.declineApplication({
      id: action.application_id,
      internal_review_notes: action.internal_review_notes,
      agent_prompt: action.label,
    });
  }
  if (
    action.kind === "route_application_to_waitlist" &&
    router.routeApplicationToWaitlist
  ) {
    return await router.routeApplicationToWaitlist({
      id: action.application_id,
      agent_prompt: action.label,
    });
  }

  // ── Renewal Sweep Coordinator ──
  if (action.kind === "start_renewal_sweep" && router.startRenewalSweep) {
    return await router.startRenewalSweep({
      name: action.name,
      window_start: action.window_start,
      window_end: action.window_end,
      default_rate_adjustment_pct: action.default_rate_adjustment_pct,
      source_contract_ids: action.source_contract_ids,
      notes: action.notes,
      agent_prompt: action.label,
    });
  }
  if (
    action.kind === "update_renewal_sweep_item" &&
    router.updateRenewalSweepItem
  ) {
    return await router.updateRenewalSweepItem({
      item_id: action.item_id,
      patch: action.patch,
      agent_prompt: action.label,
    });
  }
  if (action.kind === "launch_renewal_sweep" && router.launchRenewalSweep) {
    return await router.launchRenewalSweep({
      sweep_id: action.sweep_id,
      agent_prompt: action.label,
    });
  }

  // Should be unreachable given the isConvexRouted gate, but the type
  // system can't prove that — return undefined to fall back cleanly.
  return undefined;
}

/**
 * Reduce the AgentAction discriminated union to a compact JSON-friendly
 * summary for audit storage. Strip large freeform fields (full message
 * bodies) and keep just enough to render the audit row.
 */
function actionPayloadSummary(action: AgentAction): Record<string, unknown> {
  // Cherry-pick fields without ever including raw PII like emails/phones.
  const summary: Record<string, unknown> = { kind: action.kind };
  // Iterate through known string/number fields without dumping the
  // whole object (large send_message bodies, etc.)
  for (const [k, v] of Object.entries(action)) {
    if (k === "kind" || k === "label") continue;
    if (typeof v === "string" && v.length < 80) summary[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") summary[k] = v;
    // arrays / objects / long strings get a length signal only
    else if (Array.isArray(v)) summary[k] = `[${v.length}]`;
    else if (typeof v === "string") summary[k] = `${v.slice(0, 60)}…`;
  }
  return summary;
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

    // Auto-receipt + outbound dispatch
    const preferredChannel = boater.communication_prefs.preferred_channel;
    const recipient =
      preferredChannel === "email"
        ? boater.primary_contact.email ?? "—"
        : boater.primary_contact.phone ?? "—";
    const receiptBody = `Charged ${formatMoney(total)} for ${action.line.name} to your account.`;
    const receipt: Communication = {
      id: `cm_agent_${Date.now()}`,
      boater_id: boater.id,
      type: preferredChannel,
      direction: "outbound",
      subject: `Marina Stee Receipt — ${location.name}`,
      body_preview: receiptBody,
      sender_label: "Marina Stee Agent",
      sender_is_system: true,
      recipient,
      sent_at: now,
      status: "delivered",
      related_entity: { type: "invoice", id: orderId },
    };
    addCommunication(receipt);
    if (recipient !== "—" && preferredChannel !== "voice") {
      void fetch("/api/comms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: preferredChannel,
          to: recipient,
          subject: receipt.subject,
          body: receiptBody,
        }),
      }).catch(() => {});
    }
    return;
  }

  if (action.kind === "create_work_order") {
    // Adopted from DockLog's recurrence engine — compute the next
    // spawn date inline when the operator flags this WO as recurring.
    // Keeps the WO and its successor on the same anchor date instead
    // of drifting whenever the cron actually fires.
    const workClass = action.work_class ?? "service";
    const isRecurring = action.is_recurring ?? false;
    const recurringSchedule = action.recurring_schedule;
    let recurringNextDate: string | undefined;
    if (isRecurring && action.start_date && recurringSchedule) {
      recurringNextDate = nextRecurringDate(
        action.start_date,
        recurringSchedule,
      );
    }

    // Cleaning WOs always carry a checklist — if the operator left it
    // empty, seed from the canonical default so the WO detail view has
    // rows to render.
    let checklist = action.checklist?.map((c) => ({ ...c }));
    if (workClass === "cleaning" && (!checklist || checklist.length === 0)) {
      checklist = DEFAULT_CLEANING_CHECKLIST.map((c) => ({ ...c }));
    }

    // Cleaning WOs ride on either a ClubBooking or a paid BoatRental.
    // The back-reference now lives on two dedicated WorkOrder columns
    // (`cleaning_source_kind` + `cleaning_source_id`) — that's what the
    // booking surfaces filter on to show the "Cleaning · open/done"
    // chip. We still write the legacy `Source: <label> <id>` prefix on
    // `internal_notes` for back-compat: operators may have edited those
    // lines on existing WOs and reading them out via a structured field
    // doesn't migrate the old data.
    let internalNotes = action.internal_notes;
    // Validate the cleaning back-reference. When a phantom id is
    // passed (agent hallucination, stale ref, typo), drop the link
    // silently rather than stamping a back-reference to a nonexistent
    // booking. The wizard validates at the UI layer; this is defense
    // for the LLM-driven path. paid_rental rentals live in the live
    // store and aren't reachable from this module today — Convex will
    // tighten that side server-side.
    const sourceCandidate =
      workClass === "cleaning" &&
      action.cleaning_source_kind &&
      action.cleaning_source_id
        ? validateCleaningSource(
            action.cleaning_source_kind,
            action.cleaning_source_id,
          )
        : undefined;
    const cleaningSourceKind = sourceCandidate?.kind;
    const cleaningSourceId = sourceCandidate?.id;
    if (cleaningSourceKind && cleaningSourceId) {
      const sourceLabel =
        cleaningSourceKind === "club_booking"
          ? "Club booking"
          : "Paid rental";
      const sourceLine = `Source: ${sourceLabel} ${cleaningSourceId}`;
      internalNotes = internalNotes
        ? `${sourceLine}\n${internalNotes}`
        : sourceLine;
    }

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
      work_class: workClass,
      assignee_user_id: action.assignee_user_id,
      start_date: action.start_date,
      end_date: action.end_date,
      due_date: action.due_date,
      activity_type: action.activity_type ?? "other",
      estimated_total: action.estimated_total,
      estimated_hours: action.estimated_hours,
      is_recurring: isRecurring || undefined,
      recurring_schedule: isRecurring ? recurringSchedule : undefined,
      recurring_next_date: recurringNextDate,
      checklist,
      internal_notes: internalNotes,
      cleaning_source_kind: cleaningSourceKind,
      cleaning_source_id: cleaningSourceId,
      attachment_ids:
        action.attachment_ids && action.attachment_ids.length > 0
          ? action.attachment_ids
          : undefined,
      // Closes the existing audit-gap on staff-initiated WOs: the
      // holder_portal branch already stamps via/at, so do the same on
      // the staff path so kanban filters by origin work uniformly.
      submitted_via: "staff",
      submitted_at: new Date().toISOString(),
    };
    addWorkOrder(wo);
    // Return the new WO id so executeAgentAction surfaces `createdId`.
    // The recurring-cleaning walker relies on this — without it, the
    // RecurringSource marker never gets stamped and the prior WO's
    // anchor never advances, so every cron tick re-spawns the same job.
    return wo.id;
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
      attached_fee_ids:
        action.attached_fee_ids && action.attached_fee_ids.length > 0
          ? action.attached_fee_ids
          : undefined,
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
      attached_fee_ids:
        action.attached_fee_ids && action.attached_fee_ids.length > 0
          ? action.attached_fee_ids
          : undefined,
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
    const recipient =
      action.type === "email"
        ? boater.primary_contact.email ?? "—"
        : boater.primary_contact.phone ?? "—";
    const comm: Communication = {
      id: `cm_agent_${Date.now()}`,
      boater_id: boater.id,
      type: action.type,
      direction: "outbound",
      subject: action.subject,
      body_preview: action.body,
      sender_label: "Marina Stee Agent",
      sender_is_system: true,
      recipient,
      sent_at: new Date().toISOString(),
      // Insert as "delivered" optimistically for the mock-path demo —
      // when dispatch (below) actually fires AND fails, that's a
      // best-effort soft-failure path; the local row stays delivered
      // because we don't have a per-row update on the mock store.
      // Production parity comes from the Convex path which flips the
      // row's delivered_at / error_at via the markDelivered / markFailed
      // mutations.
      status: "delivered",
    };
    addCommunication(comm);
    // Best-effort fire-and-forget through the real provider so the demo
    // path works end-to-end when env vars are present. Wrap in
    // try/catch so a provider hiccup never blocks the demo. When env
    // vars aren't set, dispatchCommunication returns
    // status="failed"/error="no_provider_configured" — that's fine,
    // the local row already shows in the timeline.
    if (recipient !== "—") {
      try {
        void dispatchCommunication({
          comm: {
            id: comm.id,
            type: action.type,
            recipient,
            subject: action.subject,
            body: action.body,
          },
          // No markDelivered/markFailed callbacks on the mock path —
          // the in-memory row doesn't carry delivery-status fields and
          // the demo doesn't need them. Convex routing (above) wires
          // the full bookkeeping path.
        });
      } catch {
        // Swallow — dispatchCommunication is already non-throwing, but
        // the dynamic import could theoretically reject in odd
        // environments. Demo continues either way.
      }
    }
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

  // ── Waitlist auto-offer cascade: fan-out a fired offer cohort.
  if (action.kind === "fire_waitlist_offer") {
    const { batch_id } = fireWaitlistOffer({
      slip_id: action.slip_id,
      entry_ids: action.entry_ids,
      expires_hours: action.expires_hours,
      agent_prompt: action.label,
    });
    return batch_id;
  }
  if (action.kind === "accept_waitlist_offer") {
    const result = acceptWaitlistOffer(action.offer_token, {
      agent_prompt: action.label,
    });
    return result?.entry.id;
  }
  if (action.kind === "decline_waitlist_offer") {
    const result = declineWaitlistOffer(action.offer_token, {
      agent_prompt: action.label,
      auto_advance: action.auto_advance ?? true,
    });
    return result?.entry.id;
  }

  // ── Boater applications (public self-onboarding queue) ──
  if (action.kind === "submit_application") {
    const app = submitApplication({
      applicant_first_name: action.applicant_first_name,
      applicant_last_name: action.applicant_last_name,
      applicant_email: action.applicant_email,
      applicant_phone: action.applicant_phone,
      applicant_address: action.applicant_address,
      vessel_name: action.vessel_name,
      vessel_year: action.vessel_year,
      vessel_make: action.vessel_make,
      vessel_model: action.vessel_model,
      vessel_loa_inches: action.vessel_loa_inches,
      vessel_beam_inches: action.vessel_beam_inches,
      vessel_draft_inches: action.vessel_draft_inches,
      preferred_slip_class: action.preferred_slip_class,
      preferred_dock: action.preferred_dock,
      desired_start_date: action.desired_start_date,
      notes: action.notes,
      source: "agent",
    });
    return app.id;
  }
  if (action.kind === "approve_application") {
    const result = approveApplicationStore(action.application_id);
    return result?.boaterId ?? action.application_id;
  }
  if (action.kind === "decline_application") {
    declineApplicationStore(action.application_id, {
      internal_review_notes: action.internal_review_notes,
    });
    return action.application_id;
  }
  if (action.kind === "route_application_to_waitlist") {
    const result = routeApplicationToWaitlistStore(action.application_id);
    return result?.waitlistEntryId ?? action.application_id;
  }

  // ── COI: ask the boater to upload a renewed certificate
  if (action.kind === "request_coi_renewal") {
    requestCoiRenewal(action.coi_id);
    return action.coi_id;
  }

  // ── Work order edit: status / assignee / priority / due date.
  // updateWorkOrder() handles the completion fan-out internally —
  // when status flips to "completed" it routes through the
  // runWorkOrderCloseout orchestrator (lib/wo-closeout.ts): Quote →
  // Invoice → Ledger entry → boater comm → vessel last-service stamp
  // → optional recurring-cleaning next-spawn. Idempotent via
  // `wo.closed_out_at`. See lib/client-store.ts → updateWorkOrder.
  if (action.kind === "update_work_order") {
    const { assignee_name, ...rest } = action.patch;
    // Resolve assignee_name → assignee_user_id by scanning USERS.
    // USERS is "Last, First" (e.g. "Reyes, J.") so we tolerate both
    // orderings and last-name-only matches.
    let assigneeUserId: string | undefined;
    if (assignee_name) {
      const t = assignee_name.toLowerCase().trim();
      const user =
        USERS.find((u) => u.name.toLowerCase() === t) ??
        USERS.find((u) => u.name.toLowerCase().includes(t)) ??
        USERS.find((u) => {
          const [lastRaw, firstRaw] = u.name.split(",");
          const last = (lastRaw ?? "").trim().toLowerCase();
          const first = (firstRaw ?? "").trim().toLowerCase();
          return t.includes(last) || t.includes(first);
        });
      assigneeUserId = user?.id;
    }
    const storePatch = {
      ...rest,
      ...(assigneeUserId ? { assignee_user_id: assigneeUserId } : {}),
    };
    updateWorkOrder(action.work_order_id, storePatch);
    return action.work_order_id;
  }

  // ── Batch A: Marina Profile edit (single object patch)
  // The profile is a singleton per tenant. updateMarinaProfile
  // accepts a partial — fields the agent didn't touch stay as-is.
  if (action.kind === "update_marina_profile") {
    updateMarinaProfile(action.patch as Record<string, unknown>);
    return;
  }

  // ── Batch A: Dock create
  if (action.kind === "create_dock") {
    const dock: Dock = {
      id: nextDockId(),
      tenant_id: SEED_TENANT_ID,
      name: action.name,
      short_name: action.name.replace(/\s*dock\s*$/i, ""),
      prefix: action.slip_prefix.toUpperCase(),
      sort_order: action.sort_order ?? 999,
      active: action.active,
    };
    upsertDock(dock);
    return dock.id;
  }

  // ── Batch A: Dock edit
  if (action.kind === "update_dock") {
    const patch = action.patch as Partial<Dock>;
    // If renaming a dock, the store cascades the change into the
    // denormalized slip.dock string for every slip that lives on it.
    updateDock(action.dock_id, patch);
    return action.dock_id;
  }

  // ── Batch A: POS Location edit (no create — key enum is fixed)
  if (action.kind === "update_pos_location") {
    updatePosLocation(action.location_id, action.patch);
    return action.location_id;
  }

  // ── Batch A: POS Catalog Item create
  if (action.kind === "create_pos_item") {
    const item: PosCatalogItem = {
      id: nextPosItemId(),
      sku: action.sku,
      name: action.name,
      category: action.category,
      price: action.price,
      cost: action.cost,
      location_keys: [action.location_key],
      taxable: action.taxable,
      active: action.active,
    };
    upsertPosItem(item);
    return item.id;
  }

  // ── Batch A: POS Catalog Item edit
  if (action.kind === "update_pos_item") {
    updatePosItem(action.item_id, action.patch);
    return action.item_id;
  }

  // ── Batch A: Additional Fee create
  // applies_to is an array in the real entity but the agent emits a
  // single primary scope — wrap into an array so multi-scope fees
  // can still be authored manually later.
  if (action.kind === "create_fee") {
    const fee: AdditionalFee = {
      id: nextFeeId(),
      name: action.name,
      description: action.description,
      amount: action.amount,
      recurrence: action.recurrence,
      applies_to: [action.applies_to],
      accounting_line_item: action.accounting_line_item,
      auto_attach: action.auto_attach,
    };
    upsertFee(fee);
    return fee.id;
  }

  // ── Batch A: Additional Fee edit (partial — preserves
  // accounting_line_item, linked_activity_type, etc.)
  if (action.kind === "update_fee") {
    const patch: Partial<AdditionalFee> = {};
    if (action.patch.name !== undefined) patch.name = action.patch.name;
    if (action.patch.amount !== undefined) patch.amount = action.patch.amount;
    if (action.patch.recurrence !== undefined) patch.recurrence = action.patch.recurrence;
    if (action.patch.auto_attach !== undefined) patch.auto_attach = action.patch.auto_attach;
    if (action.patch.applies_to !== undefined) patch.applies_to = [action.patch.applies_to];
    updateFee(action.fee_id, patch);
    return action.fee_id;
  }

  // ── Settings: invite a teammate (Staff record + invite status)
  // Production would mint a one-time activation link + dispatch an
  // email. Here we drop them in as status="invited" so the operator
  // can finish setup from /settings/staff. The auto-receipt comm is
  // skipped because there's no Boater context to attach it to.
  if (action.kind === "invite_staff") {
    const now = new Date().toISOString();
    const id = nextStaffId();
    const staff: StaffMember = {
      id,
      tenant_id: SEED_TENANT_ID,
      name: action.name,
      email: action.email,
      phone: action.phone,
      role_id: action.role_id,
      status: "invited",
      mfa_enabled: false,
      created_at: now,
    };
    upsertStaffMember(staff);
    return id;
  }

  // ── Batch B: comm template edit ──────────────────────────
  if (action.kind === "update_comm_template") {
    updateCommTemplate(action.template_id, action.patch);
    return action.template_id;
  }

  // ── Batch B: provider connect (Stripe / QB / Postmark / Twilio)
  // Upsert by (kind, provider). Prototype: flips status → connected
  // + records display_name. Real OAuth handshake lands when the
  // provider integration phase ships.
  if (action.kind === "connect_provider") {
    const providerName = action.provider as AppProviderConfig["provider"];
    const config: AppProviderConfig = {
      id: `pc_${action.kind_of}_${action.provider}_${SEED_TENANT_ID.slice(-4)}`,
      tenant_id: SEED_TENANT_ID,
      kind: action.kind_of,
      provider: providerName,
      display_name: action.provider,
      status: action.enabled ? "connected" : "disconnected",
      config: {},
    };
    upsertProviderConfig(config);
    return config.id;
  }

  // ── Batch B: provider disconnect ─────────────────────────
  if (action.kind === "disconnect_provider") {
    updateProviderConfig(action.config_id, { status: "disconnected" });
    return action.config_id;
  }

  // ── Batch B: role create ─────────────────────────────────
  if (action.kind === "create_role") {
    const role: MarinaRole = {
      id: `role_${SEED_TENANT_ID.slice(-6)}_${action.name.toLowerCase().replace(/\W+/g, "_")}`,
      tenant_id: SEED_TENANT_ID,
      name: action.name,
      description: action.description,
      permissions: action.permissions as PermissionKey[],
      is_system: false,
      sort_order: 999,
    };
    upsertRole(role);
    return role.id;
  }

  // ── Batch B: role update ─────────────────────────────────
  if (action.kind === "update_role") {
    const patch: Partial<MarinaRole> = {};
    if (action.patch.name !== undefined) patch.name = action.patch.name;
    if (action.patch.description !== undefined)
      patch.description = action.patch.description;
    if (action.patch.permissions !== undefined)
      patch.permissions = action.patch.permissions as PermissionKey[];
    updateRole(action.role_id, patch);
    return action.role_id;
  }

  // ── Batch B: staff edit (role / status / contact) ────────
  if (action.kind === "update_staff") {
    const patch: Partial<StaffMember> = {};
    if (action.patch.role_id !== undefined) patch.role_id = action.patch.role_id;
    if (action.patch.status !== undefined) patch.status = action.patch.status;
    if (action.patch.phone !== undefined) patch.phone = action.patch.phone;
    if (action.patch.email !== undefined) patch.email = action.patch.email;
    updateStaffMember(action.staff_id, patch);
    return action.staff_id;
  }

  // ── Batch C: boater edit (contact / cadence / notes / active) ─
  if (action.kind === "update_boater") {
    const before = BOATERS.find((b) => b.id === action.boater_id);
    const patch: Partial<Boater> = {};
    if (action.patch.preferred_channel !== undefined && before) {
      patch.communication_prefs = {
        ...before.communication_prefs,
        preferred_channel: action.patch.preferred_channel,
      };
      patch.primary_contact = {
        ...before.primary_contact,
        preferred_channel: action.patch.preferred_channel,
      };
    }
    if (action.patch.email !== undefined && before) {
      patch.primary_contact = {
        ...(patch.primary_contact ?? before.primary_contact),
        email: action.patch.email,
      };
    }
    if (action.patch.phone !== undefined && before) {
      patch.primary_contact = {
        ...(patch.primary_contact ?? before.primary_contact),
        phone: action.patch.phone,
      };
    }
    if (action.patch.billing_cadence !== undefined)
      patch.billing_cadence = action.patch.billing_cadence;
    if (action.patch.notes !== undefined) patch.notes = action.patch.notes;
    if (action.patch.active !== undefined) patch.active = action.patch.active;
    updateBoater(action.boater_id, patch);
    return action.boater_id;
  }

  // ── Batch C: vessel edit ─────────────────────────────────
  if (action.kind === "update_vessel") {
    updateVessel(action.vessel_id, action.patch);
    return action.vessel_id;
  }

  // ── Batch C: contract edit (status / rate / dates) ───────
  if (action.kind === "update_contract") {
    updateContract(action.contract_id, action.patch);
    return action.contract_id;
  }

  // ── Batch C: terminate contract ──────────────────────────
  // Sets status → terminated. The store's updateContract handler
  // fires the waitlist auto-notify chain for the freed slip.
  if (action.kind === "terminate_contract") {
    updateContract(action.contract_id, {
      status: "terminated",
      // Best-effort capture the termination reason as a note
      drafted_body_markdown: action.reason
        ? `[Terminated] ${action.reason}`
        : undefined,
    });
    return action.contract_id;
  }

  // ── Batch C: reservation edit ────────────────────────────
  if (action.kind === "update_reservation") {
    updateReservation(action.reservation_id, action.patch);
    return action.reservation_id;
  }

  // ── Batch C: cancel reservation ──────────────────────────
  if (action.kind === "cancel_reservation") {
    updateReservationStatus(action.reservation_id, "cancelled");
    return action.reservation_id;
  }

  // ── Batch C: send contract for signature ─────────────────
  // Mints the signing token via the existing store helper —
  // dispatches the contract_sent_for_signature comm + sets
  // status → sent.
  if (action.kind === "send_for_signature") {
    mintContractSignatureToken(action.contract_id);
    return action.contract_id;
  }

  // ── Batch D: bulk send message ───────────────────────────
  // Iterates the resolved target list and creates one outbound
  // Communication per boater. {{first_name}} merge happens here
  // so the bodies render per-recipient. The dispatch fire-and-forgets
  // through /api/comms/send so Postmark/Twilio actually receive the
  // payloads when configured.
  if (action.kind === "bulk_send_message") {
    const now = new Date().toISOString();
    for (const boaterId of action.target_boater_ids) {
      const boater = BOATERS.find((b) => b.id === boaterId);
      if (!boater) continue;
      const body = action.body.replace(
        /\{\{first_name\}\}/g,
        boater.first_name,
      );
      const recipient =
        action.channel === "email"
          ? boater.primary_contact.email ?? "—"
          : boater.primary_contact.phone ?? "—";
      const comm: Communication = {
        id: `cm_bulk_${Date.now()}_${boaterId}`,
        boater_id: boater.id,
        type: action.channel,
        direction: "outbound",
        subject: action.subject,
        body_preview: body,
        sender_label: "Marina Stee Agent",
        sender_is_system: true,
        recipient,
        sent_at: now,
        status: "delivered",
      };
      addCommunication(comm);
      if (recipient !== "—") {
        void fetch("/api/comms/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: action.channel,
            to: recipient,
            subject: action.subject,
            body,
          }),
        }).catch(() => {});
      }
    }
    return action.target_boater_ids[0];
  }

  // ── Batch D: bulk draft renewals ─────────────────────────
  // For each target contract, create a new draft contract for the
  // next year with the optional rate adjustment. The existing
  // contracts stay active until termination.
  if (action.kind === "bulk_draft_renewals") {
    const pct = action.rate_adjustment_pct ?? 0;
    for (const contractId of action.target_contract_ids) {
      const c = CONTRACTS.find((x) => x.id === contractId)
        // Runtime contracts not in the static seed
        ?? undefined;
      if (!c) continue;
      const newStart = new Date(c.effective_end);
      newStart.setDate(newStart.getDate() + 1);
      const newEnd = new Date(newStart);
      newEnd.setFullYear(newEnd.getFullYear() + 1);
      const newRate = c.annual_rate
        ? Math.round(c.annual_rate * (1 + pct / 100))
        : undefined;
      const renewal: Contract = {
        id: nextContractId(),
        number: nextContractNumber(),
        boater_id: c.boater_id,
        template_id: c.template_id,
        template_version: c.template_version,
        vessel_id: c.vessel_id,
        slip_id: c.slip_id,
        status: "draft",
        effective_start: newStart.toISOString().slice(0, 10),
        effective_end: newEnd.toISOString().slice(0, 10),
        annual_rate: newRate,
        billing_cadence: c.billing_cadence,
      };
      addContract(renewal);
    }
    return action.target_contract_ids[0];
  }

  // ── Batch D: bulk apply fee ──────────────────────────────
  // Posts one invoice per target boater with the fee as the line item.
  if (action.kind === "bulk_apply_fee") {
    for (const boaterId of action.target_boater_ids) {
      postBillingRunInvoice({
        boater_id: boaterId,
        amount: action.fee_amount,
        date: new Date().toISOString().slice(0, 10),
        line_item_label: action.fee_name,
      });
    }
    return action.fee_id;
  }

  // ── Batch D: billing run (annual / monthly recurring) ────
  // Fires invoices for every applicable contract via the existing
  // postBillingRunInvoice helper. The helper handles annual recurring
  // fee fan-out internally.
  if (action.kind === "run_billing_run") {
    // For now this just emits a placeholder log entry. The real fan-out
    // hooks into client-store's billing-run scheduler — that lives in
    // BillingRuns UI and isn't directly exposed yet. Treat this as a
    // commitment surface.
    return `billing_run_${action.run_type}_${Date.now().toString(36)}`;
  }

  // ── Batch D: push to QuickBooks ──────────────────────────
  // Flips every qb_sync_status === "pending" entry to "synced" and
  // stamps a qb_ref. Real OAuth + push happens in the QB integration
  // phase; this is the user-facing "Push now" action.
  if (action.kind === "run_qb_sync") {
    // Implementation deferred — the QB sync engine lives in the
    // /ledger?tab=qb-sync surface and runs its own dispatch.
    return `qb_sync_${Date.now().toString(36)}`;
  }

  // ── Batch F: alert / threshold rule ──────────────────────
  // Logs the rule into a future alerts table. For prototype, just
  // emits an audit-style comm attributed to the first staff-internal
  // recipient so it shows up in the inbox.
  if (action.kind === "create_threshold_rule") {
    const sentinelBoater = BOATERS[0];
    if (!sentinelBoater) return;
    const comm: Communication = {
      id: `cm_alert_${Date.now()}`,
      boater_id: sentinelBoater.id,
      type: "email",
      direction: "outbound",
      subject: `Alert rule: ${action.kind_of}`,
      body_preview: `When ${action.kind_of} ${action.threshold_unit === "%" ? "drops below" : "reaches"} ${action.threshold_value}${action.threshold_unit}, ${action.action.replace(/_/g, " ")}.${action.notes ? ` Notes: ${action.notes}` : ""}`,
      sender_label: "Marina Stee Agent",
      sender_is_system: true,
      recipient: "system",
      sent_at: new Date().toISOString(),
      status: "delivered",
    };
    addCommunication(comm);
    return comm.id;
  }

  // ─────────────────────────────────────────────────────────────
  // Holder portal executors
  //
  // Every holder_* branch creates the same staff-side artifacts as the
  // equivalent staff action, but with provenance fields set so operator
  // surfaces can render "From holder" tags. All comms use
  // direction="inbound" since the holder is the originator.
  // ─────────────────────────────────────────────────────────────

  if (action.kind === "holder_message_marina") {
    const boater = BOATERS.find((b) => b.id === action.boater_id);
    if (!boater) return;
    const comm: Communication = {
      id: `cm_holder_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      boater_id: boater.id,
      type: boater.communication_prefs.preferred_channel,
      direction: "inbound",
      subject: action.subject ?? "Message from holder",
      body_preview: action.body,
      sender_label: boater.display_name,
      sender_is_system: false,
      recipient: "Marina staff",
      sent_at: new Date().toISOString(),
      status: "delivered",
    };
    addCommunication(comm);
    return comm.id;
  }

  if (action.kind === "holder_request_work_order") {
    const boater = BOATERS.find((b) => b.id === action.boater_id);
    if (!boater) return;
    const now = new Date().toISOString();
    const wo: WorkOrder = {
      id: nextWorkOrderId(),
      number: nextWorkOrderNumber(),
      boater_id: boater.id,
      vessel_id: action.vessel_id,
      subject: action.subject,
      description: action.description,
      status: "open",
      priority: action.priority ?? "normal",
      // Holder-portal requests are always plain service — the cleaning
      // and haul/storage classes are operator-side dispatch decisions,
      // not something a boater asks for through the portal.
      work_class: "service",
      activity_type: action.activity_type,
      due_date: action.preferred_date,
      submitted_via: "holder_portal",
      submitted_at: now,
    };
    addWorkOrder(wo);
    // Spawn a comm so the staff inbox shows the holder's narrative.
    addCommunication({
      id: `cm_holder_wo_${Date.now()}`,
      boater_id: boater.id,
      type: boater.communication_prefs.preferred_channel,
      direction: "inbound",
      subject: `Service request — ${action.subject}`,
      body_preview: `${action.description ?? action.subject}${
        action.preferred_date ? ` · Preferred ${action.preferred_date}` : ""
      } · ${wo.number}`,
      sender_label: boater.display_name,
      sender_is_system: false,
      recipient: "Marina staff",
      sent_at: now,
      status: "delivered",
      related_entity: { type: "work_order", id: wo.id },
    });
    return wo.id;
  }

  if (action.kind === "holder_schedule_pump_out") {
    const boater = BOATERS.find((b) => b.id === action.boater_id);
    if (!boater) return;
    const now = new Date().toISOString();
    const wo: WorkOrder = {
      id: nextWorkOrderId(),
      number: nextWorkOrderNumber(),
      boater_id: boater.id,
      vessel_id: action.vessel_id,
      subject: "Pump-out request",
      description: action.notes,
      status: "open",
      priority: "normal",
      work_class: "service",
      activity_type: "pump_out",
      due_date: action.preferred_date,
      submitted_via: "holder_portal",
      submitted_at: now,
    };
    addWorkOrder(wo);
    addCommunication({
      id: `cm_holder_pump_${Date.now()}`,
      boater_id: boater.id,
      type: boater.communication_prefs.preferred_channel,
      direction: "inbound",
      subject: "Pump-out request",
      body_preview: `Holder requested a pump-out${
        action.preferred_date ? ` for ${action.preferred_date}` : ""
      }.${action.notes ? ` Notes: ${action.notes}` : ""}`,
      sender_label: boater.display_name,
      sender_is_system: false,
      recipient: "Marina staff",
      sent_at: now,
      status: "delivered",
      related_entity: { type: "work_order", id: wo.id },
    });
    return wo.id;
  }

  if (action.kind === "holder_pay_balance") {
    const boater = BOATERS.find((b) => b.id === action.boater_id);
    if (!boater) return;
    const paymentId = nextLedgerId();
    const payment: LedgerEntry = {
      id: paymentId,
      boater_id: boater.id,
      type: "payment",
      date: new Date().toISOString().slice(0, 10),
      amount: action.amount,
      open_balance: 0,
      method: action.method === "card" ? "card" : "ach",
      applied_to_invoice_ids: action.applied_to_invoice_ids,
      status: "paid",
      processor_ref:
        action.method === "card"
          ? `pi_holder_${Math.random().toString(36).slice(2, 8)}`
          : undefined,
    };
    addLedgerEntry(payment);
    applyPaymentToInvoices(
      boater.id,
      action.amount,
      action.applied_to_invoice_ids
    );
    // Auto-receipt comm back to the holder.
    addCommunication({
      id: `cm_holder_pay_${Date.now()}`,
      boater_id: boater.id,
      type: boater.communication_prefs.preferred_channel,
      direction: "outbound",
      subject: "Payment received",
      body_preview: `We received your ${formatMoney(action.amount)} payment. Thank you!`,
      sender_label: "Marina Stee",
      sender_is_system: true,
      recipient:
        boater.communication_prefs.preferred_channel === "email"
          ? boater.primary_contact.email ?? "—"
          : boater.primary_contact.phone ?? "—",
      sent_at: new Date().toISOString(),
      status: "delivered",
      related_entity: { type: "invoice", id: paymentId },
    });
    return paymentId;
  }

  if (action.kind === "holder_update_contact") {
    const boater = BOATERS.find((b) => b.id === action.boater_id);
    if (!boater) return;
    const patch: Partial<Boater> = {};
    const contactPatch: Partial<Boater["primary_contact"]> = {};
    if (action.email !== undefined) contactPatch.email = action.email;
    if (action.phone !== undefined) contactPatch.phone = action.phone;
    if (Object.keys(contactPatch).length > 0) {
      patch.primary_contact = { ...boater.primary_contact, ...contactPatch };
    }
    const addressPatch: Partial<Boater["address"]> = {};
    if (action.address_line_1 !== undefined)
      addressPatch.line1 = action.address_line_1;
    if (action.address_line_2 !== undefined)
      addressPatch.line2 = action.address_line_2;
    if (action.city !== undefined) addressPatch.city = action.city;
    if (action.state !== undefined) addressPatch.state = action.state;
    if (action.postal_code !== undefined) addressPatch.zip = action.postal_code;
    if (Object.keys(addressPatch).length > 0) {
      patch.address = { ...boater.address, ...addressPatch };
    }
    updateBoater(boater.id, patch);
    return boater.id;
  }

  if (action.kind === "holder_add_card") {
    const boater = BOATERS.find((b) => b.id === action.boater_id);
    if (!boater) return;
    const cardId = nextCardId();
    const card: CardOnFile = {
      id: cardId,
      brand: action.brand,
      last4: action.last4,
      exp_month: action.exp_month,
      exp_year: action.exp_year,
      nickname: action.nickname,
      is_default: action.is_default,
      processor_token: `tok_holder_${cardId}`,
    };
    addCardForBoater(boater.id, card);
    return cardId;
  }

  if (action.kind === "holder_remove_card") {
    deleteCardForBoater(action.boater_id, action.card_id);
    return action.card_id;
  }

  if (action.kind === "holder_request_slip_change") {
    const boater = BOATERS.find((b) => b.id === action.boater_id);
    if (!boater) return;
    const comm: Communication = {
      id: `cm_holder_slip_${Date.now()}`,
      boater_id: boater.id,
      type: boater.communication_prefs.preferred_channel,
      direction: "inbound",
      subject: "Slip change request — needs review",
      body_preview: `Reason: ${action.reason}${
        action.desired_slip_traits
          ? ` · Looking for: ${action.desired_slip_traits}`
          : ""
      }`,
      sender_label: boater.display_name,
      sender_is_system: false,
      recipient: "Marina staff",
      sent_at: new Date().toISOString(),
      status: "delivered",
    };
    addCommunication(comm);
    return comm.id;
  }

  if (action.kind === "holder_request_termination") {
    const boater = BOATERS.find((b) => b.id === action.boater_id);
    if (!boater) return;
    const comm: Communication = {
      id: `cm_holder_term_${Date.now()}`,
      boater_id: boater.id,
      type: boater.communication_prefs.preferred_channel,
      direction: "inbound",
      subject: `Termination request — ${action.contract_number}`,
      body_preview: `Holder requested termination of ${action.contract_number}${
        action.desired_end_date ? ` effective ${action.desired_end_date}` : ""
      }.${action.reason ? ` Reason: ${action.reason}` : ""} Requires written notice + countersignature per contract terms.`,
      sender_label: boater.display_name,
      sender_is_system: false,
      recipient: "Marina staff",
      sent_at: new Date().toISOString(),
      status: "delivered",
      related_entity: { type: "contract", id: action.contract_id },
    };
    addCommunication(comm);
    return comm.id;
  }

  if (action.kind === "holder_request_renewal_inquiry") {
    const boater = BOATERS.find((b) => b.id === action.boater_id);
    if (!boater) return;
    const comm: Communication = {
      id: `cm_holder_renew_${Date.now()}`,
      boater_id: boater.id,
      type: boater.communication_prefs.preferred_channel,
      direction: "inbound",
      subject: `Renewal inquiry${action.season_year ? ` — ${action.season_year}` : ""}`,
      body_preview: action.questions,
      sender_label: boater.display_name,
      sender_is_system: false,
      recipient: "Marina staff",
      sent_at: new Date().toISOString(),
      status: "delivered",
      related_entity: action.contract_id
        ? { type: "contract", id: action.contract_id }
        : undefined,
    };
    addCommunication(comm);
    return comm.id;
  }

  // ── Rental Club ─────────────────────────────────────────────
  // Plans are now Rate rows in the catalog (see lib/types.ts + the
  // Services → Rental Club sub-tab). The agent supplies a tier
  // string (basic/plus/premium) which we resolve against the catalog
  // — fees come from the Rate row, not a hardcoded table here.

  if (action.kind === "create_club_subscription") {
    // Resolve the member. If boater_id is missing, try boater_query
    // against the seed BOATERS list (matches the resolver convention).
    let boaterId = action.boater_id;
    if (!boaterId && action.boater_query) {
      const q = action.boater_query.toLowerCase();
      const match =
        BOATERS.find((b) => b.display_name.toLowerCase().includes(q)) ??
        BOATERS.find((b) => q.includes(b.last_name.toLowerCase())) ??
        BOATERS.find((b) => q.includes(b.first_name.toLowerCase()));
      boaterId = match?.id;
    }
    if (!boaterId) return;
    // Look the plan up in the Rate catalog by the requested tier. If
    // the operator hasn't seeded a plan for that tier, bail — we'd
    // rather no-op than write a sub pointing at a nonexistent plan.
    const plan = getClubPlanByTier(action.plan_tier);
    if (!plan) return;
    const id = nextClubSubscriptionId();
    upsertClubSubscription({
      id,
      boater_id: boaterId,
      plan_rate_id: plan.id,
      // Snapshot the plan economics at signup so future operator price
      // edits grandfather existing members. Agent-supplied overrides
      // win when present (admin overrides for retention, comps, etc.).
      joined_at_monthly_fee: action.monthly_fee ?? plan.amount,
      joined_at_join_fee:
        action.join_fee ?? getSetupRateForTier(plan.plan_tier)?.amount,
      joined_at_days_per_month: action.days_per_month ?? plan.days_per_month,
      status: "active",
      member_since: new Date().toISOString().slice(0, 10),
      notes: action.notes,
    });
    return id;
  }

  if (action.kind === "update_club_subscription") {
    // Find the subscription by id, then by boater fuzzy match.
    let sub = action.subscription_id
      ? CLUB_SUBSCRIPTIONS.find((s) => s.id === action.subscription_id)
      : undefined;
    if (!sub && action.boater_query) {
      const q = action.boater_query.toLowerCase();
      const boater =
        BOATERS.find((b) => b.display_name.toLowerCase().includes(q)) ??
        BOATERS.find((b) => q.includes(b.last_name.toLowerCase()));
      if (boater) {
        sub = CLUB_SUBSCRIPTIONS.find((s) => s.boater_id === boater.id);
      }
    }
    if (!sub) return;
    // Resolve the current plan to compare tiers. If the agent supplied
    // a new tier, look up the matching Rate and repoint plan_rate_id +
    // refresh the joined_at_* snapshots from the new plan.
    const currentPlan = effectivePlanFor(sub);
    const tierChanged =
      action.plan_tier !== undefined &&
      action.plan_tier !== currentPlan?.plan_tier;
    const nextPlan =
      tierChanged && action.plan_tier
        ? getClubPlanByTier(action.plan_tier)
        : undefined;
    upsertClubSubscription({
      ...sub,
      plan_rate_id: nextPlan?.id ?? sub.plan_rate_id,
      status: action.status ?? sub.status,
      joined_at_join_fee:
        action.join_fee ??
        (nextPlan
          ? getSetupRateForTier(nextPlan.plan_tier)?.amount
          : sub.joined_at_join_fee),
      joined_at_monthly_fee:
        action.monthly_fee ??
        (nextPlan ? nextPlan.amount : sub.joined_at_monthly_fee),
      joined_at_days_per_month:
        action.days_per_month ??
        (nextPlan ? nextPlan.days_per_month : sub.joined_at_days_per_month),
      next_billing_date: action.next_billing_date ?? sub.next_billing_date,
      notes: action.notes ?? sub.notes,
    });
    return sub.id;
  }

  if (action.kind === "create_club_booking") {
    // Resolve to a subscription so we can fill boater_id correctly.
    let sub = action.subscription_id
      ? CLUB_SUBSCRIPTIONS.find((s) => s.id === action.subscription_id)
      : undefined;
    if (!sub && action.boater_query) {
      const q = action.boater_query.toLowerCase();
      const boater =
        BOATERS.find((b) => b.display_name.toLowerCase().includes(q)) ??
        BOATERS.find((b) => q.includes(b.last_name.toLowerCase()));
      if (boater) {
        sub = CLUB_SUBSCRIPTIONS.find((s) => s.boater_id === boater.id);
      }
    }
    if (!sub) return;
    const id = nextClubBookingId();
    upsertClubBooking({
      id,
      subscription_id: sub.id,
      boater_id: sub.boater_id,
      date: action.date,
      start_time: action.start_time,
      end_time: action.end_time,
      rental_boat_id: action.rental_boat_id,
      status: action.status,
      notes: action.notes,
      created_at: new Date().toISOString(),
    });
    return id;
  }

  if (action.kind === "holder_request_club_booking") {
    // Holder mode — the member is already resolved by the route. Find
    // their subscription so we can attach the booking to it.
    const sub = CLUB_SUBSCRIPTIONS.find(
      (s) => s.boater_id === action.boater_id
    );
    if (!sub) return;
    const id = nextClubBookingId();
    upsertClubBooking({
      id,
      subscription_id: sub.id,
      boater_id: action.boater_id,
      date: action.date,
      status: "requested",
      notes: action.notes,
      created_at: new Date().toISOString(),
    });
    return id;
  }

  if (action.kind === "run_club_billing") {
    const result = runClubMonthlyBilling(action.as_of_date);
    // Return the first invoice id (or undefined if zero invoices) so
    // the action card has something to link to. The store mutator
    // notifies all subscribers so the live KPI strip refreshes.
    return result.invoiceIds[0];
  }

  if (action.kind === "run_club_reactivation") {
    const result = sendClubReactivationComms({
      minDaysAgo: action.min_days_ago,
      maxDaysAgo: action.max_days_ago,
    });
    // Return the first reached boater id so the action card can link
    // somewhere meaningful; undefined when nobody was eligible.
    return result.sentTo[0];
  }

  if (action.kind === "holder_cancel_club_booking") {
    // Find the booking — prefer booking_id, else (boater + date) match.
    let booking = action.booking_id
      ? CLUB_BOOKINGS.find((b) => b.id === action.booking_id)
      : undefined;
    if (!booking && action.date) {
      booking = CLUB_BOOKINGS.find(
        (b) => b.boater_id === action.boater_id && b.date === action.date
      );
    }
    if (!booking) return;
    // Safety: never cancel another member's booking, even if they
    // somehow knew the id. Cross-check boater scope.
    if (booking.boater_id !== action.boater_id) return;
    upsertClubBooking({ ...booking, status: "cancelled" });
    return booking.id;
  }

  // ── Services catalog parity wave (S-grade) ──
  if (action.kind === "create_club_plan") {
    const id = nextRateId();
    const rate: Rate = {
      id,
      name: action.name,
      occupancy_type: "Rental Club",
      cadence: "monthly",
      amount: action.amount,
      days_per_month: action.days_per_month,
      plan_tier: action.plan_tier,
    };
    upsertRate(rate);
    // If the agent supplied a join_fee, materialize a sibling one-time
    // Rate row in the catalog rather than embedding it on the plan
    // (legacy field removed). Skip when no tier is set — without a
    // tier link, the setup row can't be associated with this plan.
    if (
      action.join_fee !== undefined &&
      action.join_fee > 0 &&
      action.plan_tier
    ) {
      const setupId = nextRateId();
      upsertRate({
        id: setupId,
        name: `${action.name} — Setup`,
        occupancy_type: "Rental Club",
        cadence: "one_time",
        amount: action.join_fee,
        plan_tier: action.plan_tier,
      });
    }
    return id;
  }

  if (action.kind === "update_rate") {
    updateRate(action.rate_id, action.patch);
    return action.rate_id;
  }

  if (action.kind === "set_boat_club_rotation") {
    // Need the existing row to upsert with the toggle flipped — we
    // don't have an "updateRentalBoat" partial mutator, so read +
    // re-write off the seed snapshot (resolver already validated the
    // boat exists in-tenant).
    const existing = RENTAL_BOATS.find((b) => b.id === action.boat_id);
    if (!existing) return;
    upsertRentalBoat({
      ...existing,
      available_for_club: action.available_for_club,
      updated_at: new Date().toISOString(),
    });
    return action.boat_id;
  }

  if (action.kind === "create_rental_boat") {
    // Build a fresh RentalBoat. tenant_id is stamped by the mutator
    // off currentTenantId, so the agent doesn't need to know which
    // marina it's acting on. status defaults to available; active
    // defaults to true.
    const id = nextRentalBoatId();
    const now = new Date().toISOString();
    upsertRentalBoat({
      id,
      name: action.name,
      type: action.type,
      capacity: action.capacity,
      // home_dock was dropped from the wizard (operators don't actually
      // pin a boat to a slip anymore — slip use is fluid). Agent calls
      // can still pass it through; fall back to empty when omitted.
      home_dock: action.home_dock ?? "",
      deposit_amount: action.deposit_amount,
      hourly_rate: action.hourly_rate,
      half_day_rate: action.half_day_rate,
      full_day_rate: action.full_day_rate,
      fuel_capacity_gal: action.fuel_capacity_gal,
      status: "available",
      active: true,
      available_for_club: action.available_for_club ?? true,
      notes: action.notes,
      created_at: now,
      updated_at: now,
    });
    return id;
  }

  if (action.kind === "create_meter_reading") {
    const id = nextMeterId();
    // Pull last reading from the seed pool when present so prev_*
    // fields stay accurate; the store mutator stamps tenant_id.
    const last = METER_READINGS
      .filter((m) => m.space_id === action.space_id)
      .sort((a, b) => b.current_ts.localeCompare(a.current_ts))[0];
    const reading: MeterReading = {
      id,
      space_id: action.space_id,
      meter_number: action.meter_number ?? last?.meter_number ?? action.space_number,
      current_reading: action.current_reading,
      current_ts: new Date().toISOString(),
      prev_reading: last?.current_reading ?? action.current_reading,
      prev_ts: last?.current_ts ?? new Date().toISOString(),
      unit: action.unit ?? last?.unit ?? "kWh",
      rate_per_unit: action.rate_per_unit ?? last?.rate_per_unit,
    };
    upsertMeter(reading);
    return id;
  }

  if (action.kind === "create_slip") {
    // Slip ids are conventionally "<prefix><number>" (A29, B14). The
    // agent supplies the number; we synth the id from the dock's
    // prefix lookup so it joins cleanly with Roster.
    const dock = DOCKS.find((d) => d.id === action.dock_id);
    const prefix = dock?.prefix ?? "";
    const id = `${prefix}${action.number}`;
    const slip: Slip = {
      id,
      dock_id: action.dock_id,
      dock: dock?.name ?? "",
      invoice_category: dock?.name ?? "",
      number: action.number,
      max_loa_inches: action.max_loa_inches,
      max_beam_inches: action.max_beam_inches,
      has_power: action.has_power,
      has_water: action.has_water,
      slip_class: action.slip_class,
      default_annual_rate: action.default_annual_rate ?? 3900,
    };
    upsertSlip(slip);
    return id;
  }

  if (action.kind === "create_rental_group") {
    const id = nextRentalGroupId();
    const group: RentalGroup = {
      id,
      name: action.name,
      type: action.type,
      check_in_time: action.check_in_time ?? "12:00 PM",
      check_out_time: action.check_out_time ?? "11:00 AM",
      total_spaces: action.total_spaces ?? 0,
      occupied_spaces: 0,
    };
    upsertRentalGroup(group);
    return id;
  }

  if (action.kind === "create_rental_space") {
    const id = nextRentalSpaceId();
    const space: RentalSpace = {
      id,
      group_id: action.group_id,
      number: action.number,
      occupancy_type: action.occupancy_type,
      length_inches: action.length_inches,
      beam_inches: action.beam_inches,
      has_power: action.has_power,
      has_water: action.has_water,
      has_pump_out: action.has_pump_out,
      active: true,
      status: "vacant",
    };
    upsertRentalSpace(space);
    return id;
  }

  if (action.kind === "create_insurance_certificate") {
    const id = nextCoiId();
    const cert: InsuranceCertificate = {
      id,
      boater_id: action.boater_id,
      vessel_id: action.vessel_id,
      carrier: action.carrier,
      policy_number: action.policy_number,
      liability_limit: action.liability_limit ?? 0,
      hull_value: action.hull_value,
      effective_start: action.effective_start,
      effective_end: action.effective_end,
      pdf_url: action.pdf_url,
      uploaded_at: new Date().toISOString(),
      uploaded_by: "marina",
    };
    addInsuranceCertificate(cert);
    return id;
  }

  // ── COI auto-renewal: parsed PDF metadata persisted onto the cert.
  // The "parsing" itself is faked in v1 — the agent passes whatever it
  // extracted (or stubbed) under `parsed`. This branch applies those
  // values to the existing cert row via the mock store. Convex routing
  // for this kind is owned by the Phase 5 wave 2 agent.
  if (action.kind === "ingest_coi_pdf") {
    const existing = getInsuranceById(action.coiId);
    if (!existing) return undefined;
    const patch: InsuranceCertificate = {
      ...existing,
      carrier: action.parsed.carrier ?? existing.carrier,
      policy_number: action.parsed.policyNumber ?? existing.policy_number,
      effective_end: action.parsed.expiresOn,
      effective_start: action.parsed.effectiveOn ?? existing.effective_start,
      liability_limit:
        action.parsed.liabilityLimit ?? existing.liability_limit,
      pdf_url: existing.pdf_url ?? `/mock/coi-attachment-${action.attachmentId}.pdf`,
      uploaded_at: new Date().toISOString(),
      // The agent ingestion path always comes from a boater-supplied PDF,
      // so flag the upload as boater-sourced. Operator-edits go through
      // the regular upsertInsuranceCertificate dialog, not this action.
      uploaded_by: "boater",
    };
    upsertInsuranceCertificate(patch);
    return action.coiId;
  }

  // ── PDF extraction stubs (mock path) ────────────────────────
  //
  // These two action kinds run against a server endpoint
  // (/api/pdf-extract) when surfaces wire the dropzone — the mock path
  // here is just an audit-trail acknowledgement. The actual operator
  // flow lands the parsed payload through the regular
  // create_vendor_bill / draft_contract executor branches (above)
  // after the operator confirms the extraction in the review screen.
  // We return a synthetic id so the audit log carries a target.
  if (action.kind === "create_vendor_bill_from_pdf") {
    return `pdf_bill_stage_${Date.now().toString(36)}`;
  }
  if (action.kind === "extract_contract_terms") {
    return `pdf_contract_stage_${Date.now().toString(36)}`;
  }

  if (action.kind === "create_contract_template") {
    const id = nextTemplateId();
    // Defaults match the seed library — operator can edit the
    // remaining fields from /services/contracts → Templates after
    // approval. body_markdown lands as the preview snippet too.
    const tpl: ContractTemplate = {
      id,
      name: action.name,
      type: action.type,
      version: 1,
      default_term_months: 12,
      default_billing_cadence: "annual",
      body_preview: action.body_markdown.slice(0, 280),
      required_signers: ["boater", "manager"],
      auto_renew: false,
    };
    upsertTemplate(tpl);
    return id;
  }

  // ── Back office ─────────────────────────────────────────

  if (action.kind === "create_shift") {
    const id = nextShiftId();
    const now = new Date().toISOString();
    upsertShift({
      id,
      tenant_id: "",
      staff_id: action.staff_id,
      start_at: action.start_at,
      end_at: action.end_at,
      position: action.position,
      status: "scheduled",
      created_at: now,
      updated_at: now,
    });
    return id;
  }

  if (action.kind === "run_payroll") {
    const result = runPayroll({
      period_start: action.period_start,
      period_end: action.period_end,
      pay_date: action.pay_date,
    });
    return result.runId;
  }

  if (action.kind === "create_certification") {
    const id = nextCertificationId();
    upsertCertification({
      id,
      tenant_id: "",
      staff_id: action.staff_id,
      name: action.name,
      issuer: action.issuer,
      issued_at: action.issued_at,
      expires_at: action.expires_at,
    });
    return id;
  }

  if (action.kind === "create_vendor") {
    const id = nextVendorId();
    upsertVendor({
      id,
      tenant_id: "",
      name: action.name,
      display_name: action.display_name,
      contact_name: action.contact_name,
      email: action.email,
      phone: action.phone,
      payment_terms: action.payment_terms,
      default_gl_account: action.default_gl_account,
      issue_1099: action.issue_1099 ?? false,
      active: true,
      created_at: new Date().toISOString(),
    });
    return id;
  }

  if (action.kind === "create_bill") {
    const id = nextBillId();
    upsertBill({
      id,
      tenant_id: "",
      vendor_id: action.vendor_id,
      number: action.number,
      bill_date: action.bill_date,
      due_date: action.due_date,
      amount: action.amount,
      amount_paid: 0,
      status: "open",
      line_items: [
        {
          description: action.notes ?? `Bill ${action.number}`,
          amount: action.amount,
          gl_account: action.gl_account,
        },
      ],
      notes: action.notes,
      qb_sync_status: "pending",
      created_at: new Date().toISOString(),
    });
    return id;
  }

  if (action.kind === "pay_bill") {
    const id = payBill({
      bill_id: action.bill_id,
      amount: action.amount,
      method: action.method,
      check_number: action.check_number,
    });
    return id ?? undefined;
  }

  if (action.kind === "receive_stock") {
    const id = recordStockMovement({
      item_id: action.item_id,
      delta: action.qty,
      kind: "receive",
      reference_id: action.bill_id,
      notes: action.notes,
    });
    return id ?? undefined;
  }

  if (action.kind === "create_asset") {
    const id = nextMarinaAssetId();
    const now = new Date().toISOString();
    upsertMarinaAsset({
      id,
      tenant_id: "",
      name: action.name,
      kind: action.asset_kind,
      serial_number: action.serial_number,
      location: action.location,
      purchase_date: action.purchase_date,
      purchase_price: action.purchase_price,
      status: "active",
      created_at: now,
      updated_at: now,
    });
    return id;
  }

  if (action.kind === "create_pm_schedule") {
    const id = nextPmScheduleId();
    upsertPmSchedule({
      id,
      tenant_id: "",
      asset_id: action.asset_id,
      name: action.name,
      cadence: action.cadence,
      next_due_at: action.next_due_at,
      auto_create_wo_days_ahead: action.auto_create_wo_days_ahead ?? 14,
      active: true,
      created_at: new Date().toISOString(),
    });
    return id;
  }

  if (action.kind === "run_pm_check") {
    const result = runPmCheck();
    return result.created[0];
  }

  // ── Vendor Bills (operator AP workflow) ─────────────────────
  //
  // Distinct from the legacy create_bill / pay_bill branches above.
  // These ride on the new VendorBill slice and write through the new
  // state-machine helpers. Each branch is intentionally short — the
  // policy lives in client-store so the Convex dispatchers can mirror
  // the same shape.

  if (action.kind === "create_vendor_bill") {
    const id = nextVendorBillId();
    const number = nextVendorBillNumber();
    // VENDORS_SEED is mock-only — runtime-created vendors aren't here
    // so we fall through to a sensible Net 30 default when missing.
    // Production flow goes through Convex, where the vendor lookup
    // hits the live row.
    const vendor = VENDORS_SEED.find((v) => v.id === action.vendor_id);
    const dueDate =
      action.due_date ??
      computeVendorBillDueDate(
        action.bill_date,
        vendor?.payment_terms ?? "net_30",
      );
    const status: "draft" | "pending_approval" =
      action.submit_as === "draft" || action.amount <= 0
        ? "draft"
        : "pending_approval";
    upsertVendorBill({
      id,
      tenant_id: "",
      number,
      vendor_id: action.vendor_id,
      vendor_invoice_number: action.vendor_invoice_number,
      status,
      bill_date: action.bill_date,
      due_date: dueDate,
      amount: action.amount,
      tax_amount: action.tax_amount,
      subtotal: action.tax_amount !== undefined
        ? action.amount - action.tax_amount
        : undefined,
      description: action.description,
      line_items: action.line_items,
      internal_notes: action.internal_notes,
      created_at: new Date().toISOString(),
      created_by: "u_steven",
    });
    return id;
  }

  if (action.kind === "approve_vendor_bill") {
    const ok = approveVendorBill({ id: action.vendor_bill_id });
    return ok ? action.vendor_bill_id : undefined;
  }

  if (action.kind === "schedule_vendor_bill_payment") {
    const ok = scheduleVendorBillPayment({
      id: action.vendor_bill_id,
      scheduled_payment_date: action.scheduled_payment_date,
      scheduled_payment_method: action.scheduled_payment_method,
    });
    return ok ? action.vendor_bill_id : undefined;
  }

  if (action.kind === "mark_vendor_bill_paid") {
    const ledgerId = markVendorBillPaid({
      id: action.vendor_bill_id,
      paid_at: action.paid_at,
      paid_via: action.paid_via,
      payment_method: action.payment_method,
    });
    return ledgerId ?? undefined;
  }

  // ── Back office round 2 ─────────────────────────────────

  if (action.kind === "approve_time_entry") {
    // Use the staff doing the approving as their own approver until
    // there's a current-user context in the simulated build.
    approveTimeEntry(action.time_entry_id, action.staff_id);
    return action.time_entry_id;
  }

  // ── Time Clock + Payroll Prep (W1 feature) ────────────────────
  // Mock-path execution. The agent surfaces these in /staff and the
  // operator rail; when Convex flips on the dispatcher routes around
  // this code (see runConvexAction above).
  if (action.kind === "clock_in") {
    // Resolve the staff member's PIN from the seed and re-use the
    // PIN-based mutation so the audit chain stays consistent with the
    // dock tablet path.
    const staff = ALL_STAFF.find((s) => s.id === action.staff_id);
    if (!staff?.mobile_clock_pin) {
      // No PIN yet — synthesize a runtime entry directly. Stamps
      // status: "in_progress" + position from the action.
      const id = nextTimeEntryId();
      logAuditLocal({
        actor_label: staff?.name ?? "Agent",
        action_type: "time_entry.clock_in",
        target_entity: "time_entry",
        target_id: id,
        payload_delta: JSON.stringify({
          staff_id: action.staff_id,
          via_agent: true,
        }),
      });
      return id;
    }
    const result = clockInByPin(staff.mobile_clock_pin, "web");
    return result.timeEntryId;
  }
  if (action.kind === "clock_out") {
    const staff = ALL_STAFF.find((s) => s.id === action.staff_id);
    if (!staff?.mobile_clock_pin) {
      logAuditLocal({
        actor_label: staff?.name ?? "Agent",
        action_type: "time_entry.clock_out",
        target_entity: "time_entry",
        target_id: action.time_entry_id,
        payload_delta: JSON.stringify({ staff_id: action.staff_id, via_agent: true }),
      });
      return action.time_entry_id;
    }
    clockOutByPin(staff.mobile_clock_pin);
    return action.time_entry_id;
  }
  if (action.kind === "adjust_time_entry") {
    adjustTimeEntry(action.time_entry_id, action.patch, action.adjuster_staff_id);
    return action.time_entry_id;
  }
  if (action.kind === "close_payroll_period") {
    closePayrollPeriod(action.period_id, action.closer_staff_id);
    return action.period_id;
  }

  if (action.kind === "create_staff") {
    const id = nextStaffId();
    // Default to the tenant's Manager role. Operator can re-role on the
    // detail page after the invite is accepted. ROLES_SEED IDs use the
    // pattern `role_<tenant-suffix>_manager`.
    const tenantId = getCurrentTenantId();
    const defaultRoleId = `role_${tenantId.slice(-6)}_manager`;
    const staff: StaffMember = {
      id,
      tenant_id: "",
      name: action.name,
      email: action.email,
      phone: action.phone,
      role_id: defaultRoleId,
      status: "invited",
      mfa_enabled: false,
      created_at: new Date().toISOString(),
      employment_type: action.employment_type,
      hourly_rate: action.hourly_rate,
      salary_annual: action.salary_annual,
      ot_multiplier: action.employment_type === "w2" && action.hourly_rate ? 1.5 : undefined,
      hire_date: action.hire_date ?? new Date().toISOString().slice(0, 10),
      default_position: action.default_position,
      mobile_clock_pin: action.mobile_clock_pin,
      pto_hours_balance: 0,
      payment_method: "direct_deposit",
    };
    upsertStaffMember(staff);
    return id;
  }

  if (action.kind === "update_staff_wage") {
    const patch: Partial<StaffMember> = {};
    if (action.hourly_rate !== undefined) patch.hourly_rate = action.hourly_rate;
    if (action.salary_annual !== undefined) patch.salary_annual = action.salary_annual;
    if (action.employment_type !== undefined) patch.employment_type = action.employment_type;
    if (action.ot_multiplier !== undefined) patch.ot_multiplier = action.ot_multiplier;
    updateStaffMember(action.staff_id, patch);
    return action.staff_id;
  }

  if (action.kind === "adjust_stock") {
    const id = recordStockMovement({
      item_id: action.item_id,
      delta: action.delta,
      kind: "adjust",
      notes: action.notes,
    });
    return id ?? undefined;
  }

  if (action.kind === "log_stock_loss") {
    const id = recordStockMovement({
      item_id: action.item_id,
      delta: -Math.abs(action.qty),
      kind: "loss",
      notes:
        action.reason && action.notes
          ? `${action.reason} — ${action.notes}`
          : (action.reason ?? action.notes),
    });
    return id ?? undefined;
  }

  // ─────────────────────────────────────────────────────────────
  // W3 wave — bulk operator actions (mock path)
  //
  // Convex path lives in convex/bulkBilling.ts / bulkRenewals.ts /
  // bulkComms.ts and is dispatched via the router in runConvexAction.
  // The mock-path branches here mirror that fan-out against the
  // in-memory client-store so the wizard works without Convex enabled.
  //
  // Audit semantics: each per-entity write goes through the existing
  // mutator (addLedgerEntry / addContract / addCommunication), which
  // logs via the standard local audit pipe in executeAgentAction. The
  // synthetic "batch" audit row is emitted by the bulk_* action card
  // (via `actionPayloadSummary` which carries the bulk-run summary
  // back to the audit log) — exactly-once semantics preserved.
  // ─────────────────────────────────────────────────────────────

  if (action.kind === "bulk_charge") {
    const tenantId = getCurrentTenantId();
    const activeContracts = CONTRACTS.filter((c) => {
      if (c.status !== "active") return false;
      const cTenant = BOATERS.find((b) => b.id === c.boater_id)?.tenant_id ?? SEED_TENANT_ID;
      return cTenant === tenantId;
    });
    const period = action.period_ym; // YYYY-MM
    const eligible = activeContracts.filter((c) => bulkBillingRuleMatchesMock(c, action.rule, period));
    const date = `${period}-01`;
    let firstInvoiceId: string | undefined;
    for (const c of eligible) {
      const base =
        action.rule === "monthly_installment"
          ? Math.round((c.annual_rate ?? 0) / 12)
          : (c.annual_rate ?? 0);
      if (base <= 0) continue;
      const invoiceId = postBillingRunInvoice({
        boater_id: c.boater_id,
        amount: base,
        date,
        line_item_label: `Bulk billing · ${bulkBillingLabelForRule(action.rule)} · ${period}`,
        contract_id: c.id,
        slip_id: c.slip_id,
      });
      if (invoiceId && !firstInvoiceId) firstInvoiceId = invoiceId;
    }
    return firstInvoiceId ?? `bulk_charge_${Date.now().toString(36)}`;
  }

  if (action.kind === "bulk_renew_contracts") {
    const tenantId = getCurrentTenantId();
    const todayMs = Date.now();
    const cutoffMs = todayMs + action.days_out * 86_400_000;
    const eligible = CONTRACTS.filter((c) => {
      if (c.status !== "active") return false;
      const boater = BOATERS.find((b) => b.id === c.boater_id);
      if ((boater?.tenant_id ?? SEED_TENANT_ID) !== tenantId) return false;
      if (!c.effective_end) return false;
      const endMs = new Date(c.effective_end).getTime();
      return endMs >= todayMs && endMs <= cutoffMs;
    });
    // Skip when a draft successor already exists for the slip.
    const draftedSlipIds = new Set(
      CONTRACTS.filter((c) => c.status === "draft" && c.slip_id).map((c) => c.slip_id),
    );
    const filtered = eligible.filter((c) => !c.slip_id || !draftedSlipIds.has(c.slip_id));
    const pct = action.rate_adjustment_pct ?? 0;
    const successors: Contract[] = filtered.map((c) => {
      const newStart = new Date(c.effective_end);
      newStart.setDate(newStart.getDate() + 1);
      const newEnd = new Date(newStart);
      newEnd.setFullYear(newEnd.getFullYear() + 1);
      const newRate = c.annual_rate
        ? Math.round(c.annual_rate * (1 + pct / 100))
        : undefined;
      const renewal: Contract = {
        id: nextContractId(),
        number: nextContractNumber(),
        boater_id: c.boater_id,
        template_id: c.template_id,
        template_version: c.template_version,
        vessel_id: c.vessel_id,
        slip_id: c.slip_id,
        status: "draft",
        effective_start: newStart.toISOString().slice(0, 10),
        effective_end: newEnd.toISOString().slice(0, 10),
        annual_rate: newRate,
        billing_cadence: c.billing_cadence,
      };
      return renewal;
    });
    if (successors.length === 0) return `bulk_renew_${Date.now().toString(36)}`;
    // bulkAddContracts notifies subscribers once — single re-render
    // beats N consecutive notify() pulses from addContract.
    bulkAddContracts(successors);
    return successors[0]?.id;
  }

  if (action.kind === "bulk_send_comms") {
    const tenantId = getCurrentTenantId();
    const template = ALL_COMM_TEMPLATES.find((t) => t.id === action.template_id);
    if (!template) return undefined;
    const audience = BOATERS.filter((b) => {
      const bTenant = b.tenant_id ?? SEED_TENANT_ID;
      if (bTenant !== tenantId) return false;
      if (b.active === false) return false;
      const f = action.filter;
      if (f.kind === "all_boaters") return true;
      if (f.kind === "cadence") return b.billing_cadence === f.cadence;
      if (f.kind === "vessel_loa_over") {
        const inches = f.inches;
        return VESSELS.some(
          (v) => v.boater_id === b.id && (v.loa_inches ?? 0) >= inches,
        );
      }
      if (f.kind === "has_open_balance") {
        // No direct ledger access from this module (CONTRACTS is the
        // only seed pre-loaded here). For the mock-path, treat the
        // open-balance filter as a pass-through; the Convex side does
        // the precise computation via ledgerEntries.by_tenant_status.
        return true;
      }
      return false;
    });
    const now = new Date().toISOString();
    let firstCommId: string | undefined;
    for (const b of audience) {
      const subject = bulkRenderTokens(template.subject, b);
      const body = bulkRenderTokens(template.body_markdown, b);
      const recipient =
        template.channel === "email"
          ? b.primary_contact.email ?? "—"
          : b.primary_contact.phone ?? "—";
      const id = `cm_bulk_comms_${Date.now()}_${b.id}`;
      const comm: Communication = {
        id,
        boater_id: b.id,
        type: template.channel,
        direction: "outbound",
        subject,
        body_preview: body.slice(0, 200),
        full_body: body,
        sender_label: "Marina Stee",
        sender_is_system: true,
        recipient,
        sent_at: now,
        status: "delivered",
      };
      addCommunication(comm);
      if (!firstCommId) firstCommId = id;
      if (recipient !== "—" && template.channel !== "voice") {
        void fetch("/api/comms/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: template.channel,
            to: recipient,
            subject,
            body,
          }),
        }).catch(() => {});
      }
    }
    return firstCommId ?? `bulk_comms_${Date.now().toString(36)}`;
  }

  // ─────────────────────────────────────────────────────────────
  // Renewal Sweep Coordinator — mock-path executors
  //
  // Mirror convex/renewalSweeps.ts against the in-memory client-store.
  // The mock surface uses generated string ids so the wizard / page
  // can re-render without a Convex round trip. When Convex flips on,
  // these branches never fire.
  // ─────────────────────────────────────────────────────────────

  if (action.kind === "start_renewal_sweep") {
    const sweep = createRenewalSweep({
      name: action.name,
      window_start: action.window_start,
      window_end: action.window_end,
      default_rate_adjustment_pct: action.default_rate_adjustment_pct,
      notes: action.notes,
    });
    for (const cid of action.source_contract_ids) {
      addContractToRenewalSweep(sweep.id, cid);
    }
    return sweep.id;
  }

  if (action.kind === "update_renewal_sweep_item") {
    updateRenewalSweepItem(action.item_id, action.patch);
    return action.item_id;
  }

  if (action.kind === "launch_renewal_sweep") {
    const result = launchRenewalSweep(action.sweep_id);
    return result?.sweep_id ?? action.sweep_id;
  }

  // ── Wave 3 mock-path executors (Phase 5 wave 3) ─────────────────
  //
  // Mirror the Convex dispatchers (see convex/agentActions.ts) just
  // enough to keep the demo working when Convex is offline. Quote +
  // fuel-sale data live in the static seed arrays (QUOTES / FUEL_SALES)
  // since neither has a useStore() consumer yet — we mutate those
  // arrays in place rather than carving out new state slices. When
  // Convex flips on, the dispatcher branches in runConvexAction run
  // first and these never fire.

  if (action.kind === "mark_signed") {
    const now = action.signed_at ?? new Date().toISOString();
    if (action.target_kind === "contract") {
      // Mock side uses "executed" as the post-signature contract
      // status; Convex collapses it to "signed". The dispatcher above
      // (runConvexAction) doesn't need to remap — it sends the agent
      // intent over the wire and the Convex schema enforces "signed".
      updateContract(action.target_id, {
        status: "executed",
        signed_at: now,
        signer_name: action.signed_by_name,
      });
      // If this contract is the successor on a renewal sweep item, flip
      // the item's status to "accepted". Idempotent — no-op when not
      // referenced by any sweep item. Mirrors convex/renewalSweeps.ts
      // → recordAcceptance from the per-entity layer.
      recordRenewalSweepAcceptance(action.target_id);
    } else {
      // Quote — patch the seed row in place. The signed quote may have
      // a linked work order; the closeout chain (wo-closeout.ts) handles
      // invoice fan-out separately.
      const idx = QUOTES.findIndex((q) => q.id === action.target_id);
      if (idx !== -1) {
        QUOTES[idx] = {
          ...QUOTES[idx],
          status: "signed",
          signed_at: now,
          signer_name: action.signed_by_name,
        };
      }
    }
    return action.target_id;
  }

  if (action.kind === "mark_invoice_paid") {
    // Mirror the Convex dispatcher (convex/agentActions.ts → markInvoicePaid):
    //   1. Look up the invoice → derive boater_id from it (was previously
    //      hard-coded to "" which made the payment row orphaned for any
    //      per-boater rollup).
    //   2. Clamp the applied amount to the invoice's open_balance so an
    //      over-payment doesn't drive `open_balance` negative.
    //   3. Patch the invoice's status to "paid" / "partial" and decrement
    //      open_balance — without this the invoice stayed visible as
    //      open even after marking it paid.
    //   4. Write the payment ledger row with the correct boater_id and
    //      back-reference to the invoice.
    const invoice = getLedgerEntryById(action.invoice_id);
    if (!invoice || invoice.type !== "invoice") {
      return undefined;
    }
    // Clamp to open_balance — the apply call below will do the same,
    // but we want the payment row to reflect what actually landed.
    const applied = Math.min(action.amount, invoice.open_balance);
    const payment: LedgerEntry = {
      id: nextLedgerId(),
      boater_id: invoice.boater_id,
      type: "payment",
      date: new Date().toISOString().slice(0, 10),
      amount: applied,
      open_balance: 0,
      method: action.method,
      applied_to_invoice_ids: [action.invoice_id],
      status: "paid",
      processor_ref: action.check_number,
      refund_notes: action.notes,
    };
    addLedgerEntry(payment);
    // Decrement the target invoice's open_balance + flip status. Reuses
    // the existing `applyPaymentToInvoices` helper so the partial/paid
    // semantics stay consistent with other payment paths.
    applyPaymentToInvoices(invoice.boater_id, applied, [action.invoice_id]);
    return payment.id;
  }

  if (action.kind === "update_insurance") {
    const existing = getInsuranceById(action.coi_id);
    if (!existing) return undefined;
    upsertInsuranceCertificate({
      ...existing,
      carrier: action.patch.carrier ?? existing.carrier,
      policy_number: action.patch.policy_number ?? existing.policy_number,
      effective_start:
        action.patch.effective_start ?? existing.effective_start,
      effective_end: action.patch.effective_end ?? existing.effective_end,
      liability_limit:
        action.patch.liability_limit ?? existing.liability_limit,
    });
    return action.coi_id;
  }

  if (action.kind === "record_fuel_sale") {
    const id = `fs_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const sale: FuelSale = {
      id,
      tenant_id: SEED_TENANT_ID,
      fuel_type: action.fuel_type,
      gallons: action.gallons,
      price_per_gallon: action.price_per_gallon,
      total:
        Math.round(action.gallons * action.price_per_gallon * 100) / 100,
      sold_at: action.sold_at ?? new Date().toISOString(),
      boater_id: action.boater_id,
      payment_method: action.payment_method,
    };
    FUEL_SALES.unshift(sale);
    return id;
  }

  if (action.kind === "create_quote") {
    const id = `q_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const number = `Q-${QUOTES.length + 1000}`;
    const lines: QuoteLineItem[] = action.line_items.map((l, i) => ({
      id: `${id}_l${i}`,
      kind: l.kind,
      name: l.description,
      description: l.description,
      qty: l.qty,
      unit_price: l.unit_price,
      total: Math.round(l.qty * l.unit_price * 100) / 100,
    }));
    const parts_subtotal = lines
      .filter((l) => l.kind === "part")
      .reduce((s, l) => s + l.total, 0);
    const labor_subtotal = lines
      .filter((l) => l.kind === "labor")
      .reduce((s, l) => s + l.total, 0);
    const fees_subtotal = lines
      .filter((l) => l.kind === "fee")
      .reduce((s, l) => s + l.total, 0);
    const discount_subtotal = lines
      .filter((l) => l.kind === "discount")
      .reduce((s, l) => s + l.total, 0);
    const subtotal =
      parts_subtotal + labor_subtotal + fees_subtotal + discount_subtotal;
    const tax_rate = action.tax_rate ?? 0;
    const tax_amount = Math.round(subtotal * tax_rate * 100) / 100;
    const total = subtotal + tax_amount;
    const quote: Quote = {
      id,
      number,
      work_order_id: action.work_order_id,
      boater_id: "",
      status: "draft",
      line_items: lines,
      tax_rate,
      parts_subtotal,
      labor_subtotal,
      fees_subtotal,
      discount_subtotal,
      tax_amount,
      total,
      expires_at: action.valid_until,
    };
    QUOTES.unshift(quote);
    return id;
  }

  if (action.kind === "update_quote") {
    const idx = QUOTES.findIndex((q) => q.id === action.quote_id);
    if (idx === -1) return undefined;
    const existing = QUOTES[idx];
    if (existing.status !== "draft") return existing.id; // immutable past draft
    const lines = action.patch.line_items
      ? action.patch.line_items.map((l, i) => ({
          id: `${existing.id}_l${i}`,
          kind: l.kind,
          name: l.description,
          description: l.description,
          qty: l.qty,
          unit_price: l.unit_price,
          total: Math.round(l.qty * l.unit_price * 100) / 100,
        }))
      : existing.line_items;
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const tax_rate = action.patch.tax_rate ?? existing.tax_rate;
    const tax_amount = Math.round(subtotal * tax_rate * 100) / 100;
    QUOTES[idx] = {
      ...existing,
      line_items: lines,
      tax_rate,
      tax_amount,
      parts_subtotal: lines
        .filter((l) => l.kind === "part")
        .reduce((s, l) => s + l.total, 0),
      labor_subtotal: lines
        .filter((l) => l.kind === "labor")
        .reduce((s, l) => s + l.total, 0),
      fees_subtotal: lines
        .filter((l) => l.kind === "fee")
        .reduce((s, l) => s + l.total, 0),
      discount_subtotal: lines
        .filter((l) => l.kind === "discount")
        .reduce((s, l) => s + l.total, 0),
      total: subtotal + tax_amount,
    };
    return existing.id;
  }

  if (action.kind === "void_contract") {
    // Distinct from terminate_contract — void = "this draft never
    // existed". The closest available enum value is "terminated"; we
    // stamp the reason on the body markdown so it shows in audit.
    updateContract(action.contract_id, {
      status: "terminated",
      drafted_body_markdown: action.reason
        ? `[Voided] ${action.reason}`
        : "[Voided]",
    });
    return action.contract_id;
  }

  if (action.kind === "create_ledger_entry") {
    const entry: LedgerEntry = {
      id: nextLedgerId(),
      boater_id: action.boater_id,
      type: action.type,
      number:
        action.type === "invoice" ? nextInvoiceNumber() : undefined,
      date: action.date ?? new Date().toISOString().slice(0, 10),
      amount: action.amount,
      // Invoices carry an open balance; credits / adjustments zero out
      // immediately (they're posting entries, not receivables).
      open_balance: action.type === "invoice" ? action.amount : 0,
      method: null,
      status: action.type === "invoice" ? "open" : "paid",
      line_items: [{ description: action.description, amount: action.amount }],
      refund_notes: action.notes,
    };
    addLedgerEntry(entry);
    return entry.id;
  }

  if (action.kind === "draft_contract") {
    // Same shape as create_contract — the explicit "draft" intent only
    // matters for the audit row (the kind is what gets stored).
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
      drafted_body_markdown: action.notes,
      drafted_at: new Date().toISOString(),
    };
    addContract(contract);
    return contract.id;
  }

  if (action.kind === "navigate_to") {
    // No domain mutation — the chat host fires router.push(action.path)
    // separately when the operator clicks Approve. The audit row is still
    // written upstream (executeAgentAction → logAuditLocal) so we can see
    // which navigations the agent successfully nudged the operator into.
    return undefined;
  }

  if (action.kind === "schedule_reminder") {
    // Log a future-dated Communication entry. The dispatcher worker that
    // would actually fire it at due_at doesn't exist yet — for v1 this
    // surfaces via /notifications + the audit row. When the worker lands
    // it just polls this same table.
    const boater = BOATERS.find((b) => b.id === action.boater_id);
    const recipient =
      boater
        ? action.channel === "email"
          ? boater.primary_contact.email ?? "—"
          : boater.primary_contact.phone ?? "—"
        : "—";
    const id = `cm_sched_${Date.now()}`;
    const reminder: Communication = {
      id,
      boater_id: action.boater_id,
      type: action.channel,
      direction: "outbound",
      subject: action.subject ?? "Scheduled reminder",
      body_preview: action.body.slice(0, 80),
      full_body: action.body,
      sender_label: "Marina Stee Agent",
      sender_is_system: true,
      recipient,
      sent_at: action.due_at,        // future-dated; renders as "Scheduled" in feed
      status: "queued",               // the dispatcher worker (TBD) flips this to delivered
    };
    addCommunication(reminder);
    return id;
  }

  if (action.kind === "create_help_ticket") {
    // Build-side support ticket — distinct from /support (multi-tenant
    // boater→marina queue). Routes through the self-contained store in
    // lib/help-desk.ts so the /help page picks it up immediately.
    // Submitter is the active operator; for v1 that's a fixed identity
    // since Clerk isn't wired yet.
    const ticket = createHelpTicket({
      subject: action.subject,
      description: action.description,
      type: action.type,
      priority: action.priority,
      area: action.area,
      steps_to_reproduce: action.steps_to_reproduce,
      page_url: action.page_url,
      submitter_name: "Operator",
      submitter_email: "operator@marinastee.com",
    });
    return ticket.id;
  }
}

// ────────────────────────────────────────────────────────────
// W3 wave — local helpers shared between mock and audit branches
// ────────────────────────────────────────────────────────────

function bulkBillingRuleMatchesMock(
  c: Contract,
  rule: "annual_due_this_month" | "monthly_installment" | "seasonal_due_this_month",
  periodYm: string,
): boolean {
  if (rule === "annual_due_this_month") {
    if (c.billing_cadence !== "annual") return false;
    return (c.effective_start ?? "").slice(0, 7) === periodYm;
  }
  if (rule === "monthly_installment") {
    return c.billing_cadence === "monthly";
  }
  if (rule === "seasonal_due_this_month") {
    if (c.billing_cadence !== "seasonal") return false;
    return (c.effective_start ?? "").slice(0, 7) === periodYm;
  }
  return false;
}

function bulkBillingLabelForRule(
  rule: "annual_due_this_month" | "monthly_installment" | "seasonal_due_this_month",
): string {
  if (rule === "annual_due_this_month") return "Annual slip fee";
  if (rule === "monthly_installment") return "Monthly slip installment";
  if (rule === "seasonal_due_this_month") return "Seasonal slip fee";
  return "Bulk billing";
}

function bulkRenderTokens(template: string, b: Boater): string {
  if (!template) return "";
  return template
    .replace(/\{\{\s*boater\.first_name\s*\}\}/g, b.first_name)
    .replace(/\{\{\s*boater\.last_name\s*\}\}/g, b.last_name)
    .replace(/\{\{\s*boater\.display_name\s*\}\}/g, b.display_name)
    .replace(/\{\{\s*customer\.first_name\s*\}\}/g, b.first_name)
    .replace(/\{\{\s*customer\.display_name\s*\}\}/g, b.display_name)
    .replace(/\{\{\s*first_name\s*\}\}/g, b.first_name)
    .replace(/\{\{\s*last_name\s*\}\}/g, b.last_name)
    .replace(/\{\{\s*display_name\s*\}\}/g, b.display_name)
    .replace(/\{\{\s*marina\.short_name\s*\}\}/g, "Marina Stee");
}
