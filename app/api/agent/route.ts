import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  ADDITIONAL_FEES,
  BOATERS,
  CONTRACTS,
  CONTRACT_TEMPLATES,
  METER_READINGS,
  RENTAL_GROUPS,
  RENTAL_SPACES,
  RESERVATIONS,
  SLIPS,
  VESSELS,
  WORK_ORDERS,
  meterAnomaly,
  meterDelta,
} from "@/lib/mock-data";
import {
  createTokenizer,
  type LazyTokenizer,
} from "@/lib/pii-tokenizer";
import { generateAgentResponse } from "@/lib/simulated-agent";
import { isExpiringWithin, localIsoDate } from "@/lib/contracts";
import { formatRouteCatalog } from "@/lib/routes";
import { registeredToolSchemas } from "@/lib/agent-tools";
import {
  reportArrivalsWindow,
  reportContractsExpiring,
  reportLapsedAccounts,
  reportMeterConsumptionTop,
  reportMyBalance,
  reportMyHistory,
  reportMyVessels,
  reportOccupancyByDock,
  reportOpenBalances,
  reportRenewalsByMonth,
  reportRevenueByCategory,
  reportTopRevenueBoaters,
  reportWorkOrderAging,
} from "@/lib/agent-reports";
import type { LedgerEntry } from "@/lib/types";

/*
 * POST /api/agent
 *
 * Multi-turn agent loop.
 *  - Read-only query tools (query_open_balances, query_meter_anomalies,
 *    query_contract_expiry) execute server-side; results loop back to Claude.
 *  - Action tools (charge_to_account, send_message) require human approval —
 *    they're streamed to the client as Proposed Action cards and end the turn.
 *
 * Wire format (NDJSON, one event per line):
 *   {"type":"source","source":"claude"|"simulated"}
 *   {"type":"text","delta":"..."}                              (repeated)
 *   {"type":"tool_step","name":"query_...","result":...}        (auto-executed query results, for transparency)
 *   {"type":"tool","name":"charge_to_account"|"send_message"|"create_work_order"|"create_reservation"|"record_payment","input":{...}}
 *   {"type":"done"}
 *   {"type":"error","message":"..."}
 */

export const runtime = "nodejs";

// ────────────────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────────────────

const READ_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "query_open_balances",
    description:
      "Returns a ranked list of boaters with non-zero open A/R balances. Use this when the user asks about overdue accounts, who owes money, or wants to identify boaters to follow up with.",
    input_schema: {
      type: "object",
      properties: {
        min_amount: {
          type: "number",
          description: "Optional minimum balance threshold in dollars. Default: 0.",
        },
      },
      required: [],
    },
  },
  {
    name: "query_meter_anomalies",
    description:
      "Returns meter readings flagged as anomalous (consumption spikes). Use this when investigating unusual utility draw or planning work orders.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "query_contract_expiry",
    description:
      "Returns active contracts expiring within a window. Use this when planning renewals or finding contracts that need attention.",
    input_schema: {
      type: "object",
      properties: {
        days_window: {
          type: "number",
          description: "How many days from today to look ahead. Default: 90.",
        },
      },
      required: [],
    },
  },
  // ── Batch E: extended queries ─────────────────────────────────
  {
    name: "query_arrivals_today",
    description:
      "Returns boaters with reservations arriving on a given date (default today). Use for 'who's arriving today?' and 'find transients checking in tomorrow'.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "ISO YYYY-MM-DD. Defaults to today." },
      },
      required: [],
    },
  },
  {
    name: "query_departures_today",
    description:
      "Returns reservations departing on a given date (default today). Pairs with query_arrivals_today for the daily front-desk view.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "ISO YYYY-MM-DD. Defaults to today." },
      },
      required: [],
    },
  },
  {
    name: "query_revenue_summary",
    description:
      "Returns a revenue rollup for the requested window: total invoiced + paid + outstanding, broken down by slip leases vs services vs POS. Use for 'how did we do this month' or 'YTD revenue'.",
    input_schema: {
      type: "object",
      properties: {
        window: {
          type: "string",
          enum: ["this_month", "last_month", "this_quarter", "ytd"],
          description: "Default this_month.",
        },
      },
      required: [],
    },
  },
  {
    name: "query_occupancy",
    description:
      "Returns slip occupancy: total / occupied / vacant / out-of-service + per-dock breakdown. Use for 'how full are we right now' or 'which docks have space'.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "query_active_work_orders",
    description:
      "Returns active work orders grouped by status + priority + assignee. Use for the daily ops standup view.",
    input_schema: {
      type: "object",
      properties: {
        assignee: { type: "string", description: "Optional — filter to one assignee user id." },
      },
      required: [],
    },
  },
  {
    name: "query_fee_usage",
    description:
      "Returns the additional-fee catalog plus per-fee usage counts (ledger invoice references, linked WO activity matches, linked contract templates). Use when staff asks where a fee is being charged, how many holders have it, or wants to audit fee usage before renaming/archiving.",
    input_schema: {
      type: "object",
      properties: {
        fee_query: {
          type: "string",
          description:
            "Optional name/keyword filter (e.g., 'pet', 'pump-out'). If omitted, returns all fees.",
        },
      },
      required: [],
    },
  },

  // ── Saved reports (read-only, return a TableResult) ─────────
  // These auto-execute and stream a `tool_step` event back to the
  // browser. The chat host detects `kind: "table"` on the result
  // and renders a real table card with sort + total-row affordance.
  // The agent should pick the matching report for plain-language
  // asks like "who owes money?", "what's expiring?", "how full are
  // the docks?", "renewals by month".
  {
    name: "report_open_balances",
    description:
      "Operator A/R glance — boaters with non-zero open balance, sorted desc by amount, with days-overdue + oldest invoice date. Use for 'who owes money?', 'show me overdue accounts', 'A/R aging'.",
    input_schema: {
      type: "object",
      properties: {
        min_amount: {
          type: "number",
          description: "Optional minimum balance threshold in dollars. Default 0.",
        },
      },
      required: [],
    },
  },
  {
    name: "report_renewals_by_month",
    description:
      "Renewal pipeline forecast — per-month count of contracts expiring + ARR at risk. Use for 'how many renewals are coming?', 'what's the Q4 renewal load?', 'renewals by month'.",
    input_schema: {
      type: "object",
      properties: {
        months_ahead: {
          type: "number",
          description: "Months of forward horizon, 1-24. Default 12.",
        },
      },
      required: [],
    },
  },
  {
    name: "report_occupancy_by_dock",
    description:
      "Per-dock occupancy snapshot — total / occupied / vacant / lapsed + occupancy %. Use for 'how full are the docks?', 'which dock has the most vacancy?', 'occupancy by dock'.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "report_contracts_expiring",
    description:
      "Contract-level drill-down for the renewal team — boater + contract + slip + expiry + days_out + annual_rate, sorted soonest first. Use for 'what's expiring in October?', 'show me contracts expiring in 30 days'.",
    input_schema: {
      type: "object",
      properties: {
        within_days: {
          type: "number",
          description: "Days-ahead window, 1-365. Default 60.",
        },
      },
      required: [],
    },
  },
  {
    name: "report_lapsed_accounts",
    description:
      "Lapsed-slip-AND-open-balance cohort — the renewal collection priority list. Use for 'who lapsed?', 'lapsed accounts with balance', 'who needs collection follow-up'.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  // ── Wave 2 reports ─────────────────────────────────────────
  {
    name: "report_revenue_by_category",
    description:
      "Windowed revenue split — invoiced / paid / outstanding across slip rent, fuel, ship store, restaurant, services, rental club. Use for 'how did we do this month by category', 'where's the revenue coming from', 'revenue split'.",
    input_schema: {
      type: "object",
      properties: {
        window: {
          type: "string",
          enum: ["this_month", "last_month", "this_quarter", "ytd"],
          description: "Default this_month.",
        },
      },
      required: [],
    },
  },
  {
    name: "report_top_revenue_boaters",
    description:
      "Top-paying boaters in a window — pareto view for retention + comping decisions. Use for 'who are our biggest customers', 'top 20 by revenue', 'lifetime value ranking'.",
    input_schema: {
      type: "object",
      properties: {
        window: {
          type: "string",
          enum: ["this_month", "last_month", "this_quarter", "ytd"],
          description: "Default ytd.",
        },
        limit: {
          type: "number",
          description: "How many rows to return, 1-100. Default 20.",
        },
      },
      required: [],
    },
  },
  {
    name: "report_work_order_aging",
    description:
      "Open work orders bucketed by age (0-7d, 8-30d, 31-90d, 90+d) with priority breakdown. Use for 'what's stuck', 'old work orders', 'open WO aging', 'priority queue'.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "report_meter_consumption_top",
    description:
      "Top electric consumers by recent kWh delta — finds leaks / phantom loads / heaters left on. Use for 'who's using the most power', 'biggest electric users', 'meter consumption ranking'.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "How many top rows, 1-50. Default 15.",
        },
      },
      required: [],
    },
  },
  {
    name: "report_arrivals_window",
    description:
      "Per-day arrival forecast for the next N days — staffing + arrival-comm planning. Use for 'arrivals this week', 'next 14 days of arrivals', 'arrivals forecast'.",
    input_schema: {
      type: "object",
      properties: {
        days_ahead: {
          type: "number",
          description: "Days of forward horizon, 1-30. Default 7.",
        },
      },
      required: [],
    },
  },
];

