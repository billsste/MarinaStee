// Marina Stee domain types — Customers (Boaters), Rentals, POS.
// Mock-data-friendly: all relations are id refs, resolved at the page layer.

export type StatusKey = "ok" | "warn" | "danger" | "info" | "neutral";

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

export interface WaitlistEntry {
  id: string;
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
  offer_expires_at?: string;       // ISO — typically offered_at + 24h
  claim_token?: string;            // public URL token for /claim/[token]
  converted_reservation_id?: string;
  converted_contract_id?: string;  // when a holder accepted and started the onboarding chain
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

export interface Slip {
  id: string;              // e.g. "A29"
  dock: string;            // e.g. "Damsite A Dock"
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
  // Cross-platform connections
  linked_work_order_id?: string;
  linked_quote_id?: string;
  linked_pos_order_id?: string;
  linked_reservation_id?: string;
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
  billable_minutes?: number;
  flagged?: boolean;
  quote_id?: string;                // linked quote
  linked_ledger_entry_ids?: string[];
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
    type: "invoice" | "contract" | "reservation" | "work_order";
    id: string;
  };
}

export type ContractTemplateType =
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
   * Per-step onboarding progress. Drives the staff-side progress rail.
   * Each field is set to the ISO timestamp when the step completed; a
   * step is "done" iff its timestamp is present.
   */
  onboarding?: ContractOnboardingProgress;
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

export type OccupancyType = "Standard" | "Jet Ski" | "Buoy" | "Dry Storage" | "Mooring";

export type SpaceStatus = "vacant" | "occupied" | "reserved" | "out_of_service";

export interface RentalGroup {
  id: string;
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

export type RateCadence = "daily" | "weekly" | "monthly" | "seasonal" | "annual";

export interface Rate {
  id: string;
  name: string;                 // "2026 Annual Slip — Standard"
  occupancy_type: OccupancyType;
  cadence: RateCadence;
  amount: number;
  effective_start?: string;
  effective_end?: string;
  applies_to_group_ids?: string[]; // omitted = all groups of that occupancy type
}

export type FeeBillingMode =
  | "single_billing"            // one-time charge
  | "bill_with_rental"          // added to a rental invoice
  | "recurring_monthly"
  | "recurring_annual";

export interface AdditionalFee {
  id: string;
  name: string;                 // "Hoist Fee", "Transfer Fee", "Pump-out"
  description?: string;
  amount: number;
  billing_mode: FeeBillingMode;
  accounting_line_item: string; // "2025/2026 Marina Del Sur Slip Fees"
  applies_to_group_ids?: string[];
}

export interface MeterReading {
  id: string;
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
  created_at: string;
  updated_at: string;
}

// ============================================================
// POS domain (lightweight — Rentals milestone scope only)
// ============================================================

export type PosLocationKey = "fuel_dock" | "ship_store" | "restaurant" | "harbormaster";

export interface PosLocation {
  id: string;
  key: PosLocationKey;
  name: string;
  allows_charge_to_account: boolean;
  default_tax_rate: number;     // 0..1
}

export type PosPaymentMethod = "card" | "cash" | "charge_to_account" | "split";

export interface PosOrder {
  id: string;
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
