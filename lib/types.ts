// Marina Stee domain types — Customers (Boaters), Rentals, POS.
// Mock-data-friendly: all relations are id refs, resolved at the page layer.

export type StatusKey = "ok" | "warn" | "danger" | "info" | "neutral";

// ============================================================
// Multi-tenant foundation
// ============================================================
//
// Marina Stee is a multi-tenant SaaS — each tenant is one marina.
// Every customizable artifact (picklists, future custom fields, future
// layout configs) is scoped to a tenant. Core entities (Boater, Slip,
// Contract, etc.) are conceptually tenant-scoped too; in the prototype
// they aren't tagged individually because there's only one seeded
// tenant. When the backend lands, every WHERE clause + insert gets a
// `tenant_id` filter sourced from the authenticated session.

export interface Tenant {
  id: string;
  name: string;          // "Marina Stee — Damsite Cove"
  slug: string;          // url-safe key
  created_at: string;
}

// ── Marina profile (per-tenant operator config) ──────────────
//
// What every customer-facing surface needs about the marina: name,
// branding, address, contact, timezone, business hours, tax defaults.
// Settings → Marina Profile is the operator-facing editor; all read
// sites in the app should pull from here, not hard-coded strings.

export interface MarinaProfile {
  id: string;
  tenant_id: string;
  // Branding
  display_name: string;       // "Marina Stee · Damsite Cove"
  short_name: string;          // "Marina Stee"
  tagline?: string;            // shown on receipts + portal
  logo_url?: string;           // operator-uploaded; data URL in prototype
  // Contact
  email: string;
  phone: string;
  website?: string;
  // Address
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  // Operations
  timezone: string;            // "America/Denver"
  business_hours_open: string; // "08:00"
  business_hours_close: string;// "20:00"
  // Tax + accounting defaults
  default_tax_rate: number;    // 0..1 (e.g., 0.0825)
  accounting_close: "monthly_eom" | "monthly_15th" | "weekly_friday";
  // Outbound sender labels
  outbound_email_from_name: string; // "Marina Stee"
  outbound_sms_sender_label: string; // "MarinaStee"
  // Rental Club retention offer config — which save variants the
  // cancel sheet picks from. When undefined, all 3 are enabled. The
  // marina admin toggles these in Settings → Customization.
  enabled_retention_variants?: RetentionOfferVariant[];
  // ── Notification provider config (per-tenant overrides) ────
  //
  // Optional — when set, these win over the workspace POSTMARK_* /
  // TWILIO_* env vars in the dispatch layer so each marina can route
  // through its own Postmark account / Twilio number. Stored as
  // strings here because they're a mix of API keys, account SIDs,
  // and free-form labels; the dispatch layer's `resolvePostmarkConfig`
  // / `resolveTwilioConfig` validates shape at send time.
  //
  // `postmark_message_stream` defaults to "outbound" when unset.
  // `twilio_from_email_label` pairs with the from address — surfaced
  // in the marina-profile UI's "Notification providers" section as
  // the friendly sender name.
  postmark_api_key?: string;
  postmark_message_stream?: string;
  twilio_account_sid?: string;
  twilio_auth_token?: string;
  twilio_from_number?: string;
  twilio_from_email_label?: string;
}

// ── Communication templates ───────────────────────────────────
//
// System-generated comms (receipt, contract sent, COI reminder, etc.)
// pull their copy from these templates so operators can edit tone /
// branding without code. Each template has merge tokens that the
// dispatcher fills at send time — same {{token}} syntax as contract
// templates.

export type CommTemplateKind =
  | "receipt_pos_sale"
  | "receipt_annual_billing"
  | "contract_sent_for_signature"
  | "contract_signed_confirmation"
  | "coi_reminder"
  | "renewal_reminder"
  | "payment_failed"
  | "welcome_new_holder"
  | "waitlist_offer"
  | "rental_pickup_link"
  | "rental_return_receipt"
  | "service_complete";

export interface CommTemplate {
  id: string;
  tenant_id: string;
  kind: CommTemplateKind;
  name: string;                  // display name on the editor
  description?: string;          // what triggers this comm
  channel: "email" | "sms" | "voice"; // primary channel; system can override
  subject: string;               // for email; ignored on SMS
  body_markdown: string;         // template body with {{tokens}}
  active: boolean;               // off → fall back to hard-coded copy
  available_tokens: string[];    // hint shown on the editor
}

// ── Roles + permissions (Settings → Staff) ────────────────────
//
// Roles are tenant-scoped so each marina can define its own (e.g.,
// some marinas want a "Harbormaster" role, others want "Owner /
// Manager / Dockhand / Office"). Permissions are a flat list of
// action.entity keys (e.g., "create.contract", "refund.payment").

export type PermissionKey =
  | "manage.settings"
  | "manage.staff"
  | "manage.picklists"
  | "manage.catalog"        // POS catalog + fees + rates
  | "manage.marina_profile"
  | "create.boater"
  | "update.boater"
  | "delete.boater"
  | "create.contract"
  | "terminate.contract"
  | "create.work_order"
  | "complete.work_order"
  | "process.payment"
  | "refund.payment"
  | "run.annual_billing"
  | "manage.qb_sync"
  | "view.financials"
  | "view.reports";

export interface Role {
  id: string;
  tenant_id: string;
  name: string;                // "Super admin", "Manager", "Dockhand"
  description?: string;
  permissions: PermissionKey[];
  is_system: boolean;          // built-in role (can edit perms but not delete/rename)
  sort_order: number;
}

export interface StaffMember {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  phone?: string;
  role_id: string;             // → Role
  status: "invited" | "active" | "suspended";
  mfa_enabled: boolean;
  last_login_at?: string;
  created_at: string;
  // ── Staffing v1 — wage profile + clock-in identity ──
  // All optional so existing seeds type-check; a Staff Member can
  // log in (auth via Clerk in production) without any of these. The
  // payroll run only includes staff with at least one of hourly_rate
  // / salary_annual set.
  employment_type?: "w2" | "1099";
  hourly_rate?: number;          // $/hr — drives time-based payroll
  salary_annual?: number;        // $/yr — fixed salary, prorated per period
  ot_multiplier?: number;        // default 1.5 when hourly
  payment_method?: "direct_deposit" | "check" | "manual";
  bank_account_last4?: string;   // never store full account — last4 only
  bank_routing_last4?: string;
  hire_date?: string;            // ISO date
  default_position?: string;     // "Dockhand", "Manager" — shows on shift card
  pto_hours_balance?: number;    // snapshot, decremented on approved requests
  pto_accrual_hours_per_period?: number;
  /**
   * Optional 4-digit PIN for mobile clock-in/out on /dock. Stored
   * as plaintext in the prototype (real backend would hash it). When
   * unset, the staff member can't clock in from the PWA — they have
   * to use the web app's web clock-in.
   */
  mobile_clock_pin?: string;
  /** Driver's license, W-4, signed offer letter, etc. */
  attachment_ids?: string[];
  /** Set when staff record was created via AI doc-pack onboarding. */
  extracted_from_draft_id?: string;
}

// ── Staffing — shifts, time entries, payroll, PTO, certifications ──
//
// Every staffing entity is tenant-scoped via tenant_id. Time entries
// can be created without a Shift (ad-hoc) — the shift_id link is
// optional. Payroll calc rolls up TimeEntry per period and posts a
// Paystub per staff member to a single PayrollRun.

export type ShiftStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "missed"
  | "cancelled";

