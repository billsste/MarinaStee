import type {
  Boater,
  Vessel,
  Slip,
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
} from "@/lib/types";

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
function makeSlip(
  dock: string,
  prefix: string,
  num: number,
  loa: number,
  beam: number,
  withWater = true,
  category = "BOGGS Cove",
): Slip {
  const padded = String(num).padStart(2, "0");
  return {
    id: `${prefix}${padded}`,
    dock,
    invoice_category: category,
    number: padded,
    max_loa_inches: loa * 12,
    max_beam_inches: beam * 12,
    has_power: true,
    has_water: withWater,
  };
}

export const SLIPS: Slip[] = [
  // Damsite A Dock — 30 slips, 24–34 ft
  ...Array.from({ length: 30 }, (_, i) => {
    const num = i + 1;
    const loa = num % 4 === 0 ? 34 : num % 3 === 0 ? 32 : num % 2 === 0 ? 30 : 28;
    return makeSlip("Damsite A Dock", "A", num, loa, 12);
  }),
  // Damsite B Dock — 18 slips, 32–40 ft
  ...Array.from({ length: 18 }, (_, i) => {
    const num = i + 1;
    const loa = num % 3 === 0 ? 40 : num % 2 === 0 ? 36 : 32;
    return makeSlip("Damsite B Dock", "B", num, loa, 14);
  }),
  // Damsite C Dock — 14 slips, 26–32 ft (one without water for variety)
  ...Array.from({ length: 14 }, (_, i) => {
    const num = i + 1;
    const loa = num % 4 === 0 ? 32 : num % 2 === 0 ? 28 : 26;
    return makeSlip("Damsite C Dock", "C", num, loa, 10, num !== 4);
  }),
  // Damsite D Dock — 10 slips, large 38–44 ft
  ...Array.from({ length: 10 }, (_, i) => {
    const num = i + 1;
    const loa = num % 3 === 0 ? 44 : num % 2 === 0 ? 42 : 38;
    return makeSlip("Damsite D Dock", "D", num, loa, 16);
  }),
  // Damsite E Dock — 8 small slips, 22–26 ft
  ...Array.from({ length: 8 }, (_, i) => {
    const num = i + 1;
    return makeSlip("Damsite E Dock", "E", num, 24, 9);
  }),
  // Transient — 4 dedicated dock-walker slips
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `T0${i + 1}`,
    dock: "Transient Dock",
    invoice_category: "BOGGS Cove",
    number: `T-0${i + 1}`,
    max_loa_inches: 45 * 12,
    max_beam_inches: 14 * 12,
    has_power: true,
    has_water: true,
  })),
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
// Drives: /rentals/spaces roster, /rentals/contracts renewal pipeline,
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
  { bId: "b_kim", first: "Yujin", last: "Kim", email: "yujin.kim@example.com", phone: "(505) 555-7733", slipId: "B08", vesselName: "Aria", vesselYear: 2019, vesselMake: "Beneteau", vesselModel: "Oceanis 35", vesselType: "sailboat", fuelType: "diesel", loaFt: 34, beamFt: 11.5, rate: 4500, yearsHeld: 4, expiryYear: 2026 },
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

export const BOATERS: Boater[] = [...NAMED_BOATERS, ...ANNUAL_BOATERS];
export const VESSELS: Vessel[] = [...NAMED_VESSELS, ...ANNUAL_VESSELS];
export const RESERVATIONS: Reservation[] = [...NAMED_RESERVATIONS, ...ANNUAL_RESERVATIONS];

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
  { id: "fee_hoist", name: "Hoist Fee", description: "In/out hoist service for vessel launch or haul-out.", amount: 55.02, billing_mode: "bill_with_rental", accounting_line_item: "2025/2026 Marina Del Sur Slip Fees" },
  { id: "fee_transfer", name: "Transfer Fee", description: "Slip-to-slip transfer charge.", amount: 200, billing_mode: "single_billing", accounting_line_item: "2025/2026 Marina Del Sur Slip Fees" },
  { id: "fee_pump_out", name: "Pump-out Service", description: "Holding tank pump-out, on-demand.", amount: 25, billing_mode: "single_billing", accounting_line_item: "2026 Services" },
  { id: "fee_winterize", name: "Winterization Service", description: "Engine, plumbing, fuel stabilizer.", amount: 285, billing_mode: "single_billing", accounting_line_item: "2026 Services" },
  { id: "fee_storage_move", name: "Storage Move", description: "Move vessel between storage locations.", amount: 120, billing_mode: "single_billing", accounting_line_item: "2026 Services" },
  { id: "fee_pet_fee", name: "Pet Fee", description: "Annual pet liability surcharge.", amount: 75, billing_mode: "recurring_annual", accounting_line_item: "2026 Annual Fees" },
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

