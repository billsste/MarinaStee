import type {
  Boater,
  Vessel,
  Picklist,
  PicklistValue,
  Dock,
  Slip,
  SlipClass,
  Tenant,
  Reservation,
  LedgerEntry,
  WorkOrder,
  Communication,
  Contract,
  ContractTemplate,
  CardOnFile,
  User,
  RentalGroup,
  RentalSpace,
  Rate,
  AdditionalFee,
  MeterReading,
  FuelInventory,
  FuelDelivery,
  FuelSale,
  PosLocation,
  PosOrder,
  Quote,
  QuoteLineItem,
  InsuranceCertificate,
  Application,
  WaitlistEntry,
  StaffNote,
  MarinaEvent,
  RentalBoat,
  BoatRental,
  MarinaProfile,
  CommTemplate,
  Role,
  StaffMember,
  Shift,
  TimeEntry,
  PayrollPeriod,
  PayrollRun,
  Paystub,
  Certification,
  PtoRequest,
  Vendor,
  Bill,
  BillPayment,
  VendorBill,
  InboundEmail,
  StockMovement,
  MarinaAsset,
  PmSchedule,
  AppProviderConfig,
  PosCatalogItem,
  // AI-first foundation
  TenantAiSettings,
  Attachment,
  ExtractionDraft,
  OnboardingStepKey,
} from "@/lib/types";

// ============================================================
// Tenants + Picklists
// ============================================================
//
// Single seeded tenant for the prototype. When the backend lands the
// active tenant comes from the authenticated session; for now every
// store read defaults to this id.

export const SEED_TENANT_ID = "ten_marina_stee_demo";

// Second tenant — different marina with different retention config so
// staff can demo the multi-tenant variant model. Same boater/fleet
// data is shared in the prototype; only the profile differs.
export const SECOND_TENANT_ID = "ten_lakeside_demo";

export const TENANTS: Tenant[] = [
  {
    id: SEED_TENANT_ID,
    name: "Marina Stee — Damsite Cove",
    slug: "marina-stee",
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: SECOND_TENANT_ID,
    name: "Lakeside Marina",
    slug: "lakeside",
    created_at: "2026-03-15T00:00:00Z",
  },
];

/**
 * Generic seed wrapper — stamps `tenant_id: SEED_TENANT_ID` on rows
 * that don't already carry one. Use at every `export const`
 * declaration whose entity type has an optional `tenant_id`. Keeps
 * legacy seed rows on the primary tenant without polluting the
 * inline row literals.
 */
function withTenantId<T extends { tenant_id?: string }>(rows: T[]): T[] {
  return rows.map((row) => (row.tenant_id ? row : { ...row, tenant_id: SEED_TENANT_ID }));
}

/**
 * Helper: build a picklist value with sensible defaults.
 */
function pv(
  tenantId: string,
  value: string,
  label: string,
  sort: number
): PicklistValue {
  return {
    id: `pv_${tenantId.slice(-6)}_${value}`,
    value,
    label,
    sort_order: sort,
    archived: false,
  };
}

/**
 * Seed picklists for every editable field across the app. Values
 * match the current hard-coded enums so the migration is a no-op for
 * existing records; super-user can then rename/add/archive freely.
 */
export const PICKLISTS: Picklist[] = [
  {
    id: `pl_${SEED_TENANT_ID.slice(-6)}_occupancy_type`,
    tenant_id: SEED_TENANT_ID,
    field_key: "occupancy_type",
    // User-facing label was "Occupancy type" — renamed to "Service type"
    // per operator feedback (they think of these as the kinds of services
    // the marina sells, not just inventory categories). The internal
    // `field_key` is still "occupancy_type" to avoid migrating every
    // consumer.
    label: "Service type",
    description:
      "What the marina sells: slip storage, jet-ski rentals, buoys, dry storage, mooring, or rental-club memberships. Used everywhere from Rates to the Members directory.",
    editable: true,
    values: [
      pv(SEED_TENANT_ID, "Standard", "Standard", 0),
      pv(SEED_TENANT_ID, "Jet Ski", "Jet Ski", 1),
      pv(SEED_TENANT_ID, "Buoy", "Buoy", 2),
      pv(SEED_TENANT_ID, "Dry Storage", "Dry Storage", 3),
      pv(SEED_TENANT_ID, "Mooring", "Mooring", 4),
      // "Rental Club" — subscription product. Members pay a join fee + monthly
      // fee and book days against the rental fleet. See ClubSubscription.
      pv(SEED_TENANT_ID, "Rental Club", "Rental Club", 5),
    ],
  },
  {
    id: `pl_${SEED_TENANT_ID.slice(-6)}_slip_class`,
    tenant_id: SEED_TENANT_ID,
    field_key: "slip_class",
    label: "Slip class",
    description:
      "Pricing tier on each Slip — drives the default annual rate. Each marina prices these differently.",
    editable: true,
    values: [
      pv(SEED_TENANT_ID, "covered", "Covered", 0),
      pv(SEED_TENANT_ID, "uncovered", "Uncovered", 1),
      pv(SEED_TENANT_ID, "t_head", "T-head", 2),
      pv(SEED_TENANT_ID, "buoy", "Buoy", 3),
      pv(SEED_TENANT_ID, "dry_storage", "Dry storage", 4),
    ],
  },
  {
    id: `pl_${SEED_TENANT_ID.slice(-6)}_vessel_type`,
    tenant_id: SEED_TENANT_ID,
    field_key: "vessel_type",
    label: "Vessel type",
    description: "Powerboat / sailboat / PWC / etc. Used on Vessel records.",
    editable: true,
    values: [
      pv(SEED_TENANT_ID, "powerboat", "Powerboat", 0),
      pv(SEED_TENANT_ID, "sailboat", "Sailboat", 1),
      pv(SEED_TENANT_ID, "pontoon", "Pontoon", 2),
      pv(SEED_TENANT_ID, "houseboat", "Houseboat", 3),
      pv(SEED_TENANT_ID, "pwc", "PWC / Jet Ski", 4),
      pv(SEED_TENANT_ID, "other", "Other", 5),
    ],
  },
  {
    id: `pl_${SEED_TENANT_ID.slice(-6)}_activity_type`,
    tenant_id: SEED_TENANT_ID,
    field_key: "activity_type",
    label: "Work order activity",
    description:
      "Your service catalog. Filters work-order kanban + drives default tags on quotes.",
    editable: true,
    values: [
      pv(SEED_TENANT_ID, "winterization", "Winterization", 0),
      pv(SEED_TENANT_ID, "bottom_paint", "Bottom paint", 1),
      pv(SEED_TENANT_ID, "service", "Service / repair", 2),
      pv(SEED_TENANT_ID, "inspection", "Inspection", 3),
      pv(SEED_TENANT_ID, "haul_out", "Haul-out", 4),
      pv(SEED_TENANT_ID, "pump_out", "Pump-out", 5),
      pv(SEED_TENANT_ID, "task", "Staff task", 6),
      pv(SEED_TENANT_ID, "other", "Other", 7),
    ],
  },
  {
    id: `pl_${SEED_TENANT_ID.slice(-6)}_event_type`,
    tenant_id: SEED_TENANT_ID,
    field_key: "event_type",
    label: "Marina event type",
    description: "Tournaments, social events, season opening, etc.",
    editable: true,
    values: [
      pv(SEED_TENANT_ID, "social", "Social / dock party", 0),
      pv(SEED_TENANT_ID, "tournament", "Tournament", 1),
      pv(SEED_TENANT_ID, "regatta", "Regatta", 2),
      pv(SEED_TENANT_ID, "fireworks", "Fireworks", 3),
      pv(SEED_TENANT_ID, "season", "Season open / close", 4),
      pv(SEED_TENANT_ID, "maintenance", "Maintenance window", 5),
      pv(SEED_TENANT_ID, "other", "Other", 6),
    ],
  },
  {
    id: `pl_${SEED_TENANT_ID.slice(-6)}_rental_boat_type`,
    tenant_id: SEED_TENANT_ID,
    field_key: "rental_boat_type",
    label: "Boat rental type",
    description:
      "The classes of boat in your own-fleet rental program (pontoon, kayak, etc.).",
    editable: true,
    values: [
      pv(SEED_TENANT_ID, "pontoon", "Pontoon", 0),
      pv(SEED_TENANT_ID, "kayak", "Kayak", 1),
      pv(SEED_TENANT_ID, "paddleboard", "Paddleboard", 2),
      pv(SEED_TENANT_ID, "jet_ski", "Jet ski", 3),
      pv(SEED_TENANT_ID, "fishing_skiff", "Fishing skiff", 4),
      pv(SEED_TENANT_ID, "wakeboat", "Wakeboat", 5),
    ],
  },
  {
    id: `pl_${SEED_TENANT_ID.slice(-6)}_contact_role`,
    tenant_id: SEED_TENANT_ID,
    field_key: "contact_role",
    label: "Contact role",
    description: "How additional contacts on a Holder are categorized.",
    editable: true,
    values: [
      pv(SEED_TENANT_ID, "self", "Self", 0),
      pv(SEED_TENANT_ID, "spouse", "Spouse", 1),
      pv(SEED_TENANT_ID, "captain", "Captain", 2),
      pv(SEED_TENANT_ID, "manager", "Manager", 3),
      pv(SEED_TENANT_ID, "other", "Other", 4),
    ],
  },
  {
    id: `pl_${SEED_TENANT_ID.slice(-6)}_refund_reason`,
    tenant_id: SEED_TENANT_ID,
    field_key: "refund_reason",
    label: "Refund reason",
    description: "Audit category for ledger refunds. Required on every refund.",
    editable: true,
    values: [
      pv(SEED_TENANT_ID, "duplicate", "Duplicate charge", 0),
      pv(SEED_TENANT_ID, "request", "Customer request", 1),
      pv(SEED_TENANT_ID, "dispute", "Dispute / chargeback", 2),
      pv(SEED_TENANT_ID, "service_issue", "Service issue", 3),
      pv(SEED_TENANT_ID, "other", "Other", 4),
    ],
  },
  {
    id: `pl_${SEED_TENANT_ID.slice(-6)}_billing_cadence`,
    tenant_id: SEED_TENANT_ID,
    field_key: "billing_cadence",
    label: "Billing cadence",
    description:
      "How a holder is billed for their slip — annual, seasonal, monthly, or transient (per-stay).",
    editable: true,
    values: [
      pv(SEED_TENANT_ID, "annual", "Annual", 0),
      pv(SEED_TENANT_ID, "seasonal", "Seasonal", 1),
      pv(SEED_TENANT_ID, "monthly", "Monthly", 2),
      pv(SEED_TENANT_ID, "transient", "Transient", 3),
    ],
  },
  {
    id: `pl_${SEED_TENANT_ID.slice(-6)}_reservation_type`,
    tenant_id: SEED_TENANT_ID,
    field_key: "reservation_type",
    label: "Reservation type",
    description:
      "Reservation classification. Drives calendar colors and reporting buckets.",
    editable: true,
    values: [
      pv(SEED_TENANT_ID, "annual", "Annual", 0),
      pv(SEED_TENANT_ID, "seasonal", "Seasonal", 1),
      pv(SEED_TENANT_ID, "monthly", "Monthly", 2),
      pv(SEED_TENANT_ID, "transient", "Transient", 3),
      pv(SEED_TENANT_ID, "recurring", "Recurring", 4),
    ],
  },
  {
    id: `pl_${SEED_TENANT_ID.slice(-6)}_payment_method`,
    tenant_id: SEED_TENANT_ID,
    field_key: "payment_method",
    label: "Payment method",
    description:
      "Available payment methods at POS and on invoices. Adjust based on what your processor supports.",
    editable: true,
    values: [
      pv(SEED_TENANT_ID, "card", "Card", 0),
      pv(SEED_TENANT_ID, "cash", "Cash", 1),
      pv(SEED_TENANT_ID, "ach", "ACH / bank transfer", 2),
      pv(SEED_TENANT_ID, "charge_to_account", "Charge to account", 3),
      pv(SEED_TENANT_ID, "check", "Check", 4),
      pv(SEED_TENANT_ID, "split", "Split tender", 5),
    ],
  },
  {
    id: `pl_${SEED_TENANT_ID.slice(-6)}_work_order_priority`,
    tenant_id: SEED_TENANT_ID,
    field_key: "work_order_priority",
    label: "Work order priority",
    description: "How urgent a work order is. Drives kanban sort and SLA alerts.",
    editable: true,
    values: [
      pv(SEED_TENANT_ID, "high", "High", 0),
      pv(SEED_TENANT_ID, "normal", "Normal", 1),
      pv(SEED_TENANT_ID, "low", "Low", 2),
    ],
  },
];

/**
 * Derive picklists for any additional tenant by cloning the primary
 * tenant's set. Each new tenant gets its own row + value ids so edits
 * don't leak across tenants. In production this happens at tenant-
 * creation time (Convex action); for the prototype we generate at
 * module load.
 */
function clonePicklistsForTenant(targetTenantId: string): Picklist[] {
  return PICKLISTS.map((p) => ({
    ...p,
    id: `${p.id}__${targetTenantId.slice(-6)}`,
    tenant_id: targetTenantId,
    values: p.values.map((v) => ({
      ...v,
      id: `${v.id}__${targetTenantId.slice(-6)}`,
    })),
  }));
}

// Multi-tenant picklist roster — primary tenant's seed + a derived
// copy for every additional tenant. Each tenant's edits land in their
// own rows, the switcher demo shows correct dropdowns on both sides.
export const ALL_PICKLISTS: Picklist[] = [
  ...PICKLISTS,
  ...clonePicklistsForTenant(SECOND_TENANT_ID),
];

// ── Marina profile (default seed values) ───────────────────────
export const MARINA_PROFILE_SEED: MarinaProfile = {
  id: `mp_${SEED_TENANT_ID.slice(-6)}`,
  tenant_id: SEED_TENANT_ID,
  display_name: "Marina Stee · Damsite Cove",
  short_name: "Marina Stee",
  tagline: "Family-run since 1972.",
  email: "harbormaster@marinastee.example",
  phone: "(505) 555-0100",
  website: "https://marinastee.example",
  address_line1: "1 Damsite Drive",
  city: "Santa Fe",
  state: "NM",
  postal_code: "87501",
  country: "USA",
  timezone: "America/Denver",
  business_hours_open: "08:00",
  business_hours_close: "20:00",
  default_tax_rate: 0.0825,
  accounting_close: "monthly_eom",
  outbound_email_from_name: "Marina Stee",
  outbound_sms_sender_label: "MarinaStee",
  // ── Notification provider config (H2 wave demo seed) ───────
  // PLACEHOLDERS — these are obviously-fake values so the marina-
  // profile editor renders pre-filled rows for the demo. Real keys
  // never land in source. The dispatch layer will treat these as
  // configured (the adapter resolvers only check string truthiness)
  // so the Postmark / Twilio calls WILL go out and 401 — which is
  // exactly the failure mode the timeline's "not delivered" badge
  // is designed to surface.
  postmark_api_key: "pmk_demo_xxxxxxxxxxxxxxxxxxxxx",
  postmark_message_stream: "outbound",
  twilio_account_sid: "ACdemo_xxxxxxxxxxxxxxxxxxxxx",
  twilio_auth_token: "twa_demo_xxxxxxxxxxxxxxxxxxxxx",
  twilio_from_number: "+15555550100",
  twilio_from_email_label: "Marina Stee",
};

// Second tenant's profile — different retention variants to demo the
// per-tenant config. Lakeside disabled the downgrade tier (they don't
// have a basic plan worth downgrading TO), so the cancel sheet only
// picks from half_off / free_month.
export const SECOND_MARINA_PROFILE_SEED: MarinaProfile = {
  id: `mp_${SECOND_TENANT_ID.slice(-6)}`,
  tenant_id: SECOND_TENANT_ID,
  display_name: "Lakeside Marina",
  short_name: "Lakeside",
  tagline: "Glacier-fed lake, year-round access.",
  email: "harbormaster@lakeside.example",
  phone: "(208) 555-0142",
  address_line1: "47 Lakeshore Rd",
  city: "Coeur d'Alene",
  state: "ID",
  postal_code: "83814",
  country: "USA",
  timezone: "America/Los_Angeles",
  business_hours_open: "07:00",
  business_hours_close: "21:00",
  default_tax_rate: 0.06,
  accounting_close: "monthly_15th",
  outbound_email_from_name: "Lakeside Marina",
  outbound_sms_sender_label: "Lakeside",
  enabled_retention_variants: ["half_off", "free_month"],
};

// Per-tenant profile lookup. Used by the store to swap profile on
// switchTenant() without losing either tenant's edits.
export const MARINA_PROFILES_BY_TENANT: Record<string, MarinaProfile> = {
  [SEED_TENANT_ID]: MARINA_PROFILE_SEED,
  [SECOND_TENANT_ID]: SECOND_MARINA_PROFILE_SEED,
};

// ── Comm templates (default seed values) ───────────────────────
export const COMM_TEMPLATES_SEED: CommTemplate[] = [
  {
    id: `ct_${SEED_TENANT_ID.slice(-6)}_receipt_pos`,
    tenant_id: SEED_TENANT_ID,
    kind: "receipt_pos_sale",
    name: "POS sale receipt",
    description: "Sent to the customer after a POS sale closes.",
    channel: "email",
    subject: "Marina Stee receipt — {{location.name}}",
    body_markdown:
      "Hi {{customer.first_name}},\n\nYour {{order.total_formatted}} purchase at {{location.name}} has been {{order.payment_verb}}.\n\nReceipt #{{order.number}}\nDate: {{order.date}}\n\n{{order.line_items_summary}}\n\nThanks for stopping by.\n— {{marina.short_name}}",
    active: true,
    available_tokens: [
      "customer.first_name",
      "customer.display_name",
      "order.number",
      "order.date",
      "order.total_formatted",
      "order.payment_verb",
      "order.line_items_summary",
      "location.name",
      "marina.short_name",
    ],
  },
  {
    id: `ct_${SEED_TENANT_ID.slice(-6)}_contract_sent`,
    tenant_id: SEED_TENANT_ID,
    kind: "contract_sent_for_signature",
    name: "Contract sent for signature",
    description:
      "Sent when a contract is drafted and the onboarding link is dispatched.",
    channel: "email",
    subject: "Welcome to {{marina.short_name}} — complete onboarding",
    body_markdown:
      "Hi {{boater.first_name}},\n\nYour slip {{slip.number}} at {{slip.dock}} is reserved. Please complete the following to activate your contract:\n\n  1. Review and sign your agreement\n  2. Add a payment method\n\nIt takes about 2 minutes: {{onboarding.url}}\n\nReply to this message if you have any questions.\n— {{marina.short_name}}",
    active: true,
    available_tokens: [
      "boater.first_name",
      "boater.display_name",
      "slip.number",
      "slip.dock",
      "onboarding.url",
      "contract.annual_rate_formatted",
      "marina.short_name",
    ],
  },
  {
    id: `ct_${SEED_TENANT_ID.slice(-6)}_contract_signed`,
    tenant_id: SEED_TENANT_ID,
    kind: "contract_signed_confirmation",
    name: "Contract signed confirmation",
    description: "Sent after the holder signs and finalizes onboarding.",
    channel: "email",
    subject: "You're all set at {{marina.short_name}}",
    body_markdown:
      "Hi {{boater.first_name}},\n\nThanks for completing onboarding. Your slip {{slip.number}} is active through {{contract.effective_end}}.\n\nA copy of your signed contract is attached for your records.\n\nWelcome aboard.\n— {{marina.short_name}}",
    active: true,
    available_tokens: [
      "boater.first_name",
      "slip.number",
      "contract.effective_end",
      "contract.number",
      "marina.short_name",
    ],
  },
  {
    id: `ct_${SEED_TENANT_ID.slice(-6)}_coi_reminder`,
    tenant_id: SEED_TENANT_ID,
    kind: "coi_reminder",
    name: "COI expiration reminder",
    description: "Sent when a holder's insurance certificate is approaching expiry.",
    channel: "email",
    subject: "Your insurance certificate expires {{coi.expires_at}}",
    body_markdown:
      "Hi {{boater.first_name}},\n\nYour Certificate of Insurance for {{vessel.name}} expires on {{coi.expires_at}}. Please upload a renewed COI at: {{coi.upload_url}}\n\nLapse of insurance suspends slip access per your lease — let us know if you need help.\n\n— {{marina.short_name}}",
    active: true,
    available_tokens: [
      "boater.first_name",
      "vessel.name",
      "coi.expires_at",
      "coi.upload_url",
      "marina.short_name",
    ],
  },
  {
    id: `ct_${SEED_TENANT_ID.slice(-6)}_renewal_reminder`,
    tenant_id: SEED_TENANT_ID,
    kind: "renewal_reminder",
    name: "Contract renewal reminder",
    description:
      "Sent to annual holders before their contract auto-renews — confirms intent and rate.",
    channel: "email",
    subject: "{{marina.short_name}} renewal — slip {{slip.number}}",
    body_markdown:
      "Hi {{boater.first_name}},\n\nYour annual slip lease at {{slip.number}} expires {{contract.effective_end}} and auto-renews unless you tell us otherwise.\n\nNext term rate: {{contract.annual_rate_formatted}} / year\n\nIf you'd like to make any changes (vessel swap, slip transfer, cancel), reply by {{deadline.date}}.\n\nThanks for keeping your boat with us.\n— {{marina.short_name}}",
    active: true,
    available_tokens: [
      "boater.first_name",
      "slip.number",
      "contract.effective_end",
      "contract.annual_rate_formatted",
      "deadline.date",
      "marina.short_name",
    ],
  },
  {
    id: `ct_${SEED_TENANT_ID.slice(-6)}_payment_failed`,
    tenant_id: SEED_TENANT_ID,
    kind: "payment_failed",
    name: "Payment failed",
    description:
      "Sent when an auto-charge attempt fails. Prompts the holder to update their card.",
    channel: "email",
    subject: "We couldn't charge your card — {{marina.short_name}}",
    body_markdown:
      "Hi {{boater.first_name}},\n\nWe tried to charge {{invoice.amount_formatted}} for invoice #{{invoice.number}} and the card on file was declined.\n\nUpdate your payment method here: {{portal.url}}\n\nWe'll retry in 24 hours. Reach out if you need help.\n— {{marina.short_name}}",
    active: true,
    available_tokens: [
      "boater.first_name",
      "invoice.number",
      "invoice.amount_formatted",
      "portal.url",
      "marina.short_name",
    ],
  },
  {
    id: `ct_${SEED_TENANT_ID.slice(-6)}_waitlist_offer`,
    tenant_id: SEED_TENANT_ID,
    kind: "waitlist_offer",
    name: "Waitlist offer",
    description: "Sent when a slip opens up and the next waitlist holder gets first dibs.",
    channel: "email",
    subject: "A slip just opened at {{marina.short_name}}",
    body_markdown:
      "Hi {{boater.first_name}},\n\nGood news — slip {{slip.number}} at {{slip.dock}} just became available, and you're next on the waitlist.\n\nThis offer is held for {{offer.hours_remaining}} hours. Claim it here: {{claim.url}}\n\n— {{marina.short_name}}",
    active: true,
    available_tokens: [
      "boater.first_name",
      "slip.number",
      "slip.dock",
      "offer.hours_remaining",
      "claim.url",
      "marina.short_name",
    ],
  },
  {
    id: `ct_${SEED_TENANT_ID.slice(-6)}_welcome_new`,
    tenant_id: SEED_TENANT_ID,
    kind: "welcome_new_holder",
    name: "Welcome — new holder",
    description: "First-touch comm after a brand new holder is created.",
    channel: "email",
    subject: "Welcome to {{marina.short_name}}",
    body_markdown:
      "Hi {{boater.first_name}},\n\nWelcome to {{marina.short_name}}. We're glad to have you.\n\nA few things to know:\n  • Office hours: {{marina.hours}}\n  • Pump-out: on-demand via the dock office or via the agent in your portal\n  • COI: please upload before your first launch — {{coi.upload_url}}\n\nReach out anytime.\n— {{marina.short_name}}",
    active: true,
    available_tokens: [
      "boater.first_name",
      "boater.display_name",
      "marina.short_name",
      "marina.hours",
      "coi.upload_url",
    ],
  },
];

// ── Roles + Staff (default seed values) ────────────────────────
export const ROLES_SEED: Role[] = [
  {
    id: `role_${SEED_TENANT_ID.slice(-6)}_super_admin`,
    tenant_id: SEED_TENANT_ID,
    name: "Super admin",
    description: "Full access to everything, including settings + staff management.",
    permissions: [
      "manage.settings",
      "manage.staff",
      "manage.picklists",
      "manage.catalog",
      "manage.marina_profile",
      "create.boater",
      "update.boater",
      "delete.boater",
      "create.contract",
      "terminate.contract",
      "create.work_order",
      "complete.work_order",
      "process.payment",
      "refund.payment",
      "run.annual_billing",
      "manage.qb_sync",
      "view.financials",
      "view.reports",
    ],
    is_system: true,
    sort_order: 0,
  },
  {
    id: `role_${SEED_TENANT_ID.slice(-6)}_manager`,
    tenant_id: SEED_TENANT_ID,
    name: "Manager",
    description: "Operations + financials. Cannot manage staff or core settings.",
    permissions: [
      "manage.catalog",
      "manage.picklists",
      "create.boater",
      "update.boater",
      "create.contract",
      "terminate.contract",
      "create.work_order",
      "complete.work_order",
      "process.payment",
      "refund.payment",
      "run.annual_billing",
      "view.financials",
      "view.reports",
    ],
    is_system: true,
    sort_order: 1,
  },
  {
    id: `role_${SEED_TENANT_ID.slice(-6)}_dockhand`,
    tenant_id: SEED_TENANT_ID,
    name: "Dockhand",
    description: "Day-of operations — POS, check-in/out, work orders.",
    permissions: [
      "create.boater",
      "update.boater",
      "create.work_order",
      "complete.work_order",
      "process.payment",
    ],
    is_system: true,
    sort_order: 2,
  },
  {
    id: `role_${SEED_TENANT_ID.slice(-6)}_office`,
    tenant_id: SEED_TENANT_ID,
    name: "Office",
    description: "Comms + invoicing. No closeout or refund powers.",
    permissions: [
      "create.boater",
      "update.boater",
      "create.contract",
      "view.financials",
    ],
    is_system: true,
    sort_order: 3,
  },
  {
    id: `role_${SEED_TENANT_ID.slice(-6)}_read_only`,
    tenant_id: SEED_TENANT_ID,
    name: "Read-only",
    description: "View everything, change nothing. Good for auditors + accountants.",
    permissions: ["view.financials", "view.reports"],
    is_system: true,
    sort_order: 4,
  },
];

export const STAFF_SEED: StaffMember[] = [
  {
    id: `staff_${SEED_TENANT_ID.slice(-6)}_owner`,
    tenant_id: SEED_TENANT_ID,
    name: "Sync, Service",
    email: "sync@marinastee.example",
    phone: "(505) 555-0101",
    role_id: `role_${SEED_TENANT_ID.slice(-6)}_super_admin`,
    status: "active",
    mfa_enabled: true,
    last_login_at: "2026-05-26T07:30:00Z",
    created_at: "2024-01-15T10:00:00Z",
    employment_type: "w2",
    salary_annual: 95000,
    payment_method: "direct_deposit",
    bank_account_last4: "4421",
    bank_routing_last4: "0014",
    hire_date: "2024-01-15",
    default_position: "Marina Owner",
    pto_hours_balance: 124,
    pto_accrual_hours_per_period: 6.15,
    mobile_clock_pin: "9921",
  },
  {
    id: `staff_${SEED_TENANT_ID.slice(-6)}_manager`,
    tenant_id: SEED_TENANT_ID,
    name: "Marina Manager",
    email: "manager@marinastee.example",
    phone: "(505) 555-0102",
    role_id: `role_${SEED_TENANT_ID.slice(-6)}_manager`,
    status: "active",
    mfa_enabled: true,
    last_login_at: "2026-05-25T18:14:00Z",
    created_at: "2024-02-01T09:00:00Z",
    employment_type: "w2",
    salary_annual: 68000,
    payment_method: "direct_deposit",
    bank_account_last4: "8812",
    bank_routing_last4: "0014",
    hire_date: "2024-02-01",
    default_position: "Harbormaster",
    pto_hours_balance: 88,
    pto_accrual_hours_per_period: 5,
    mobile_clock_pin: "4408",
  },
  {
    id: `staff_${SEED_TENANT_ID.slice(-6)}_dock_a`,
    tenant_id: SEED_TENANT_ID,
    name: "Dock Lead A",
    email: "dock-a@marinastee.example",
    phone: "(505) 555-0103",
    role_id: `role_${SEED_TENANT_ID.slice(-6)}_dockhand`,
    status: "active",
    mfa_enabled: false,
    last_login_at: "2026-05-26T06:50:00Z",
    created_at: "2025-03-12T08:00:00Z",
    employment_type: "w2",
    hourly_rate: 22,
    ot_multiplier: 1.5,
    payment_method: "direct_deposit",
    bank_account_last4: "0017",
    bank_routing_last4: "0014",
    hire_date: "2025-03-12",
    default_position: "Dockhand",
    pto_hours_balance: 16,
    pto_accrual_hours_per_period: 3.08,
    mobile_clock_pin: "1234",
  },
  // Second dockhand — needed so the time clock + payroll page have a
  // realistic multi-staff roster (4 staff total: owner, manager, two
  // dockhands). Time Clock + Payroll Prep feature spec.
  {
    id: `staff_${SEED_TENANT_ID.slice(-6)}_dock_b`,
    tenant_id: SEED_TENANT_ID,
    name: "Dock Lead B",
    email: "dock-b@marinastee.example",
    phone: "(505) 555-0104",
    role_id: `role_${SEED_TENANT_ID.slice(-6)}_dockhand`,
    status: "active",
    mfa_enabled: false,
    last_login_at: "2026-05-26T05:55:00Z",
    created_at: "2025-04-05T08:00:00Z",
    employment_type: "w2",
    hourly_rate: 24,
    ot_multiplier: 1.5,
    payment_method: "direct_deposit",
    bank_account_last4: "5520",
    bank_routing_last4: "0014",
    hire_date: "2025-04-05",
    default_position: "Dockhand",
    pto_hours_balance: 12,
    pto_accrual_hours_per_period: 3.08,
    mobile_clock_pin: "5678",
  },
];

// ── Provider configs (default seed — disconnected) ────────────
export const PROVIDER_CONFIGS_SEED: AppProviderConfig[] = [
  {
    id: `prov_${SEED_TENANT_ID.slice(-6)}_stripe`,
    tenant_id: SEED_TENANT_ID,
    kind: "payment",
    provider: "stripe",
    display_name: "Stripe",
    status: "disconnected",
    config: { publishable_key: "", secret_key_set: false, default_currency: "usd" },
  },
  {
    id: `prov_${SEED_TENANT_ID.slice(-6)}_postmark`,
    tenant_id: SEED_TENANT_ID,
    kind: "email",
    provider: "postmark",
    display_name: "Postmark",
    status: "disconnected",
    config: { server_token_set: false, from_address: "" },
  },
  {
    id: `prov_${SEED_TENANT_ID.slice(-6)}_twilio`,
    tenant_id: SEED_TENANT_ID,
    kind: "sms",
    provider: "twilio",
    display_name: "Twilio",
    status: "disconnected",
    config: { account_sid: "", auth_token_set: false, from_number: "" },
  },
  {
    id: `prov_${SEED_TENANT_ID.slice(-6)}_quickbooks`,
    tenant_id: SEED_TENANT_ID,
    kind: "accounting",
    provider: "quickbooks",
    display_name: "QuickBooks Online",
    status: "needs_attention",
    config: { realm_id: "9341452847219000", oauth_refresh_set: true, expires_at: "2026-05-29" },
    connected_at: "2025-09-15T14:00:00Z",
    last_error: "Re-authorize — connection expires in 3 days",
  },
];

export const USERS: User[] = [
  { id: "u_steven", name: "Bills, Steven", role: "manager" },
  { id: "u_tiffany", name: "Peterson, Tiffany", role: "accounting" },
  { id: "u_will", name: "Lodging, Will", role: "dockhand" },
  { id: "u_peter", name: "Meiusi, Peter", role: "dockhand" },
  { id: "u_jreyes", name: "Reyes, J.", role: "dockhand" },
  { id: "u_sync", name: "Sync, Service", role: "system" },
  { id: "u_public", name: "Public, User", role: "system" },
];