const ACTION_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "charge_to_account",
    description:
      "Propose adding a charge to a boater's account. Requires human approval — the staff member reviews and clicks Approve in the UI before it executes.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: {
          type: "string",
          description:
            "Last name, first name, or slip code identifying the boater. Examples: 'Emmons', 'David', 'DSM A29'.",
        },
        item_query: {
          type: "string",
          description:
            "What to charge. Either a POS catalog item (gasoline, dock line, fender) or a service fee (hoist fee, transfer fee, pump-out, winterization).",
        },
      },
      required: ["boater_query", "item_query"],
    },
  },
  {
    name: "send_message",
    description:
      "Propose sending a message to a boater. Requires human approval. Use for payment reminders, arrival reminders, ad-hoc updates.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: {
          type: "string",
          description: "Last name, first name, or slip code identifying the boater.",
        },
        channel: {
          type: "string",
          enum: ["sms", "email"],
          description: "Default to the boater's preferred_channel from context.",
        },
        subject: { type: "string" },
        body: {
          type: "string",
          description: "1-3 short sentences. Use the boater's first name.",
        },
      },
      required: ["boater_query", "channel", "body"],
    },
  },
  {
    name: "create_work_order",
    description:
      "Propose creating a new service work order for a boater. Requires human approval. Use when staff says things like 'schedule winterization for David's Bayliner' or 'open a haul-out work order for the Peterson sloop'.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: {
          type: "string",
          description: "Last name, first name, or slip code identifying the boater.",
        },
        subject: {
          type: "string",
          description: "Short title for the work order, e.g. 'Winterize 1989 Bayliner'.",
        },
        description: {
          type: "string",
          description: "Optional longer detail for the technician.",
        },
        activity_type: {
          type: "string",
          enum: ["winterization", "bottom_paint", "service", "inspection", "haul_out", "pump_out", "task", "other"],
          description: "Category of work. 'task' is for staff to-dos like 'call X re renewal'. 'pump_out' is sanitation. Default 'service' when unclear.",
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "urgent"],
          description: "Default 'normal'.",
        },
        vessel_query: {
          type: "string",
          description:
            "Optional vessel name to attach. If the boater has only one vessel, the agent may omit and the UI will pick it.",
        },
        slip_query: {
          type: "string",
          description: "Optional slip number or dock label.",
        },
        due_date: {
          type: "string",
          description: "Optional ISO date (YYYY-MM-DD) when the work must be done by.",
        },
      },
      required: ["boater_query", "subject"],
    },
  },
  {
    name: "create_reservation",
    description:
      "Propose creating a new reservation (annual / seasonal / monthly / transient). Requires human approval. Use for 'book A12 for the Petersons next weekend' or 'put David in slip 14 for the season'.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: { type: "string" },
        slip_query: {
          type: "string",
          description: "Slip number, dock label, or slip id. Required.",
        },
        vessel_query: { type: "string", description: "Optional vessel name." },
        arrival_date: {
          type: "string",
          description: "ISO date (YYYY-MM-DD).",
        },
        departure_date: {
          type: "string",
          description: "ISO date (YYYY-MM-DD).",
        },
        type: {
          type: "string",
          enum: ["annual", "seasonal", "monthly", "transient", "recurring"],
          description: "Default 'transient' for short stays.",
        },
      },
      required: ["boater_query", "slip_query", "arrival_date", "departure_date"],
    },
  },
  {
    name: "record_payment",
    description:
      "Propose recording a manual payment received outside the POS (check, cash, ACH, or manually-keyed card). Requires human approval. Use for 'record a $400 check from Emmons' or 'apply $1,200 ACH to David's open invoices'.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: { type: "string" },
        amount: {
          type: "number",
          description: "Payment amount in dollars (positive).",
        },
        method: {
          type: "string",
          enum: ["check", "cash", "ach", "card"],
        },
        notes: {
          type: "string",
          description: "Optional memo, e.g. check number.",
        },
      },
      required: ["boater_query", "amount", "method"],
    },
  },
  {
    name: "create_boater",
    description:
      "Propose adding a new boater (customer) to the marina. Requires human approval. Use when staff says 'onboard a new boater named ...' or 'add Smith family to the books'.",
    input_schema: {
      type: "object",
      properties: {
        first_name: { type: "string" },
        last_name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        preferred_channel: {
          type: "string",
          enum: ["email", "sms", "voice"],
          description: "Default 'email'.",
        },
        billing_cadence: {
          type: "string",
          enum: ["annual", "seasonal", "monthly", "transient"],
          description: "Default 'transient'.",
        },
        code: {
          type: "string",
          description: "Optional slip-encoded shorthand, e.g. 'DSM A29'.",
        },
        notes: { type: "string" },
      },
      required: ["first_name", "last_name"],
    },
  },
  {
    name: "create_vessel",
    description:
      "Propose adding a vessel to a boater's profile. Requires human approval. Use when staff says 'add the 32-foot Sea Ray to David's account' or 'register a new boat for Peterson'.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: { type: "string" },
        name: { type: "string", description: "Vessel name, e.g. 'Reel Time'." },
        year: { type: "number" },
        make: { type: "string" },
        model: { type: "string" },
        vessel_type: {
          type: "string",
          enum: ["powerboat", "sailboat", "pontoon", "houseboat", "pwc", "other"],
        },
        fuel_type: {
          type: "string",
          enum: ["gasoline", "diesel", "electric", "none"],
        },
        loa_inches: { type: "number", description: "Length overall in inches." },
        beam_inches: { type: "number" },
        draft_inches: { type: "number" },
        hull_vin: { type: "string" },
        registration: { type: "string" },
      },
      required: ["boater_query", "name"],
    },
  },
  {
    name: "create_contract",
    description:
      "Propose drafting a new contract (annual/seasonal slip lease, winterization, etc.) for a boater. Requires human approval. Default status is 'draft' — staff will send for signature separately.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: { type: "string" },
        template_id: {
          type: "string",
          enum: ["tpl_annual_slip", "tpl_seasonal_slip", "tpl_winterization"],
          description: "Which contract template to use.",
        },
        vessel_query: { type: "string" },
        slip_query: { type: "string" },
        effective_start: { type: "string", description: "ISO date." },
        effective_end: { type: "string", description: "ISO date." },
        annual_rate: { type: "number" },
        billing_cadence: {
          type: "string",
          enum: ["annual", "seasonal", "monthly", "transient"],
          description: "Default 'monthly'.",
        },
        attached_fee_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional fee ids from /services/fees to attach to this contract.",
        },
      },
      required: ["boater_query", "template_id", "effective_start", "effective_end"],
    },
  },
  {
    name: "add_card",
    description:
      "Propose adding a card-on-file for a boater (for future auto-charges, deposits, etc.). Requires human approval. Production: would tokenize via the payment processor first; here we just record the metadata.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: { type: "string" },
        brand: {
          type: "string",
          enum: ["visa", "mastercard", "amex", "discover"],
        },
        last4: { type: "string", description: "4-digit string." },
        exp_month: { type: "number" },
        exp_year: { type: "number", description: "4-digit year." },
        nickname: { type: "string" },
        is_default: { type: "boolean", description: "Default false." },
      },
      required: ["boater_query", "brand", "last4", "exp_month", "exp_year"],
    },
  },
  {
    name: "create_boat_rental",
    description:
      "Propose booking one of the marina's rental boats (pontoons / jet skis / kayaks / paddleboards / fishing skiffs). Requires human approval. On approval a pickup token is minted and an outbound link is dispatched. Either boater_query (existing annual holder) OR patron_name + at least one of patron_email / patron_phone (walk-in customer) is required.",
    input_schema: {
      type: "object",
      properties: {
        boat_query: { type: "string", description: "Boat name, e.g. 'Pontoon 1' or 'Yellow Kayak'." },
        boater_query: { type: "string", description: "Existing annual holder — name, code, etc. Omit for walk-ins." },
        patron_name: { type: "string", description: "Walk-in customer full name. Required when no boater_query." },
        patron_email: { type: "string" },
        patron_phone: { type: "string" },
        start_at: { type: "string", description: "ISO datetime of pickup." },
        end_at: { type: "string", description: "ISO datetime of return." },
        rate_kind: {
          type: "string",
          enum: ["hourly", "half_day", "full_day"],
          description: "Pricing block.",
        },
      },
      required: ["boat_query", "start_at", "end_at", "rate_kind"],
    },
  },
  {
    name: "close_boat_rental",
    description:
      "Propose closing out a returned boat rental — records fuel + hours + damage, computes final charges, posts the invoice to the ledger, and dispatches a receipt comm. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        rental_query: { type: "string", description: "Booking number like 'BR-1003' or a customer name." },
        fuel_in_pct: { type: "number", description: "Fuel level at return (0-100)." },
        hours_in: { type: "number", description: "Engine hours at return." },
        damage_notes: { type: "string" },
        damage_charge: { type: "number", description: "Damage charge in dollars. Default 0." },
      },
      required: ["rental_query"],
    },
  },
  {
    name: "send_pickup_link",
    description:
      "Resend the public /pickup/[token] link to a boat-rental customer. Idempotent — reuses an existing token if one is on file. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        rental_query: { type: "string", description: "Booking number or customer name." },
      },
      required: ["rental_query"],
    },
  },
  {
    name: "notify_waitlist",
    description:
      "A slip just opened — broadcast claim links to the top N matching waitlisters. Requires human approval. First to confirm gets the slip; others see 'already claimed' or 'expired' after 24h.",
    input_schema: {
      type: "object",
      properties: {
        slip_query: { type: "string", description: "Slip id like 'A07' or a verbal description." },
        top_n: { type: "number", description: "How many waitlisters to broadcast to. Default 5." },
      },
      required: ["slip_query"],
    },
  },
  {
    name: "request_coi_renewal",
    description:
      "Send a boater the public /coi-upload/[token] link to upload a renewed certificate of insurance. Use when a COI is expired or expiring soon. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        coi_query: { type: "string", description: "Either a COI id or 'expiring COI for <boater name>'." },
      },
      required: ["coi_query"],
    },
  },
  {
    name: "update_work_order",
    description:
      "Propose updating an existing work order — change status, priority, assignee, or due date. Requires human approval. Use for 'reassign WO-1042 to J. Reyes', 'mark Davis's haul-out urgent', 'complete the pump-out at A07', 'block WO-1050 until parts arrive'. Marking status='completed' fires the closeout chain (post invoice from quote, dispatch completion comm).",
    input_schema: {
      type: "object",
      properties: {
        work_order_query: {
          type: "string",
          description: "WO number ('WO-1042'), boater last name, or boater + activity descriptor ('Davis haul-out').",
        },
        status: {
          type: "string",
          enum: ["open", "scheduled", "in_progress", "blocked", "completed", "cancelled"],
          description: "New status. Omit if not changing status.",
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "urgent"],
          description: "New priority. Omit if not changing priority.",
        },
        assignee_name: {
          type: "string",
          description: "Free-text assignee label (e.g. 'J. Reyes'). Stored as the human-readable name until staff IDs stabilize.",
        },
        due_date: {
          type: "string",
          description: "ISO date YYYY-MM-DD. New due-by date.",
        },
      },
      required: ["work_order_query"],
    },
  },
  // ── Batch A: operator setup & catalog edits ──────────────────
  {
    name: "update_marina_profile",
    description:
      "Propose changes to the marina's identity record — display name, contact info, address, hours, tax rate, outbound sender labels. Requires human approval. Used everywhere the marina's identity surfaces (receipts, contracts, portal). Pass only the fields the user asked to change.",
    input_schema: {
      type: "object",
      properties: {
        display_name: { type: "string" },
        short_name: { type: "string" },
        tagline: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        website: { type: "string" },
        address_line1: { type: "string" },
        address_line2: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        postal_code: { type: "string" },
        country: { type: "string" },
        timezone: { type: "string" },
        business_hours_open: { type: "string" },
        business_hours_close: { type: "string" },
        default_tax_rate: { type: "number", description: "0..1 (e.g., 0.0825)" },
        outbound_email_from_name: { type: "string" },
        outbound_sms_sender_label: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "create_dock",
    description:
      "Propose adding a new physical dock (e.g. 'add D Dock' or 'create a transient dock with prefix T'). Requires human approval. The slip-id prefix drives auto-numbering when slips are later added under this dock.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Display name, e.g. 'Damsite D Dock'." },
        slip_prefix: { type: "string", description: "One or two-letter prefix that becomes the leading character on slip ids — e.g. 'D' makes slips D01, D02, ..." },
        sort_order: { type: "number", description: "Optional manual ordering. Lower sorts first." },
        active: { type: "boolean", description: "Default true." },
      },
      required: ["name", "slip_prefix"],
    },
  },
  {
    name: "update_dock",
    description:
      "Propose editing an existing dock (rename, change prefix, archive). Requires human approval. Renames cascade into the denormalized slip.dock display string on every slip on the dock.",
    input_schema: {
      type: "object",
      properties: {
        dock_query: { type: "string", description: "Dock id or name fragment, e.g. 'D Dock' or 'damsite c'." },
        name: { type: "string" },
        slip_prefix: { type: "string" },
        sort_order: { type: "number" },
        active: { type: "boolean" },
      },
      required: ["dock_query"],
    },
  },
  {
    name: "update_pos_location",
    description:
      "Propose editing a POS register's name, tax rate, icon, or active flag. The 4 location keys (fuel_dock / ship_store / restaurant / harbormaster) are fixed — only fields below can change. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        location_query: { type: "string", description: "Location id, name, or key (e.g. 'fuel dock')." },
        name: { type: "string" },
        icon_key: {
          type: "string",
          enum: ["fuel", "shop", "restaurant", "harbormaster", "marina"],
        },
        default_tax_rate: { type: "number", description: "0..1" },
        active: { type: "boolean" },
      },
      required: ["location_query"],
    },
  },
  {
    name: "create_pos_item",
    description:
      "Propose adding a new POS catalog item (e.g. 'add a $4 hot dog to the restaurant menu' or 'create a SKU for dock lines at $18'). Requires human approval. Each item belongs to one POS location — the agent resolves the location from the user's words.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Display name on receipts + tile, e.g. 'Hot dog'." },
        sku: { type: "string", description: "Short SKU code, e.g. 'HOTDOG'." },
        category: { type: "string", description: "Free-text grouping for the POS tile palette ('Mains', 'Drinks', 'Lines & Fenders', etc.)." },
        price: { type: "number" },
        cost: { type: "number", description: "Optional cost-of-goods for margin reports." },
        location_key: {
          type: "string",
          enum: ["fuel_dock", "ship_store", "restaurant", "harbormaster"],
          description: "Which POS register this item shows up on.",
        },
        taxable: { type: "boolean", description: "Default true." },
        active: { type: "boolean", description: "Default true." },
      },
      required: ["name", "sku", "category", "price", "location_key"],
    },
  },
  {
    name: "update_pos_item",
    description:
      "Propose editing an existing POS catalog item — change price, name, cost, category, or archive it. Requires human approval. Use for 'bump hot dog to $5', 'rename pretzel to soft pretzel', 'archive the off-season t-shirt'.",
    input_schema: {
      type: "object",
      properties: {
        item_query: { type: "string", description: "Item id, SKU, or name fragment." },
        name: { type: "string" },
        sku: { type: "string" },
        category: { type: "string" },
        price: { type: "number" },
        cost: { type: "number" },
        active: { type: "boolean", description: "Set false to soft-archive (preserves order history)." },
      },
      required: ["item_query"],
    },
  },
  {
    name: "create_fee",
    description:
      "Propose adding a new Additional Fee to the catalog (e.g. 'add a $30 pump-out fee' or 'create a winterization fee at $450 that auto-attaches to winterization work orders'). Requires human approval. Fees are the canonical SKU for service charges — see /services/fees.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Fee name, e.g. 'Pump-out Fee', 'Hoist Fee'." },
        amount: { type: "number" },
        recurrence: {
          type: "string",
          enum: ["one_time", "monthly", "annual"],
          description: "How often the fee recurs. One-time = single charge, annual = added to every annual-billing-run invoice.",
        },
        applies_to: {
          type: "string",
          enum: ["slip_contract", "work_order", "boat_rental", "pos", "annual_billing_run"],
          description: "Where the fee surfaces / when it auto-attaches.",
        },
        accounting_line_item: { type: "string", description: "GL mapping label — e.g. '2026/2027 Service Fees'. Required for QB sync." },
        description: { type: "string" },
        auto_attach: { type: "boolean", description: "When the applies_to scope hits, should the fee silently append to the closeout invoice? Default true." },
      },
      required: ["name", "amount", "recurrence", "applies_to", "accounting_line_item"],
    },
  },
  {
    name: "update_fee",
    description:
      "Propose editing an existing Additional Fee — change name, amount, recurrence, scope, or auto-attach behavior. Requires human approval. Use for 'bump pump-out to $35', 'rename hoist fee to crane service', 'make winterization auto-attach'.",
    input_schema: {
      type: "object",
      properties: {
        fee_query: { type: "string", description: "Fee id or name fragment ('pump-out', 'hoist')." },
        name: { type: "string" },
        amount: { type: "number" },
        recurrence: { type: "string", enum: ["one_time", "monthly", "annual"] },
        applies_to: {
          type: "string",
          enum: ["slip_contract", "work_order", "boat_rental", "pos", "annual_billing_run"],
        },
        auto_attach: { type: "boolean" },
      },
      required: ["fee_query"],
    },
  },
  // ── Batch D: bulk operations ─────────────────────────────────
  {
    name: "bulk_send_message",
    description:
      "Propose sending the same outbound comm to a group of boaters. Requires human approval — the operator sees the filter + recipient count + message preview before approving. Use for 'send arrival reminders to today's transients', 'broadcast the storm warning to everyone on B and C docks', 'remind everyone overdue'.",
    input_schema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          enum: [
            "arrivals_today",
            "departures_today",
            "overdue_balance",
            "expiring_soon",
            "all_active",
            "annual_holders",
            "transient_today",
          ],
          description: "Group selector. The server resolves to actual boater ids.",
        },
        channel: { type: "string", enum: ["email", "sms"] },
        subject: { type: "string" },
        body: { type: "string", description: "Use {{first_name}} for per-recipient personalization." },
      },
      required: ["filter", "channel", "body"],
    },
  },
  {
    name: "bulk_draft_renewals",
    description:
      "Propose drafting renewal contracts for a filtered set of expiring contracts. Requires human approval. Optionally bumps the annual rate by a percentage. Use for 'draft 2027 renewals for everyone expiring this fall' or 'draft renewals at +5% for D Dock'.",
    input_schema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          enum: ["expiring_90_days", "expiring_180_days", "all_active_annual"],
        },
        dock_query: { type: "string", description: "Optional — scope to a specific dock by name or prefix." },
        rate_adjustment_pct: {
          type: "number",
          description: "Percent change applied to each annual_rate. Positive = increase, negative = decrease. Default 0.",
        },
      },
      required: ["filter"],
    },
  },
  {
    name: "bulk_apply_fee",
    description:
      "Propose applying an Additional Fee as an open invoice line to every boater in a filter. Requires human approval. Use for 'charge winterization to all annual holders', 'add the $12 launch fee to every transient this weekend'.",
    input_schema: {
      type: "object",
      properties: {
        fee_query: { type: "string" },
        filter: {
          type: "string",
          enum: ["annual_holders", "seasonal_holders", "all_active", "transient_today"],
        },
      },
      required: ["fee_query", "filter"],
    },
  },
  {
    name: "run_billing_run",
    description:
      "Propose running the annual or monthly-recurring billing batch — generates invoices for every applicable holder and posts them to the ledger. Requires human approval. Equivalent to clicking 'Run Annual Billing' in /ledger.",
    input_schema: {
      type: "object",
      properties: {
        run_type: { type: "string", enum: ["annual", "monthly_recurring"] },
      },
      required: ["run_type"],
    },
  },
  {
    name: "run_qb_sync",
    description:
      "Propose pushing pending POS orders + invoices to QuickBooks. Requires human approval. Equivalent to clicking 'Push now' on the QB Sync tab.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  // ── Batch F: alerts + scheduled rules ────────────────────────
  {
    name: "create_threshold_rule",
    description:
      "Propose creating an alert rule that fires when a metric crosses a threshold. Requires human approval. Use for 'reorder gasoline when below 25%', 'flag balances > 90 days past due', 'alert when occupancy drops below 60%'.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["fuel_reorder", "occupancy_low", "ar_aging", "anomaly_spike"],
        },
        threshold_value: { type: "number" },
        threshold_unit: { type: "string", description: "'%' for percentages, '$' for currency, 'count' for raw counts, 'days' for time." },
        action: {
          type: "string",
          enum: ["notify_staff", "create_work_order", "send_message"],
        },
        notes: { type: "string", description: "Free-text context displayed when the alert fires." },
      },
      required: ["kind", "threshold_value", "threshold_unit", "action"],
    },
  },
  // ── Batch C: edit + lifecycle for existing entities ──────────
  {
    name: "update_boater",
    description:
      "Propose editing an existing boater — change contact info, preferred channel, billing cadence, notes, or active flag. Requires human approval. Use for 'change David's email to ...', 'switch Peterson to SMS preferences', 'archive the Smith account'.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: { type: "string", description: "Name, code, or id." },
        email: { type: "string" },
        phone: { type: "string" },
        preferred_channel: { type: "string", enum: ["email", "sms", "voice"] },
        billing_cadence: {
          type: "string",
          enum: ["annual", "seasonal", "monthly", "transient"],
        },
        notes: { type: "string" },
        active: { type: "boolean" },
      },
      required: ["boater_query"],
    },
  },
  {
    name: "update_vessel",
    description:
      "Propose editing an existing vessel — name, year/make/model, registration, hull VIN, active flag. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        vessel_query: { type: "string", description: "Vessel name fragment or id." },
        boater_query: { type: "string", description: "Optional — scope search to one boater's fleet." },
        name: { type: "string" },
        year: { type: "number" },
        make: { type: "string" },
        model: { type: "string" },
        registration: { type: "string" },
        hull_vin: { type: "string" },
        active: { type: "boolean" },
      },
      required: ["vessel_query"],
    },
  },
  {
    name: "update_contract",
    description:
      "Propose editing an existing contract — status, rate, effective dates. Requires human approval. Use for 'mark K-3042 active', 'bump Peterson's annual rate to $4,800', 'extend the seasonal slip through October'. Terminating a contract should use terminate_contract instead.",
    input_schema: {
      type: "object",
      properties: {
        contract_query: { type: "string", description: "Contract number, boater name, or id." },
        status: {
          type: "string",
          enum: ["draft", "sent", "partially_signed", "executed", "active", "expired", "terminated", "renewed"],
        },
        annual_rate: { type: "number" },
        effective_start: { type: "string" },
        effective_end: { type: "string" },
      },
      required: ["contract_query"],
    },
  },
  {
    name: "terminate_contract",
    description:
      "Propose terminating an active contract early. Requires human approval. Frees the assigned slip + fires the waitlist auto-notify chain.",
    input_schema: {
      type: "object",
      properties: {
        contract_query: { type: "string" },
        reason: { type: "string", description: "Optional internal note — why the contract ended early." },
      },
      required: ["contract_query"],
    },
  },
  {
    name: "update_reservation",
    description:
      "Propose editing a reservation — change dates, swap slips, add notes. Requires human approval. Use for 'move Peterson to A12 tomorrow night', 'extend David's stay by one night'.",
    input_schema: {
      type: "object",
      properties: {
        reservation_query: { type: "string", description: "Reservation number or boater name." },
        arrival_date: { type: "string" },
        departure_date: { type: "string" },
        slip_query: { type: "string", description: "New slip number to move into." },
        notes: { type: "string" },
      },
      required: ["reservation_query"],
    },
  },
  {
    name: "cancel_reservation",
    description:
      "Propose cancelling a reservation. Requires human approval. Frees the slip if currently held.",
    input_schema: {
      type: "object",
      properties: {
        reservation_query: { type: "string" },
        reason: { type: "string" },
      },
      required: ["reservation_query"],
    },
  },
  {
    name: "send_for_signature",
    description:
      "Propose sending a draft contract out for the boater to sign. Requires human approval. Mints the public /sign/[token] link + dispatches the contract_sent_for_signature comm. Equivalent to clicking 'Send for signature' in the UI.",
    input_schema: {
      type: "object",
      properties: {
        contract_query: { type: "string", description: "Contract number or boater name." },
      },
      required: ["contract_query"],
    },
  },
  // ── Batch B: comm templates + provider connections + roles + staff edit ─
  {
    name: "update_comm_template",
    description:
      "Propose editing a system comm template (receipt, contract sent, COI reminder, payment failure, etc.) — change subject, body, or active flag. Requires human approval. Use for 'edit the receipt template', 'rewrite the COI reminder', 'turn off the welcome email'.",
    input_schema: {
      type: "object",
      properties: {
        template_query: {
          type: "string",
          description: "Template kind or display name fragment (e.g. 'receipt', 'coi reminder', 'welcome new holder').",
        },
        subject: { type: "string", description: "New email subject (ignored for SMS-channel templates)." },
        body_markdown: { type: "string", description: "New body. Preserve any {{merge_tokens}} that should still resolve at send time." },
        active: { type: "boolean", description: "Turn the template on/off. When off, system falls back to hard-coded copy." },
      },
      required: ["template_query"],
    },
  },
  {
    name: "connect_provider",
    description:
      "Propose connecting an integration — Stripe (payments), QuickBooks (accounting), Postmark (email), Twilio (SMS). Requires human approval. In the prototype this just flips the 'connected' flag + records the config; production would walk through the OAuth handshake or API-key paste flow. Use for 'connect QuickBooks', 'enable Twilio for SMS'.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["payment", "email", "sms", "accounting"],
        },
        provider: {
          type: "string",
          description: "Provider name — 'stripe', 'quickbooks', 'postmark', 'twilio', etc.",
        },
      },
      required: ["kind", "provider"],
    },
  },
  {
    name: "disconnect_provider",
    description:
      "Propose disabling a previously-connected provider integration. Requires human approval. Preserves the config record for re-enable.",
    input_schema: {
      type: "object",
      properties: {
        provider_query: { type: "string", description: "Provider name or config id." },
      },
      required: ["provider_query"],
    },
  },
  {
    name: "create_role",
    description:
      "Propose creating a new staff role with a custom permission set. Requires human approval. Use for 'add a Bookkeeper role with view financials only', 'create a Night Manager role'.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Role display name." },
        description: { type: "string" },
        permissions: {
          type: "array",
          items: { type: "string" },
          description: "List of permission keys — e.g. ['view.financials', 'create.boater', 'manage.settings']. See lib/types.ts → PermissionKey for the full set.",
        },
      },
      required: ["name", "permissions"],
    },
  },
  {
    name: "update_role",
    description:
      "Propose editing an existing role — rename, change description, or adjust permissions. Requires human approval. Cannot delete system roles (Super admin / Manager / Dockhand).",
    input_schema: {
      type: "object",
      properties: {
        role_query: { type: "string", description: "Role id or name." },
        name: { type: "string" },
        description: { type: "string" },
        permissions: {
          type: "array",
          items: { type: "string" },
          description: "Replace the permission set entirely.",
        },
      },
      required: ["role_query"],
    },
  },
  {
    name: "update_staff",
    description:
      "Propose editing an existing staff member — change role, status (invited/active/suspended), or contact info. Requires human approval. Use 'promote Tiffany to Manager', 'suspend J. Reyes', 'change Will's phone to 231-555-0000'.",
    input_schema: {
      type: "object",
      properties: {
        staff_query: { type: "string", description: "Staff id, name, or email." },
        role: { type: "string", description: "New role name (Super admin / Manager / Dockhand / Office)." },
        status: {
          type: "string",
          enum: ["invited", "active", "suspended"],
        },
        phone: { type: "string" },
        email: { type: "string" },
      },
      required: ["staff_query"],
    },
  },
  {
    name: "invite_staff",
    description:
      "Propose inviting a new teammate (marina staff user) into Marina Stee. Requires human approval. Use when staff says 'add <person> as a <role>', 'invite <person> to the team', or 'create a new user'. The staff member is dropped in with status='invited' — production would mint an activation link + dispatch an email. If the user doesn't specify a role, default to 'Dockhand' (least-privileged) — they can change it from Settings → Staff afterwards.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Full name of the teammate, e.g. 'Steven Bills' or 'Tiffany Hart'.",
        },
        email: {
          type: "string",
          description: "Email for the activation link. If the user didn't provide one, synthesize a placeholder like 'firstname.lastname@example.com' so the operator can edit it post-approval.",
        },
        phone: { type: "string", description: "Optional cell number." },
        role: {
          type: "string",
          enum: ["Super admin", "Manager", "Dockhand", "Office", "Owner"],
          description: "Which role to assign. Match the user's words to the closest available role — 'admin' or 'owner' → Super admin, 'manager' → Manager, anything else → Dockhand by default.",
        },
      },
      required: ["name", "role"],
    },
  },
  // ── Rental Club ─────────────────────────────────────────────
  {
    name: "create_club_subscription",
    description:
      "Enroll an existing member into the Rental Club. Pick a plan tier (basic / plus / premium) which sets default monthly fee, join fee, and days-per-month allotment. Use when staff says 'add Jones to the plus plan' or 'enroll Morales in the rental club'.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: {
          type: "string",
          description:
            "Name fragment or boater id, e.g. 'Jones' or 'b_morales'.",
        },
        plan_tier: {
          type: "string",
          enum: ["basic", "plus", "premium"],
          description:
            "basic = 4 days/mo @ $199; plus = 8 days/mo @ $349; premium = 16 days/mo @ $599. Defaults to basic.",
        },
        join_fee: {
          type: "number",
          description: "Override default one-time join fee.",
        },
        monthly_fee: {
          type: "number",
          description: "Override default monthly subscription fee.",
        },
        days_per_month: {
          type: "number",
          description: "Override default booking allotment.",
        },
        notes: { type: "string" },
      },
      required: ["boater_query"],
    },
  },
  {
    name: "update_club_subscription",
    description:
      "Edit an existing club membership — change plan tier, fees, status (active / paused / past_due / cancelled), or notes. Use when staff says 'bump Jones to premium' or 'pause Singh's membership'.",
    input_schema: {
      type: "object",
      properties: {
        subscription_id: { type: "string" },
        boater_query: {
          type: "string",
          description: "Alternative to subscription_id — resolves via boater.",
        },
        plan_tier: {
          type: "string",
          enum: ["basic", "plus", "premium"],
        },
        status: {
          type: "string",
          enum: ["active", "paused", "cancelled", "past_due"],
        },
        join_fee: { type: "number" },
        monthly_fee: { type: "number" },
        days_per_month: { type: "number" },
        next_billing_date: { type: "string", description: "ISO YYYY-MM-DD." },
        notes: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "create_club_booking",
    description:
      "Schedule a club day for a member. Status defaults to 'confirmed' for staff bookings (use status='requested' to mirror a member request). Use when staff says 'book Jones for Saturday' or 'schedule Morales next Friday'.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: {
          type: "string",
          description: "Name fragment of an active club member.",
        },
        subscription_id: {
          type: "string",
          description: "Alternative to boater_query.",
        },
        date: {
          type: "string",
          description: "ISO YYYY-MM-DD.",
        },
        start_time: { type: "string", description: "Optional 'HH:MM'." },
        end_time: { type: "string", description: "Optional 'HH:MM'." },
        rental_boat_id: {
          type: "string",
          description: "Pre-assign a boat from the rental fleet.",
        },
        status: {
          type: "string",
          enum: ["confirmed", "requested"],
          description: "Default 'confirmed'.",
        },
        notes: { type: "string" },
      },
      required: ["date"],
    },
  },
  {
    name: "run_club_billing",
    description:
      "Propose running the Rental Club monthly billing batch — posts one monthly-fee invoice per active subscription and auto-charges any default cards on file. Requires human approval. Equivalent to clicking 'Post monthly billing' on /members → Rental Club.",
    input_schema: {
      type: "object",
      properties: {
        as_of_date: {
          type: "string",
          description:
            "Optional ISO YYYY-MM-DD. Defaults to today. Used as the invoice date.",
        },
      },
      required: [],
    },
  },
  {
    name: "run_club_reactivation",
    description:
      "Send a 'come back' message to every cancelled Rental Club member within the lookback window (default 30–90 days since cancellation). Caps to one outreach per ex-member, ever. Equivalent to clicking the 'Reactivate N' button on /members → Rental Club.",
    input_schema: {
      type: "object",
      properties: {
        min_days_ago: {
          type: "number",
          description: "Lower bound on days since cancellation. Default 30.",
        },
        max_days_ago: {
          type: "number",
          description: "Upper bound on days since cancellation. Default 90.",
        },
      },
      required: [],
    },
  },
  // ── Services catalog (S-grade parity wave) ──
  // Tools below cover the catalog surfaces under /services that the
  // agent previously couldn't touch. Each maps 1:1 to the UI "+ New"
  // / edit affordance on the matching manager.
  {
    name: "create_club_plan",
    description:
      "Propose adding a new Rental Club plan (e.g. 'add a $279 Plus plan with 8 days/month and a $599 join fee'). Plans live in the Rate catalog with occupancy_type='Rental Club' and cadence='monthly'; the operator picks one when enrolling a new member. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Plan name, e.g. 'Pontoon Club — Plus'." },
        plan_tier: {
          type: "string",
          enum: ["basic", "plus", "premium"],
          description: "Tier slot for retention-offer downgrade ranking.",
        },
        amount: { type: "number", description: "Monthly fee in dollars." },
        join_fee: { type: "number", description: "One-time signup fee." },
        days_per_month: { type: "number", description: "Booking allotment." },
      },
      required: ["name", "plan_tier", "amount", "days_per_month"],
    },
  },
  {
    name: "update_rate",
    description:
      "Propose editing an existing Rate (slip cadence, transient day-pass, or Rental Club plan). Use for 'bump the Plus plan to $375', 'rename 2026 Annual to 2027 Annual', or 'increase the daily transient rate by 10%'. Requires human approval. Existing club subscriptions carry their original price via the joined_at_* snapshot — edits affect new signups + future billing only.",
    input_schema: {
      type: "object",
      properties: {
        rate_query: { type: "string", description: "Rate id or name fragment, e.g. 'Plus', '2026 Annual'." },
        name: { type: "string" },
        amount: { type: "number" },
        join_fee: { type: "number", description: "Club plans only." },
        days_per_month: { type: "number", description: "Club plans only." },
      },
      required: ["rate_query"],
    },
  },
  {
    name: "set_boat_club_rotation",
    description:
      "Add or remove a rental boat from the Rental Club rotation. Use for 'put Pontoon 1 in the club rotation' or 'pull Skiff 14 out of club bookings — it's needed for walk-ins'. Toggling a boat into the rotation makes it pickable for club bookings + counts it toward day-capacity; removing it leaves walk-up rentals intact. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        boat_query: { type: "string", description: "Boat id or name fragment, e.g. 'Pontoon 1', 'Yellow Kayak'." },
        available_for_club: { type: "boolean", description: "true = in rotation, false = walk-up only." },
      },
      required: ["boat_query", "available_for_club"],
    },
  },
  {
    name: "create_rental_boat",
    description:
      "Add a new boat to the marina's rental fleet (e.g. 'add a third pontoon — 10-seat, $95/hr, home dock C14'). Boat defaults to status=available, active=true, and available_for_club=true so it rotates into the club; flip with set_boat_club_rotation if walk-up only. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Display name, e.g. 'Pontoon 3 — Sunrunner'." },
        type: {
          type: "string",
          enum: ["pontoon", "kayak", "paddleboard", "jet_ski", "fishing_skiff", "wakeboat"],
        },
        capacity: { type: "number", description: "Max passengers." },
        home_dock: { type: "string", description: "Optional pickup location label, e.g. 'Dock C — Slip C14'. Marina Stee no longer collects this from the UI wizard; pass only if the operator volunteers a value." },
        deposit_amount: { type: "number", description: "Refundable deposit authorized at pickup." },
        hourly_rate: { type: "number" },
        half_day_rate: { type: "number" },
        full_day_rate: { type: "number" },
        fuel_capacity_gal: { type: "number", description: "Only meaningful for motorized boats." },
        available_for_club: { type: "boolean", description: "Default true — in club rotation." },
        notes: { type: "string" },
      },
      required: ["name", "type", "capacity", "deposit_amount"],
    },
  },
  {
    name: "create_meter_reading",
    description:
      "Propose logging a new utility meter reading for a slip (e.g. 'log 1187 kWh on A29 today'). The reading rolls into the next utility-billing run via space_id → slip → current contract. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        space_query: { type: "string", description: "Slip id or number, e.g. 'A29', 'sp_dsm_a_29'." },
        meter_number: { type: "string", description: "Meter id label, e.g. '29-A'." },
        current_reading: { type: "number" },
        unit: { type: "string", enum: ["kWh", "gallons"], description: "Default kWh." },
        rate_per_unit: { type: "number", description: "$/unit override; defaults to slip's last rate." },
      },
      required: ["space_query", "current_reading"],
    },
  },
  {
    name: "create_slip",
    description:
      "Propose adding a new slip under an existing dock (e.g. 'add slip D14, covered, 40ft LOA, 14 beam, with power + water'). The slip auto-publishes to the Roster and becomes assignable for contracts. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        dock_query: { type: "string", description: "Dock id or name fragment ('D Dock', 'damsite a')." },
        number: { type: "string", description: "Slip number, e.g. '14'." },
        slip_class: { type: "string", enum: ["covered", "uncovered", "t_head", "buoy", "dry_storage"] },
        max_loa_inches: { type: "number" },
        max_beam_inches: { type: "number" },
        has_power: { type: "boolean", description: "Default true." },
        has_water: { type: "boolean", description: "Default true." },
        default_annual_rate: { type: "number", description: "Annual lease price; defaults to the dock's class rate." },
      },
      required: ["dock_query", "number", "slip_class", "max_loa_inches", "max_beam_inches"],
    },
  },
  {
    name: "create_rental_group",
    description:
      "Propose adding a new rental-inventory group (a dock, buoy field, dry-storage row). New marinas onboard their inventory by creating groups first, then adding spaces inside each. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Group name, e.g. 'Damsite C Dock'." },
        type: {
          type: "string",
          enum: ["slips", "buoy", "dry_storage", "jet_ski", "mooring", "day_rental"],
        },
        check_in_time: { type: "string", description: "e.g. '12:00 PM'." },
        check_out_time: { type: "string", description: "e.g. '11:00 AM'." },
        total_spaces: { type: "number" },
      },
      required: ["name", "type"],
    },
  },
  {
    name: "create_rental_space",
    description:
      "Propose adding a new space (slip / buoy / storage row) inside an existing group. Use for 'add a new jet-ski stall to PWC' or 'add buoy B-21'. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        group_query: { type: "string", description: "Group id or name fragment." },
        number: { type: "string", description: "Space number, e.g. '21', 'B-21'." },
        occupancy_type: {
          type: "string",
          enum: ["Standard", "Jet Ski", "Buoy", "Dry Storage", "Mooring"],
        },
        length_inches: { type: "number" },
        beam_inches: { type: "number" },
        has_power: { type: "boolean", description: "Default true." },
        has_water: { type: "boolean", description: "Default true." },
        has_pump_out: { type: "boolean", description: "Default false." },
      },
      required: ["group_query", "number", "occupancy_type"],
    },
  },
  {
    name: "create_insurance_certificate",
    description:
      "Propose adding a COI on file for a member's vessel (e.g. 'log David Emmons's renewed COI from State Farm, $500K liability, through next May'). The cert satisfies the dock gate as soon as it's approved. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: { type: "string", description: "Member name fragment, e.g. 'Emmons'." },
        vessel_query: { type: "string", description: "Vessel name or hull number." },
        carrier: { type: "string" },
        policy_number: { type: "string" },
        liability_limit: { type: "number" },
        hull_value: { type: "number" },
        effective_start: { type: "string", description: "YYYY-MM-DD" },
        effective_end: { type: "string", description: "YYYY-MM-DD" },
        pdf_url: { type: "string", description: "Optional link to the uploaded PDF." },
      },
      required: ["boater_query", "vessel_query", "carrier", "policy_number", "effective_start", "effective_end"],
    },
  },
  {
    name: "create_contract_template",
    description:
      "Propose adding a new contract template (e.g. 'create a winterization service template'). Templates feed every new contract draft — the boater + slip details merge in at draft time. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Template name." },
        type: {
          type: "string",
          enum: ["annual_slip", "seasonal_slip", "transient_slip", "dry_storage", "mooring", "rental", "winterization", "service"],
        },
        body_markdown: { type: "string", description: "Template body in markdown with merge fields like {{boater.display_name}}." },
      },
      required: ["name", "type", "body_markdown"],
    },
  },
  // ── Back office tools (Staffing / Vendor / Inventory / Assets) ──
  {
    name: "create_shift",
    description:
      "Schedule a shift for a staff member (e.g. 'schedule Dock Lead A for tomorrow 6am-2pm as Dockhand'). Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        staff_query: { type: "string", description: "Staff member name fragment." },
        date: { type: "string", description: "YYYY-MM-DD" },
        start_time: { type: "string", description: "HH:MM 24-hour, e.g. '06:00'." },
        end_time: { type: "string", description: "HH:MM 24-hour, e.g. '14:00'." },
        position: { type: "string", description: "e.g. 'Dockhand', 'Harbormaster'." },
      },
      required: ["staff_query", "date", "start_time", "end_time"],
    },
  },
  {
    name: "run_payroll",
    description:
      "Run a payroll cycle aggregating approved time entries between period_start and period_end. Salaried staff get their biweekly slice; hourly staff get hours × rate with OT over 80 in the period. Posts a Payroll Expense ledger entry. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        period_start: { type: "string", description: "YYYY-MM-DD" },
        period_end: { type: "string", description: "YYYY-MM-DD" },
        pay_date: { type: "string", description: "YYYY-MM-DD; defaults to today." },
      },
      required: ["period_start", "period_end"],
    },
  },
  {
    name: "create_certification",
    description:
      "Log a staff certification (e.g. 'add forklift cert for Dock Lead A, issued today, expires next year'). Surfaces on the staff page expiration buckets. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        staff_query: { type: "string" },
        name: { type: "string", description: "e.g. 'First Aid / CPR'." },
        issuer: { type: "string" },
        issued_at: { type: "string", description: "YYYY-MM-DD" },
        expires_at: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["staff_query", "name", "issued_at"],
    },
  },
  {
    name: "create_vendor",
    description:
      "Add a new vendor / supplier (e.g. 'add Sandia Marine, net 30, default GL Ship Store COGS'). Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Legal name." },
        display_name: { type: "string" },
        contact_name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        payment_terms: {
          type: "string",
          enum: ["due_on_receipt", "net_7", "net_15", "net_30", "net_60"],
        },
        default_gl_account: { type: "string" },
        issue_1099: { type: "boolean", description: "Default false." },
      },
      required: ["name", "payment_terms"],
    },
  },
  {
    name: "create_bill",
    description:
      "Log a new vendor bill (e.g. 'log $8,275 bill from Pinon Petroleum, invoice PP-19421, gas COGS, net 30'). Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        vendor_query: { type: "string", description: "Vendor name fragment." },
        number: { type: "string", description: "Vendor's invoice number." },
        bill_date: { type: "string", description: "YYYY-MM-DD; defaults to today." },
        due_date: { type: "string", description: "YYYY-MM-DD; auto-rolls from vendor's terms if omitted." },
        amount: { type: "number" },
        gl_account: { type: "string", description: "Falls back to vendor.default_gl_account." },
        notes: { type: "string" },
      },
      required: ["vendor_query", "number", "amount"],
    },
  },
  {
    name: "pay_bill",
    description:
      "Pay (or partial-pay) a vendor bill. Creates a BillPayment + posts a Cash / Operating outflow ledger entry. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        bill_query: { type: "string", description: "Bill number or vendor name fragment." },
        amount: { type: "number", description: "Defaults to the remaining balance if omitted." },
        method: {
          type: "string",
          enum: ["ach", "check", "card", "wire", "cash"],
        },
        check_number: { type: "string" },
      },
      required: ["bill_query", "method"],
    },
  },
  {
    name: "receive_stock",
    description:
      "Record stock arriving — bumps stock_on_hand on the POS catalog item. Use for 'received 24 dock lines from Sandia Marine'. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        item_query: { type: "string", description: "Item name or SKU fragment." },
        qty: { type: "number" },
        bill_query: { type: "string", description: "Optional bill to link this receive against." },
        notes: { type: "string" },
      },
      required: ["item_query", "qty"],
    },
  },
  {
    name: "create_asset",
    description:
      "Add a marina asset (forklift, hoist, pump-out station, etc.). Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        kind: {
          type: "string",
          enum: [
            "forklift", "boat_lift", "hoist", "pump_out_boat", "pump_out_station",
            "courtesy_cart", "fuel_pump", "fuel_tank", "fire_system",
            "compressor", "generator", "office_equipment", "other"
          ],
        },
        serial_number: { type: "string" },
        location: { type: "string" },
        purchase_date: { type: "string", description: "YYYY-MM-DD" },
        purchase_price: { type: "number" },
      },
      required: ["name", "kind"],
    },
  },
  {
    name: "create_pm_schedule",
    description:
      "Add a preventive-maintenance schedule for an asset (e.g. 'annual hoist inspection every April'). Auto-creates a work order when next_due_at is within auto_create_wo_days_ahead. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        asset_query: { type: "string" },
        name: { type: "string", description: "PM label, e.g. 'Annual safety inspection'." },
        cadence: {
          type: "string",
          enum: ["weekly", "monthly", "quarterly", "semi_annual", "annual"],
        },
        next_due_at: { type: "string", description: "YYYY-MM-DD" },
        auto_create_wo_days_ahead: { type: "number", description: "Default 14." },
      },
      required: ["asset_query", "name", "cadence", "next_due_at"],
    },
  },
  {
    name: "run_pm_check",
    description:
      "Scan all active PM schedules and auto-create a Work Order for any PM whose next_due_at is within its auto_create_wo_days_ahead window. Skips PMs that already have an open WO from the current cycle. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  // ── Back office round 2 — time-card + staff + stock-adjust tools ──
  {
    name: "approve_time_entry",
    description:
      "Approve a pending time entry (closed clock-in/out, no supervisor signoff yet). Resolves by staff name + the entry's date. Use for 'approve Dock Lead A's Tuesday time card'. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        staff_query: { type: "string", description: "Staff name fragment." },
        date: { type: "string", description: "YYYY-MM-DD — the calendar date the entry started on." },
      },
      required: ["staff_query", "date"],
    },
  },
  {
    name: "create_staff",
    description:
      "Add a new staff member with wage profile (e.g. 'add Jamie Reyes as a Dockhand, W2 hourly $22/hr, email jamie@…'). Creates the account in 'invited' status — they need to accept the email before they can log in. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Full name." },
        email: { type: "string" },
        phone: { type: "string" },
        default_position: { type: "string", description: "e.g. 'Dockhand', 'Manager'." },
        employment_type: { type: "string", enum: ["w2", "1099"] },
        hourly_rate: { type: "number", description: "$/hr — set for hourly W2 / 1099." },
        salary_annual: { type: "number", description: "$/yr — set for salaried W2 instead of hourly_rate." },
        hire_date: { type: "string", description: "YYYY-MM-DD; defaults to today." },
        mobile_clock_pin: { type: "string", description: "4-digit PIN for /dock clock-in." },
      },
      required: ["name", "email", "default_position", "employment_type"],
    },
  },
  {
    name: "update_staff_wage",
    description:
      "Update wage fields on an existing staff member (e.g. 'bump Dock Lead A to $26/hr', 'switch Jamie to salaried $58k'). Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        staff_query: { type: "string", description: "Staff name fragment." },
        hourly_rate: { type: "number" },
        salary_annual: { type: "number" },
        employment_type: { type: "string", enum: ["w2", "1099"] },
        ot_multiplier: { type: "number" },
      },
      required: ["staff_query"],
    },
  },
  {
    name: "adjust_stock",
    description:
      "Operator-entered stock count correction. delta can be positive or negative (e.g. 'count off by -3 on dock lines after manual recount'). Posts a StockMovement kind=adjust. Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        item_query: { type: "string", description: "Item name or SKU fragment." },
        delta: { type: "number", description: "+ adds to stock_on_hand, - removes." },
        notes: { type: "string" },
      },
      required: ["item_query", "delta"],
    },
  },
  {
    name: "log_stock_loss",
    description:
      "Record damaged / lost / stolen stock — decrements stock_on_hand and posts a StockMovement kind=loss. qty is the positive count lost (the executor flips the sign). Requires human approval.",
    input_schema: {
      type: "object",
      properties: {
        item_query: { type: "string", description: "Item name or SKU fragment." },
        qty: { type: "number", description: "Positive count of units lost." },
        reason: { type: "string", description: "e.g. 'expired', 'broken in shipping', 'shrinkage'." },
        notes: { type: "string" },
      },
      required: ["item_query", "qty"],
    },
  },
  // navigate_to + schedule_reminder live in lib/agent-tools/*.ts and
  // get spread in via REGISTRY_TOOLS below — see lib/agent-tool-kit.ts
  // for the defineTool convention.
];