export interface Shift {
  id: string;
  tenant_id: string;
  staff_id: string;
  start_at: string;            // ISO datetime
  end_at: string;
  position: string;            // "Dockhand", "Harbormaster", "POS — Restaurant"
  status: ShiftStatus;
  notes?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Lifecycle status for a time entry. Optional on the type so legacy
 * seeds (which only carried clock_in/out + payroll_run_id) keep
 * type-checking; the time-clock UI defaults missing values via
 * `deriveTimeEntryStatus()`.
 *
 *   in_progress — clocked in, not paused, no clock_out yet
 *   paused      — on a lunch break (paused_at stamped)
 *   completed   — clocked out cleanly
 *   adjusted    — a manager edited clock_in/out post-hoc (audit-logged)
 */
export type TimeEntryStatus =
  | "in_progress"
  | "paused"
  | "completed"
  | "adjusted";

export interface TimeEntry {
  id: string;
  tenant_id: string;
  staff_id: string;
  clock_in_at: string;
  clock_out_at?: string;       // null while still clocked in
  break_minutes: number;       // unpaid break time
  /** Computed at clock_out time: (out - in - break) in hours, to 2 decimals. */
  calculated_hours?: number;
  shift_id?: string;
  payroll_run_id?: string;     // set once paid; locks the entry
  approved_at?: string;
  approved_by?: string;        // staff_id of the manager who approved
  notes?: string;
  source: "mobile" | "web" | "manual";
  created_at: string;
  // ── Time clock v2 — explicit lifecycle, lunch pauses, audit-friendly adjust ──
  /** Explicit status field. Optional for legacy seeds — derive when missing. */
  status?: TimeEntryStatus;
  /** When the dockhand tapped Pause (lunch break, etc.). Cleared on Resume. */
  paused_at?: string;
  /** Cumulative pause time in seconds (rolls forward across multiple pauses). */
  pause_seconds_total?: number;
  /** Optional override for the staff member's default_position on this shift. */
  position?: string;
  /** Staff id of the operator who adjusted a completed entry. */
  adjusted_by?: string;
  adjusted_at?: string;
  /** Pay period this entry rolls up into. Set when the period is closed. */
  payroll_period_id?: string;
}

export type PayrollPeriodStatus = "open" | "closed" | "paid";

/**
 * A bounded biweekly (or other cadence) window that aggregates TimeEntries
 * into a payable payroll run. Distinct from `PayrollRun` — a Period is the
 * window operators manage live (running totals, projected gross, anomaly
 * review), while a `PayrollRun` is the immutable artifact emitted once a
 * Period closes and money posts. The two are linked by `payroll_run_id`
 * once the period transitions `closed → paid`.
 */
export interface PayrollPeriod {
  id: string;
  tenant_id: string;
  start_date: string;          // ISO date
  end_date: string;
  status: PayrollPeriodStatus;
  closed_by?: string;
  closed_at?: string;
  paid_at?: string;
  /** Snapshot of the close — written when status flips open → closed. */
  total_gross?: number;
  total_hours?: number;
  /** Link to the PayrollRun emitted by this period (paystubs live there). */
  payroll_run_id?: string;
  created_at: string;
}

/**
 * Preview shape for paystub roll-ups inside an open period. Surfaces in
 * the Close-Period modal and the Payroll sub-tab's per-staff breakdown.
 *
 * Distinct from the persisted `Paystub` (which includes withholding
 * placeholders, employment-type snapshot, and an id). Tax + deduction
 * details are deferred to the actual payroll provider integration
 * (Gusto / Rippling) — this preview is gross only.
 */
export interface PaystubPreview {
  staff_member_id: string;
  period_id: string;
  regular_hours: number;
  overtime_hours: number;
  regular_pay: number;
  overtime_pay: number;
  tips_allocated?: number;
  gross: number;
}

export type PayrollRunStatus = "draft" | "approved" | "posted";

export interface PayrollRun {
  id: string;
  tenant_id: string;
  period_start: string;        // ISO date
  period_end: string;
  pay_date: string;
  status: PayrollRunStatus;
  total_gross: number;
  total_net: number;
  total_employer_taxes: number;
  gl_account: string;          // "Payroll Expense"
  qb_sync_status?: QbSyncStatus;
  qb_ref?: string;
  qb_synced_at?: string;
  created_at: string;
  posted_at?: string;
}

export interface Paystub {
  id: string;
  tenant_id: string;
  payroll_run_id: string;
  staff_id: string;
  hours_regular: number;
  hours_ot: number;
  hours_pto: number;
  gross: number;
  fed_withholding: number;     // stub — 0 in v1, ready for v2
  state_withholding: number;
  fica_employee: number;
  fica_employer: number;
  net: number;
  employment_type_snapshot: "w2" | "1099";
  created_at: string;
}

export type CertificationStatus = "current" | "expiring" | "expired";

export interface Certification {
  id: string;
  tenant_id: string;
  staff_id: string;
  name: string;                // "First Aid / CPR", "Marine Safety Cert"
  issuer?: string;
  issued_at: string;           // ISO date
  expires_at?: string;
  document_url?: string;
  notes?: string;
  /** AI-source docs (photo of cert, PDF). */
  attachment_ids?: string[];
  /** Set when this cert was created via AI extraction from a photo. */
  extracted_from_draft_id?: string;
}

export type PtoRequestStatus = "pending" | "approved" | "denied" | "cancelled";

export interface PtoRequest {
  id: string;
  tenant_id: string;
  staff_id: string;
  start_at: string;            // ISO date (or datetime for partial days)
  end_at: string;
  hours: number;
  reason?: string;
  status: PtoRequestStatus;
  decided_by?: string;
  decided_at?: string;
  notes?: string;
  created_at: string;
}

// ── Provider configs (Stripe / Postmark / Twilio stubs) ───────
//
// Real integrations land when the backend does. In the prototype these
// are settings the operator fills in via Settings → Connections, but
// the network calls aren't wired — they just persist config so the UI
// shows "connected" and the right downstream behavior unlocks.

export interface AppProviderConfig {
  id: string;
  tenant_id: string;
  kind: "payment" | "email" | "sms" | "accounting";
  provider:
    | "stripe"
    | "square"
    | "postmark"
    | "sendgrid"
    | "twilio"
    | "messagebird"
    | "quickbooks"
    | "xero";
  display_name: string;
  status: "disconnected" | "connected" | "needs_attention";
  // Provider-specific fields are stored in `config` (publishable key,
  // from-address, sender-id, account-id, etc.). At provision time the
  // server-side adapter knows what to expect for each provider.
  config: Record<string, string | number | boolean | null>;
  connected_at?: string;
  last_error?: string;
}

// ── Picklists ────────────────────────────────────────────────
//
// Per-tenant managed dropdown values. Each picklist owns the set of
// values that appear in dropdowns wired to a specific `field_key`
// (e.g., "vessel_type", "activity_type"). Archiving (not deleting)
// keeps historical records readable when the dropdown evolves.

/**
 * The 7 currently-configurable picklist field keys. Adding a new
 * picklist key here is the only code change needed — the Settings →
 * Customization UI auto-discovers any picklist the store carries.
 */
export type PicklistFieldKey =
  | "occupancy_type"        // RentalSpace inventory + Rate cards (legacy slip classification)
  | "slip_class"            // Slip pricing tier (covered/uncovered/T-head/buoy/dry)
  | "vessel_type"
  | "activity_type"
  | "event_type"
  | "rental_boat_type"
  | "contact_role"
  | "refund_reason"
  | "billing_cadence"       // Annual / Seasonal / Monthly / Transient
  | "reservation_type"      // Annual / Seasonal / Monthly / Transient / Recurring
  | "payment_method"        // Card / Cash / ACH / Charge to account / Split
  | "work_order_priority";  // High / Normal / Low

export interface PicklistValue {
  id: string;                // ten_xxx_pv_xxx
  value: string;             // stable code stored on records ("powerboat")
  label: string;             // display label, super-user editable ("Powerboat")
  sort_order: number;        // 0..N, drag-to-reorder
  archived: boolean;         // hidden from new-selection dropdowns, still rendered on existing records
}

export interface Picklist {
  id: string;                // ten_xxx_pl_xxx
  tenant_id: string;
  field_key: PicklistFieldKey;
  label: string;             // human label, e.g. "Vessel type"
  description?: string;      // shown on the Customization editor
  /** Whether super-user can reorder, add, archive. Always true for
   *  now — kept on the model so locked system picklists (status state
   *  machines) can be modeled later under the same UI. */
  editable: boolean;
  values: PicklistValue[];
}

export type BillingCadence = "annual" | "seasonal" | "monthly" | "transient";

export type CommunicationChannel = "email" | "sms" | "voice";

export type ContactRole = "self" | "spouse" | "captain" | "manager" | "other";

export interface Contact {
  id: string;
  name: string;
  role: ContactRole;
  email?: string;
  phone?: string;
  preferred_channel: CommunicationChannel;
  can_be_billed: boolean;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface CardOnFile {
  id: string;
  brand: "visa" | "mastercard" | "amex" | "discover" | "other";
  last4: string;
  exp_month: number;
  exp_year: number;
  nickname?: string;
  is_default: boolean;
  processor_token: string;
}

export interface Vessel {
  id: string;
  boater_id: string;
  co_owner_ids: string[];
  name: string;
  year?: number;
  make?: string;
  model?: string;
  color?: string;
  vessel_type?: "powerboat" | "sailboat" | "pontoon" | "houseboat" | "pwc" | "other";
  fuel_type?: "gasoline" | "diesel" | "electric" | "none";
  loa_inches?: number;        // length overall
  low_inches?: number;        // length over water
  beam_inches?: number;
  draft_inches?: number;
  height_inches?: number;
  hull_vin?: string;
  registration?: string;
  power_hp?: number;
  photo_url?: string;       // legacy single-photo field (kept for back-compat)
  photos?: string[];        // gallery — URLs ordered newest-first
  notes?: string;
  active: boolean;
  /**
   * Stamped by the Work Order closeout chain when a service WO transitions
   * to `completed`. Surfaces on the Vessel detail page as "Last serviced
   * {date}" so dockhands can spot a boat that's overdue for routine work.
   * ISO timestamp.
   */
  last_service_at?: string;
  /**
   * Back-reference to the WO that last touched the vessel. Closeout
   * chain only — manual edits never write this field. Lets the Vessel
   * detail rail render a "Last service: WO-0042" link without scanning
   * the full WO list.
   */
  last_service_wo_id?: string;
}

/*
 * Internal staff note attached to a boater. Distinct from Communication
 * (which is two-way and boater-visible) — these are STAFF ONLY and never
 * surface in the portal or get sent out.
 */
/*
 * MarinaEvent — non-reservation things on the calendar. Regattas, tournaments,
 * dock parties, fireworks, season opening/closing. Distinct from Reservation
 * (which is a slip booking) but rendered alongside on the existing calendar.
 */
export type MarinaEventType =
  | "social"        // dock party, raft-up, end-of-season
  | "tournament"    // fishing, sailing
  | "regatta"
  | "fireworks"
  | "season"        // opening / closing day
  | "maintenance"   // dredging window, dock work
  | "other";

export interface MarinaEvent {
  id: string;
  // Per-tenant calendar. Optional for legacy seed compatibility.
  tenant_id?: string;
  title: string;
  description?: string;
  event_type: MarinaEventType;
  start_date: string;       // ISO date (all-day) — start
  end_date: string;         // ISO date — inclusive end; same as start for one-day
  start_time?: string;      // HH:mm, optional (omitted = all day)
  end_time?: string;
  location?: string;        // "Damsite A Dock", "Pavilion", "Channel"
  capacity?: number;        // optional cap on RSVPs
  rsvp_boater_ids: string[]; // who's coming
  public_to_boaters: boolean; // true = surface on /portal calendar (TBD)
  created_at: string;
}

export interface StaffNote {
  id: string;
  boater_id: string;
  body: string;
  author_user_id: string;
  created_at: string;
  pinned: boolean;
}

export type WaitlistStatus = "pending" | "offered" | "converted" | "declined" | "withdrawn" | "expired";

/**
 * Auto-offer cascade — lifecycle of a single fired offer.
 *
 *   none        — never fired an offer (just sitting in the queue)
 *   pending     — offer minted + comm sent; the 48h timer is ticking
 *   accepted    — boater hit Accept on /apply/waitlist/[token]; the
 *                 entry status flips to "converted" and a draft Contract
 *                 spawns. Kept separately from status so the operator
 *                 panel can still display "won by accept" after the
 *                 boater is off-queue.
 *   declined    — boater hit Decline; the entry status drops to
 *                 "pending" so they remain on the waitlist (unless
 *                 they also asked to be removed) and the next-in-line
 *                 auto-advances.
 *   expired     — the 48h window lapsed; the cron walker stamps this
 *                 + auto-advances to the next candidate.
 */
export type WaitlistOfferStatus =
  | "none"
  | "pending"
  | "accepted"
  | "declined"
  | "expired";

export interface WaitlistEntry {
  id: string;
  // Per-tenant waitlist. Required-via-stamp because guest entries
  // (no boater_id) can't tenant-scope via the boater join. Optional
  // in the type for legacy seeds.
  tenant_id?: string;
  // Either an existing boater OR a prospect (guest_*) — never both.
  boater_id?: string;
  guest_name?: string;
  guest_email?: string;
  guest_phone?: string;
  // What they want
  preferred_arrival?: string; // ISO date
  preferred_departure?: string;
  loa_inches?: number;
  beam_inches?: number;
  preferred_dock?: string;
  reservation_type: "transient" | "monthly" | "seasonal" | "annual";
  notes?: string;
  status: WaitlistStatus;
  created_at: string;
  // When status === offered/converted, where it went
  offered_slip_id?: string;
  offered_at?: string;
  offer_expires_at?: string;       // ISO — typically offered_at + 24h (auto-offer cascade uses 48h)
  claim_token?: string;            // public URL token for /claim/[token]
  converted_reservation_id?: string;
  converted_contract_id?: string;  // when a holder accepted and started the onboarding chain

  // ── Auto-offer cascade (operator surface @ /services/roster) ─────────
  // Mirrors claim_token/offered_at/offer_expires_at above but kept
  // separate so the legacy /claim broadcast path keeps working unchanged.
  // The cascade walker (expireStaleOffers) advances to next-in-line by
  // reading offer_status + offer_expires_at.
  offer_token?: string;              // public URL token for /apply/waitlist/[token]
  offer_status?: WaitlistOfferStatus; // cascade lifecycle (independent of overall status)
  offer_responded_at?: string;       // ISO — when accept/decline landed
  // When the cascade was triggered by a batch ("fire to top 3"), every
  // sibling offer shares the same batch_id so audit + operator UI can
  // group them. Optional — single-recipient fires don't stamp one.
  offer_batch_id?: string;

  // ── Lifecycle tracking — powers the 4-tab Queue/Offers/Stale/Archive
  // operator surface. Real marinas have 500+ on the waitlist; without
  // these fields the operator can't tell who's gone cold vs who's
  // actively engaged.
  /** ISO — last time the operator (or agent) reached out via email/SMS/call.
   *  Drives the Stale tab. Bulk "check-in" actions stamp this. */
  last_contact_at?: string;
  /** Cumulative count of offers the applicant has declined. ≥3 typically
   *  signals the entry should be reviewed for archive. */
  decline_count?: number;
  /** ISO — when the entry was archived (operator action or auto-stale cron). */
  archived_at?: string;
  /** Why it was archived — visible in the Archive tab. */
  archive_reason?:
    | "got_slip"
    | "withdrew"
    | "aged_out"
    | "non_responder"
    | "too_many_declines"
    | "duplicate";
  /** Operator-applied tags — e.g. "covered-priority", "references-checked",
   *  "board-recommendation", "VIP". Used by filter bar + bulk actions. */
  tags?: string[];