// ── Multi-tenant settings clones ───────────────────────────────
//
// Lakeside (and any future tenant) needs its own templates, roles,
// staff, and provider configs so its Settings pages aren't empty.
// We clone the primary tenant's defaults and re-tenant the rows.
// Roles preserve `is_system` so the built-in admin/manager/dockhand
// roles work the same way on both sides. Staff list is intentionally
// truncated to a single admin so the prototype isn't bogged down.

function cloneCommTemplatesForTenant(targetTenantId: string): CommTemplate[] {
  return COMM_TEMPLATES_SEED.map((t) => ({
    ...t,
    id: `${t.id}__${targetTenantId.slice(-6)}`,
    tenant_id: targetTenantId,
  }));
}
function cloneRolesForTenant(targetTenantId: string): Role[] {
  return ROLES_SEED.map((r) => ({
    ...r,
    id: `${r.id}__${targetTenantId.slice(-6)}`,
    tenant_id: targetTenantId,
  }));
}
function cloneProviderConfigsForTenant(targetTenantId: string): AppProviderConfig[] {
  return PROVIDER_CONFIGS_SEED.map((p) => ({
    ...p,
    id: `${p.id}__${targetTenantId.slice(-6)}`,
    tenant_id: targetTenantId,
    // Reset connection state — Lakeside isn't actually connected to
    // Marina Stee's Stripe/QB/etc. accounts.
    status: "disconnected" as const,
    connected_at: undefined,
    last_error: undefined,
  }));
}
function cloneStaffForTenant(
  targetTenantId: string,
  roleSet: Role[]
): StaffMember[] {
  // Pick the first non-system, highest-permission role as the seed
  // admin so the cloned staff entry actually has authority. Falls
  // back to the first role if no clear "manager" tier exists.
  const adminRole =
    roleSet.find((r) => r.name.toLowerCase().includes("manager")) ??
    roleSet.find((r) => !r.is_system) ??
    roleSet[0];
  if (!adminRole) return [];
  return [
    {
      id: `staff_${targetTenantId.slice(-6)}_admin`,
      tenant_id: targetTenantId,
      name: "Lakeside Owner",
      email: "owner@lakeside-marina.example",
      role_id: adminRole.id,
      status: "active",
      mfa_enabled: true,
      created_at: "2026-03-15T08:00:00Z",
    },
  ];
}

const LAKESIDE_COMM_TEMPLATES = cloneCommTemplatesForTenant(SECOND_TENANT_ID);
const LAKESIDE_ROLES = cloneRolesForTenant(SECOND_TENANT_ID);
const LAKESIDE_PROVIDER_CONFIGS = cloneProviderConfigsForTenant(SECOND_TENANT_ID);
const LAKESIDE_STAFF = cloneStaffForTenant(SECOND_TENANT_ID, LAKESIDE_ROLES);

export const ALL_COMM_TEMPLATES: CommTemplate[] = [
  ...COMM_TEMPLATES_SEED,
  ...LAKESIDE_COMM_TEMPLATES,
];
export const ALL_ROLES: Role[] = [...ROLES_SEED, ...LAKESIDE_ROLES];
export const ALL_PROVIDER_CONFIGS: AppProviderConfig[] = [
  ...PROVIDER_CONFIGS_SEED,
  ...LAKESIDE_PROVIDER_CONFIGS,
];
export const ALL_STAFF: StaffMember[] = [...STAFF_SEED, ...LAKESIDE_STAFF];

// Slips referenced by reservations / contracts. We populate the named docks
// densely enough that the annual roster generator below has somewhere to
// place every holder. NOT every space in RENTAL_SPACES needs an entry here —
// SLIPS is the lookup namespace for reservation.slip_id (legacy convention,
// `id` is the user-facing label like "A29"), RENTAL_SPACES is the physical
// inventory.
/**
 * Annual-rate baseline by slip class. The default_annual_rate field on
 * each Slip is derived from these and scaled by length — covered slips
 * carry a ~40% premium over uncovered, T-heads roughly 2× uncovered.
 * Real marinas tune these per market; this is a defensible mid-Michigan
 * freshwater set.
 */
const BASE_ANNUAL_BY_CLASS: Record<SlipClass, number> = {
  covered: 4200,        // base @ 24'; bumps with length below
  uncovered: 2800,
  t_head: 5500,         // premium end-of-dock spots
  buoy: 1100,
  dry_storage: 2200,
};

function annualRateFor(loa: number, slipClass: SlipClass): number {
  const base = BASE_ANNUAL_BY_CLASS[slipClass];
  // Linear scale beyond a 24' baseline — $90/ft for uncovered, $130/ft
  // for covered, $160/ft for T-heads. Round to the nearest $50 so
  // pricing reads like a published list rather than a calc output.
  const lengthBump =
    loa <= 24
      ? 0
      : slipClass === "covered"
      ? (loa - 24) * 130
      : slipClass === "t_head"
      ? (loa - 24) * 160
      : slipClass === "uncovered"
      ? (loa - 24) * 90
      : 0;
  return Math.round((base + lengthBump) / 50) * 50;
}

function makeSlip(
  dock: string,
  prefix: string,
  num: number,
  loa: number,
  beam: number,
  withWater = true,
  category = "BOGGS Cove",
  slipClass: SlipClass = "uncovered",
): Slip {
  const padded = String(num).padStart(2, "0");
  const annual = annualRateFor(loa, slipClass);
  return {
    id: `${prefix}${padded}`,
    dock_id: `dock_${prefix.toLowerCase()}`,
    dock,
    invoice_category: category,
    number: padded,
    max_loa_inches: loa * 12,
    max_beam_inches: beam * 12,
    has_power: true,
    has_water: withWater,
    slip_class: slipClass,
    default_annual_rate: annual,
    // 1/12 with a small markup to nudge holders toward annual
    default_monthly_rate: Math.round((annual * 1.08) / 12 / 5) * 5,
    // 6-month seasonal at ~60% of annual
    default_seasonal_rate: Math.round((annual * 0.6) / 50) * 50,
  };
}

// Dock entities — Slip.dock_id points here. Operators edit these via
// Settings → Docks; the prefix drives auto-generated slip ids when
// adding a new slip.
export const DOCKS: Dock[] = [
  { id: "dock_a", tenant_id: SEED_TENANT_ID, name: "Damsite A Dock", short_name: "A Dock", prefix: "A", sort_order: 0, active: true },
  { id: "dock_b", tenant_id: SEED_TENANT_ID, name: "Damsite B Dock", short_name: "B Dock", prefix: "B", sort_order: 1, active: true },
  { id: "dock_c", tenant_id: SEED_TENANT_ID, name: "Damsite C Dock", short_name: "C Dock", prefix: "C", sort_order: 2, active: true },
  { id: "dock_d", tenant_id: SEED_TENANT_ID, name: "Damsite D Dock", short_name: "D Dock", prefix: "D", sort_order: 3, active: true },
  { id: "dock_e", tenant_id: SEED_TENANT_ID, name: "Damsite E Dock", short_name: "E Dock", prefix: "E", sort_order: 4, active: true },
  { id: "dock_t", tenant_id: SEED_TENANT_ID, name: "Transient Dock", short_name: "Transient", prefix: "T", sort_order: 5, active: true },
];

const BASE_SLIPS: Slip[] = [
  // Damsite A Dock — 30 uncovered slips, 24–34 ft. Standard pricing.
  ...Array.from({ length: 30 }, (_, i) => {
    const num = i + 1;
    const loa = num % 4 === 0 ? 34 : num % 3 === 0 ? 32 : num % 2 === 0 ? 30 : 28;
    return makeSlip("Damsite A Dock", "A", num, loa, 12, true, "BOGGS Cove", "uncovered");
  }),
  // Damsite B Dock — 18 COVERED slips, 32–40 ft. Premium pricing.
  ...Array.from({ length: 18 }, (_, i) => {
    const num = i + 1;
    const loa = num % 3 === 0 ? 40 : num % 2 === 0 ? 36 : 32;
    return makeSlip("Damsite B Dock", "B", num, loa, 14, true, "BOGGS Cove", "covered");
  }),
  // Damsite C Dock — 14 uncovered, 26–32 ft (one without water for variety)
  ...Array.from({ length: 14 }, (_, i) => {
    const num = i + 1;
    const loa = num % 4 === 0 ? 32 : num % 2 === 0 ? 28 : 26;
    return makeSlip("Damsite C Dock", "C", num, loa, 10, num !== 4, "BOGGS Cove", "uncovered");
  }),
  // Damsite D Dock — 10 large slips. First two are T-heads (premium
  // end-of-dock), rest are covered. The mix that real marinas list.
  ...Array.from({ length: 10 }, (_, i) => {
    const num = i + 1;
    const loa = num % 3 === 0 ? 44 : num % 2 === 0 ? 42 : 38;
    const cls: SlipClass = num <= 2 ? "t_head" : "covered";
    return makeSlip("Damsite D Dock", "D", num, loa, 16, true, "BOGGS Cove", cls);
  }),
  // Damsite E Dock — 8 small uncovered slips, 22–26 ft. Entry-tier.
  ...Array.from({ length: 8 }, (_, i) => {
    const num = i + 1;
    return makeSlip("Damsite E Dock", "E", num, 24, 9, true, "BOGGS Cove", "uncovered");
  }),
  // Transient — 4 dedicated dock-walker slips. Annual rate is set but
  // they're typically billed nightly via the /dock check-in chain.
  ...Array.from({ length: 4 }, (_, i) => {
    const num = i + 1;
    const padded = `0${num}`;
    return {
      id: `T${padded}`,
      dock_id: "dock_t",
      dock: "Transient Dock",
      invoice_category: "BOGGS Cove",
      number: `T-${padded}`,
      max_loa_inches: 45 * 12,
      max_beam_inches: 14 * 12,
      has_power: true,
      has_water: true,
      slip_class: "uncovered" as const,
      default_annual_rate: annualRateFor(45, "uncovered"),
    };
  }),
];

export const SLIPS: Slip[] = withTenantId(BASE_SLIPS);

const BASE_CONTRACT_TEMPLATES: ContractTemplate[] = [
  {
    id: "tpl_annual_slip",
    name: "Space Rental Agreement — Annual",
    type: "annual",
    version: 1,
    default_term_months: 12,
    default_billing_cadence: "annual",
    body_preview: "This Space Rental Agreement is between Marina Vista, dba Marina Del Sur, Damsite Marina (LANDLORD) and the TENANT. By signing, the TENANT confirms all information provided during onboarding is accurate and agrees to the terms below.",
    required_signers: ["boater", "manager"],
    auto_renew: true,
    body_markdown: `# SPACE RENTAL AGREEMENT

**Marina Vista, dba Marina Del Sur, Damsite Marina**
101 South Highway 195 – PO Box 1070 Elephant Butte NM 87935  Office # (575) 744-5567
www.marinadelsur.us & www.thedamsite.com

This Space Rental Agreement is entered into between **Marina Vista**, County of Sierra, State of New Mexico (hereinafter LANDLORD) and the TENANT identified during onboarding. This AGREEMENT is for the period specified at registration, inclusive and may be renewable for additional periods upon agreement of both parties as to rates, conditions, space involved and payment of all specified fees and services.

**TENANT payments for slip fees, electricity, and POS items are due on the FIRST of each month.** A twelve-dollar charge is added to each billing except annual. TENANT Agrees that all charges for space rental, repairs, gas, oil, hardware, lines or any other services or accessories accruing under the terms of this contract shall give the LANDLORD a valid lien upon TENANT'S boat and/or motor and that no boat shall be removed from the LANDLORD'S premises until all charges are fully paid.

It is agreed that this contract is performable, and venue shall be in the State and County of LANDLORD. All notices required by this Boat Space Rental Agreement shall be to the addresses provided during registration.

**I (we) acknowledge receipt of a copy of this agreement.**

## Terms and Conditions

1. No commercial or revenue-producing activities shall be conducted from the slip or the Lessee's use of the slip. Lessee's conduct of any commercial or revenue-producing activity from the slip is an event of default and Lessor may immediately terminate this lease.

2. LANDLORD reserves the right to assign dock space, however all efforts consistent with good business practices and the rights and desires of other Tenants will be exercised to assign dock space desired by the TENANT.

3. The LANDLORD reserves the right to lease or refuse to lease to any person for any good or pertinent reason.

4. It is agreed between both parties that TENANT shall not assign, transfer, or permit the use of assigned space to any other party without written consent of the LANDLORD, which consent shall not be unreasonably withheld.

5. TENANT agrees that only reasonable and customary use will be made of the docks and facilities covered hereby, and that no unnecessary wear and tear, disturbance, nuisance, rubbish or garbage will be permitted on the dock or premises, and that the TENANT will keep dock and premises covered hereby free and clear of gear, tackle and all other obstructions, and further agrees to throw nothing, including treated or untreated effluent or sewage from heads or holding tanks in the lake.

6. Any infraction of the rules and regulations contained herein or as posted in the office by the LANDLORD shall, at the option of the LANDLORD, cancel this lease agreement upon ten (10) days' notice, (and notice given to TENANT) and the TENANT shall remove the boat from the premises. Cancellation shall be subject to TENANT having ten (10) days to cure. Any overpayment by TENANT shall be refunded upon termination.

7. If TENANT desires to dock a boat other than the one described within, said TENANT must first secure permission of the LANDLORD and pay any additional fees as applicable.

8. The use of Marina electrical outlets for the operation of power tools, battery chargers, welders, air conditioners, heating units, etc., are prohibited except by special permission.

9. The LANDLORD cannot and does not guarantee the continuity of electrical service where provided.

10. The use of torches or open flame, inflammable or toxic removers, or any other hazardous equipment is prohibited.

11. The LANDLORD will not be responsible for delays in hauling, launching, winterizing, or commissioning, occasioned by inclement weather or any other circumstances beyond its control.

12. A TENANT may work on their own boat if such work does not interfere with the rights, privileges and safety of other persons or property. LANDLORD shall reserve the right to require an access fee from any outside mechanic, craftsman or any other persons performing any work on TENANT'S boat while in or on the premises of LANDLORD and to first provide LANDLORD or its manager with a standard certificate of workman's compensation and liability insurance coverage in order to protect the health, safety, welfare and property of other TENANTS. Failure to meet these requirements would require that TENANT'S boat be removed from the premises of LANDLORD for repairs.

13. Rent is due on the 1st of the month, any payments received later than the 10th of the month will be considered LATE and will accrue a $25.00 fee to be added to the following month's invoice. An additional $50.00 late fee will be added to the balance for each additional thirty (30) days late.

14. TENANT duly authorizes LANDLORD, its Agents or Employees to move and/or operate TENANT'S boat during the making of repairs or for normal Marina operations solely at TENANT'S risk.

15. IT IS UNDERSTOOD AND AGREED that no boat is to be removed from its space unless and until all charges for space rental, service and/or materials have been paid in full.

16. TENANT AGREES THAT IN THE EVENT SUIT IS BROUGHT ON BEHALF OF THE LANDLORD AGAINST TENANT TO COLLECT ANY AMOUNTS DUE OR TO BECOME DUE HEREUNDER, OR TO ENFORCE ANY APPROPRIATE LIENS, THE TENANT SHALL PAY THE LANDLORD'S REASONABLE ATTORNEY FEES FOR SUCH SUIT OR COLLECTION PLUS COSTS, AS PROVIDED BY LAW.

17. In the event TENANT fails to remove their boat and property from the space rented at the termination of the space rental term as defined in Paragraph one (1) of this agreement, LANDLORD may at its sole option: (1) charge to TENANT'S account rent daily on a pro rata basis for each day or portion thereof the space is occupied; (2) avail itself of the remedies provided for in paragraph (18); (3) avail itself of any other remedy available to LANDLORD under the law.

18. If TENANT becomes delinquent on rental payments, the LANDLORD shall have the right to take over the property of the TENANT and to secure the property to the space occupied or to store it in any other location. Space made vacant by the removal of property of the TENANT may then be rented to another tenant at the discretion of the LANDLORD.

19. INSURANCE: TENANT AGREES that they will keep the boat fully insured with complete marine insurance, including hull coverage and indemnity and/or liability insurance.

20. THE LANDLORD DOES NOT CARRY INSURANCE covering the property of the TENANT. THE LANDLORD WILL NOT BE RESPONSIBLE for any injuries or property damage resulting, caused by, or growing out of the use of dock or Marina facilities; that the TENANT RELEASES AND DISCHARGES THE LANDLORD from any and all liability from loss, injury (including death), or damages to persons or property sustained while in or on the facilities of LANDLORD, including fire, theft, vandalism, windstorm, high or low waters, hail, rain, ice, collision or accident, or any other Act Of God, whether said boat is being parked or hauled by an agent of LANDLORD or not.

21. Operation of the boat shall be restricted to TENANT'S SIGNATORY TO THIS AGREEMENT and other persons authorized by TENANT, unless otherwise specified IN WRITING herein.

22. TENANT shall provide LANDLORD with a set of main door or hatch and ignition keys. The boat will be entered by LANDLORD only for periodic inspection or for emergency service.

23. IN CASE OF EMERGENCY, as determined by LANDLORD, the LANDLORD shall be authorized to move the subject boat, if possible and practical, to a safer area to protect the boat, property or general welfare if boat is unattended and TENANT cannot be reached. However, UNDER NO CIRCUMSTANCES is LANDLORD under any obligation to provide this service. Any costs incurred by LANDLORD shall be billed at the yard rate or as posted in the office. TENANT agrees to indemnify and hold harmless from any and all liability, loss or damage caused by or to the subject boat which may arise out of failure of the TENANT to move the boat, the inability of the LANDLORD to reach the TENANT, or by the movement of the boat by the LANDLORD. In general, the TENANT shall be solely responsible for any emergency measures.

24. DRY STORAGE SURVEY AND INSPECTION: The TENANT authorizes the LANDLORD to thoroughly survey the boat for fire hazards at hauling or prior, to removing to dry storage. TENANT understands that this regulation is formulated, enforced and conducted solely for the protection of the TENANT. The promulgation and enforcement of these rules and regulations, the conducting of the survey, the failure to require or fully perform a survey with respect to other TENANT(S) will not subject the LANDLORD to any duty or liability to the TENANT with respect to fire or explosion prevention or detection. In general, any survey will be solely at the discretion of the LANDLORD.

25. DRY STORAGE PROTECTIVE COVERING: The TENANT assumes full responsibility for providing adequate covering to protect the boat from any and all perils and for the proper maintenance of such covering while the boat is on or in the premises of the LANDLORD.

26. REMOVAL OF PERSONAL PROPERTY: The TENANT should remove any personal property from the boat prior to dry storage. IT IS UNDERSTOOD AND AGREED THAT LANDLORD WILL NOT BE RESPONSIBLE FOR ANY ITEMS OF PERSONAL PROPERTY LEFT IN THE BOAT.

27. BOAT SINKING: In the event TENANT'S boat shall, for any reason, sink while berthed in a slip, at dockside or while otherwise occupying Marina waters used by customers of LANDLORD. LANDLORD may, with all costs at TENANT'S expense, take immediate steps to raise and remove and/or repair said boat, if: (1) Boat presents an impending risk of damage to other boats or Marina facilities; (2) constitutes a safety or water navigation hazard.

28. ENTIRE AGREEMENT: This agreement contains the entire understanding between the TENANT and the LANDLORD and no other representation or inducement, verbal or written, has been made which is not contained in this agreement. LANDLORD and TENANT agree that if any paragraph or provision violates the law and is unenforceable, the rest of the contract will be valid.

29. In case of on-site sale of craft, BOR requires that the seller use Marina Vista as the broker. There is a 10% brokerage fee plus applicable taxes required for each sale. No craft may be sold on the Marina without this brokerage contract in place. All other sales must take place off-site, and no signage advertising craft is allowed.

It is agreed that this contract is performable, and venue shall be in the State and County of LANDLORD. All notices required by this Boat Space Rental Agreement or the Law shall be to the addresses stated herein.

30. ASSIGNABILITY: Lessor may assign this lease in its absolute discretion.

---

**By signing below, I certify that all information I provided during this registration (contact details, vessel information, emergency contacts, and insurance information) is accurate and complete. I agree to notify Marina Vista promptly of any changes. I have read, understood, and agree to all terms and conditions above.**

**Tenant signature:** ______________________________ Date: ____________

**Secondary tenant (if applicable):** ______________________________ Date: ____________

**Marina Manager:** ______________________________ Date: ____________
`,
  },
  {
    id: "tpl_seasonal_slip",
    name: "Seasonal Slip Lease",
    type: "seasonal_slip",
    version: 2,
    default_term_months: 6,
    default_billing_cadence: "monthly",
    default_annual_rate: 2200,
    body_preview: "Seasonal slip term from {{contract.effective_start}} through {{contract.effective_end}}…",
    required_signers: ["boater", "manager"],
    auto_renew: false,
    body_markdown: `# Seasonal Slip Lease Agreement

**Marina:** Marina Stee
**Holder:** {{boater.display_name}} ({{boater.code}})
**Slip:** {{slip.number}} · {{slip.dock}}
**Vessel:** {{vessel.name}}
**Season:** {{contract.effective_start}} → {{contract.effective_end}}

---

## 1. Slip Assignment
Marina Stee grants the Holder use of slip **{{slip.number}}** for the season specified above. The Holder must remove the vessel by the end-of-season date; daily storage fees apply thereafter.

## 2. Term
This Agreement covers a single season and does **not** auto-renew. A new agreement is required for the following season.

## 3. Fees
- **Seasonal rate:** {{contract.annual_rate_formatted}}
- **Billing cadence:** {{contract.billing_cadence}}
- **Add-ons:** {{contract.services_summary}}

## 4. Insurance
A current COI is required for the entire season. See Section 4 of the Annual Slip Lease for coverage minimums.

## 5. Use
Identical to the Annual Slip Lease. No live-aboard, no commercial use, abide by posted Marina rules.

## 6. Signatures

**Holder:** ______________________________ Date: ____________
{{boater.display_name}}

**Marina Manager:** ______________________________ Date: ____________
Marina Stee
`,
  },
  {
    id: "tpl_winterization",
    name: "Winterization Service",
    type: "winterization",
    version: 1,
    default_term_months: 1,
    default_billing_cadence: "transient",
    body_preview: "Marina Stee will winterize the vessel described below…",
    required_signers: ["boater"],
    auto_renew: false,
    body_markdown: `# Winterization Service Agreement

**Marina:** Marina Stee
**Holder:** {{boater.display_name}}
**Vessel:** {{vessel.name}} ({{vessel.year}} {{vessel.make}} {{vessel.model}})
**Scheduled date:** {{contract.effective_start}}

---

## Scope of Work
Marina Stee will perform standard winterization on the vessel above:
- Engine flush + fuel stabilizer
- Plumbing antifreeze (fresh water + head)
- Battery disconnect + trickle-charge setup
- Hull rinse + cover fit-check

## Service Fee
Total: {{contract.annual_rate_formatted}}. Billed at completion.

## Holder Responsibilities
- Vessel must be empty of personal effects on the scheduled date
- Hull cover supplied by Holder
- Any additional work outside the scope above is billed separately

## Signature

**Holder:** ______________________________ Date: ____________
{{boater.display_name}}
`,
  },
];

export const CONTRACT_TEMPLATES: ContractTemplate[] = withTenantId(
  BASE_CONTRACT_TEMPLATES
);

// ============================================================
// David Emmons — anchor profile pulled from the reference
// ============================================================

const emmonsVessel: Vessel = {
  id: "v_emmons_bayliner",
  boater_id: "b_emmons",
  co_owner_ids: [],
  name: "1989 Bayliner S",
  year: 1989,
  make: "Bayliner",
  model: "Capri",
  color: "white / blue",
  vessel_type: "powerboat",
  fuel_type: "gasoline",
  loa_inches: 24 * 12 + 6,
  beam_inches: 8 * 12 + 6,
  draft_inches: 30,
  height_inches: 9 * 12,
  registration: "NM2694EC",
  photos: [
    "https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1605281317010-fe5ffe798166?w=400&h=300&fit=crop",
  ],
  active: true,
};

const emmonsContract: Contract = {
  id: "c_emmons_2026",
  number: "C-1042",
  boater_id: "b_emmons",
  template_id: "tpl_annual_slip",
  template_version: 3,
  vessel_id: "v_emmons_bayliner",
  slip_id: "A29",
  status: "active",
  effective_start: "2026-04-01",
  effective_end: "2027-03-31",
  signed_at: "2026-03-12",
  annual_rate: 3900,
  billing_cadence: "monthly",
};

const emmonsReservations: Reservation[] = [
  {
    id: "r_155",
    number: "R155",
    seq: "1/1",
    boater_id: "b_emmons",
    vessel_id: "v_emmons_bayliner",
    slip_id: "A29",
    contract_id: "c_emmons_2025",
    arrival_date: "2024-04-01",
    departure_date: "2025-04-15",
    status: "completed",
    type: "recurring",
  },
  {
    id: "r_513_1",
    number: "R513",
    seq: "1/2",
    boater_id: "b_emmons",
    vessel_id: "v_emmons_bayliner",
    slip_id: "A29",
    contract_id: "c_emmons_2025_2",
    arrival_date: "2025-04-01",
    departure_date: "2026-03-31",
    status: "completed",
    type: "recurring",
  },
  {
    id: "r_513_2",
    number: "R513",
    seq: "2/2",
    boater_id: "b_emmons",
    vessel_id: "v_emmons_bayliner",
    slip_id: "A29",
    contract_id: "c_emmons_2026",
    arrival_date: "2026-04-01",
    departure_date: "2027-03-31",
    status: "occupied",
    type: "recurring",
  },
];

// Transaction history with refund example
const emmonsLedger: LedgerEntry[] = [
  // June: open invoice (not paid yet)
  {
    id: "le_jun_inv",
    boater_id: "b_emmons",
    type: "invoice",
    number: "MG5507",
    date: "2026-06-01",
    amount: 325,
    open_balance: 325,
    method: null,
    status: "open",
    line_items: [{ description: "Slip A29 — June 2026", amount: 325 }],
  },
  // May: invoice + small fuel charge, paid via card payment
  {
    id: "le_may_inv",
    boater_id: "b_emmons",
    type: "invoice",
    number: "MG5121",
    date: "2026-05-01",
    amount: 325,
    open_balance: 0,
    method: null,
    status: "paid",
    line_items: [{ description: "Slip A29 — May 2026", amount: 325 }],
  },
  {
    id: "le_may_fuel",
    boater_id: "b_emmons",
    type: "invoice",
    number: "MG5310",
    date: "2026-05-01",
    amount: 8.13,
    open_balance: 0,
    method: null,
    status: "paid",
    line_items: [{ description: "Fuel charge — pedestal A04", amount: 8.13 }],
  },
  {
    id: "le_may_pmt",
    boater_id: "b_emmons",
    type: "payment",
    date: "2026-05-01",
    amount: 333.13,
    open_balance: 0,
    method: "card",
    applied_to_invoice_ids: ["le_may_inv", "le_may_fuel"],
    processor_ref: "pi_3OqXxxK",
    status: "paid",
  },
  // April: payment + refund example (weather credit, $25 refunded)
  {
    id: "le_apr_pmt",
    boater_id: "b_emmons",
    type: "payment",
    date: "2026-04-02",
    amount: 333.13,
    open_balance: 0,
    method: "card",
    applied_to_invoice_ids: ["le_apr_inv", "le_apr_fuel"],
    processor_ref: "pi_3OpXxxK",
    status: "partial_refund",
  },
  {
    id: "le_apr_refund",
    boater_id: "b_emmons",
    type: "refund",
    date: "2026-04-05",
    amount: -25.0,
    open_balance: 0,
    method: "card",
    applied_payment_id: "le_apr_pmt",
    refund_reason: "weather_credit",
    refund_notes: "Storm closure 4/3 — partial credit per marina policy",
    issued_by_user_id: "u_steven",
    processor_ref: "re_3OpYrK",
    status: "paid",
  },
  {
    id: "le_apr_fuel",
    boater_id: "b_emmons",
    type: "invoice",
    number: "MG4975",
    date: "2026-04-02",
    amount: 8.13,
    open_balance: 0,
    method: null,
    status: "paid",
  },
  {
    id: "le_apr_inv",
    boater_id: "b_emmons",
    type: "invoice",
    number: "MG4838",
    date: "2026-04-01",
    amount: 325,
    open_balance: 0,
    method: null,
    status: "paid",
    line_items: [{ description: "Slip A29 — April 2026", amount: 325 }],
  },
  // March: clean payment
  {
    id: "le_mar_pmt",
    boater_id: "b_emmons",
    type: "payment",
    date: "2026-03-01",
    amount: 333.13,
    open_balance: 0,
    method: "card",
    applied_to_invoice_ids: ["le_mar_inv", "le_mar_fuel"],
    processor_ref: "pi_3OnXxxK",
    status: "paid",
  },
  {
    id: "le_mar_inv",
    boater_id: "b_emmons",
    type: "invoice",
    number: "MG4353",
    date: "2026-03-01",
    amount: 325,
    open_balance: 0,
    method: null,
    status: "paid",
  },
  {
    id: "le_mar_fuel",
    boater_id: "b_emmons",
    type: "invoice",
    number: "MG4513",
    date: "2026-03-01",
    amount: 8.13,
    open_balance: 0,
    method: null,
    status: "paid",
  },
];

const emmonsCards: CardOnFile[] = [
  {
    id: "card_emmons_default",
    brand: "visa",
    last4: "4242",
    exp_month: 4,
    exp_year: 2028,
    nickname: "Personal",
    is_default: true,
    processor_token: "tok_xxxx_redacted",
  },
];

const emmonsComms: Communication[] = [
  {
    id: "cm_signed",
    boater_id: "b_emmons",
    type: "email",
    direction: "outbound",
    subject: "Contract signed",
    body_preview: "Your annual slip contract for A29 has been countersigned…",
    sender_label: "Public, User",
    sender_is_system: true,
    recipient: "daveemmons05@yahoo.com",
    sent_at: "2026-05-11T04:02:00Z",
    status: "delivered",
    related_entity: { type: "contract", id: "c_emmons_2026" },
  },
  {
    id: "cm_may_rcpt",
    boater_id: "b_emmons",
    type: "email",
    direction: "outbound",
    subject: "Marina Vista Receipt",
    body_preview: "Receipt for $333.13 — May slip and fuel charges",
    sender_label: "Peterson, Tiffany",
    sender_is_system: false,
    recipient: "daveemmons05@yahoo.com",
    sent_at: "2026-05-01T14:19:00Z",
    status: "opened",
    related_entity: { type: "invoice", id: "le_may_inv" },
  },
  {
    id: "cm_apr_contract",
    boater_id: "b_emmons",
    type: "email",
    direction: "outbound",
    subject: "A new rental contract is available for viewing and signing",
    body_preview: "Your annual slip lease for A29 is ready for signature…",
    sender_label: "Sync, Service",
    sender_is_system: true,
    recipient: "daveemmons05@yahoo.com",
    sent_at: "2026-04-11T14:45:00Z",
    status: "clicked",
    related_entity: { type: "contract", id: "c_emmons_2026" },
  },
  {
    id: "cm_storm_sms",
    boater_id: "b_emmons",
    type: "sms",
    direction: "outbound",
    body_preview: "Storm watch active — please secure your vessel by 6pm. Reply STOP to opt out.",
    sender_label: "Sync, Service",
    sender_is_system: true,
    recipient: "+15058971949",
    sent_at: "2026-04-03T10:12:00Z",
    status: "delivered",
  },
  {
    id: "cm_inbound_thanks",
    boater_id: "b_emmons",
    type: "sms",
    direction: "inbound",
    body_preview: "Thanks for the heads-up — boat is buttoned up.",
    sender_label: "David Emmons",
    sender_is_system: false,
    recipient: "marina",
    sent_at: "2026-04-03T11:04:00Z",
    status: "delivered",
  },
];

/**
 * Default cleaning checklist seeded onto fresh cleaning WOs when the
 * operator doesn't customize. Matches DockLog's adopted pattern but
 * trimmed to the items a marina-side cleaning crew actually walks
 * through on a topside service. The wizard renders these as editable
 * rows so the operator can add/remove before submit.
 */
