/*
 * Marina Stee — Convex schema.
 *
 * One Clerk Organization = one row in `marinas`. Every other table
 * carries `tenantId: v.id("marinas")` and is filtered by it in every
 * query (see convex/_helpers.ts → requireTenant).
 *
 * Embedded vs separate-table rule: anything that only ever exists as a
 * child of one parent (Contact inside Boater, QuoteLineItem inside
 * Quote, etc.) is an embedded `v.object()`. Anything queryable
 * standalone gets its own table.
 *
 * Source of truth for field shapes is still `lib/types.ts` until Phase 7
 * (mock retire). Keep these aligned during the migration.
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ────────────────────────────────────────────────────────────
// Reusable embedded value shapes
// ────────────────────────────────────────────────────────────

const addressV = v.object({
  line1: v.string(),
  line2: v.optional(v.string()),
  city: v.string(),
  state: v.string(),
  zip: v.string(),
  country: v.string(),
});

const contactV = v.object({
  id: v.string(),
  name: v.string(),
  role: v.union(
    v.literal("self"),
    v.literal("spouse"),
    v.literal("captain"),
    v.literal("manager"),
    v.literal("other"),
  ),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  preferred_channel: v.union(
    v.literal("email"),
    v.literal("sms"),
    v.literal("voice"),
  ),
  can_be_billed: v.boolean(),
});

const cardOnFileV = v.object({
  id: v.string(),
  brand: v.union(
    v.literal("visa"),
    v.literal("mastercard"),
    v.literal("amex"),
    v.literal("discover"),
  ),
  last4: v.string(),
  exp_month: v.number(),
  exp_year: v.number(),
  nickname: v.optional(v.string()),
  is_default: v.boolean(),
  processor_token: v.string(),
});

const quoteLineItemV = v.object({
  id: v.string(),
  kind: v.union(
    v.literal("part"),
    v.literal("labor"),
    v.literal("fee"),
    v.literal("discount"),
  ),
  description: v.string(),
  qty: v.number(),
  unit_price: v.number(),
  total: v.number(),
  taxable: v.boolean(),
});

// ────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────

export default defineSchema({
  // ── Per-tenant sequence counters ─────────────────────────────
  //
  // One row per (tenantId, kind) — e.g. ("ten_marina_stee", "APP") for
  // application numbers. Convex serializes mutations on the same
  // document, so the atomic read + patch pattern inside the mutation
  // serializes parallel inserts on the same counter and avoids the
  // length-of-collect race where two near-simultaneous submits mint
  // the same number.
  //
  // Kinds we use: "APP" (applications), "WO" (work orders), "R"
  // (reservations), "INV" (invoices), "Q" (quotes), "K" (contracts),
  // "PMT" (payments), "BIL" (vendor bills). Add new kinds as needed.
  //
  // Usage from any mutation:
  //   const number = await nextSequenceNumber(ctx, tenantId, "APP", 1000);
  //
  // see `convex/_helpers.ts → nextSequenceNumber`.
  counters: defineTable({
    tenantId: v.id("marinas"),
    kind: v.string(),
    value: v.number(),
  })
    .index("by_tenant_kind", ["tenantId", "kind"]),

  // ── Tenant + identity ────────────────────────────────────────
  marinas: defineTable({
    clerkOrgId: v.string(), // canonical multi-tenant key
    display_name: v.string(),
    short_name: v.string(),
    tagline: v.optional(v.string()),
    logo_storage_id: v.optional(v.id("_storage")),
    email: v.string(),
    phone: v.string(),
    website: v.optional(v.string()),
    address_line1: v.string(),
    address_line2: v.optional(v.string()),
    city: v.string(),
    state: v.string(),
    postal_code: v.string(),
    country: v.string(),
    timezone: v.string(),
    business_hours_open: v.string(),
    business_hours_close: v.string(),
    default_tax_rate: v.number(),
    accounting_close: v.union(
      v.literal("monthly_eom"),
      v.literal("monthly_15th"),
      v.literal("weekly_friday"),
    ),
    outbound_email_from_name: v.string(),
    outbound_sms_sender_label: v.string(),
    // ── Per-tenant notification provider config (H2 wave) ─────
    //
    // When set, these win over the workspace-level POSTMARK_*/TWILIO_*
    // env vars in `lib/notification-dispatch.ts` so each marina can
    // route through its own Postmark account / Twilio number without
    // touching server env. Secrets ARE stored here in the prototype —
    // production should swap to a Convex `_storage`-backed secret box
    // or an external KMS (see commit notes on the H2 wave). Either
    // way, callers go through `resolvePostmarkConfig` / `resolveTwilio
    // Config` which centralizes the env-vs-tenant fallback.
    //
    // `postmark_message_stream` defaults to "outbound" at adapter
    // resolve time when unset.
    // `twilio_from_email_label` is the friendly label that Postmark
    // pairs with the from address (and that we surface in the
    // marina-profile UI as "From name"). Different from
    // `outbound_email_from_name` only when the marina uses a separate
    // notification identity from their day-to-day operator brand.
    postmark_api_key: v.optional(v.string()),
    postmark_message_stream: v.optional(v.string()),
    twilio_account_sid: v.optional(v.string()),
    twilio_auth_token: v.optional(v.string()),
    twilio_from_number: v.optional(v.string()),
    twilio_from_email_label: v.optional(v.string()),
  })
    .index("by_clerk_org", ["clerkOrgId"]),

  staffMembers: defineTable({
    tenantId: v.id("marinas"),
    clerkUserId: v.optional(v.string()), // null until they accept invite
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    role_id: v.id("roles"),
    status: v.union(
      v.literal("invited"),
      v.literal("active"),
      v.literal("suspended"),
    ),
    mfa_enabled: v.boolean(),
    last_login_at: v.optional(v.string()),
    // Wage profile + clock identity. All optional — staff can have an
    // app login without these (mirror of lib/types.ts StaffMember
    // staffing-v1 block). Stored as free strings/numbers — the page
    // adapter casts back to the mock enum types.
    default_position: v.optional(v.string()),
    employment_type: v.optional(v.string()), // "w2" | "1099"
    hourly_rate: v.optional(v.number()),
    salary_annual: v.optional(v.number()),
    mobile_clock_pin: v.optional(v.string()),
    pto_hours_balance: v.optional(v.number()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_clerk_user", ["clerkUserId"])
    .index("by_tenant_email", ["tenantId", "email"]),

  roles: defineTable({
    tenantId: v.id("marinas"),
    name: v.string(),
    description: v.optional(v.string()),
    permissions: v.array(v.string()), // PermissionKey values
    is_system: v.boolean(),
    sort_order: v.number(),
  })
    .index("by_tenant", ["tenantId"]),

  providerConfigs: defineTable({
    tenantId: v.id("marinas"),
    kind: v.union(
      v.literal("payment"),
      v.literal("email"),
      v.literal("sms"),
      v.literal("accounting"),
    ),
    provider: v.string(),
    enabled: v.boolean(),
    // Real secrets land here once we hit production. For prototype
    // these are "is configured" flags + non-sensitive display values.
    //
    // Phase 4 (Wave 3) packs the page-side fields (display_name,
    // status, config map, connected_at, last_error) into the existing
    // `public_config` JSON blob — see `components/settings/connections-view.tsx`
    // for the adapter shape. The Convex schema stays untouched
    // (per the wave-3 directive "don't extend existing tables") and
    // the page just reshapes JSON on the read + write paths.
    public_config: v.optional(v.string()), // JSON string of non-secret fields
    has_secret: v.boolean(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_kind", ["tenantId", "kind"]),

  // ── Customers ───────────────────────────────────────────────
  boaters: defineTable({
    tenantId: v.id("marinas"),
    display_name: v.string(),
    first_name: v.string(),
    last_name: v.string(),
    code: v.optional(v.string()),
    active: v.boolean(),
    billing_cadence: v.union(
      v.literal("annual"),
      v.literal("seasonal"),
      v.literal("monthly"),
      v.literal("transient"),
    ),
    tags: v.array(v.string()),
    communication_prefs: v.object({
      preferred_channel: v.union(
        v.literal("email"),
        v.literal("sms"),
        v.literal("voice"),
      ),
      language: v.string(),
      quiet_hours: v.optional(
        v.object({ start: v.string(), end: v.string() }),
      ),
    }),
    primary_contact: contactV,
    additional_contacts: v.array(contactV),
    address: addressV,
    cards_on_file: v.optional(v.array(cardOnFileV)),
    trust_score: v.optional(v.number()),
    notes: v.optional(v.string()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_active", ["tenantId", "active"])
    .index("by_tenant_last_name", ["tenantId", "last_name"])
    .index("by_tenant_code", ["tenantId", "code"])
    // Full-text search for fuzzy "find by name" used in agent-fetch.ts
    .searchIndex("search_display_name", {
      searchField: "display_name",
      filterFields: ["tenantId"],
    }),

  vessels: defineTable({
    tenantId: v.id("marinas"),
    boater_id: v.id("boaters"),
    co_owner_ids: v.array(v.id("boaters")),
    name: v.string(),
    year: v.optional(v.number()),
    make: v.optional(v.string()),
    model: v.optional(v.string()),
    vessel_type: v.optional(
      v.union(
        v.literal("powerboat"),
        v.literal("sailboat"),
        v.literal("pontoon"),
        v.literal("houseboat"),
        v.literal("pwc"),
        v.literal("other"),
      ),
    ),
    fuel_type: v.optional(
      v.union(
        v.literal("gasoline"),
        v.literal("diesel"),
        v.literal("electric"),
        v.literal("none"),
      ),
    ),
    loa_inches: v.optional(v.number()),
    beam_inches: v.optional(v.number()),
    draft_inches: v.optional(v.number()),
    hull_vin: v.optional(v.string()),
    registration: v.optional(v.string()),
    photo_storage_ids: v.optional(v.array(v.id("_storage"))),
    active: v.boolean(),
    // Stamped by the WO closeout chain — surfaces a "Last serviced …"
    // line on the Vessel detail page. Optional because legacy vessel
    // rows pre-date the closeout chain.
    last_service_at: v.optional(v.string()),
    last_service_wo_id: v.optional(v.id("workOrders")),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_boater", ["tenantId", "boater_id"]),

  staffNotes: defineTable({
    tenantId: v.id("marinas"),
    boater_id: v.id("boaters"),
    author_user_id: v.string(), // clerkUserId
    author_name: v.string(),
    body: v.string(),
    pinned: v.boolean(),
  })
    .index("by_tenant_boater", ["tenantId", "boater_id"]),

  waitlistEntries: defineTable({
    tenantId: v.id("marinas"),
    boater_id: v.optional(v.id("boaters")), // null = anonymous waitlist
    patron_name: v.optional(v.string()),
    patron_email: v.optional(v.string()),
    patron_phone: v.optional(v.string()),
    preferences: v.object({
      min_loa_inches: v.optional(v.number()),
      max_loa_inches: v.optional(v.number()),
      needs_power: v.optional(v.boolean()),
      needs_water: v.optional(v.boolean()),
      preferred_dock_ids: v.optional(v.array(v.id("docks"))),
    }),
    status: v.union(
      v.literal("pending"),
      v.literal("offered"),
      v.literal("converted"),
      v.literal("declined"),
      v.literal("withdrawn"),
      v.literal("expired"),
    ),
    offered_slip_id: v.optional(v.id("slips")),
    offered_at: v.optional(v.string()),
    offer_token: v.optional(v.string()),
    offer_expires_at: v.optional(v.string()),
    // ── Auto-offer cascade (Phase 5 lifecycle) ────────────────────
    // offer_status tracks the fired-offer state machine separately
    // from `status` so a declined offer can leave the entry back on
    // the queue (status=pending) while still recording the decline.
    offer_status: v.optional(
      v.union(
        v.literal("none"),
        v.literal("pending"),
        v.literal("accepted"),
        v.literal("declined"),
        v.literal("expired"),
      ),
    ),
    offer_responded_at: v.optional(v.string()),
    // Fan-out batches share an id so the operator UI + audit log can
    // group "fired 3 offers on slip A14" as one event.
    offer_batch_id: v.optional(v.string()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_offer_token", ["offer_token"]),

  // ── Boater applications (public self-onboarding queue) ──────────
  //
  // Prospective boaters submit /apply → row lands here in `pending`.
  // Operator queues in /members → Applications, decides
  // approve / decline / route-to-waitlist. Approve mints a Boater +
  // Vessel and stamps result_boater_id; route-to-waitlist mints a
  // waitlistEntries row and stamps result_waitlist_entry_id.
  //
  // `application_token` powers /apply/[token] for the boater-facing
  // status check. Lookup index added so the public route doesn't
  // table-scan.
  applications: defineTable({
    tenantId: v.id("marinas"),
    number: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("under_review"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("waitlisted"),
    ),
    // Applicant
    applicant_first_name: v.string(),
    applicant_last_name: v.string(),
    applicant_email: v.string(),
    applicant_phone: v.string(),
    applicant_address: v.optional(v.string()),
    // Vessel
    vessel_name: v.string(),
    vessel_year: v.optional(v.number()),
    vessel_make: v.string(),
    vessel_model: v.string(),
    vessel_loa_inches: v.number(),
    vessel_beam_inches: v.optional(v.number()),
    vessel_draft_inches: v.optional(v.number()),
    // Slip preferences
    preferred_slip_class: v.optional(
      v.union(
        v.literal("covered"),
        v.literal("uncovered"),
        v.literal("T-head"),
        v.literal("buoy"),
        v.literal("dry"),
      ),
    ),
    preferred_dock: v.optional(v.string()),
    desired_start_date: v.optional(v.string()),
    // Lifecycle
    source: v.union(
      v.literal("public_apply"),
      v.literal("agent"),
      v.literal("manual"),
    ),
    application_token: v.string(),
    notes: v.optional(v.string()),
    internal_review_notes: v.optional(v.string()),
    reviewed_by: v.optional(v.string()),
    reviewed_at: v.optional(v.string()),
    result_boater_id: v.optional(v.id("boaters")),
    result_waitlist_entry_id: v.optional(v.id("waitlistEntries")),
    submitted_at: v.string(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_tenant_submitted_at", ["tenantId", "submitted_at"])
    .index("by_application_token", ["application_token"]),

  insuranceCertificates: defineTable({
    tenantId: v.id("marinas"),
    boater_id: v.id("boaters"),
    carrier: v.string(),
    policy_number: v.string(),
    effective_start: v.string(),
    effective_end: v.string(),
    coverage_amount: v.optional(v.number()),
    document_storage_id: v.optional(v.id("_storage")),
    status: v.union(
      v.literal("active"),
      v.literal("expiring_soon"),
      v.literal("expired"),
      v.literal("lapsed"),
    ),
    upload_token: v.optional(v.string()),
    // ISO timestamp at which `upload_token` becomes invalid. Set 7 days
    // out from token mint. Token lookup queries MUST validate this so a
    // stale link in an old reminder email can't be reused to replace a
    // current COI. See `convex/insuranceCoi.ts → draftRenewalReminder`.
    upload_token_expires_at: v.optional(v.string()),
    renewed_by_coi_id: v.optional(v.id("insuranceCertificates")),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_boater", ["tenantId", "boater_id"])
    .index("by_upload_token", ["upload_token"]),

  // ── Vendors (AP) ────────────────────────────────────────────
  //
  // Mirrors `lib/types.ts → Vendor`. AP-side counterpart to boaters —
  // legal name + display name, payment terms, default GL, 1099 flag.
  // Bills live in a separate table once that phase migrates; for now
  // vendors land alone (the page's bill view continues reading from
  // the mock store until Bills are added to Convex).
  vendors: defineTable({
    tenantId: v.id("marinas"),
    name: v.string(),
    display_name: v.optional(v.string()),
    contact_name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address_line1: v.optional(v.string()),
    address_line2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    postal_code: v.optional(v.string()),
    country: v.optional(v.string()),
    payment_terms: v.union(
      v.literal("due_on_receipt"),
      v.literal("net_7"),
      v.literal("net_15"),
      v.literal("net_30"),
      v.literal("net_60"),
    ),
    default_gl_account: v.optional(v.string()),
    tax_id_last4: v.optional(v.string()),
    issue_1099: v.boolean(),
    notes: v.optional(v.string()),
    active: v.boolean(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_active", ["tenantId", "active"]),

  // ── Vendor Bills (operator AP workflow) ─────────────────────
  //
  // Mirrors `lib/types.ts → VendorBill`. AP-side workflow record for the
  // /vendors → Bills sub-tab. State machine: draft → pending_approval →
  // approved → scheduled → paid. Side-paths: disputed (blocks payment
  // until cleared) + void (operator drops the bill entirely).
  //
  // Distinct from the legacy `bills` table (deferred from earlier vendor
  // wave). Both can coexist until the AP workflow soaks; the new one
  // owns the approval queue + scheduling. Line items + attachment_ids
  // are embedded because they're only ever read with the parent bill.
  vendorBills: defineTable({
    tenantId: v.id("marinas"),
    number: v.string(), // BIL-####
    vendor_id: v.id("vendors"),
    vendor_invoice_number: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("pending_approval"),
      v.literal("approved"),
      v.literal("scheduled"),
      v.literal("paid"),
      v.literal("disputed"),
      v.literal("void"),
    ),
    bill_date: v.string(),
    due_date: v.string(),
    amount: v.number(),
    tax_amount: v.optional(v.number()),
    subtotal: v.optional(v.number()),
    description: v.optional(v.string()),
    line_items: v.optional(
      v.array(
        v.object({
          description: v.string(),
          amount: v.number(),
          gl_account: v.optional(v.string()),
        }),
      ),
    ),
    attachment_ids: v.optional(v.array(v.string())),
    approved_by: v.optional(v.string()),
    approved_at: v.optional(v.string()),
    scheduled_payment_date: v.optional(v.string()),
    scheduled_payment_method: v.optional(
      v.union(
        v.literal("ach"),
        v.literal("check"),
        v.literal("card"),
        v.literal("wire"),
      ),
    ),
    paid_at: v.optional(v.string()),
    paid_via: v.optional(v.string()),
    payment_ledger_entry_id: v.optional(v.string()),
    dispute_reason: v.optional(v.string()),
    internal_notes: v.optional(v.string()),
    created_at: v.string(),
    created_by: v.string(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_tenant_vendor", ["tenantId", "vendor_id"])
    .index("by_tenant_number", ["tenantId", "number"]),

  // ── Inbound emails (AP-bill ingest provenance) ──────────────
  //
  // One row per email Postmark forwards to `bills@<marina>.marinastee.com`.
  // Inserted at the TOP of the ingest pipeline so retries (Postmark
  // retries on non-2xx for ~24h) can short-circuit on the unique
  // `postmark_message_id`. Status walks forward as parse / vendor-match /
  // bill-create succeed; failures stamp `error_reason`. Mirrors
  // `lib/types.ts → InboundEmail`.
  inboundEmails: defineTable({
    tenantId: v.id("marinas"),
    postmark_message_id: v.string(),
    from_email: v.string(),
    from_name: v.optional(v.string()),
    subject: v.optional(v.string()),
    received_at: v.string(),
    vendor_bill_id: v.optional(v.id("vendorBills")),
    vendor_id: v.optional(v.id("vendors")),
    status: v.union(
      v.literal("ingested"),
      v.literal("matched_vendor"),
      v.literal("created_draft"),
      v.literal("failed"),
    ),
    error_reason: v.optional(v.string()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_received_at", ["tenantId", "received_at"])
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_postmark_message_id", ["postmark_message_id"]),

  // ── Physical inventory ──────────────────────────────────────
  docks: defineTable({
    tenantId: v.id("marinas"),
    name: v.string(),
    short_name: v.string(),
    prefix: v.optional(v.string()),
    sort_order: v.number(),
    active: v.boolean(),
    notes: v.optional(v.string()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_prefix", ["tenantId", "prefix"]),

  slips: defineTable({
    tenantId: v.id("marinas"),
    dock_id: v.id("docks"),
    dock_name_cache: v.string(), // denormalized for display perf
    number: v.string(),
    slip_class: v.union(
      v.literal("covered"),
      v.literal("uncovered"),
      v.literal("t_head"),
      v.literal("buoy"),
      v.literal("dry_storage"),
      v.literal("mooring"),
    ),
    invoice_category: v.optional(v.string()),
    max_loa_inches: v.number(),
    max_beam_inches: v.number(),
    has_power: v.boolean(),
    has_water: v.boolean(),
    default_annual_rate: v.number(),
    default_monthly_rate: v.optional(v.number()),
    default_seasonal_rate: v.optional(v.number()),
    current_holder_boater_id: v.optional(v.id("boaters")),
    current_contract_id: v.optional(v.id("contracts")),
    occupancy_status: v.union(
      v.literal("vacant"),
      v.literal("occupied"),
      v.literal("reserved"),
      v.literal("out_of_service"),
    ),
    notes: v.optional(v.string()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_dock", ["tenantId", "dock_id"])
    .index("by_tenant_number", ["tenantId", "number"])
    .index("by_tenant_holder", ["tenantId", "current_holder_boater_id"]),

  // Legacy rental groups + spaces — kept while we finish slip
  // consolidation. Will be retired in a later phase.
  rentalGroups: defineTable({
    tenantId: v.id("marinas"),
    name: v.string(),
    type: v.string(),
    description: v.optional(v.string()),
    active: v.boolean(),
  }).index("by_tenant", ["tenantId"]),

  rentalSpaces: defineTable({
    tenantId: v.id("marinas"),
    group_id: v.id("rentalGroups"),
    number: v.string(),
    status: v.union(
      v.literal("vacant"),
      v.literal("occupied"),
      v.literal("reserved"),
      v.literal("out_of_service"),
    ),
    length_inches: v.optional(v.number()),
    width_inches: v.optional(v.number()),
    has_power: v.boolean(),
    has_water: v.boolean(),
  }).index("by_tenant_group", ["tenantId", "group_id"]),

  // ── Reservations + contracts ────────────────────────────────
  reservations: defineTable({
    tenantId: v.id("marinas"),
    number: v.string(),
    seq: v.optional(v.string()),
    boater_id: v.id("boaters"),
    vessel_id: v.optional(v.id("vessels")),
    slip_id: v.id("slips"),
    arrival_date: v.string(),
    departure_date: v.string(),
    status: v.union(
      v.literal("scheduled"),
      v.literal("occupied"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    type: v.union(
      v.literal("annual"),
      v.literal("seasonal"),
      v.literal("monthly"),
      v.literal("transient"),
      v.literal("recurring"),
    ),
    nightly_rate: v.optional(v.number()),
    notes: v.optional(v.string()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_arrival", ["tenantId", "arrival_date"])
    .index("by_tenant_boater", ["tenantId", "boater_id"])
    .index("by_tenant_slip", ["tenantId", "slip_id"]),

  contractTemplates: defineTable({
    tenantId: v.id("marinas"),
    name: v.string(),
    template_type: v.union(
      v.literal("annual_slip"),
      v.literal("seasonal_slip"),
      v.literal("transient_overnight"),
      v.literal("winterization"),
      v.literal("haul_out"),
      v.literal("storage_dry"),
      v.literal("mooring"),
      v.literal("other"),
    ),
    document_storage_id: v.optional(v.id("_storage")),
    body_markdown: v.optional(v.string()),
    available_tokens: v.array(v.string()),
    linked_fee_id: v.optional(v.id("additionalFees")),
    version: v.number(),
    active: v.boolean(),
  })
    .index("by_tenant", ["tenantId"]),

  contracts: defineTable({
    tenantId: v.id("marinas"),
    number: v.string(),
    boater_id: v.id("boaters"),
    template_id: v.id("contractTemplates"),
    template_version: v.number(),
    vessel_id: v.optional(v.id("vessels")),
    slip_id: v.optional(v.id("slips")),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("signed"),
      v.literal("active"),
      v.literal("expired"),
      v.literal("terminated"),
    ),
    effective_start: v.string(),
    effective_end: v.string(),
    annual_rate: v.optional(v.number()),
    billing_cadence: v.union(
      v.literal("annual"),
      v.literal("seasonal"),
      v.literal("monthly"),
      v.literal("transient"),
    ),
    signature_token: v.optional(v.string()),
    signed_at: v.optional(v.string()),
    signed_by_name: v.optional(v.string()),
    drafted_body_markdown: v.optional(v.string()),
    drafted_at: v.optional(v.string()),
    attachments: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          type: v.union(
            v.literal("signed_contract"),
            v.literal("addendum"),
            v.literal("supporting_doc"),
            v.literal("other"),
          ),
          storage_id: v.id("_storage"),
          mime_type: v.string(),
          size_bytes: v.optional(v.number()),
          uploaded_at: v.string(),
        }),
      ),
    ),
    onboarding_progress: v.optional(
      v.object({
        sent_at: v.optional(v.string()),
        viewed_at: v.optional(v.string()),
        signed_at: v.optional(v.string()),
        coi_uploaded_at: v.optional(v.string()),
        payment_method_added_at: v.optional(v.string()),
        completed_at: v.optional(v.string()),
      }),
    ),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_tenant_boater", ["tenantId", "boater_id"])
    .index("by_signature_token", ["signature_token"]),

  // ── Work + service ──────────────────────────────────────────
  workOrders: defineTable({
    tenantId: v.id("marinas"),
    number: v.string(),
    boater_id: v.id("boaters"),
    vessel_id: v.optional(v.id("vessels")),
    slip_id: v.optional(v.id("slips")),
    subject: v.string(),
    description: v.optional(v.string()),
    status: v.union(
      v.literal("open"),
      v.literal("scheduled"),
      v.literal("in_progress"),
      v.literal("blocked"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    priority: v.union(
      v.literal("low"),
      v.literal("normal"),
      v.literal("high"),
      v.literal("urgent"),
    ),
    assignee_user_id: v.optional(v.string()),
    activity_type: v.optional(
      v.union(
        v.literal("winterization"),
        v.literal("bottom_paint"),
        v.literal("service"),
        v.literal("inspection"),
        v.literal("haul_out"),
        v.literal("pump_out"),
        v.literal("task"),
        v.literal("other"),
      ),
    ),
    start_date: v.optional(v.string()),
    end_date: v.optional(v.string()),
    due_date: v.optional(v.string()),
    billable_minutes: v.optional(v.number()),
    flagged: v.optional(v.boolean()),
    quote_id: v.optional(v.id("quotes")),
    linked_ledger_entry_ids: v.optional(v.array(v.id("ledgerEntries"))),
    // Closeout-chain idempotency stamp — set the first time status flips
    // to completed. Re-fires short-circuit when this is non-null.
    closed_out_at: v.optional(v.string()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_tenant_boater", ["tenantId", "boater_id"])
    .index("by_tenant_assignee", ["tenantId", "assignee_user_id"]),

  quotes: defineTable({
    tenantId: v.id("marinas"),
    number: v.string(),
    work_order_id: v.id("workOrders"),
    line_items: v.array(quoteLineItemV),
    subtotal: v.number(),
    tax: v.number(),
    total: v.number(),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("signed"),
      v.literal("declined"),
      v.literal("expired"),
    ),
    signature_token: v.optional(v.string()),
    signed_at: v.optional(v.string()),
    signed_by_name: v.optional(v.string()),
    valid_until: v.optional(v.string()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_work_order", ["work_order_id"])
    .index("by_signature_token", ["signature_token"]),

  // ── Money ───────────────────────────────────────────────────
  ledgerEntries: defineTable({
    tenantId: v.id("marinas"),
    boater_id: v.id("boaters"),
    type: v.union(
      v.literal("invoice"),
      v.literal("payment"),
      v.literal("refund"),
      v.literal("credit"),
      v.literal("adjustment"),
    ),
    number: v.optional(v.string()),
    date: v.string(),
    amount: v.number(),
    open_balance: v.number(),
    method: v.optional(
      v.union(
        v.literal("card"),
        v.literal("cash"),
        v.literal("check"),
        v.literal("ach"),
        v.literal("charge_to_account"),
      ),
    ),
    status: v.union(
      v.literal("open"),
      v.literal("paid"),
      v.literal("void"),
      v.literal("partial"),
    ),
    line_items: v.optional(
      v.array(v.object({ description: v.string(), amount: v.number() })),
    ),
    applied_to_invoice_ids: v.optional(v.array(v.id("ledgerEntries"))),
    linked_pos_order_id: v.optional(v.id("posOrders")),
    linked_contract_id: v.optional(v.id("contracts")),
    linked_work_order_id: v.optional(v.id("workOrders")),
    qb_sync_status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("syncing"),
        v.literal("synced"),
        v.literal("error"),
        v.literal("skipped"),
      ),
    ),
    qb_ref: v.optional(v.string()),
    refund_reason: v.optional(v.string()),
    refund_notes: v.optional(v.string()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_boater_status", ["tenantId", "boater_id", "status"])
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_tenant_qb_sync", ["tenantId", "qb_sync_status"]),

  posLocations: defineTable({
    tenantId: v.id("marinas"),
    key: v.union(
      v.literal("fuel_dock"),
      v.literal("ship_store"),
      v.literal("restaurant"),
      v.literal("harbormaster"),
    ),
    name: v.string(),
    allows_charge_to_account: v.boolean(),
    default_tax_rate: v.number(),
    icon_key: v.optional(
      v.union(
        v.literal("fuel"),
        v.literal("shop"),
        v.literal("restaurant"),
        v.literal("harbormaster"),
        v.literal("marina"),
      ),
    ),
    active: v.boolean(),
    sort_order: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_key", ["tenantId", "key"]),

  posCatalog: defineTable({
    tenantId: v.id("marinas"),
    sku: v.string(),
    name: v.string(),
    category: v.string(),
    price: v.number(),
    cost: v.optional(v.number()),
    location_keys: v.array(
      v.union(
        v.literal("fuel_dock"),
        v.literal("ship_store"),
        v.literal("restaurant"),
        v.literal("harbormaster"),
      ),
    ),
    taxable: v.boolean(),
    active: v.boolean(),
    image_storage_id: v.optional(v.id("_storage")),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_active", ["tenantId", "active"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["tenantId"],
    }),

  posOrders: defineTable({
    tenantId: v.id("marinas"),
    number: v.string(),
    location_id: v.id("posLocations"),
    customer_kind: v.union(
      v.literal("boater"),
      v.literal("patron"),
      v.literal("anonymous"),
    ),
    boater_id: v.optional(v.id("boaters")),
    patron_name: v.optional(v.string()),
    line_items: v.array(
      v.object({
        sku: v.string(),
        name: v.string(),
        qty: v.number(),
        unit_price: v.number(),
        total: v.number(),
      }),
    ),
    subtotal: v.number(),
    tax: v.number(),
    total: v.number(),
    payment_method: v.union(
      v.literal("card"),
      v.literal("cash"),
      v.literal("charge_to_account"),
      v.literal("split"),
    ),
    status: v.union(
      v.literal("open"),
      v.literal("paid"),
      v.literal("void"),
      v.literal("refunded"),
    ),
    closed_at: v.optional(v.string()),
    linked_ledger_entry_id: v.optional(v.id("ledgerEntries")),
    qb_sync_status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("syncing"),
        v.literal("synced"),
        v.literal("error"),
        v.literal("skipped"),
      ),
    ),
    qb_ref: v.optional(v.string()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_tenant_location", ["tenantId", "location_id"]),

  // ── Catalog ─────────────────────────────────────────────────
  rates: defineTable({
    tenantId: v.id("marinas"),
    name: v.string(),
    occupancy_type: v.string(),
    cadence: v.union(
      v.literal("daily"),
      v.literal("weekly"),
      v.literal("monthly"),
      v.literal("seasonal"),
      v.literal("annual"),
    ),
    amount: v.number(),
    active: v.boolean(),
    notes: v.optional(v.string()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_active", ["tenantId", "active"]),

  additionalFees: defineTable({
    tenantId: v.id("marinas"),
    name: v.string(),
    description: v.optional(v.string()),
    amount: v.number(),
    recurrence: v.union(
      v.literal("one_time"),
      v.literal("monthly"),
      v.literal("annual"),
    ),
    applies_to: v.array(
      v.union(
        v.literal("slip_contract"),
        v.literal("work_order"),
        v.literal("boat_rental"),
        v.literal("pos"),
        v.literal("annual_billing_run"),
      ),
    ),
    accounting_line_item: v.string(),
    applies_to_group_ids: v.optional(v.array(v.id("rentalGroups"))),
    linked_activity_type: v.optional(
      v.union(
        v.literal("winterization"),
        v.literal("bottom_paint"),
        v.literal("service"),
        v.literal("inspection"),
        v.literal("haul_out"),
        v.literal("pump_out"),
        v.literal("task"),
        v.literal("other"),
      ),
    ),
    linked_template_id: v.optional(v.id("contractTemplates")),
    auto_attach: v.optional(v.boolean()),
  })
    .index("by_tenant", ["tenantId"]),

  // ── Operations: meters + fuel ──────────────────────────────
  meterReadings: defineTable({
    tenantId: v.id("marinas"),
    space_id: v.id("slips"),
    meter_number: v.string(),
    current_reading: v.number(),
    current_ts: v.string(),
    prev_reading: v.number(),
    prev_ts: v.string(),
    rate_per_unit: v.optional(v.number()),
    unit: v.optional(v.union(v.literal("kWh"), v.literal("gallons"))),
    photo_storage_id: v.optional(v.id("_storage")),
    flagged_anomaly: v.optional(v.boolean()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_space", ["tenantId", "space_id"]),

  fuelInventory: defineTable({
    tenantId: v.id("marinas"),
    fuel_type: v.union(v.literal("gasoline"), v.literal("diesel")),
    current_gallons: v.number(),
    tank_capacity: v.number(),
    reorder_threshold_pct: v.number(),
    current_price_per_gallon: v.number(),
    current_cost_per_gallon: v.number(),
  }).index("by_tenant_fuel", ["tenantId", "fuel_type"]),

  fuelDeliveries: defineTable({
    tenantId: v.id("marinas"),
    fuel_type: v.union(v.literal("gasoline"), v.literal("diesel")),
    gallons_delivered: v.number(),
    cost_per_gallon: v.number(),
    total_cost: v.number(),
    supplier: v.string(),
    delivery_date: v.string(),
  }).index("by_tenant", ["tenantId"]),

  fuelSales: defineTable({
    tenantId: v.id("marinas"),
    fuel_type: v.union(v.literal("gasoline"), v.literal("diesel")),
    gallons: v.number(),
    price_per_gallon: v.number(),
    total: v.number(),
    payment_method: v.union(
      v.literal("card"),
      v.literal("cash"),
      v.literal("charge_to_account"),
    ),
    boater_id: v.optional(v.id("boaters")),
    pos_order_id: v.optional(v.id("posOrders")),
    sold_at: v.string(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_boater", ["tenantId", "boater_id"]),

  // ── Boat rentals ────────────────────────────────────────────
  rentalBoats: defineTable({
    tenantId: v.id("marinas"),
    name: v.string(),
    type: v.union(
      v.literal("pontoon"),
      v.literal("jet_ski"),
      v.literal("kayak"),
      v.literal("paddleboard"),
      v.literal("fishing_skiff"),
      v.literal("ski_boat"),
      v.literal("other"),
    ),
    status: v.union(
      v.literal("available"),
      v.literal("rented"),
      v.literal("maintenance"),
      v.literal("out_of_service"),
    ),
    hourly_rate: v.optional(v.number()),
    half_day_rate: v.optional(v.number()),
    full_day_rate: v.optional(v.number()),
    capacity: v.optional(v.number()),
    photo_storage_ids: v.optional(v.array(v.id("_storage"))),
    notes: v.optional(v.string()),
  }).index("by_tenant", ["tenantId"]),

  boatRentals: defineTable({
    tenantId: v.id("marinas"),
    number: v.string(),
    boat_id: v.id("rentalBoats"),
    boater_id: v.optional(v.id("boaters")),
    patron_name: v.optional(v.string()),
    patron_email: v.optional(v.string()),
    patron_phone: v.optional(v.string()),
    start_at: v.string(),
    end_at: v.string(),
    rate_kind: v.union(
      v.literal("hourly"),
      v.literal("half_day"),
      v.literal("full_day"),
    ),
    base_amount: v.number(),
    deposit_hold: v.number(),
    status: v.union(
      v.literal("reserved"),
      v.literal("checked_out"),
      v.literal("returned"),
      v.literal("closed"),
      v.literal("cancelled"),
    ),
    pickup_token: v.optional(v.string()),
    checkin: v.object({
      fuel_out_pct: v.optional(v.number()),
      hours_out: v.optional(v.number()),
      photos_out: v.optional(v.array(v.id("_storage"))),
      checked_out_at: v.optional(v.string()),
      fuel_in_pct: v.optional(v.number()),
      hours_in: v.optional(v.number()),
      photos_in: v.optional(v.array(v.id("_storage"))),
      checked_in_at: v.optional(v.string()),
      damage_notes: v.optional(v.string()),
      damage_charge: v.optional(v.number()),
    }),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_pickup_token", ["pickup_token"])
    .index("by_tenant_status", ["tenantId", "status"]),

  // ── Communications ──────────────────────────────────────────
  communications: defineTable({
    tenantId: v.id("marinas"),
    boater_id: v.optional(v.id("boaters")),
    type: v.union(
      v.literal("email"),
      v.literal("sms"),
      v.literal("voice"),
    ),
    direction: v.union(v.literal("outbound"), v.literal("inbound")),
    subject: v.optional(v.string()),
    body_preview: v.string(),
    body_full: v.optional(v.string()),
    sender_label: v.string(),
    sender_is_system: v.boolean(),
    recipient: v.string(),
    sent_at: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("sending"),
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("bounced"),
      v.literal("read"),
    ),
    related_entity: v.optional(
      v.object({ type: v.string(), id: v.string() }),
    ),
    // ── Delivery dispatch tracking (Phase 5 wave 3) ────────────
    // Stamped by `convex/communications.ts → markDelivered` after the
    // outbound provider (Postmark / Twilio) accepts the send. Until
    // these land the row is queued/pending — webhook ingestion of
    // bounces + reads is a follow-up wave.
    delivered_at: v.optional(v.string()),
    provider_message_id: v.optional(v.string()),
    // Stamped by `markFailed` when the provider rejects (or no provider
    // is configured). `error_reason` is a short machine-readable code —
    // "no_provider_configured" / "missing_recipient" / "postmark_422" —
    // surfaced in the UI as a "not delivered" badge with a tooltip.
    error_at: v.optional(v.string()),
    error_reason: v.optional(v.string()),
    // ── Webhook-driven status (H2 wave) ────────────────────────
    // Inbound delivery telemetry from Postmark / Twilio. `opened_at` +
    // `clicked_at` are email-only (Postmark Open/Click events). They
    // stay null on SMS rows. `bounced_at` + `bounce_reason` flip the
    // row's status to "bounced" — the UI surfaces a red badge so
    // operators can prune dead addresses. `last_webhook_event` is the
    // raw provider event type ("Delivery", "Bounce", "Open", "Click",
    // "MessageStatus.delivered", etc.) so a curious operator can see
    // exactly what the provider told us.
    opened_at: v.optional(v.string()),
    clicked_at: v.optional(v.string()),
    bounced_at: v.optional(v.string()),
    bounce_reason: v.optional(v.string()),
    last_webhook_event: v.optional(v.string()),
    last_webhook_at: v.optional(v.string()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_boater", ["tenantId", "boater_id"])
    .index("by_tenant_sent_at", ["tenantId", "sent_at"]),

  commTemplates: defineTable({
    tenantId: v.id("marinas"),
    kind: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    channel: v.union(
      v.literal("email"),
      v.literal("sms"),
      v.literal("voice"),
    ),
    subject: v.string(),
    body_markdown: v.string(),
    active: v.boolean(),
    available_tokens: v.array(v.string()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_kind", ["tenantId", "kind"]),

  marinaEvents: defineTable({
    tenantId: v.id("marinas"),
    title: v.string(),
    type: v.string(),
    description: v.optional(v.string()),
    start_at: v.string(),
    end_at: v.string(),
    location: v.optional(v.string()),
    attendee_count: v.optional(v.number()),
  }).index("by_tenant", ["tenantId"]),

  // ── Config + audit ──────────────────────────────────────────
  picklists: defineTable({
    tenantId: v.id("marinas"),
    field_key: v.string(),
    label: v.string(),
    values: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        code: v.string(),
        sort_order: v.number(),
        active: v.boolean(),
      }),
    ),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_field", ["tenantId", "field_key"]),

  auditLog: defineTable({
    tenantId: v.id("marinas"),
    actor_user_id: v.optional(v.string()),
    actor_label: v.string(), // pre-resolved for display
    ip: v.optional(v.string()),
    action_type: v.string(), // e.g. "boater.update"
    target_entity: v.string(),
    target_id: v.optional(v.string()),
    payload_delta: v.optional(v.string()), // JSON
    via_agent: v.optional(v.boolean()),
    agent_prompt: v.optional(v.string()),
    created_at: v.string(),
  })
    .index("by_tenant_created_at", ["tenantId", "created_at"])
    .index("by_tenant_actor", ["tenantId", "actor_user_id"])
    .index("by_tenant_action", ["tenantId", "action_type"]),

  rateLimits: defineTable({
    tenantId: v.id("marinas"),
    bucket_key: v.string(), // e.g. "agent.requests"
    counter: v.number(),
    window_started_at: v.string(),
  }).index("by_tenant_bucket", ["tenantId", "bucket_key"]),

  // ── Support tickets ─────────────────────────────────────────
  //
  // Marina Stee carve-out — see ../CLAUDE.md "Carve-out from global
  // §5". Tickets stay in THIS Convex deployment scoped by tenantId;
  // they do NOT proxy to admin.stee-suite.com. One marina's queue is
  // invisible to another.
  //
  // `messages` + `attachments` are embedded because threads are short
  // and we never query a single message standalone. `reference` is a
  // short display key for the modal header (e.g. "ST-104") generated
  // at create time.
  supportTickets: defineTable({
    tenantId: v.id("marinas"),
    reference: v.string(),
    boater_id: v.id("boaters"),
    subject: v.string(),
    description: v.string(),
    type: v.union(
      v.literal("bug"),
      v.literal("question"),
      v.literal("feature_request"),
      v.literal("billing"),
      v.literal("other"),
    ),
    priority: v.union(
      v.literal("low"),
      v.literal("normal"),
      v.literal("high"),
      v.literal("urgent"),
    ),
    page_or_area: v.optional(v.string()),
    steps_to_reproduce: v.optional(v.string()),
    attachments: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        mime_type: v.string(),
        size_bytes: v.optional(v.number()),
        storage_id: v.string(),
        uploaded_at: v.string(),
      }),
    ),
    messages: v.array(
      v.object({
        id: v.string(),
        author_kind: v.union(
          v.literal("boater"),
          v.literal("staff"),
          v.literal("system"),
        ),
        author_label: v.string(),
        body: v.string(),
        created_at: v.string(),
        attachment_ids: v.optional(v.array(v.string())),
      }),
    ),
    status: v.union(
      v.literal("open"),
      v.literal("in_progress"),
      v.literal("awaiting_boater"),
      v.literal("resolved"),
      v.literal("cancelled"),
    ),
    context: v.object({
      submitted_from_url: v.optional(v.string()),
      app_version: v.optional(v.string()),
      user_agent: v.optional(v.string()),
    }),
    created_at: v.string(),
    updated_at: v.string(),
    closed_at: v.optional(v.string()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_tenant_boater", ["tenantId", "boater_id"])
    .index("by_reference", ["reference"]),

  // ── Time Clock + Payroll Prep (W1 feature) ──────────────────
  //
  // `timeEntries` is the per-shift record: clock_in, optional
  // pause/resume, clock_out, audit-tracked manual adjust. Rolls up
  // into `payrollPeriods` (the running biweekly window operators
  // close + export). Tax + deduction details defer to the actual
  // payroll provider integration (Gusto / Rippling) — these tables
  // capture the gross-hours + gross-pay layer only.
  timeEntries: defineTable({
    tenantId: v.id("marinas"),
    staff_id: v.id("staffMembers"),
    clock_in_at: v.string(),       // ISO datetime
    clock_out_at: v.optional(v.string()),
    paused_at: v.optional(v.string()),
    pause_seconds_total: v.optional(v.number()),
    break_minutes: v.optional(v.number()),
    calculated_hours: v.optional(v.number()),
    status: v.union(
      v.literal("in_progress"),
      v.literal("paused"),
      v.literal("completed"),
      v.literal("adjusted"),
    ),
    source: v.union(
      v.literal("mobile"),
      v.literal("web"),
      v.literal("manual"),
    ),
    position: v.optional(v.string()),
    notes: v.optional(v.string()),
    adjusted_by: v.optional(v.id("staffMembers")),
    adjusted_at: v.optional(v.string()),
    payroll_period_id: v.optional(v.id("payrollPeriods")),
    created_at: v.string(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_staff", ["tenantId", "staff_id"])
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_tenant_period", ["tenantId", "payroll_period_id"]),

  payrollPeriods: defineTable({
    tenantId: v.id("marinas"),
    start_date: v.string(),        // ISO date
    end_date: v.string(),
    status: v.union(
      v.literal("open"),
      v.literal("closed"),
      v.literal("paid"),
    ),
    closed_by: v.optional(v.id("staffMembers")),
    closed_at: v.optional(v.string()),
    paid_at: v.optional(v.string()),
    total_gross: v.optional(v.number()),
    total_hours: v.optional(v.number()),
    /** Ledger reference (e.g. "PR-ABC123") for the emitted payroll run. */
    payroll_run_ref: v.optional(v.string()),
    created_at: v.string(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_tenant_start", ["tenantId", "start_date"]),

  // ── Renewal sweep — coordinated annual renewal workflow ───────
  //
  // One sweep groups N items (one per source contract). Lifecycle:
  // draft → in_progress (launched) → closed. Items have their own
  // lifecycle for accept/decline tracking; the sweep summarizes them.
  // See lib/types.ts → RenewalSweep / RenewalSweepItem for the shape.
  renewalSweeps: defineTable({
    tenantId: v.id("marinas"),
    name: v.string(),
    window_start: v.string(),
    window_end: v.string(),
    default_rate_adjustment_pct: v.number(),
    status: v.union(
      v.literal("draft"),
      v.literal("in_progress"),
      v.literal("closed"),
    ),
    launched_at: v.optional(v.string()),
    closed_at: v.optional(v.string()),
    notes: v.optional(v.string()),
    created_at: v.string(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_status", ["tenantId", "status"]),

  renewalSweepItems: defineTable({
    tenantId: v.id("marinas"),
    sweep_id: v.id("renewalSweeps"),
    source_contract_id: v.id("contracts"),
    boater_id: v.id("boaters"),
    priority: v.union(
      v.literal("high"),
      v.literal("normal"),
      v.literal("low"),
    ),
    rate_adjustment_pct: v.optional(v.number()),
    status: v.union(
      v.literal("pending"),
      v.literal("renewal_sent"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("no_response"),
      v.literal("withdrawn"),
    ),
    renewal_link_token: v.optional(v.string()),
    renewal_contract_id: v.optional(v.id("contracts")),
    sent_at: v.optional(v.string()),
    responded_at: v.optional(v.string()),
    internal_notes: v.optional(v.string()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_sweep", ["tenantId", "sweep_id"])
    .index("by_tenant_source_contract", ["tenantId", "source_contract_id"])
    .index("by_tenant_renewal_contract", ["tenantId", "renewal_contract_id"])
    .index("by_renewal_link_token", ["renewal_link_token"]),
});
