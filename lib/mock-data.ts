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
  WaitlistEntry,
  StaffNote,
  MarinaEvent,
  RentalBoat,
  BoatRental,
  MarinaProfile,
  CommTemplate,
  Role,
  StaffMember,
  AppProviderConfig,
  PosCatalogItem,
} from "@/lib/types";

// ============================================================
// Tenants + Picklists
// ============================================================
//
// Single seeded tenant for the prototype. When the backend lands the
// active tenant comes from the authenticated session; for now every
// store read defaults to this id.

export const SEED_TENANT_ID = "ten_marina_stee_demo";

export const TENANTS: Tenant[] = [
  {
    id: SEED_TENANT_ID,
    name: "Marina Stee — Damsite Cove",
    slug: "marina-stee",
    created_at: "2026-01-01T00:00:00Z",
  },
];

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
    label: "Occupancy type",
    description:
      "Inventory-side classification used on RentalSpace and Rate cards. Common values: Standard, Jet Ski, Buoy, Dry Storage, Mooring.",
    editable: true,
    values: [
      pv(SEED_TENANT_ID, "Standard", "Standard", 0),
      pv(SEED_TENANT_ID, "Jet Ski", "Jet Ski", 1),
      pv(SEED_TENANT_ID, "Buoy", "Buoy", 2),
      pv(SEED_TENANT_ID, "Dry Storage", "Dry Storage", 3),
      pv(SEED_TENANT_ID, "Mooring", "Mooring", 4),
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
    last_error: "Re-authorize — token expires in 3 days",
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

export const SLIPS: Slip[] = [
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

export const CONTRACT_TEMPLATES: ContractTemplate[] = [
  {
    id: "tpl_annual_slip",
    name: "Annual Slip Lease",
    type: "annual_slip",
    version: 3,
    default_term_months: 12,
    default_billing_cadence: "monthly",
    default_annual_rate: 3900,
    body_preview: "This Slip Lease Agreement is entered into between Marina Stee and {{boater.legal_name}}…",
    required_signers: ["boater", "manager"],
    auto_renew: true,
    body_markdown: `# Annual Slip Lease Agreement

**Marina:** Marina Stee
**Holder:** {{boater.display_name}} ({{boater.code}})
**Slip:** {{slip.number}} · {{slip.dock}}
**Vessel:** {{vessel.name}} ({{vessel.year}} {{vessel.make}} {{vessel.model}})
**Effective period:** {{contract.effective_start}} through {{contract.effective_end}}

---

## 1. Slip Assignment
Marina Stee grants the Holder exclusive use of slip **{{slip.number}}** at {{slip.dock}} for the term of this Agreement. The Holder may moor only the vessel identified above. Any substitution requires Marina written consent and a vessel re-fit check (LOA, beam, draft).

## 2. Term and Renewal
This Agreement runs from **{{contract.effective_start}}** through **{{contract.effective_end}}** and renews automatically for successive 12-month terms unless either party provides 60 days' written notice prior to the renewal date.

## 3. Fees and Billing
- **Annual rate:** {{contract.annual_rate_formatted}}
- **Billing cadence:** {{contract.billing_cadence}}
- **Payment method:** A card on file is required throughout the term. Failed payments incur a 1.5% monthly late fee.
- **Add-ons:** {{contract.services_summary}}

## 4. Insurance
Holder shall maintain a Certificate of Insurance (COI) naming Marina Stee as an additional insured, with minimum hull and liability coverage of $300,000. Lapse of COI is grounds for immediate suspension of slip access.

## 5. Use of Slip
The slip is for the moorage of the named vessel only. Live-aboard use, commercial chartering, and subletting are prohibited without prior written consent. Holder agrees to abide by Marina rules posted on-site and updated from time to time.

## 6. Damage and Liability
Marina Stee is not liable for damage to the vessel, its contents, or personal property caused by weather, theft, vandalism, fire, or acts of God. Holder is responsible for damage to Marina property caused by the vessel.

## 7. Termination
Either party may terminate for cause (non-payment, material breach, dangerous operation) with 14 days' written notice. Holder may terminate without cause with 60 days' notice; no prorated refund is owed.

## 8. Signatures
By signing below, both parties agree to the terms above.

**Holder:** ______________________________ Date: ____________
{{boater.display_name}}

**Marina Manager:** ______________________________ Date: ____________
Marina Stee
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
    activity_type: "pump_out",
    due_date: "2026-05-25",
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
// Drives: /slips/roster roster, /slips/contracts renewal pipeline,
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

export const BOATERS: Boater[] = dedupeById([...NAMED_BOATERS, ...ANNUAL_BOATERS]);
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
];

// Marina-hosted events. Rendered as a layer on the existing /reservations
// Calendar (different color from reservations). Not slip bookings — these
// are marina-wide things like raft-ups and tournaments.
export const MARINA_EVENTS: MarinaEvent[] = [
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
export const WAITLIST: WaitlistEntry[] = [
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
];

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

export const RENTAL_BOATS: RentalBoat[] = [
  {
    id: "rb_pontoon_1",
    name: "Pontoon 1 — Sunseeker",
    type: "pontoon",
    capacity: 10,
    hourly_rate: 95,
    half_day_rate: 325,
    full_day_rate: 525,
    deposit_amount: 500,
    fuel_capacity_gal: 30,
    current_fuel_pct: 92,
    hour_meter_reading: 487,
    home_dock: "Dock C — Slip C12",
    status: "rented",
    notes: "2024 Sun Tracker Party Barge, 90hp Mercury. Bimini top.",
    active: true,
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
    fuel_capacity_gal: 30,
    current_fuel_pct: 78,
    hour_meter_reading: 392,
    home_dock: "Dock C — Slip C13",
    status: "available",
    active: true,
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
    fuel_capacity_gal: 12,
    current_fuel_pct: 85,
    hour_meter_reading: 612,
    home_dock: "Dock C — Slip C18",
    status: "available",
    notes: "Includes 4 rod holders + fishfinder.",
    active: true,
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
    home_dock: "Beach launch",
    status: "available",
    active: true,
    created_at: "2026-04-01T08:00:00Z",
    updated_at: isoOffsetDays(-10),
  },
];

// Sample bookings spread across all status states so the
// progress rail + landing-page filters have something to show.
export const BOAT_RENTALS: BoatRental[] = [
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

// ----- helpers -----

export function getBoater(id: string) {
  return BOATERS.find((b) => b.id === id);
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

export const RENTAL_GROUPS: RentalGroup[] = [
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

export const RENTAL_SPACES: RentalSpace[] = [
  ...DAMSITE_A_SPACES,
  ...DAMSITE_B_SPACES,
  ...JET_SKI_SPACES,
  ...BUOY_SPACES,
];

// Force slip A29 to be occupied since David Emmons holds it
const a29 = RENTAL_SPACES.find((s) => s.id === "sp_dsm_a_29");
if (a29) a29.status = "occupied";

export const RATES: Rate[] = [
  { id: "rate_std_annual", name: "2026 Annual — Standard Slip", occupancy_type: "Standard", cadence: "annual", amount: 3900 },
  { id: "rate_std_seasonal", name: "2026 Seasonal — Standard Slip (Apr-Oct)", occupancy_type: "Standard", cadence: "seasonal", amount: 2200, effective_start: "2026-04-01", effective_end: "2026-10-31" },
  { id: "rate_std_monthly", name: "Monthly — Standard Slip", occupancy_type: "Standard", cadence: "monthly", amount: 325 },
  { id: "rate_std_daily", name: "Transient — Standard Slip", occupancy_type: "Standard", cadence: "daily", amount: 45 },
  { id: "rate_js_daily", name: "Jet Ski — Day Rental", occupancy_type: "Jet Ski", cadence: "daily", amount: 35 },
  { id: "rate_js_weekly", name: "Jet Ski — Week", occupancy_type: "Jet Ski", cadence: "weekly", amount: 195 },
  { id: "rate_buoy_seasonal", name: "Buoy — Seasonal", occupancy_type: "Buoy", cadence: "seasonal", amount: 1400, effective_start: "2026-04-01", effective_end: "2026-10-31" },
  { id: "rate_buoy_daily", name: "Buoy — Transient", occupancy_type: "Buoy", cadence: "daily", amount: 32 },
  { id: "rate_dry_monthly", name: "Dry Storage — Monthly", occupancy_type: "Dry Storage", cadence: "monthly", amount: 180 },
];

export const ADDITIONAL_FEES: AdditionalFee[] = [
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
  },
  {
    id: "fee_transfer",
    name: "Transfer Fee",
    description: "Slip-to-slip transfer charge.",
    amount: 200,
    recurrence: "one_time",
    applies_to: ["slip_contract", "pos"],
    accounting_line_item: "2025/2026 Marina Del Sur Slip Fees",
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
  },
  {
    id: "fee_storage_move",
    name: "Storage Move",
    description: "Move vessel between storage locations.",
    amount: 120,
    recurrence: "one_time",
    applies_to: ["work_order", "pos"],
    accounting_line_item: "2026 Services",
  },
  {
    id: "fee_pet_fee",
    name: "Pet Fee",
    description: "Annual pet liability surcharge.",
    amount: 75,
    recurrence: "annual",
    applies_to: ["slip_contract", "annual_billing_run"],
    accounting_line_item: "2026 Annual Fees",
  },
];

// Meter readings — most normal, a couple anomalous
export const METER_READINGS: MeterReading[] = [
  { id: "m_a01", space_id: "sp_dsm_a_01", meter_number: "01-", current_reading: 538, current_ts: "2026-05-17T13:32:00Z", prev_reading: 537, prev_ts: "2026-04-18T12:02:00Z", rate_per_unit: 0.14, unit: "kWh" },
  { id: "m_a02", space_id: "sp_dsm_a_02", meter_number: "02-A", current_reading: 2199, current_ts: "2026-05-17T13:32:00Z", prev_reading: 2199, prev_ts: "2026-04-18T12:02:00Z", rate_per_unit: 0.14, unit: "kWh" },
  { id: "m_a03", space_id: "sp_dsm_a_03", meter_number: "03-A", current_reading: 19, current_ts: "2026-05-17T13:32:00Z", prev_reading: 19, prev_ts: "2026-04-18T12:02:00Z", rate_per_unit: 0.14, unit: "kWh" },
  { id: "m_a04", space_id: "sp_dsm_a_04", meter_number: "04-", current_reading: 349, current_ts: "2026-05-21T12:02:00Z", prev_reading: 337, prev_ts: "2026-05-17T13:32:00Z", rate_per_unit: 0.14, unit: "kWh" }, // anomalous +12 in 4 days
  { id: "m_a05", space_id: "sp_dsm_a_05", meter_number: "05-A", current_reading: 342, current_ts: "2026-05-21T12:04:00Z", prev_reading: 339, prev_ts: "2026-05-17T13:32:00Z", rate_per_unit: 0.14, unit: "kWh" },
  { id: "m_a06", space_id: "sp_dsm_a_06", meter_number: "06-A", current_reading: 3489, current_ts: "2026-05-21T12:04:00Z", prev_reading: 3484, prev_ts: "2026-05-17T13:32:00Z", rate_per_unit: 0.14, unit: "kWh" },
  { id: "m_a07", space_id: "sp_dsm_a_07", meter_number: "07-A", current_reading: 46, current_ts: "2026-05-17T13:32:00Z", prev_reading: 46, prev_ts: "2026-04-18T12:03:00Z", rate_per_unit: 0.14, unit: "kWh" },
  { id: "m_a29", space_id: "sp_dsm_a_29", meter_number: "29-A", current_reading: 1147, current_ts: "2026-05-22T08:14:00Z", prev_reading: 1093, prev_ts: "2026-04-18T11:48:00Z", rate_per_unit: 0.14, unit: "kWh" },
];

export const FUEL_INVENTORY: FuelInventory[] = [
  { id: "fi_gas", fuel_type: "gasoline", tank_capacity_gallons: 8000, current_level_gallons: 4720, current_price_per_gallon: 4.89, cost_per_gallon: 3.42, reorder_threshold_pct: 25, last_updated_at: "2026-05-23T07:00:00Z" },
  { id: "fi_diesel", fuel_type: "diesel", tank_capacity_gallons: 4000, current_level_gallons: 1180, current_price_per_gallon: 5.12, cost_per_gallon: 3.78, reorder_threshold_pct: 30, last_updated_at: "2026-05-23T07:00:00Z" },
];

export const FUEL_DELIVERIES: FuelDelivery[] = [
  { id: "fd_2026_05", fuel_type: "gasoline", delivery_date: "2026-05-04", gallons_delivered: 3000, cost_per_gallon: 3.42, total_cost: 10260, supplier: "Pinon Petroleum" },
  { id: "fd_2026_05_d", fuel_type: "diesel", delivery_date: "2026-05-04", gallons_delivered: 1500, cost_per_gallon: 3.78, total_cost: 5670, supplier: "Pinon Petroleum" },
  { id: "fd_2026_04", fuel_type: "gasoline", delivery_date: "2026-04-12", gallons_delivered: 2500, cost_per_gallon: 3.31, total_cost: 8275, supplier: "Pinon Petroleum" },
];

export const FUEL_SALES: FuelSale[] = [
  { id: "fs_001", fuel_type: "gasoline", gallons: 38, price_per_gallon: 4.89, total: 185.82, sold_at: "2026-05-23T09:12:00Z", pedestal_id: "P-FUEL-1", space_id: "sp_dsm_a_12", boater_id: "b_emmons", payment_method: "charge_to_account" },
  { id: "fs_002", fuel_type: "diesel", gallons: 22, price_per_gallon: 5.12, total: 112.64, sold_at: "2026-05-22T16:45:00Z", pedestal_id: "P-FUEL-2", patron_id: "p_001", payment_method: "card" },
  { id: "fs_003", fuel_type: "gasoline", gallons: 14, price_per_gallon: 4.89, total: 68.46, sold_at: "2026-05-22T11:20:00Z", pedestal_id: "P-FUEL-1", boater_id: "b_peterson", payment_method: "charge_to_account" },
  { id: "fs_004", fuel_type: "gasoline", gallons: 52, price_per_gallon: 4.89, total: 254.28, sold_at: "2026-05-21T14:30:00Z", pedestal_id: "P-FUEL-1", boater_id: "b_davis", payment_method: "card" },
  { id: "fs_005", fuel_type: "gasoline", gallons: 19, price_per_gallon: 4.79, total: 91.01, sold_at: "2026-05-20T10:05:00Z", pedestal_id: "P-FUEL-1", patron_id: "p_002", payment_method: "cash" },
];

// POS item catalog — see `PosCatalogItem` in lib/types.ts. Seed only;
// the store treats these as the initial state, then the operator edits
// items via Settings → POS Catalog (or the inline tile editor).
export const POS_CATALOG: PosCatalogItem[] = [
  // Fuel Dock
  { id: "pos_fuel_gas", sku: "FUEL-GAS", name: "Gasoline / gal", category: "Fuel", price: 4.89, cost: 3.42, location_keys: ["fuel_dock"], taxable: true, active: true },
  { id: "pos_fuel_dsl", sku: "FUEL-DSL", name: "Diesel / gal", category: "Fuel", price: 5.12, cost: 3.78, location_keys: ["fuel_dock"], taxable: true, active: true },
  { id: "pos_oil_2str", sku: "OIL-2STR", name: "2-stroke oil quart", category: "Fluids", price: 18.50, cost: 9.50, location_keys: ["fuel_dock", "ship_store"], taxable: true, active: true },
  // Ship Store
  { id: "pos_rope_50", sku: "ROPE-50", name: "Dock line 50ft", category: "Lines", price: 28.00, cost: 14.00, location_keys: ["ship_store"], taxable: true, active: true },
  { id: "pos_fender_m", sku: "FENDER-M", name: "Fender — medium", category: "Lines", price: 18.00, cost: 9.50, location_keys: ["ship_store"], taxable: true, active: true },
  { id: "pos_flare_kit", sku: "FLARE-KIT", name: "Flare kit", category: "Safety", price: 64.00, cost: 35.00, location_keys: ["ship_store"], taxable: true, active: true },
  { id: "pos_ice_10", sku: "ICE-10", name: "Ice 10lb bag", category: "Provisions", price: 4.50, cost: 1.25, location_keys: ["ship_store"], taxable: false, active: true },
  { id: "pos_sunscrn", sku: "SUNSCRN", name: "Sunscreen SPF 50", category: "Provisions", price: 12.99, cost: 6.50, location_keys: ["ship_store"], taxable: true, active: true },
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

export const POS_LOCATIONS: PosLocation[] = [
  { id: "loc_fuel", key: "fuel_dock", name: "Fuel Dock", allows_charge_to_account: true, default_tax_rate: 0.0825, icon_key: "fuel", active: true, sort_order: 0 },
  { id: "loc_store", key: "ship_store", name: "Ship Store", allows_charge_to_account: true, default_tax_rate: 0.0825, icon_key: "shop", active: true, sort_order: 1 },
  { id: "loc_rest", key: "restaurant", name: "Marina Restaurant", allows_charge_to_account: true, default_tax_rate: 0.0825, icon_key: "restaurant", active: true, sort_order: 2 },
  { id: "loc_hm", key: "harbormaster", name: "Harbormaster", allows_charge_to_account: true, default_tax_rate: 0, icon_key: "harbormaster", active: true, sort_order: 3 },
];

export const POS_ORDERS: PosOrder[] = [
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