export const DEFAULT_CLEANING_CHECKLIST: { id: string; label: string }[] = [
  { id: "cl_hull_rinse", label: "Hull rinse" },
  { id: "cl_deck_wash", label: "Deck wash" },
  { id: "cl_brightwork", label: "Brightwork wipe-down" },
  { id: "cl_head", label: "Head sanitize" },
  { id: "cl_galley", label: "Galley wipe-down" },
  { id: "cl_bilge", label: "Bilge check" },
  { id: "cl_fenders", label: "Fenders cleaned" },
  { id: "cl_lines", label: "Lines coiled and inspected" },
];

const emmonsWorkOrders: WorkOrder[] = [
  {
    id: "wo_winter_2026",
    number: "WO-1042",
    boater_id: "b_emmons",
    vessel_id: "v_emmons_bayliner",
    slip_id: "A29",
    subject: "Winterize 1989 Bayliner",
    description: "Standard winterization package — engine, plumbing, fuel stabilizer.",
    status: "scheduled",
    priority: "normal",
    work_class: "service",
    assignee_user_id: "u_will",
    start_date: "2026-11-01",
    end_date: "2026-11-03",
    activity_type: "winterization",
    billable_minutes: 240,
    quote_id: "q_winter_2026",
  },
  {
    id: "wo_pedestal_check",
    number: "WO-1039",
    boater_id: "b_emmons",
    slip_id: "A29",
    subject: "Investigate pedestal A04 anomalous draw",
    description: "Pedestal reported 12.3 kWh in 24h, well above baseline.",
    status: "in_progress",
    priority: "high",
    work_class: "service",
    assignee_user_id: "u_jreyes",
    start_date: "2026-05-22",
    activity_type: "inspection",
    flagged: true,
  },
  {
    id: "wo_reg_renewal",
    number: "WO-1036",
    boater_id: "b_emmons",
    vessel_id: "v_emmons_bayliner",
    subject: "Follow up on expired NM registration",
    status: "open",
    priority: "normal",
    work_class: "service",
    due_date: "2026-06-15",
    activity_type: "other",
  },
];

// Other boaters' work orders (for the top-level kanban)
const otherWorkOrders: WorkOrder[] = [
  {
    id: "wo_peterson_paint",
    number: "WO-1045",
    boater_id: "b_peterson",
    vessel_id: "v_peterson_sloop",
    slip_id: "B12",
    subject: "Bottom paint — 38' sloop",
    description: "Full bottom strip + 2 coats of antifouling.",
    status: "completed",
    priority: "normal",
    work_class: "service",
    assignee_user_id: "u_will",
    start_date: "2026-05-12",
    end_date: "2026-05-19",
    activity_type: "bottom_paint",
    billable_minutes: 1920,
    quote_id: "q_peterson_paint",
    linked_ledger_entry_ids: ["le_peterson_paint_inv", "le_peterson_paint_pmt"],
  },
  {
    id: "wo_davis_haulout",
    number: "WO-1046",
    boater_id: "b_davis",
    subject: "Transient haul-out — engine inspection",
    description: "Engine alarm reported by customer.",
    status: "in_progress",
    priority: "urgent",
    work_class: "service",
    assignee_user_id: "u_jreyes",
    start_date: "2026-05-22",
    activity_type: "haul_out",
    flagged: true,
  },
  {
    id: "wo_kim_storage",
    number: "WO-1043",
    boater_id: "b_kim",
    slip_id: "C04",
    subject: "Move vessel to dry storage for season end",
    status: "scheduled",
    priority: "normal",
    work_class: "service",
    assignee_user_id: "u_peter",
    start_date: "2026-10-15",
    end_date: "2026-10-15",
    activity_type: "service",
  },
  {
    id: "wo_peterson_pump",
    number: "WO-1047",
    boater_id: "b_peterson",
    slip_id: "B12",
    subject: "Pump-out service",
    status: "open",
    priority: "low",
    work_class: "service",
    activity_type: "pump_out",
    due_date: "2026-05-26",
  },
  // Staff task — flows into Work Orders, no separate "Tasks" surface
  {
    id: "wo_task_emmons_renewal",
    number: "WO-1048",
    boater_id: "b_emmons",
    subject: "Call David re slip renewal for 2027",
    description: "Annual contract expires next March. Email already sent. Call to confirm rate increase before contract draft.",
    status: "open",
    priority: "normal",
    work_class: "service",
    assignee_user_id: "u_steven",
    activity_type: "task",
    due_date: "2026-06-15",
  },
  // Pump-out request from boater portal (note the bracketed prefix that the
  // portal request flow stamps in — same pattern as service requests)
  {
    id: "wo_emmons_pumpout",
    number: "WO-1049",
    boater_id: "b_emmons",
    slip_id: "A29",
    subject: "Pump-out — tomorrow morning",
    description: "[Requested by boater via portal]\n\nNeed a pump-out before we head out. Morning works.",
    status: "open",
    priority: "normal",
    work_class: "service",
    activity_type: "pump_out",
    due_date: "2026-05-25",
  },
  // Cleaning WO — fleet boat turnover after a club booking. Demonstrates
  // the new cleaning surface: the structured `cleaning_source_*` columns
  // power the back-reference card on /work-orders/[id] AND the cleaning
  // chip that appears on the booking's row in /bookings. Seeded against
  // a real club booking (cb_001 — b_jones on rb_pontoon_1) so the demo
  // flow renders end-to-end without manual wiring.
  {
    id: "wo_peterson_clean",
    number: "WO-1050",
    boater_id: "b_jones",
    subject: "Topside wash — Pontoon 1 turnover",
    description: "Standard fleet turnover after cb_001 wraps.",
    status: "scheduled",
    priority: "normal",
    work_class: "cleaning",
    assignee_user_id: "u_will",
    start_date: "2026-05-30",
    due_date: "2026-05-30",
    activity_type: "service",
    estimated_hours: 2.5,
    estimated_total: 220,
    checklist: DEFAULT_CLEANING_CHECKLIST.map((c) => ({ ...c })),
    cleaning_source_kind: "club_booking",
    cleaning_source_id: "cb_001",
  },
  // ──────── Recurring-cleaning test fixtures ────────
  // Two WOs with `recurring_next_date` deliberately in the past so the
  // dev "Advance recurring cleanings" button has work to do on every
  // load. The e2e suite asserts walker correctness against these
  // (one-shot children, anchor advancement, month-end clamp). They
  // also serve as the demo state for the recurring-cleaning surface.
  // ──────────────────────────────────────────────────
  {
    id: "wo_jones_weekly_clean",
    number: "WO-1052",
    boater_id: "b_jones",
    subject: "Weekly topside wash — Pontoon 1",
    description: "Recurring fleet cleaning every Monday morning.",
    status: "scheduled",
    priority: "normal",
    work_class: "cleaning",
    assignee_user_id: "u_will",
    start_date: "2026-01-01",
    due_date: "2026-01-01",
    activity_type: "service",
    estimated_hours: 2.0,
    estimated_total: 180,
    checklist: DEFAULT_CLEANING_CHECKLIST.map((c) => ({ ...c })),
    cleaning_source_kind: "club_booking",
    cleaning_source_id: "cb_005",
    is_recurring: true,
    recurring_schedule: "weekly",
    // Anchored in the past — every load lands at least one cycle due
    // so the dev Advance button has something to do.
    recurring_next_date: "2026-01-01",
  },
  {
    id: "wo_jones_monthly_deep",
    number: "WO-1053",
    boater_id: "b_jones",
    subject: "Monthly deep clean — Pontoon 1",
    description: "End-of-month detailed cleaning, anchored Jan 31.",
    status: "scheduled",
    priority: "normal",
    work_class: "cleaning",
    assignee_user_id: "u_will",
    start_date: "2026-01-31",
    due_date: "2026-01-31",
    activity_type: "service",
    estimated_hours: 4.0,
    estimated_total: 360,
    checklist: DEFAULT_CLEANING_CHECKLIST.map((c) => ({ ...c })),
    cleaning_source_kind: "club_booking",
    cleaning_source_id: "cb_005",
    is_recurring: true,
    recurring_schedule: "monthly",
    // Anchored Jan 31 — the e2e suite asserts that advancing once
    // lands the next anchor on Feb 28 (NOT Mar 3 — the JS setUTCMonth
    // day-overflow trap fixed in addUtcMonthsClamped).
    recurring_next_date: "2026-01-31",
  },
  // Haul + storage WO — yearly recurring. recurring_next_date is one
  // year out from start_date so the recurrence engine picks it up on
  // the next pass without manual seeding.
  {
    id: "wo_kim_winter_haul",
    number: "WO-1051",
    boater_id: "b_kim",
    vessel_id: "v_kim_trawler",
    subject: "Winter haul + dry storage rotation",
    description: "Annual lift, pressure wash, transport to lot 3, shrinkwrap.",
    status: "scheduled",
    priority: "normal",
    work_class: "service",
    assignee_user_id: "u_peter",
    start_date: "2026-10-20",
    end_date: "2026-10-22",
    activity_type: "haul_out",
    estimated_hours: 6,
    estimated_total: 1450,
    is_recurring: true,
    recurring_schedule: "yearly",
    recurring_next_date: "2027-10-20",
    internal_notes: "Customer always wants pulled on the second tide. Pre-stage cradle Friday.",
  },
];

// Quotes — one signed (winterization), one draft, one signed+paid (bottom paint)
const QUOTES_DATA: Quote[] = [
  // Winterization quote — DRAFT, ready to send (with signable token for demo)
  {
    id: "q_winter_2026",
    number: "Q-1042",
    work_order_id: "wo_winter_2026",
    boater_id: "b_emmons",
    status: "draft",
    signature_token: "sgn_winterize_1042",
    line_items: [
      { id: "ql1", kind: "labor", name: "Engine winterization", description: "Drain coolant, fog cylinders, fuel stabilizer", qty: 2, unit_price: 95, total: 190 },
      { id: "ql2", kind: "labor", name: "Freshwater system winterization", description: "Antifreeze through head and water heater", qty: 1, unit_price: 65, total: 65 },
      { id: "ql3", kind: "part", name: "Propylene glycol antifreeze (gallon)", qty: 3, unit_price: 12.50, total: 37.50 },
      { id: "ql4", kind: "part", name: "Fuel stabilizer", qty: 1, unit_price: 18, total: 18 },
    ],
    tax_rate: 0.0825,
    parts_subtotal: 55.50,
    labor_subtotal: 255,
    fees_subtotal: 0,
    discount_subtotal: 0,
    tax_amount: 4.58,    // tax on parts only typically
    total: 315.08,
  },
  // Bottom paint — SIGNED + PAID
  {
    id: "q_peterson_paint",
    number: "Q-1045",
    work_order_id: "wo_peterson_paint",
    boater_id: "b_peterson",
    status: "invoiced",
    line_items: [
      { id: "qp1", kind: "labor", name: "Bottom strip — 38' hull", qty: 12, unit_price: 95, total: 1140 },
      { id: "qp2", kind: "labor", name: "Bottom paint application — 2 coats", qty: 18, unit_price: 95, total: 1710 },
      { id: "qp3", kind: "part", name: "Pettit Trinidad SR antifouling (gallon)", qty: 4, unit_price: 285, total: 1140 },
      { id: "qp4", kind: "part", name: "Roller covers + tray", qty: 2, unit_price: 22, total: 44 },
      { id: "qp5", kind: "fee", name: "Haul-out & blocking", qty: 1, unit_price: 220, total: 220 },
    ],
    tax_rate: 0.0825,
    parts_subtotal: 1184,
    labor_subtotal: 2850,
    fees_subtotal: 220,
    discount_subtotal: 0,
    tax_amount: 97.68,
    total: 4351.68,
    sent_at: "2026-05-08T10:00:00Z",
    viewed_at: "2026-05-08T14:22:00Z",
    signed_at: "2026-05-10T09:15:00Z",
    signer_name: "Sarah Peterson",
    signature_token: "sgn_5f4a8c2d",
    payment_method: "charge_to_account",
    paid_at: "2026-05-19T16:30:00Z",
    linked_invoice_ledger_entry_id: "le_peterson_paint_inv",
    linked_payment_ledger_entry_id: "le_peterson_paint_pmt",
  },
];

// Add the Peterson paint invoice + payment to the ledger as cross-linked entries
const otherLedgerEntries: LedgerEntry[] = [
  {
    id: "le_peterson_paint_inv",
    boater_id: "b_peterson",
    type: "invoice",
    number: "MG5511",
    date: "2026-05-10",
    amount: 4351.68,
    open_balance: 0,
    method: null,
    status: "paid",
    linked_work_order_id: "wo_peterson_paint",
    linked_quote_id: "q_peterson_paint",
    line_items: [
      { description: "Bottom paint — labor", amount: 2850 },
      { description: "Bottom paint — parts", amount: 1184 },
      { description: "Haul-out & blocking", amount: 220 },
      { description: "Tax (8.25%)", amount: 97.68 },
    ],
  },
  {
    id: "le_peterson_paint_pmt",
    boater_id: "b_peterson",
    type: "payment",
    date: "2026-05-19",
    amount: 4351.68,
    open_balance: 0,
    method: "credit_applied",      // charge to account
    applied_to_invoice_ids: ["le_peterson_paint_inv"],
    issued_by_user_id: "u_steven",
    status: "paid",
    linked_work_order_id: "wo_peterson_paint",
    linked_quote_id: "q_peterson_paint",
  },
];

const otherCommunications: Communication[] = [
  {
    id: "cm_peterson_quote_sent",
    boater_id: "b_peterson",
    type: "email",
    direction: "outbound",
    subject: "Your bottom-paint quote is ready",
    body_preview: "Quote Q-1045 for $4,351.68 — review and sign at the link.",
    sender_label: "Sync, Service",
    sender_is_system: true,
    recipient: "speterson@example.com",
    sent_at: "2026-05-08T10:00:00Z",
    status: "opened",
    related_entity: { type: "work_order", id: "wo_peterson_paint" },
  },
  {
    id: "cm_peterson_signed",
    boater_id: "b_peterson",
    type: "email",
    direction: "outbound",
    subject: "Quote signed — invoice generated",
    body_preview: "Thanks Sarah! Invoice MG5511 has been created and will charge to your account.",
    sender_label: "Sync, Service",
    sender_is_system: true,
    recipient: "speterson@example.com",
    sent_at: "2026-05-10T09:16:00Z",
    status: "delivered",
    related_entity: { type: "work_order", id: "wo_peterson_paint" },
  },
  // ── Inbound messages — populates the unified Inbox with realistic triage candidates
  {
    id: "cm_peterson_question",
    boater_id: "b_peterson",
    type: "email",
    direction: "inbound",
    subject: "Re: bottom-paint quote",
    body_preview:
      "Hi — quick question on the quote. Does the price include the keel touch-up or is that separate? Also, when can you schedule? Looking at the last week of May.",
    sender_label: "Sarah Peterson",
    sender_is_system: false,
    recipient: "marina@marinastee.com",
    sent_at: "2026-05-22T08:42:00Z",
    status: "delivered",
    related_entity: { type: "work_order", id: "wo_peterson_paint" },
  },
  {
    id: "cm_emmons_late_pmt",
    boater_id: "b_emmons",
    type: "sms",
    direction: "inbound",
    body_preview:
      "Got the reminder — sending a check this afternoon. Should hit you by Wednesday. Thanks!",
    sender_label: "David Emmons",
    sender_is_system: false,
    recipient: "marina",
    sent_at: "2026-05-23T14:08:00Z",
    status: "delivered",
  },
  {
    id: "cm_peterson_arrival",
    boater_id: "b_peterson",
    type: "sms",
    direction: "inbound",
    body_preview: "Arriving Friday afternoon — slip A14 still confirmed?",
    sender_label: "Sarah Peterson",
    sender_is_system: false,
    recipient: "marina",
    sent_at: "2026-05-23T18:30:00Z",
    status: "delivered",
  },
  {
    id: "cm_emmons_pumpout",
    boater_id: "b_emmons",
    type: "sms",
    direction: "inbound",
    body_preview:
      "Need a pump-out before we head out tomorrow if possible — sometime in the morning works.",
    sender_label: "David Emmons",
    sender_is_system: false,
    recipient: "marina",
    sent_at: "2026-05-24T07:21:00Z",
    status: "delivered",
  },
];

// Peterson's sloop (referenced above)
const petersonSloop: Vessel = {
  id: "v_peterson_sloop",
  boater_id: "b_peterson",
  co_owner_ids: [],
  name: "Halcyon",
  year: 2014,
  make: "Catalina",
  model: "385",
  color: "white / blue",
  vessel_type: "sailboat",
  fuel_type: "diesel",
  loa_inches: 38 * 12,
  beam_inches: 12 * 12 + 11,
  draft_inches: 5 * 12 + 6,
  registration: "NM4521BG",
  photos: [
    "https://images.unsplash.com/photo-1500627964684-141351970a7f?w=400&h=300&fit=crop",
  ],
  active: true,
};

const NAMED_BOATERS: Boater[] = [
  {
    id: "b_emmons",
    display_name: "Emmons, David",
    first_name: "David",
    last_name: "Emmons",
    code: "DSM A29",
    active: true,
    billing_cadence: "monthly",
    tags: ["Annual", "Live-aboard adjacent"],
    trust_score: 92,
    last_seen_at: "2026-05-22T08:14:00Z",
    communication_prefs: {
      preferred_channel: "sms",
      language: "en",
    },
    primary_contact: {
      id: "ct_emmons_self",
      name: "David Emmons",
      role: "self",
      email: "daveemmons05@yahoo.com",
      phone: "(505) 897-1949",
      preferred_channel: "sms",
      can_be_billed: true,
    },
    additional_contacts: [
      {
        id: "ct_emmons_jennifer",
        name: "Jennifer Emmons",
        role: "spouse",
        phone: "505-610-0133",
        preferred_channel: "voice",
        can_be_billed: false,
      },
    ],
    address: {
      line1: "69 San Diego Loop",
      city: "Los Lunas",
      state: "NM",
      zip: "87031",
      country: "United States",
    },
  },
  {
    id: "b_peterson",
    display_name: "Peterson, Sarah",
    first_name: "Sarah",
    last_name: "Peterson",
    code: "DSM B12",
    active: true,
    billing_cadence: "annual",
    tags: ["Annual", "VIP"],
    trust_score: 98,
    last_seen_at: "2026-05-23T07:02:00Z",
    communication_prefs: { preferred_channel: "email", language: "en" },
    primary_contact: {
      id: "ct_peterson",
      name: "Sarah Peterson",
      role: "self",
      email: "speterson@example.com",
      phone: "(505) 555-0142",
      preferred_channel: "email",
      can_be_billed: true,
    },
    additional_contacts: [],
    address: {
      line1: "412 Lakeside Dr",
      city: "Albuquerque",
      state: "NM",
      zip: "87111",
      country: "United States",
    },
  },
  {
    id: "b_davis",
    display_name: "Davis, Mark",
    first_name: "Mark",
    last_name: "Davis",
    code: "TRN T07",
    active: true,
    billing_cadence: "transient",
    tags: ["Transient", "Returning"],
    trust_score: 78,
    last_seen_at: "2026-05-20T16:45:00Z",
    communication_prefs: { preferred_channel: "sms", language: "en" },
    primary_contact: {
      id: "ct_davis",
      name: "Mark Davis",
      role: "self",
      email: "mdavis@example.com",
      phone: "(720) 555-0193",
      preferred_channel: "sms",
      can_be_billed: true,
    },
    additional_contacts: [],
    address: {
      line1: "8821 Cherry St",
      city: "Denver",
      state: "CO",
      zip: "80220",
      country: "United States",
    },
  },
  {
    id: "b_kim",
    display_name: "Kim, Daniel",
    first_name: "Daniel",
    last_name: "Kim",
    code: "DSM C04",
    active: true,
    billing_cadence: "seasonal",
    tags: ["Seasonal"],
    trust_score: 65,
    last_seen_at: "2026-04-18T11:23:00Z",
    communication_prefs: { preferred_channel: "email", language: "en" },
    primary_contact: {
      id: "ct_kim",
      name: "Daniel Kim",
      role: "self",
      email: "dkim@example.com",
      phone: "(415) 555-0177",
      preferred_channel: "email",
      can_be_billed: true,
    },
    additional_contacts: [],
    address: {
      line1: "210 Bay St",
      city: "San Francisco",
      state: "CA",
      zip: "94133",
      country: "United States",
    },
    notes: "Past-due risk — flagged after April auto-pay decline.",
  },
];

const NAMED_VESSELS: Vessel[] = [emmonsVessel, petersonSloop];

// Cross-boater reservations: a transient arriving today, one departing today, plus upcoming
const transientReservations: Reservation[] = [
  {
    id: "r_davis_today",
    number: "R612",
    seq: "1/1",
    boater_id: "b_davis",
    vessel_id: "v_emmons_bayliner",  // mock: reuse a vessel
    slip_id: "T03",
    arrival_date: "2026-05-23",
    departure_date: "2026-05-26",
    status: "occupied",
    type: "transient",
  },
  {
    id: "r_kim_today_depart",
    number: "R608",
    seq: "1/1",
    boater_id: "b_kim",
    vessel_id: "v_emmons_bayliner",
    slip_id: "C04",
    arrival_date: "2026-05-21",
    departure_date: "2026-05-23",
    status: "occupied",
    type: "transient",
  },
  {
    id: "r_peterson_sloop",
    number: "R155-S",
    seq: "1/1",
    boater_id: "b_peterson",
    vessel_id: "v_peterson_sloop",
    slip_id: "B12",
    arrival_date: "2026-04-01",
    departure_date: "2027-03-31",
    status: "occupied",
    type: "annual",
  },
  {
    id: "r_upcoming_1",
    number: "R615",
    seq: "1/1",
    boater_id: "b_davis",
    vessel_id: "v_emmons_bayliner",
    slip_id: "T03",
    arrival_date: "2026-05-27",
    departure_date: "2026-05-30",
    status: "scheduled",
    type: "transient",
  },
  {
    id: "r_upcoming_2",
    number: "R617",
    seq: "1/1",
    boater_id: "b_kim",
    vessel_id: "v_emmons_bayliner",
    slip_id: "C04",
    arrival_date: "2026-05-25",
    departure_date: "2026-05-28",
    status: "scheduled",
    type: "transient",
  },
];

const NAMED_RESERVATIONS: Reservation[] = [...emmonsReservations, ...transientReservations];

export const LEDGER: LedgerEntry[] = [...emmonsLedger, ...otherLedgerEntries];

export const WORK_ORDERS: WorkOrder[] = [...emmonsWorkOrders, ...otherWorkOrders];

export const QUOTES: Quote[] = QUOTES_DATA;

export const COMMUNICATIONS: Communication[] = [...emmonsComms, ...otherCommunications];

// ============================================================
// Annual roster — the 90% case
//
// Real marina = ~450 yearly slip holders. We hand-roll a representative
// sample (~28) covering the property: every dock has named tenants, with
// varied tenure (2-12 years), expiry windows (some renewing this fall,
// some next year, one lapsed), rates (proportional to slip size), and
// vessel types. The same data shape as Emmons — Boater + Vessel +
// Contract + current-season Reservation.
//
// Drives: /services/roster roster, /services/contracts renewal pipeline,
// /ledger billing run, /reports annual KPIs.
// ============================================================

type AnnualHolderSpec = {
  bId: string;             // boater id, e.g. "b_jones"
  first: string;
  last: string;
  email?: string;
  phone?: string;
  slipId: string;          // matches a Slip.id (e.g. "A04")
  vesselName: string;
  vesselYear: number;
  vesselMake: string;
  vesselModel: string;
  vesselType: "powerboat" | "sailboat" | "pontoon" | "houseboat" | "pwc" | "other";
  fuelType: "gasoline" | "diesel" | "electric" | "none";
  loaFt: number;           // length overall in feet
  beamFt: number;
  rate: number;            // annual slip rate $
  yearsHeld: number;       // how many seasons they've been here
  expiryYear: number;      // contract effective_end year (2026 = expires this fall, 2027 = next)
  status?: "active" | "expired";  // default active
  cadence?: "annual" | "seasonal" | "monthly"; // default annual
  city?: string;
  state?: string;
  tags?: string[];
  notes?: string;
};

const ANNUAL_HOLDERS_SPEC: AnnualHolderSpec[] = [
  // ── Damsite A Dock (Emmons already at A29) ─────────────────────────────
  { bId: "b_jones", first: "Robert", last: "Jones", email: "rjones@example.com", phone: "(505) 555-2114", slipId: "A04", vesselName: "Sea Hawk", vesselYear: 2014, vesselMake: "Sea Ray", vesselModel: "240 Sundancer", vesselType: "powerboat", fuelType: "gasoline", loaFt: 24, beamFt: 8.5, rate: 3200, yearsHeld: 7, expiryYear: 2026, city: "Santa Fe", state: "NM" },
  { bId: "b_morales", first: "Adrian", last: "Morales", email: "adrian.m@example.com", phone: "(505) 555-3019", slipId: "A06", vesselName: "Querencia", vesselYear: 2019, vesselMake: "Bayliner", vesselModel: "VR5", vesselType: "powerboat", fuelType: "gasoline", loaFt: 22, beamFt: 8.5, rate: 3000, yearsHeld: 4, expiryYear: 2027, city: "Albuquerque", state: "NM" },
  { bId: "b_oneill", first: "Kate", last: "O'Neill", email: "kate.oneill@example.com", phone: "(505) 555-7720", slipId: "A11", vesselName: "Brigid", vesselYear: 2016, vesselMake: "Boston Whaler", vesselModel: "230 Outrage", vesselType: "powerboat", fuelType: "gasoline", loaFt: 23, beamFt: 8.5, rate: 3200, yearsHeld: 5, expiryYear: 2026, city: "Santa Fe", state: "NM", tags: ["board_member"] },
  { bId: "b_singh", first: "Anjali", last: "Singh", email: "anjali.s@example.com", phone: "(505) 555-4488", slipId: "A14", vesselName: "Reverie", vesselYear: 2020, vesselMake: "Chaparral", vesselModel: "270 OSX", vesselType: "powerboat", fuelType: "gasoline", loaFt: 27, beamFt: 9, rate: 3700, yearsHeld: 3, expiryYear: 2027, city: "Los Alamos", state: "NM" },
  { bId: "b_hess", first: "Marcus", last: "Hess", email: "marcus@hess.io", phone: "(303) 555-9821", slipId: "A17", vesselName: "Halftime", vesselYear: 2012, vesselMake: "Cobalt", vesselModel: "262", vesselType: "powerboat", fuelType: "gasoline", loaFt: 26, beamFt: 8.5, rate: 3500, yearsHeld: 9, expiryYear: 2026, city: "Denver", state: "CO", notes: "Out-of-state, mails check annually." },
  { bId: "b_lopez", first: "Carla", last: "Lopez", email: "clopez@example.com", phone: "(505) 555-1212", slipId: "A19", vesselName: "Dorado", vesselYear: 2017, vesselMake: "Bayliner", vesselModel: "215 Deck Boat", vesselType: "powerboat", fuelType: "gasoline", loaFt: 21, beamFt: 8.5, rate: 3000, yearsHeld: 6, expiryYear: 2027 },
  { bId: "b_park", first: "Daniel", last: "Park", email: "dpark@example.com", phone: "(720) 555-0099", slipId: "A22", vesselName: "Joon", vesselYear: 2018, vesselMake: "Yamaha", vesselModel: "242X", vesselType: "powerboat", fuelType: "gasoline", loaFt: 24, beamFt: 8.5, rate: 3200, yearsHeld: 5, expiryYear: 2026 },
  { bId: "b_walker", first: "Maggie", last: "Walker", email: "maggie@walker.net", phone: "(505) 555-2241", slipId: "A24", vesselName: "Margarita", vesselYear: 2011, vesselMake: "Crownline", vesselModel: "255 SS", vesselType: "powerboat", fuelType: "gasoline", loaFt: 25, beamFt: 8.5, rate: 3500, yearsHeld: 12, expiryYear: 2026, tags: ["original_holder"] },
  // ── Damsite B Dock (larger boats) ──────────────────────────────────────
  { bId: "b_franklin", first: "Tom", last: "Franklin", email: "tfranklin@example.com", phone: "(505) 555-6610", slipId: "B02", vesselName: "Storyteller", vesselYear: 2015, vesselMake: "Regal", vesselModel: "33 XO", vesselType: "powerboat", fuelType: "gasoline", loaFt: 33, beamFt: 10.5, rate: 4400, yearsHeld: 8, expiryYear: 2026 },
  { bId: "b_brown", first: "Robert", last: "Brown", email: "rb@example.com", phone: "(505) 555-3344", slipId: "B05", vesselName: "Sea Lark", vesselYear: 2013, vesselMake: "Sea Ray", vesselModel: "330 Sundancer", vesselType: "powerboat", fuelType: "gasoline", loaFt: 33, beamFt: 11, rate: 4500, yearsHeld: 10, expiryYear: 2027 },
  { bId: "b_yujin_kim", first: "Yujin", last: "Kim", email: "yujin.kim@example.com", phone: "(505) 555-7733", slipId: "B08", vesselName: "Aria", vesselYear: 2019, vesselMake: "Beneteau", vesselModel: "Oceanis 35", vesselType: "sailboat", fuelType: "diesel", loaFt: 34, beamFt: 11.5, rate: 4500, yearsHeld: 4, expiryYear: 2026 },
  { bId: "b_velasquez", first: "Mariana", last: "Velasquez", email: "mariv@example.com", phone: "(505) 555-1188", slipId: "B11", vesselName: "Sirena", vesselYear: 2017, vesselMake: "Sea Ray", vesselModel: "350 SLX", vesselType: "powerboat", fuelType: "gasoline", loaFt: 35, beamFt: 11, rate: 4700, yearsHeld: 5, expiryYear: 2026 },
  { bId: "b_carter", first: "James", last: "Carter", email: "jc@example.com", phone: "(505) 555-2245", slipId: "B14", vesselName: "Persistence", vesselYear: 2016, vesselMake: "Catalina", vesselModel: "375", vesselType: "sailboat", fuelType: "diesel", loaFt: 37, beamFt: 12, rate: 4900, yearsHeld: 6, expiryYear: 2027, tags: ["yacht_club"] },
  { bId: "b_okafor", first: "Chinedu", last: "Okafor", email: "co@example.com", phone: "(505) 555-9921", slipId: "B17", vesselName: "Ada", vesselYear: 2021, vesselMake: "Cobalt", vesselModel: "R8 Surf", vesselType: "powerboat", fuelType: "gasoline", loaFt: 28, beamFt: 9, rate: 4400, yearsHeld: 2, expiryYear: 2027 },
  // ── Damsite C Dock (smaller, value tier) ───────────────────────────────
  { bId: "b_perez", first: "Sofia", last: "Perez", email: "sperez@example.com", phone: "(505) 555-3030", slipId: "C02", vesselName: "Sol Naciente", vesselYear: 2010, vesselMake: "Tracker", vesselModel: "Pro 175", vesselType: "powerboat", fuelType: "gasoline", loaFt: 17, beamFt: 7, rate: 2400, yearsHeld: 6, expiryYear: 2026 },
  { bId: "b_collins", first: "Patrick", last: "Collins", email: "pcollins@example.com", phone: "(303) 555-4040", slipId: "C05", vesselName: "Half Past", vesselYear: 2014, vesselMake: "Sun Tracker", vesselModel: "Party Barge 22", vesselType: "pontoon", fuelType: "gasoline", loaFt: 22, beamFt: 8.5, rate: 2700, yearsHeld: 4, expiryYear: 2027, city: "Pagosa Springs", state: "CO" },
  { bId: "b_dixon", first: "Hannah", last: "Dixon", email: "hd@example.com", phone: "(505) 555-5151", slipId: "C08", vesselName: "Wren", vesselYear: 2018, vesselMake: "Sea Ray", vesselModel: "190 SPX", vesselType: "powerboat", fuelType: "gasoline", loaFt: 19, beamFt: 8, rate: 2600, yearsHeld: 4, expiryYear: 2026 },
  { bId: "b_ito", first: "Hiroshi", last: "Ito", email: "h.ito@example.com", phone: "(505) 555-6263", slipId: "C11", vesselName: "Sora", vesselYear: 2019, vesselMake: "Catalina", vesselModel: "275 Sport", vesselType: "sailboat", fuelType: "diesel", loaFt: 27, beamFt: 9, rate: 3200, yearsHeld: 3, expiryYear: 2027 },
  // ── Damsite D Dock (big slips, large boats) ────────────────────────────
  { bId: "b_alexander", first: "Vincent", last: "Alexander", email: "valexander@example.com", phone: "(505) 555-7070", slipId: "D02", vesselName: "Endurance", vesselYear: 2014, vesselMake: "Hunter", vesselModel: "41 DS", vesselType: "sailboat", fuelType: "diesel", loaFt: 41, beamFt: 13, rate: 5800, yearsHeld: 9, expiryYear: 2026, tags: ["board_member"] },
  { bId: "b_nguyen", first: "Anh", last: "Nguyen", email: "anguyen@example.com", phone: "(505) 555-8181", slipId: "D04", vesselName: "Lotus", vesselYear: 2017, vesselMake: "Sea Ray", vesselModel: "Sundancer 400", vesselType: "powerboat", fuelType: "gasoline", loaFt: 40, beamFt: 13, rate: 5600, yearsHeld: 5, expiryYear: 2026 },
  { bId: "b_meadows", first: "Lisa", last: "Meadows", email: "lmeadows@example.com", phone: "(505) 555-9292", slipId: "D06", vesselName: "Wandering Star", vesselYear: 2012, vesselMake: "Catalina", vesselModel: "445", vesselType: "sailboat", fuelType: "diesel", loaFt: 44, beamFt: 14, rate: 6200, yearsHeld: 11, expiryYear: 2027, tags: ["original_holder"] },
  { bId: "b_zhang", first: "Wei", last: "Zhang", email: "wzhang@example.com", phone: "(720) 555-1010", slipId: "D09", vesselName: "Quanlong", vesselYear: 2020, vesselMake: "Tiara", vesselModel: "39 Coupe", vesselType: "powerboat", fuelType: "diesel", loaFt: 39, beamFt: 13, rate: 5800, yearsHeld: 3, expiryYear: 2027, city: "Boulder", state: "CO" },
  // ── Damsite E Dock (small, entry tier) ─────────────────────────────────
  { bId: "b_holguin", first: "Maria", last: "Holguin", email: "mh@example.com", phone: "(505) 555-2020", slipId: "E01", vesselName: "Pequeñita", vesselYear: 2013, vesselMake: "Lund", vesselModel: "1875 Pro V", vesselType: "powerboat", fuelType: "gasoline", loaFt: 18, beamFt: 7.5, rate: 2200, yearsHeld: 5, expiryYear: 2026 },
  { bId: "b_thompson", first: "Greg", last: "Thompson", email: "gtho@example.com", phone: "(505) 555-3131", slipId: "E03", vesselName: "Bluegill II", vesselYear: 2016, vesselMake: "Yamaha", vesselModel: "WaveRunner FX", vesselType: "pwc", fuelType: "gasoline", loaFt: 11, beamFt: 4, rate: 1400, yearsHeld: 6, expiryYear: 2027 },
  { bId: "b_ramirez", first: "Eduardo", last: "Ramirez", email: "er@example.com", phone: "(505) 555-4242", slipId: "E05", vesselName: "La Flaca", vesselYear: 2011, vesselMake: "Tracker", vesselModel: "Bass Tracker 175", vesselType: "powerboat", fuelType: "gasoline", loaFt: 17, beamFt: 7, rate: 2000, yearsHeld: 8, expiryYear: 2026 },
  // ── Lapsed (drives the renewal-pipeline "Lapsed" segment) ──────────────
  { bId: "b_winters", first: "Caroline", last: "Winters", email: "cwinters@example.com", phone: "(505) 555-9999", slipId: "A27", vesselName: "Snowdrop", vesselYear: 2009, vesselMake: "Sea Ray", vesselModel: "210 Select", vesselType: "powerboat", fuelType: "gasoline", loaFt: 21, beamFt: 8, rate: 3000, yearsHeld: 4, expiryYear: 2025, status: "expired", notes: "Did not renew for 2026. Slip A27 now in waitlist queue." },
  // ── Seasonal (drives mixed-cadence demo) ───────────────────────────────
  { bId: "b_navarro", first: "Iris", last: "Navarro", email: "in@example.com", phone: "(505) 555-7878", slipId: "C07", vesselName: "Verano", vesselYear: 2015, vesselMake: "Bayliner", vesselModel: "VR4", vesselType: "powerboat", fuelType: "gasoline", loaFt: 20, beamFt: 8, rate: 1800, yearsHeld: 3, expiryYear: 2026, cadence: "seasonal", notes: "May–October only — winterizes annually." },
  { bId: "b_donovan", first: "Brendan", last: "Donovan", email: "bdonovan@example.com", phone: "(720) 555-1414", slipId: "C13", vesselName: "Kestrel", vesselYear: 2018, vesselMake: "Catalina", vesselModel: "275 Sport", vesselType: "sailboat", fuelType: "diesel", loaFt: 27, beamFt: 9, rate: 1900, yearsHeld: 2, expiryYear: 2026, cadence: "seasonal", city: "Aurora", state: "CO" },
];