// Merge in registry-backed tools (new tools built with defineTool live
// in lib/agent-tools/*.ts and register themselves via the index import).
const REGISTRY_TOOLS = registeredToolSchemas();
const ACTION_TOOLS_COMBINED = [...ACTION_TOOLS, ...REGISTRY_TOOLS];
const ALL_TOOLS = [...READ_TOOLS, ...ACTION_TOOLS_COMBINED];
const ACTION_TOOL_NAMES = new Set(ACTION_TOOLS_COMBINED.map((t) => t.name));

// ────────────────────────────────────────────────────────────
// Holder-mode tools
//
// Narrower registry exposed when mode="holder". Every tool is implicitly
// scoped to the signed-in holder's boater_id — the executor injects it
// so the LLM never has to (and never can) reference another holder.
// ────────────────────────────────────────────────────────────

const HOLDER_READ_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "query_my_balance",
    description:
      "Returns the holder's current open balance + list of unpaid invoices. Use for 'what's my balance', 'show my invoices', 'do I owe anything'.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "query_my_history",
    description:
      "Returns the holder's recent ledger activity (invoices + payments + refunds). Use for 'show my history', 'what did I pay last month'.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max rows to return. Default 10." },
      },
      required: [],
    },
  },
  {
    name: "query_my_vessels",
    description:
      "Returns the holder's vessels on file. Use for 'what boats do you have on file', 'list my vessels'.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "query_my_contract",
    description:
      "Returns the holder's active contract terms (slip, season, rate, dates). Use for 'review my contract', 'what's my slip rate', 'when does my contract end'.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "query_my_cards",
    description:
      "Returns the cards on file for this holder (brand + last 4 only — never the full PAN). Use for 'what card do you have on file' or before remove_card.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  // ── Holder saved reports (table cards in chat) ──────────────
  // Prefer these for ANY request that needs a list ("show me my
  // invoices", "what have I paid this year", "list my vessels").
  // The chat renders a real table; the query_my_* tools only return
  // counts/single facts.
  {
    name: "report_my_balance",
    description:
      "Returns the holder's open invoices as a table — invoice / date / description / amount / open. Use for 'show me my open invoices', 'what do I owe and on which invoice', 'list of unpaid'.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "report_my_history",
    description:
      "Returns the holder's recent ledger activity as a table — date / type / reference / description / amount. Use for 'show me what I've paid', 'recent activity', 'transaction history'.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max rows, 1-50. Default 20." },
      },
      required: [],
    },
  },
  {
    name: "report_my_vessels",
    description:
      "Returns the holder's vessels as a table — vessel / year / make / model / length. Use for 'show me my boats', 'list my vessels'.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

const HOLDER_ACTION_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "holder_message_marina",
    description:
      "Send a free-text message to marina staff. Use for general questions, heads-ups, or anything that doesn't fit a more specific tool.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Short subject (optional)." },
        body: { type: "string", description: "The full message body." },
      },
      required: ["body"],
    },
  },
  {
    name: "holder_request_work_order",
    description:
      "Submit a service request to the marina. Creates a Work Order in 'open' status tagged 'From holder' on the staff kanban.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Short summary, e.g. 'Bilge pump making noise'." },
        description: { type: "string", description: "Detail / context." },
        activity_type: {
          type: "string",
          enum: ["pump_out", "service", "inspection", "haul_out", "winterization", "bottom_paint", "task", "other"],
          description: "Type of work. Default 'service'.",
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "urgent"],
          description: "Priority. Default 'normal'.",
        },
        preferred_date: {
          type: "string",
          description: "ISO YYYY-MM-DD if the holder requested a specific date.",
        },
      },
      required: ["subject"],
    },
  },
  {
    name: "holder_schedule_pump_out",
    description:
      "Schedule a pump-out — the most common holder request, broken out for speed. Same result as a request_work_order with activity_type=pump_out.",
    input_schema: {
      type: "object",
      properties: {
        preferred_date: { type: "string", description: "ISO YYYY-MM-DD." },
        notes: { type: "string", description: "Optional details." },
      },
      required: [],
    },
  },
  {
    name: "holder_pay_balance",
    description:
      "Pay an open invoice (or all open invoices) using a card on file. Posts a payment to the ledger and auto-applies it to the matching invoices.",
    input_schema: {
      type: "object",
      properties: {
        amount: {
          type: "number",
          description: "Dollars. If omitted, defaults to the full open balance.",
        },
        method: {
          type: "string",
          enum: ["card", "ach"],
          description: "Payment method. Default 'card'.",
        },
        card_id: {
          type: "string",
          description: "Specific card on file. If omitted, uses the default card.",
        },
        applied_to_invoice_ids: {
          type: "array",
          items: { type: "string" },
          description: "Specific invoice ids. If omitted, applied oldest-first across all open invoices.",
        },
      },
      required: [],
    },
  },
  {
    name: "holder_update_contact",
    description:
      "Update the holder's contact info — email, phone, or mailing address. Only the fields supplied get changed.",
    input_schema: {
      type: "object",
      properties: {
        email: { type: "string" },
        phone: { type: "string" },
        address_line_1: { type: "string" },
        address_line_2: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        postal_code: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "holder_add_card",
    description:
      "Add a new card on file for this holder. In production this surfaces a Stripe Element; here we accept the card details directly for prototype use.",
    input_schema: {
      type: "object",
      properties: {
        brand: {
          type: "string",
          enum: ["visa", "mastercard", "amex", "discover"],
        },
        last4: { type: "string", description: "Last 4 digits." },
        exp_month: { type: "number" },
        exp_year: { type: "number" },
        nickname: { type: "string", description: "Optional label, e.g. 'Boat card'." },
        is_default: {
          type: "boolean",
          description: "Make this the default for future auto-payments.",
        },
      },
      required: ["brand", "last4", "exp_month", "exp_year"],
    },
  },
  {
    name: "holder_remove_card",
    description:
      "Remove a card from the holder's file. Use query_my_cards first to get the card_id.",
    input_schema: {
      type: "object",
      properties: {
        card_id: { type: "string", description: "ID returned from query_my_cards." },
        card_summary: {
          type: "string",
          description: "Human label for the confirmation card, e.g. 'Visa ending 4242'.",
        },
      },
      required: ["card_id", "card_summary"],
    },
  },
  {
    name: "holder_request_slip_change",
    description:
      "Request a different slip. Operator-gated — creates a tagged message in the staff inbox; the marina follows up.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why the holder wants to change slips." },
        desired_slip_traits: {
          type: "string",
          description: "Free text — 'wider beam', 'covered', 'B Dock', etc.",
        },
      },
      required: ["reason"],
    },
  },
  {
    name: "holder_request_termination",
    description:
      "Request to terminate / cancel the current contract. Operator-gated — creates a tagged termination request in the staff inbox. The marina applies their notice period + countersignature workflow.",
    input_schema: {
      type: "object",
      properties: {
        desired_end_date: { type: "string", description: "ISO YYYY-MM-DD." },
        reason: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "holder_request_renewal_inquiry",
    description:
      "Ask about renewing for next season. Operator-gated — routes to staff who reply with terms.",
    input_schema: {
      type: "object",
      properties: {
        season_year: { type: "number", description: "Season being inquired about, e.g. 2027." },
        questions: { type: "string", description: "What the holder wants to know." },
      },
      required: ["questions"],
    },
  },
  // ── Rental Club (member-side) ───────────────────────────────
  // Both tools are implicitly scoped to the signed-in member's
  // subscription. The executor injects subscription_id + boater_id from
  // session, so the LLM never has to (and never can) reference another
  // member's bookings.
  {
    name: "holder_request_club_booking",
    description:
      "Request a Rental Club day. The marina confirms the boat assignment afterward — this creates a booking with status='requested'. Use when the member says 'book me Saturday', 'I'd like the pontoon next Friday', or 'request a day next week'.",
    input_schema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "ISO YYYY-MM-DD of the requested day.",
        },
        notes: {
          type: "string",
          description: "Optional — boat preference, party size, etc.",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "holder_cancel_club_booking",
    description:
      "Cancel one of the member's own Rental Club bookings. Use when the member says 'cancel my Saturday booking' or 'I can't make next Friday'. Sets status='cancelled' without deleting the record so staff still see the history.",
    input_schema: {
      type: "object",
      properties: {
        booking_id: {
          type: "string",
          description: "Specific booking to cancel.",
        },
        date: {
          type: "string",
          description:
            "ISO YYYY-MM-DD — used when booking_id is not known. Cancels the member's booking on that date.",
        },
      },
      required: [],
    },
  },
];

const HOLDER_ALL_TOOLS = [...HOLDER_READ_TOOLS, ...HOLDER_ACTION_TOOLS];
const HOLDER_ACTION_TOOL_NAMES = new Set(
  HOLDER_ACTION_TOOLS.map((t) => t.name)
);

// ────────────────────────────────────────────────────────────
// Read-only tool execution (server-side)
// ────────────────────────────────────────────────────────────

function executeReadTool(
  name: string,
  input: Record<string, unknown>,
  ledger: LedgerEntry[],
  scopedBoaters: typeof BOATERS,
  tenantId: string = "ten_marina_stee_demo"
): unknown {
  if (name === "query_open_balances") {
    const minAmount = Number(input.min_amount ?? 0);
    // Scoped to active tenant — staff agent can't reach into another
    // marina's A/R aging.
    const ranked = scopedBoaters
      .map((b) => {
        const open = ledger
          .filter((l) => l.boater_id === b.id && l.type === "invoice")
          .reduce((s, l) => s + l.open_balance, 0);
        return {
          boater_id: b.id,
          display_name: b.display_name,
          code: b.code,
          open,
        };
      })
      .filter((r) => r.open >= minAmount && r.open > 0)
      .sort((a, b) => b.open - a.open);
    return {
      count: ranked.length,
      total_open: ranked.reduce((s, r) => s + r.open, 0),
      boaters: ranked,
    };
  }

  if (name === "query_meter_anomalies") {
    const anomalous = METER_READINGS.filter(meterAnomaly).map((m) => {
      const sp = RENTAL_SPACES.find((s) => s.id === m.space_id);
      return {
        slip_number: sp?.number,
        meter_number: m.meter_number,
        delta: meterDelta(m),
        unit: m.unit,
        current_reading: m.current_reading,
      };
    });
    return { count: anomalous.length, readings: anomalous };
  }

  if (name === "query_fee_usage") {
    const q =
      typeof input.fee_query === "string"
        ? (input.fee_query as string).toLowerCase().trim()
        : "";
    // Tenant-scoped fee universe — Lakeside operators querying fee
    // usage shouldn't see Marina Stee's pump-out fee. Legacy rows
    // without tenant_id default to the primary tenant.
    const tenantScopedFees = ADDITIONAL_FEES.filter(
      (f) => (f.tenant_id ?? "ten_marina_stee_demo") === tenantId
    );
    const matches = q
      ? tenantScopedFees.filter(
          (f) =>
            f.name.toLowerCase().includes(q) ||
            f.id.toLowerCase().includes(q) ||
            (f.description ?? "").toLowerCase().includes(q)
        )
      : tenantScopedFees;
    const rows = matches.map((f) => {
      const lname = f.name.toLowerCase();
      // Invoices that reference this fee by name (demo-grade)
      const invoice_refs = ledger.filter(
        (l) =>
          l.type === "invoice" &&
          (l.line_items ?? []).some((li) =>
            li.description.toLowerCase().includes(lname)
          )
      );
      // Work orders matching the linked activity type
      const wo_refs = f.linked_activity_type
        ? WORK_ORDERS.filter((w) => w.activity_type === f.linked_activity_type)
        : [];
      // Linked contract template (if any)
      const linked_template = f.linked_template_id
        ? CONTRACT_TEMPLATES.find((t) => t.id === f.linked_template_id)?.name
        : undefined;
      return {
        fee_id: f.id,
        name: f.name,
        amount: f.amount,
        recurrence: f.recurrence,
        applies_to: f.applies_to,
        invoice_count: invoice_refs.length,
        work_order_count: wo_refs.length,
        linked_template,
        linked_activity_type: f.linked_activity_type,
        auto_attach: f.auto_attach ?? false,
        total_usage:
          invoice_refs.length + wo_refs.length + (linked_template ? 1 : 0),
      };
    });
    return { count: rows.length, fees: rows };
  }

  if (name === "query_arrivals_today") {
    const date =
      typeof input.date === "string" && input.date
        ? input.date
        : new Date().toISOString().slice(0, 10);
    // boaterById built once — every /api/agent call that routes to
    // this tool used to do RESERVATIONS × BOATERS lookups per row.
    const boaterById = new Map(BOATERS.map((b) => [b.id, b]));
    const rows = RESERVATIONS.filter((r) => r.arrival_date === date)
      .map((r) => {
        const b = boaterById.get(r.boater_id);
        return {
          reservation_number: r.number,
          boater_name: b?.display_name,
          slip_id: r.slip_id,
          arrival_date: r.arrival_date,
          departure_date: r.departure_date,
          type: r.type,
        };
      });
    return { count: rows.length, date, arrivals: rows };
  }

  if (name === "query_departures_today") {
    const date =
      typeof input.date === "string" && input.date
        ? input.date
        : new Date().toISOString().slice(0, 10);
    const boaterById = new Map(BOATERS.map((b) => [b.id, b]));
    const rows = RESERVATIONS.filter((r) => r.departure_date === date)
      .map((r) => {
        const b = boaterById.get(r.boater_id);
        return {
          reservation_number: r.number,
          boater_name: b?.display_name,
          slip_id: r.slip_id,
        };
      });
    return { count: rows.length, date, departures: rows };
  }

  if (name === "query_revenue_summary") {
    const window = String(input.window ?? "this_month");
    const now = new Date();
    let from: Date;
    let to: Date = now;
    if (window === "last_month") {
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      to = new Date(now.getFullYear(), now.getMonth(), 0);
    } else if (window === "this_quarter") {
      const q = Math.floor(now.getMonth() / 3);
      from = new Date(now.getFullYear(), q * 3, 1);
    } else if (window === "ytd") {
      from = new Date(now.getFullYear(), 0, 1);
    } else {
      // this_month
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    const fromIso = from.toISOString().slice(0, 10);
    const toIso = to.toISOString().slice(0, 10);
    const inWindow = ledger.filter(
      (l) => l.type === "invoice" && l.date >= fromIso && l.date <= toIso
    );
    const totalInvoiced = inWindow.reduce((s, l) => s + l.amount, 0);
    const totalOpen = inWindow.reduce((s, l) => s + l.open_balance, 0);
    return {
      window,
      from: fromIso,
      to: toIso,
      invoiced: totalInvoiced,
      paid: totalInvoiced - totalOpen,
      outstanding: totalOpen,
      invoice_count: inWindow.length,
    };
  }

  if (name === "query_occupancy") {
    // Occupancy derived from active contracts referencing each slip.
    // The Slip type doesn't carry status directly today — contracts +
    // reservations are the source of truth.
    const activeContractSlipIds = new Set(
      CONTRACTS.filter((c) => c.status === "active" && c.slip_id).map(
        (c) => c.slip_id!,
      ),
    );
    const total = SLIPS.length;
    let occupied = 0;
    const byDock: Record<string, { occupied: number; vacant: number; total: number }> = {};
    for (const s of SLIPS) {
      byDock[s.dock] ??= { occupied: 0, vacant: 0, total: 0 };
      byDock[s.dock].total += 1;
      if (activeContractSlipIds.has(s.id)) {
        occupied += 1;
        byDock[s.dock].occupied += 1;
      } else {
        byDock[s.dock].vacant += 1;
      }
    }
    return {
      total,
      occupied,
      vacant: total - occupied,
      occupancy_pct: total > 0 ? Math.round((occupied / total) * 100) : 0,
      by_dock: byDock,
    };
  }

  if (name === "query_active_work_orders") {
    const assignee = input.assignee ? String(input.assignee) : "";
    const active = WORK_ORDERS.filter((w) =>
      ["open", "scheduled", "in_progress", "blocked"].includes(w.status)
    ).filter((w) => (assignee ? w.assignee_user_id === assignee : true));
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    for (const w of active) {
      byStatus[w.status] = (byStatus[w.status] ?? 0) + 1;
      byPriority[w.priority] = (byPriority[w.priority] ?? 0) + 1;
    }
    return {
      count: active.length,
      by_status: byStatus,
      by_priority: byPriority,
      work_orders: active.slice(0, 25).map((w) => ({
        number: w.number,
        subject: w.subject,
        status: w.status,
        priority: w.priority,
        assignee: w.assignee_user_id,
      })),
    };
  }

  if (name === "query_contract_expiry") {
    const daysWindow = Number(input.days_window ?? 90);
    const now = Date.now();
    // ISO-string cutoffs via the canonical helpers — keeps the agent's
    // answer aligned with the operator-facing /services KPI and the
    // boater-list classifier. Preserves the `status === "active"`
    // narrowing — see migration report C3 (widening to isLiveContract
    // would change the agent's tool output without product sign-off).
    const todayIso = localIsoDate();
    const cutoffIso = localIsoDate(
      new Date(now + daysWindow * 86_400_000),
    );
    const boaterById = new Map(BOATERS.map((b) => [b.id, b]));
    const expiring = CONTRACTS.filter((c) => c.status === "active")
      .filter((c) => isExpiringWithin(c, todayIso, cutoffIso))
      .map((c) => {
        const b = boaterById.get(c.boater_id);
        const days_remaining = Math.round(
          (new Date(c.effective_end).getTime() - now) / 86_400_000
        );
        return {
          contract_number: c.number,
          boater_id: c.boater_id,
          boater_name: b?.display_name,
          effective_end: c.effective_end,
          annual_rate: c.annual_rate,
          days_remaining,
        };
      })
      .sort((a, b) => a.days_remaining - b.days_remaining);
    return { count: expiring.length, contracts: expiring };
  }

  // ── Saved reports ──────────────────────────────────────────
  // Each returns a TableResult { kind: "table", ... } — the chat
  // host renders this as a structured card instead of markdown.
  if (name === "report_open_balances") {
    const minAmount =
      typeof input.min_amount === "number" ? input.min_amount : undefined;
    return reportOpenBalances(ledger, scopedBoaters, { min_amount: minAmount });
  }
  if (name === "report_renewals_by_month") {
    const monthsAhead =
      typeof input.months_ahead === "number" ? input.months_ahead : undefined;
    return reportRenewalsByMonth({ months_ahead: monthsAhead });
  }
  if (name === "report_occupancy_by_dock") {
    return reportOccupancyByDock();
  }
  if (name === "report_contracts_expiring") {
    const withinDays =
      typeof input.within_days === "number" ? input.within_days : undefined;
    return reportContractsExpiring(scopedBoaters, { within_days: withinDays });
  }
  if (name === "report_lapsed_accounts") {
    return reportLapsedAccounts(ledger, scopedBoaters);
  }
  if (name === "report_revenue_by_category") {
    const window =
      input.window === "this_month" ||
      input.window === "last_month" ||
      input.window === "this_quarter" ||
      input.window === "ytd"
        ? input.window
        : undefined;
    return reportRevenueByCategory(ledger, { window });
  }
  if (name === "report_top_revenue_boaters") {
    const window =
      input.window === "this_month" ||
      input.window === "last_month" ||
      input.window === "this_quarter" ||
      input.window === "ytd"
        ? input.window
        : undefined;
    const limit = typeof input.limit === "number" ? input.limit : undefined;
    return reportTopRevenueBoaters(ledger, scopedBoaters, { window, limit });
  }
  if (name === "report_work_order_aging") {
    return reportWorkOrderAging();
  }
  if (name === "report_meter_consumption_top") {
    const limit = typeof input.limit === "number" ? input.limit : undefined;
    return reportMeterConsumptionTop(scopedBoaters, { limit });
  }
  if (name === "report_arrivals_window") {
    const daysAhead = typeof input.days_ahead === "number" ? input.days_ahead : undefined;
    return reportArrivalsWindow({ days_ahead: daysAhead });
  }

  return { error: `unknown read tool: ${name}` };
}

// ────────────────────────────────────────────────────────────
// Context snapshot for the system prompt (always-on context)
// ────────────────────────────────────────────────────────────

// Intentionally static across requests so the entire system block can be
// prompt-cached. Anything that changes per-request (live ledger totals,
// timestamps, request IDs) must NOT be interpolated here — it would
// invalidate the cache on every call. The agent has query_* tools for
// fetching live data on demand.
// ────────────────────────────────────────────────────────────
// Holder-mode read tool execution (server-side, auto-scoped)
// ────────────────────────────────────────────────────────────

function executeHolderReadTool(
  name: string,
  input: Record<string, unknown>,
  boaterId: string,
  ledger: LedgerEntry[]
): unknown {
  const boater = BOATERS.find((b) => b.id === boaterId);
  if (!boater) return { error: "holder_not_found" };

  if (name === "query_my_balance") {
    const myInvoices = ledger
      .filter((l) => l.boater_id === boaterId && l.type === "invoice")
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const openInvoices = myInvoices
      .filter((l) => l.open_balance > 0)
      .map((l) => ({
        invoice_id: l.id,
        number: l.number,
        date: l.date,
        amount: l.amount,
        open_balance: l.open_balance,
      }));
    const open = openInvoices.reduce((s, l) => s + l.open_balance, 0);
    return {
      boater_id: boaterId,
      open_balance: open,
      open_invoice_count: openInvoices.length,
      invoices: openInvoices,
    };
  }

  if (name === "query_my_history") {
    const limit = Number(input.limit ?? 10);
    const rows = ledger
      .filter((l) => l.boater_id === boaterId)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, limit)
      .map((l) => ({
        id: l.id,
        type: l.type,
        number: l.number,
        date: l.date,
        amount: l.amount,
        open_balance: l.open_balance,
        method: l.method,
        status: l.status,
      }));
    return { count: rows.length, rows };
  }

  if (name === "query_my_vessels") {
    const vessels = VESSELS.filter(
      (v) => v.boater_id === boaterId || v.co_owner_ids.includes(boaterId)
    ).map((v) => ({
      vessel_id: v.id,
      name: v.name,
      year: v.year,
      make: v.make,
      model: v.model,
      vessel_type: v.vessel_type,
      fuel_type: v.fuel_type,
      loa_inches: v.loa_inches,
    }));
    return { count: vessels.length, vessels };
  }

  if (name === "query_my_contract") {
    const myContracts = CONTRACTS.filter((c) => c.boater_id === boaterId);
    const active = myContracts.find((c) => c.status === "executed") ?? myContracts[0];
    if (!active) return { contract: null };
    return {
      contract: {
        contract_id: active.id,
        number: active.number,
        status: active.status,
        effective_start: active.effective_start,
        effective_end: active.effective_end,
        annual_rate: active.annual_rate,
        billing_cadence: active.billing_cadence,
        slip_id: active.slip_id,
        vessel_id: active.vessel_id,
        signed_at: active.signed_at,
      },
    };
  }

  if (name === "query_my_cards") {
    // Cards live in the client store on real holders; for the server-side
    // read here, we can only see seeded cards (CARDS_ON_FILE map). The
    // holder agent UI also has `useCardsForBoater` for live cards on the
    // page itself — staff-side data fall back is fine.
    // We return what we know; the action card preview in the browser will
    // refresh against the live store.
    return {
      // We pull from BOATERS only — the seed cards map is large; the
      // holder shell hydrates live cards client-side anyway.
      note: "Cards on file are device-local in the prototype. The portal UI shows live cards alongside the agent.",
    };
  }

  // ── Holder reports (return TableResult) ────────────────────
  if (name === "report_my_balance") {
    return reportMyBalance(ledger, boater);
  }
  if (name === "report_my_history") {
    const limit = typeof input.limit === "number" ? input.limit : undefined;
    return reportMyHistory(ledger, boater, { limit });
  }
  if (name === "report_my_vessels") {
    const vessels = VESSELS.filter(
      (v) => v.boater_id === boaterId || v.co_owner_ids.includes(boaterId),
    ).map((v) => ({
      id: v.id,
      name: v.name,
      year: v.year,
      make: v.make,
      model: v.model,
      length_inches: v.loa_inches,
    }));
    return reportMyVessels(vessels);
  }

  return { error: "unknown_holder_tool", name };
}

function buildContext(scopedBoaters: typeof BOATERS): string {
  const occupied = RENTAL_SPACES.filter((s) => s.status === "occupied").length;
  const vacant = RENTAL_SPACES.filter((s) => s.status === "vacant").length;

  return `STATIC SNAPSHOT (stable mock data — for fresh numbers, call the query_* tools):

Slip occupancy: ${occupied}/${RENTAL_SPACES.length} (${vacant} vacant)
Meter anomalies flagged: ${METER_READINGS.filter(meterAnomaly).length}
Active contracts: ${CONTRACTS.filter((c) => c.status === "active").length}

Boaters in the system (this tenant only):
${scopedBoaters.map((b) => `  - ${b.display_name} (id=${b.id}, code=${b.code ?? "—"}, ${b.billing_cadence}, prefers ${b.communication_prefs.preferred_channel})`).join("\n")}

Rental groups: ${RENTAL_GROUPS.map((g) => g.name).join(", ")}.

For specific data, use the query_* tools — they return live results.`;
}

const SYSTEM_PROMPT = `You are the Marina Stee agent — a concise, operational assistant for marina staff.

Style:
- Reply in 1-3 short sentences unless the user asks for detail.
- Lead with the answer. Numbers come first; reasoning second.
- Use marina vocabulary: boater (not customer), slip (not space), transient (not walk-in), work order (not ticket), charge-to-account (not invoice on file).
- Never invent boater names, slip numbers, or balances. Use only tool results or the SNAPSHOT.

Tools:
- query_* tools auto-execute server-side; you'll see the result and can use it to inform your next step.
- All action tools are PROPOSED — the staff member must approve each in the UI. You can propose multiple in one turn (e.g. one per overdue boater after a query_open_balances call).
- Available actions: ${ACTION_TOOLS_COMBINED.map((t) => t.name).join(", ")}.
- Read tools (return JSON for chaining): query_open_balances, query_meter_anomalies, query_contract_expiry, query_fee_usage, query_arrivals_today, query_departures_today, query_revenue_summary, query_occupancy, query_active_work_orders.
- Saved reports (return a TABLE the operator can scan + export + click into rows): report_open_balances, report_renewals_by_month, report_occupancy_by_dock, report_contracts_expiring, report_lapsed_accounts, report_revenue_by_category, report_top_revenue_boaters, report_work_order_aging, report_meter_consumption_top, report_arrivals_window. PREFER these for any "list of X", "report on Y", "show me Z" ask. Use query_* for narrow single-fact questions ("how many" / "who has the largest" / "what's the total").
- Anything the staff can do via "+ New" buttons in the UI, you can propose with the matching tool. Default sensible values when the user is vague (e.g. preferred_channel=email, billing_cadence=transient for new boaters; activity_type=service, priority=normal for work orders).
- schedule_reminder lets you queue a future-dated SMS/email follow-up. Use for "remind me to text X in 2 weeks", "set a follow-up", "ping the lapsed cohort tomorrow morning".

Navigation:
- When the user wants to GO somewhere ("where do I edit rates", "open the contracts page", "show me the renewal pipeline", "take me to settings") use the navigate_to tool. Pick a route_key from the Routes catalog below — never invent a URL.
- If a request is purely informational ("what does Jones owe?") prefer a query_* tool over navigate_to. Use navigate_to when the user needs the page itself (to edit, to see a long list, to drill into a detail).
- Contract TEMPLATES live at services.contracts (Templates tab in that page), NOT under settings. Do not point operators at /settings/contracts — there is no such page.

Chaining examples — do BOTH the data ask and the action ask in one turn when both are implied:

  User: "send a reminder to everyone overdue"
  1. report_open_balances           (table renders for the operator to scan)
  2. bulk_send_message              (filter=overdue_balance, channel=email,
                                     body="Hi {{first_name}}, just a reminder…")
                                    → preview table shows every recipient before approval

  User: "draft 2027 renewals for everyone on D Dock at +5%"
  1. bulk_draft_renewals            (filter=expiring_90_days, dock_query="D Dock",
                                     rate_adjustment_pct=5)
                                    → preview table shows boater + current vs new rate

  User: "who's lapsed and how do I follow up?"
  1. report_lapsed_accounts         (table renders; rows are clickable to /members/[id])
  2. schedule_reminder              for the top 1-3 offenders (different due_at each)

  User: "is anyone hogging power?"
  1. report_meter_consumption_top   (table renders; biggest user up top)
  2. create_work_order              against the top offender ("investigate kWh anomaly")

When a user request has BOTH a data ask and an action ask, do them in the SAME turn — chain the report → propose the action. Don't make the operator type twice.

Routes catalog (use these keys with navigate_to):
${formatRouteCatalog()}

When proposing actions, narrate briefly (1 sentence) so the user knows what's queued for approval.`;

// ────────────────────────────────────────────────────────────
// Holder-mode context + prompt
// ────────────────────────────────────────────────────────────

function buildHolderContext(
  boaterId: string,
  ledger: LedgerEntry[]
): string {
  const boater = BOATERS.find((b) => b.id === boaterId);
  if (!boater) return "(no boater context available)";
  const vessels = VESSELS.filter(
    (v) => v.boater_id === boaterId || v.co_owner_ids.includes(boaterId)
  );
  const contracts = CONTRACTS.filter((c) => c.boater_id === boaterId);
  const myInvoices = ledger
    .filter((l) => l.boater_id === boaterId && l.type === "invoice")
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const openBalance = myInvoices.reduce((s, l) => s + l.open_balance, 0);
  const activeContract = contracts.find((c) => c.status === "executed");
  const reservations = RESERVATIONS.filter(
    (r) => r.boater_id === boaterId
  ).slice(0, 3);

  const lines: string[] = [];
  lines.push(`HOLDER CONTEXT (${boater.display_name}):`);
  lines.push(`- boater_id: ${boater.id}`);
  lines.push(`- preferred channel: ${boater.communication_prefs.preferred_channel}`);
  lines.push(`- billing cadence: ${boater.billing_cadence}`);
  if (boater.code) lines.push(`- slip code: ${boater.code}`);
  if (openBalance > 0) {
    lines.push(`- open balance: $${openBalance.toFixed(2)} (${myInvoices.filter((l) => l.open_balance > 0).length} open invoices)`);
  } else {
    lines.push(`- open balance: $0.00`);
  }
  if (activeContract) {
    lines.push(`- active contract: ${activeContract.number} (${activeContract.effective_start} to ${activeContract.effective_end}${activeContract.annual_rate ? `, $${activeContract.annual_rate}/year` : ""})`);
  }
  if (vessels.length > 0) {
    lines.push(
      `- vessels: ${vessels
        .map((v) => `${v.name}${v.year ? ` (${v.year} ${v.make ?? ""} ${v.model ?? ""})`.trim() : ""}`)
        .join("; ")}`
    );
  }
  if (reservations.length > 0) {
    lines.push(
      `- reservations: ${reservations
        .map((r) => `${r.arrival_date}→${r.departure_date} at ${r.slip_id ?? "—"}`)
        .join("; ")}`
    );
  }
  lines.push("");
  lines.push(
    "All query_my_* tools auto-scope to this boater. All holder_* action tools fill boater_id from session — do not pass other boater ids; you don't have access to other holders' data."
  );
  return lines.join("\n");
}

const HOLDER_SYSTEM_PROMPT = `You are the Marina Stee agent for a slip holder. The holder is opening their portal on their phone.

Voice + style:
- Address the holder by their first name. Warm, conversational, brief — 1-3 short sentences.
- Speak like the dockmaster: "I'll let the marina know", "we'll have someone meet you", "your slip", "your boat", "your contract".
- Never expose internal jargon (kanban, ledger entry, work order id). Say "service request" not "work order"; say "invoice" or "what you owe" not "ledger entry".
- When the holder asks something you can answer from context (their balance, their slip), answer directly. When they ask about something you don't know, propose a holder_message_marina to ask staff.

What you can do (all auto-scoped to this holder):
- Read: query_my_balance, query_my_history, query_my_vessels, query_my_contract, query_my_cards.
- Saved reports (return tables the holder can scan): report_my_balance, report_my_history, report_my_vessels. PREFER these when the holder asks for a list ("show me my invoices", "what have I paid", "list my boats"). Use the query_* tools for narrow single-fact questions ("do I owe anything", "what's my balance").
- Do (auto-approved, fires immediately on holder approval): holder_message_marina, holder_request_work_order, holder_schedule_pump_out, holder_pay_balance, holder_update_contact, holder_add_card, holder_remove_card.
- Request (operator-gated, the marina has to confirm): holder_request_slip_change, holder_request_termination, holder_request_renewal_inquiry.
- Rental Club (only if the holder is a member): holder_request_club_booking to schedule a day on the club fleet (staff confirms the boat); holder_cancel_club_booking to cancel one of their own days.

Important rules:
- NEVER reference other holders. You only know this one.
- For payments: confirm the amount + card with the holder before proposing holder_pay_balance.
- For termination: warn the holder it requires written notice + countersignature per their contract. Don't promise the slip is cancelled — only the marina can do that.
- For slip changes / renewals: same — frame as "I'll pass this to the marina" not "done".
- When you propose an action, narrate it in one warm sentence so the holder sees what's about to happen.`;

// ────────────────────────────────────────────────────────────
// POST handler
// ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: {
    prompt?: string;
    ledger?: LedgerEntry[];
    mode?: "staff" | "holder";
    holder_boater_id?: string;
    // Active tenant — staff mode filters BOATERS + read tools by this
    // so the agent can't reach across marinas. Holder mode ignores it
    // (the boater_id already scopes the session).
    tenant_id?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const prompt = body.prompt?.trim();
  if (!prompt) {
    return new Response(JSON.stringify({ error: "missing_prompt" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ledger = Array.isArray(body.ledger) ? body.ledger : [];
  const mode: "staff" | "holder" = body.mode === "holder" ? "holder" : "staff";
  const holderBoaterId =
    mode === "holder" && typeof body.holder_boater_id === "string"
      ? body.holder_boater_id
      : undefined;
  if (mode === "holder" && !holderBoaterId) {
    return new Response(JSON.stringify({ error: "missing_holder_boater_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  // tenant_id is optional — agent calls without it fall back to the
  // first seeded tenant, preserving backwards compat with older
  // clients. New requests from /lib/agent-fetch.ts always send it.
  const tenantId =
    typeof body.tenant_id === "string" && body.tenant_id.length > 0
      ? body.tenant_id
      : "ten_marina_stee_demo";
  // Boater set scoped to this request. Legacy seed rows without
  // tenant_id default to the primary tenant — matches the
  // useBoaters() filter so staff agent + UI see the same set.
  const scopedBoaters = BOATERS.filter(
    (b) => (b.tenant_id ?? "ten_marina_stee_demo") === tenantId
  );
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const encoder = new TextEncoder();
  const writeLine = (controller: ReadableStreamDefaultController, obj: unknown) => {
    controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
  };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (apiKey) {
          writeLine(controller, { type: "source", source: "claude" });
          await streamFromClaude({
            controller,
            writeLine,
            apiKey,
            prompt,
            ledger,
            mode,
            holderBoaterId,
            scopedBoaters,
            tenantId,
          });
        } else {
          writeLine(controller, { type: "source", source: "simulated" });
          await streamFromSimulated({
            controller,
            writeLine,
            prompt,
            ledger,
            mode,
            holderBoaterId,
            tenantId,
          });
        }
        writeLine(controller, { type: "done" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown agent error";
        writeLine(controller, { type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// ────────────────────────────────────────────────────────────
// Claude path — multi-turn tool loop
// ────────────────────────────────────────────────────────────

const MAX_TURNS = 4;

async function streamFromClaude({
  controller,
  writeLine,
  apiKey,
  prompt,
  ledger,
  mode = "staff",
  holderBoaterId,
  scopedBoaters,
  tenantId = "ten_marina_stee_demo",
}: {
  controller: ReadableStreamDefaultController;
  writeLine: (c: ReadableStreamDefaultController, obj: unknown) => void;
  apiKey: string;
  prompt: string;
  ledger: LedgerEntry[];
  mode?: "staff" | "holder";
  holderBoaterId?: string;
  scopedBoaters: typeof BOATERS;
  tenantId?: string;
}) {
  const client = new Anthropic({ apiKey });
  const isHolder = mode === "holder" && holderBoaterId;
  const activeTools = isHolder ? HOLDER_ALL_TOOLS : ALL_TOOLS;
  const activeActionToolNames = isHolder
    ? HOLDER_ACTION_TOOL_NAMES
    : ACTION_TOOL_NAMES;
  const activeSystemPrompt = isHolder ? HOLDER_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const activeContextBuilder = (): string =>
    isHolder
      ? buildHolderContext(holderBoaterId!, ledger)
      : buildContext(scopedBoaters);

  // ── PII tokenization ────────────────────────────────────────
  // Build the per-request tokenizer before anything crosses the wire.
  // Boater names / emails / phones / vessel names get replaced with
  // stable `<<KIND_id>>` handles in the system prompt, context block,
  // and the user's prompt. Text deltas + tool_use inputs get
  // detokenized before they leave this function — Anthropic logs
  // (30-day retention) never see identifiable data.
  //
  // Scope: the tokenizer's source-of-truth is the TENANT-scoped boater
  // set, not the global BOATERS list. A Lakeside-tenant agent request
  // should not tokenize Marina Stee names just because they happen to
  // be in the same in-memory snapshot — that would leak the existence
  // of cross-tenant entities into the handle space.
  //
  // Re-hydrated text goes to the browser; re-hydrated tool inputs go
  // to the existing resolvers in lib/agent-fetch.ts.
  //
  // When Convex is live (Phase 5 follow-up), swap the BOATERS/VESSELS
  // arguments for `await ctx.runQuery(api.boaters.list, {})` etc.
  const scopedVessels = VESSELS.filter((v) => {
    // Vessels carry no direct tenant_id today — they inherit via their
    // boater. Filter to vessels whose boater is in the scoped set so
    // cross-tenant vessel names don't bleed into the handle space.
    const boater = scopedBoaters.find((b) => b.id === v.boater_id);
    return !!boater;
  });
  const tokenizer: LazyTokenizer = createTokenizer({
    boaters: scopedBoaters,
    vessels: scopedVessels,
  });
  const tokenizedPrompt = tokenizer.tokenize(prompt);
  const tokenizedContext = tokenizer.tokenize(activeContextBuilder());

  // ── Prompt caching ──────────────────────────────────────────
  // Render order is tools → system → messages. A cache_control marker on
  // the last system block caches tools + system together; we also mark
  // the last tool as a defense-in-depth breakpoint so the tools list
  // caches independently if we ever vary the system prefix.
  //
  // For the growing messages array inside the tool loop, we set a single
  // sliding breakpoint on the latest user-turn message each iteration —
  // older breakpoints fall off (cleared before each request) but their
  // cache entries persist in the 5-minute TTL store, so the new
  // breakpoint walks back and reads the prior turn's prefix.
  //
  // Verify hits via response.usage.cache_read_input_tokens — if zero
  // across repeated identical-prefix requests, something is invalidating
  // the prefix (see shared/prompt-caching.md).
  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: `${activeSystemPrompt}\n\n${tokenizedContext}`,
      cache_control: { type: "ephemeral" },
    },
  ];

  // Mark the last tool with cache_control. The tools array is otherwise
  // identical to the mode-active tool list — only the final entry
  // gains a cache_control field.
  const cachedTools: Anthropic.Messages.Tool[] =
    activeTools.length > 0
      ? [
          ...activeTools.slice(0, -1),
          { ...activeTools[activeTools.length - 1], cache_control: { type: "ephemeral" } },
        ]
      : activeTools;

  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: "user",
      content: [{ type: "text", text: tokenizedPrompt }],
    },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    // Move the messages-side cache_control breakpoint to the last content
    // block of the most-recent user-turn message. Strip any previous
    // markers first so we never exceed the 4-breakpoint per-request budget
    // (system + tools account for 2; this is the 3rd).
    applyMessagesCacheControl(messages);

    const upstream = client.messages.stream({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: systemBlocks,
      tools: cachedTools,
      messages,
    });

    // Track tool_use blocks as they stream so we can collect input JSON
    type ToolBlock = { id: string; name: string; jsonAcc: string };
    const blocksByIndex = new Map<number, ToolBlock>();
    const assistantContent: Anthropic.Messages.ContentBlock[] = [];

    // Buffer for text-delta detokenization. Anthropic streams arbitrary
    // substrings — there's no guarantee a `<<BOATER_b_42>>` handle lands
    // inside a single delta. If a chunk boundary splits a handle (e.g.
    // delta #1 ends `... reminder to <<BOATER_b_4` and delta #2 starts
    // `2>> said his bilge pump...`), neither chunk contains a complete
    // handle and the operator would see raw `<<BOATER_b_42>>` in the
    // transcript — exactly the leak `suppressHydrationWarning`-style
    // privacy guarantees promise can't happen.
    //
    // Strategy: hold any trailing tail starting from the last unmatched
    // `<<` until the closing `>>` lands in a subsequent delta. The
    // PARTIAL_HANDLE_TAIL regex matches a `<<` followed by 0+ chars
    // that COULD still complete into a handle (no `>` yet).
    let textBuffer = "";
    const PARTIAL_HANDLE_TAIL = /<<[A-Z0-9_-]*$/;
    const flushSafeText = (incoming: string): string => {
      textBuffer += incoming;
      const partialMatch = textBuffer.match(PARTIAL_HANDLE_TAIL);
      if (!partialMatch || partialMatch.index === undefined) {
        const out = textBuffer;
        textBuffer = "";
        return out;
      }
      // Hold from the partial-handle start; emit everything before it.
      const safeEnd = partialMatch.index;
      const out = textBuffer.slice(0, safeEnd);
      textBuffer = textBuffer.slice(safeEnd);
      return out;
    };

    for await (const event of upstream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          blocksByIndex.set(event.index, {
            id: event.content_block.id,
            name: event.content_block.name,
            jsonAcc: "",
          });
        }
        continue;
      }
      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          // Detokenize on the way back to the browser. The user sees
          // real names; Anthropic never did. Buffer chunk-split
          // handles so they survive boundary cuts before detokenize.
          const safe = flushSafeText(event.delta.text);
          if (safe.length > 0) {
            writeLine(controller, {
              type: "text",
              delta: tokenizer.detokenize(safe),
            });
          }
        } else if (event.delta.type === "input_json_delta") {
          const block = blocksByIndex.get(event.index);
          if (block) block.jsonAcc += event.delta.partial_json;
        }
      }
    }
    // Drain any residual buffered text once the upstream stream closes.
    // Anything still in the buffer was an unclosed `<<...` — emit it
    // verbatim through detokenize so legitimate partial handles get
    // their best-effort substitution and stray angles just pass through.
    if (textBuffer.length > 0) {
      writeLine(controller, {
        type: "text",
        delta: tokenizer.detokenize(textBuffer),
      });
      textBuffer = "";
    }

    // Get the final assembled message so we have correct content blocks
    const finalMessage = await upstream.finalMessage();
    assistantContent.push(...finalMessage.content);

    // Collect tool_uses by category
    const toolUses = finalMessage.content.filter(
      (c): c is Anthropic.Messages.ToolUseBlock => c.type === "tool_use"
    );
    const readCalls = toolUses.filter((t) => !activeActionToolNames.has(t.name));
    const actionCalls = toolUses.filter((t) => activeActionToolNames.has(t.name));

    // Stream action proposals to the client immediately.
    // Detokenize the tool input first — boater_query: "{{boater_b_42}}"
    // becomes boater_query: "b_42" so the existing fuzzy resolvers in
    // lib/agent-fetch.ts find the right entity. Free-text fields (body /
    // notes / etc.) get their content tokens swapped back to real values.
    // Detokenize tool inputs end-to-end. For identity fields like
    // `boater_query`/`vessel_query`, the resulting value is the raw id
    // (e.g. "b_42") so the existing fuzzy resolvers in
    // lib/agent-fetch.ts find the entity directly. For free-text body
    // fields (send_message.body, send_message.subject), the content
    // tokens get swapped back to real names/emails BEFORE the message
    // is saved — the boater receives a message addressed to them by
    // their real name, even though Claude only ever saw the handle.
    for (const a of actionCalls) {
      writeLine(controller, {
        type: "tool",
        name: a.name,
        input: tokenizer.detokenizeToolInput(
          a.input as Record<string, unknown>,
        ),
      });
    }

    // If Claude proposed only actions (or nothing left to do), we're done
    if (readCalls.length === 0) return;

    // Execute read-only tools server-side, append results, loop.
    // The result going BACK to Claude must be tokenized — query
    // results contain real boater names/emails/ids and we don't
    // want them in the next prompt.
    messages.push({ role: "assistant", content: assistantContent });
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = readCalls.map(
      (call) => {
        const result = isHolder
          ? executeHolderReadTool(
              call.name,
              (call.input as Record<string, unknown>) ?? {},
              holderBoaterId!,
              ledger
            )
          : executeReadTool(
              call.name,
              (call.input as Record<string, unknown>) ?? {},
              ledger,
              scopedBoaters,
              tenantId
            );
        // The tool_step event goes to the BROWSER — real values are fine here.
        writeLine(controller, { type: "tool_step", name: call.name, result });
        return {
          type: "tool_result",
          tool_use_id: call.id,
          // Tokenize the JSON-stringified result before handing it back to
          // Claude on the next loop turn.
          content: tokenizer.tokenize(JSON.stringify(result)),
        };
      }
    );
    messages.push({ role: "user", content: toolResults });
  }
}

// ────────────────────────────────────────────────────────────
// Prompt-caching helpers
// ────────────────────────────────────────────────────────────

/**
 * Slides the messages-side prompt-cache breakpoint to the last content
 * block of the most-recent user-turn message. Strips any prior
 * cache_control markers first so we don't exceed the 4-breakpoint budget
 * as the conversation grows across tool-loop turns.
 *
 * The cache entries written by previous turns persist in the 5-min TTL
 * store; the new breakpoint walks back (up to 20 blocks) and reads them.
 */
function applyMessagesCacheControl(
  messages: Anthropic.Messages.MessageParam[]
): void {
  // Clear any existing cache_control on message content blocks.
  for (const msg of messages) {
    if (typeof msg.content === "string") continue;
    for (const block of msg.content) {
      if (block && typeof block === "object" && "cache_control" in block) {
        delete (block as { cache_control?: unknown }).cache_control;
      }
    }
  }

  // Find the last user-turn message and set cache_control on its final
  // content block. Tool-loop turns push user-role tool_result arrays;
  // turn 1 has the initial prompt in structured form.
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    if (typeof msg.content === "string" || msg.content.length === 0) return;
    const last = msg.content[msg.content.length - 1];
    if (last && typeof last === "object") {
      (last as { cache_control?: { type: "ephemeral" } }).cache_control = {
        type: "ephemeral",
      };
    }
    return;
  }
}

// ────────────────────────────────────────────────────────────
// Simulated path (unchanged) — single-pass pattern matcher
// ────────────────────────────────────────────────────────────

async function streamFromSimulated({
  controller,
  writeLine,
  prompt,
  ledger,
  mode = "staff",
  holderBoaterId,
  tenantId = "ten_marina_stee_demo",
}: {
  controller: ReadableStreamDefaultController;
  writeLine: (c: ReadableStreamDefaultController, obj: unknown) => void;
  prompt: string;
  ledger: LedgerEntry[];
  mode?: "staff" | "holder";
  holderBoaterId?: string;
  tenantId?: string;
}) {
  // Holder mode: the simulated path is intentionally minimal — without
  // an ANTHROPIC_API_KEY we can't run the holder agent reliably. Give
  // a friendly text response and skip action proposals.
  if (mode === "holder") {
    const holder = BOATERS.find((b) => b.id === holderBoaterId);
    const first = holder?.first_name ?? "there";
    const fallback = `Hi ${first}, I heard you say: "${prompt.slice(0, 120)}${prompt.length > 120 ? "…" : ""}". I'll need the marina's full agent connected to handle this for real — but I'll pass your note along.`;
    for (const word of fallback.split(/(\s+)/)) {
      writeLine(controller, { type: "text", delta: word });
      await delay(20);
    }
    return;
  }

  const { stream: chunks, action } = generateAgentResponse(prompt, ledger, tenantId);

  await delay(250);

  for (const chunk of chunks) {
    writeLine(controller, { type: "text", delta: chunk });
    await delay(Math.min(60 + chunk.length * 8, 250));
  }

  if (action) {
    if (action.kind === "charge_to_account") {
      writeLine(controller, {
        type: "tool",
        name: "charge_to_account",
        input: { boater_query: action.boater_id, item_query: action.line.name },
        resolved: {
          boater_id: action.boater_id,
          location_id: action.location_id,
          line: action.line,
        },
      });
    } else if (action.kind === "send_message") {
      writeLine(controller, {
        type: "tool",
        name: "send_message",
        input: {
          boater_query: action.boater_id,
          channel: action.type,
          subject: action.subject,
          body: action.body,
        },
        resolved: {
          boater_id: action.boater_id,
          type: action.type,
          subject: action.subject,
          body: action.body,
        },
      });
    } else if (action.kind === "create_work_order") {
      writeLine(controller, {
        type: "tool",
        name: "create_work_order",
        input: {
          boater_query: action.boater_id,
          subject: action.subject,
          description: action.description,
          activity_type: action.activity_type,
          priority: action.priority,
          vessel_query: action.vessel_id,
          slip_query: action.slip_id,
          due_date: action.due_date,
        },
      });
    } else if (action.kind === "create_reservation") {
      writeLine(controller, {
        type: "tool",
        name: "create_reservation",
        input: {
          boater_query: action.boater_id,
          slip_query: action.slip_id,
          vessel_query: action.vessel_id,
          arrival_date: action.arrival_date,
          departure_date: action.departure_date,
          type: action.type,
        },
      });
    } else if (action.kind === "record_payment") {
      writeLine(controller, {
        type: "tool",
        name: "record_payment",
        input: {
          boater_query: action.boater_id,
          amount: action.amount,
          method: action.method,
          notes: action.notes,
        },
      });
    } else if (action.kind === "create_boater") {
      writeLine(controller, {
        type: "tool",
        name: "create_boater",
        input: {
          first_name: action.first_name,
          last_name: action.last_name,
          email: action.email,
          phone: action.phone,
          preferred_channel: action.preferred_channel,
          billing_cadence: action.billing_cadence,
          code: action.code,
          notes: action.notes,
        },
      });
    } else if (action.kind === "create_vessel") {
      writeLine(controller, {
        type: "tool",
        name: "create_vessel",
        input: {
          boater_query: action.boater_id,
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
        },
      });
    } else if (action.kind === "create_contract") {
      writeLine(controller, {
        type: "tool",
        name: "create_contract",
        input: {
          boater_query: action.boater_id,
          template_id: action.template_id,
          vessel_query: action.vessel_id,
          slip_query: action.slip_id,
          effective_start: action.effective_start,
          effective_end: action.effective_end,
          annual_rate: action.annual_rate,
          billing_cadence: action.billing_cadence,
        },
      });
    } else if (action.kind === "add_card") {
      writeLine(controller, {
        type: "tool",
        name: "add_card",
        input: {
          boater_query: action.boater_id,
          brand: action.brand,
          last4: action.last4,
          exp_month: action.exp_month,
          exp_year: action.exp_year,
          nickname: action.nickname,
          is_default: action.is_default,
        },
      });
    } else if (action.kind === "invite_staff") {
      writeLine(controller, {
        type: "tool",
        name: "invite_staff",
        input: {
          name: action.name,
          email: action.email,
          phone: action.phone,
          role: action.role_name,
        },
      });
    } else if (action.kind === "update_work_order") {
      writeLine(controller, {
        type: "tool",
        name: "update_work_order",
        input: {
          work_order_query: action.work_order_id,
          status: action.patch.status,
          priority: action.patch.priority,
          assignee_name: action.patch.assignee_name,
          due_date: action.patch.due_date,
        },
      });
    }
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