  /**
   * ISO — when the OPERATOR manually marked that they've spoken to the
   * applicant and confirmed they still want a slip. Gate for the
   * "Convert to slip holder" action so the wizard isn't fired before
   * outreach. Typically set after a phone call or after the applicant
   * replies to a "still interested?" message. The fire-offer cascade
   * still works without this — `interest_confirmed_at` only gates the
   * direct-convert path, not the offer flow.
   */
  interest_confirmed_at?: string;

  /**
   * Free-form note the operator captures when stamping
   * `interest_confirmed_at` — e.g. "Spoke at 2pm, ready to move forward".
   * Optional.
   */
  interest_confirmation_note?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Boater applications — public self-onboarding queue
//
// Today boaters become customers via the operator-side `create_boater`
// action. Real marinas have a public-facing apply flow: prospective boater
// fills in vessel info + contact + target slip class on /apply, the app
// validates + queues the submission, and the operator works the queue from
// /members → Applications.
//
// On Approve, the application mints a Boater + Vessel (with back-ref
// `result_boater_id`) and drafts a welcome comm. On Decline, the entry
// stamps `reviewed_at` + drafts a polite decline comm. On Route-to-waitlist,
// it calls into H1's waitlist flow and stamps `result_waitlist_entry_id`.
//
// `application_token` is the boater-facing magic-link slug used by
// /apply/[token] for status-check. Tokens may rotate; the lookup helper
// guards against expired tokens.

export type ApplicationStatus =
  | "pending"        // submitted, queue hasn't picked it up
  | "under_review"   // operator opened it but hasn't decided
  | "approved"       // boater created, welcome comm sent
  | "declined"       // operator declined; reason in internal_review_notes
  | "waitlisted";    // routed to H1's waitlist via result_waitlist_entry_id

export type ApplicationSlipClass =
  | "covered"
  | "uncovered"
  | "T-head"
  | "buoy"
  | "dry";

export interface Application {
  id: string;
  tenant_id?: string;       // stamped on insert via addApplication
  number: string;           // "APP-1004" — sequential per tenant
  status: ApplicationStatus;

  // Applicant
  applicant_first_name: string;
  applicant_last_name: string;
  applicant_email: string;
  applicant_phone: string;
  applicant_address?: string;

  // Vessel
  vessel_name: string;
  vessel_year?: number;
  vessel_make: string;
  vessel_model: string;
  vessel_loa_inches: number;
  vessel_beam_inches?: number;
  vessel_draft_inches?: number;

  // Slip preferences
  preferred_slip_class?: ApplicationSlipClass;
  preferred_dock?: string;
  desired_start_date?: string;