function buildAnnualHolder(s: AnnualHolderSpec): {
  boater: Boater;
  vessel: Vessel;
  contract: Contract;
  reservation: Reservation;
  prevReservations: Reservation[];
} {
  const cadence = s.cadence ?? "annual";
  const displayName = `${s.last}, ${s.first}`;
  const status = s.status ?? "active";
  const effectiveStart =
    cadence === "seasonal"
      ? `${s.expiryYear}-05-15`
      : `${s.expiryYear - 1}-${status === "expired" ? "04-01" : "04-01"}`;
  const effectiveEnd =
    cadence === "seasonal" ? `${s.expiryYear}-10-15` : `${s.expiryYear}-03-31`;

  const boater: Boater = {
    id: s.bId,
    display_name: displayName,
    first_name: s.first,
    last_name: s.last,
    code: `${s.slipId}`,
    active: status === "active",
    billing_cadence: cadence,
    tags: s.tags ?? [],
    communication_prefs: { preferred_channel: "email", language: "en" },
    primary_contact: {
      id: `ct_${s.bId}_primary`,
      name: displayName,
      role: "self",
      email: s.email,
      phone: s.phone,
      preferred_channel: "email",
      can_be_billed: true,
    },
    additional_contacts: [],
    address: {
      line1: "—",
      city: s.city ?? "Santa Fe",
      state: s.state ?? "NM",
      zip: "87501",
      country: "US",
    },
    notes: s.notes,
  };

  const vessel: Vessel = {
    id: `v_${s.bId.replace("b_", "")}`,
    boater_id: s.bId,
    co_owner_ids: [],
    name: s.vesselName,
    year: s.vesselYear,
    make: s.vesselMake,
    model: s.vesselModel,
    vessel_type: s.vesselType,
    fuel_type: s.fuelType,
    loa_inches: Math.round(s.loaFt * 12),
    beam_inches: Math.round(s.beamFt * 12),
    active: true,
  };

  const contractNumber = `C-${1100 + Math.abs(hash(s.bId) % 900)}`;
  const contract: Contract = {
    id: `c_${s.bId.replace("b_", "")}_${s.expiryYear}`,
    number: contractNumber,
    boater_id: s.bId,
    template_id: cadence === "seasonal" ? "tpl_seasonal_slip" : "tpl_annual_slip",
    template_version: cadence === "seasonal" ? 2 : 3,
    vessel_id: vessel.id,
    slip_id: s.slipId,
    status:
      status === "expired"
        ? "expired"
        : "active",
    effective_start: effectiveStart,
    effective_end: effectiveEnd,
    signed_at: status === "active" ? `${s.expiryYear - 1}-03-15` : `${s.expiryYear - 1}-03-15`,
    annual_rate: s.rate,
    billing_cadence: cadence === "seasonal" ? "seasonal" : "monthly",
  };

  // Current-season reservation (or last-season for lapsed)
  const resYear = status === "expired" ? s.expiryYear : s.expiryYear;
  const reservation: Reservation = {
    id: `r_${s.bId}_${resYear}`,
    number: `R${600 + Math.abs(hash(s.bId) % 400)}`,
    seq: "1/1",
    boater_id: s.bId,
    vessel_id: vessel.id,
    slip_id: s.slipId,
    contract_id: contract.id,
    arrival_date: cadence === "seasonal" ? `${resYear}-05-15` : `${resYear - 1}-04-01`,
    departure_date:
      cadence === "seasonal" ? `${resYear}-10-15` : `${resYear}-03-31`,
    status: status === "expired" ? "completed" : "occupied",
    type: cadence === "seasonal" ? "seasonal" : "annual",
  };

  // Multi-year history (lightweight — just shows tenure on detail pages)
  const prevReservations: Reservation[] = [];
  for (let y = 1; y < Math.min(s.yearsHeld, 4); y += 1) {
    const yr = s.expiryYear - y;
    prevReservations.push({
      id: `r_${s.bId}_${yr - 1}`,
      number: `R${300 + Math.abs(hash(s.bId + String(y)) % 400)}`,
      seq: "1/1",
      boater_id: s.bId,
      vessel_id: vessel.id,
      slip_id: s.slipId,
      contract_id: contract.id,
      arrival_date: `${yr - 1}-04-01`,
      departure_date: `${yr}-03-31`,
      status: "completed",
      type: cadence === "seasonal" ? "seasonal" : "annual",
    });
  }

  return { boater, vessel, contract, reservation, prevReservations };
}

// Simple deterministic hash for stable ids/numbers across reloads
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const ANNUAL_HOLDERS = ANNUAL_HOLDERS_SPEC.map(buildAnnualHolder);
const ANNUAL_BOATERS = ANNUAL_HOLDERS.map((h) => h.boater);
const ANNUAL_VESSELS = ANNUAL_HOLDERS.map((h) => h.vessel);
const ANNUAL_CONTRACTS = ANNUAL_HOLDERS.map((h) => h.contract);
const ANNUAL_RESERVATIONS = ANNUAL_HOLDERS.flatMap((h) => [h.reservation, ...h.prevReservations]);

// Belt-and-suspenders: dedupe by id so a stray descriptor collision never
// crashes the UI with "two children with the same key". Earlier entries win
// (NAMED_BOATERS are hand-written and take priority over annual seeds).
function dedupeById<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

// Portal token attached to every boater. In production this is a long-
// random opaque value the marina sends once via SMS/email; here we
// derive it deterministically from the boater id so dev links are
// stable across reloads.
function attachPortalToken(b: Boater): Boater {
  return { ...b, portal_token: b.portal_token || `tok_h_${b.id.replace(/^b_/, "")}_2026a` };
}

// Hand-seeded boaters for the second tenant (Lakeside Marina) so the
// tenant switcher demos actual data isolation rather than "same data,
// different label". Three is enough to populate the list + show the
// agent surface working per-tenant.
const LAKESIDE_BOATERS: Boater[] = [
  {
    id: "b_li_anderson",
    tenant_id: SECOND_TENANT_ID,
    display_name: "Anderson, Mark",
    first_name: "Mark",
    last_name: "Anderson",
    code: "LSI A1",
    active: true,
    billing_cadence: "annual",
    tags: ["new_member"],
    trust_score: 88,
    last_seen_at: "2026-05-27T16:00:00Z",
    communication_prefs: { preferred_channel: "email", language: "en" },
    primary_contact: {
      id: "c_li_anderson_self",
      name: "Mark Anderson",
      role: "self",
      email: "manderson@example.com",
      phone: "(208) 555-0123",
      preferred_channel: "email",
      can_be_billed: true,
    },
    additional_contacts: [],
    address: {
      line1: "12 Pinegrove Ln",
      city: "Coeur d'Alene",
      state: "ID",
      zip: "83814",
      country: "USA",
    },
  },
  {
    id: "b_li_chen",
    tenant_id: SECOND_TENANT_ID,
    display_name: "Chen, Linda",
    first_name: "Linda",
    last_name: "Chen",
    code: "LSI A2",
    active: true,
    billing_cadence: "seasonal",
    tags: [],
    trust_score: 95,
    last_seen_at: "2026-05-28T10:30:00Z",
    communication_prefs: { preferred_channel: "sms", language: "en" },
    primary_contact: {
      id: "c_li_chen_self",
      name: "Linda Chen",
      role: "self",
      email: "lchen@example.com",
      phone: "(208) 555-0144",
      preferred_channel: "sms",
      can_be_billed: true,
    },
    additional_contacts: [],
    address: {
      line1: "44 Lakeshore Rd",
      city: "Coeur d'Alene",
      state: "ID",
      zip: "83814",
      country: "USA",
    },
  },
  {
    id: "b_li_torres",
    tenant_id: SECOND_TENANT_ID,
    display_name: "Torres, Diego",
    first_name: "Diego",
    last_name: "Torres",
    code: "LSI A3",
    active: true,
    billing_cadence: "monthly",
    tags: ["board_member"],
    trust_score: 92,
    last_seen_at: "2026-05-29T09:15:00Z",
    communication_prefs: { preferred_channel: "email", language: "es" },
    primary_contact: {
      id: "c_li_torres_self",
      name: "Diego Torres",
      role: "self",
      email: "dtorres@example.com",
      phone: "(208) 555-0167",
      preferred_channel: "email",
      can_be_billed: true,
    },
    additional_contacts: [],
    address: {
      line1: "8 North Cove",
      city: "Coeur d'Alene",
      state: "ID",
      zip: "83814",
      country: "USA",
    },
  },
];

// Legacy boater seeds default to the primary tenant. attachTenantId
// runs after dedupe so it covers both NAMED + ANNUAL paths in one
// pass. Lakeside boaters carry their own tenant_id already.
function attachTenantId(b: Boater): Boater {
  return b.tenant_id ? b : { ...b, tenant_id: SEED_TENANT_ID };
}

export const BOATERS: Boater[] = dedupeById([
  ...NAMED_BOATERS,
  ...ANNUAL_BOATERS,
  ...LAKESIDE_BOATERS,
])
  .map(attachTenantId)
  .map(attachPortalToken);
export const VESSELS: Vessel[] = dedupeById([...NAMED_VESSELS, ...ANNUAL_VESSELS]);
export const RESERVATIONS: Reservation[] = dedupeById([...NAMED_RESERVATIONS, ...ANNUAL_RESERVATIONS]);

export const CONTRACTS: Contract[] = [emmonsContract, ...ANNUAL_CONTRACTS];

export const CARDS_ON_FILE: Record<string, CardOnFile[]> = {
  b_emmons: emmonsCards,
};

// Insurance certificates. One active (Emmons), one expiring soon (Peterson),
// one lapsed (an older Emmons vessel — drives a danger alert).
export const INSURANCE_CERTIFICATES: InsuranceCertificate[] = [
  {
    id: "coi_emmons_2026",
    vessel_id: "v_emmons_bayliner",
    boater_id: "b_emmons",
    carrier: "BoatU.S. Insurance",
    policy_number: "BU-447821",
    liability_limit: 500_000,
    hull_value: 28_000,
    effective_start: "2026-01-15",
    effective_end: "2027-01-15",
    pdf_url: "/mock/coi-emmons-2026.pdf",
    uploaded_at: "2026-01-10T15:22:00Z",
    uploaded_by: "boater",
  },
  {
    id: "coi_peterson_2025",
    vessel_id: "v_peterson_sloop",
    boater_id: "b_peterson",
    carrier: "Geico Marine",
    policy_number: "GM-991103",
    liability_limit: 1_000_000,
    hull_value: 145_000,
    effective_start: "2025-06-12",
    // ~3 weeks out from "today" (2026-05-24) — should fire a warn alert
    effective_end: "2026-06-12",
    pdf_url: "/mock/coi-peterson-2025.pdf",
    uploaded_at: "2025-06-09T11:14:00Z",
    uploaded_by: "boater",
  },
  {
    id: "coi_emmons_lapsed",
    vessel_id: "v_emmons_bayliner",
    boater_id: "b_emmons",
    carrier: "Progressive Marine",
    policy_number: "PG-558112",
    liability_limit: 300_000,
    effective_start: "2024-02-01",
    // Lapsed — should fire a danger alert
    effective_end: "2025-02-01",
    pdf_url: "/mock/coi-emmons-old.pdf",
    uploaded_at: "2024-01-29T09:00:00Z",
    uploaded_by: "marina",
  },
  // ── COI auto-renewal cliff fixtures ──────────────────────────────
  // Three live policies sitting in the 90/60/30-day expiring windows
  // so the operator dashboard's "Expiring soon" surface renders one
  // row per cliff with no fiddling on a fresh DB. Dates are relative
  // to the seeded "today" of 2026-06-04:
  //   75d  → 2026-08-18 (expiring_90 bucket)
  //   45d  → 2026-07-19 (expiring_60 bucket)
  //   15d  → 2026-06-19 (expiring_30 bucket)
  {
    id: "coi_jones_expiring_90",
    vessel_id: "v_jones",
    boater_id: "b_jones",
    carrier: "BoatU.S. Insurance",
    policy_number: "BU-771203",
    liability_limit: 500_000,
    hull_value: 32_000,
    effective_start: "2025-08-18",
    effective_end: "2026-08-18",
    pdf_url: "/mock/coi-jones-2025.pdf",
    uploaded_at: "2025-08-12T14:10:00Z",
    uploaded_by: "boater",
  },
  {
    id: "coi_morales_expiring_60",
    vessel_id: "v_morales",
    boater_id: "b_morales",
    carrier: "Geico Marine",
    policy_number: "GM-665012",
    liability_limit: 750_000,
    hull_value: 41_000,
    effective_start: "2025-07-19",
    effective_end: "2026-07-19",
    pdf_url: "/mock/coi-morales-2025.pdf",
    uploaded_at: "2025-07-14T09:42:00Z",
    uploaded_by: "boater",
  },
  {
    id: "coi_oneill_expiring_30",
    vessel_id: "v_oneill",
    boater_id: "b_oneill",
    carrier: "Progressive Marine",
    policy_number: "PG-880914",
    liability_limit: 1_000_000,
    hull_value: 38_500,
    effective_start: "2025-06-19",
    effective_end: "2026-06-19",
    pdf_url: "/mock/coi-oneill-2025.pdf",
    uploaded_at: "2025-06-15T11:00:00Z",
    uploaded_by: "boater",
  },
];

// Marina-hosted events. Rendered as a layer on the existing /reservations
// Calendar (different color from reservations). Not slip bookings — these
// are marina-wide things like raft-ups and tournaments.
const BASE_MARINA_EVENTS: MarinaEvent[] = [
  {
    id: "ev_memorial_raftup",
    title: "Memorial Day raft-up",
    description: "Annual all-marina raft-up in the channel. BYO grill. Live music starts 3pm.",
    event_type: "social",
    start_date: "2026-05-25",
    end_date: "2026-05-25",
    start_time: "14:00",
    end_time: "21:00",
    location: "Channel — south of A Dock",
    capacity: 40,
    rsvp_boater_ids: ["b_emmons", "b_peterson"],
    public_to_boaters: true,
    created_at: "2026-04-01T10:00:00Z",
  },
  {
    id: "ev_jr_fishing",
    title: "Junior fishing tournament",
    description: "Kids 12 and under. Free entry, prizes for biggest catch in 3 categories. Registration at the harbormaster shed 7am.",
    event_type: "tournament",
    start_date: "2026-06-13",
    end_date: "2026-06-13",
    start_time: "07:00",
    end_time: "13:00",
    location: "Fuel dock + community pavilion",
    capacity: 30,
    rsvp_boater_ids: ["b_peterson"],
    public_to_boaters: true,
    created_at: "2026-04-15T14:00:00Z",
  },
  {
    id: "ev_fireworks",
    title: "Independence Day fireworks viewing",
    description: "Best seats are at our channel mouth. Marina opens the seawall to the public from 8pm. Slip holders raft up at the pavilion.",
    event_type: "fireworks",
    start_date: "2026-07-04",
    end_date: "2026-07-04",
    start_time: "20:00",
    end_time: "23:00",
    location: "Pavilion + channel",
    rsvp_boater_ids: [],
    public_to_boaters: true,
    created_at: "2026-04-20T09:00:00Z",
  },
  {
    id: "ev_dredging",
    title: "Channel dredging — partial closure",
    description: "Contractor working in main channel 8am-4pm. North entrance only. Notify your guests.",
    event_type: "maintenance",
    start_date: "2026-06-02",
    end_date: "2026-06-04",
    location: "Main channel",
    rsvp_boater_ids: [],
    public_to_boaters: true,
    created_at: "2026-05-10T11:00:00Z",
  },
  {
    id: "ev_season_close",
    title: "End-of-season party",
    description: "Pavilion. Catered dinner, slideshow of the season, awards for biggest fish + best wake.",
    event_type: "social",
    start_date: "2026-10-04",
    end_date: "2026-10-04",
    start_time: "17:00",
    end_time: "22:00",
    location: "Pavilion",
    capacity: 80,
    rsvp_boater_ids: ["b_emmons"],
    public_to_boaters: true,
    created_at: "2026-05-01T12:00:00Z",
  },
];

export const MARINA_EVENTS: MarinaEvent[] = withTenantId(BASE_MARINA_EVENTS);

// Internal staff notes — STAFF ONLY, never surfaced to the boater.
export const STAFF_NOTES: StaffNote[] = [
  {
    id: "sn_emmons_pin",
    boater_id: "b_emmons",
    body: "Long-standing customer (8 years). Always pays on time after a reminder text. Prefers a heads-up text vs email.",
    author_user_id: "u_steven",
    created_at: "2026-02-14T10:00:00Z",
    pinned: true,
  },
  {
    id: "sn_emmons_pumpout",
    boater_id: "b_emmons",
    body: "Spoke at dock about the pump-out anomaly. He's fine waiting until a service window — not a billing issue.",
    author_user_id: "u_tiffany",
    created_at: "2026-05-15T14:22:00Z",
    pinned: false,
  },
  {
    id: "sn_peterson_pin",
    boater_id: "b_peterson",
    body: "Insurance lapses at end of season — must reissue COI before winter haul-out.",
    author_user_id: "u_tiffany",
    created_at: "2026-04-22T09:30:00Z",
    pinned: true,
  },
  {
    id: "sn_peterson_referral",
    boater_id: "b_peterson",
    body: "Referred by the Chen family. Worth a thank-you email when their contract renews.",
    author_user_id: "u_steven",
    created_at: "2026-03-08T16:00:00Z",
    pinned: false,
  },
];

// Waitlist — a mix of existing boaters wanting longer terms and prospects
// (no boater record yet) asking to get on the books.
const BASE_WAITLIST: WaitlistEntry[] = [
  {
    id: "wl_emmons_winter",
    boater_id: "b_emmons",
    preferred_arrival: "2026-11-01",
    preferred_departure: "2027-03-31",
    loa_inches: 28 * 12,
    beam_inches: 9 * 12,
    preferred_dock: "Damsite A Dock",
    reservation_type: "seasonal",
    notes: "Wants to keep A29 over winter storage if rates work.",
    status: "pending",
    created_at: "2026-05-12T10:14:00Z",
  },
  {
    id: "wl_chen_prospect",
    guest_name: "Chen, Marcus",
    guest_email: "mchen@example.com",
    guest_phone: "(312) 555-0188",
    preferred_arrival: "2026-06-15",
    preferred_departure: "2026-09-30",
    loa_inches: 36 * 12,
    beam_inches: 12 * 12,
    preferred_dock: "Marina Del Sur",
    reservation_type: "monthly",
    notes: "36' Grady-White. Coming from Chicago. References on request.",
    status: "pending",
    created_at: "2026-05-18T08:42:00Z",
  },
  {
    id: "wl_brennan_offered",
    guest_name: "Brennan, Patricia",
    guest_email: "pat.brennan@example.com",
    guest_phone: "(415) 555-2244",
    preferred_arrival: "2026-05-27",
    preferred_departure: "2026-05-30",
    loa_inches: 22 * 12,
    reservation_type: "transient",
    status: "offered",
    offered_slip_id: "A12",
    offered_at: "2026-05-24T09:00:00Z",
    notes: "Weekend run. Auto-replied with offer this morning — waiting on confirm.",
    created_at: "2026-05-20T14:31:00Z",
  },
  {
    id: "wl_dilbert_winter",
    guest_name: "Dilbert, Ron",
    guest_email: "rdilbert@example.com",
    preferred_arrival: "2026-10-01",
    preferred_departure: "2027-04-30",
    loa_inches: 42 * 12,
    reservation_type: "seasonal",
    preferred_dock: "Damsite A Dock",
    notes: "Looking for covered slip. Will pay seasonal premium.",
    status: "pending",
    created_at: "2026-04-30T11:22:00Z",
  },
  {
    id: "wl_holt_converted",
    guest_name: "Holt, Greg",
    preferred_arrival: "2026-05-10",
    preferred_departure: "2026-05-12",
    loa_inches: 24 * 12,
    reservation_type: "transient",
    status: "converted",
    offered_slip_id: "A24",
    offered_at: "2026-05-08T10:00:00Z",
    converted_reservation_id: "r_holt_513",
    notes: "Weekend visitor — booked A24.",
    created_at: "2026-05-06T13:00:00Z",
  },
  // ── Auto-offer cascade fixtures — one of each lifecycle state so
  // /services/roster's Waitlist section + Active Offers panel both
  // render data on first paint. Tokens are stable strings so the
  // /apply/waitlist/[token] preview URLs survive a hot reload.
  {
    id: "wl_morrow_offer_pending",
    guest_name: "Morrow, Casey",
    guest_email: "cmorrow@example.com",
    guest_phone: "(415) 555-0901",
    preferred_arrival: "2026-06-15",
    preferred_departure: "2026-09-30",
    loa_inches: 30 * 12,
    reservation_type: "seasonal",
    preferred_dock: "Damsite A Dock",
    notes: "Auto-offer fired — 48h window open.",
    status: "offered",
    offered_slip_id: "A14",
    offered_at: "2026-06-03T15:00:00Z",
    offer_expires_at: "2026-06-05T15:00:00Z",
    offer_token: "wlo_morrow_demo_pending",
    offer_status: "pending",
    offer_batch_id: "wlb_a14_jun03",
    created_at: "2026-04-22T09:30:00Z",
  },
  {
    id: "wl_okafor_offer_accepted",
    boater_id: "b_okafor",
    preferred_arrival: "2026-06-01",
    preferred_departure: "2027-05-31",
    loa_inches: 32 * 12,
    reservation_type: "annual",
    notes: "Accepted auto-offer — contract drafted.",
    status: "converted",
    offered_slip_id: "B07",
    offered_at: "2026-05-30T11:00:00Z",
    offer_expires_at: "2026-06-01T11:00:00Z",
    offer_token: "wlo_okafor_demo_accepted",
    offer_status: "accepted",
    offer_responded_at: "2026-05-30T14:42:00Z",
    converted_contract_id: "ct_okafor_b07",
    created_at: "2026-03-11T16:18:00Z",
  },
  {
    id: "wl_pratt_offer_declined",
    guest_name: "Pratt, Joel",
    guest_email: "jpratt@example.com",
    preferred_arrival: "2026-07-04",
    preferred_departure: "2026-07-08",
    loa_inches: 26 * 12,
    reservation_type: "transient",
    notes: "Declined auto-offer — stayed on waitlist for a covered slip.",
    status: "pending",
    offered_slip_id: "A12",
    offered_at: "2026-05-28T08:30:00Z",
    offer_expires_at: "2026-05-30T08:30:00Z",
    offer_token: "wlo_pratt_demo_declined",
    offer_status: "declined",
    offer_responded_at: "2026-05-28T10:12:00Z",
    created_at: "2026-05-01T11:00:00Z",
  },
  {
    id: "wl_renfrew_offer_expired",
    guest_name: "Renfrew, Sam",
    guest_email: "sam.renfrew@example.com",
    preferred_arrival: "2026-08-01",
    preferred_departure: "2026-08-15",
    loa_inches: 38 * 12,
    reservation_type: "monthly",
    notes: "Offer expired — no response in 48h. Auto-advanced to next.",
    status: "pending",
    offered_slip_id: "C03",
    offered_at: "2026-05-15T09:00:00Z",
    offer_expires_at: "2026-05-17T09:00:00Z",
    offer_token: "wlo_renfrew_demo_expired",
    offer_status: "expired",
    created_at: "2026-04-14T13:45:00Z",
  },
];

// ────────────────────────────────────────────────────────────
// Bulk waitlist fixture generator — Steven flagged that real
// marinas have 500+ on the waitlist; without a meaningful spread
// the Queue / Stale / Archive tabs all look identical at demo
// time. This generator deterministically emits ~60 additional
// entries across the full lifecycle so the operator UX is
// stress-tested against realistic scale.
// ────────────────────────────────────────────────────────────
function generateWaitlistFixtures(): WaitlistEntry[] {
  // Mix of last names that read like a real PNW marina queue.
  const lasts = [
    "Hayes", "Tran", "Cole", "Schroeder", "Park", "Bauer", "Larsson",
    "Holloway", "Vega", "Pham", "McKinney", "Ortega", "Bennett",
    "Wahlberg", "Sandoval", "Reilly", "Doan", "Whitman", "Friedman",
    "Knox", "Caputo", "Brennan", "Sato", "Carrillo", "Becker", "Yates",
    "Mendez", "Crawford", "Hendricks", "Sundgren", "Yoshida", "Burns",
    "Acosta", "Pruitt", "McGee", "Stein", "Kingsley", "Vaughn",
    "Donnelly", "Boyer", "Harrington", "Estrada", "Pollock", "Rios",
    "Espinoza", "Lozano", "Galvan", "Quinn", "Mahoney", "Greer",
    "Trujillo", "Wagner", "Foley", "Patel", "Garrison", "Strong",
    "Reece", "Solis", "Calhoun", "Truman",
  ];
  const firsts = [
    "Alex", "Sam", "Casey", "Riley", "Morgan", "Taylor", "Jordan",
    "Jamie", "Quinn", "Cameron", "Avery", "Drew", "Skylar", "Reese",
    "Rowan", "Logan", "Devon", "Bryce", "Hayden", "Toby", "Kai",
    "Theo", "Eli", "Wyatt", "Mason", "Lucas", "Ezra", "Owen", "Beau",
    "Finn", "Noah", "Levi", "Ada", "Iris", "Maya", "June", "Cleo",
    "Nora", "Hazel", "Rosa", "Tess", "Lila", "Mira", "Wren", "Sage",
  ];
  // Length bands favor mid-size — the realistic distribution at a
  // 800-slip marina has plenty of 26-42' boats with a long tail of
  // smaller transient + larger seasonal.
  const lengths = [
    22, 22, 24, 24, 25, 26, 26, 28, 28, 30, 30, 32, 32, 34, 34,
    36, 36, 38, 38, 40, 40, 42, 42, 44, 46, 48, 50,
  ];
  const cadences: WaitlistEntry["reservation_type"][] = [
    "annual", "annual", "annual", "seasonal", "seasonal",
    "monthly", "monthly", "transient",
  ];
  const docks = [
    "Damsite A Dock", "Damsite B Dock", "Damsite C Dock",
    "Marina Del Sur", "Transient Dock",
  ];

  const out: WaitlistEntry[] = [];

  // Deterministic-but-spread date helper. The seed's "now" anchor
  // is 2026-06-07; entries go back up to 30 months. Older entries
  // bias toward stale / archive.
  const NOW_MS = new Date("2026-06-07T12:00:00Z").getTime();
  const DAY = 86_400_000;

  for (let i = 0; i < 60; i++) {
    const last = lasts[i % lasts.length];
    const first = firsts[(i * 7) % firsts.length];
    const len = lengths[(i * 11) % lengths.length];
    const cad = cadences[(i * 13) % cadences.length];
    const dock = docks[(i * 17) % docks.length];

    // Joined date spread: ~0-900 days ago, with bias toward older
    // for stale-realism.
    const daysAgo = ((i * 37) % 900) + 1;
    const joinedAt = new Date(NOW_MS - daysAgo * DAY).toISOString();

    // Most entries (~70%) have been contacted at least once. A few
    // chronically stale entries have last_contact_at null entirely.
    const everContacted = (i * 3) % 10 < 7;
    let lastContactAt: string | undefined;
    if (everContacted) {
      // last contact is between 5 and (daysAgo - 5) days ago, capped
      // to keep at least some recent.
      const since = Math.min(daysAgo - 5, ((i * 19) % 365) + 5);
      lastContactAt = new Date(NOW_MS - since * DAY).toISOString();
    }

    // Decline count distribution: most 0, some 1, a few 2-4.
    const dc = ((i * 5) % 100) < 60 ? 0
      : ((i * 5) % 100) < 85 ? 1
      : ((i * 5) % 100) < 95 ? 2
      : ((i * 5) % 100) < 98 ? 3 : 4;

    // Status distribution: most pending; some converted (got a
    // slip); some withdrawn; some non-responders (archived).
    const statusRoll = (i * 23) % 100;
    let status: WaitlistEntry["status"];
    let archived_at: string | undefined;
    let archive_reason: WaitlistEntry["archive_reason"];
    if (statusRoll < 70) {
      status = "pending";
    } else if (statusRoll < 80) {
      status = "converted";
      archived_at = new Date(NOW_MS - Math.floor(daysAgo / 2) * DAY).toISOString();
      archive_reason = "got_slip";
    } else if (statusRoll < 88) {
      status = "withdrawn";
      archived_at = new Date(NOW_MS - Math.floor(daysAgo / 3) * DAY).toISOString();
      archive_reason = "withdrew";
    } else if (statusRoll < 95) {
      // Aged out — never responded
      status = "withdrawn";
      archived_at = new Date(NOW_MS - Math.floor(daysAgo / 4) * DAY).toISOString();
      archive_reason = "non_responder";
    } else {
      // Too many declines
      status = "withdrawn";
      archived_at = new Date(NOW_MS - 30 * DAY).toISOString();
      archive_reason = "too_many_declines";
    }

    // Tag distribution
    const tags: string[] = [];
    if (i % 11 === 0) tags.push("covered-priority");
    if (i % 17 === 0) tags.push("references-checked");
    if (i % 23 === 0) tags.push("vip");
    if (dc >= 2) tags.push(`${dc}-declines`);

    out.push({
      id: `wl_gen_${i.toString().padStart(3, "0")}`,
      guest_name: `${last}, ${first}`,
      guest_email: `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "") + "@example.com",
      guest_phone: `(${200 + (i * 3) % 700}) 555-${(1000 + i * 13).toString().slice(-4)}`,
      loa_inches: len * 12,
      beam_inches: Math.floor(len / 3) * 12,
      preferred_dock: dock,
      reservation_type: cad,
      notes: `${len}' ${cad === "transient" ? "transient" : cad} applicant.`,
      status,
      created_at: joinedAt,
      last_contact_at: lastContactAt,
      decline_count: dc,
      archived_at,
      archive_reason,
      tags: tags.length ? tags : undefined,
    });
  }
  return out;
}