// POS item catalog — per location
export interface PosCatalogItem {
  sku: string;
  name: string;
  category: string;
  price: number;
  location_keys: ("fuel_dock" | "ship_store" | "restaurant" | "harbormaster")[];
  taxable: boolean;
}

export const POS_CATALOG: PosCatalogItem[] = [
  // Fuel Dock
  { sku: "FUEL-GAS", name: "Gasoline / gal", category: "Fuel", price: 4.89, location_keys: ["fuel_dock"], taxable: true },
  { sku: "FUEL-DSL", name: "Diesel / gal", category: "Fuel", price: 5.12, location_keys: ["fuel_dock"], taxable: true },
  { sku: "OIL-2STR", name: "2-stroke oil quart", category: "Fluids", price: 18.50, location_keys: ["fuel_dock", "ship_store"], taxable: true },
  // Ship Store
  { sku: "ROPE-50", name: "Dock line 50ft", category: "Lines", price: 28.00, location_keys: ["ship_store"], taxable: true },
  { sku: "FENDER-M", name: "Fender — medium", category: "Lines", price: 18.00, location_keys: ["ship_store"], taxable: true },
  { sku: "FLARE-KIT", name: "Flare kit", category: "Safety", price: 64.00, location_keys: ["ship_store"], taxable: true },
  { sku: "ICE-10", name: "Ice 10lb bag", category: "Provisions", price: 4.50, location_keys: ["ship_store"], taxable: false },
  { sku: "SUNSCRN", name: "Sunscreen SPF 50", category: "Provisions", price: 12.99, location_keys: ["ship_store"], taxable: true },
  // Restaurant
  { sku: "BURGER", name: "Marina burger", category: "Mains", price: 16.00, location_keys: ["restaurant"], taxable: true },
  { sku: "FISH-TACO", name: "Fish tacos (3)", category: "Mains", price: 18.00, location_keys: ["restaurant"], taxable: true },
  { sku: "CAESAR", name: "Caesar salad", category: "Sides", price: 12.00, location_keys: ["restaurant"], taxable: true },
  { sku: "BEER-DR", name: "Draft beer", category: "Drinks", price: 8.00, location_keys: ["restaurant"], taxable: true },
  { sku: "MARG", name: "Margarita", category: "Drinks", price: 12.00, location_keys: ["restaurant"], taxable: true },
  // Harbormaster
  { sku: "PUMP-OUT", name: "Pump-out service", category: "Service", price: 25.00, location_keys: ["harbormaster"], taxable: false },
  { sku: "TRANSIENT-DAY", name: "Transient slip — daily", category: "Service", price: 45.00, location_keys: ["harbormaster"], taxable: false },
];

export const POS_LOCATIONS: PosLocation[] = [
  { id: "loc_fuel", key: "fuel_dock", name: "Fuel Dock", allows_charge_to_account: true, default_tax_rate: 0.0825 },
  { id: "loc_store", key: "ship_store", name: "Ship Store", allows_charge_to_account: true, default_tax_rate: 0.0825 },
  { id: "loc_rest", key: "restaurant", name: "Marina Restaurant", allows_charge_to_account: true, default_tax_rate: 0.0825 },
  { id: "loc_hm", key: "harbormaster", name: "Harbormaster", allows_charge_to_account: true, default_tax_rate: 0 },
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