  // Lifecycle
  source: "public_apply" | "agent" | "manual";
  application_token: string;
  notes?: string;                     // applicant-supplied free text
  internal_review_notes?: string;     // operator-only, surfaces on decline copy
  reviewed_by?: string;
  reviewed_at?: string;
  result_boater_id?: string;          // back-ref after approval
  result_waitlist_entry_id?: string;  // back-ref when routed to waitlist
  submitted_at: string;
}

export interface InsuranceCertificate {
  id: string;
  vessel_id: string;
  boater_id: string;       // denormalized for fast lookups
  carrier: string;         // "BoatU.S. Insurance"
  policy_number: string;
  liability_limit: number; // dollars
  hull_value?: number;     // optional, for hull coverage
  effective_start: string; // ISO date
  effective_end: string;   // ISO date — the field we alert on
  pdf_url?: string;
  uploaded_at: string;
  uploaded_by: "marina" | "boater"; // who submitted it
  // Renewal request chain — same pattern as contract/booking tokens.
  // Staff (or auto-trigger on expiry alert) hits "Request renewal,"
  // which mints upload_token + dispatches a Comm with the public
  // /coi-upload/[token] URL. Boater uploads the new PDF → a new
  // InsuranceCertificate is created and the original entry's
  // renewed_by_coi_id back-links to it.
  upload_token?: string;
  // ISO timestamp at which `upload_token` becomes invalid. Set 7 days
  // out from token mint by default. Lookups MUST check this — a stale
  // token must reject so an attacker who scrapes an old reminder email
  // can't replace a current COI.
  upload_token_expires_at?: string;
  upload_link_sent_at?: string;
  upload_link_viewed_at?: string;
  renewed_by_coi_id?: string;
}

/**
 * Physical slip class — drives the default annual rate. Marinas
 * typically price by amenity tier (covered/uncovered/T-head/buoy/dry)
 * rather than by length alone, so the class is the primary lookup
 * and length is the constraint check.
 */
export type SlipClass =
  | "covered"          // roof — top-tier indoor protection
  | "uncovered"        // standard dock slip, open
  | "t_head"           // end-of-dock with extra clearance + premium pricing
  | "buoy"             // mooring ball
  | "dry_storage";     // out of water, indoor or yard

// Docks are first-class. Marinas can have multiple — Damsite A/B/C,
// PWC float, transient dock, dry storage building. Each owns a set of
// slips. Operators edit docks in Settings → Customization → Docks; the
// prefix drives slip-id generation, the sort_order controls display order.

export interface Dock {
  id: string;
  tenant_id: string;
  name: string;             // "Damsite A Dock"
  short_name: string;       // "A Dock"  — shown in compact rows + chips
  prefix?: string;          // "A"  → drives slip-id generation
  sort_order: number;
  active: boolean;
  // Optional metadata for future surfaces (visual map, capacity reports)
  notes?: string;
}

export interface Slip {
  id: string;              // e.g. "A29"
  // Per-tenant inventory. Stamped on every new slip; optional for
  // legacy seeds that predate the field.
  tenant_id?: string;
  dock_id: string;         // FK → Dock — canonical association
  dock: string;            // denormalized display name (kept in sync)
  invoice_category: string; // e.g. "BOGGS Cove"
  number: string;          // e.g. "29"
  max_loa_inches: number;
  max_beam_inches: number;
  has_power: boolean;
  has_water: boolean;
  // ── Annual pricing baked into the slip itself.
  // The slip *is* the SKU for annual lease — staff doesn't pick a
  // separate rate card. Each slip has a class (covered/uncovered/...)
  // and a default_annual_rate that the assignment wizard pre-fills.
  // Staff can still override the rate per-contract (discounts, special
  // arrangements) but the default lives here.
  slip_class: SlipClass;
  default_annual_rate: number;      // dollars / year
  default_monthly_rate?: number;    // optional — for split billing
  default_seasonal_rate?: number;   // 6mo
}

export type ReservationStatus = "scheduled" | "occupied" | "completed" | "cancelled";
export type ReservationType = "annual" | "seasonal" | "monthly" | "transient" | "recurring";

export interface Reservation {
  id: string;
  number: string;           // R513
  seq: string;              // "1/2"
  boater_id: string;
  vessel_id: string;
  slip_id: string;
  contract_id?: string;
  arrival_date: string;
  departure_date: string;
  status: ReservationStatus;
  type: ReservationType;
  /**
   * Service fees attached at booking time. References AdditionalFee.id.
   * Rolled up via totalFromAttachedFees() helper. Optional so legacy
   * seeds without fees type-check.
   */
  attached_fee_ids?: string[];
}

export type LedgerEntryType = "invoice" | "payment" | "refund" | "credit" | "adjustment";

export type LedgerEntryStatus =
  | "open"
  | "paid"
  | "partial"
  | "void"
  | "refunded"
  | "partial_refund"
  | "pending"
  | "processing"
  | "failed";

export type PaymentMethod =
  | "card"
  | "ach"
  | "check"
  | "cash"
  | "fuel_charge"
  | "restaurant_charge"
  | "ship_store_charge"
  | "credit_applied"
  | null;

export type RefundReason =
  | "cancellation"
  | "club_cancellation"            // mid-month Rental Club cancel → pro-rate refund
  | "dispute"
  | "goodwill"
  | "weather_credit"
  | "duplicate"
  | "other";

export type QbSyncStatus = "pending" | "syncing" | "synced" | "error" | "skipped";

export interface LedgerEntry {
  id: string;
  boater_id: string;
  type: LedgerEntryType;
  number?: string;            // MG5507 for invoices
  date: string;
  amount: number;             // positive for invoices/payments, negative for refunds/credits
  open_balance: number;
  method: PaymentMethod;
  applied_to_invoice_ids?: string[];   // for payments
  applied_payment_id?: string;          // for refunds
  refund_reason?: RefundReason;
  refund_notes?: string;
  issued_by_user_id?: string;
  processor_ref?: string;
  status: LedgerEntryStatus;
  line_items?: { description: string; amount: number }[];
  // Cross-platform connections — keep these populated whenever the
  // mutator creating the ledger row knows the source. The LedgerEntry
  // drawer renders one Source section per linked entity; substring
  // matching on line_items is a last resort (and the historical fragility).
  linked_work_order_id?: string;
  linked_quote_id?: string;
  linked_pos_order_id?: string;
  linked_reservation_id?: string;
  linked_contract_id?: string;
  linked_boat_rental_id?: string;
  linked_club_subscription_id?: string;
  // Club bookings the invoice covers (membership monthly invoices
  // roll up the days that consumed the allotment). Multiple per row.
  linked_club_booking_ids?: string[];
  // QuickBooks sync
  qb_sync_status?: QbSyncStatus;
  qb_ref?: string;            // QB document id like "QB-INV-1042"
  qb_error?: string;
  qb_synced_at?: string;
  gl_account?: string;        // "Fuel Sales", "Slip Fee Revenue", "Retail Sales", "Restaurant", "Services", "A/R"
}

export type WorkOrderStatus =
  | "open"
  | "scheduled"
  | "in_progress"
  | "blocked"
  | "completed"
  | "cancelled";

export type WorkOrderPriority = "low" | "normal" | "high" | "urgent";

export type WorkOrderActivityType =
  | "winterization"
  | "bottom_paint"
  | "service"
  | "inspection"
  | "haul_out"
  | "pump_out"
  | "task"          // staff todo — "call John re renewal", "order new dock lines"
  | "other";

/**
 * Coarse bucket above `activity_type` — drives wizard UX branching.
 * Cleaning gets a checklist editor + a recurrence block (weekly fleet
 * cleaning programs), and is always tied to a club booking or a paid
 * boat rental. Service is the catch-all for owner-vessel work tied to
 * an existing holder or a walk-in. Adopted from DockLog's discriminator
 * pattern but rolled in one level above the existing fine-grained
 * activity_type so we don't lose information already encoded there.
 */
export type WorkOrderClass = "service" | "cleaning";

/**
 * Cadence for auto-spawning the next work order in a recurring chain.
 * Marina-side seasonal services (winter haul, summer launch) and
 * lift/storage rotations sit on yearly cycles; cleaning programs run
 * on weekly/monthly cadences.
 */
export type RecurringSchedule =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "bi_yearly"
  | "yearly";

/**
 * Single line on the cleaning-WO checklist. `completed_by` and
 * `completed_at` are stamped when a deckhand marks the row done from
 * the WO detail surface — both stay undefined on creation so a fresh
 * checklist renders entirely uncompleted.
 */
export interface WorkOrderChecklistItem {
  id: string;
  label: string;
  completed_by?: string;   // staff user id
  completed_at?: string;   // ISO timestamp
}

export interface WorkOrder {
  id: string;
  number: string;                   // "WO-0042"
  boater_id: string;
  vessel_id?: string;
  slip_id?: string;
  subject: string;
  description?: string;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  assignee_user_id?: string;
  start_date?: string;
  end_date?: string;
  due_date?: string;
  activity_type?: WorkOrderActivityType;
  /**
   * Coarse work class above activity_type. Required — every WO has a
   * class. Existing seeds default to "service"; cleaning surfaces the
   * checklist editor and the recurrence block (fleet cleaning programs).
   */
  work_class: WorkOrderClass;
  /**
   * Operator's ballpark before a formal Quote is drafted. Stored in
   * dollars (matches the rest of the LedgerEntry surface — see
   * QuoteLineItem.total below). Optional because the operator may
   * defer pricing entirely to the linked Quote.
   */
  estimated_total?: number;
  /** Planned labor hours, decimal — drives schedule load forecasting. */
  estimated_hours?: number;
  /** True when this WO is part of a recurring chain. */
  is_recurring?: boolean;
  /** Cadence; only meaningful when is_recurring is true. */
  recurring_schedule?: RecurringSchedule;
  /**
   * ISO date of the next auto-spawn. Derived on create from
   * start_date + recurring_schedule by the WO action handler so the
   * recurrence engine has a stable trigger point.
   */
  recurring_next_date?: string;
  /**
   * Cleaning checklist — only populated for work_class === "cleaning".
   * Seeded from DEFAULT_CLEANING_CHECKLIST when the operator doesn't
   * customize.
   */
  checklist?: WorkOrderChecklistItem[];
  /**
   * Staff-only thread separate from `description` (which is the
   * customer-facing scope). Keeps tech notes / dispatcher remarks
   * from leaking onto a portal-visible Quote.
   */
  internal_notes?: string;
  /**
   * Structured back-reference for cleaning work orders. Replaces the
   * legacy `Source: <label> <id>` prefix on `internal_notes` (which is
   * still written for back-compat — operators may have edited those
   * lines and we don't want to lose data on read). Lookup pattern:
   *
   *   workOrders.filter(w =>
   *     w.work_class === "cleaning" &&
   *     w.cleaning_source_id === bookingOrRentalId
   *   )
   *
   * lets every booking surface (Bookings kanban, Club Calendar, etc.)
   * show a "Cleaning · open/scheduled/done" chip without string-parsing
   * the notes field. Only populated for `work_class === "cleaning"`.
   */
  cleaning_source_kind?: "club_booking" | "paid_rental";
  cleaning_source_id?: string;
  /**
   * IDs into the attachment store — reuses the Contract attachment
   * pattern (see Contract.attachments above) so the upload pipeline
   * is shared. Empty/undefined when no photos or PDFs attached.
   */
  attachment_ids?: string[];
  billable_minutes?: number;
  flagged?: boolean;
  quote_id?: string;                // linked quote
  linked_ledger_entry_ids?: string[];
  /**
   * Origin of the work order. "holder_portal" means the boater submitted
   * it through their portal — surfaces as a "From holder" badge on the
   * WO kanban so staff can spot inbound requests at a glance.
   */
  submitted_via?: "holder_portal" | "staff" | "agent";
  /** Stamped when submitted_via=holder_portal — operator-visible audit. */
  submitted_at?: string;
  /**
   * ISO timestamp stamped by the closeout chain the first time this WO
   * transitions to `status="completed"`. Idempotency guard: closeout
   * short-circuits when this is already set, so a re-complete (operator
   * undoes + re-marks) doesn't double-invoice the linked quote or
   * double-dispatch the completion comm. Clearing this field manually
   * is the operator's "rerun closeout" escape hatch.
   */
  closed_out_at?: string;
}

// ============================================================
// Quote (lives inside Work Order)
// ============================================================

export type QuoteStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "signed"
  | "expired"
  | "invoiced"
  | "voided";

export type QuoteLineKind = "part" | "labor" | "fee" | "discount";

export interface QuoteLineItem {
  id: string;
  kind: QuoteLineKind;
  name: string;
  description?: string;
  qty: number;
  unit_price: number;
  total: number;                    // qty * unit_price, signed (-) for discounts
}

export interface Quote {
  id: string;
  number: string;                   // "Q-0042"
  work_order_id: string;
  boater_id: string;
  status: QuoteStatus;
  line_items: QuoteLineItem[];
  tax_rate: number;                 // 0..1, e.g. 0.0667 for 6.667%
  parts_subtotal: number;           // derived but stored for fast render
  labor_subtotal: number;
  fees_subtotal: number;
  discount_subtotal: number;
  tax_amount: number;
  total: number;
  sent_at?: string;
  viewed_at?: string;
  signed_at?: string;
  signer_name?: string;
  signature_data_url?: string;      // base64 PNG when mocked
  signature_token?: string;         // tokenized URL for /sign/<token>
  expires_at?: string;
  payment_method?: "card" | "cash" | "charge_to_account" | "split" | null;
  paid_at?: string;
  linked_invoice_ledger_entry_id?: string;
  linked_payment_ledger_entry_id?: string;
}

export type CommunicationDirection = "outbound" | "inbound";

export type CommunicationStatus =
  | "queued"
  | "sending"
  | "delivered"
  | "opened"
  | "clicked"
  | "replied"
  | "bounced"
  | "failed";

export interface Communication {
  id: string;
  boater_id: string;
  type: CommunicationChannel;
  direction: CommunicationDirection;
  subject?: string;             // emails
  body_preview: string;
  full_body?: string;
  sender_label: string;          // "Sync, Service" | "Peterson, Tiffany"
  sender_is_system: boolean;
  recipient: string;
  sent_at: string;
  status: CommunicationStatus;
  related_entity?: {
    // Comm targets the customer can "Open" from the modal.
    // `boat_rental` covers Rental Club check-in receipts where no
    // invoice is posted (subscription covered the day).
    // `club_subscription` covers retention + reactivation messages.
    // `club_booking` covers booking-confirm + check-in comms (task #22).
    // `pos_order` covers POS receipts so the customer can drill back.
    type:
      | "invoice"
      | "contract"
      | "reservation"
      | "work_order"
      | "boat_rental"
      | "club_subscription"
      | "club_booking"
      | "pos_order";
    id: string;
  };
}

export type ContractTemplateType =
  | "annual"
  | "annual_slip"
  | "seasonal_slip"
  | "transient_slip"
  | "dry_storage"
  | "mooring"
  | "rental"
  | "winterization"
  | "service";

export interface ContractTemplate {
  id: string;
  // Per-tenant template library. Each marina edits its own body
  // markdown, branding, and merge fields.
  tenant_id?: string;
  name: string;
  type: ContractTemplateType;
  version: number;
  default_term_months: number;
  default_billing_cadence: BillingCadence;
  default_annual_rate?: number;
  body_preview: string;
  required_signers: ("boater" | "manager" | "witness")[];
  auto_renew: boolean;
  /**
   * Uploaded source document (PDF or DOCX). Base64 data URL in the
   * prototype; an S3-backed URL once the backend lands.
   */
  source_file_url?: string;
  source_file_name?: string;
  source_file_type?: "pdf" | "docx";
  /**
   * Merge fields extracted from the uploaded document, surfaced so staff
   * can confirm tokens before sending. Example: ["boater.legal_name",
   * "slip.number", "contract.annual_rate"].
   */
  detected_merge_fields?: string[];
  /**
   * Raw template body (markdown). Used as the source for AI-drafted
   * contracts — merge tokens like {{boater.display_name}} are filled
   * by the /api/draft-contract route and the result is stored on the
   * Contract as `drafted_body_markdown`.
   */
  body_markdown?: string;
}

export type ContractStatus =
  | "draft"
  | "sent"
  | "partially_signed"
  | "executed"
  | "active"
  | "expired"
  | "terminated"
  | "renewed";

export interface Contract {
  id: string;
  number: string;
  boater_id: string;
  template_id: string;
  template_version: number;
  vessel_id?: string;
  slip_id?: string;
  status: ContractStatus;
  effective_start: string;
  effective_end: string;
  signed_at?: string;
  annual_rate?: number;
  billing_cadence: BillingCadence;
  signed_pdf_url?: string;
  renewed_into_contract_id?: string;
  superseded_by_id?: string;
  /**
   * Per-contract attachments (signed PDF, addenda, supporting docs).
   * Stored as base64 data URLs in the prototype; S3-backed once the
   * backend lands.
   */
  attachments?: ContractAttachment[];
  /**
   * Signature + onboarding state. signature_token mints the public
   * /onboard/[token] URL so a holder can complete signature + payment
   * setup in one boater-facing flow. signed_at is declared above.
   */
  signature_token?: string;
  signer_name?: string;
  signature_data_url?: string;        // base64 PNG of signature pad
  signer_ip?: string;                  // captured for audit
  /**
   * AI-drafted contract body (markdown). Populated by the
   * /api/draft-contract route at wizard-submit time. Renders in the
   * Document section so staff (and the boater on /onboard) can read
   * the actual filled contract before signing.
   */
  drafted_body_markdown?: string;
  drafted_at?: string;                 // ISO timestamp of the draft
  /**
   * Per-step onboarding progress. Drives the staff-side progress rail.
   * Each field is set to the ISO timestamp when the step completed; a
   * step is "done" iff its timestamp is present.
   */
  onboarding?: ContractOnboardingProgress;
  /**
   * Service fees attached at draft time and carried forward onto the
   * persisted Contract. References AdditionalFee.id. The slip wizard
   * mints this from its draft `selectedFeeIds` field on submit.
   */
  attached_fee_ids?: string[];
}

export interface ContractOnboardingProgress {
  link_sent_at?: string;     // outbound Communication dispatched
  link_viewed_at?: string;   // holder opened /onboard/[token]
  signed_at?: string;        // signature captured
  card_added_at?: string;    // payment method on file
  coi_uploaded_at?: string;  // COI uploaded (optional gate)
  welcomed_at?: string;      // holder completed welcome step
}

export interface ContractAttachment {
  id: string;
  name: string;
  type: "signed_contract" | "addendum" | "supporting_doc" | "other";
  url: string;            // data URL in mock; S3 URL in prod
  mime_type: string;
  size_bytes?: number;
  uploaded_at: string;
  uploaded_by?: string;
}

export interface Boater {
  id: string;
  // Tenant scope — defaults to the primary tenant for legacy seed
  // records that predate this field. New boaters get assigned at
  // creation time. useBoaters() filters by currentTenantId so the
  // /members surface stays scoped per marina.
  tenant_id?: string;
  display_name: string;       // "Emmons, David"
  legal_name?: string;        // only if different (LLC, trust)
  first_name: string;
  last_name: string;
  code?: string;              // "DSM A29" — slip-encoded shorthand
  photo_url?: string;
  active: boolean;
  billing_cadence: BillingCadence;
  tags: string[];
  trust_score?: number;       // 0..100, derived
  last_seen_at?: string;
  communication_prefs: {
    preferred_channel: CommunicationChannel;
    do_not_contact_before?: string; // HH:mm
    do_not_contact_after?: string;
    language: string;
  };
  primary_contact: Contact;
  additional_contacts: Contact[];
  address: Address;
  shipping_address?: Address; // only when different
  notes?: string;
  /**
   * Long-lived magic-link token for this boater's portal session. The
   * marina sends this once at onboarding (SMS/email); the holder taps
   * it once → persistent session is stored in localStorage and the
   * holder never sees a login screen again. Rotating this invalidates
   * the holder's session (think "log out all devices").
   *
   * Optional in the type because legacy seed factories don't supply it;
   * `attachPortalToken` in mock-data.ts derives one for every boater
   * before the BOATERS array is exported, so at runtime every boater
   * is guaranteed to have a token.
   */
  portal_token?: string;
}

export interface User {
  id: string;
  name: string;               // "Peterson, Tiffany"
  role: "manager" | "dockhand" | "accounting" | "system";
}

// ============================================================
// Rentals domain
// ============================================================

export type RentalGroupType =
  | "slips"
  | "jet_ski"
  | "buoy"
  | "dry_storage"
  | "mooring"
  | "day_rental";

// Renamed in UI to "Service Type" (operators think of these as the
// kinds of services the marina sells). Internal type name kept as
// `OccupancyType` to avoid a noisy refactor; `ServiceType` is exported
// as an alias for new code that prefers the user-facing term.
//
// "Rental Club" is new: members pay a join fee + monthly subscription
// and book days against the club's fleet. See ClubSubscription below.
export type OccupancyType =
  | "Standard"
  | "Jet Ski"
  | "Buoy"
  | "Dry Storage"
  | "Mooring"
  | "Rental Club";
export type ServiceType = OccupancyType;

export type SpaceStatus = "vacant" | "occupied" | "reserved" | "out_of_service";

export interface RentalGroup {
  id: string;
  tenant_id?: string;
  name: string;                 // "Damsite A Dock", "Damsite Buoy"
  type: RentalGroupType;
  check_in_time: string;        // "12:00 AM" formatted
  check_out_time: string;
  total_spaces: number;         // denormalized for fast list rendering
  occupied_spaces: number;
  notes?: string;
}

export interface RentalSpace {
  id: string;                   // "DSM-A-29"
  // Scoped by group_id → RentalGroup.tenant_id at runtime, but
  // stamped here too so direct queries don't need the join.
  tenant_id?: string;
  group_id: string;
  number: string;               // "01", "29", "JS-04"
  occupancy_type: OccupancyType;
  length_inches?: number;
  beam_inches?: number;
  draft_inches?: number;
  height_inches?: number;
  has_power: boolean;
  has_water: boolean;
  has_pump_out: boolean;
  active: boolean;
  status: SpaceStatus;
  current_reservation_id?: string;
  meter_id?: string;
}

export type RateCadence = "daily" | "weekly" | "monthly" | "seasonal" | "annual" | "one_time";

export interface Rate {
  id: string;
  // ── Tenancy ──
  // Optional in the type so legacy seed rows that predate the field
  // continue to type-check; the store treats `undefined` as belonging
  // to the first tenant (legacy default). Every new Rate written by
  // the catalog UI or by agent tools gets stamped at write time.
  tenant_id?: string;
  name: string;                 // "2026 Annual Slip — Standard"
  occupancy_type: OccupancyType;
  cadence: RateCadence;
  amount: number;               // for club plans this is the MONTHLY fee
  applies_to_group_ids?: string[]; // omitted = all groups of that occupancy type
  // ── Rental Club plan fields ──
  // Only meaningful when occupancy_type === "Rental Club" AND
  // cadence === "monthly". The Rate row IS the plan; ClubSubscription
  // references it by id. amount = monthly_fee.
  //
  // Setup / join fees used to live here as `join_fee`. That duplicated
  // the service-fee catalog — each tier embedded a fee that operators
  // couldn't also surface in the unified add-on multi-select. They
  // now live as their OWN Rate rows in the catalog, one per tier
  // (cadence: "one_time", plan_tier matching the parent tier). The
  // setup fee for a given plan is found by looking up the one-time
  // Rental Club rate whose plan_tier matches — see
  // `getSetupRateForTier()` in lib/client-store.ts.
  days_per_month?: number;      // booking allotment per calendar month
  // Plan tier ranking — drives the cancel-sheet downgrade variant
  // (premium → plus → basic) AND links a one-time setup-fee Rate to
  // its parent monthly plan. Operator edits the value on the Rate row
  // in the Services catalog; not displayed elsewhere.
  plan_tier?: ClubPlanTier;
}

/**
 * Fees are the canonical SKU table. Other entities (work orders, contract
 * templates, boat rentals, POS) reference a fee by id and ride its current
 * values. Editing a fee's amount flows everywhere automatically.
 */
export type FeeRecurrence =
  | "one_time"
  | "monthly"
  | "annual";

/**
 * Where a fee surfaces in the UI / when it gets auto-attached.
 *  - slip_contract: appears in the assign-slip wizard's Services step
 *  - work_order: auto-attached on WO closeout when linked_activity_type matches
 *  - boat_rental: auto-attached on rental closeout when auto_attach is true
 *  - pos: appears as a Service-Fee tile in the POS terminal palette
 *  - annual_billing_run: appears on every annual-cadence invoice when applicable
 */
export type FeeAppliesTo =
  | "slip_contract"
  | "work_order"
  | "boat_rental"
  | "pos"
  | "annual_billing_run";

export interface AdditionalFee {
  id: string;
  // Tenancy — optional in the type so legacy seed rows without it
  // type-check; the store treats `undefined` as primary-tenant via
  // the same fallback used by Rate / RentalBoat. Stamped on every
  // mutator write.
  tenant_id?: string;
  name: string;                 // "Hoist Fee", "Transfer Fee", "Pump-out"
  description?: string;
  amount: number;
  /**
   * One-time vs monthly vs annual. Annual fees with applies_to including
   * "annual_billing_run" get rolled into every annual-cadence invoice.
   */
  recurrence: FeeRecurrence;
  /**
   * Scope: which surfaces this fee is available to and which closeouts
   * auto-attach it. Use at least one entry — fees with empty applies_to
   * are catalog-only.
   */
  applies_to: FeeAppliesTo[];
  accounting_line_item: string; // "2025/2026 Marina Del Sur Slip Fees"
  applies_to_group_ids?: string[];
  /**
   * When set, this fee is the SKU for a Work Order activity. Completing a
   * WO of the matching activity_type appends this fee as a line item on
   * the closeout invoice (no manual quote editing needed).
   */
  linked_activity_type?: WorkOrderActivityType;
  /**
   * When set, this fee is the priced service for a Contract Template (e.g.
   * the Winterization template's price flows from here, not the template
   * itself). Editing fee.amount updates every future contract drafted from
   * the linked template.
   */
  linked_template_id?: string;
  /**
   * When applies_to includes a closeout scope (work_order / boat_rental),
   * auto_attach controls whether the fee silently appends to the invoice
   * or just becomes available for staff to opt in. Default: true.
   */
  auto_attach?: boolean;
  /**
   * Billing cadence for unified service fees. Independent of `recurrence`
   * (which is the historical SKU-level recurrence flag). Used by booking
   * entities (reservation/contract/club_subscription) to roll up
   * one-time vs ongoing charges in a single helper. Defaults semantically
   * to "one_time" when undefined.
   */
  cadence?: "one_time" | "monthly" | "annual";
  /**
   * Marks this fee as a refundable hold (deposit) rather than a billed
   * charge. Authorized on the renter's card at pickup, released on safe
   * return. UI treats deposit-flagged fees as the special "required
   * deposit" attachment on rental boats / slip contracts and pulls
   * the amount into the entity's deposit_amount field on save.
   */
  is_deposit?: boolean;
  /**
   * Booking-entity surfaces this fee is offered on. When undefined the
   * fee is available to all three entities (reservation, contract,
   * club_subscription). `applies_to` (above) is the original closeout/
   * surface scope; this new field narrows the booking-entity attach UI
   * without disturbing legacy POS/work-order auto-attach behavior.
   */
  applies_to_entities?: (
    | "reservation"
    | "contract"
    | "club_subscription"
    | "rental_boat"
  )[];
}

export interface MeterReading {
  id: string;
  // Scoped via space_id → RentalSpace, but stamped here too because
  // utility-billing reports filter readings directly.
  tenant_id?: string;
  space_id: string;
  meter_number: string;         // "01-", "02-A"
  current_reading: number;
  current_ts: string;
  prev_reading: number;
  prev_ts: string;
  rate_per_unit?: number;       // $/kWh or $/gallon (water)
  unit?: "kWh" | "gallons";
  photo_url?: string;
  billed_into_invoice_id?: string;
}

export type FuelType = "gasoline" | "diesel";

export interface FuelInventory {
  id: string;
  // Per-tenant fuel program — Lakeside's tanks are physically and
  // financially independent from Marina Stee's.
  tenant_id?: string;
  fuel_type: FuelType;
  tank_capacity_gallons: number;
  current_level_gallons: number;
  current_price_per_gallon: number;
  cost_per_gallon: number;
  reorder_threshold_pct: number; // 0..100
  last_updated_at: string;
}

export interface FuelDelivery {
  id: string;
  tenant_id?: string;
  fuel_type: FuelType;
  delivery_date: string;
  gallons_delivered: number;
  cost_per_gallon: number;
  total_cost: number;
  supplier: string;
  notes?: string;
}

export interface FuelSale {
  id: string;
  // Required because patron_id fuel sales (walk-up) have no boater
  // join to inherit tenant from.
  tenant_id?: string;
  fuel_type: FuelType;
  gallons: number;
  price_per_gallon: number;
  total: number;
  sold_at: string;
  pedestal_id?: string;
  space_id?: string;
  boater_id?: string;           // when charged to boater account
  patron_id?: string;           // walk-in
  payment_method: "card" | "cash" | "charge_to_account";
}

// ============================================================
// Boat Rentals — the marina's own fleet (pontoons, kayaks,
// jet skis, paddleboards, fishing skiffs) rented by the hour /
// half-day / full-day to either walk-in patrons or existing
// annual holders. Distinct from Slips (annual lease of dockage)
// and Reservations (transient slip booking).
// ============================================================

export type RentalBoatType =
  | "pontoon"
  | "kayak"
  | "paddleboard"
  | "jet_ski"
  | "fishing_skiff"
  | "wakeboat";

export type RentalBoatStatus =
  | "available"
  | "rented"
  | "maintenance"
  | "off_season";

export interface RentalBoat {
  id: string;
  // ── Tenancy ──
  // Optional for the same reason Rate is optional — legacy seed rows
  // are treated as the first tenant's, new mutators stamp explicitly.
  tenant_id?: string;
  name: string;                       // "Pontoon 1", "Yellow Kayak"
  type: RentalBoatType;
  capacity: number;                   // max passengers
  // Tiered pricing — boats with engines tend to set all three;
  // kayaks/SUPs usually set hourly + full_day only.
  hourly_rate?: number;
  half_day_rate?: number;             // 4 hrs
  full_day_rate?: number;             // 8 hrs
  deposit_amount: number;             // refundable hold authorized at pickup
  // Engine + fuel — only meaningful for motorized boats
  fuel_capacity_gal?: number;
  current_fuel_pct?: number;          // 0..100, snapshot from last return
  hour_meter_reading?: number;        // current engine hours
  home_dock: string;                  // physical pickup location
  photo_url?: string;
  status: RentalBoatStatus;
  notes?: string;
  active: boolean;
  // ── Rental Club fleet flag ──
  // When true, this boat is part of the Rental Club rotation —
  // members can pick it for club bookings, and the day's capacity
  // counts it toward the fleet size. When false (default), the boat
  // is walk-up rental only and never assigned to a club booking.
  // Operator-toggleable per boat from Services → Rental Boats.
  available_for_club?: boolean;
  /**
   * Catalog fees attached to this boat — the boat's primary pricing
   * pulled from the centralized AdditionalFee catalog (rows with
   * `applies_to_entities` including `"rental_boat"`). Matches the
   * pattern used by Reservation/Contract/ClubSubscription so per-boat
   * rates don't drift from the catalog. Operators can still set
   * `hourly_rate` / `half_day_rate` / `full_day_rate` directly for
   * one-off custom pricing; attached fees take precedence when both
   * are present.
   */
  attached_fee_ids?: string[];
  created_at: string;
  updated_at: string;
}

export type BoatRentalStatus =
  | "reserved"           // booked, awaiting agreement + deposit
  | "confirmed"          // agreement signed + card on file
  | "checked_out"        // boat in customer's hands, on the water
  | "returned"           // boat back, charges being finalized
  | "closed"             // final invoice posted, all settled
  | "cancelled"
  | "no_show";

export type BoatRentalRateKind = "hourly" | "half_day" | "full_day";

/*
 * Booking → pickup → return progress. Each step gets an ISO
 * timestamp as the customer advances through /pickup/[token],
 * exactly mirroring ContractOnboardingProgress so the staff-side
 * progress rail uses the same pattern.
 */
export interface BoatRentalCheckinProgress {
  link_sent_at?: string;          // outbound comm dispatched
  link_viewed_at?: string;        // customer opened /pickup/[token]
  agreement_signed_at?: string;   // rental agreement + damage waiver
  deposit_authorized_at?: string; // card on file + hold placed
  checked_out_at?: string;        // dockhand handed over keys
  returned_at?: string;           // boat back at the dock
}

export interface BoatRental {
  id: string;
  // Tenancy — required here because BoatRental can be walk-up
  // (patron_*, no boater_id), so the boater-join filter the rest
  // of the store relies on doesn't catch it. Marked optional so
  // legacy seeds type-check; mutators stamp current tenant.
  tenant_id?: string;
  number: string;                    // BR-1001
  boat_id: string;
  // Customer — exactly one of boater_id (existing holder) or
  // the walk-in patron fields. Walk-ins capture name + contact
  // + ID at pickup time; we don't create a Patron entity since
  // POS already treats walk-ins as anonymous-with-snapshot.
  boater_id?: string;
  patron_name?: string;
  patron_email?: string;
  patron_phone?: string;
  patron_id_last4?: string;          // driver's license last 4 for the agreement
  start_at: string;                  // ISO datetime — booked pickup
  end_at: string;                    // ISO datetime — booked return
  rate_kind: BoatRentalRateKind;
  base_amount: number;               // booked rental fee
  deposit_hold: number;              // refundable hold authorized
  // Signing + payment artifacts (parallels Contract / Quote)
  pickup_token?: string;
  signer_name?: string;
  signature_data_url?: string;
  signer_ip?: string;
  deposit_card_id?: string;          // CardOnFile ref (boater) or processor_token (patron)
  // Return-time captures (filled in by the dockhand on /dock)
  fuel_out_pct?: number;
  fuel_in_pct?: number;
  hours_out?: number;
  hours_in?: number;
  damage_notes?: string;
  // Final-charge breakdown (computed at return)
  fuel_charge?: number;
  damage_charge?: number;
  late_fee?: number;
  final_total?: number;
  status: BoatRentalStatus;
  checkin: BoatRentalCheckinProgress;
  related_ledger_entry_id?: string;  // final invoice posted to ledger on close
  notes?: string;
  // Provenance — where this rental came from. Drives closeout pricing
  // logic (club rentals already paid via subscription → no invoice).
  // `club` rentals also carry club_booking_id for back-reference; legacy
  // rentals predate this field, so it's optional.
  source?: "walk_in" | "holder" | "club";
  club_booking_id?: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// POS domain (lightweight — Rentals milestone scope only)
// ============================================================

export type PosLocationKey = "fuel_dock" | "ship_store" | "restaurant" | "harbormaster";

export interface PosLocation {
  id: string;
  // Per-tenant POS catalog — Fuel Dock + Ship Store at Marina Stee
  // aren't the same business as Lakeside's. Optional for legacy.
  tenant_id?: string;
  key: PosLocationKey;
  name: string;
  allows_charge_to_account: boolean;
  default_tax_rate: number;     // 0..1
  /** Operator-editable; defaults exist for the seeded 4 but new
   *  locations get a generic shop icon. */
  icon_key?: "fuel" | "shop" | "restaurant" | "harbormaster" | "marina";
  /** When inactive, the location disappears from the POS Terminal
   *  tab strip but historical PosOrders still resolve their location. */
  active: boolean;
  sort_order: number;
}

// PosCatalogItem now lives in the store, not the seed. Each item gets
// a stable `id` separate from `sku` so operators can rename a SKU
// without breaking historical PosOrder line items. Cost-of-goods is
// optional but enables true margin tracking when present.

export interface PosCatalogItem {
  id: string;
  // Per-tenant catalog. Optional for legacy seeds.
  tenant_id?: string;
  sku: string;                  // human SKU shown on receipts
  name: string;
  category: string;             // free-text — "Mains", "Sides", "Drinks"
  price: number;
  cost?: number;                // cost-of-goods (for margin reports)
  location_keys: PosLocationKey[];
  taxable: boolean;
  active: boolean;              // soft-archive — preserves order history
  image_url?: string;           // optional thumbnail
  // ── Inventory v1 — stock tracking ──
  // tracked=false (default) means we don't decrement stock_on_hand
  // on sale — used for services (pump-out, transient slip) and
  // bottomless items (fuel by-the-gallon, draft beer). When tracked
  // is true, POS sales auto-decrement and we surface low-stock
  // alerts when stock_on_hand <= reorder_point.
  tracked?: boolean;
  stock_on_hand?: number;
  reorder_point?: number;
  reorder_quantity?: number;
  supplier_vendor_id?: string;   // → Vendor
}

export type PosPaymentMethod = "card" | "cash" | "charge_to_account" | "split";

export interface PosOrder {
  id: string;
  // Derives from location_id at write time but stamped explicitly so
  // tenant-scoped reports + filters don't need to join through
  // posLocations. Optional for legacy.
  tenant_id?: string;
  number: string;
  location_id: string;
  customer_kind: "boater" | "patron" | "anonymous";
  boater_id?: string;
  patron_id?: string;
  line_items: { sku: string; name: string; qty: number; unit_price: number; total: number }[];
  subtotal: number;
  tax: number;
  total: number;
  payment_method: PosPaymentMethod;
  status: "draft" | "open" | "paid" | "voided" | "refunded";
  created_at: string;
  closed_at?: string;
  linked_ledger_entry_id?: string;
  // QuickBooks sync
  qb_sync_status?: QbSyncStatus;
  qb_ref?: string;
  qb_error?: string;
  qb_synced_at?: string;
}

// ── Audit log ────────────────────────────────────────────────
//
// Append-only record of every mutation that touched the system.
// Required reading for the eventual Settings → Audit Log surface +
// security incident response. Per docs/architecture-convex.md §8,
// production stores these as a tenant-scoped Convex table; the
// prototype keeps them in the client store for visibility.

export interface AuditLogEntry {
  id: string;
  tenant_id: string;
  actor_user_id?: string;       // Clerk user id when auth is wired
  actor_label: string;          // "Bills, Steven" — pre-resolved for display
  ip?: string;
  action_type: string;          // dot-separated: "boater.update", "contract.terminate"
  target_entity: string;        // table name
  target_id?: string;
  payload_delta?: string;       // JSON-stringified diff or args
  via_agent?: boolean;          // true when the agent initiated the action
  agent_prompt?: string;        // the prompt that triggered it (when via_agent)
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rental Club
//
// A subscription product: member pays a one-time join_fee + recurring
// monthly_fee; in exchange they can book days against the club's
// rental fleet up to their plan's allotment. Bookings hook into the
// existing reservation/boat-rental flow with `source: 'club'` so
// arrivals, fuel, and signatures all reuse the slip-side plumbing.
//
// ClubSubscription is the membership record (one per Boater).
// ClubBooking is one scheduled day a member has reserved.
// ─────────────────────────────────────────────────────────────────────────────

export type ClubSubscriptionStatus = "active" | "paused" | "cancelled" | "past_due";

export type ClubPlanTier = "basic" | "plus" | "premium";

// A/B variants for the cancel-sheet save offer:
//   - half_off:    50% credit on next month's invoice
//   - free_month:  100% credit (one free month)
//   - downgrade:   step down a tier (premium→plus, plus→basic) — no credit
// CancelMembershipSheet renders different copy + math per variant.
export type RetentionOfferVariant = "half_off" | "free_month" | "downgrade";

export interface ClubSubscription {
  id: string;                              // "club_001"
  boater_id: string;
  // Plan is a Rate row in the catalog (occupancy_type=Rental Club +
  // cadence=monthly). Single source of truth for monthly_fee +
  // join_fee + days_per_month — no manual entry on the membership
  // form. Edits to the Rate propagate to NEW signups; existing
  // memberships snapshot their amount at signup via the
  // joined_at_fee / joined_at_days fields below.
  plan_rate_id: string;
  /**
   * Additional service rates attached on top of the base plan. Members
   * with a tier upgrade, guest pass package, or other extras stack them
   * here. The base `plan_rate_id` still drives the primary snapshot
   * (joined_at_monthly_fee) — these are pure add-ons billed alongside.
   *
   * Each id is a Rate row from the Services → Rental Club catalog. The
   * Edit Membership dialog surfaces them as a multi-select against the
   * same catalog so the operator never types prices by hand.
   */
  additional_rate_ids?: string[];
  // Snapshot at signup — preserves what the member is grandfathered
  // into when the operator edits the Rate catalog later. Reads should
  // prefer these over the live Rate when present. Optional so older
  // seed rows that pre-date this refactor can fall back to the live
  // Rate amounts.
  joined_at_monthly_fee?: number;
  /**
   * Snapshot of the setup-fee amount the member was charged at
   * signup. Sourced from the matching one-time Rental Club Rate row
   * (via plan_tier) — NOT from a `join_fee` field on the plan rate
   * (that field was removed in favor of the catalog-row pattern).
   * Field name preserved for back-compat + grandfathering reads.
   */
  joined_at_join_fee?: number;
  joined_at_days_per_month?: number;
  status: ClubSubscriptionStatus;
  member_since: string;                    // ISO date the membership started
  next_billing_date?: string;              // ISO date — when monthly fee posts next
  // Optional channel overrides specifically for club comms. When
  // unset, fall back to boater.communication_prefs.preferred_channel.
  // Members often want booking confirmations on SMS (fastest) and
  // billing receipts on email (paper trail) — these split that out.
  booking_channel?: CommunicationChannel;
  billing_channel?: CommunicationChannel;
  // Retention credit — when a member accepts the portal save-offer
  // before cancelling, this percentage is applied to their NEXT
  // monthly invoice (once). runClubMonthlyBilling consumes + clears
  // this field on use so it doesn't keep stacking.
  retention_credit_pct?: number;
  // Pause window — when status === 'paused', no monthly billing
  // posts. resume_on (optional) is when the membership auto-resumes;
  // null means manual resume only.
  paused_at?: string;                      // ISO date — when the pause started
  resume_on?: string;                      // ISO date — auto-resume date (optional)
  // Retention offer tracking — populated when the portal cancel sheet
  // surfaces the save offer. shown_at fires the first time the sheet
  // opens; outcome locks in when the member picks Accept or Decline.
  // Reports tab reads these to compute save-conversion rate.
  retention_offer_shown_at?: string;
  retention_offer_outcome?: "accepted" | "declined";
  // A/B variant — which save offer the cancel sheet showed. Picked
  // randomly on first sheet open per sub. Reports tab breaks down
  // conversion per variant so the operator knows which one wins.
  retention_offer_variant?: RetentionOfferVariant;
  // Reactivation campaign — recorded when staff (or the agent) sends
  // a "come back" message after cancellation. Caps to one per window
  // so the marina doesn't accidentally spam ex-members.
  reactivation_sent_at?: string;
  // Set on a CANCELLED subscription when its boater rejoins. Points
  // to the new active sub's id. Reports reads this to measure
  // reactivation-campaign conversion ($1 spent on outreach → $X
  // recovered MRR).
  reactivated_to_subscription_id?: string;
  notes?: string;
  /**
   * Service fees attached at signup. References AdditionalFee.id. The
   * Boat Club Join Fee (one-time) is the canonical entry here — see
   * fee_club_join in the seeds. Future per-member add-ons (storage,
   * winterization) can stack onto the same array.
   */
  attached_fee_ids?: string[];
}

export type ClubBookingStatus = "requested" | "confirmed" | "checked_in" | "completed" | "cancelled" | "no_show";

// One-tap sentiment captured after a club day completes. Three
// buckets keep it lightweight — no scale fatigue. Aggregates land on
// /reports as a small distribution chart.
export type ClubBookingSentiment = "happy" | "neutral" | "sad";

export interface ClubBooking {
  id: string;                              // "cb_001"
  subscription_id: string;                 // FK to ClubSubscription
  boater_id: string;                       // denorm for fast lookups
  rental_boat_id?: string;                 // assigned vessel — empty until staff picks one
  date: string;                            // ISO date — the day booked
  start_time?: string;                     // "09:00" optional, full-day if missing
  end_time?: string;
  status: ClubBookingStatus;
  notes?: string;                          // member request notes
  // Member sentiment after the day. Set via the portal's one-tap
  // selector on completed bookings; null until the member rates.
  sentiment?: ClubBookingSentiment;
  sentiment_at?: string;                   // ISO timestamp the member tapped
  /**
   * Per-day add-on fees attached at booking time. References
   * AdditionalFee.id. Only `cadence: "one_time"` fees apply here —
   * monthly / annual cadences belong on the parent ClubSubscription
   * (`attached_fee_ids` there). The booking sheet hides non-one-time
   * options to keep that invariant.
   */
  attached_fee_ids?: string[];
  created_at: string;
}

// ═════════════════════════════════════════════════════════════════════
// BACK OFFICE — Vendor / AP / Inventory / Assets / PM
// ═════════════════════════════════════════════════════════════════════
//
// Added to back the staffing + vendor + inventory + asset/PM modules.
// Every entity is tenant_id-scoped (required, not optional, since
// these all post-date the multi-tenant sweep). Bills + paystubs +
// stock movements all hit the ledger via mutators so the existing
// QB sync continues to work.

// ── Vendors + Accounts Payable ─────────────────────────────────

export type VendorPaymentTerms =
  | "due_on_receipt"
  | "net_7"
  | "net_15"
  | "net_30"
  | "net_60";

export interface Vendor {
  id: string;
  tenant_id: string;
  name: string;                  // legal name on bills + 1099s
  display_name?: string;         // friendly name shown in UI; falls back to name
  contact_name?: string;
  email?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  payment_terms: VendorPaymentTerms;
  default_gl_account?: string;   // e.g. "Fuel — Cost of Goods"
  /** Last 4 of the EIN/SSN only — never store full tax IDs in the prototype. */
  tax_id_last4?: string;
  /** When true, vendor totals roll up into the year-end 1099-NEC report. */
  issue_1099: boolean;
  notes?: string;
  active: boolean;
  created_at: string;
  /** Contracts, W-9s, COI docs uploaded for this vendor. */
  attachment_ids?: string[];
  /** Set when vendor created via AI extraction. */
  extracted_from_draft_id?: string;
}

export type BillStatus = "open" | "partial" | "paid" | "void";

export interface BillLineItem {
  description: string;
  amount: number;
  gl_account?: string;           // falls back to vendor.default_gl_account
}

export interface Bill {
  id: string;
  tenant_id: string;
  vendor_id: string;
  number: string;                // vendor's invoice number
  bill_date: string;             // ISO date when issued
  due_date: string;
  amount: number;                // total amount due (before any payments)
  amount_paid: number;
  status: BillStatus;
  line_items: BillLineItem[];
  notes?: string;
  /** Optional — set when bill is matched against a received PO. */
  linked_po_id?: string;
  /** Optional — set when stock was received under this bill. */
  linked_stock_movement_ids?: string[];
  qb_sync_status?: QbSyncStatus;
  qb_ref?: string;
  qb_synced_at?: string;
  created_at: string;
  /** Source invoice docs (PDF/photo) the bill was extracted from. */
  attachment_ids?: string[];
  /** Set when bill posted via AI extraction (audit trail). */
  extracted_from_draft_id?: string;
  /** Stamped when an automated rule posted this without human review. */
  auto_approved_by_rule?: string;
}

export type BillPaymentMethod = "ach" | "check" | "card" | "wire" | "cash";

// ── Vendor Bills (AP workflow — operator side) ─────────────────
//
// Distinct from the legacy `Bill` (AR-adjacent invoice-in-aging-buckets
// surface) above. A `VendorBill` is the full AP workflow record: a vendor
// sent us an invoice, it routes through approval, gets scheduled, then
// paid — with each transition logged to audit. Approval queue, scheduled
// payments, and disputes all live on this entity.
//
// The two coexist deliberately: legacy `Bill` keeps the existing /vendors
// Bills aging view + PayBillSheet working; `VendorBill` is the new AP
// operator workflow. A follow-up consolidates them once the new flow has
// soaked.

export type VendorBillStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "scheduled"
  | "paid"
  | "disputed"
  | "void";

export type VendorBillPaymentMethod = "ach" | "check" | "card" | "wire";

export interface VendorBillLineItem {
  description: string;
  amount: number;
  gl_account?: string;
}

export interface VendorBill {
  id: string;
  tenant_id: string;
  /** Sequential operator-facing key, e.g. "BIL-0001". */
  number: string;
  vendor_id: string;
  /** What the vendor put on their own invoice (not our sequential `number`). */
  vendor_invoice_number?: string;
  status: VendorBillStatus;
  /** ISO YYYY-MM-DD — when the vendor issued the invoice. */
  bill_date: string;
  /** ISO YYYY-MM-DD — computed from vendor.payment_terms (Net N) if not set. */
  due_date: string;
  /** Total amount (subtotal + tax). */
  amount: number;
  tax_amount?: number;
  subtotal?: number;
  description?: string;
  line_items?: VendorBillLineItem[];
  attachment_ids?: string[];
  /** User id of the operator who approved. */
  approved_by?: string;
  approved_at?: string;
  scheduled_payment_date?: string;
  scheduled_payment_method?: VendorBillPaymentMethod;
  paid_at?: string;
  /** Check number, ACH reference, or wire confirmation id. */
  paid_via?: string;
  /** Back-reference to the LedgerEntry posted when the bill was paid. */
  payment_ledger_entry_id?: string;
  dispute_reason?: string;
  internal_notes?: string;
  created_at: string;
  created_by: string;
}

export interface BillPayment {
  id: string;
  tenant_id: string;
  bill_id: string;
  vendor_id: string;             // denormalized for AP reports
  paid_at: string;
  amount: number;
  method: BillPaymentMethod;
  check_number?: string;
  processor_ref?: string;
  gl_account?: string;           // default "Cash / Operating"
  notes?: string;
  created_at: string;
}

// ── Inbound emails (AP-bill ingest provenance) ──────────────────
//
// One row per email Postmark forwards to `bills@<marina>.marinastee.com`.
// The webhook handler at /api/inbound/postmark/[tenantId] inserts a row
// IMMEDIATELY on every accepted event (before parsing) — that row is the
// idempotency anchor (keyed on `postmark_message_id`) so retries can
// short-circuit without re-running PDF extraction.
//
// `status` walks forward through the ingest pipeline:
//
//   ingested        — row written; no PDF attachment OR parsing not yet
//                     attempted. Empty-body emails (notes, "thank you"
//                     replies) terminate here.
//   matched_vendor  — PDF parsed, vendor matched by from-domain or
//                     vendor_name_hint, BUT bill creation hasn't fired
//                     yet (e.g. extractor returned no usable amount).
//   created_draft   — happy path — VendorBill exists at `vendor_bill_id`
//                     in pending_approval. Operator can click through.
//   failed          — extractor errored, vendor couldn't be matched, or
//                     `vendorBills.create` rejected (dup invoice, etc.).
//                     `error_reason` carries a short code.

export type InboundEmailStatus =
  | "ingested"
  | "matched_vendor"
  | "created_draft"
  | "failed";

export interface InboundEmail {
  id: string;
  tenant_id: string;
  /** Postmark's per-email unique id — webhook idempotency key. */
  postmark_message_id: string;
  /** Sender's bare email (e.g. "carlos@pinonpetro.example"). */
  from_email: string;
  /** Optional display name surfaced by Postmark. */
  from_name?: string;
  /** Email subject — surfaced in the feed for at-a-glance triage. */
  subject?: string;
  /** ISO timestamp when the webhook landed (not the email's own Date header). */
  received_at: string;
  /** Set when the ingest path matched + drafted a VendorBill. */
  vendor_bill_id?: string;
  /** Set when the ingest matched a Vendor (regardless of bill outcome). */
  vendor_id?: string;
  status: InboundEmailStatus;
  /** Short machine-readable code on failure — "no_pdf_attachment",
   *  "vendor_not_matched", "extraction_failed", "duplicate_invoice", etc. */
  error_reason?: string;
}

// ── Inventory — stock movements ────────────────────────────────

export type StockMovementKind =
  | "sale"                   // POS sale auto-decrement
  | "receive"                // received under a PO / bill
  | "adjust"                 // operator-entered count correction
  | "loss"                   // breakage, theft, spoilage
  | "transfer";              // between POS locations

export interface StockMovement {
  id: string;
  tenant_id: string;
  item_id: string;               // → PosCatalogItem
  delta: number;                 // positive = added, negative = removed
  kind: StockMovementKind;
  reference_id?: string;         // pos_order_id, bill_id, etc.
  notes?: string;
  occurred_at: string;
  recorded_by?: string;          // staff_id (when known)
  created_at: string;
}

// ── Marina assets + preventive maintenance ─────────────────────

export type MarinaAssetKind =
  | "forklift"
  | "boat_lift"
  | "hoist"
  | "pump_out_boat"
  | "pump_out_station"
  | "courtesy_cart"
  | "fuel_pump"
  | "fuel_tank"                  // separate from FuelInventory which is product-level
  | "fire_system"
  | "compressor"
  | "generator"
  | "office_equipment"
  | "other";

export type MarinaAssetStatus = "active" | "in_maintenance" | "retired";

export interface MarinaAsset {
  id: string;
  tenant_id: string;
  name: string;                  // "Forklift — Toyota 7FBCU25 #1"
  kind: MarinaAssetKind;
  serial_number?: string;
  model?: string;
  manufacturer?: string;
  purchase_date?: string;
  purchase_price?: number;
  warranty_until?: string;
  location?: string;             // "Dry Storage Row B", "Fuel Dock"
  status: MarinaAssetStatus;
  photo_url?: string;
  /** Vendor that services this asset (linked PMs become WOs assigned to this vendor). */
  service_vendor_id?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  /** Purchase invoice + manufacturer manual PDFs. */
  attachment_ids?: string[];
  /** Set when asset created via AI extraction. */
  extracted_from_draft_id?: string;
}

export type PmCadence =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "semi_annual"
  | "annual";

export interface PmSchedule {
  id: string;
  tenant_id: string;
  asset_id: string;
  name: string;                  // "Annual safety inspection"
  description?: string;
  cadence: PmCadence;
  next_due_at: string;           // ISO date
  last_completed_at?: string;
  /** Auto-create a WO this many days before next_due_at. Default 14. */
  auto_create_wo_days_ahead: number;
  /** WOs created from this PM (keeps us from double-creating per cycle). */
  linked_work_order_ids?: string[];
  assigned_to_staff_id?: string;
  active: boolean;
  created_at: string;
}

// ============================================================
// AI-first foundation
// ============================================================
//
// Every AI behavior in the app is driven by per-tenant configuration
// (TenantAiSettings) so a new marina can be productized via the
// /onboarding checklist instead of bespoke setup. Documents become
// Attachments. Each parsed document becomes an ExtractionDraft —
// one staged AgentAction (or chain) waiting for human approve / edit /
// reject. The DocInbox UI on every module reads ExtractionDraft and
// renders the same DraftCard.

/**
 * Per-tenant AI behavior config. Replaces per-marina hardcoding.
 * Every page that surfaces an AI affordance gates on the matching
 * boolean here; thresholds tune behavior without code changes.
 */
export interface TenantAiSettings {
  tenant_id: string;