export const WAITLIST: WaitlistEntry[] = withTenantId([
  ...BASE_WAITLIST,
  ...generateWaitlistFixtures(),
]);

// ============================================================
// Boat Rentals — fleet + sample bookings
// ============================================================

// Date helpers — anchor on "now" so the seeded fleet/bookings
// always look fresh relative to whenever the demo is run.
const _now = new Date();
function isoOffsetHours(h: number) {
  return new Date(_now.getTime() + h * 3_600_000).toISOString();
}
function isoOffsetDays(d: number) {
  return new Date(_now.getTime() + d * 86_400_000).toISOString();
}

// Primary tenant fleet. tenant_id stamped at export time.
const BASE_RENTAL_BOATS: RentalBoat[] = [
  {
    id: "rb_pontoon_1",
    name: "Pontoon 1 — Sunseeker",
    type: "pontoon",
    capacity: 10,
    hourly_rate: 95,
    half_day_rate: 325,
    full_day_rate: 525,
    deposit_amount: 500,
    attached_fee_ids: [
      "fee_rental_hourly_pontoon",
      "fee_rental_halfday_pontoon",
      "fee_rental_fullday_pontoon",
      "fee_rental_deposit_standard",
    ],
    fuel_capacity_gal: 30,
    current_fuel_pct: 92,
    hour_meter_reading: 487,
    home_dock: "Dock C — Slip C12",
    status: "rented",
    notes: "2024 Sun Tracker Party Barge, 90hp Mercury. Bimini top.",
    active: true,
    available_for_club: true,
    created_at: "2026-04-01T08:00:00Z",
    updated_at: isoOffsetDays(-1),
  },
  {
    id: "rb_pontoon_2",
    name: "Pontoon 2 — Lakeside",
    type: "pontoon",
    capacity: 10,
    hourly_rate: 95,
    half_day_rate: 325,
    full_day_rate: 525,
    deposit_amount: 500,
    attached_fee_ids: [
      "fee_rental_hourly_pontoon",
      "fee_rental_halfday_pontoon",
      "fee_rental_fullday_pontoon",
      "fee_rental_deposit_standard",
    ],
    fuel_capacity_gal: 30,
    current_fuel_pct: 78,
    hour_meter_reading: 392,
    home_dock: "Dock C — Slip C13",
    status: "available",
    active: true,
    available_for_club: true,
    created_at: "2026-04-01T08:00:00Z",
    updated_at: isoOffsetDays(-3),
  },
  {
    id: "rb_skiff_1",
    name: "Skiff 14 — Lund Fury",
    type: "fishing_skiff",
    capacity: 4,
    hourly_rate: 65,
    half_day_rate: 220,
    full_day_rate: 365,
    deposit_amount: 300,
    attached_fee_ids: [
      "fee_rental_skiff_hourly",
      "fee_rental_skiff_halfday",
      "fee_rental_skiff_fullday",
      "fee_rental_deposit_skiff",
    ],
    fuel_capacity_gal: 12,
    current_fuel_pct: 85,
    hour_meter_reading: 612,
    home_dock: "Dock C — Slip C18",
    status: "available",
    notes: "Includes 4 rod holders + fishfinder.",
    active: true,
    available_for_club: true,
    created_at: "2026-04-01T08:00:00Z",
    updated_at: isoOffsetDays(-7),
  },
  {
    id: "rb_jetski_1",
    name: "Jet Ski A — Yamaha VX",
    type: "jet_ski",
    capacity: 3,
    hourly_rate: 125,
    half_day_rate: 400,
    deposit_amount: 750,
    attached_fee_ids: [
      "fee_rental_jetski_hourly",
      "fee_rental_jetski_halfday",
      "fee_rental_deposit_jetski",
    ],
    fuel_capacity_gal: 18,
    current_fuel_pct: 100,
    hour_meter_reading: 218,
    home_dock: "PWC Float — North end",
    status: "available",
    active: true,
    created_at: "2026-04-01T08:00:00Z",
    updated_at: isoOffsetDays(-5),
  },
  {
    id: "rb_jetski_2",
    name: "Jet Ski B — Yamaha VX",
    type: "jet_ski",
    capacity: 3,
    hourly_rate: 125,
    half_day_rate: 400,
    deposit_amount: 750,
    attached_fee_ids: [
      "fee_rental_jetski_hourly",
      "fee_rental_jetski_halfday",
      "fee_rental_deposit_jetski",
    ],
    fuel_capacity_gal: 18,
    current_fuel_pct: 22,
    hour_meter_reading: 241,
    home_dock: "PWC Float — North end",
    status: "maintenance",
    notes: "Impeller scheduled — Tuesday.",
    active: true,
    created_at: "2026-04-01T08:00:00Z",
    updated_at: isoOffsetDays(-2),
  },
  {
    id: "rb_kayak_yellow",
    name: "Yellow Kayak (single)",
    type: "kayak",
    capacity: 1,
    hourly_rate: 25,
    full_day_rate: 65,
    deposit_amount: 50,
    attached_fee_ids: [
      "fee_rental_kayak_hourly",
      "fee_rental_kayak_fullday",
      "fee_rental_deposit_light",
    ],
    home_dock: "Beach launch",
    status: "available",
    active: true,
    created_at: "2026-04-01T08:00:00Z",
    updated_at: isoOffsetDays(-10),
  },
  {
    id: "rb_kayak_red",
    name: "Red Kayak (single)",
    type: "kayak",
    capacity: 1,
    hourly_rate: 25,
    full_day_rate: 65,
    deposit_amount: 50,
    attached_fee_ids: [
      "fee_rental_kayak_hourly",
      "fee_rental_kayak_fullday",
      "fee_rental_deposit_light",
    ],
    home_dock: "Beach launch",
    status: "available",
    active: true,
    created_at: "2026-04-01T08:00:00Z",
    updated_at: isoOffsetDays(-10),
  },
  {
    id: "rb_sup_1",
    name: "Tandem Paddleboard",
    type: "paddleboard",
    capacity: 2,
    hourly_rate: 35,
    full_day_rate: 85,
    deposit_amount: 75,
    attached_fee_ids: [
      "fee_rental_paddleboard_hourly",
      "fee_rental_paddleboard_fullday",
      "fee_rental_deposit_light",
    ],
    home_dock: "Beach launch",
    status: "available",
    active: true,
    created_at: "2026-04-01T08:00:00Z",
    updated_at: isoOffsetDays(-10),
  },
];

// Lakeside (second tenant) fleet. Two pontoons in the club rotation,
// one kayak walk-up only — minimum viable fleet to exercise the
// tenant-scope filter and a club booking flow.
const LAKESIDE_RENTAL_BOATS: RentalBoat[] = [
  {
    id: "rb_lks_pontoon_1",
    tenant_id: SECOND_TENANT_ID,
    name: "Lakeside Pontoon — Loon",
    type: "pontoon",
    capacity: 10,
    hourly_rate: 85,
    half_day_rate: 295,
    full_day_rate: 475,
    deposit_amount: 500,
    attached_fee_ids: [
      "fee_rental_hourly_pontoon",
      "fee_rental_halfday_pontoon",
      "fee_rental_fullday_pontoon",
      "fee_rental_deposit_standard",
    ],
    fuel_capacity_gal: 28,
    current_fuel_pct: 88,
    hour_meter_reading: 312,
    home_dock: "Lakeside Dock A",
    status: "available",
    active: true,
    available_for_club: true,
    created_at: "2026-03-15T08:00:00Z",
    updated_at: isoOffsetDays(-2),
  },
  {
    id: "rb_lks_pontoon_2",
    tenant_id: SECOND_TENANT_ID,
    name: "Lakeside Pontoon — Heron",
    type: "pontoon",
    capacity: 10,
    hourly_rate: 85,
    half_day_rate: 295,
    full_day_rate: 475,
    deposit_amount: 500,
    attached_fee_ids: [
      "fee_rental_hourly_pontoon",
      "fee_rental_halfday_pontoon",
      "fee_rental_fullday_pontoon",
      "fee_rental_deposit_standard",
    ],
    fuel_capacity_gal: 28,
    current_fuel_pct: 60,
    hour_meter_reading: 287,
    home_dock: "Lakeside Dock A",
    status: "available",
    active: true,
    available_for_club: true,
    created_at: "2026-03-15T08:00:00Z",
    updated_at: isoOffsetDays(-4),
  },
  {
    id: "rb_lks_kayak_1",
    tenant_id: SECOND_TENANT_ID,
    name: "Lakeside Kayak (single)",
    type: "kayak",
    capacity: 1,
    hourly_rate: 20,
    full_day_rate: 60,
    deposit_amount: 50,
    attached_fee_ids: [
      "fee_rental_kayak_hourly",
      "fee_rental_kayak_fullday",
      "fee_rental_deposit_light",
    ],
    home_dock: "Lakeside Beach",
    status: "available",
    active: true,
    created_at: "2026-03-15T08:00:00Z",
    updated_at: isoOffsetDays(-8),
  },
];

// Mirror of attachRateTenant — stamp legacy boats with the primary
// tenant, leave Lakeside boats alone.
function attachRentalBoatTenant(b: RentalBoat): RentalBoat {
  return b.tenant_id ? b : { ...b, tenant_id: SEED_TENANT_ID };
}

export const RENTAL_BOATS: RentalBoat[] = [
  ...BASE_RENTAL_BOATS,
  ...LAKESIDE_RENTAL_BOATS,
].map(attachRentalBoatTenant);

// Sample bookings spread across all status states so the
// progress rail + landing-page filters have something to show.
// All seed rentals are primary-tenant — the attach helper stamps
// tenant_id at export time. Lakeside currently has no seeded
// walk-up rentals; that's fine, the catalog is what we're scoping.
const BASE_BOAT_RENTALS: BoatRental[] = [
  {
    // Status: reserved — invite sent, customer hasn't opened it yet
    id: "br_1001",
    number: "BR-1001",
    boat_id: "rb_pontoon_2",
    patron_name: "Marcus & Tara Whitfield",
    patron_email: "marcus.whitfield@example.com",
    patron_phone: "(231) 555-0142",
    start_at: isoOffsetDays(2).replace(/T.*/, "T14:00:00Z"),
    end_at: isoOffsetDays(2).replace(/T.*/, "T20:00:00Z"),
    rate_kind: "half_day",
    base_amount: 325,
    deposit_hold: 500,
    pickup_token: "pickup_demo_whitfield",
    status: "reserved",
    checkin: {
      link_sent_at: isoOffsetHours(-2),
    },
    created_at: isoOffsetHours(-2),
    updated_at: isoOffsetHours(-2),
  },
  {
    // Status: confirmed — agreement signed + deposit on file, pickup tomorrow
    id: "br_1002",
    number: "BR-1002",
    boat_id: "rb_kayak_yellow",
    patron_name: "Jordan Reyes",
    patron_email: "jreyes@example.com",
    patron_phone: "(231) 555-0177",
    patron_id_last4: "8392",
    start_at: isoOffsetDays(1).replace(/T.*/, "T09:00:00Z"),
    end_at: isoOffsetDays(1).replace(/T.*/, "T13:00:00Z"),
    rate_kind: "hourly",
    base_amount: 100,
    deposit_hold: 50,
    pickup_token: "pickup_demo_reyes",
    signer_name: "Jordan Reyes",
    deposit_card_id: "card_walk_in_reyes",
    status: "confirmed",
    checkin: {
      link_sent_at: isoOffsetHours(-26),
      link_viewed_at: isoOffsetHours(-25),
      agreement_signed_at: isoOffsetHours(-24),
      deposit_authorized_at: isoOffsetHours(-24),
    },
    created_at: isoOffsetHours(-26),
    updated_at: isoOffsetHours(-24),
  },
  {
    // Status: checked_out — on the water right now
    id: "br_1003",
    number: "BR-1003",
    boat_id: "rb_pontoon_1",
    boater_id: "b_emmons",            // existing annual holder renting for the day
    start_at: isoOffsetHours(-2),
    end_at: isoOffsetHours(6),
    rate_kind: "full_day",
    base_amount: 525,
    deposit_hold: 500,
    pickup_token: "pickup_demo_emmons",
    signer_name: "Robert Emmons",
    deposit_card_id: "card_emmons_visa",
    fuel_out_pct: 92,
    hours_out: 487,
    status: "checked_out",
    checkin: {
      link_sent_at: isoOffsetHours(-26),
      link_viewed_at: isoOffsetHours(-23),
      agreement_signed_at: isoOffsetHours(-22),
      deposit_authorized_at: isoOffsetHours(-22),
      checked_out_at: isoOffsetHours(-2),
    },
    created_at: isoOffsetHours(-26),
    updated_at: isoOffsetHours(-2),
  },
  {
    // Status: returned — boat back, charges being finalized
    id: "br_1004",
    number: "BR-1004",
    boat_id: "rb_sup_1",
    patron_name: "Aiyana Cooper",
    patron_email: "aiyana@example.com",
    patron_phone: "(231) 555-0124",
    start_at: isoOffsetDays(-1).replace(/T.*/, "T10:00:00Z"),
    end_at: isoOffsetDays(-1).replace(/T.*/, "T13:00:00Z"),
    rate_kind: "hourly",
    base_amount: 105,
    deposit_hold: 75,
    pickup_token: "pickup_demo_cooper",
    signer_name: "Aiyana Cooper",
    deposit_card_id: "card_walk_in_cooper",
    status: "returned",
    checkin: {
      link_sent_at: isoOffsetDays(-2),
      link_viewed_at: isoOffsetDays(-2),
      agreement_signed_at: isoOffsetDays(-2),
      deposit_authorized_at: isoOffsetDays(-2),
      checked_out_at: isoOffsetDays(-1).replace(/T.*/, "T10:00:00Z"),
      returned_at: isoOffsetDays(-1).replace(/T.*/, "T13:12:00Z"),
    },
    created_at: isoOffsetDays(-2),
    updated_at: isoOffsetDays(-1),
  },
  {
    // Status: closed — final invoice posted last week
    id: "br_1005",
    number: "BR-1005",
    boat_id: "rb_skiff_1",
    patron_name: "Daniel Hertzog",
    patron_email: "dhertzog@example.com",
    patron_phone: "(231) 555-0166",
    patron_id_last4: "1107",
    start_at: isoOffsetDays(-7).replace(/T.*/, "T06:00:00Z"),
    end_at: isoOffsetDays(-7).replace(/T.*/, "T14:00:00Z"),
    rate_kind: "full_day",
    base_amount: 365,
    deposit_hold: 300,
    pickup_token: "pickup_demo_hertzog",
    signer_name: "Daniel Hertzog",
    deposit_card_id: "card_walk_in_hertzog",
    fuel_out_pct: 85,
    fuel_in_pct: 31,
    hours_out: 608,
    hours_in: 612,
    fuel_charge: 28.40,
    damage_charge: 0,
    final_total: 393.40,
    status: "closed",
    related_ledger_entry_id: "le_br_1005",
    checkin: {
      link_sent_at: isoOffsetDays(-9),
      link_viewed_at: isoOffsetDays(-9),
      agreement_signed_at: isoOffsetDays(-8),
      deposit_authorized_at: isoOffsetDays(-8),
      checked_out_at: isoOffsetDays(-7).replace(/T.*/, "T06:00:00Z"),
      returned_at: isoOffsetDays(-7).replace(/T.*/, "T14:08:00Z"),
    },
    created_at: isoOffsetDays(-9),
    updated_at: isoOffsetDays(-7),
  },
];

function attachBoatRentalTenant(r: BoatRental): BoatRental {
  return r.tenant_id ? r : { ...r, tenant_id: SEED_TENANT_ID };
}

export const BOAT_RENTALS: BoatRental[] = BASE_BOAT_RENTALS.map(
  attachBoatRentalTenant
);

// ----- helpers -----

export function getBoater(id: string) {
  return BOATERS.find((b) => b.id === id);
}

/**
 * Resolve a holder portal magic-link token to the boater it belongs to.
 * Used by /portal/[token] to validate the URL on landing.
 */
export function getBoaterByPortalToken(token: string) {
  return BOATERS.find((b) => b.portal_token === token);
}

export function getVesselsForBoater(boaterId: string) {
  return VESSELS.filter((v) => v.boater_id === boaterId || v.co_owner_ids.includes(boaterId));
}

export function getReservationsForBoater(boaterId: string) {
  return RESERVATIONS.filter((r) => r.boater_id === boaterId);
}

export function getLedgerForBoater(boaterId: string) {
  return LEDGER.filter((l) => l.boater_id === boaterId);
}

export function getWorkOrdersForBoater(boaterId: string) {
  return WORK_ORDERS.filter((w) => w.boater_id === boaterId);
}

export function getCommunicationsForBoater(boaterId: string) {
  return COMMUNICATIONS.filter((c) => c.boater_id === boaterId);
}

export function getContractsForBoater(boaterId: string) {
  return CONTRACTS.filter((c) => c.boater_id === boaterId);
}

export function getRentalBoat(id: string | undefined) {
  if (!id) return undefined;
  return RENTAL_BOATS.find((b) => b.id === id);
}

export function getBoatRental(id: string | undefined) {
  if (!id) return undefined;
  return BOAT_RENTALS.find((r) => r.id === id);
}

export function getBoatRentalByToken(token: string) {
  return BOAT_RENTALS.find((r) => r.pickup_token === token);
}

export function getBoatRentalsForBoater(boaterId: string) {
  return BOAT_RENTALS.filter((r) => r.boater_id === boaterId);
}

export function getActiveBoatRentalForBoat(boatId: string) {
  return BOAT_RENTALS.find(
    (r) =>
      r.boat_id === boatId &&
      (r.status === "reserved" ||
        r.status === "confirmed" ||
        r.status === "checked_out")
  );
}

/**
 * Currency display for booked / final rental amount.
 * Half-day = 4hr block; full-day = 8hr block.
 */
export function rentalDurationLabel(r: BoatRental) {
  if (r.rate_kind === "half_day") return "Half day (4h)";
  if (r.rate_kind === "full_day") return "Full day (8h)";
  const ms = new Date(r.end_at).getTime() - new Date(r.start_at).getTime();
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  return `${hours}h`;
}

export function getCardsForBoater(boaterId: string) {
  return CARDS_ON_FILE[boaterId] ?? [];
}

export function getWorkOrder(id: string) {
  return WORK_ORDERS.find((w) => w.id === id);
}

export function getQuoteForWorkOrder(workOrderId: string) {
  return QUOTES.find((q) => q.work_order_id === workOrderId);
}

export function getQuote(id: string | undefined) {
  if (!id) return undefined;
  return QUOTES.find((q) => q.id === id);
}

export function getQuoteByToken(token: string) {
  return QUOTES.find((q) => q.signature_token === token);
}

export function getContractByToken(token: string) {
  return CONTRACTS.find((c) => c.signature_token === token);
}

export function getLedgerEntry(id: string) {
  return LEDGER.find((l) => l.id === id);
}

export function getLedgerEntriesForWorkOrder(workOrderId: string) {
  return LEDGER.filter((l) => l.linked_work_order_id === workOrderId);
}

export function getCommunicationsForWorkOrder(workOrderId: string) {
  return COMMUNICATIONS.filter(
    (c) => c.related_entity?.type === "work_order" && c.related_entity.id === workOrderId
  );
}

// Recalculate quote totals from current line_items + tax_rate.
// Convention: tax applies to parts + fees, not labor (Texas-style).
export function recalcQuote<T extends {
  line_items: { kind: "part" | "labor" | "fee" | "discount"; total: number }[];
  tax_rate: number;
}>(q: T): T & {
  parts_subtotal: number;
  labor_subtotal: number;
  fees_subtotal: number;
  discount_subtotal: number;
  tax_amount: number;
  total: number;
} {
  const parts_subtotal = q.line_items.filter((l) => l.kind === "part").reduce((s, l) => s + l.total, 0);
  const labor_subtotal = q.line_items.filter((l) => l.kind === "labor").reduce((s, l) => s + l.total, 0);
  const fees_subtotal = q.line_items.filter((l) => l.kind === "fee").reduce((s, l) => s + l.total, 0);
  const discount_subtotal = q.line_items.filter((l) => l.kind === "discount").reduce((s, l) => s + l.total, 0);
  const taxable = parts_subtotal + fees_subtotal;
  const tax_amount = Math.round(taxable * q.tax_rate * 100) / 100;
  const total =
    Math.round(
      (parts_subtotal + labor_subtotal + fees_subtotal + discount_subtotal + tax_amount) * 100
    ) / 100;
  return {
    ...q,
    parts_subtotal,
    labor_subtotal,
    fees_subtotal,
    discount_subtotal,
    tax_amount,
    total,
  };
}

export function getSlip(id: string | undefined) {
  if (!id) return undefined;
  return SLIPS.find((s) => s.id === id);
}

export function getVessel(id: string | undefined) {
  if (!id) return undefined;
  return VESSELS.find((v) => v.id === id);
}

export function getUser(id: string | undefined) {
  if (!id) return undefined;
  return USERS.find((u) => u.id === id);
}

export function getTemplate(id: string) {
  return CONTRACT_TEMPLATES.find((t) => t.id === id);
}

export function getOpenBalance(boaterId: string) {
  return getLedgerForBoater(boaterId)
    .filter((l) => l.type === "invoice")
    .reduce((sum, e) => sum + e.open_balance, 0);
}

export function getReservationsForDate(dateISO: string) {
  return RESERVATIONS.filter(
    (r) => r.arrival_date === dateISO || r.departure_date === dateISO
  );
}

export function getArrivalsForDate(dateISO: string) {
  return RESERVATIONS.filter((r) => r.arrival_date === dateISO && r.status !== "cancelled");
}

export function getDeparturesForDate(dateISO: string) {
  return RESERVATIONS.filter(
    (r) => r.departure_date === dateISO && (r.status === "occupied" || r.status === "scheduled")
  );
}

export function getUpcomingReservations(dateISO: string, days = 7) {
  const start = new Date(dateISO);
  const end = new Date(start.getTime() + days * 86_400_000);
  return RESERVATIONS.filter((r) => {
    const arr = new Date(r.arrival_date);
    return arr > start && arr <= end && r.status === "scheduled";
  }).sort((a, b) => (a.arrival_date < b.arrival_date ? -1 : 1));
}

export function getCurrentReservation(boaterId: string) {
  const today = new Date().toISOString().slice(0, 10);
  return getReservationsForBoater(boaterId).find(
    (r) => r.status === "occupied" || (r.arrival_date <= today && r.departure_date >= today)
  );
}

export function formatInches(totalInches: number | undefined) {
  if (!totalInches) return "—";
  const ft = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return inches ? `${ft}' ${inches}"` : `${ft}'`;
}

export function formatMoney(amount: number) {
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ============================================================
// Rentals domain mock data
// ============================================================

const BASE_RENTAL_GROUPS: RentalGroup[] = [
  { id: "rg_dsm_a", name: "Damsite A Dock", type: "slips", check_in_time: "12:00 AM", check_out_time: "12:00 AM", total_spaces: 39, occupied_spaces: 27 },
  { id: "rg_dsm_a_js", name: "Damsite A Dock (Jet Ski)", type: "jet_ski", check_in_time: "12:00 AM", check_out_time: "12:00 AM", total_spaces: 18, occupied_spaces: 12 },
  { id: "rg_dsm_b", name: "Damsite B Dock", type: "slips", check_in_time: "12:00 AM", check_out_time: "12:00 AM", total_spaces: 50, occupied_spaces: 37 },
  { id: "rg_dsm_buoy", name: "Damsite Buoy", type: "buoy", check_in_time: "12:00 AM", check_out_time: "12:00 AM", total_spaces: 11, occupied_spaces: 7 },
  { id: "rg_dsm_c", name: "Damsite C Dock", type: "slips", check_in_time: "12:00 AM", check_out_time: "12:00 AM", total_spaces: 41, occupied_spaces: 32 },
  { id: "rg_dsm_d", name: "Damsite D Dock", type: "slips", check_in_time: "12:00 AM", check_out_time: "12:00 AM", total_spaces: 12, occupied_spaces: 9 },
  { id: "rg_dsm_e", name: "Damsite E Dock", type: "slips", check_in_time: "12:00 AM", check_out_time: "12:00 AM", total_spaces: 19, occupied_spaces: 3 },
  { id: "rg_mds_a", name: "Marina Del Sur A Dock", type: "slips", check_in_time: "12:00 AM", check_out_time: "12:00 AM", total_spaces: 24, occupied_spaces: 0 },
];

// Generate spaces for Damsite A Dock (matches the reference exactly)
const DAMSITE_A_SPACES: RentalSpace[] = Array.from({ length: 39 }, (_, i) => {
  const number = String(i + 1).padStart(2, "0");
  const isEvenSize = (i + 1) % 2 === 0;
  // Occupancy pattern roughly matching screenshot (27/39 occupied)
  const occupiedPattern = [false, false, false, true, true, true, false, true, true, true, true, true, true, false, true, true, true, true, true, true, true, true, false, true, true, true, true, false, true, true, true, true, true, false, true, true, true, false, false];
  return {
    id: `sp_dsm_a_${number}`,
    group_id: "rg_dsm_a",
    number,
    occupancy_type: "Standard" as const,
    length_inches: (isEvenSize ? 32 : 28) * 12,
    beam_inches: 12 * 12,
    has_power: true,
    has_water: true,
    has_pump_out: i < 10,
    active: true,
    status: occupiedPattern[i] ? "occupied" as const : "vacant" as const,
  };
});

// A few spaces from other groups, for breadth
const DAMSITE_B_SPACES: RentalSpace[] = Array.from({ length: 20 }, (_, i) => {
  const number = String(i + 1).padStart(2, "0");
  const occupied = i % 3 !== 0;
  return {
    id: `sp_dsm_b_${number}`,
    group_id: "rg_dsm_b",
    number,
    occupancy_type: "Standard" as const,
    length_inches: 35 * 12,
    beam_inches: 14 * 12,
    has_power: true,
    has_water: true,
    has_pump_out: true,
    active: true,
    status: occupied ? "occupied" as const : "vacant" as const,
  };
});

const JET_SKI_SPACES: RentalSpace[] = Array.from({ length: 18 }, (_, i) => {
  const occupied = i < 12;
  return {
    id: `sp_dsm_a_js_${i + 1}`,
    group_id: "rg_dsm_a_js",
    number: `JS-${String(i + 1).padStart(2, "0")}`,
    occupancy_type: "Jet Ski" as const,
    length_inches: 12 * 12,
    beam_inches: 5 * 12,
    has_power: false,
    has_water: false,
    has_pump_out: false,
    active: true,
    status: occupied ? "occupied" as const : "vacant" as const,
  };
});

const BUOY_SPACES: RentalSpace[] = Array.from({ length: 11 }, (_, i) => {
  const occupied = i < 7;
  return {
    id: `sp_dsm_buoy_${i + 1}`,
    group_id: "rg_dsm_buoy",
    number: `B-${String(i + 1).padStart(2, "0")}`,
    occupancy_type: "Buoy" as const,
    length_inches: 40 * 12,
    beam_inches: 14 * 12,
    has_power: false,
    has_water: false,
    has_pump_out: false,
    active: true,
    status: occupied ? "occupied" as const : "vacant" as const,
  };
});

export const RENTAL_GROUPS: RentalGroup[] = withTenantId(BASE_RENTAL_GROUPS);

const BASE_RENTAL_SPACES: RentalSpace[] = [
  ...DAMSITE_A_SPACES,
  ...DAMSITE_B_SPACES,
  ...JET_SKI_SPACES,
  ...BUOY_SPACES,
];

export const RENTAL_SPACES: RentalSpace[] = withTenantId(BASE_RENTAL_SPACES);

// Force slip A29 to be occupied since David Emmons holds it
const a29 = RENTAL_SPACES.find((s) => s.id === "sp_dsm_a_29");
if (a29) a29.status = "occupied";

// Primary-tenant rate catalog. Tenant_id is stamped at export time
// so we don't have to repeat it on every row. Lakeside (the second
// tenant) gets its own slimmer catalog below.
const BASE_RATES: Rate[] = [
  { id: "rate_std_annual", name: "2026 Annual — Standard Slip", occupancy_type: "Standard", cadence: "annual", amount: 3900 },
  { id: "rate_std_seasonal", name: "2026 Seasonal — Standard Slip (Apr-Oct)", occupancy_type: "Standard", cadence: "seasonal", amount: 2200 },
  { id: "rate_std_monthly", name: "Monthly — Standard Slip", occupancy_type: "Standard", cadence: "monthly", amount: 325 },
  { id: "rate_std_daily", name: "Transient — Standard Slip", occupancy_type: "Standard", cadence: "daily", amount: 45 },
  { id: "rate_js_daily", name: "Jet Ski — Day Rental", occupancy_type: "Jet Ski", cadence: "daily", amount: 35 },
  { id: "rate_js_weekly", name: "Jet Ski — Week", occupancy_type: "Jet Ski", cadence: "weekly", amount: 195 },
  { id: "rate_buoy_seasonal", name: "Buoy — Seasonal", occupancy_type: "Buoy", cadence: "seasonal", amount: 1400 },
  { id: "rate_buoy_daily", name: "Buoy — Transient", occupancy_type: "Buoy", cadence: "daily", amount: 32 },
  { id: "rate_dry_monthly", name: "Dry Storage — Monthly", occupancy_type: "Dry Storage", cadence: "monthly", amount: 180 },
  // ── Rental Club plans — each Rate row IS a plan. Subscriptions
  // reference these by id; staff edits the amount/days/join_fee here
  // and new signups inherit. Existing memberships snapshot at signup
  // via ClubSubscription.joined_at_* so price changes don't auto-
  // re-bill existing members.
  {
    id: "rate_club_basic",
    name: "Rental Club — Basic",
    occupancy_type: "Rental Club",
    cadence: "monthly",
    amount: 199,
    days_per_month: 4,
    plan_tier: "basic",
  },
  {
    id: "rate_club_plus",
    name: "Rental Club — Plus",
    occupancy_type: "Rental Club",
    cadence: "monthly",
    amount: 349,
    days_per_month: 8,
    plan_tier: "plus",
  },
  {
    id: "rate_club_premium",
    name: "Rental Club — Premium",
    occupancy_type: "Rental Club",
    cadence: "monthly",
    amount: 599,
    days_per_month: 16,
    plan_tier: "premium",
  },
  // ── Per-tier setup fees ─────────────────────────────────────────
  // Setup fees used to live as a `join_fee` field embedded on each
  // monthly plan row. That meant the setup-fee charge couldn't show
  // up in the unified service-fee catalog or be edited like every
  // other fee. Now each tier has its OWN one-time Rate row in the
  // catalog, linked back to the parent plan via plan_tier. Signup
  // looks up the matching row via getSetupRateForTier(tier).
  {
    id: "rate_club_setup_basic",
    name: "Rental Club — Basic — Setup",
    occupancy_type: "Rental Club",
    cadence: "one_time",
    amount: 499,
    plan_tier: "basic",
  },
  {
    id: "rate_club_setup_plus",
    name: "Rental Club — Plus — Setup",
    occupancy_type: "Rental Club",
    cadence: "one_time",
    amount: 999,
    plan_tier: "plus",
  },
  {
    id: "rate_club_setup_premium",
    name: "Rental Club — Premium — Setup",
    occupancy_type: "Rental Club",
    cadence: "one_time",
    amount: 1499,
    plan_tier: "premium",
  },
];

// Lakeside (second tenant) rates. Smaller catalog — different market,
// fewer service types. Two club plans show that the same Rate-as-plan
// model works per-tenant with different prices.
const LAKESIDE_RATES: Rate[] = [
  {
    id: "rate_lks_std_annual",
    tenant_id: SECOND_TENANT_ID,
    name: "2026 Annual — Lakeside Standard",
    occupancy_type: "Standard",
    cadence: "annual",
    amount: 2900,
  },
  {
    id: "rate_lks_std_monthly",
    tenant_id: SECOND_TENANT_ID,
    name: "Monthly — Lakeside Standard",
    occupancy_type: "Standard",
    cadence: "monthly",
    amount: 240,
  },
  {
    id: "rate_lks_club_basic",
    tenant_id: SECOND_TENANT_ID,
    name: "Lakeside Club — Basic",
    occupancy_type: "Rental Club",
    cadence: "monthly",
    amount: 149,
    days_per_month: 4,
    plan_tier: "basic",
  },
  {
    id: "rate_lks_club_plus",
    tenant_id: SECOND_TENANT_ID,
    name: "Lakeside Club — Plus",
    occupancy_type: "Rental Club",
    cadence: "monthly",
    amount: 259,
    days_per_month: 8,
    plan_tier: "plus",
  },
  // Lakeside per-tier setup fees — separate one-time Rate rows,
  // same plan_tier as the parent monthly plan.
  {
    id: "rate_lks_club_setup_basic",
    tenant_id: SECOND_TENANT_ID,
    name: "Lakeside Club — Basic — Setup",
    occupancy_type: "Rental Club",
    cadence: "one_time",
    amount: 299,
    plan_tier: "basic",
  },
  {
    id: "rate_lks_club_setup_plus",
    tenant_id: SECOND_TENANT_ID,
    name: "Lakeside Club — Plus — Setup",
    occupancy_type: "Rental Club",
    cadence: "one_time",
    amount: 599,
    plan_tier: "plus",
  },
];

// Stamp tenant_id on legacy rate rows that don't carry one. Mirrors
// the attachTenantId pattern used by BOATERS.
function attachRateTenant(r: Rate): Rate {
  return r.tenant_id ? r : { ...r, tenant_id: SEED_TENANT_ID };
}

export const RATES: Rate[] = [...BASE_RATES, ...LAKESIDE_RATES].map(
  attachRateTenant
);

// Primary tenant catalog. tenant_id stamped at export time so we
// don't have to repeat it on every row.
const BASE_ADDITIONAL_FEES: AdditionalFee[] = [
  {
    id: "fee_hoist",
    name: "Hoist Fee",
    description: "In/out hoist service for vessel launch or haul-out.",
    amount: 55.02,
    recurrence: "one_time",
    applies_to: ["slip_contract", "boat_rental", "work_order", "pos"],
    accounting_line_item: "2025/2026 Marina Del Sur Slip Fees",
    linked_activity_type: "haul_out",
    auto_attach: false,
    cadence: "one_time",
    applies_to_entities: ["reservation", "contract"],
  },
  {
    id: "fee_transfer",
    name: "Transfer Fee",
    description: "Slip-to-slip transfer charge.",
    amount: 200,
    recurrence: "one_time",
    applies_to: ["slip_contract", "pos"],
    accounting_line_item: "2025/2026 Marina Del Sur Slip Fees",
    cadence: "one_time",
    applies_to_entities: ["contract"],
  },
  {
    id: "fee_pump_out",
    name: "Pump-out Service",
    description: "Holding tank pump-out, on-demand.",
    amount: 25,
    recurrence: "one_time",
    applies_to: ["work_order", "pos"],
    accounting_line_item: "2026 Services",
    linked_activity_type: "pump_out",
    auto_attach: true,
    cadence: "one_time",
    applies_to_entities: ["reservation", "contract", "club_subscription"],
  },
  {
    id: "fee_winterize",
    name: "Winterization Service",
    description: "Engine, plumbing, fuel stabilizer.",
    amount: 285,
    recurrence: "one_time",
    applies_to: ["slip_contract", "work_order", "pos"],
    accounting_line_item: "2026 Services",
    linked_activity_type: "winterization",
    linked_template_id: "tpl_winterization",
    auto_attach: true,
    cadence: "one_time",
    applies_to_entities: ["contract", "reservation"],
  },
  {
    id: "fee_storage_move",
    name: "Storage Move",
    description: "Move vessel between storage locations.",
    amount: 120,
    recurrence: "one_time",
    applies_to: ["work_order", "pos"],
    accounting_line_item: "2026 Services",
    cadence: "one_time",
    applies_to_entities: ["contract"],
  },
  {
    id: "fee_pet_fee",
    name: "Pet Fee",
    description: "Annual pet liability surcharge.",
    amount: 75,
    recurrence: "annual",
    applies_to: ["slip_contract", "annual_billing_run"],
    accounting_line_item: "2026 Annual Fees",
    cadence: "annual",
    applies_to_entities: ["contract"],
  },
  {
    id: "fee_electric_addon",
    name: "Electric Add-on",
    description: "Monthly metered electric service add-on.",
    amount: 35,
    recurrence: "monthly",
    applies_to: ["slip_contract", "annual_billing_run"],
    accounting_line_item: "2026 Utilities",
    cadence: "monthly",
    applies_to_entities: ["contract", "reservation"],
  },
];

// Lakeside (second tenant) fee catalog. Minimal — three fees to
// exercise the tenant filter on each `applies_to` surface.
const LAKESIDE_ADDITIONAL_FEES: AdditionalFee[] = [
  {
    id: "fee_lks_launch",
    tenant_id: SECOND_TENANT_ID,
    name: "Lakeside Launch",
    description: "Day-use launch ramp fee.",
    amount: 18,
    recurrence: "one_time",
    applies_to: ["pos"],
    accounting_line_item: "Lakeside Services",
    cadence: "one_time",
    applies_to_entities: ["reservation"],
  },
  {
    id: "fee_lks_pump_out",
    tenant_id: SECOND_TENANT_ID,
    name: "Pump-out",
    description: "Holding tank pump-out.",
    amount: 22,
    recurrence: "one_time",
    applies_to: ["work_order", "pos"],
    accounting_line_item: "Lakeside Services",
    linked_activity_type: "pump_out",
    auto_attach: true,
    cadence: "one_time",
    applies_to_entities: ["reservation", "contract", "club_subscription"],
  },
  {
    id: "fee_lks_winterize",
    tenant_id: SECOND_TENANT_ID,
    name: "Winterize",
    description: "Engine + plumbing winterization.",
    amount: 245,
    recurrence: "one_time",
    applies_to: ["slip_contract", "work_order"],
    accounting_line_item: "Lakeside Services",
    linked_activity_type: "winterization",
    auto_attach: true,
    cadence: "one_time",
    applies_to_entities: ["contract"],
  },

  // ── Rental boat catalog rates ─────────────────────────────────────
  // These are the per-boat rental rate options the wizard surfaces.
  // Operators attach them to a rental boat (RentalBoat.attached_fee_ids)
  // from the wizard's Rates step, matching the same catalog-attach
  // pattern reservations/contracts use. Cadence is "one_time" since
  // each rental is a discrete event; the fee NAME conveys the duration
  // (hourly, half-day, full-day).
  {
    id: "fee_rental_hourly_pontoon",
    name: "Pontoon — Hourly",
    description: "Open-deck pontoon hourly rental — fuel not included.",
    amount: 95,
    recurrence: "one_time",
    applies_to: ["boat_rental"],
    accounting_line_item: "Rental Revenue",
    cadence: "one_time",
    applies_to_entities: ["rental_boat"],
  },
  {
    id: "fee_rental_halfday_pontoon",
    name: "Pontoon — Half day (4 hr)",
    description: "Most popular slot — morning or afternoon block.",
    amount: 325,
    recurrence: "one_time",
    applies_to: ["boat_rental"],
    accounting_line_item: "Rental Revenue",
    cadence: "one_time",
    applies_to_entities: ["rental_boat"],
  },
  {
    id: "fee_rental_fullday_pontoon",
    name: "Pontoon — Full day (8 hr)",
    description: "Sunup-to-sundown rental.",
    amount: 525,
    recurrence: "one_time",
    applies_to: ["boat_rental"],
    accounting_line_item: "Rental Revenue",
    cadence: "one_time",
    applies_to_entities: ["rental_boat"],
  },
  {
    id: "fee_rental_kayak_hourly",
    name: "Kayak / SUP — Hourly",
    description: "Single or tandem paddle craft — life jackets included.",
    amount: 22,
    recurrence: "one_time",
    applies_to: ["boat_rental"],
    accounting_line_item: "Rental Revenue",
    cadence: "one_time",
    applies_to_entities: ["rental_boat"],
  },
  {
    id: "fee_rental_jetski_hourly",
    name: "Jet ski — Hourly",
    description: "Two-up PWC, fuel included.",
    amount: 175,
    recurrence: "one_time",
    applies_to: ["boat_rental"],
    accounting_line_item: "Rental Revenue",
    cadence: "one_time",
    applies_to_entities: ["rental_boat"],
  },
  {
    id: "fee_rental_deposit_standard",
    name: "Refundable deposit — Standard",
    description: "Authorized at pickup, released on safe return.",
    amount: 500,
    recurrence: "one_time",
    applies_to: ["boat_rental"],
    accounting_line_item: "Refundable Deposits",
    cadence: "one_time",
    applies_to_entities: ["rental_boat"],
    is_deposit: true,
  },

  // ── Fishing skiff catalog ──
  {
    id: "fee_rental_skiff_hourly",
    name: "Fishing Skiff — Hourly",
    description: "Lund-class skiff with fishfinder + rod holders.",
    amount: 65,
    recurrence: "one_time",
    applies_to: ["boat_rental"],
    accounting_line_item: "Rental Revenue",
    cadence: "one_time",
    applies_to_entities: ["rental_boat"],
  },
  {
    id: "fee_rental_skiff_halfday",
    name: "Fishing Skiff — Half day (4 hr)",
    description: "Morning or afternoon block.",
    amount: 220,
    recurrence: "one_time",
    applies_to: ["boat_rental"],
    accounting_line_item: "Rental Revenue",
    cadence: "one_time",
    applies_to_entities: ["rental_boat"],
  },
  {
    id: "fee_rental_skiff_fullday",
    name: "Fishing Skiff — Full day (8 hr)",
    description: "Sunup to sundown.",
    amount: 365,
    recurrence: "one_time",
    applies_to: ["boat_rental"],
    accounting_line_item: "Rental Revenue",
    cadence: "one_time",
    applies_to_entities: ["rental_boat"],
  },

  // ── Jet ski supplements ──
  {
    id: "fee_rental_jetski_halfday",
    name: "Jet ski — Half day (4 hr)",
    description: "Two-up PWC, fuel included.",
    amount: 400,
    recurrence: "one_time",
    applies_to: ["boat_rental"],
    accounting_line_item: "Rental Revenue",
    cadence: "one_time",
    applies_to_entities: ["rental_boat"],
  },

  // ── Kayak supplements ──
  {
    id: "fee_rental_kayak_fullday",
    name: "Kayak / SUP — Full day",
    description: "Includes paddle + PFD.",
    amount: 65,
    recurrence: "one_time",
    applies_to: ["boat_rental"],
    accounting_line_item: "Rental Revenue",
    cadence: "one_time",
    applies_to_entities: ["rental_boat"],
  },

  // ── Paddleboard catalog ──
  {
    id: "fee_rental_paddleboard_hourly",
    name: "Paddleboard — Hourly",
    description: "Single or tandem SUP, paddle included.",
    amount: 35,
    recurrence: "one_time",
    applies_to: ["boat_rental"],
    accounting_line_item: "Rental Revenue",
    cadence: "one_time",
    applies_to_entities: ["rental_boat"],
  },
  {
    id: "fee_rental_paddleboard_fullday",
    name: "Paddleboard — Full day",
    description: "Sunup to sundown SUP rental.",
    amount: 85,
    recurrence: "one_time",
    applies_to: ["boat_rental"],
    accounting_line_item: "Rental Revenue",
    cadence: "one_time",
    applies_to_entities: ["rental_boat"],
  },

  // ── Deposit tiers ──
  {
    id: "fee_rental_deposit_jetski",
    name: "Refundable deposit — Jet ski",
    description: "Larger hold for high-value PWC.",
    amount: 750,
    recurrence: "one_time",
    applies_to: ["boat_rental"],
    accounting_line_item: "Refundable Deposits",
    cadence: "one_time",
    applies_to_entities: ["rental_boat"],
    is_deposit: true,
  },
  {
    id: "fee_rental_deposit_skiff",
    name: "Refundable deposit — Skiff",
    description: "Authorized at pickup, released on safe return.",
    amount: 300,
    recurrence: "one_time",
    applies_to: ["boat_rental"],
    accounting_line_item: "Refundable Deposits",
    cadence: "one_time",
    applies_to_entities: ["rental_boat"],
    is_deposit: true,
  },
  {
    id: "fee_rental_deposit_light",
    name: "Refundable deposit — Light (kayak / SUP)",
    description: "Small hold for paddle craft.",
    amount: 50,
    recurrence: "one_time",
    applies_to: ["boat_rental"],
    accounting_line_item: "Refundable Deposits",
    cadence: "one_time",
    applies_to_entities: ["rental_boat"],
    is_deposit: true,
  },
];

function attachFeeTenant(f: AdditionalFee): AdditionalFee {
  return f.tenant_id ? f : { ...f, tenant_id: SEED_TENANT_ID };
}

export const ADDITIONAL_FEES: AdditionalFee[] = [
  ...BASE_ADDITIONAL_FEES,
  ...LAKESIDE_ADDITIONAL_FEES,
].map(attachFeeTenant);

// Meter readings — most normal, a couple anomalous
const BASE_METER_READINGS: MeterReading[] = [
  { id: "m_a01", space_id: "sp_dsm_a_01", meter_number: "01-", current_reading: 538, current_ts: "2026-05-17T13:32:00Z", prev_reading: 537, prev_ts: "2026-04-18T12:02:00Z", rate_per_unit: 0.14, unit: "kWh" },
  { id: "m_a02", space_id: "sp_dsm_a_02", meter_number: "02-A", current_reading: 2199, current_ts: "2026-05-17T13:32:00Z", prev_reading: 2199, prev_ts: "2026-04-18T12:02:00Z", rate_per_unit: 0.14, unit: "kWh" },
  { id: "m_a03", space_id: "sp_dsm_a_03", meter_number: "03-A", current_reading: 19, current_ts: "2026-05-17T13:32:00Z", prev_reading: 19, prev_ts: "2026-04-18T12:02:00Z", rate_per_unit: 0.14, unit: "kWh" },
  { id: "m_a04", space_id: "sp_dsm_a_04", meter_number: "04-", current_reading: 349, current_ts: "2026-05-21T12:02:00Z", prev_reading: 337, prev_ts: "2026-05-17T13:32:00Z", rate_per_unit: 0.14, unit: "kWh" }, // anomalous +12 in 4 days
  { id: "m_a05", space_id: "sp_dsm_a_05", meter_number: "05-A", current_reading: 342, current_ts: "2026-05-21T12:04:00Z", prev_reading: 339, prev_ts: "2026-05-17T13:32:00Z", rate_per_unit: 0.14, unit: "kWh" },
  { id: "m_a06", space_id: "sp_dsm_a_06", meter_number: "06-A", current_reading: 3489, current_ts: "2026-05-21T12:04:00Z", prev_reading: 3484, prev_ts: "2026-05-17T13:32:00Z", rate_per_unit: 0.14, unit: "kWh" },
  { id: "m_a07", space_id: "sp_dsm_a_07", meter_number: "07-A", current_reading: 46, current_ts: "2026-05-17T13:32:00Z", prev_reading: 46, prev_ts: "2026-04-18T12:03:00Z", rate_per_unit: 0.14, unit: "kWh" },
  { id: "m_a29", space_id: "sp_dsm_a_29", meter_number: "29-A", current_reading: 1147, current_ts: "2026-05-22T08:14:00Z", prev_reading: 1093, prev_ts: "2026-04-18T11:48:00Z", rate_per_unit: 0.14, unit: "kWh" },
];
export const METER_READINGS: MeterReading[] = withTenantId(BASE_METER_READINGS);

const BASE_FUEL_INVENTORY: FuelInventory[] = [
  { id: "fi_gas", fuel_type: "gasoline", tank_capacity_gallons: 8000, current_level_gallons: 4720, current_price_per_gallon: 4.89, cost_per_gallon: 3.42, reorder_threshold_pct: 25, last_updated_at: "2026-05-23T07:00:00Z" },
  { id: "fi_diesel", fuel_type: "diesel", tank_capacity_gallons: 4000, current_level_gallons: 1180, current_price_per_gallon: 5.12, cost_per_gallon: 3.78, reorder_threshold_pct: 30, last_updated_at: "2026-05-23T07:00:00Z" },
];
export const FUEL_INVENTORY: FuelInventory[] = withTenantId(BASE_FUEL_INVENTORY);

const BASE_FUEL_DELIVERIES: FuelDelivery[] = [
  { id: "fd_2026_05", fuel_type: "gasoline", delivery_date: "2026-05-04", gallons_delivered: 3000, cost_per_gallon: 3.42, total_cost: 10260, supplier: "Pinon Petroleum" },
  { id: "fd_2026_05_d", fuel_type: "diesel", delivery_date: "2026-05-04", gallons_delivered: 1500, cost_per_gallon: 3.78, total_cost: 5670, supplier: "Pinon Petroleum" },
  { id: "fd_2026_04", fuel_type: "gasoline", delivery_date: "2026-04-12", gallons_delivered: 2500, cost_per_gallon: 3.31, total_cost: 8275, supplier: "Pinon Petroleum" },
];
export const FUEL_DELIVERIES: FuelDelivery[] = withTenantId(BASE_FUEL_DELIVERIES);

const BASE_FUEL_SALES: FuelSale[] = [
  { id: "fs_001", fuel_type: "gasoline", gallons: 38, price_per_gallon: 4.89, total: 185.82, sold_at: "2026-05-23T09:12:00Z", pedestal_id: "P-FUEL-1", space_id: "sp_dsm_a_12", boater_id: "b_emmons", payment_method: "charge_to_account" },
  { id: "fs_002", fuel_type: "diesel", gallons: 22, price_per_gallon: 5.12, total: 112.64, sold_at: "2026-05-22T16:45:00Z", pedestal_id: "P-FUEL-2", patron_id: "p_001", payment_method: "card" },
  { id: "fs_003", fuel_type: "gasoline", gallons: 14, price_per_gallon: 4.89, total: 68.46, sold_at: "2026-05-22T11:20:00Z", pedestal_id: "P-FUEL-1", boater_id: "b_peterson", payment_method: "charge_to_account" },
  { id: "fs_004", fuel_type: "gasoline", gallons: 52, price_per_gallon: 4.89, total: 254.28, sold_at: "2026-05-21T14:30:00Z", pedestal_id: "P-FUEL-1", boater_id: "b_davis", payment_method: "card" },
  { id: "fs_005", fuel_type: "gasoline", gallons: 19, price_per_gallon: 4.79, total: 91.01, sold_at: "2026-05-20T10:05:00Z", pedestal_id: "P-FUEL-1", patron_id: "p_002", payment_method: "cash" },
];
export const FUEL_SALES: FuelSale[] = withTenantId(BASE_FUEL_SALES);

// POS item catalog — see `PosCatalogItem` in lib/types.ts. Seed only;
// the store treats these as the initial state, then the operator edits
// items via Settings → POS Catalog (or the inline tile editor).
const BASE_POS_CATALOG: PosCatalogItem[] = [
  // Fuel Dock
  { id: "pos_fuel_gas", sku: "FUEL-GAS", name: "Gasoline / gal", category: "Fuel", price: 4.89, cost: 3.42, location_keys: ["fuel_dock"], taxable: true, active: true },
  { id: "pos_fuel_dsl", sku: "FUEL-DSL", name: "Diesel / gal", category: "Fuel", price: 5.12, cost: 3.78, location_keys: ["fuel_dock"], taxable: true, active: true },
  { id: "pos_oil_2str", sku: "OIL-2STR", name: "2-stroke oil quart", category: "Fluids", price: 18.50, cost: 9.50, location_keys: ["fuel_dock", "ship_store"], taxable: true, active: true },
  // Ship Store — stock-tracked items so the Inventory page has real
  // counts on first load. Fuel + services stay untracked (no stock
  // concept for "diesel by the gallon" or "pump-out service").
  { id: "pos_rope_50", sku: "ROPE-50", name: "Dock line 50ft", category: "Lines", price: 28.00, cost: 14.00, location_keys: ["ship_store"], taxable: true, active: true, tracked: true, stock_on_hand: 22, reorder_point: 6, reorder_quantity: 24, supplier_vendor_id: `vend_${SEED_TENANT_ID.slice(-6)}_marine_supply` },
  { id: "pos_fender_m", sku: "FENDER-M", name: "Fender — medium", category: "Lines", price: 18.00, cost: 9.50, location_keys: ["ship_store"], taxable: true, active: true, tracked: true, stock_on_hand: 14, reorder_point: 4, reorder_quantity: 18, supplier_vendor_id: `vend_${SEED_TENANT_ID.slice(-6)}_marine_supply` },
  { id: "pos_flare_kit", sku: "FLARE-KIT", name: "Flare kit", category: "Safety", price: 64.00, cost: 35.00, location_keys: ["ship_store"], taxable: true, active: true, tracked: true, stock_on_hand: 3, reorder_point: 4, reorder_quantity: 8, supplier_vendor_id: `vend_${SEED_TENANT_ID.slice(-6)}_marine_supply` },
  { id: "pos_ice_10", sku: "ICE-10", name: "Ice 10lb bag", category: "Provisions", price: 4.50, cost: 1.25, location_keys: ["ship_store"], taxable: false, active: true },
  { id: "pos_sunscrn", sku: "SUNSCRN", name: "Sunscreen SPF 50", category: "Provisions", price: 12.99, cost: 6.50, location_keys: ["ship_store"], taxable: true, active: true, tracked: true, stock_on_hand: 11, reorder_point: 5, reorder_quantity: 12, supplier_vendor_id: `vend_${SEED_TENANT_ID.slice(-6)}_marine_supply` },
  // Restaurant
  { id: "pos_burger", sku: "BURGER", name: "Marina burger", category: "Mains", price: 16.00, cost: 4.20, location_keys: ["restaurant"], taxable: true, active: true },
  { id: "pos_fish_taco", sku: "FISH-TACO", name: "Fish tacos (3)", category: "Mains", price: 18.00, cost: 5.50, location_keys: ["restaurant"], taxable: true, active: true },
  { id: "pos_caesar", sku: "CAESAR", name: "Caesar salad", category: "Sides", price: 12.00, cost: 2.80, location_keys: ["restaurant"], taxable: true, active: true },
  { id: "pos_beer_dr", sku: "BEER-DR", name: "Draft beer", category: "Drinks", price: 8.00, cost: 1.40, location_keys: ["restaurant"], taxable: true, active: true },
  { id: "pos_marg", sku: "MARG", name: "Margarita", category: "Drinks", price: 12.00, cost: 2.80, location_keys: ["restaurant"], taxable: true, active: true },
  // Harbormaster
  { id: "pos_pump_out", sku: "PUMP-OUT", name: "Pump-out service", category: "Service", price: 25.00, location_keys: ["harbormaster"], taxable: false, active: true },
  { id: "pos_transient_day", sku: "TRANSIENT-DAY", name: "Transient slip — daily", category: "Service", price: 45.00, location_keys: ["harbormaster"], taxable: false, active: true },
];

// Lakeside POS catalog — a handful of items so the tenant filter
// has something to surface. Same location keys reused; tenant scope
// keeps each marina's items separate even when keys collide.
const LAKESIDE_POS_CATALOG: PosCatalogItem[] = [
  { id: "pos_lks_fuel_gas", tenant_id: SECOND_TENANT_ID, sku: "FUEL-GAS", name: "Gasoline / gal", category: "Fuel", price: 4.69, cost: 3.20, location_keys: ["fuel_dock"], taxable: true, active: true },
  { id: "pos_lks_ice", tenant_id: SECOND_TENANT_ID, sku: "ICE-10", name: "Ice 10lb bag", category: "Provisions", price: 4.00, cost: 1.10, location_keys: ["ship_store"], taxable: false, active: true },
  { id: "pos_lks_sunscrn", tenant_id: SECOND_TENANT_ID, sku: "SUNSCRN", name: "Sunscreen SPF 50", category: "Provisions", price: 11.99, cost: 6.00, location_keys: ["ship_store"], taxable: true, active: true },
];

function attachPosCatalogTenant(p: PosCatalogItem): PosCatalogItem {
  return p.tenant_id ? p : { ...p, tenant_id: SEED_TENANT_ID };
}

export const POS_CATALOG: PosCatalogItem[] = [
  ...BASE_POS_CATALOG,
  ...LAKESIDE_POS_CATALOG,
].map(attachPosCatalogTenant);

const BASE_POS_LOCATIONS: PosLocation[] = [
  { id: "loc_fuel", key: "fuel_dock", name: "Fuel Dock", allows_charge_to_account: true, default_tax_rate: 0.0825, icon_key: "fuel", active: true, sort_order: 0 },
  { id: "loc_store", key: "ship_store", name: "Ship Store", allows_charge_to_account: true, default_tax_rate: 0.0825, icon_key: "shop", active: true, sort_order: 1 },
  { id: "loc_rest", key: "restaurant", name: "Marina Restaurant", allows_charge_to_account: true, default_tax_rate: 0.0825, icon_key: "restaurant", active: true, sort_order: 2 },
  { id: "loc_hm", key: "harbormaster", name: "Harbormaster", allows_charge_to_account: true, default_tax_rate: 0, icon_key: "harbormaster", active: true, sort_order: 3 },
];

// Lakeside runs a smaller POS — just fuel + a small store.
const LAKESIDE_POS_LOCATIONS: PosLocation[] = [
  { id: "loc_lks_fuel", tenant_id: SECOND_TENANT_ID, key: "fuel_dock", name: "Lakeside Fuel", allows_charge_to_account: true, default_tax_rate: 0.06, icon_key: "fuel", active: true, sort_order: 0 },
  { id: "loc_lks_store", tenant_id: SECOND_TENANT_ID, key: "ship_store", name: "Lakeside Store", allows_charge_to_account: true, default_tax_rate: 0.06, icon_key: "shop", active: true, sort_order: 1 },
];

function attachPosLocationTenant(l: PosLocation): PosLocation {
  return l.tenant_id ? l : { ...l, tenant_id: SEED_TENANT_ID };
}

export const POS_LOCATIONS: PosLocation[] = [
  ...BASE_POS_LOCATIONS,
  ...LAKESIDE_POS_LOCATIONS,
].map(attachPosLocationTenant);

const BASE_POS_ORDERS: PosOrder[] = [
  {
    id: "po_001", number: "P-1042", location_id: "loc_fuel", customer_kind: "boater", boater_id: "b_emmons",
    line_items: [{ sku: "FUEL-GAS", name: "Gasoline (38 gal)", qty: 38, unit_price: 4.89, total: 185.82 }],
    subtotal: 185.82, tax: 0, total: 185.82, payment_method: "charge_to_account",
    status: "paid", created_at: "2026-05-23T09:12:00Z", closed_at: "2026-05-23T09:14:00Z",
  },
  {
    id: "po_002", number: "P-1041", location_id: "loc_store", customer_kind: "boater", boater_id: "b_peterson",
    line_items: [
      { sku: "ROPE-50", name: "Dock line 50ft", qty: 2, unit_price: 28.00, total: 56.00 },
      { sku: "FENDER-MED", name: "Boat fender (medium)", qty: 4, unit_price: 18.00, total: 72.00 },
    ],
    subtotal: 128.00, tax: 10.56, total: 138.56, payment_method: "charge_to_account",
    status: "paid", created_at: "2026-05-22T13:08:00Z", closed_at: "2026-05-22T13:10:00Z",
  },
  {
    id: "po_003", number: "P-1040", location_id: "loc_rest", customer_kind: "patron",
    line_items: [
      { sku: "BURGER", name: "Marina burger", qty: 2, unit_price: 16.00, total: 32.00 },
      { sku: "BEER-DRAFT", name: "Draft beer", qty: 2, unit_price: 8.00, total: 16.00 },
    ],
    subtotal: 48.00, tax: 3.96, total: 51.96, payment_method: "card",
    status: "paid", created_at: "2026-05-22T19:45:00Z", closed_at: "2026-05-22T19:47:00Z",
  },
];

function attachPosOrderTenant(o: PosOrder): PosOrder {
  return o.tenant_id ? o : { ...o, tenant_id: SEED_TENANT_ID };
}

export const POS_ORDERS: PosOrder[] = BASE_POS_ORDERS.map(attachPosOrderTenant);

// ─────────────────────────────────────────────────────────────────────────────
// Rental Club seed
//
// A handful of demo members across the three plan tiers so the Members →
// Rental Club module has something to render. Bookings span the next few
// weeks so the booking calendar shows realistic clustering. All boater_id
// references use existing BOATERS so links resolve.
// ─────────────────────────────────────────────────────────────────────────────

// Plan amounts snapshot at signup. Source of truth lives in RATES
// (rate_club_basic / rate_club_plus / rate_club_premium); these
// numbers just preserve what each member was grandfathered into.
const SNAPSHOT = {
  basic:   { monthly_fee: 199, join_fee: 499, days_per_month: 4 },
  plus:    { monthly_fee: 349, join_fee: 999, days_per_month: 8 },
  premium: { monthly_fee: 599, join_fee: 1499, days_per_month: 16 },
} as const;

export const CLUB_SUBSCRIPTIONS: import("./types").ClubSubscription[] = [
  {
    id: "club_001",
    boater_id: "b_jones",
    plan_rate_id: "rate_club_plus",
    joined_at_monthly_fee: SNAPSHOT.plus.monthly_fee,
    joined_at_join_fee: SNAPSHOT.plus.join_fee,
    joined_at_days_per_month: SNAPSHOT.plus.days_per_month,
    status: "active",
    member_since: "2025-04-12",
    next_billing_date: "2026-06-12",
  },
  {
    id: "club_002",
    boater_id: "b_morales",
    plan_rate_id: "rate_club_premium",
    joined_at_monthly_fee: SNAPSHOT.premium.monthly_fee,
    joined_at_join_fee: SNAPSHOT.premium.join_fee,
    joined_at_days_per_month: SNAPSHOT.premium.days_per_month,
    status: "active",
    member_since: "2024-08-03",
    next_billing_date: "2026-06-03",
    notes: "Founding member — comp'd first month every renewal.",
  },
  {
    id: "club_003",
    boater_id: "b_oneill",
    plan_rate_id: "rate_club_basic",
    joined_at_monthly_fee: SNAPSHOT.basic.monthly_fee,
    joined_at_join_fee: SNAPSHOT.basic.join_fee,
    joined_at_days_per_month: SNAPSHOT.basic.days_per_month,
    status: "active",
    member_since: "2026-02-19",
    next_billing_date: "2026-06-19",
  },
  {
    id: "club_004",
    boater_id: "b_singh",
    plan_rate_id: "rate_club_plus",
    joined_at_monthly_fee: SNAPSHOT.plus.monthly_fee,
    joined_at_join_fee: SNAPSHOT.plus.join_fee,
    joined_at_days_per_month: SNAPSHOT.plus.days_per_month,
    status: "past_due",
    member_since: "2025-11-08",
    next_billing_date: "2026-05-08",
    notes: "Card on file expired May 2026. Sent SMS reminder 2026-05-21.",
  },
];

export const CLUB_BOOKINGS: import("./types").ClubBooking[] = [
  // This week
  // One booking on "today" (the seed date used throughout the demo) so
  // the "Today on the water" panel + check-in flow have something to
  // render without the operator needing to add data first.
  { id: "cb_001", subscription_id: "club_001", boater_id: "b_jones",   rental_boat_id: "rb_pontoon_1", date: "2026-05-29", status: "confirmed", created_at: "2026-05-24T10:00:00Z" },
  { id: "cb_002", subscription_id: "club_002", boater_id: "b_morales", rental_boat_id: "rb_pontoon_2", date: "2026-05-30", status: "confirmed", created_at: "2026-05-24T11:15:00Z" },
  { id: "cb_003", subscription_id: "club_002", boater_id: "b_morales", rental_boat_id: "rb_pontoon_2", date: "2026-05-31", status: "confirmed", created_at: "2026-05-24T11:16:00Z" },
  { id: "cb_004", subscription_id: "club_003", boater_id: "b_oneill",  date: "2026-06-01", status: "requested", notes: "Hoping for Pontoon if available.", created_at: "2026-05-28T09:30:00Z" },
  // Next week
  { id: "cb_005", subscription_id: "club_001", boater_id: "b_jones",   rental_boat_id: "rb_pontoon_1", date: "2026-06-06", status: "confirmed", created_at: "2026-05-26T14:00:00Z" },
  { id: "cb_006", subscription_id: "club_002", boater_id: "b_morales", rental_boat_id: "rb_js_a",      date: "2026-06-07", status: "confirmed", created_at: "2026-05-26T14:10:00Z" },
  // Mid-June cluster
  { id: "cb_007", subscription_id: "club_002", boater_id: "b_morales", rental_boat_id: "rb_pontoon_2", date: "2026-06-13", status: "confirmed", created_at: "2026-05-27T08:00:00Z" },
  { id: "cb_008", subscription_id: "club_002", boater_id: "b_morales", rental_boat_id: "rb_pontoon_2", date: "2026-06-14", status: "confirmed", created_at: "2026-05-27T08:00:00Z" },
  { id: "cb_009", subscription_id: "club_001", boater_id: "b_jones",   date: "2026-06-14", status: "requested", notes: "If a jet ski is open.", created_at: "2026-05-28T20:15:00Z" },
  { id: "cb_010", subscription_id: "club_003", boater_id: "b_oneill",  rental_boat_id: "rb_js_b",      date: "2026-06-20", status: "confirmed", created_at: "2026-05-28T12:00:00Z" },
  // Completed (history)
  { id: "cb_011", subscription_id: "club_002", boater_id: "b_morales", rental_boat_id: "rb_pontoon_1", date: "2026-05-23", status: "completed", created_at: "2026-05-18T09:00:00Z" },
  { id: "cb_012", subscription_id: "club_001", boater_id: "b_jones",   rental_boat_id: "rb_pontoon_2", date: "2026-05-16", status: "completed", created_at: "2026-05-10T16:00:00Z" },
];

// ----- Rentals helpers -----

export function getGroup(id: string | undefined) {
  if (!id) return undefined;
  return RENTAL_GROUPS.find((g) => g.id === id);
}

export function getSpacesForGroup(groupId: string) {
  return RENTAL_SPACES.filter((s) => s.group_id === groupId);
}

export function getRatesForOccupancy(t: string) {
  return RATES.filter((r) => r.occupancy_type === t);
}

export function getMeterReadingForSpace(spaceId: string) {
  return METER_READINGS.find((m) => m.space_id === spaceId);
}

export function meterDelta(m: MeterReading) {
  return m.current_reading - m.prev_reading;
}

export function meterAnomaly(m: MeterReading) {
  // Crude: flag when delta > 10 units between consecutive readings
  // (a real impl would compute baseline per-space)
  return meterDelta(m) > 10;
}

export function meterCharge(m: MeterReading) {
  if (!m.rate_per_unit) return 0;
  return meterDelta(m) * m.rate_per_unit;
}

export function fuelPct(inv: FuelInventory) {
  return (inv.current_level_gallons / inv.tank_capacity_gallons) * 100;
}

export function fuelMargin(inv: FuelInventory) {
  return inv.current_price_per_gallon - inv.cost_per_gallon;
}

export function totalOccupancy() {
  const totals = RENTAL_GROUPS.reduce(
    (a, g) => ({ total: a.total + g.total_spaces, occ: a.occ + g.occupied_spaces }),
    { total: 0, occ: 0 }
  );
  return { total: totals.total, occupied: totals.occ, pct: totals.total ? (totals.occ / totals.total) * 100 : 0 };
}

export function initialsOf(name: string) {
  return name
    .replace(/,\s*/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// ═════════════════════════════════════════════════════════════════════
// BACK OFFICE SEEDS — Staffing / Vendor / AP / Inventory / Assets
// ═════════════════════════════════════════════════════════════════════
//
// Small but realistic seeds so every back-office surface lights up on
// load. Each tenant gets its own copy where it makes sense (shifts,
// vendors, bills, assets). Stock movements only seeded for Marina
// Stee's POS items — Lakeside starts with stock_on_hand defaults.

const STAFF_PRIMARY_OWNER_ID = `staff_${SEED_TENANT_ID.slice(-6)}_owner`;
const STAFF_PRIMARY_MANAGER_ID = `staff_${SEED_TENANT_ID.slice(-6)}_manager`;
const STAFF_PRIMARY_DOCK_A_ID = `staff_${SEED_TENANT_ID.slice(-6)}_dock_a`;
const STAFF_PRIMARY_DOCK_B_ID = `staff_${SEED_TENANT_ID.slice(-6)}_dock_b`;
const STAFF_LAKESIDE_ADMIN_ID = `staff_${SECOND_TENANT_ID.slice(-6)}_admin`;

// ── Shifts — schedule snapshot for this week ──────────────────
//
// Two shifts in progress today, two upcoming this week. Times pegged
// to the current date so the dashboard "Staff on duty" KPI is live.

function shiftToday(hour: number, durationHrs: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}
function shiftDayOffset(dayOffset: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export const SHIFTS_SEED: Shift[] = [
  {
    id: "shift_ms_001",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_DOCK_A_ID,
    start_at: shiftToday(6, 0),
    end_at: shiftToday(14, 0),
    position: "Dockhand — morning",
    status: "in_progress",
    created_at: isoOffsetDays(-3),
    updated_at: isoOffsetDays(-3),
  },
  {
    id: "shift_ms_002",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_MANAGER_ID,
    start_at: shiftToday(8, 0),
    end_at: shiftToday(17, 0),
    position: "Harbormaster",
    status: "in_progress",
    created_at: isoOffsetDays(-3),
    updated_at: isoOffsetDays(-3),
  },
  {
    id: "shift_ms_003",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_DOCK_A_ID,
    start_at: shiftDayOffset(1, 6),
    end_at: shiftDayOffset(1, 14),
    position: "Dockhand — morning",
    status: "scheduled",
    created_at: isoOffsetDays(-3),
    updated_at: isoOffsetDays(-3),
  },
  {
    id: "shift_ms_004",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_MANAGER_ID,
    start_at: shiftDayOffset(2, 8),
    end_at: shiftDayOffset(2, 17),
    position: "Harbormaster",
    status: "scheduled",
    created_at: isoOffsetDays(-3),
    updated_at: isoOffsetDays(-3),
  },
  {
    id: "shift_lks_001",
    tenant_id: SECOND_TENANT_ID,
    staff_id: STAFF_LAKESIDE_ADMIN_ID,
    start_at: shiftToday(9, 0),
    end_at: shiftToday(17, 0),
    position: "Owner — full day",
    status: "in_progress",
    created_at: isoOffsetDays(-2),
    updated_at: isoOffsetDays(-2),
  },
];

// ── Time entries — last two weeks for payroll ────────────────
//
// Dock Lead A has approved entries from the last completed pay
// period (already paid) plus an active clock-in for this morning.
// Manager / owner are salaried so their time entries are informational
// only (paystubs come from salary_annual, not hours).

// Payroll period ids referenced from time-entry seeds below. Defined
// before TIME_ENTRIES_SEED so the entries can carry payroll_period_id
// on the locked rows (last cycle).
const PAYROLL_PERIOD_PREVIOUS_ID = "pp_ms_previous_001";
const PAYROLL_PERIOD_CURRENT_ID = "pp_ms_current_001";

export const TIME_ENTRIES_SEED: TimeEntry[] = [
  // ── Current pay period (open) ────────────────────────────────
  // Active clock-in (Dock Lead A is on the clock right now)
  {
    id: "te_ms_active_dock_a",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_DOCK_A_ID,
    clock_in_at: shiftToday(6, 4),
    break_minutes: 0,
    shift_id: "shift_ms_001",
    source: "mobile",
    status: "in_progress",
    payroll_period_id: PAYROLL_PERIOD_CURRENT_ID,
    created_at: shiftToday(6, 4),
  },
  // Dock Lead B — paused for lunch right now
  {
    id: "te_ms_active_dock_b",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_DOCK_B_ID,
    clock_in_at: shiftToday(5, 30),
    paused_at: shiftToday(11, 30),
    pause_seconds_total: 0,
    break_minutes: 0,
    source: "mobile",
    status: "paused",
    position: "Dockhand",
    payroll_period_id: PAYROLL_PERIOD_CURRENT_ID,
    created_at: shiftToday(5, 30),
  },
  // Yesterday — completed + approved (A)
  {
    id: "te_ms_yest_dock_a",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_DOCK_A_ID,
    clock_in_at: shiftDayOffset(-1, 6),
    clock_out_at: shiftDayOffset(-1, 14),
    break_minutes: 30,
    calculated_hours: 7.5,
    approved_at: shiftDayOffset(-1, 18),
    approved_by: STAFF_PRIMARY_MANAGER_ID,
    source: "mobile",
    status: "completed",
    payroll_period_id: PAYROLL_PERIOD_CURRENT_ID,
    created_at: shiftDayOffset(-1, 6),
  },
  // Yesterday — completed (B), included unpaid lunch
  {
    id: "te_ms_yest_dock_b",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_DOCK_B_ID,
    clock_in_at: shiftDayOffset(-1, 6),
    clock_out_at: shiftDayOffset(-1, 15),
    break_minutes: 45,
    calculated_hours: 8.25,
    approved_at: shiftDayOffset(-1, 18),
    approved_by: STAFF_PRIMARY_MANAGER_ID,
    source: "mobile",
    status: "completed",
    payroll_period_id: PAYROLL_PERIOD_CURRENT_ID,
    created_at: shiftDayOffset(-1, 6),
  },
  // 2 days ago (A)
  {
    id: "te_ms_d2",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_DOCK_A_ID,
    clock_in_at: shiftDayOffset(-2, 6),
    clock_out_at: shiftDayOffset(-2, 14),
    break_minutes: 30,
    calculated_hours: 7.5,
    approved_at: shiftDayOffset(-2, 18),
    approved_by: STAFF_PRIMARY_MANAGER_ID,
    source: "mobile",
    status: "completed",
    payroll_period_id: PAYROLL_PERIOD_CURRENT_ID,
    created_at: shiftDayOffset(-2, 6),
  },
  // 2 days ago (B) — adjusted (operator fixed a missed-punch)
  {
    id: "te_ms_d2_b",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_DOCK_B_ID,
    clock_in_at: shiftDayOffset(-2, 6),
    clock_out_at: shiftDayOffset(-2, 14),
    break_minutes: 30,
    calculated_hours: 7.5,
    approved_at: shiftDayOffset(-2, 18),
    approved_by: STAFF_PRIMARY_MANAGER_ID,
    source: "manual",
    status: "adjusted",
    adjusted_by: STAFF_PRIMARY_MANAGER_ID,
    adjusted_at: shiftDayOffset(-2, 17),
    notes: "Fixed missed clock-out — confirmed with staff member.",
    payroll_period_id: PAYROLL_PERIOD_CURRENT_ID,
    created_at: shiftDayOffset(-2, 6),
  },
  {
    id: "te_ms_d3",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_DOCK_A_ID,
    clock_in_at: shiftDayOffset(-3, 6),
    clock_out_at: shiftDayOffset(-3, 14),
    break_minutes: 30,
    calculated_hours: 7.5,
    approved_at: shiftDayOffset(-3, 18),
    approved_by: STAFF_PRIMARY_MANAGER_ID,
    source: "mobile",
    status: "completed",
    payroll_period_id: PAYROLL_PERIOD_CURRENT_ID,
    created_at: shiftDayOffset(-3, 6),
  },
  {
    id: "te_ms_d4_b",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_DOCK_B_ID,
    clock_in_at: shiftDayOffset(-3, 5),
    clock_out_at: shiftDayOffset(-3, 15),
    break_minutes: 30,
    calculated_hours: 9.5,
    approved_at: shiftDayOffset(-3, 18),
    approved_by: STAFF_PRIMARY_MANAGER_ID,
    source: "mobile",
    status: "completed",
    payroll_period_id: PAYROLL_PERIOD_CURRENT_ID,
    created_at: shiftDayOffset(-3, 5),
  },
  // ── Previous pay period (closed) — locked to a payroll run ──
  {
    id: "te_ms_w1_d1",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_DOCK_A_ID,
    clock_in_at: shiftDayOffset(-9, 6),
    clock_out_at: shiftDayOffset(-9, 14),
    break_minutes: 30,
    calculated_hours: 7.5,
    payroll_run_id: "pr_ms_001",
    payroll_period_id: PAYROLL_PERIOD_PREVIOUS_ID,
    approved_at: shiftDayOffset(-9, 18),
    approved_by: STAFF_PRIMARY_MANAGER_ID,
    source: "mobile",
    status: "completed",
    created_at: shiftDayOffset(-9, 6),
  },
  {
    id: "te_ms_w1_d1_b",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_DOCK_B_ID,
    clock_in_at: shiftDayOffset(-9, 6),
    clock_out_at: shiftDayOffset(-9, 14),
    break_minutes: 30,
    calculated_hours: 7.5,
    payroll_run_id: "pr_ms_001",
    payroll_period_id: PAYROLL_PERIOD_PREVIOUS_ID,
    approved_at: shiftDayOffset(-9, 18),
    approved_by: STAFF_PRIMARY_MANAGER_ID,
    source: "mobile",
    status: "completed",
    created_at: shiftDayOffset(-9, 6),
  },
  {
    id: "te_ms_w1_d2",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_DOCK_A_ID,
    clock_in_at: shiftDayOffset(-10, 6),
    clock_out_at: shiftDayOffset(-10, 14),
    break_minutes: 30,
    calculated_hours: 7.5,
    payroll_run_id: "pr_ms_001",
    payroll_period_id: PAYROLL_PERIOD_PREVIOUS_ID,
    approved_at: shiftDayOffset(-10, 18),
    approved_by: STAFF_PRIMARY_MANAGER_ID,
    source: "mobile",
    status: "completed",
    created_at: shiftDayOffset(-10, 6),
  },
  {
    id: "te_ms_w1_d2_b",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_DOCK_B_ID,
    clock_in_at: shiftDayOffset(-11, 5),
    clock_out_at: shiftDayOffset(-11, 16),
    break_minutes: 30,
    calculated_hours: 10.5,
    payroll_run_id: "pr_ms_001",
    payroll_period_id: PAYROLL_PERIOD_PREVIOUS_ID,
    approved_at: shiftDayOffset(-11, 18),
    approved_by: STAFF_PRIMARY_MANAGER_ID,
    source: "mobile",
    status: "completed",
    created_at: shiftDayOffset(-11, 5),
  },
];

// ── Payroll periods — running window operators close + roll up ──
//
// One open period covering the current biweekly cycle (running total
// + projected gross), and one closed period for the prior cycle. The
// closed one mirrors PAYROLL_RUNS_SEED → "pr_ms_001" so the link is
// visible in the Payroll sub-tab's "Past periods" table.

export const PAYROLL_PERIODS_SEED: PayrollPeriod[] = [
  {
    id: PAYROLL_PERIOD_PREVIOUS_ID,
    tenant_id: SEED_TENANT_ID,
    start_date: isoOffsetDays(-21).slice(0, 10),
    end_date: isoOffsetDays(-8).slice(0, 10),
    status: "paid",
    closed_by: STAFF_PRIMARY_MANAGER_ID,
    closed_at: isoOffsetDays(-7),
    paid_at: isoOffsetDays(-5),
    total_gross: 4_125,
    total_hours: 187.5,
    payroll_run_id: "pr_ms_001",
    created_at: isoOffsetDays(-21),
  },
  {
    id: PAYROLL_PERIOD_CURRENT_ID,
    tenant_id: SEED_TENANT_ID,
    start_date: isoOffsetDays(-7).slice(0, 10),
    end_date: isoOffsetDays(6).slice(0, 10),
    status: "open",
    created_at: isoOffsetDays(-7),
  },
];

// ── Payroll runs + paystubs ──────────────────────────────────
//
// One posted run from the previous biweekly cycle so the Payroll page
// has history. v1 doesn't run withholding math — fed/state/FICA are
// all stub zeros; net == gross. Net flips real when v2 lands.

export const PAYROLL_RUNS_SEED: PayrollRun[] = [
  {
    id: "pr_ms_001",
    tenant_id: SEED_TENANT_ID,
    period_start: isoOffsetDays(-21).slice(0, 10),
    period_end: isoOffsetDays(-8).slice(0, 10),
    pay_date: isoOffsetDays(-5).slice(0, 10),
    status: "posted",
    total_gross: 4_125,
    total_net: 4_125,
    total_employer_taxes: 0,
    gl_account: "Payroll Expense",
    qb_sync_status: "synced",
    qb_synced_at: isoOffsetDays(-5),
    created_at: isoOffsetDays(-7),
    posted_at: isoOffsetDays(-5),
  },
];

export const PAYSTUBS_SEED: Paystub[] = [
  {
    id: "ps_ms_001_owner",
    tenant_id: SEED_TENANT_ID,
    payroll_run_id: "pr_ms_001",
    staff_id: STAFF_PRIMARY_OWNER_ID,
    hours_regular: 0,
    hours_ot: 0,
    hours_pto: 0,
    gross: 95_000 / 26,
    fed_withholding: 0,
    state_withholding: 0,
    fica_employee: 0,
    fica_employer: 0,
    net: 95_000 / 26,
    employment_type_snapshot: "w2",
    created_at: isoOffsetDays(-5),
  },
  {
    id: "ps_ms_001_manager",
    tenant_id: SEED_TENANT_ID,
    payroll_run_id: "pr_ms_001",
    staff_id: STAFF_PRIMARY_MANAGER_ID,
    hours_regular: 0,
    hours_ot: 0,
    hours_pto: 0,
    gross: 68_000 / 26,
    fed_withholding: 0,
    state_withholding: 0,
    fica_employee: 0,
    fica_employer: 0,
    net: 68_000 / 26,
    employment_type_snapshot: "w2",
    created_at: isoOffsetDays(-5),
  },
  {
    id: "ps_ms_001_dock_a",
    tenant_id: SEED_TENANT_ID,
    payroll_run_id: "pr_ms_001",
    staff_id: STAFF_PRIMARY_DOCK_A_ID,
    hours_regular: 75,   // 5 days × 7.5 × 2 weeks = 75 (one week paid in this run for the seed)
    hours_ot: 0,
    hours_pto: 0,
    gross: 75 * 22,
    fed_withholding: 0,
    state_withholding: 0,
    fica_employee: 0,
    fica_employer: 0,
    net: 75 * 22,
    employment_type_snapshot: "w2",
    created_at: isoOffsetDays(-5),
  },
];

// ── Certifications — a couple expiring soon ──────────────────

export const CERTIFICATIONS_SEED: Certification[] = [
  {
    id: "cert_ms_001",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_DOCK_A_ID,
    name: "First Aid / CPR",
    issuer: "American Red Cross",
    issued_at: "2024-06-15",
    expires_at: isoOffsetDays(45).slice(0, 10),
    notes: "Required for marina dockhands.",
  },
  {
    id: "cert_ms_002",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_MANAGER_ID,
    name: "Marine Safety Cert",
    issuer: "New Mexico State Parks",
    issued_at: "2025-02-10",
    expires_at: "2027-02-10",
  },
  {
    id: "cert_ms_003",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_DOCK_A_ID,
    name: "Forklift Operator",
    issuer: "OSHA",
    issued_at: "2024-04-01",
    expires_at: isoOffsetDays(20).slice(0, 10),   // expiring soon → dashboard alert
    notes: "Annual recert required.",
  },
];

// ── PTO requests ─────────────────────────────────────────────

export const PTO_REQUESTS_SEED: PtoRequest[] = [
  {
    id: "pto_ms_001",
    tenant_id: SEED_TENANT_ID,
    staff_id: STAFF_PRIMARY_DOCK_A_ID,
    start_at: isoOffsetDays(14).slice(0, 10),
    end_at: isoOffsetDays(16).slice(0, 10),
    hours: 24,
    reason: "Family visit",
    status: "pending",
    created_at: isoOffsetDays(-2),
  },
];

// ── Vendors — primary + Lakeside ─────────────────────────────

export const VENDORS_SEED: Vendor[] = [
  {
    id: `vend_${SEED_TENANT_ID.slice(-6)}_pinon`,
    tenant_id: SEED_TENANT_ID,
    name: "Pinon Petroleum LLC",
    display_name: "Pinon Petroleum",
    contact_name: "Carlos Reyes",
    email: "carlos@pinonpetro.example",
    phone: "(505) 555-2040",
    address_line1: "1801 Industrial Pkwy",
    city: "Albuquerque",
    state: "NM",
    postal_code: "87107",
    country: "US",
    payment_terms: "net_30",
    default_gl_account: "Fuel — Cost of Goods",
    tax_id_last4: "9821",
    issue_1099: false,
    active: true,
    created_at: "2024-05-01T08:00:00Z",
  },
  {
    id: `vend_${SEED_TENANT_ID.slice(-6)}_lift_works`,
    tenant_id: SEED_TENANT_ID,
    name: "LiftWorks Hoist Service",
    display_name: "LiftWorks",
    contact_name: "Pat Mendoza",
    email: "pat@liftworks.example",
    phone: "(505) 555-3120",
    payment_terms: "net_15",
    default_gl_account: "Repair & Maintenance",
    tax_id_last4: "4412",
    issue_1099: true,
    active: true,
    created_at: "2024-07-10T08:00:00Z",
  },
  {
    id: `vend_${SEED_TENANT_ID.slice(-6)}_marine_supply`,
    tenant_id: SEED_TENANT_ID,
    name: "Sandia Marine Supply Co.",
    display_name: "Sandia Marine",
    contact_name: "Erika Tom",
    email: "orders@sandiamarine.example",
    phone: "(505) 555-7700",
    payment_terms: "net_30",
    default_gl_account: "Ship Store — Cost of Goods",
    issue_1099: false,
    active: true,
    created_at: "2024-04-12T08:00:00Z",
  },
  {
    id: `vend_${SEED_TENANT_ID.slice(-6)}_red_cross`,
    tenant_id: SEED_TENANT_ID,
    name: "American Red Cross",
    payment_terms: "due_on_receipt",
    default_gl_account: "Training & Certifications",
    issue_1099: false,
    active: true,
    created_at: "2024-02-01T08:00:00Z",
  },
  {
    id: `vend_${SECOND_TENANT_ID.slice(-6)}_loon_fuel`,
    tenant_id: SECOND_TENANT_ID,
    name: "Loon Fuel & Lubricants",
    display_name: "Loon Fuel",
    contact_name: "Sarah Whitlock",
    email: "sarah@loonfuel.example",
    payment_terms: "net_30",
    default_gl_account: "Fuel — Cost of Goods",
    issue_1099: false,
    active: true,
    created_at: "2026-03-20T08:00:00Z",
  },
];

// ── Bills — AP aging seeded across buckets ──────────────────

export const BILLS_SEED: Bill[] = [
  // Past due — gas delivery from last cycle
  {
    id: "bill_ms_001",
    tenant_id: SEED_TENANT_ID,
    vendor_id: `vend_${SEED_TENANT_ID.slice(-6)}_pinon`,
    number: "PP-19421",
    bill_date: isoOffsetDays(-38).slice(0, 10),
    due_date: isoOffsetDays(-8).slice(0, 10),
    amount: 8_275,
    amount_paid: 0,
    status: "open",
    line_items: [
      {
        description: "Gasoline delivery — 2,500 gal @ $3.31",
        amount: 8_275,
        gl_account: "Fuel — Cost of Goods",
      },
    ],
    qb_sync_status: "pending",
    created_at: isoOffsetDays(-38),
  },
  // Due in 5 days
  {
    id: "bill_ms_002",
    tenant_id: SEED_TENANT_ID,
    vendor_id: `vend_${SEED_TENANT_ID.slice(-6)}_lift_works`,
    number: "LW-2026-04",
    bill_date: isoOffsetDays(-10).slice(0, 10),
    due_date: isoOffsetDays(5).slice(0, 10),
    amount: 1_240,
    amount_paid: 0,
    status: "open",
    line_items: [
      {
        description: "Annual hoist inspection + parts",
        amount: 1_240,
        gl_account: "Repair & Maintenance",
      },
    ],
    qb_sync_status: "pending",
    created_at: isoOffsetDays(-10),
  },
  // Paid last week — ship store restock
  {
    id: "bill_ms_003",
    tenant_id: SEED_TENANT_ID,
    vendor_id: `vend_${SEED_TENANT_ID.slice(-6)}_marine_supply`,
    number: "SMS-99812",
    bill_date: isoOffsetDays(-20).slice(0, 10),
    due_date: isoOffsetDays(10).slice(0, 10),
    amount: 642.5,
    amount_paid: 642.5,
    status: "paid",
    line_items: [
      {
        description: "Dock lines + fenders restock",
        amount: 480,
        gl_account: "Ship Store — Cost of Goods",
      },
      {
        description: "Sunscreen + sundries case",
        amount: 162.5,
        gl_account: "Ship Store — Cost of Goods",
      },
    ],
    qb_sync_status: "synced",
    qb_synced_at: isoOffsetDays(-3),
    created_at: isoOffsetDays(-20),
  },
  // Lakeside — open bill
  {
    id: "bill_lks_001",
    tenant_id: SECOND_TENANT_ID,
    vendor_id: `vend_${SECOND_TENANT_ID.slice(-6)}_loon_fuel`,
    number: "LF-0118",
    bill_date: isoOffsetDays(-12).slice(0, 10),
    due_date: isoOffsetDays(18).slice(0, 10),
    amount: 2_580,
    amount_paid: 0,
    status: "open",
    line_items: [
      {
        description: "Gasoline delivery — 800 gal @ $3.22",
        amount: 2_576,
        gl_account: "Fuel — Cost of Goods",
      },
    ],
    qb_sync_status: "pending",
    created_at: isoOffsetDays(-12),
  },
];

export const BILL_PAYMENTS_SEED: BillPayment[] = [
  {
    id: "bp_ms_001",
    tenant_id: SEED_TENANT_ID,
    bill_id: "bill_ms_003",
    vendor_id: `vend_${SEED_TENANT_ID.slice(-6)}_marine_supply`,
    paid_at: isoOffsetDays(-3),
    amount: 642.5,
    method: "ach",
    processor_ref: "ACH-SMS-99812",
    gl_account: "Cash / Operating",
    created_at: isoOffsetDays(-3),
  },
];

// ── Vendor Bills (operator AP workflow) ─────────────────────
//
// Six fixtures across the lifecycle so the new Bills sub-tab on
// /vendors has something to demo before any operator activity:
//   1 draft      — vendor invoice captured but amount missing
//   2 pending    — sitting in approval queue
//   1 approved   — out of queue, awaiting schedule
//   1 scheduled  — payment date + method on the books
//   1 paid       — already settled (LedgerEntry back-ref stamped)
//   1 disputed   — blocked from payment until resolved

export const VENDOR_BILLS_SEED: VendorBill[] = [
  // Draft — operator captured the vendor + dates but hasn't keyed the
  // amount yet (vendor PDF is fuzzy and they need to call to confirm).
  {
    id: "vbill_ms_001",
    tenant_id: SEED_TENANT_ID,
    number: "BIL-0001",
    vendor_id: `vend_${SEED_TENANT_ID.slice(-6)}_marine_supply`,
    vendor_invoice_number: "SMS-DRAFT-2104",
    status: "draft",
    bill_date: isoOffsetDays(-2).slice(0, 10),
    due_date: isoOffsetDays(28).slice(0, 10),
    amount: 0,
    description: "Replacement dock cleats — invoice received, amount TBD",
    internal_notes: "Erika texted the PDF; numbers don't tie. Calling 6/4.",
    created_at: isoOffsetDays(-2),
    created_by: "u_steven",
  },
  // Pending approval — fuel delivery from yesterday
  {
    id: "vbill_ms_002",
    tenant_id: SEED_TENANT_ID,
    number: "BIL-0002",
    vendor_id: `vend_${SEED_TENANT_ID.slice(-6)}_pinon`,
    vendor_invoice_number: "PP-21044",
    status: "pending_approval",
    bill_date: isoOffsetDays(-1).slice(0, 10),
    due_date: isoOffsetDays(29).slice(0, 10),
    amount: 4_215.5,
    subtotal: 4_215.5,
    description: "Gasoline delivery — 1,275 gal @ $3.31",
    line_items: [
      {
        description: "Gasoline delivery — 1,275 gal @ $3.31",
        amount: 4_215.5,
        gl_account: "Fuel — Cost of Goods",
      },
    ],
    created_at: isoOffsetDays(-1),
    created_by: "u_steven",
  },
  // Pending approval — hoist parts, smaller amount
  {
    id: "vbill_ms_003",
    tenant_id: SEED_TENANT_ID,
    number: "BIL-0003",
    vendor_id: `vend_${SEED_TENANT_ID.slice(-6)}_lift_works`,
    vendor_invoice_number: "LW-2026-08",
    status: "pending_approval",
    bill_date: isoOffsetDays(-3).slice(0, 10),
    due_date: isoOffsetDays(12).slice(0, 10),
    amount: 868.0,
    subtotal: 805.0,
    tax_amount: 63.0,
    description: "Hoist cable + safety inspection",
    line_items: [
      { description: "Hoist cable replacement (parts)", amount: 540, gl_account: "Repair & Maintenance" },
      { description: "Annual safety inspection (labor)", amount: 265, gl_account: "Repair & Maintenance" },
    ],
    created_at: isoOffsetDays(-3),
    created_by: "u_steven",
  },
  // Approved + scheduled — Sandia Marine catalog restock
  {
    id: "vbill_ms_004",
    tenant_id: SEED_TENANT_ID,
    number: "BIL-0004",
    vendor_id: `vend_${SEED_TENANT_ID.slice(-6)}_marine_supply`,
    vendor_invoice_number: "SMS-99918",
    status: "scheduled",
    bill_date: isoOffsetDays(-7).slice(0, 10),
    due_date: isoOffsetDays(23).slice(0, 10),
    amount: 1_287.25,
    subtotal: 1_287.25,
    description: "Ship store restock — Q2 lines",
    line_items: [
      { description: "Dock lines (200 ft drums × 4)", amount: 720, gl_account: "Ship Store — Cost of Goods" },
      { description: "Sundries case + sunscreen", amount: 247.25, gl_account: "Ship Store — Cost of Goods" },
      { description: "Cleats + galvanized chain", amount: 320, gl_account: "Ship Store — Cost of Goods" },
    ],
    approved_by: "u_steven",
    approved_at: isoOffsetDays(-5),
    scheduled_payment_date: isoOffsetDays(20).slice(0, 10),
    scheduled_payment_method: "ach",
    created_at: isoOffsetDays(-7),
    created_by: "u_steven",
  },
  // Paid — Red Cross CPR re-cert (vendor invoice fully settled)
  {
    id: "vbill_ms_005",
    tenant_id: SEED_TENANT_ID,
    number: "BIL-0005",
    vendor_id: `vend_${SEED_TENANT_ID.slice(-6)}_red_cross`,
    vendor_invoice_number: "ARC-CRT-44120",
    status: "paid",
    bill_date: isoOffsetDays(-21).slice(0, 10),
    due_date: isoOffsetDays(-21).slice(0, 10),
    amount: 425,
    description: "CPR + first aid recertification — 5 staff",
    line_items: [
      { description: "CPR + first aid recert — 5 seats", amount: 425, gl_account: "Training & Certifications" },
    ],
    approved_by: "u_steven",
    approved_at: isoOffsetDays(-20),
    scheduled_payment_date: isoOffsetDays(-20).slice(0, 10),
    scheduled_payment_method: "card",
    paid_at: isoOffsetDays(-20),
    paid_via: "Visa ending 4421",
    created_at: isoOffsetDays(-21),
    created_by: "u_steven",
  },
  // Disputed — LiftWorks duplicate billing (blocked from payment)
  {
    id: "vbill_ms_006",
    tenant_id: SEED_TENANT_ID,
    number: "BIL-0006",
    vendor_id: `vend_${SEED_TENANT_ID.slice(-6)}_lift_works`,
    vendor_invoice_number: "LW-2026-05",
    status: "disputed",
    bill_date: isoOffsetDays(-15).slice(0, 10),
    due_date: isoOffsetDays(0).slice(0, 10),
    amount: 1_240,
    description: "Annual hoist inspection (DUPLICATE — already on LW-2026-04)",
    dispute_reason: "Duplicate billing — work already invoiced on LW-2026-04 and paid 5/22. Awaiting credit memo from Pat.",
    internal_notes: "Pat acknowledged via phone 5/30; said credit memo would issue this week.",
    created_at: isoOffsetDays(-15),
    created_by: "u_steven",
  },
];

// ── Inbound emails (AP-bill ingest provenance) ─────────────────
//
// One row per email Postmark forwarded into the AP inbox. Three
// fixtures cover the three terminal states:
//   1. created_draft  — happy path; PDF parsed, vendor matched, draft
//                       bill posted to the approval queue. Connected to
//                       BIL-0002 (Pinon Petroleum gas delivery).
//   2. ingested       — vendor sent a "thank you for your business"
//                       email with no PDF attachment. Logged but no
//                       draft created.
//   3. failed         — extraction returned a stub for an image-only
//                       PDF; operator needs to hand-key. error_reason
//                       carries the code surfaced in the feed UI.

export const INBOUND_EMAILS_SEED: InboundEmail[] = [
  // Happy path — backs the seeded BIL-0002 pending approval.
  {
    id: "iemail_ms_001",
    tenant_id: SEED_TENANT_ID,
    postmark_message_id: "pmk-msg-7b3f9a-pinon-21044",
    from_email: "carlos@pinonpetro.example",
    from_name: "Carlos Reyes",
    subject: "Invoice PP-21044 — Gasoline delivery 1,275 gal",
    received_at: isoOffsetDays(-1),
    vendor_id: `vend_${SEED_TENANT_ID.slice(-6)}_pinon`,
    vendor_bill_id: "vbill_ms_002",
    status: "created_draft",
  },
  // No PDF attached — operator note from a vendor.
  {
    id: "iemail_ms_002",
    tenant_id: SEED_TENANT_ID,
    postmark_message_id: "pmk-msg-4c2e1d-marine-restock",
    from_email: "orders@sandiamarine.example",
    from_name: "Erika Tom",
    subject: "Heads up — restock arriving Tuesday (no invoice yet)",
    received_at: isoOffsetDays(-2),
    status: "ingested",
  },
  // Failed extraction — image-only scan from LiftWorks.
  {
    id: "iemail_ms_003",
    tenant_id: SEED_TENANT_ID,
    postmark_message_id: "pmk-msg-9f1a8c-liftworks-scan",
    from_email: "pat@liftworks.example",
    from_name: "Pat Mendoza",
    subject: "Hoist inspection invoice — see attached scan",
    received_at: isoOffsetDays(-3),
    vendor_id: `vend_${SEED_TENANT_ID.slice(-6)}_lift_works`,
    status: "failed",
    error_reason: "extraction_failed",
  },
];

// ── Stock movements — for the 2 catalog items we now track ──
//
// Receive event 2 weeks ago + a couple of sales decrements since.
// Stock fields on PosCatalogItem itself are seeded via the attach
// helper below so we don't have to hand-edit every line.

export const STOCK_MOVEMENTS_SEED: StockMovement[] = [
  {
    id: "sm_ms_001",
    tenant_id: SEED_TENANT_ID,
    item_id: "pos_rope_50",
    delta: 24,
    kind: "receive",
    reference_id: "bill_ms_003",
    occurred_at: isoOffsetDays(-20),
    created_at: isoOffsetDays(-20),
  },
  {
    id: "sm_ms_002",
    tenant_id: SEED_TENANT_ID,
    item_id: "pos_fender_m",
    delta: 18,
    kind: "receive",
    reference_id: "bill_ms_003",
    occurred_at: isoOffsetDays(-20),
    created_at: isoOffsetDays(-20),
  },
  {
    id: "sm_ms_003",
    tenant_id: SEED_TENANT_ID,
    item_id: "pos_rope_50",
    delta: -2,
    kind: "sale",
    reference_id: "po_002",
    occurred_at: "2026-05-22T13:08:00Z",
    created_at: "2026-05-22T13:08:00Z",
  },
  {
    id: "sm_ms_004",
    tenant_id: SEED_TENANT_ID,
    item_id: "pos_fender_m",
    delta: -4,
    kind: "sale",
    reference_id: "po_002",
    occurred_at: "2026-05-22T13:08:00Z",
    created_at: "2026-05-22T13:08:00Z",
  },
];

// ── Marina assets ──────────────────────────────────────────

export const MARINA_ASSETS_SEED: MarinaAsset[] = [
  {
    id: "asset_ms_hoist_a",
    tenant_id: SEED_TENANT_ID,
    name: "Boat hoist A — 30 ton",
    kind: "hoist",
    serial_number: "MAR-HOIST-A-2018-3318",
    model: "Marina-Tek MH30",
    manufacturer: "Marina-Tek",
    purchase_date: "2018-04-15",
    purchase_price: 84_000,
    warranty_until: "2023-04-15",
    location: "Hoist bay — A side",
    status: "active",
    service_vendor_id: `vend_${SEED_TENANT_ID.slice(-6)}_lift_works`,
    notes: "Annual inspection by LiftWorks every spring.",
    created_at: "2018-04-15T08:00:00Z",
    updated_at: isoOffsetDays(-10),
  },
  {
    id: "asset_ms_forklift_1",
    tenant_id: SEED_TENANT_ID,
    name: "Forklift — Toyota 7FBCU25 #1",
    kind: "forklift",
    serial_number: "7FBCU25-44218",
    model: "7FBCU25",
    manufacturer: "Toyota",
    purchase_date: "2021-08-02",
    purchase_price: 28_500,
    warranty_until: "2024-08-02",
    location: "Dry storage row B",
    status: "active",
    notes: "Daily check before use.",
    created_at: "2021-08-02T08:00:00Z",
    updated_at: isoOffsetDays(-30),
  },
  {
    id: "asset_ms_pump_out",
    tenant_id: SEED_TENANT_ID,
    name: "Pump-out station — Dock C",
    kind: "pump_out_station",
    serial_number: "PO-DC-2020",
    model: "MarineSan 500",
    manufacturer: "MarineSan",
    purchase_date: "2020-05-20",
    location: "Dock C — Slip C20",
    status: "active",
    created_at: "2020-05-20T08:00:00Z",
    updated_at: isoOffsetDays(-90),
  },
  {
    id: "asset_lks_pump_out",
    tenant_id: SECOND_TENANT_ID,
    name: "Pump-out station — main",
    kind: "pump_out_station",
    serial_number: "PO-LKS-2024",
    purchase_date: "2024-04-10",
    location: "Main dock",
    status: "active",
    created_at: "2024-04-10T08:00:00Z",
    updated_at: isoOffsetDays(-15),
  },
];

// ── PM schedules — annual hoist inspection due soon ───────

export const PM_SCHEDULES_SEED: PmSchedule[] = [
  {
    id: "pm_ms_hoist_a_annual",
    tenant_id: SEED_TENANT_ID,
    asset_id: "asset_ms_hoist_a",
    name: "Annual safety inspection",
    description: "Full load test + cable inspection by LiftWorks.",
    cadence: "annual",
    next_due_at: isoOffsetDays(12).slice(0, 10),    // within auto-create window
    last_completed_at: isoOffsetDays(-353).slice(0, 10),
    auto_create_wo_days_ahead: 14,
    active: true,
    created_at: "2018-04-15T08:00:00Z",
  },
  {
    id: "pm_ms_forklift_quarterly",
    tenant_id: SEED_TENANT_ID,
    asset_id: "asset_ms_forklift_1",
    name: "Quarterly service",
    description: "Oil change + brake check + fluid top-off.",
    cadence: "quarterly",
    next_due_at: isoOffsetDays(45).slice(0, 10),
    last_completed_at: isoOffsetDays(-45).slice(0, 10),
    auto_create_wo_days_ahead: 14,
    active: true,
    created_at: "2021-08-02T08:00:00Z",
  },
  {
    id: "pm_ms_pump_out_monthly",
    tenant_id: SEED_TENANT_ID,
    asset_id: "asset_ms_pump_out",
    name: "Monthly check + tank pump-down",
    cadence: "monthly",
    next_due_at: isoOffsetDays(8).slice(0, 10),
    last_completed_at: isoOffsetDays(-22).slice(0, 10),
    auto_create_wo_days_ahead: 7,
    active: true,
    created_at: "2020-05-20T08:00:00Z",
  },
  {
    id: "pm_lks_pump_out",
    tenant_id: SECOND_TENANT_ID,
    asset_id: "asset_lks_pump_out",
    name: "Monthly check",
    cadence: "monthly",
    next_due_at: isoOffsetDays(20).slice(0, 10),
    auto_create_wo_days_ahead: 7,
    active: true,
    created_at: "2024-04-10T08:00:00Z",
  },
];

// ============================================================
// AI-first foundation — TenantAiSettings + Attachment + ExtractionDraft
// ============================================================
//
// Per-tenant config drives every AI behavior. Lakeside intentionally
// starts with fewer features enabled to show that the same product
// works at different adoption levels — new marinas onboard via
// /onboarding which flips these flags as the operator completes steps.

const _onboardedSteps: OnboardingStepKey[] = [
  "marina_profile",
  "chart_of_accounts",
  "bills_inbox",
  "auto_approve_threshold",
  "vendor_seed",
  "staff_seed",
  "velocity_reorder",
  "voice_input",
  "first_drop",
];

export const TENANT_AI_SETTINGS_SEED: TenantAiSettings[] = [
  {
    tenant_id: SEED_TENANT_ID,
    bills_inbox_enabled: true,
    bills_email_address: "bills+marina-stee@marinastee.app",
    bills_auto_approve_enabled: true,
    bills_auto_approve_threshold_cents: 50000, // $500
    bills_auto_approve_requires_familiar_vendor: true,
    vendors_auto_create_from_invoice: true,
    staff_onboarding_doc_intake_enabled: true,
    timecard_anomalies_only: true,
    timecard_max_shift_hours: 12,
    timecard_require_break_after_hours: 6,
    timecard_ot_threshold_hours_per_period: 80,
    certs_photo_intake_enabled: true,
    certs_nudge_days_before_expiration: [30, 14, 7],
    inventory_velocity_reorder_enabled: true,
    inventory_reorder_lead_time_days: 5,
    inventory_velocity_window_days: 30,
    assets_pm_auto_derive_from_manual: true,
    dock_voice_input_enabled: true,
    onboarding_completed_steps: _onboardedSteps,
    onboarding_dismissed: false,
  },
  {
    // Lakeside: brand new marina mid-onboarding. Most features off
    // so we can demo the /onboarding flow lighting them up one by one.
    tenant_id: SECOND_TENANT_ID,
    bills_inbox_enabled: false,
    bills_email_address: undefined,
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
    onboarding_completed_steps: ["marina_profile"],
    onboarding_dismissed: false,
  },
];

/**
 * Attachments start empty — every entry is created at runtime when an
 * operator drops a doc. Seeded empty across both tenants.
 */
export const ATTACHMENTS_SEED: Attachment[] = [];

/**
 * Extraction drafts likewise start empty. The first one appears when
 * a doc is dropped on a back-office page.
 */
export const EXTRACTION_DRAFTS_SEED: ExtractionDraft[] = [];

// ═════════════════════════════════════════════════════════════════════
// Support tickets (Marina Stee carve-out — see ../CLAUDE.md §5)
// ═════════════════════════════════════════════════════════════════════
//
// Three seed tickets so the My Tickets tab has something to render in
// mock mode: one open (awaiting marina), one resolved (full thread),
// one cancelled (history preserved per cancel-not-delete rule).

export const SUPPORT_TICKETS_SEED: import("./types").SupportTicket[] = [
  {
    id: "ticket_st_001",
    tenant_id: SEED_TENANT_ID,
    reference: "ST-001",
    boater_id: "b_jones",
    subject: "Pump-out reservation didn't confirm",
    description:
      "I booked a pump-out for Saturday 10am through the portal but never got a confirmation email. Want to make sure it's actually on the schedule before I head down.",
    type: "bug",
    priority: "normal",
    page_or_area: "Portal · Services",
    steps_to_reproduce:
      "1. Open portal · 2. Tap Services · 3. Schedule pump-out for Saturday · 4. Wait — no email arrives.",
    attachments: [],
    messages: [
      {
        id: "msg_st1_a",
        author_kind: "system",
        author_label: "Marina Stee",
        body: "Ticket ST-001 received. The marina will reply here as soon as they can.",
        created_at: "2026-06-01T14:22:00Z",
      },
      {
        id: "msg_st1_b",
        author_kind: "boater",
        author_label: "Jordan Jones",
        body: "Just checking in — still nothing in my inbox. Slip B-12 if it helps.",
        created_at: "2026-06-02T08:10:00Z",
      },
    ],
    status: "open",
    context: {
      submitted_from_url: "/portal/jonesjm-7q3",
      app_version: "0.2.0",
    },
    created_at: "2026-06-01T14:22:00Z",
    updated_at: "2026-06-02T08:10:00Z",
  },
  {
    id: "ticket_st_002",
    tenant_id: SEED_TENANT_ID,
    reference: "ST-002",
    boater_id: "b_morales",
    subject: "Can I get a copy of my 2025 invoices?",
    description:
      "Need 2025 invoices for tax prep — would love a single PDF if possible.",
    type: "question",
    priority: "low",
    page_or_area: "Portal · Ledger",
    attachments: [],
    messages: [
      {
        id: "msg_st2_a",
        author_kind: "system",
        author_label: "Marina Stee",
        body: "Ticket ST-002 received. The marina will reply here as soon as they can.",
        created_at: "2026-05-18T09:00:00Z",
      },
      {
        id: "msg_st2_b",
        author_kind: "staff",
        author_label: "Riley · Marina Stee",
        body: "Bundled the year into a single PDF — sent to the email on file. Let me know if anything looks off.",
        created_at: "2026-05-18T11:42:00Z",
      },
      {
        id: "msg_st2_c",
        author_kind: "boater",
        author_label: "Casey Morales",
        body: "Got it, thanks!",
        created_at: "2026-05-18T13:05:00Z",
      },
      {
        id: "msg_st2_d",
        author_kind: "staff",
        author_label: "Riley · Marina Stee",
        body: "Marking this resolved. Holler if you need anything else.",
        created_at: "2026-05-18T13:30:00Z",
      },
    ],
    status: "resolved",
    context: {
      submitted_from_url: "/portal/moralesc-2z9",
      app_version: "0.1.9",
    },
    created_at: "2026-05-18T09:00:00Z",
    updated_at: "2026-05-18T13:30:00Z",
    closed_at: "2026-05-18T13:30:00Z",
  },
  {
    id: "ticket_st_003",
    tenant_id: SEED_TENANT_ID,
    reference: "ST-003",
    boater_id: "b_oneill",
    subject: "Want to add my brother to the account",
    description:
      "Hey — would like to add my brother as an additional contact so he can book club days too.",
    type: "feature_request",
    priority: "low",
    page_or_area: "Portal · Account",
    attachments: [],
    messages: [
      {
        id: "msg_st3_a",
        author_kind: "system",
        author_label: "Marina Stee",
        body: "Ticket ST-003 received. The marina will reply here as soon as they can.",
        created_at: "2026-04-22T19:08:00Z",
      },
      {
        id: "msg_st3_b",
        author_kind: "system",
        author_label: "Marina Stee",
        body: "Ticket cancelled by Skyler O'Neill. Reason: figured it out via the agent — added him myself.",
        created_at: "2026-04-22T19:31:00Z",
      },
    ],
    status: "cancelled",
    context: {
      submitted_from_url: "/portal/oneills-4k1",
      app_version: "0.1.9",
    },
    created_at: "2026-04-22T19:08:00Z",
    updated_at: "2026-04-22T19:31:00Z",
    closed_at: "2026-04-22T19:31:00Z",
  },
];

// ============================================================
// Boater applications — public self-onboarding queue seeds
// ============================================================
//
// 5 applications across statuses so the operator queue at
// /members → Applications and the boater status page at /apply/[token]
// both have realistic fixtures out of the box.

export const APPLICATIONS_SEED: Application[] = [
  {
    id: "app_pending_torres",
    tenant_id: SEED_TENANT_ID,
    number: "APP-1001",
    status: "pending",
    applicant_first_name: "Maya",
    applicant_last_name: "Torres",
    applicant_email: "maya.torres@example.com",
    applicant_phone: "(415) 555-0142",
    applicant_address: "1840 Bay St, Sausalito, CA 94965",
    vessel_name: "Tradewinds",
    vessel_year: 2019,
    vessel_make: "Beneteau",
    vessel_model: "Oceanis 38.1",
    vessel_loa_inches: 38 * 12,
    vessel_beam_inches: 13 * 12,
    vessel_draft_inches: 6 * 12 + 3,
    preferred_slip_class: "uncovered",
    preferred_dock: "Damsite A Dock",
    desired_start_date: "2026-07-01",
    source: "public_apply",
    application_token: "app_demo_torres_pending",
    notes:
      "Hoping to move from a mooring out east — want power + water if possible.",
    submitted_at: "2026-06-02T14:22:00Z",
  },
  {
    id: "app_review_haynes",
    tenant_id: SEED_TENANT_ID,
    number: "APP-1002",
    status: "under_review",
    applicant_first_name: "Drew",
    applicant_last_name: "Haynes",
    applicant_email: "dhaynes@example.com",
    applicant_phone: "(510) 555-0163",
    vessel_name: "Quicksilver",
    vessel_year: 2022,
    vessel_make: "Sea Ray",
    vessel_model: "SLX 280",
    vessel_loa_inches: 28 * 12,
    vessel_beam_inches: 8 * 12 + 6,
    preferred_slip_class: "covered",
    preferred_dock: "Damsite B Dock",
    desired_start_date: "2026-06-15",
    source: "public_apply",
    application_token: "app_demo_haynes_review",
    notes: "Coming over from Lakeside — same boat, same setup.",
    internal_review_notes:
      "Following up on covered availability — B07 frees up next week.",
    reviewed_by: "Peterson, Tiffany",
    submitted_at: "2026-05-28T09:11:00Z",
  },
  {
    id: "app_approved_okafor",
    tenant_id: SEED_TENANT_ID,
    number: "APP-1003",
    status: "approved",
    applicant_first_name: "Chiamaka",
    applicant_last_name: "Okafor",
    applicant_email: "chi.okafor@example.com",
    applicant_phone: "(925) 555-0174",
    applicant_address: "412 Marina Blvd, Berkeley, CA 94710",
    vessel_name: "Nyota",
    vessel_year: 2017,
    vessel_make: "Catalina",
    vessel_model: "315",
    vessel_loa_inches: 32 * 12,
    vessel_beam_inches: 11 * 12 + 8,
    vessel_draft_inches: 5 * 12 + 6,
    preferred_slip_class: "uncovered",
    desired_start_date: "2026-06-01",
    source: "public_apply",
    application_token: "app_demo_okafor_approved",
    notes: "Annual slip — happy to start ASAP.",
    reviewed_by: "Peterson, Tiffany",
    reviewed_at: "2026-05-30T14:42:00Z",
    result_boater_id: "b_okafor",
    submitted_at: "2026-05-21T17:38:00Z",
  },
  {
    id: "app_declined_pratt",
    tenant_id: SEED_TENANT_ID,
    number: "APP-1004",
    status: "declined",
    applicant_first_name: "Joel",
    applicant_last_name: "Pratt",
    applicant_email: "jpratt@example.com",
    applicant_phone: "(707) 555-0189",
    vessel_name: "Wide Open",
    vessel_year: 2008,
    vessel_make: "Bayliner",
    vessel_model: "245",
    // 26ft LOA but 11ft beam — too wide for our uncovered slips.
    vessel_loa_inches: 26 * 12,
    vessel_beam_inches: 11 * 12,
    preferred_slip_class: "uncovered",
    source: "public_apply",
    application_token: "app_demo_pratt_declined",
    notes: "Need a transient slip for the July 4 weekend.",
    internal_review_notes:
      "Beam exceeds our uncovered slip max (10ft). Recommend Lakeside.",
    reviewed_by: "Peterson, Tiffany",
    reviewed_at: "2026-05-29T11:18:00Z",
    submitted_at: "2026-05-27T08:45:00Z",
  },
  {
    id: "app_waitlist_renfrew",
    tenant_id: SEED_TENANT_ID,
    number: "APP-1005",
    status: "waitlisted",
    applicant_first_name: "Sam",
    applicant_last_name: "Renfrew",
    applicant_email: "sam.renfrew@example.com",
    applicant_phone: "(831) 555-0152",
    vessel_name: "North Star",
    vessel_year: 2015,
    vessel_make: "Grand Banks",
    vessel_model: "42 Classic",
    vessel_loa_inches: 42 * 12,
    vessel_beam_inches: 14 * 12,
    vessel_draft_inches: 4 * 12 + 6,
    preferred_slip_class: "covered",
    preferred_dock: "Damsite C Dock",
    desired_start_date: "2026-08-01",
    source: "public_apply",
    application_token: "app_demo_renfrew_waitlist",
    notes: "Covered preferred — happy to wait.",
    internal_review_notes:
      "No covered availability through end of season — routed to waitlist (slot #3).",
    reviewed_by: "Peterson, Tiffany",
    reviewed_at: "2026-05-26T16:02:00Z",
    result_waitlist_entry_id: "wl_renfrew_offer_expired",
    submitted_at: "2026-05-24T13:11:00Z",
  },
];

// ============================================================
// Renewal sweeps — coordinated annual renewal workflow seeds
// ============================================================
//
// Two seeded sweeps so the dashboard card has history + the
// coordinator surface has a live in-progress sweep to operate on.
//
//   1. "Winter 2026 sweep" — in_progress, 8 items in mixed states.
//      Drives the coordinator surface's per-item table + bulk actions.
//   2. "Winter 2025 sweep" — closed, 6 items (final acceptance rate
//      breakdown). Shows the dashboard card's history rail.
//
// Source contracts are real Annual Holder contracts seeded above; the
// pattern is `c_<bId without prefix>_<expiryYear>`.

export const RENEWAL_SWEEPS_SEED: import("./types").RenewalSweep[] = [
  {
    id: "rsw_winter_2026",
    tenant_id: SEED_TENANT_ID,
    name: "Winter 2026 sweep",
    window_start: "2026-12-01",
    window_end: "2027-03-31",
    default_rate_adjustment_pct: 5,
    status: "in_progress",
    launched_at: "2026-11-14T14:30:00Z",
    notes:
      "Standard +5% lift across the fleet. Two flagged for hold-the-line (Hess, Park).",
    created_at: "2026-11-12T09:00:00Z",
  },
  {
    id: "rsw_winter_2025",
    tenant_id: SEED_TENANT_ID,
    name: "Winter 2025 sweep",
    window_start: "2025-12-01",
    window_end: "2026-03-31",
    default_rate_adjustment_pct: 4,
    status: "closed",
    launched_at: "2025-11-15T15:00:00Z",
    closed_at: "2026-03-10T17:45:00Z",
    notes: "Closed with 5 of 6 renewing. Lapsed: Winters.",
    created_at: "2025-11-12T09:00:00Z",
  },
];

export const RENEWAL_SWEEP_ITEMS_SEED: import("./types").RenewalSweepItem[] = [
  // ── Winter 2026 (in_progress) ──────────────────────────────────────
  // Mix: 3 accepted, 1 declined, 1 renewal_sent, 3 pending. The two
  // high-priority items are the long-tenure board-member contracts.
  {
    id: "rswi_w2026_jones",
    sweep_id: "rsw_winter_2026",
    source_contract_id: "c_jones_2026",
    boater_id: "b_jones",
    priority: "normal",
    status: "accepted",
    renewal_link_token: "rsw_t_jones_2026",
    renewal_contract_id: "c_jones_2026_renewal",
    sent_at: "2026-11-14T14:35:00Z",
    responded_at: "2026-11-18T10:12:00Z",
  },
  {
    id: "rswi_w2026_oneill",
    sweep_id: "rsw_winter_2026",
    source_contract_id: "c_oneill_2026",
    boater_id: "b_oneill",
    priority: "high",
    status: "accepted",
    renewal_link_token: "rsw_t_oneill_2026",
    renewal_contract_id: "c_oneill_2026_renewal",
    sent_at: "2026-11-14T14:35:00Z",
    responded_at: "2026-11-16T09:30:00Z",
    internal_notes: "Board member — top priority, signed within 48h.",
  },
  {
    id: "rswi_w2026_hess",
    sweep_id: "rsw_winter_2026",
    source_contract_id: "c_hess_2026",
    boater_id: "b_hess",
    priority: "normal",
    rate_adjustment_pct: 0,
    status: "renewal_sent",
    renewal_link_token: "rsw_t_hess_2026",
    renewal_contract_id: "c_hess_2026_renewal",
    sent_at: "2026-11-20T11:00:00Z",
    internal_notes: "Hold-the-line — 9yr tenant, out-of-state, no lift.",
  },
  {
    id: "rswi_w2026_park",
    sweep_id: "rsw_winter_2026",
    source_contract_id: "c_park_2026",
    boater_id: "b_park",
    priority: "high",
    rate_adjustment_pct: 2,
    status: "declined",
    renewal_link_token: "rsw_t_park_2026",
    renewal_contract_id: "c_park_2026_renewal",
    sent_at: "2026-11-15T09:00:00Z",
    responded_at: "2026-11-22T14:20:00Z",
    internal_notes: "Declined — moving boat to lake further south. Follow up.",
  },
  {
    id: "rswi_w2026_walker",
    sweep_id: "rsw_winter_2026",
    source_contract_id: "c_walker_2026",
    boater_id: "b_walker",
    priority: "high",
    status: "accepted",
    renewal_link_token: "rsw_t_walker_2026",
    renewal_contract_id: "c_walker_2026_renewal",
    sent_at: "2026-11-14T14:35:00Z",
    responded_at: "2026-11-15T08:05:00Z",
    internal_notes: "Original holder, 12yr tenure — instant signature.",
  },
  {
    id: "rswi_w2026_franklin",
    sweep_id: "rsw_winter_2026",
    source_contract_id: "c_franklin_2026",
    boater_id: "b_franklin",
    priority: "normal",
    status: "pending",
    internal_notes: "Schedule for second wave — Damsite B.",
  },
  {
    id: "rswi_w2026_yujin",
    sweep_id: "rsw_winter_2026",
    source_contract_id: "c_yujin_kim_2026",
    boater_id: "b_yujin_kim",
    priority: "normal",
    status: "pending",
  },
  {
    id: "rswi_w2026_velasquez",
    sweep_id: "rsw_winter_2026",
    source_contract_id: "c_velasquez_2026",
    boater_id: "b_velasquez",
    priority: "low",
    rate_adjustment_pct: 7.5,
    status: "pending",
    internal_notes: "Test bigger lift — willing to risk decline.",
  },
  // ── Winter 2025 (closed) ─────────────────────────────────────────
  // Six items, 5 accepted + 1 lapsed (no_response). Drives the
  // dashboard card history rail.
  {
    id: "rswi_w2025_jones",
    sweep_id: "rsw_winter_2025",
    source_contract_id: "c_jones_2026",
    boater_id: "b_jones",
    priority: "normal",
    status: "accepted",
    sent_at: "2025-11-15T15:00:00Z",
    responded_at: "2025-11-18T10:00:00Z",
  },
  {
    id: "rswi_w2025_oneill",
    sweep_id: "rsw_winter_2025",
    source_contract_id: "c_oneill_2026",
    boater_id: "b_oneill",
    priority: "high",
    status: "accepted",
    sent_at: "2025-11-15T15:00:00Z",
    responded_at: "2025-11-17T11:00:00Z",
  },
  {
    id: "rswi_w2025_hess",
    sweep_id: "rsw_winter_2025",
    source_contract_id: "c_hess_2026",
    boater_id: "b_hess",
    priority: "normal",
    status: "accepted",
    sent_at: "2025-11-15T15:00:00Z",
    responded_at: "2025-12-05T09:00:00Z",
  },
  {
    id: "rswi_w2025_park",
    sweep_id: "rsw_winter_2025",
    source_contract_id: "c_park_2026",
    boater_id: "b_park",
    priority: "normal",
    status: "accepted",
    sent_at: "2025-11-15T15:00:00Z",
    responded_at: "2025-11-29T16:30:00Z",
  },
  {
    id: "rswi_w2025_winters",
    sweep_id: "rsw_winter_2025",
    source_contract_id: "c_jones_2026",   // proxy — Winters is the lapsed boater
    boater_id: "b_winters",
    priority: "low",
    status: "no_response",
    sent_at: "2025-11-15T15:00:00Z",
    internal_notes: "Did not respond — window closed.",
  },
  {
    id: "rswi_w2025_walker",
    sweep_id: "rsw_winter_2025",
    source_contract_id: "c_walker_2026",
    boater_id: "b_walker",
    priority: "high",
    status: "accepted",
    sent_at: "2025-11-15T15:00:00Z",
    responded_at: "2025-11-16T07:30:00Z",
  },
];

// ── Storm / weather alerts ─────────────────────────────────
//
// Seed one active warn-level thunderstorm forecast so the banner
// renders on first load. Window is set to "later today" so it's
// visibly active regardless of when you run the dev server.
//
// In production these come from a Convex cron pulling NWS or
// OpenWeather; for now the operator/agent can mint them by hand
// via the upcoming /api/agent create_storm_alert action.
export const STORM_ALERTS_SEED: import("./types").StormAlert[] = [
  {
    id: "stm_demo_thunderstorm",
    tenant_id: SEED_TENANT_ID,
    kind: "thunderstorm",
    severity: "warn",
    headline: "Severe thunderstorms this afternoon",
    body:
      "Strong cells moving in from the SW, peak between 3 and 6pm. " +
      "Recommend locking the gas dock by 2:30pm, pulling jet ski rentals, " +
      "and texting the SMS group when shore power flickers.",
    // Today 14:30 → today 18:30 local. Operator regenerates the row
    // each demo session — production wires real timestamps.
    starts_at: "2026-06-07T18:30:00Z",
    ends_at: "2026-06-07T22:30:00Z",
    issued_at: "2026-06-07T13:00:00Z",
    source: "nws",
    source_ref: "NWS-DEMO-1042",
  },
];