  // ── Bills inbox ──
  bills_inbox_enabled: boolean;
  /** Auto-provisioned: bills+<slug>@marinastee.app */
  bills_email_address?: string;
  bills_auto_approve_enabled: boolean;
  /** Cents. Bills under this amount + matching prior vendor pattern auto-post. */
  bills_auto_approve_threshold_cents: number;
  bills_auto_approve_requires_familiar_vendor: boolean;

  // ── Vendor auto-creation ──
  vendors_auto_create_from_invoice: boolean;

  // ── Staff ──
  staff_onboarding_doc_intake_enabled: boolean;
  /** Anomalies-only mode — clean cards auto-approve. */
  timecard_anomalies_only: boolean;
  timecard_max_shift_hours: number;          // surfaces if exceeded
  timecard_require_break_after_hours: number; // surfaces if exceeded w/ no break
  timecard_ot_threshold_hours_per_period: number;

  // ── Certs ──
  certs_photo_intake_enabled: boolean;
  /** Days before expiration to nudge staff via comm channel. */
  certs_nudge_days_before_expiration: number[];

  // ── Inventory ──
  inventory_velocity_reorder_enabled: boolean;
  inventory_reorder_lead_time_days: number;
  inventory_velocity_window_days: number;

  // ── Assets ──
  assets_pm_auto_derive_from_manual: boolean;

  // ── Dock / voice ──
  dock_voice_input_enabled: boolean;

  // ── Onboarding state ──
  onboarding_completed_steps: OnboardingStepKey[];
  onboarding_dismissed: boolean;
}

export type OnboardingStepKey =
  | "marina_profile"
  | "chart_of_accounts"
  | "bills_inbox"
  | "auto_approve_threshold"
  | "vendor_seed"
  | "staff_seed"
  | "velocity_reorder"
  | "voice_input"
  | "quickbooks_link"
  | "first_drop";

/**
 * Generic source-document attachment. Stored as a data URL in the
 * prototype; real backend swaps this for Convex _storage refs.
 * Reusable across Bill / Vendor / Certification / MarinaAsset /
 * StaffMember / StockMovement.
 */
export interface Attachment {
  id: string;
  tenant_id: string;
  name: string;
  mime: string;
  size_bytes: number;
  /** Prototype storage. Real impl: signed Convex storage URL. */
  data_url: string;
  uploaded_at: string;
  uploaded_by_user_id?: string;
  /** Optional original-source hint — "email", "drop", "dock_voice". */
  source?: "drop" | "email" | "dock_voice" | "scan";
}

export type ExtractionModule =
  | "bill"
  | "vendor"
  | "certification"
  | "asset"
  | "packing_slip"
  | "staff_onboarding";

export type ExtractionDraftStatus =
  | "pending"
  | "auto_approved"
  | "approved"
  | "rejected"
  | "errored";

/**
 * One AI-parsed document waiting for review. `staged_actions` carries
 * the AgentAction(s) the extractor produced — multiple when a chain
 * is needed (new vendor + new bill from same invoice). On approve,
 * the executor runs each action in order and stamps source-doc
 * attachment_ids on the resulting entities.
 */
export interface ExtractionDraft<TAction = unknown> {
  id: string;
  tenant_id: string;
  module: ExtractionModule;
  source_attachment_id: string;
  staged_actions: TAction[];
  status: ExtractionDraftStatus;
  /** 0..1 overall confidence the extractor reports. */
  confidence: number;
  /** Field-level confidences (e.g. {"amount": 0.99, "due_date": 0.7}). */
  field_confidences?: Record<string, number>;
  /** Model commentary — surfaced in the card footer for transparency. */
  notes?: string;
  /** When auto_approve hits — quietly posted but still listed for audit. */
  auto_approved: boolean;
  created_at: string;
  decided_at?: string;
  decided_by_user_id?: string;
  /** Operator's inline field edits before approve. */
  edit_patch?: Record<string, unknown>;
  error_message?: string;
}

// ============================================================
// Support tickets (Marina Stee carve-out — see CLAUDE.md §5)
// ============================================================
//
// Tickets that a boater (or eventually marina staff) files from
// inside the product. Per the carve-out in marina-stee/CLAUDE.md,
// these do NOT proxy to admin.stee-suite.com — they live in Marina
// Stee's own Convex tables, scoped by `tenant_id` so one marina's
// queue is invisible to another.
//
// The shape mirrors global CLAUDE.md §5: required `subject` +
// `description`, recommended `type` / `priority` / `page_or_area` /
// `steps_to_reproduce` / `attachments`. The conversation thread is
// embedded (every message ships with the ticket; threads are short)
// and "cancel, not delete" is enforced via the `cancelled` status.

export type SupportTicketType =
  | "bug"
  | "question"
  | "feature_request"
  | "billing"
  | "other";

export type SupportTicketPriority = "low" | "normal" | "high" | "urgent";

export type SupportTicketStatus =
  | "open"             // boater filed it, no marina reply yet
  | "in_progress"      // marina is working on it
  | "awaiting_boater"  // marina replied, waiting on the boater
  | "resolved"         // marina marked done
  | "cancelled";       // boater cancelled (history preserved)

/**
 * One message on a ticket's conversation thread. Stored inline on
 * the ticket because threads are short (a few back-and-forths) and
 * separate-table joins aren't worth it at this scale.
 */
export interface SupportTicketMessage {
  id: string;
  author_kind: "boater" | "staff" | "system";
  author_label: string;     // pre-resolved display name
  body: string;
  created_at: string;
  /** Optional attachments scoped to this message (separate from the
   *  ticket-level attachments, which represent the initial submission). */
  attachment_ids?: string[];
}

/**
 * One attachment on a support ticket. Mirrors the safe-app-proxy
 * pattern from global §5 — `storage_id` is opaque to clients; they
 * open it through `/api/support/tickets/[id]/attachments?file=...`.
 *
 * In mock mode `storage_id` is just a deterministic string; in
 * Convex it's a real `_storage` id.
 */
export interface SupportTicketAttachment {
  id: string;
  name: string;
  mime_type: string;
  size_bytes?: number;
  storage_id: string;
  uploaded_at: string;
}

export interface SupportTicket {
  id: string;
  tenant_id: string;
  /** Short alphanumeric reference shown in the modal header (e.g. "ST-104"). */
  reference: string;
  /** The boater who filed it. Always set for v1 — staff-filed tickets come later. */
  boater_id: string;
  /** Required fields (global §5). */
  subject: string;
  description: string;
  /** Recommended fields (global §5). */
  type: SupportTicketType;
  priority: SupportTicketPriority;
  /** "where it happened" — a free-text page/area label. */
  page_or_area?: string;
  steps_to_reproduce?: string;
  attachments: SupportTicketAttachment[];
  /** Conversation thread — newest last. */
  messages: SupportTicketMessage[];
  status: SupportTicketStatus;
  /** Silent contextual metadata captured at submission. Never displayed
   *  to the boater but useful for the marina-side queue. */
  context: {
    submitted_from_url?: string;
    app_version?: string;
    user_agent?: string;
  };
  created_at: string;
  updated_at: string;
  /** Set when status flips to cancelled or resolved. */
  closed_at?: string;
}

// ============================================================
// Renewal sweep — coordinated annual renewal workflow
// ============================================================
//
// Most marinas have annual contracts that all expire around Dec 31. The
// operator runs a deliberate "renewal sweep" each fall to coordinate the
// fan-out: identify contracts in the expiry window, set per-item
// priority + rate adjustment, draft N successor contracts, send N
// renewal links, then track acceptance % over the window.
//
// Distinct from `bulk_renew_contracts` (one-click fan-out) — a sweep is
// a long-lived workflow with operator-managed items, per-item statuses,
// comms, and a dashboard for the window. Items map 1:1 to source
// contracts; each tracks its own lifecycle (pending → renewal_sent →
// accepted / declined / no_response / withdrawn).
//
// The boater-facing accept happens via the existing /onboard/[token]
// flow; when the renewal contract is signed, the existing mark_signed
// path fires recordAcceptance on the sweep to flip the item status.

export type RenewalSweepStatus = "draft" | "in_progress" | "closed";

export interface RenewalSweep {
  id: string;
  /** Per-tenant — every sweep belongs to one marina. */
  tenant_id?: string;
  name: string;                              // "Winter 2026 sweep"
  window_start: string;                      // ISO date — start of the expiry window
  window_end: string;                        // ISO date — end of the expiry window
  /**
   * Default rate adjustment applied to each item's source annual_rate
   * when minting a successor draft. Per-item overrides take precedence.
   * Stored as a percent (e.g. 5 = +5%, -2.5 = -2.5%).
   */
  default_rate_adjustment_pct: number;
  status: RenewalSweepStatus;
  launched_at?: string;
  closed_at?: string;
  notes?: string;
  created_at: string;
}

export type RenewalSweepItemStatus =
  | "pending"        // operator hasn't sent the renewal yet
  | "renewal_sent"   // renewal link + draft delivered to boater
  | "accepted"       // boater signed the new contract
  | "declined"       // boater explicitly declined
  | "no_response"    // window closed without action
  | "withdrawn";     // operator removed from sweep

export interface RenewalSweepItem {
  id: string;
  sweep_id: string;
  /** Source contract being renewed. */
  source_contract_id: string;
  boater_id: string;
  /** Drives sort + visual emphasis. */
  priority: "high" | "normal" | "low";
  /**
   * Per-item override of the sweep's default_rate_adjustment_pct.
   * When undefined, the sweep default applies.
   */
  rate_adjustment_pct?: number;
  status: RenewalSweepItemStatus;
  /** Token minted on launch — boater taps this to view + sign their renewal. */
  renewal_link_token?: string;
  /** Successor contract id, set on launch / accept. */
  renewal_contract_id?: string;
  sent_at?: string;
  responded_at?: string;
  internal_notes?: string;
}

// ────────────────────────────────────────────────────────────
// Storm / weather alerts
//
// Marina-native UX no incumbent ships: a banner that wraps every
// operator surface (and the /dock PWA) when there's active severe
// weather. Marina owners spend the hour before a storm calling
// boaters and locking dock infrastructure — surfacing the alert
// at the top of every screen + a one-line recommended action
// beats hunting through emails or phone weather apps.
//
// Mock-data first; production wires a real NWS / OpenWeatherMap
// feed into Convex on a cron schedule and writes rows to this
// table. The dispatch + acknowledgment layer is identical.
// ────────────────────────────────────────────────────────────
export type StormAlertSeverity = "info" | "warn" | "danger";

export type StormAlertKind =
  | "thunderstorm"      // afternoon T-storms, gust events
  | "high_wind"         // sustained ≥30kt
  | "small_craft"       // small-craft advisory band
  | "gale"              // 34–47kt
  | "storm"             // 48–63kt
  | "hurricane"         // ≥64kt
  | "freezing"          // cold-snap haul-out trigger
  | "flood"             // surge / high-water event
  | "fog"               // operational restriction
  | "lightning";        // immediate dock evacuation trigger

export interface StormAlert {
  id: string;
  tenant_id?: string;
  kind: StormAlertKind;
  severity: StormAlertSeverity;
  /** One-line title shown bold in the banner. */
  headline: string;
  /**
   * Plain-English window + recommended action. E.g.
   * "Thunderstorms Saturday 3–6pm — recommend locking the
   * gas dock and pulling jet ski rentals by 2:30pm."
   */
  body: string;
  /** ISO datetime — alert applies starting at this time. */
  starts_at: string;
  /** ISO datetime — alert auto-clears at this time. */
  ends_at: string;
  /** When the row was created (operator + agent timeline). */
  issued_at: string;
  /**
   * Where the alert came from. Operator-issued or agent-issued
   * alerts can be edited; provider-issued ones are read-only.
   */
  source: "operator" | "agent" | "nws" | "openweather";
  /**
   * Source-specific reference (NWS bulletin id, etc.). Used to
   * dedup re-issued alerts.
   */
  source_ref?: string;
}
