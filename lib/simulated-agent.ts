// Server-safe — no "use client" so this can be imported from /api/agent
// route handlers. The action EXECUTOR lives in lib/agent-actions.ts (client).

import {
  ADDITIONAL_FEES,
  APPLICATIONS_SEED,
  BOATERS,
  CONTRACTS,
  INSURANCE_CERTIFICATES,
  METER_READINGS,
  POS_CATALOG,
  POS_LOCATIONS,
  RENTAL_GROUPS,
  RENTAL_SPACES,
  ROLES_SEED,
  STAFF_SEED,
  TIME_ENTRIES_SEED,
  PAYROLL_PERIODS_SEED,
  VENDORS_SEED,
  VENDOR_BILLS_SEED,
  SLIPS,
  VESSELS,
  WAITLIST,
  WORK_ORDERS,
  formatMoney,
  getSlip,
  meterAnomaly,
  meterDelta,
} from "@/lib/mock-data";
import type { TableResult } from "@/lib/agent-reports";
import type {
  Boater,
  LedgerEntry,
  WorkOrder,
} from "@/lib/types";

/*
 * Simulated marina agent. Pattern-matches the user's prompt to a handful of
 * intents and produces a streamable response + optional structured action.
 *
 * No LLM is called. Responses are deterministic given the same prompt + store
 * state. When the real Claude integration lands, this becomes a tool-use
 * adapter and the prompt-parsing layer goes away.
 */

export type AgentChunk = string;

export type AgentAction =
  | {
      kind: "charge_to_account";
      label: string;
      boater_id: string;
      location_id: string;
      line: { name: string; price: number; sku: string };
    }
  | {
      kind: "send_message";
      label: string;
      boater_id: string;
      type: "sms" | "email";
      subject?: string;
      body: string;
    }
  | {
      kind: "create_work_order";
      label: string;
      boater_id: string;
      subject: string;
      description?: string;
      activity_type?:
        | "winterization"
        | "bottom_paint"
        | "service"
        | "inspection"
        | "haul_out"
        | "pump_out"
        | "task"
        | "other";
      priority?: "low" | "normal" | "high" | "urgent";
      vessel_id?: string;
      slip_id?: string;
      start_date?: string;
      end_date?: string;
      due_date?: string;
      assignee_user_id?: string;
      // Adopted from DockLog scout — drives wizard UX branching and the
      // recurring spawn chain. work_class is the only one we require;
      // the handler derives recurring_next_date and seeds the cleaning
      // checklist when omitted. Recurrence is gated on cleaning (fleet
      // cleaning programs run weekly/monthly).
      work_class?: "service" | "cleaning";
      estimated_total?: number;
      estimated_hours?: number;
      is_recurring?: boolean;
      recurring_schedule?:
        | "weekly"
        | "monthly"
        | "quarterly"
        | "bi_yearly"
        | "yearly";
      checklist?: { id: string; label: string }[];
      internal_notes?: string;
      attachment_ids?: string[];
      // Cleaning source — every cleaning WO is tied to either a club
      // booking or a paid boat rental. Carried through so the handler
      // can stash the back-reference in internal_notes (no WO column
      // for this today; revisit if cleaning-source reporting matters).
      cleaning_source_kind?: "club_booking" | "paid_rental";
      cleaning_source_id?: string;
    }
  | {
      kind: "create_reservation";
      label: string;
      boater_id: string;
      slip_id: string;
      vessel_id?: string;
      arrival_date: string;
      departure_date: string;
      type: "annual" | "seasonal" | "monthly" | "transient" | "recurring";
      attached_fee_ids?: string[];
    }
  | {
      kind: "record_payment";
      label: string;
      boater_id: string;
      amount: number;
      method: "card" | "cash" | "check" | "ach";
      applied_to_invoice_ids?: string[];
      notes?: string;
    }
  | {
      kind: "create_boater";
      label: string;
      first_name: string;
      last_name: string;
      email?: string;
      phone?: string;
      preferred_channel: "email" | "sms" | "voice";
      billing_cadence: "annual" | "seasonal" | "monthly" | "transient";
      code?: string;
      notes?: string;
    }
  | {
      kind: "create_vessel";
      label: string;
      boater_id: string;
      name: string;
      year?: number;
      make?: string;
      model?: string;
      vessel_type?: "powerboat" | "sailboat" | "pontoon" | "houseboat" | "pwc" | "other";
      fuel_type?: "gasoline" | "diesel" | "electric" | "none";
      loa_inches?: number;
      beam_inches?: number;
      draft_inches?: number;
      hull_vin?: string;
      registration?: string;
    }
  | {
      kind: "create_contract";
      label: string;
      boater_id: string;
      template_id: string;
      vessel_id?: string;
      slip_id?: string;
      effective_start: string;
      effective_end: string;
      annual_rate?: number;
      billing_cadence: "annual" | "seasonal" | "monthly" | "transient";
      // Optional attachments uploaded at draft time. Stored as data URLs
      // in the prototype; S3-backed once the backend lands.
      attachments?: Array<{
        name: string;
        url: string;
        mime_type: string;
        size_bytes?: number;
        type?: "signed_contract" | "addendum" | "supporting_doc" | "other";
      }>;
      // Unified service fees attached at draft time. Persisted to the
      // Contract entity so downstream roll-ups (year-one totals,
      // billing-run line items) can read the same set without
      // duplicating draft-only wizard state. See lib/client-store.ts →
      // feesForEntity / totalFromAttachedFees.
      attached_fee_ids?: string[];
    }
  | {
      kind: "add_card";
      label: string;
      boater_id: string;
      brand: "visa" | "mastercard" | "amex" | "discover";
      last4: string;
      exp_month: number;
      exp_year: number;
      nickname?: string;
      is_default: boolean;
    }
  // ── Boat Rentals + waitlist + COI chains ─────────────────────
  | {
      kind: "create_boat_rental";
      label: string;
      boat_id: string;
      boater_id?: string;
      patron_name?: string;
      patron_email?: string;
      patron_phone?: string;
      start_at: string;             // ISO datetime
      end_at: string;               // ISO datetime
      rate_kind: "hourly" | "half_day" | "full_day";
    }
  | {
      kind: "close_boat_rental";
      label: string;
      rental_id: string;
      fuel_in_pct?: number;
      hours_in?: number;
      damage_notes?: string;
      damage_charge?: number;
    }
  | {
      kind: "send_pickup_link";
      label: string;
      rental_id: string;
    }
  | {
      kind: "notify_waitlist";
      label: string;
      slip_id: string;
      top_n?: number;
    }
  // ── Waitlist auto-offer cascade ──────────────────────────────
  // Operator picks a freed slip + a candidate cohort → server mints
  // offer tokens + dispatches the comm fan-out. accept/decline flips
  // the offer_status field; the cascade walker advances to next-in-line
  // on decline/expire. See lib/client-store.ts → fireWaitlistOffer.
  | {
      kind: "fire_waitlist_offer";
      label: string;
      slip_id: string;
      entry_ids: string[];        // candidate waitlist entry ids
      expires_hours?: number;     // 48 by default
      summary: string;            // "Fire 3 offers on slip A14 · 48h window"
    }
  | {
      kind: "accept_waitlist_offer";
      label: string;
      offer_token: string;
      entry_id: string;           // pre-resolved for the action card
      slip_id?: string;           // pre-resolved
      applicant_name: string;     // pre-resolved
    }
  | {
      kind: "decline_waitlist_offer";
      label: string;
      offer_token: string;
      entry_id: string;
      slip_id?: string;
      applicant_name: string;
      auto_advance?: boolean;     // fires next-in-line on the same slip
    }
  | {
      kind: "request_coi_renewal";
      label: string;
      coi_id: string;
    }
  // ── Settings (staff + marina profile) ──────────────────────
  | {
      kind: "invite_staff";
      label: string;
      name: string;
      email: string;
      phone?: string;
      role_id: string;
      role_name: string;          // pre-resolved for the action card preview
    }
  // ── Work orders ────────────────────────────────────────────
  | {
      kind: "update_work_order";
      label: string;
      work_order_id: string;
      work_order_number: string;  // pre-resolved for the action card preview
      patch: {
        status?: "open" | "scheduled" | "in_progress" | "blocked" | "completed" | "cancelled";
        priority?: "low" | "normal" | "high" | "urgent";
        assignee_user_id?: string;
        assignee_name?: string;     // free-text label until staff IDs are stable
        due_date?: string;
      };
      summary: string;            // human-readable patch description ("→ J. Reyes · in progress")
    }
  // ── Batch A: operator setup & catalog edits ────────────────
  | {
      kind: "update_marina_profile";
      label: string;
      patch: Record<string, string | undefined>;
      summary: string;            // "Name → Acme Marina · Address → 123 Lake Dr"
    }
  | {
      kind: "create_dock";
      label: string;
      name: string;
      slip_prefix: string;
      sort_order?: number;
      active: boolean;
    }
  | {
      kind: "update_dock";
      label: string;
      dock_id: string;
      dock_name: string;          // pre-resolved
      patch: { name?: string; slip_prefix?: string; sort_order?: number; active?: boolean };
      summary: string;
    }
  | {
      // PosLocationKey is a fixed enum (fuel_dock / ship_store /
      // restaurant / harbormaster) — operators can't add new ones.
      // Only edits are supported in Batch A.
      kind: "update_pos_location";
      label: string;
      location_id: string;
      location_name: string;
      patch: {
        name?: string;
        icon_key?: "fuel" | "shop" | "restaurant" | "harbormaster" | "marina";
        default_tax_rate?: number;
        active?: boolean;
      };
      summary: string;
    }
  | {
      kind: "create_pos_item";
      label: string;
      name: string;
      sku: string;
      category: string;
      price: number;
      cost?: number;
      // Pre-resolved location key (one of the 4 PosLocationKeys). The
      // store models multi-location items but the agent creates one
      // location at a time.
      location_key: "fuel_dock" | "ship_store" | "restaurant" | "harbormaster";
      location_name: string;
      taxable: boolean;
      active: boolean;
    }
  | {
      kind: "update_pos_item";
      label: string;
      item_id: string;
      item_name: string;
      patch: {
        name?: string;
        price?: number;
        cost?: number;
        category?: string;
        active?: boolean;
      };
      summary: string;
    }
  | {
      kind: "create_fee";
      label: string;
      name: string;
      amount: number;
      recurrence: "one_time" | "monthly" | "annual";
      // Real FeeAppliesTo is an array — agent emits one value, executor wraps.
      applies_to: "slip_contract" | "work_order" | "boat_rental" | "pos" | "annual_billing_run";
      accounting_line_item: string;
      description?: string;
      auto_attach: boolean;
    }
  | {
      kind: "update_fee";
      label: string;
      fee_id: string;
      fee_name: string;
      patch: {
        name?: string;
        amount?: number;
        recurrence?: "one_time" | "monthly" | "annual";
        applies_to?: "slip_contract" | "work_order" | "boat_rental" | "pos" | "annual_billing_run";
        auto_attach?: boolean;
      };
      summary: string;
    }
  // ── Batch B: comm templates + connections + roles + staff edit ─
  | {
      kind: "update_comm_template";
      label: string;
      template_id: string;
      template_name: string;
      patch: {
        subject?: string;
        body_markdown?: string;
        active?: boolean;
      };
      summary: string;
    }
  | {
      kind: "connect_provider";
      label: string;
      kind_of: "payment" | "email" | "sms" | "accounting";
      provider: string;
      enabled: boolean;
    }
  | {
      kind: "disconnect_provider";
      label: string;
      config_id: string;
      provider: string;
    }
  | {
      kind: "create_role";
      label: string;
      name: string;
      description?: string;
      permissions: string[];
    }
  | {
      kind: "update_role";
      label: string;
      role_id: string;
      role_name: string;
      patch: {
        name?: string;
        description?: string;
        permissions?: string[];
      };
      summary: string;
    }
  | {
      kind: "update_staff";
      label: string;
      staff_id: string;
      staff_name: string;
      patch: {
        role_id?: string;
        role_name?: string;        // for the action card preview
        status?: "invited" | "active" | "suspended";
        phone?: string;
        email?: string;
      };
      summary: string;
    }
  // ── Batch C: entity edits & lifecycle ────────────────────────
  | {
      kind: "update_boater";
      label: string;
      boater_id: string;
      boater_name: string;
      patch: {
        email?: string;
        phone?: string;
        preferred_channel?: "email" | "sms" | "voice";
        billing_cadence?: "annual" | "seasonal" | "monthly" | "transient";
        notes?: string;
        active?: boolean;
      };
      summary: string;
    }
  | {
      kind: "update_vessel";
      label: string;
      vessel_id: string;
      vessel_name: string;
      patch: {
        name?: string;
        year?: number;
        make?: string;
        model?: string;
        registration?: string;
        hull_vin?: string;
        active?: boolean;
      };
      summary: string;
    }
  | {
      kind: "update_contract";
      label: string;
      contract_id: string;
      contract_number: string;
      patch: {
        status?:
          | "draft"
          | "sent"
          | "partially_signed"
          | "executed"
          | "active"
          | "expired"
          | "terminated"
          | "renewed";
        annual_rate?: number;
        effective_start?: string;
        effective_end?: string;
      };
      summary: string;
    }
  | {
      kind: "terminate_contract";
      label: string;
      contract_id: string;
      contract_number: string;
      reason?: string;
    }
  | {
      kind: "update_reservation";
      label: string;
      reservation_id: string;
      reservation_number: string;
      patch: {
        arrival_date?: string;
        departure_date?: string;
        slip_id?: string;
        notes?: string;
      };
      summary: string;
    }
  | {
      kind: "cancel_reservation";
      label: string;
      reservation_id: string;
      reservation_number: string;
      reason?: string;
    }
  | {
      kind: "send_for_signature";
      label: string;
      contract_id: string;
      contract_number: string;
      // For the simulated path. Token resolution + sending happens
      // in the executor — it mints the signing token + dispatches a
      // contract_sent_for_signature comm.
    }
  // ── Batch D: bulk operations ────────────────────────────────
  | {
      kind: "bulk_send_message";
      label: string;
      // Targets are pre-resolved server-side via filter criteria
      target_boater_ids: string[];
      filter_summary: string;       // "8 transients arriving today"
      channel: "email" | "sms";
      subject?: string;
      body: string;                 // shared body with {{first_name}} merge
      // ── Confirm-before-commit preview ──
      // When the resolver can list every recipient up front, it attaches
      // a preview table so the operator sees WHO is on the list before
      // approving. Absent → the action card falls back to the one-line
      // filter_summary (legacy behavior).
      preview_table?: TableResult;
    }
  | {
      kind: "bulk_draft_renewals";
      label: string;
      target_contract_ids: string[];
      filter_summary: string;       // "12 expiring in next 90 days on D Dock"
      rate_adjustment_pct?: number; // e.g. 5 for +5%
      // Preview shows boater + slip + current rate + new rate for every
      // contract that would be drafted — operator can scan for the one
      // unusual case before approving.
      preview_table?: TableResult;
    }
  | {
      kind: "bulk_apply_fee";
      label: string;
      target_boater_ids: string[];
      filter_summary: string;
      fee_id: string;
      fee_name: string;
      fee_amount: number;
      // Preview shows boater + slip + current open balance + amount-after-fee.
      preview_table?: TableResult;
    }
  | {
      kind: "run_billing_run";
      label: string;
      run_type: "annual" | "monthly_recurring";
      target_count: number;         // pre-resolved estimate
      estimated_total: number;      // pre-resolved aggregate
      // Preview shows per-contract invoice line: boater + slip + cadence + amount.
      preview_table?: TableResult;
    }
  | {
      kind: "run_qb_sync";
      label: string;
      pending_count: number;
      pending_total: number;
    }
  // ── Batch F: alerts (handled like one-shots; no scheduling
  // infra yet — these just log the rule into a future table
  // surfaced on Settings → Notification rules) ─────────────────
  | {
      kind: "create_threshold_rule";
      label: string;
      kind_of: "fuel_reorder" | "occupancy_low" | "ar_aging" | "anomaly_spike";
      threshold_value: number;
      threshold_unit: string;       // "%" | "$" | "count" | "days"
      action: "notify_staff" | "create_work_order" | "send_message";
      notes?: string;
    }
  // ── Navigation ──────────────────────────────────────────────
  // navigate_to is special: it does not mutate domain data. The "execution"
  // is a client-side router.push() that opens the target page. We still go
  // through the standard executor path so the audit log captures that the
  // agent suggested a navigation and the operator approved it.
  | {
      kind: "navigate_to";
      label: string;
      /** Stable route key from lib/routes.ts (ROUTE_CATALOG). */
      route_key: string;
      /** Resolved path with params substituted in. */
      path: string;
      /** Sidebar/route label, surfaced on the link card. */
      route_label: string;
      /** Optional reason — agent's one-line "why this page". */
      rationale?: string;
    }
  // ── Scheduled reminders ─────────────────────────────────────
  // Future-dated SMS/email follow-up. Posts an entry to the
  // SCHEDULED_REMINDERS client store on approval; renders in the
  // /notifications feed + a future Settings → Reminders surface.
  // First tool built via lib/agent-tool-kit.ts defineTool helper.
  | {
      kind: "schedule_reminder";
      label: string;
      boater_id: string;
      due_at: string;          // ISO date or datetime
      channel: "sms" | "email";
      subject?: string;
      body: string;
      reason?: string;         // e.g. "renewal follow-up"
    }
  // ── Holder portal actions ────────────────────────────────────
  // Every holder_* action originates from the boater portal. Executors
  // create staff-visible artifacts (work orders, communications,
  // ledger entries) tagged so operators can spot the source at a glance.
  | {
      kind: "holder_message_marina";
      label: string;
      boater_id: string;
      subject?: string;
      body: string;
    }
  | {
      kind: "holder_request_work_order";
      label: string;
      boater_id: string;
      vessel_id?: string;
      activity_type:
        | "pump_out"
        | "service"
        | "inspection"
        | "haul_out"
        | "winterization"
        | "bottom_paint"
        | "task"
        | "other";
      priority?: "low" | "normal" | "high" | "urgent";
      subject: string;
      description?: string;
      preferred_date?: string;       // ISO date
    }
  | {
      kind: "holder_schedule_pump_out";
      label: string;
      boater_id: string;
      vessel_id?: string;
      preferred_date?: string;
      notes?: string;
    }
  | {
      kind: "holder_pay_balance";
      label: string;
      boater_id: string;
      amount: number;
      method: "card" | "ach";
      card_id?: string;              // if paying with a specific card on file
      applied_to_invoice_ids?: string[];
    }
  | {
      kind: "holder_update_contact";
      label: string;
      boater_id: string;
      email?: string;
      phone?: string;
      address_line_1?: string;
      address_line_2?: string;
      city?: string;
      state?: string;
      postal_code?: string;
    }
  | {
      kind: "holder_add_card";
      label: string;
      boater_id: string;
      brand: "visa" | "mastercard" | "amex" | "discover";
      last4: string;
      exp_month: number;
      exp_year: number;
      nickname?: string;
      is_default: boolean;
    }
  | {
      kind: "holder_remove_card";
      label: string;
      boater_id: string;
      card_id: string;
      card_summary: string;          // "Visa ending 4242" for the confirm UI
    }
  | {
      kind: "holder_request_slip_change";
      label: string;
      boater_id: string;
      reason: string;
      desired_slip_traits?: string;  // free text — "wider beam", "covered", "B Dock"
    }
  | {
      kind: "holder_request_termination";
      label: string;
      boater_id: string;
      contract_id: string;
      contract_number: string;
      desired_end_date?: string;
      reason?: string;
    }
  | {
      kind: "holder_request_renewal_inquiry";
      label: string;
      boater_id: string;
      contract_id?: string;
      season_year?: number;
      questions: string;
    }
  // ── Rental Club (staff) ─────────────────────────────────────
  | {
      kind: "create_club_subscription";
      label: string;
      boater_id?: string;             // resolved at exec time when missing
      boater_query?: string;
      plan_tier: "basic" | "plus" | "premium";
      join_fee?: number;
      monthly_fee?: number;
      days_per_month?: number;
      notes?: string;
    }
  | {
      kind: "update_club_subscription";
      label: string;
      subscription_id?: string;
      boater_query?: string;
      plan_tier?: "basic" | "plus" | "premium";
      status?: "active" | "paused" | "cancelled" | "past_due";
      join_fee?: number;
      monthly_fee?: number;
      days_per_month?: number;
      next_billing_date?: string;
      notes?: string;
    }
  | {
      kind: "create_club_booking";
      label: string;
      boater_query?: string;
      subscription_id?: string;
      date: string;
      start_time?: string;
      end_time?: string;
      rental_boat_id?: string;
      status: "confirmed" | "requested";
      notes?: string;
    }
  | {
      kind: "run_club_billing";
      label: string;
      as_of_date?: string;
    }
  | {
      kind: "run_club_reactivation";
      label: string;
      min_days_ago?: number;
      max_days_ago?: number;
    }
  // ── Rental Club (holder) ────────────────────────────────────
  | {
      kind: "holder_request_club_booking";
      label: string;
      boater_id: string;
      date: string;
      notes?: string;
    }
  | {
      kind: "holder_cancel_club_booking";
      label: string;
      boater_id: string;
      booking_id?: string;
      date?: string;
    }
  // ── Services catalog parity wave (S-grade) ──
  | {
      kind: "create_club_plan";
      label: string;
      name: string;
      plan_tier: "basic" | "plus" | "premium";
      amount: number;
      join_fee?: number;
      days_per_month: number;
    }
  | {
      kind: "update_rate";
      label: string;
      rate_id: string;
      rate_name: string;
      patch: {
        name?: string;
        amount?: number;
        join_fee?: number;
        days_per_month?: number;
      };
      summary: string;
    }
  | {
      kind: "set_boat_club_rotation";
      label: string;
      boat_id: string;
      boat_name: string;
      available_for_club: boolean;
    }
  | {
      kind: "create_rental_boat";
      label: string;
      name: string;
      type: "pontoon" | "kayak" | "paddleboard" | "jet_ski" | "fishing_skiff" | "wakeboat";
      capacity: number;
      home_dock?: string;
      deposit_amount: number;
      hourly_rate?: number;
      half_day_rate?: number;
      full_day_rate?: number;
      fuel_capacity_gal?: number;
      available_for_club?: boolean;
      notes?: string;
    }
  | {
      kind: "create_meter_reading";
      label: string;
      space_id: string;
      space_number: string;
      meter_number?: string;
      current_reading: number;
      unit?: "kWh" | "gallons";
      rate_per_unit?: number;
    }
  | {
      kind: "create_slip";
      label: string;
      dock_id: string;
      dock_name: string;
      number: string;
      slip_class: "covered" | "uncovered" | "t_head" | "buoy" | "dry_storage";
      max_loa_inches: number;
      max_beam_inches: number;
      has_power: boolean;
      has_water: boolean;
      default_annual_rate?: number;
    }
  | {
      kind: "create_rental_group";
      label: string;
      name: string;
      type: "slips" | "buoy" | "dry_storage" | "jet_ski" | "mooring" | "day_rental";
      check_in_time?: string;
      check_out_time?: string;
      total_spaces?: number;
    }
  | {
      kind: "create_rental_space";
      label: string;
      group_id: string;
      group_name: string;
      number: string;
      occupancy_type: "Standard" | "Jet Ski" | "Buoy" | "Dry Storage" | "Mooring";
      length_inches?: number;
      beam_inches?: number;
      has_power: boolean;
      has_water: boolean;
      has_pump_out: boolean;
    }
  | {
      kind: "create_insurance_certificate";
      label: string;
      boater_id: string;
      vessel_id: string;
      carrier: string;
      policy_number: string;
      liability_limit?: number;
      hull_value?: number;
      effective_start: string;
      effective_end: string;
      pdf_url?: string;
    }
  | {
      kind: "create_contract_template";
      label: string;
      name: string;
      type:
        | "annual_slip"
        | "seasonal_slip"
        | "transient_slip"
        | "dry_storage"
        | "mooring"
        | "rental"
        | "winterization"
        | "service";
      body_markdown: string;
    }
  // ── Back office (Staffing / Vendor / Inventory / Assets) ──
  | {
      kind: "create_shift";
      label: string;
      staff_id: string;
      staff_name: string;
      start_at: string;
      end_at: string;
      position: string;
    }
  | {
      kind: "run_payroll";
      label: string;
      period_start: string;
      period_end: string;
      pay_date?: string;
    }
  | {
      kind: "create_certification";
      label: string;
      staff_id: string;
      staff_name: string;
      name: string;
      issuer?: string;
      issued_at: string;
      expires_at?: string;
    }
  | {
      kind: "create_vendor";
      label: string;
      name: string;
      display_name?: string;
      contact_name?: string;
      email?: string;
      phone?: string;
      payment_terms: "due_on_receipt" | "net_7" | "net_15" | "net_30" | "net_60";
      default_gl_account?: string;
      issue_1099?: boolean;
    }
  | {
      kind: "create_bill";
      label: string;
      vendor_id: string;
      vendor_name: string;
      number: string;
      bill_date: string;
      due_date: string;
      amount: number;
      gl_account?: string;
      notes?: string;
    }
  | {
      kind: "pay_bill";
      label: string;
      bill_id: string;
      bill_number: string;
      vendor_name: string;
      amount: number;
      method: "ach" | "check" | "card" | "wire" | "cash";
      check_number?: string;
    }
  | {
      kind: "receive_stock";
      label: string;
      item_id: string;
      item_name: string;
      qty: number;
      bill_id?: string;
      notes?: string;
    }
  | {
      kind: "create_asset";
      label: string;
      name: string;
      asset_kind:
        | "forklift" | "boat_lift" | "hoist" | "pump_out_boat" | "pump_out_station"
        | "courtesy_cart" | "fuel_pump" | "fuel_tank" | "fire_system"
        | "compressor" | "generator" | "office_equipment" | "other";
      serial_number?: string;
      location?: string;
      purchase_date?: string;
      purchase_price?: number;
    }
  | {
      kind: "create_pm_schedule";
      label: string;
      asset_id: string;
      asset_name: string;
      name: string;
      cadence: "weekly" | "monthly" | "quarterly" | "semi_annual" | "annual";
      next_due_at: string;
      auto_create_wo_days_ahead?: number;
    }
  | {
      kind: "run_pm_check";
      label: string;
    }
  // ── Back office round 2 ──
  | {
      kind: "approve_time_entry";
      label: string;
      time_entry_id: string;
      staff_id: string;
      staff_name: string;
      hours: number;
      date: string;            // YYYY-MM-DD
    }
  | {
      kind: "create_staff";
      label: string;
      name: string;
      email: string;
      phone?: string;
      default_position: string;
      employment_type: "w2" | "1099";
      hourly_rate?: number;
      salary_annual?: number;
      hire_date?: string;
      mobile_clock_pin?: string;
    }
  | {
      kind: "update_staff_wage";
      label: string;
      staff_id: string;
      staff_name: string;
      hourly_rate?: number;
      salary_annual?: number;
      employment_type?: "w2" | "1099";
      ot_multiplier?: number;
    }
  | {
      kind: "adjust_stock";
      label: string;
      item_id: string;
      item_name: string;
      delta: number;
      notes?: string;
    }
  | {
      kind: "log_stock_loss";
      label: string;
      item_id: string;
      item_name: string;
      qty: number;             // positive count lost
      reason?: string;
      notes?: string;
    }
  // ── COI auto-renewal: parsed PDF metadata persisted onto the cert ──
  //
  // Distinct from `create_insurance_certificate` (which is "operator
  // adds a brand-new policy") and `request_coi_renewal` (which mints
  // the upload token + dispatches the reminder). This action fires
  // AFTER the boater has dropped a renewed PDF and the agent has
  // extracted the new effective dates / carrier / policy number from
  // it — applies those fields to the existing row so the renewal
  // workflow closes without a manual edit.
  //
  // `parsed.expiresOn` is required (it's the field the operator
  // dashboard alerts on); everything else is optional because real-
  // world COI PDFs render the fields with varying labels and the
  // extraction can miss one without invalidating the rest.
  | {
      kind: "ingest_coi_pdf";
      label: string;
      coiId: string;
      attachmentId: string;
      parsed: {
        carrier?: string;
        policyNumber?: string;
        expiresOn: string;          // ISO date YYYY-MM-DD — required
        liabilityLimit?: number;
        effectiveOn?: string;       // ISO date — renewed policy start
      };
    }
  // ── Wave 3 agent actions ──────────────────────────────────────
  // These cover the "what happens AFTER the draft" half of the agent
  // surface: marking signed/paid, updating insurance, recording fuel
  // sales, quote drafts, void/cancel lifecycle, manual ledger entries,
  // and explicit draft-contract creation.
  | {
      // Flip a contract or quote to "signed" without re-drafting.
      // Two sub-kinds because the underlying entity differs (contracts
      // vs quotes have separate tables + lifecycle).
      kind: "mark_signed";
      label: string;
      target_kind: "contract" | "quote";
      target_id: string;
      target_number: string;
      signed_by_name?: string;
      signed_at?: string;             // ISO datetime; defaults to now
    }
  | {
      // Stamp an invoice as paid out-of-band (operator received a check,
      // bank wire, etc. that isn't tied to a card-on-file). Posts a
      // payment ledger row applied against the invoice.
      kind: "mark_invoice_paid";
      label: string;
      invoice_id: string;
      invoice_number?: string;
      amount: number;
      method: "cash" | "check" | "ach" | "card";
      check_number?: string;
      notes?: string;
    }
  | {
      // Patch an existing insurance certificate — operator corrects a
      // typo, extends the effective_end after a renewal, or flips
      // status. New COIs go through `create_insurance_certificate`.
      kind: "update_insurance";
      label: string;
      coi_id: string;
      patch: {
        carrier?: string;
        policy_number?: string;
        effective_start?: string;
        effective_end?: string;
        liability_limit?: number;
        status?: "active" | "expiring_soon" | "expired" | "lapsed";
      };
    }
  | {
      // Record one fuel-pump transaction. Doesn't generate a POS order
      // — the harbormaster's POS surface is for the ship store. Fuel
      // sales have their own table for end-of-day reconciliation.
      kind: "record_fuel_sale";
      label: string;
      fuel_type: "gasoline" | "diesel";
      gallons: number;
      price_per_gallon: number;
      payment_method: "card" | "cash" | "charge_to_account";
      boater_id?: string;            // required when payment_method=charge_to_account
      vessel_id?: string;
      sold_at?: string;              // ISO datetime; defaults to now
    }
  | {
      // Draft a new quote against an open work order. line_items carries
      // the parts/labor/fees/discounts breakdown — the executor computes
      // the subtotal/tax/total from those.
      kind: "create_quote";
      label: string;
      work_order_id: string;
      line_items: Array<{
        kind: "part" | "labor" | "fee" | "discount";
        description: string;
        qty: number;
        unit_price: number;
        taxable: boolean;
      }>;
      tax_rate?: number;             // 0..1, defaults to tenant default
      valid_until?: string;          // ISO date for the quote expiry
    }
  | {
      // Patch an existing draft quote. Sent / signed quotes are
      // immutable on this path — operator has to clone-and-edit
      // through the UI (which mints a new quote_id).
      kind: "update_quote";
      label: string;
      quote_id: string;
      patch: {
        line_items?: Array<{
          kind: "part" | "labor" | "fee" | "discount";
          description: string;
          qty: number;
          unit_price: number;
          taxable: boolean;
        }>;
        tax_rate?: number;
        valid_until?: string;
      };
    }
  | {
      // Void a contract that was never executed (drafted in error or
      // declined by the boater). Distinct from `terminate_contract`
      // which acts on a signed/active contract and triggers the
      // waitlist-notify chain.
      kind: "void_contract";
      label: string;
      contract_id: string;
      contract_number: string;
      reason?: string;
    }
  | {
      // Manual ledger entry — operator records a one-off charge,
      // credit, or adjustment that doesn't flow through POS / contracts.
      // Useful for prorating, account credits for service issues, etc.
      kind: "create_ledger_entry";
      label: string;
      boater_id: string;
      type: "invoice" | "credit" | "adjustment";
      amount: number;
      description: string;
      date?: string;                 // ISO date; defaults to today
      notes?: string;
    }
  | {
      // Explicit "create a fresh draft contract" action. Same shape as
      // `create_contract` but emitted by the agent when the prompt is
      // unambiguously about drafting (vs. submitting). Keeping them as
      // distinct kinds avoids the executor having to disambiguate from
      // context — and lets the audit log carry the operator's intent.
      kind: "draft_contract";
      label: string;
      boater_id: string;
      template_id: string;
      vessel_id?: string;
      slip_id?: string;
      effective_start: string;
      effective_end: string;
      annual_rate?: number;
      billing_cadence: "annual" | "seasonal" | "monthly" | "transient";
      notes?: string;
    }
  // ── Bulk operator actions (W3 wave) ──────────────────────────────
  //
  // Bulk billing run, bulk renewal sweep, bulk comm send. These are
  // distinct from the older `bulk_send_message` / `bulk_draft_renewals`
  // (which take pre-resolved id lists from the agent) — the new
  // `bulk_*` kinds carry the RULE/FILTER and the executor resolves the
  // target list itself, matching the wizard surface. That keeps the
  // agent prompt-side small and avoids serializing 200 boater ids
  // through the tool-use stream.
  | {
      kind: "bulk_charge";
      label: string;
      rule: "annual_due_this_month" | "monthly_installment" | "seasonal_due_this_month";
      period_ym: string;            // YYYY-MM
      target_count: number;         // pre-resolved estimate
      estimated_total: number;      // pre-resolved aggregate
    }
  | {
      kind: "bulk_renew_contracts";
      label: string;
      days_out: number;             // expiry window
      rate_adjustment_pct?: number;
      target_count: number;
    }
  | {
      kind: "bulk_send_comms";
      label: string;
      template_id: string;
      template_name: string;
      filter:
        | { kind: "all_boaters" }
        | { kind: "cadence"; cadence: "annual" | "seasonal" | "monthly" | "transient" }
        | { kind: "vessel_loa_over"; inches: number }
        | { kind: "has_open_balance" };
      filter_summary: string;       // "All annual holders" / "Vessels > 40ft"
      target_count: number;
    }
  // ── Annual Renewal Sweep Coordinator ─────────────────────────────
  //
  // Distinct from `bulk_renew_contracts` (one-click fan-out) — these
  // verbs operate on the long-lived `renewalSweeps` entity that drives
  // the /services/renewals coordinator surface. The Convex path
  // (convex/agentActions.ts) delegates to convex/renewalSweeps.ts.
  | {
      kind: "start_renewal_sweep";
      label: string;
      name: string;                  // "Winter 2026 sweep"
      window_start: string;          // ISO date
      window_end: string;
      default_rate_adjustment_pct: number;
      /** Source contracts to seed the sweep with. Pre-resolved by the wizard / agent. */
      source_contract_ids: string[];
      notes?: string;
    }
  | {
      kind: "update_renewal_sweep_item";
      label: string;
      item_id: string;
      patch: {
        priority?: "high" | "normal" | "low";
        rate_adjustment_pct?: number | null;  // null = clear override
        status?: "pending" | "withdrawn";     // only operator-driven transitions
        internal_notes?: string;
      };
    }
  | {
      kind: "launch_renewal_sweep";
      label: string;
      sweep_id: string;
      sweep_name: string;
      item_count: number;
    }
  // ── Vendor Bills — operator AP workflow ─────────────────────────
  //
  // Distinct from the legacy `create_bill` / `pay_bill` above (which act
  // on the older `Bill` slice). These four ride on the new `VendorBill`
  // entity that adds approval queue + scheduled payments + disputes.
  // Used by the /vendors → Bills sub-tab + the approval queue widget.
  | {
      kind: "create_vendor_bill";
      label: string;
      vendor_id: string;
      vendor_name: string;
      vendor_invoice_number?: string;
      bill_date: string;
      /** Optional — derived from vendor.payment_terms when omitted. */
      due_date?: string;
      amount: number;
      tax_amount?: number;
      description?: string;
      line_items?: Array<{
        description: string;
        amount: number;
        gl_account?: string;
      }>;
      /** Default "pending_approval"; "draft" allowed when amount unknown. */
      submit_as?: "draft" | "pending_approval";
      internal_notes?: string;
    }
  | {
      kind: "approve_vendor_bill";
      label: string;
      vendor_bill_id: string;
      bill_number: string;
      vendor_name: string;
      amount: number;
    }
  | {
      kind: "schedule_vendor_bill_payment";
      label: string;
      vendor_bill_id: string;
      bill_number: string;
      vendor_name: string;
      amount: number;
      scheduled_payment_date: string;
      scheduled_payment_method: "ach" | "check" | "card" | "wire";
    }
  | {
      kind: "mark_vendor_bill_paid";
      label: string;
      vendor_bill_id: string;
      bill_number: string;
      vendor_name: string;
      amount: number;
      paid_at?: string;
      paid_via?: string;
      payment_method?: "ach" | "check" | "card" | "wire";
    }
  // ── Time Clock + Payroll Prep (W1 feature) ──────────────────────
  //
  // Operator clock-in/out from the agent rail + manual adjust +
  // close-period verbs. The dock surface uses the PIN keypad (not the
  // agent), so these action shapes assume the operator already knows
  // the staff id (resolved by the simulated-agent's findStaff() in the
  // intent matcher).
  | {
      kind: "clock_in";
      label: string;
      staff_id: string;
      staff_name: string;          // pre-resolved for the action card preview
      position?: string;
    }
  | {
      kind: "clock_out";
      label: string;
      // Resolve to a specific in-progress TimeEntry on the client side;
      // the agent UI emits staff_id + name so the action card can show
      // "Clocking out Jamie · 7h 35m today".
      staff_id: string;
      staff_name: string;
      time_entry_id?: string;      // optional pre-resolved id (open entry)
      summary: string;             // "7h 35m today" or similar
    }
  | {
      kind: "adjust_time_entry";
      label: string;
      time_entry_id: string;
      staff_id: string;            // who the entry belongs to (for audit)
      staff_name: string;
      adjuster_staff_id: string;   // who is doing the adjusting
      patch: {
        clock_in_at?: string;
        clock_out_at?: string;
        break_minutes?: number;
        notes?: string;
        position?: string;
      };
      summary: string;             // "Clock-out 4:00 → 4:30 PM"
    }
  | {
      kind: "close_payroll_period";
      label: string;
      period_id: string;
      closer_staff_id: string;
      // Pre-computed totals shown on the action card so the operator
      // doesn't have to crack the modal to see what they're about to
      // close.
      total_gross: number;
      total_hours: number;
      summary: string;             // "Apr 28 → May 11 · $4,125 gross · 188h"
    }
  // ── PDF extraction agent actions (Vision wave) ──────────────────
  //
  // Both kinds defer the actual extraction to /api/pdf-extract; the
  // executor reads the PDF via Convex `_storage` (or a mock attachment
  // map in the prototype) and calls the route. Operator sees the
  // extracted fields on a review card before any persistence happens —
  // bills route into create_vendor_bill, contracts emit a draft.
  | {
      // Operator drops a PDF on the bills page (or asks the agent to
      // "create a bill from the PDF I attached"). The executor parses
      // the PDF, fuzzy-matches the vendor by name hint, and stages a
      // create_vendor_bill action behind the scenes.
      kind: "create_vendor_bill_from_pdf";
      label: string;
      /** Convex `_storage` id when the PDF is already persisted. */
      pdf_storage_id: string;
      /** Optional vendor hint when the operator named the vendor in the prompt. */
      vendor_query?: string;
      /** Caption shown on the action card pre-execution. */
      summary?: string;
    }
  | {
      // Pull a contract PDF (e.g. from the email inbox) and surface the
      // extracted fields for operator review. No mutation — this lands
      // in a review modal that lets the operator confirm + dispatch a
      // draft_contract action.
      kind: "extract_contract_terms";
      label: string;
      pdf_storage_id: string;
      /** Optional hint that anchors the extracted terms to a known boater. */
      boater_query?: string;
      summary?: string;
    }
  // ── Boater applications (public self-onboarding queue) ─────────
  //
  // Four actions cover the lifecycle: operator-initiated `submit_application`
  // (the public form route hits the store directly, not via the agent), and
  // the three queue decisions: approve / decline / route_to_waitlist.
  | {
      kind: "submit_application";
      label: string;
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
    }
  | {
      kind: "approve_application";
      label: string;
      application_id: string;
      // Display-friendly summary for the action card; not used by the
      // executor — that just reads the row by id and mints from there.
      summary?: string;
    }
  | {
      kind: "decline_application";
      label: string;
      application_id: string;
      internal_review_notes?: string;
      summary?: string;
    }
  | {
      kind: "route_application_to_waitlist";
      label: string;
      application_id: string;
      summary?: string;
    };

export type AgentResponse = {
  // streamed text chunks (sentences/phrases)
  stream: AgentChunk[];
  action?: AgentAction;
};

function findBoater(text: string): Boater | undefined {
  const t = text.toLowerCase();
  // try last name first, then first name, then code
  return (
    BOATERS.find((b) => t.includes(b.last_name.toLowerCase())) ??
    BOATERS.find((b) => t.includes(b.first_name.toLowerCase())) ??
    BOATERS.find((b) => b.code && t.toLowerCase().includes(b.code.toLowerCase()))
  );
}

function openBalanceFor(boaterId: string, ledger: LedgerEntry[]) {
  return ledger
    .filter((l) => l.boater_id === boaterId && l.type === "invoice")
    .reduce((s, e) => s + e.open_balance, 0);
}

type ChargeableItem = { name: string; price: number; sku: string; location_id: string };

function matchChargeable(
  text: string,
  tenantId: string
): ChargeableItem | undefined {
  const t = text.toLowerCase();
  // Tenant-scoped catalogs — keep Lakeside intents from accidentally
  // matching Marina Stee SKUs and vice versa. Legacy seed rows
  // without tenant_id default to the primary tenant.
  const tenantCatalog = POS_CATALOG.filter(
    (c) => (c.tenant_id ?? "ten_marina_stee_demo") === tenantId
  );
  const tenantLocations = POS_LOCATIONS.filter(
    (l) => (l.tenant_id ?? "ten_marina_stee_demo") === tenantId
  );
  const tenantFees = ADDITIONAL_FEES.filter(
    (f) => (f.tenant_id ?? "ten_marina_stee_demo") === tenantId
  );

  // First, try POS catalog (fuel, ship store, restaurant items)
  const catalogHit = tenantCatalog.find((c) =>
    [c.name.toLowerCase(), c.sku.toLowerCase(), c.category.toLowerCase()].some((s) =>
      t.includes(s.toLowerCase().split(" ")[0])
    )
  );
  if (catalogHit) {
    const loc = tenantLocations.find((l) => catalogHit.location_keys.includes(l.key));
    if (loc) {
      return { name: catalogHit.name, price: catalogHit.price, sku: catalogHit.sku, location_id: loc.id };
    }
  }

  // Then, try additional service fees (hoist, transfer, pump-out, etc.)
  // These are billed via the Harbormaster register conceptually.
  const hm = tenantLocations.find((l) => l.key === "harbormaster");
  const feeHit = tenantFees.find((f) => {
    const tokens = f.name.toLowerCase().split(/\s+/);
    return tokens.some((tok) => tok.length > 3 && t.includes(tok));
  });
  if (feeHit && hm) {
    return { name: feeHit.name, price: feeHit.amount, sku: feeHit.id.toUpperCase(), location_id: hm.id };
  }

  return undefined;
}

export function generateAgentResponse(
  prompt: string,
  ledgerSnapshot: LedgerEntry[],
  tenantId: string = "ten_marina_stee_demo"
): AgentResponse {
  const p = prompt.trim();
  const lp = p.toLowerCase();

  // ── INTENT: largest open balance ────────────────────────────
  if (
    /largest\s+(open\s+)?balance|biggest\s+(open\s+)?balance|most\s+overdue/.test(lp)
  ) {
    const ranked = BOATERS
      .map((b) => ({ b, balance: openBalanceFor(b.id, ledgerSnapshot) }))
      .filter((r) => r.balance > 0)
      .sort((a, b) => b.balance - a.balance);
    if (ranked.length === 0) {
      return {
        stream: [
          "Looking at A/R… ",
          "all accounts are current — nothing past due right now.",
        ],
      };
    }
    const top = ranked[0];
    return {
      stream: [
        `${top.b.display_name} has the largest open balance `,
        `at ${formatMoney(top.balance)}. `,
        `That's `,
        `${(top.balance / ranked.reduce((s, r) => s + r.balance, 0) * 100).toFixed(0)}% `,
        `of total A/R (${formatMoney(ranked.reduce((s, r) => s + r.balance, 0))} across ${ranked.length} accounts).`,
      ],
      action: {
        kind: "send_message",
        label: `Draft a payment reminder to ${top.b.first_name}`,
        boater_id: top.b.id,
        type: top.b.communication_prefs.preferred_channel === "sms" ? "sms" : "email",
        subject: "Payment reminder — Marina Stee",
        body: `Hi ${top.b.first_name}, your Marina Stee account currently has ${formatMoney(top.balance)} outstanding. Reply or stop by the office anytime to settle.`,
      },
    };
  }

  // ── INTENT: vacant slips / occupancy ─────────────────────────
  if (/vacant|available|open\s+slip|empty\s+slip|occupancy/.test(lp)) {
    const sizeMatch = lp.match(/(\d+)\s*(?:foot|ft|')/);
    const minFt = sizeMatch ? Number(sizeMatch[1]) : 0;
    const wantPower = /power/.test(lp);
    const wantWater = /water/.test(lp);

    const vacant = RENTAL_SPACES.filter((s) => {
      if (s.status !== "vacant") return false;
      if (minFt && (s.length_inches ?? 0) / 12 < minFt) return false;
      if (wantPower && !s.has_power) return false;
      if (wantWater && !s.has_water) return false;
      return true;
    });

    const byGroup: Record<string, number> = {};
    for (const v of vacant) {
      const g = RENTAL_GROUPS.find((g) => g.id === v.group_id)?.name ?? v.group_id;
      byGroup[g] = (byGroup[g] ?? 0) + 1;
    }
    const total = RENTAL_SPACES.length;
    const occupied = RENTAL_SPACES.filter((s) => s.status === "occupied").length;

    return {
      stream: [
        `Across all docks, `,
        `${vacant.length} space${vacant.length === 1 ? "" : "s"} match`,
        `${minFt ? ` ≥${minFt}'` : ""}${wantPower ? ", with power" : ""}${wantWater ? ", with water" : ""}. `,
        ...(Object.keys(byGroup).length > 0
          ? [
              `Breakdown: `,
              ...Object.entries(byGroup).map(
                ([g, n], i) => `${g} ${n}${i < Object.entries(byGroup).length - 1 ? ", " : ". "}`
              ),
            ]
          : []),
        `Overall occupancy is ${Math.round((occupied / total) * 100)}% (${occupied}/${total}).`,
      ],
    };
  }

  // ── INTENT: charge X to Y ────────────────────────────────────
  if (/charge|add\s+(a\s+)?(?:fee|charge)|bill\b/.test(lp)) {
    const b = findBoater(p);
    const item = matchChargeable(p, tenantId);
    if (b && item) {
      const loc = POS_LOCATIONS.find((l) => l.id === item.location_id)!;
      return {
        stream: [
          `Drafting a charge: `,
          `${item.name} (${formatMoney(item.price)}) `,
          `from the ${loc.name}, `,
          `posted to ${b.display_name}'s account. `,
          `Approve below and I'll create the invoice + queue it for QuickBooks.`,
        ],
        action: {
          kind: "charge_to_account",
          label: `Charge ${formatMoney(item.price)} to ${b.display_name}`,
          boater_id: b.id,
          location_id: loc.id,
          line: { name: item.name, price: item.price, sku: item.sku },
        },
      };
    }
    if (b && !item) {
      return {
        stream: [
          `Got the boater (${b.display_name}). `,
          `Which item are we charging? `,
          `Try something like "charge a hoist fee" or "charge gasoline 38 gallons".`,
        ],
      };
    }
    if (!b && item) {
      return {
        stream: [
          `Item recognized (${item.name}), `,
          `but I didn't catch which boater to charge. `,
          `Add a last name or slip code (e.g. "to David" or "to A29").`,
        ],
      };
    }
  }

  // ── INTENT: create work order ───────────────────────────────
  if (/\b(create|open|schedule|new)\b.*\b(work\s*order|wo|service|haul[-\s]?out|winterization|bottom\s*paint|inspection|pump[-\s]?out|task|todo|to-?do)\b/.test(lp)
      || /\b(winterize|haul\s+out|repaint|service|pump[-\s]?out)\b/.test(lp)
  ) {
    const b = findBoater(p);
    if (b) {
      let activity:
        | "winterization" | "bottom_paint" | "service" | "inspection"
        | "haul_out" | "pump_out" | "task" | "other" = "service";
      if (/winteriz/.test(lp)) activity = "winterization";
      else if (/bottom\s*paint|repaint/.test(lp)) activity = "bottom_paint";
      else if (/haul[-\s]?out/.test(lp)) activity = "haul_out";
      else if (/inspect/.test(lp)) activity = "inspection";
      else if (/pump[-\s]?out/.test(lp)) activity = "pump_out";
      else if (/\b(task|todo|to-?do|call\s+\w+|follow[-\s]?up)\b/.test(lp)) activity = "task";

      const vessel = VESSELS.find((v) => v.boater_id === b.id) ?? undefined;
      const subjectMap: Record<string, string> = {
        winterization: `Winterize ${vessel?.name ?? b.last_name + "'s vessel"}`,
        bottom_paint: `Bottom paint — ${vessel?.name ?? b.last_name + "'s vessel"}`,
        haul_out: `Haul-out — ${vessel?.name ?? b.last_name + "'s vessel"}`,
        inspection: `Inspection — ${vessel?.name ?? b.last_name + "'s vessel"}`,
        service: `Service work — ${vessel?.name ?? b.last_name + "'s vessel"}`,
        pump_out: `Pump-out — ${vessel?.name ?? b.last_name + "'s vessel"}`,
        task: `Follow up with ${b.first_name}`,
      };
      return {
        stream: [
          `Drafting a ${activity.replace("_", " ")} work order `,
          `for ${b.display_name}${vessel ? ` (${vessel.name})` : ""}. `,
          `Approve below and I'll add it to the board.`,
        ],
        action: {
          kind: "create_work_order",
          label: `New ${activity.replace("_", " ")} work order for ${b.display_name}`,
          boater_id: b.id,
          subject: subjectMap[activity] ?? subjectMap.service,
          activity_type: activity,
          priority: "normal",
          vessel_id: vessel?.id,
        },
      };
    }
  }

  // ── INTENT: create reservation ──────────────────────────────
  if (/\b(reserve|reservation|book|block)\b/.test(lp) && !/\b(quote|signature)\b/.test(lp)) {
    const b = findBoater(p);
    // try slip number
    const slipMatch = lp.match(/\b([a-z])\s*(\d{1,3})\b/i)
                   ?? lp.match(/\bslip\s*([\w\d]+)\b/i);
    let slip = slipMatch
      ? RENTAL_SPACES.find(
          (s) => s.number.toLowerCase() === (slipMatch[2] ?? slipMatch[1]).toLowerCase()
        )
      : undefined;
    if (!slip && b) {
      slip = RENTAL_SPACES.find((s) => s.status === "vacant");
    }
    if (b && slip) {
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      return {
        stream: [
          `Drafting a transient reservation `,
          `for ${b.display_name} in slip ${slip.number} `,
          `(${today} → ${tomorrow}). `,
          `Approve below to commit.`,
        ],
        action: {
          kind: "create_reservation",
          label: `Reserve slip ${slip.number} for ${b.display_name}`,
          boater_id: b.id,
          slip_id: slip.id,
          arrival_date: today,
          departure_date: tomorrow,
          type: "transient",
        },
      };
    }
  }

  // ── INTENT: record payment ──────────────────────────────────
  if (/\b(record|enter|log|apply)\b.*\b(payment|check|cash|ach)\b/.test(lp)
      || /\$\d+.*\b(from|for)\b/.test(lp)
  ) {
    const b = findBoater(p);
    const amtMatch = lp.match(/\$?\s*([\d,]+(?:\.\d{1,2})?)/);
    const amount = amtMatch ? Number(amtMatch[1].replace(/,/g, "")) : 0;
    let method: "card" | "cash" | "check" | "ach" = "check";
    if (/cash/.test(lp)) method = "cash";
    else if (/ach/.test(lp)) method = "ach";
    else if (/card/.test(lp)) method = "card";
    else method = "check";

    if (b && amount > 0) {
      return {
        stream: [
          `Recording ${formatMoney(amount)} ${method} `,
          `from ${b.display_name}. `,
          `Approve below to post it to the ledger.`,
        ],
        action: {
          kind: "record_payment",
          label: `Record ${formatMoney(amount)} ${method} from ${b.display_name}`,
          boater_id: b.id,
          amount,
          method,
        },
      };
    }
  }

  // ── INTENT: onboard / create new boater ─────────────────────
  if (/\b(onboard|add|create|new)\b.*\b(boater|customer|account|client)\b/.test(lp)
      || /\bnew\s+boater\b/.test(lp)
  ) {
    // Try to pull a name like "John Smith" or "Smith family"
    const nameMatch = p.match(/(?:named|for|onboard|add)\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/);
    const familyMatch = p.match(/([A-Z][a-z]+)\s+family/);
    let first = "", last = "";
    if (nameMatch) {
      first = nameMatch[1] ?? "";
      last = nameMatch[2] ?? "";
    } else if (familyMatch) {
      last = familyMatch[1];
      first = "—"; // placeholder
    }
    if (first && last) {
      return {
        stream: [
          `Drafting a new boater profile `,
          `for ${first} ${last}. `,
          `Approve below to add them. You'll be able to attach vessels and slips next.`,
        ],
        action: {
          kind: "create_boater",
          label: `Onboard ${first} ${last}`,
          first_name: first,
          last_name: last,
          preferred_channel: "email",
          billing_cadence: "transient",
        },
      };
    }
    return {
      stream: [
        `Open the "+ New boater" sheet on the Boaters page, `,
        `or give me a name like "onboard a new boater named John Smith".`,
      ],
    };
  }

  // ── INTENT: add vessel ──────────────────────────────────────
  if (/\b(add|register|new)\b.*\b(vessel|boat|sailboat|powerboat)\b/.test(lp)) {
    const b = findBoater(p);
    if (b) {
      // crude name extraction — "named X" or in quotes
      const nameMatch = p.match(/named\s+["']?([A-Z][\w\s]+?)["']?(?:[,.\s]|$)/i)
                     ?? p.match(/["']([^"']+)["']/);
      const name = nameMatch ? nameMatch[1].trim() : "New vessel";
      let vesselType: "powerboat" | "sailboat" | "pontoon" | "houseboat" | "pwc" | "other" = "powerboat";
      if (/sailboat/.test(lp)) vesselType = "sailboat";
      else if (/pontoon/.test(lp)) vesselType = "pontoon";
      else if (/houseboat/.test(lp)) vesselType = "houseboat";
      else if (/jet\s*ski|pwc/.test(lp)) vesselType = "pwc";
      return {
        stream: [
          `Drafting a new vessel "${name}" `,
          `under ${b.display_name}. `,
          `Approve to register it.`,
        ],
        action: {
          kind: "create_vessel",
          label: `Add ${name} to ${b.display_name}`,
          boater_id: b.id,
          name,
          vessel_type: vesselType,
        },
      };
    }
  }

  // ── INTENT: draft contract ─────────────────────────────────
  if (/\b(draft|create|new)\b.*\b(contract|lease|agreement)\b/.test(lp)) {
    const b = findBoater(p);
    if (b) {
      let templateId = "tpl_seasonal_slip";
      if (/annual/.test(lp)) templateId = "tpl_annual_slip";
      else if (/winteriz/.test(lp)) templateId = "tpl_winterization";
      const today = new Date().toISOString().slice(0, 10);
      const oneYear = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
      return {
        stream: [
          `Drafting a ${templateId.replace("tpl_", "").replace("_", " ")} contract `,
          `for ${b.display_name}. `,
          `Approve to save as draft (signature comes after).`,
        ],
        action: {
          kind: "create_contract",
          label: `Draft ${templateId.replace("tpl_", "").replace("_", " ")} for ${b.display_name}`,
          boater_id: b.id,
          template_id: templateId,
          effective_start: today,
          effective_end: oneYear,
          billing_cadence: "monthly",
        },
      };
    }
  }

  // ── INTENT: add card on file ───────────────────────────────
  if (/\b(add|save|store)\b.*\bcard\b/.test(lp)) {
    const b = findBoater(p);
    const last4Match = p.match(/\b(\d{4})\b/);
    let brand: "visa" | "mastercard" | "amex" | "discover" = "visa";
    if (/mastercard|mc\b/.test(lp)) brand = "mastercard";
    else if (/amex|american\s+express/.test(lp)) brand = "amex";
    else if (/discover/.test(lp)) brand = "discover";

    if (b && last4Match) {
      const nextYear = new Date().getFullYear() + 2;
      return {
        stream: [
          `Drafting a ${brand} card ending in ${last4Match[1]} `,
          `for ${b.display_name}. `,
          `Approve to store it (production: this would tokenize via the processor first).`,
        ],
        action: {
          kind: "add_card",
          label: `Add ${brand} ····${last4Match[1]} to ${b.display_name}`,
          boater_id: b.id,
          brand,
          last4: last4Match[1],
          exp_month: 12,
          exp_year: nextYear,
          is_default: false,
        },
      };
    }
  }

  // ── INTENT: anomalies / unusual meter / pedestal ─────────────
  if (/anomaly|anomalies|pedestal|unusual\s+draw|spike|high\s+draw/.test(lp)) {
    const anomalous = METER_READINGS.filter(meterAnomaly);
    if (anomalous.length === 0) {
      return { stream: ["Meter readings look clean this period — no anomalies flagged."] };
    }
    return {
      stream: [
        `Flagged ${anomalous.length} anomalous reading${anomalous.length === 1 ? "" : "s"}: `,
        ...anomalous.map((m, i) => {
          const sp = RENTAL_SPACES.find((s) => s.id === m.space_id);
          return `slip ${sp?.number ?? "—"} (${m.meter_number}) jumped +${meterDelta(m)} ${m.unit ?? ""}${
            i < anomalous.length - 1 ? ", " : ". "
          }`;
        }),
        `Want me to spin up work orders to investigate?`,
      ],
    };
  }

  // ── INTENT: ingest a renewed COI PDF ─────────────────────────
  //
  // Triggered by phrases like "ingest COI", "process COI", "parse COI",
  // "extract COI", "renew COI from PDF". Picks the best-fit COI to
  // apply the parsed values to:
  //   1. boater-named in prompt → their most-recent COI
  //   2. otherwise the most recently uploaded boater-submitted COI
  //
  // The parsed payload in v1 is stubbed (no real PDF parsing in the
  // prototype). The handler in lib/agent-actions.ts persists whatever
  // is in `parsed` onto the cert via the mock store; downstream Convex
  // wiring uses the same shape via markCoiUploaded.
  if (/ingest|parse|extract|process/.test(lp) && /coi|insurance|certificate/.test(lp)) {
    const b = findBoater(p);
    const candidate =
      (b && INSURANCE_CERTIFICATES.find((c) => c.boater_id === b.id)) ??
      [...INSURANCE_CERTIFICATES]
        .sort((a, c) => (a.uploaded_at < c.uploaded_at ? 1 : -1))
        .find((c) => c.uploaded_by === "boater") ??
      INSURANCE_CERTIFICATES[0];

    if (candidate) {
      const newExpiry = (() => {
        // Roll the existing expiry forward by one year as the stub
        // parser result. Real flow extracts from the PDF.
        const d = new Date(candidate.effective_end);
        d.setFullYear(d.getFullYear() + 1);
        return d.toISOString().slice(0, 10);
      })();
      const vessel = VESSELS.find((v) => v.id === candidate.vessel_id);
      return {
        stream: [
          `Parsed the renewed COI for `,
          `${vessel?.name ?? candidate.policy_number}. `,
          `New expiry: ${newExpiry}, `,
          `carrier ${candidate.carrier}, `,
          `policy ${candidate.policy_number}.`,
        ],
        action: {
          kind: "ingest_coi_pdf",
          label: `Apply parsed COI to ${candidate.policy_number}`,
          coiId: candidate.id,
          attachmentId: `att_stub_${Date.now().toString(36)}`,
          parsed: {
            carrier: candidate.carrier,
            policyNumber: candidate.policy_number,
            expiresOn: newExpiry,
            liabilityLimit: candidate.liability_limit,
            effectiveOn: candidate.effective_end,
          },
        },
      };
    }
  }

  // ── INTENT: contract expiry ──────────────────────────────────
  if (/contract|lease|expire|renewal/.test(lp)) {
    const b = findBoater(p);
    if (b) {
      const c = CONTRACTS.find((c) => c.boater_id === b.id && c.status === "active");
      if (c) {
        const days = Math.round(
          (new Date(c.effective_end).getTime() - Date.now()) / 86_400_000
        );
        return {
          stream: [
            `${b.display_name}'s ${c.number} ends `,
            `${c.effective_end} `,
            `(${days > 0 ? `in ${days} days` : `${-days} days ago`}). `,
            `Annual rate ${formatMoney(c.annual_rate ?? 0)}, billed ${c.billing_cadence}.`,
          ],
        };
      }
      return { stream: [`No active contract on file for ${b.display_name}.`] };
    }
    const soon = CONTRACTS.filter(
      (c) =>
        c.status === "active" &&
        c.effective_end &&
        (new Date(c.effective_end).getTime() - Date.now()) / 86_400_000 <= 90
    );
    return {
      stream: [
        `${soon.length} active contract${soon.length === 1 ? "" : "s"} `,
        `expire within 90 days. `,
        ...(soon.length > 0
          ? [
              "Closest: ",
              soon
                .sort((a, b) =>
                  (a.effective_end ?? "") < (b.effective_end ?? "") ? -1 : 1
                )
                .slice(0, 3)
                .map(
                  (c) =>
                    `${c.number} (${BOATERS.find((b) => b.id === c.boater_id)?.last_name ?? "—"}, ${c.effective_end})`
                )
                .join(", "),
              ".",
            ]
          : []),
      ],
    };
  }

  // ── INTENT: who is X / show me X ─────────────────────────────
  if (/who is|find\s+\w+|look\s*up/.test(lp)) {
    const b = findBoater(p);
    if (b) {
      const balance = openBalanceFor(b.id, ledgerSnapshot);
      return {
        stream: [
          `${b.display_name} — ${b.code ?? "no code"} `,
          `· ${b.billing_cadence} `,
          `· balance ${formatMoney(balance)} `,
          `· trust ${b.trust_score ?? "—"}. `,
          `Preferred channel: ${b.communication_prefs.preferred_channel}.`,
        ],
      };
    }
  }

  // ── INTENT: open balance / outstanding for boater ────────────
  if (/balance|outstanding|owe|past\s*due/.test(lp)) {
    const b = findBoater(p);
    if (b) {
      const balance = openBalanceFor(b.id, ledgerSnapshot);
      if (balance > 0) {
        return {
          stream: [
            `${b.display_name} has `,
            `${formatMoney(balance)} `,
            `outstanding across open invoices.`,
          ],
          action: {
            kind: "send_message",
            label: `Draft a reminder to ${b.first_name}`,
            boater_id: b.id,
            type: b.communication_prefs.preferred_channel === "sms" ? "sms" : "email",
            body: `Hi ${b.first_name}, friendly reminder your Marina Stee account has ${formatMoney(balance)} outstanding.`,
          },
        };
      }
      return { stream: [`${b.display_name} is current — no outstanding balance.`] };
    }
  }

  // ── INTENT: work orders for X ────────────────────────────────
  if (/work\s*orders?\b|service|maintenance|jobs?\b/.test(lp)) {
    const b = findBoater(p);
    const wos = b
      ? WORK_ORDERS.filter((w) => w.boater_id === b.id && ["open", "scheduled", "in_progress"].includes(w.status))
      : WORK_ORDERS.filter((w) => ["open", "scheduled", "in_progress"].includes(w.status));
    return {
      stream: [
        `${wos.length} active work order${wos.length === 1 ? "" : "s"}${b ? ` for ${b.display_name}` : ""}: `,
        ...wos.slice(0, 4).map(
          (w, i) =>
            `${w.number} ${w.subject} (${w.status.replace("_", " ")})${
              i < Math.min(wos.length, 4) - 1 ? ", " : "."
            }`
        ),
      ],
    };
  }

  // ── INTENT: gas margin / fuel ────────────────────────────────
  if (/gas|fuel|margin|tank/.test(lp)) {
    return {
      stream: [
        "Gasoline: $4.89/gal · cost $3.42 · margin $1.47 (30%). ",
        "Diesel: $5.12/gal · cost $3.78 · margin $1.34 (26%). ",
        "Diesel tank at 30% — reorder threshold hit.",
      ],
    };
  }

  // ── INTENT: update / reassign / reprioritize work order ─────
  // Matches "reassign WO-1042 to J. Reyes", "mark Davis's haul-out
  // urgent", "complete the pump-out for slip A07", etc. Looks up
  // the WO by number, boater last name, or activity_type keyword.
  if (
    /\b(reassign|update|mark|set|complete|cancel|schedule|block|start)\b.*\b(work\s*order|wo\b|haul[-\s]?out|service|paint|winteriz|pump[-\s]?out|inspection)\b/.test(
      lp
    ) ||
    /\bwo[-\s]?\d+\b/i.test(p) ||
    /\b(reassign|move)\b.*\b(to|→)\b/.test(lp)
  ) {
    // Pull a WO number reference (WO-1042 / wo 1042 / 1042)
    const numMatch =
      p.match(/\bWO[-\s]?(\d{3,5})\b/i) ?? p.match(/\b(\d{4,5})\b/);
    let wo = numMatch
      ? WORK_ORDERS.find((w) =>
          w.number.toLowerCase().includes(numMatch[1].toLowerCase())
        )
      : undefined;

    // Fall back to boater-scoped WO lookup
    if (!wo) {
      const b = findBoater(p);
      if (b) {
        const open = WORK_ORDERS.filter(
          (w) =>
            w.boater_id === b.id &&
            ["open", "scheduled", "in_progress", "blocked"].includes(w.status)
        );
        // Prefer an activity match
        let activityFilter: WorkOrder["activity_type"] | undefined;
        if (/haul[-\s]?out/.test(lp)) activityFilter = "haul_out";
        else if (/winteriz/.test(lp)) activityFilter = "winterization";
        else if (/pump[-\s]?out/.test(lp)) activityFilter = "pump_out";
        else if (/inspect/.test(lp)) activityFilter = "inspection";
        else if (/paint/.test(lp)) activityFilter = "bottom_paint";
        wo = activityFilter
          ? open.find((w) => w.activity_type === activityFilter)
          : open[0];
      }
    }

    if (wo) {
      const patch: NonNullable<Extract<AgentAction, { kind: "update_work_order" }>["patch"]> = {};
      const summaryBits: string[] = [];

      // Status
      if (/\bcomplete\b/.test(lp)) {
        patch.status = "completed";
        summaryBits.push("→ completed");
      } else if (/\bcancel\b/.test(lp)) {
        patch.status = "cancelled";
        summaryBits.push("→ cancelled");
      } else if (/\bblock\b/.test(lp) || /\bon\s+hold\b/.test(lp)) {
        patch.status = "blocked";
        summaryBits.push("→ blocked");
      } else if (/\bin\s*progress\b|\bstart/.test(lp)) {
        patch.status = "in_progress";
        summaryBits.push("→ in progress");
      } else if (/\bschedule/.test(lp)) {
        patch.status = "scheduled";
        summaryBits.push("→ scheduled");
      }

      // Priority
      if (/\burgent\b/.test(lp)) {
        patch.priority = "urgent";
        summaryBits.push("urgent");
      } else if (/\bhigh\s+priority|priority\s+high\b/.test(lp)) {
        patch.priority = "high";
        summaryBits.push("high priority");
      } else if (/\blow\s+priority\b/.test(lp)) {
        patch.priority = "low";
        summaryBits.push("low priority");
      }

      // Assignee — looks for "to <name>" / "→ <name>"
      const assigneeMatch =
        p.match(/(?:reassign|assign|move)[^A-Z]*\bto\s+([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+)?)/) ??
        p.match(/→\s+([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+)?)/);
      if (assigneeMatch) {
        const name = assigneeMatch[1].trim();
        patch.assignee_name = name;
        summaryBits.unshift(`→ ${name}`);
      }

      // Due date — match "by <date>" or "due <date>"
      const dueMatch = p.match(
        /\b(?:by|due)\s+(\d{4}-\d{2}-\d{2}|\w+\s+\d{1,2}(?:,\s*\d{4})?)/i
      );
      if (dueMatch) {
        patch.due_date = dueMatch[1];
        summaryBits.push(`by ${dueMatch[1]}`);
      }

      if (Object.keys(patch).length > 0) {
        const summary = summaryBits.join(" · ");
        return {
          stream: [
            `Updating ${wo.number}: `,
            `${summary}. `,
            `Approve below to commit.`,
          ],
          action: {
            kind: "update_work_order",
            label: `Update ${wo.number} ${summary}`,
            work_order_id: wo.id,
            work_order_number: wo.number,
            patch,
            summary,
          },
        };
      }
    }
  }

  // ── INTENT: invite / add staff user ──────────────────────────
  // Matches "Add Steven Bills as a new user", "invite Tiffany as
  // manager", "add J. Reyes as a dockhand", etc. The simulated path
  // doesn't need an email — the executor synthesizes a placeholder
  // address so the user can edit it post-approval.
  if (
    /\b(add|invite|create|onboard)\b.*\b(user|staff|teammate|employee|admin|manager|dockhand|harbormaster|office)\b/.test(
      lp
    ) ||
    /\bas\s+(a\s+)?(super\s+admin|admin|manager|dockhand|harbormaster|office|owner)\b/.test(
      lp
    )
  ) {
    // Pull a name like "Steven Bills", "Tiffany", "J. Reyes"
    const nameMatch =
      p.match(
        /(?:add|invite|create|onboard)\s+([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,2})/
      ) ?? p.match(/([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,2})\s+as\s+/);
    const name = nameMatch ? nameMatch[1].trim() : "";

    // Pull an email (if present) or synthesize a placeholder
    const emailMatch = p.match(/[\w.+-]+@[\w.-]+\.[\w]+/);
    const email =
      emailMatch?.[0] ??
      (name
        ? `${name.toLowerCase().replace(/[^\w]+/g, ".")}@example.com`
        : "");

    // Role keyword → role
    let role =
      ROLES_SEED.find((r) => r.name.toLowerCase() === "dockhand") ??
      ROLES_SEED[ROLES_SEED.length - 1];
    if (/super\s*admin|owner/.test(lp)) {
      role = ROLES_SEED.find((r) => /super/i.test(r.name)) ?? role;
    } else if (/manager/.test(lp)) {
      role = ROLES_SEED.find((r) => /manager/i.test(r.name)) ?? role;
    } else if (/dockhand|harbormaster/.test(lp)) {
      role = ROLES_SEED.find((r) => /dockhand/i.test(r.name)) ?? role;
    } else if (/office|front\s*desk|admin/.test(lp)) {
      role =
        ROLES_SEED.find((r) => /office|admin/i.test(r.name)) ??
        ROLES_SEED.find((r) => /super/i.test(r.name)) ??
        role;
    }

    if (name) {
      return {
        stream: [
          `Drafting an invite for ${name} `,
          `as ${role.name}. `,
          emailMatch
            ? `I'll send the activation link to ${email}. `
            : `No email caught in your message — I plugged in a placeholder you can edit on the next screen. `,
          `Approve below to add them to the staff list.`,
        ],
        action: {
          kind: "invite_staff",
          label: `Invite ${name} as ${role.name}`,
          name,
          email,
          role_id: role.id,
          role_name: role.name,
        },
      };
    }
    return {
      stream: [
        `Sure — who do you want to add? `,
        `Try "Add Tiffany Hart as Manager" or "Invite jr@marina.com as a dockhand".`,
      ],
    };
  }

  // ── INTENT: create vendor bill from a PDF ────────────────────
  //
  // Triggers: phrasing like "create a bill from this PDF",
  // "log the attached invoice", "make a bill from the PDF I just
  // uploaded". The handler defers extraction to /api/pdf-extract;
  // the operator sees a review screen pre-filled from the parse and
  // can adjust before the create_vendor_bill action fires.
  //
  // pdf_storage_id is a sentinel in the simulated path — the real
  // operator flow (drop-on-wizard) plumbs the storage id directly,
  // bypassing the simulated matcher entirely.
  if (
    /(?:create|make|draft|log).*(?:bill|invoice).*(?:from|using).*pdf/.test(lp) ||
    /bill.*from.*(?:attached|uploaded|attachment)/.test(lp)
  ) {
    return {
      stream: [
        `I'll parse the attached PDF and stage a bill draft. `,
        `You'll see the extracted vendor, amount, and line items on the next screen — `,
        `adjust anything that looks off, then approve.`,
      ],
      action: {
        kind: "create_vendor_bill_from_pdf",
        label: "Create bill from attached PDF",
        pdf_storage_id: "stub_pdf_storage_id",
        summary: "Awaiting PDF parse",
      },
    };
  }

  // ── INTENT: extract contract terms from a PDF ────────────────
  //
  // Triggers: "pull the dates from this contract", "extract the terms
  // from the lease PDF", "what does the attached contract say". The
  // handler defers to /api/pdf-extract; result lands on a review modal
  // — operator confirms before draft_contract fires.
  if (
    /(?:extract|pull|parse|read).*(?:contract|lease|agreement)/.test(lp) ||
    /contract.*terms.*(?:from|in).*pdf/.test(lp) ||
    /what.*(?:contract|lease).*say/.test(lp)
  ) {
    const b = findBoater(p);
    return {
      stream: [
        `Reading the contract PDF`,
        b ? ` for ${b.display_name}. ` : `. `,
        `I'll surface effective dates, annual rate, billing cadence, `,
        `and the signing party so you can confirm before drafting.`,
      ],
      action: {
        kind: "extract_contract_terms",
        label: "Extract contract terms from PDF",
        pdf_storage_id: "stub_pdf_storage_id",
        boater_query: b ? b.display_name : undefined,
        summary: "Awaiting contract parse",
      },
    };
  }

  // ── INTENT: vendor bill — receive a new invoice ──────────────
  //
  // Triggers: "got an invoice from <vendor>", "received a bill for
  // $X from <vendor>", "log invoice from <vendor>". Matches the
  // vendor by name fragment against VENDORS_SEED and pulls amount +
  // optional invoice number from the prompt. Default lifecycle:
  // pending_approval (matches the AP workflow expectations).
  if (
    /(?:got|received|new|log|record).*(?:invoice|bill).*from/.test(lp) ||
    /^(?:invoice|bill)\s+from/.test(lp)
  ) {
    const tenantVendors = VENDORS_SEED.filter((v) => v.tenant_id === tenantId);
    const vendor = tenantVendors.find((v) => {
      const display = (v.display_name ?? v.name).toLowerCase();
      const first = display.split(/\s+/)[0];
      return lp.includes(display) || (first && lp.includes(first));
    });
    if (!vendor) {
      return {
        stream: [
          `I didn't catch which vendor. `,
          `Try "Got an invoice from Pinon Petroleum for $4,200" — `,
          `I'll match against the vendor list and draft the bill.`,
        ],
      };
    }
    const amtMatch = lp.match(/\$?\s*([\d,]+(?:\.\d{1,2})?)/);
    const amount = amtMatch ? Number(amtMatch[1].replace(/,/g, "")) : 0;
    const invNumMatch = p.match(
      /(?:invoice|inv|number|#)\s*[#:]?\s*([A-Z0-9\-]{3,})/i,
    );
    const vendorInvoiceNumber = invNumMatch?.[1];

    const today = new Date().toISOString().slice(0, 10);
    return {
      stream: amount > 0
        ? [
            `Drafting a bill from ${vendor.display_name ?? vendor.name} `,
            `for ${formatMoney(amount)}${vendorInvoiceNumber ? ` (invoice ${vendorInvoiceNumber})` : ""}. `,
            `Terms ${vendor.payment_terms.replace("_", " ")} — `,
            `I'll route it to pending approval. Approve below.`,
          ]
        : [
            `Capturing a draft bill from ${vendor.display_name ?? vendor.name}. `,
            `I didn't catch the amount — `,
            `approve as draft now and key the total when the PDF arrives.`,
          ],
      action: {
        kind: "create_vendor_bill",
        label: amount > 0
          ? `Create $${amount.toFixed(2)} bill from ${vendor.display_name ?? vendor.name}`
          : `Capture draft bill from ${vendor.display_name ?? vendor.name}`,
        vendor_id: vendor.id,
        vendor_name: vendor.display_name ?? vendor.name,
        vendor_invoice_number: vendorInvoiceNumber,
        bill_date: today,
        amount,
        description: vendorInvoiceNumber
          ? `Invoice ${vendorInvoiceNumber}`
          : undefined,
        submit_as: amount > 0 ? "pending_approval" : "draft",
      },
    };
  }

  // ── INTENT: approve a pending vendor bill ────────────────────
  if (/approve.*(?:bill|invoice|bil-)/.test(lp)) {
    const tenantBills = VENDOR_BILLS_SEED.filter(
      (b) => b.tenant_id === tenantId,
    );
    const bilMatch = lp.match(/bil-\s*(\d+)/i);
    const bill = bilMatch
      ? tenantBills.find((b) => b.number.toLowerCase() === `bil-${bilMatch[1].padStart(4, "0")}`)
      : tenantBills.find((b) => {
          const v = VENDORS_SEED.find((x) => x.id === b.vendor_id);
          if (!v) return false;
          const first = (v.display_name ?? v.name).toLowerCase().split(/\s+/)[0];
          return (
            b.status === "pending_approval" &&
            first &&
            lp.includes(first)
          );
        });
    if (!bill) {
      return {
        stream: [
          `I couldn't find a matching bill. `,
          `Try "approve BIL-0002" or "approve the Pinon bill" — `,
          `I'll match against the pending-approval queue.`,
        ],
      };
    }
    const vendor = VENDORS_SEED.find((v) => v.id === bill.vendor_id);
    const vendorName = vendor?.display_name ?? vendor?.name ?? bill.vendor_id;
    return {
      stream: [
        `Approving ${bill.number} from ${vendorName} — `,
        `${formatMoney(bill.amount)}. `,
        `Once approved it'll show up in the scheduled-payment queue. `,
        `Confirm below.`,
      ],
      action: {
        kind: "approve_vendor_bill",
        label: `Approve ${bill.number} — ${vendorName}`,
        vendor_bill_id: bill.id,
        bill_number: bill.number,
        vendor_name: vendorName,
        amount: bill.amount,
      },
    };
  }

  // ── INTENT: pay a vendor bill / mark vendor bill paid ────────
  if (
    /(?:pay|mark.*paid|paid).*(?:bil-|vendor.*bill|to\s+vendor)/.test(lp) ||
    /pay.*bill.*from/.test(lp)
  ) {
    const tenantBills = VENDOR_BILLS_SEED.filter(
      (b) => b.tenant_id === tenantId,
    );
    const bilMatch = lp.match(/bil-\s*(\d+)/i);
    const bill = bilMatch
      ? tenantBills.find((b) => b.number.toLowerCase() === `bil-${bilMatch[1].padStart(4, "0")}`)
      : tenantBills.find((b) => {
          const v = VENDORS_SEED.find((x) => x.id === b.vendor_id);
          if (!v) return false;
          const first = (v.display_name ?? v.name).toLowerCase().split(/\s+/)[0];
          return (
            (b.status === "approved" || b.status === "scheduled") &&
            first &&
            lp.includes(first)
          );
        });
    if (bill) {
      const vendor = VENDORS_SEED.find((v) => v.id === bill.vendor_id);
      const vendorName = vendor?.display_name ?? vendor?.name ?? bill.vendor_id;
      const method =
        bill.scheduled_payment_method ?? ("ach" as const);
      return {
        stream: [
          `Marking ${bill.number} from ${vendorName} paid — `,
          `${formatMoney(bill.amount)} via ${method.toUpperCase()}. `,
          `Cash outflow posts to the ledger; QB picks it up on the next sync.`,
        ],
        action: {
          kind: "mark_vendor_bill_paid",
          label: `Pay ${bill.number} — ${vendorName} (${formatMoney(bill.amount)})`,
          vendor_bill_id: bill.id,
          bill_number: bill.number,
          vendor_name: vendorName,
          amount: bill.amount,
          payment_method: method,
        },
      };
    }
  }

  // ── INTENT: schedule a vendor bill payment ───────────────────
  if (/schedule.*(?:payment|pay).*(?:bil-|vendor.*bill|to\s+vendor)/.test(lp)) {
    const tenantBills = VENDOR_BILLS_SEED.filter(
      (b) => b.tenant_id === tenantId,
    );
    const bilMatch = lp.match(/bil-\s*(\d+)/i);
    const bill = bilMatch
      ? tenantBills.find((b) => b.number.toLowerCase() === `bil-${bilMatch[1].padStart(4, "0")}`)
      : tenantBills.find((b) => {
          const v = VENDORS_SEED.find((x) => x.id === b.vendor_id);
          if (!v) return false;
          const first = (v.display_name ?? v.name).toLowerCase().split(/\s+/)[0];
          return b.status === "approved" && first && lp.includes(first);
        });
    if (bill) {
      const vendor = VENDORS_SEED.find((v) => v.id === bill.vendor_id);
      const vendorName = vendor?.display_name ?? vendor?.name ?? bill.vendor_id;
      const method: "ach" | "check" | "card" | "wire" = /check/.test(lp)
        ? "check"
        : /wire/.test(lp)
          ? "wire"
          : /card/.test(lp)
            ? "card"
            : "ach";
      return {
        stream: [
          `Scheduling ${bill.number} (${vendorName}) `,
          `for payment on ${bill.due_date} via ${method.toUpperCase()}. `,
          `Confirm below — funds release on the scheduled date.`,
        ],
        action: {
          kind: "schedule_vendor_bill_payment",
          label: `Schedule ${bill.number} — ${vendorName} on ${bill.due_date}`,
          vendor_bill_id: bill.id,
          bill_number: bill.number,
          vendor_name: vendorName,
          amount: bill.amount,
          scheduled_payment_date: bill.due_date,
          scheduled_payment_method: method,
        },
      };
    }
  }

  // ── INTENT: clock in / clock out ─────────────────────────────
  // Matches "clock in Jamie", "Jamie is clocking out", "punch in
  // dock A", "clock me out". Looks up the staff by first/last name
  // token; falls through when no match.
  if (
    /\b(clock|punch)\s*(in|out)\b/.test(lp) ||
    /\bclocked?\s+(in|out)\b/.test(lp)
  ) {
    const wantsOut = /\b(out|off)\b/.test(lp);
    // Resolve staff by name token (case-insensitive substring match).
    const tenantStaff = STAFF_SEED.filter(
      (s) => (s.tenant_id ?? "ten_marina_stee_demo") === tenantId,
    );
    const staffHit = tenantStaff.find((s) => {
      const tokens = s.name.toLowerCase().split(/[\s,]+/);
      return tokens.some((t) => t.length > 2 && lp.includes(t));
    });
    if (staffHit) {
      if (wantsOut) {
        // Find the open entry for this staff.
        const open = TIME_ENTRIES_SEED.find(
          (t) =>
            (t.tenant_id ?? "ten_marina_stee_demo") === tenantId &&
            t.staff_id === staffHit.id &&
            !t.clock_out_at,
        );
        const elapsed = open
          ? ((Date.now() - new Date(open.clock_in_at).getTime()) / 3_600_000).toFixed(2)
          : null;
        return {
          stream: [
            `Clocking out ${staffHit.name}`,
            elapsed ? ` — ${elapsed}h today. ` : `. `,
            `Approve below to log the punch.`,
          ],
          action: {
            kind: "clock_out",
            label: `Clock out ${staffHit.name}`,
            staff_id: staffHit.id,
            staff_name: staffHit.name,
            time_entry_id: open?.id,
            summary: elapsed ? `${elapsed}h today` : "Open entry",
          },
        };
      }
      return {
        stream: [
          `Clocking in ${staffHit.name}`,
          staffHit.default_position ? ` (${staffHit.default_position}). ` : `. `,
          `Approve below to start their shift.`,
        ],
        action: {
          kind: "clock_in",
          label: `Clock in ${staffHit.name}`,
          staff_id: staffHit.id,
          staff_name: staffHit.name,
          position: staffHit.default_position,
        },
      };
    }
  }

  // ── INTENT: adjust a time entry ──────────────────────────────
  // Matches "fix Jamie's Friday — out at 4:30 not 4:00", "adjust
  // Dock Lead A's clock-out", "correct the timecard". The simulated
  // version resolves the most-recent unpaid entry and emits a
  // placeholder patch; the operator confirms on the action card.
  if (/\b(fix|adjust|correct|edit)\b.*(time\s*card|timecard|punch|clock[\s-]?(in|out))\b/.test(lp)) {
    const tenantStaff = STAFF_SEED.filter(
      (s) => (s.tenant_id ?? "ten_marina_stee_demo") === tenantId,
    );
    const staffHit = tenantStaff.find((s) => {
      const tokens = s.name.toLowerCase().split(/[\s,]+/);
      return tokens.some((t) => t.length > 2 && lp.includes(t));
    });
    if (staffHit) {
      // Pull the most recent completed unpaid entry for this staff.
      const entry = TIME_ENTRIES_SEED
        .filter(
          (t) =>
            (t.tenant_id ?? "ten_marina_stee_demo") === tenantId &&
            t.staff_id === staffHit.id &&
            t.clock_out_at &&
            !t.payroll_run_id,
        )
        .sort((a, b) => (b.clock_out_at ?? "").localeCompare(a.clock_out_at ?? ""))[0];
      if (entry) {
        const adjuster =
          tenantStaff.find((s) => s.default_position?.includes("Manager") || s.default_position?.includes("Owner")) ??
          tenantStaff[0];
        return {
          stream: [
            `Opening ${staffHit.name}'s timecard from `,
            `${new Date(entry.clock_in_at).toLocaleDateString()}. `,
            `Tell me what to change and I'll patch it.`,
          ],
          action: {
            kind: "adjust_time_entry",
            label: `Adjust ${staffHit.name}'s timecard`,
            time_entry_id: entry.id,
            staff_id: staffHit.id,
            staff_name: staffHit.name,
            adjuster_staff_id: adjuster?.id ?? staffHit.id,
            patch: {},
            summary: `Open ${staffHit.name}'s ${new Date(entry.clock_in_at).toLocaleDateString()} entry`,
          },
        };
      }
    }
  }

  // ── INTENT: close payroll period / run payroll ──────────────
  // Matches "close payroll", "close the current period", "run
  // payroll for this week", "finalize payroll". Locks the open
  // period after the operator confirms; tax/withholding deferred
  // to the actual provider integration.
  if (
    /\b(close|finalize|finish|wrap)\b.*\b(payroll|pay\s*period|payroll\s*period|cycle)\b/.test(lp) ||
    /\brun\s+payroll\b/.test(lp)
  ) {
    const openPeriod = PAYROLL_PERIODS_SEED.find(
      (p) => (p.tenant_id ?? "ten_marina_stee_demo") === tenantId && p.status === "open",
    );
    if (openPeriod) {
      const tenantStaff = STAFF_SEED.filter(
        (s) => (s.tenant_id ?? "ten_marina_stee_demo") === tenantId,
      );
      // Quick projection — sum calculated_hours in the window for hourly
      // staff, add salary slices for salaried. Mirrors computePaystubPreview
      // (in lib/client-store) at a higher altitude.
      let totalHours = 0;
      let totalGross = 0;
      for (const s of tenantStaff) {
        if (s.status !== "active") continue;
        if (s.salary_annual && s.salary_annual > 0) {
          totalGross += s.salary_annual / 26;
          continue;
        }
        if (!s.hourly_rate) continue;
        const inWindow = TIME_ENTRIES_SEED.filter(
          (t) =>
            t.staff_id === s.id &&
            t.clock_out_at &&
            t.clock_out_at.slice(0, 10) >= openPeriod.start_date &&
            t.clock_out_at.slice(0, 10) <= openPeriod.end_date,
        );
        const hrs = inWindow.reduce((sum, t) => sum + (t.calculated_hours ?? 0), 0);
        totalHours += hrs;
        totalGross += hrs * s.hourly_rate; // ignore OT in the rough estimate
      }
      const adjuster =
        tenantStaff.find((s) => s.default_position?.includes("Manager") || s.default_position?.includes("Owner")) ??
        tenantStaff[0];
      const summary = `${openPeriod.start_date} → ${openPeriod.end_date} · ${formatMoney(totalGross)} gross · ${totalHours.toFixed(1)}h`;
      return {
        stream: [
          `Closing payroll period ${openPeriod.start_date} → ${openPeriod.end_date}. `,
          `Projected gross: ${formatMoney(totalGross)} across ${totalHours.toFixed(1)} hours. `,
          `Approve below to lock the entries — paystub preview opens after.`,
        ],
        action: {
          kind: "close_payroll_period",
          label: `Close payroll ${openPeriod.start_date} → ${openPeriod.end_date}`,
          period_id: openPeriod.id,
          closer_staff_id: adjuster?.id ?? "",
          total_gross: +totalGross.toFixed(2),
          total_hours: +totalHours.toFixed(2),
          summary,
        },
      };
    }
    return {
      stream: [
        `No open payroll period right now. `,
        `Open a new biweekly window from /staff → Payroll and I'll close it for you.`,
      ],
    };
  }

  // ── INTENT: fire waitlist offer on a freed slip ──────────────
  // "Slip A14 just opened — fire offers to the top 3 waitlisters"
  // "Slip B07 cancelled, send a waitlist offer to next eligible"
  // "Fire waitlist on C03"
  if (
    /\b(fire|send|offer|open).{0,20}\bwaitlist\b/.test(lp) ||
    /\bwaitlist.{0,20}(offer|fire|notify|cascade)\b/.test(lp) ||
    /\bslip\s+[a-z]\d{1,3}.{0,30}(opened|opening|freed|cancelled|cancel|free)/.test(lp)
  ) {
    const slipMatch = lp.match(/\b([a-z])\s?(\d{1,3})\b/i);
    const slipIdGuess = slipMatch
      ? `${slipMatch[1].toUpperCase()}${slipMatch[2].padStart(2, "0")}`
      : undefined;
    const resolvedSlip = slipIdGuess
      ? SLIPS.find((s) => s.id.toLowerCase() === slipIdGuess.toLowerCase())
      : undefined;
    const slipResolvedId = resolvedSlip?.id ?? slipIdGuess;

    const nMatch = lp.match(/\b(?:top|next|first)\s*(\d{1,2})\b/);
    const topN = nMatch ? Number(nMatch[1]) : 3;

    const slipLOAIn = resolvedSlip?.max_loa_inches;
    const candidates = WAITLIST.filter(
      (w) =>
        (w.tenant_id ?? tenantId) === tenantId &&
        w.status === "pending" &&
        (w.offer_status ?? "none") !== "pending" &&
        (!slipLOAIn || !w.loa_inches || w.loa_inches <= slipLOAIn),
    )
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, topN);

    if (slipResolvedId && candidates.length > 0) {
      const expiresHours = 48;
      return {
        stream: [
          `Drafting ${candidates.length} waitlist offer${candidates.length === 1 ? "" : "s"} `,
          `on slip ${slipResolvedId} `,
          `with a ${expiresHours}h window. `,
          `Approve below — I'll mint the public links + dispatch comms in one batch.`,
        ],
        action: {
          kind: "fire_waitlist_offer",
          label: `Fire ${candidates.length} waitlist offer${candidates.length === 1 ? "" : "s"} on slip ${slipResolvedId}`,
          slip_id: slipResolvedId,
          entry_ids: candidates.map((c) => c.id),
          expires_hours: expiresHours,
          summary: `${candidates.length} candidate${candidates.length === 1 ? "" : "s"} · ${expiresHours}h expiry · slip ${slipResolvedId}`,
        },
      };
    }
    if (slipResolvedId && candidates.length === 0) {
      return {
        stream: [
          `Slip ${slipResolvedId} resolved, `,
          `but no eligible waitlisters match (size + already-pending filter). `,
          `Walk the queue manually from /services/roster → Waitlist.`,
        ],
      };
    }
  }

  // ── INTENT: accept/decline a fired offer (operator-side demo) ─
  // "Accept the offer for Morrow" / "Mark the Pratt offer declined"
  if (
    /\b(accept|approve).{0,20}\b(waitlist|offer)\b/.test(lp) ||
    /\b(decline|reject).{0,20}\b(waitlist|offer)\b/.test(lp)
  ) {
    const isAccept = /\b(accept|approve)\b/.test(lp);
    const tenantHits = WAITLIST.filter(
      (w) => (w.tenant_id ?? tenantId) === tenantId && w.offer_status === "pending",
    );
    const namedHit = tenantHits.find((w) => {
      const boater = w.boater_id ? BOATERS.find((b) => b.id === w.boater_id) : undefined;
      const display = (boater?.display_name ?? w.guest_name ?? "").toLowerCase();
      const tokens = display.split(/[\s,]+/).filter((t) => t.length > 2);
      return tokens.some((t) => lp.includes(t));
    });
    const target = namedHit ?? tenantHits[0];
    if (target && target.offer_token) {
      const boater = target.boater_id
        ? BOATERS.find((b) => b.id === target.boater_id)
        : undefined;
      const applicantName =
        boater?.display_name ?? target.guest_name ?? "Waitlist applicant";
      if (isAccept) {
        return {
          stream: [
            `Accepting ${applicantName}'s offer for slip ${target.offered_slip_id ?? "?"}. `,
            `Approve below — I'll draft the contract + send the onboarding link.`,
          ],
          action: {
            kind: "accept_waitlist_offer",
            label: `Accept waitlist offer — ${applicantName}`,
            offer_token: target.offer_token,
            entry_id: target.id,
            slip_id: target.offered_slip_id,
            applicant_name: applicantName,
          },
        };
      }
      return {
        stream: [
          `Declining ${applicantName}'s offer for slip ${target.offered_slip_id ?? "?"}. `,
          `Approve below — I'll auto-advance to the next eligible waitlister.`,
        ],
        action: {
          kind: "decline_waitlist_offer",
          label: `Decline waitlist offer — ${applicantName}`,
          offer_token: target.offer_token,
          entry_id: target.id,
          slip_id: target.offered_slip_id,
          applicant_name: applicantName,
          auto_advance: true,
        },
      };
    }
  }

  // ── INTENT: boater application approve / decline / route ──────
  //   "approve application APP-1002" / "approve maya's application"
  //   "decline APP-1004 — beam too wide"
  //   "route renfrew's application to the waitlist"
  if (
    /\b(approve|accept|admit)\b.{0,40}\bapplication\b/.test(lp) ||
    /\bapplication\b.{0,20}\b(approve|accept)\b/.test(lp) ||
    /\b(decline|reject|deny|refuse)\b.{0,40}\bapplication\b/.test(lp) ||
    /\bapplication\b.{0,20}\b(decline|reject|deny)\b/.test(lp) ||
    /\b(route|move|send)\b.{0,40}\bapplication\b.{0,40}\bwaitlist\b/.test(lp) ||
    /\bapplication\b.{0,30}\bwaitlist\b/.test(lp)
  ) {
    const tenantApps = APPLICATIONS_SEED.filter(
      (a) => (a.tenant_id ?? "ten_marina_stee_demo") === tenantId,
    );
    // Try APP-#### exact match first
    const numMatch = lp.match(/app-?\s?(\d{3,5})/);
    let app = numMatch
      ? tenantApps.find((a) => a.number.toLowerCase().endsWith(numMatch[1]))
      : undefined;
    // Then last-name fuzzy
    if (!app) {
      app = tenantApps.find((a) =>
        lp.includes(a.applicant_last_name.toLowerCase()),
      );
    }
    // Then first-name fuzzy
    if (!app) {
      app = tenantApps.find((a) =>
        lp.includes(a.applicant_first_name.toLowerCase()),
      );
    }
    if (!app) {
      return {
        stream: [
          `Couldn't pin down which application you mean. `,
          `Try "approve APP-1002" or "decline Pratt's application — beam too wide."`,
        ],
      };
    }
    const summary = `${app.number} · ${app.applicant_first_name} ${app.applicant_last_name} · ${app.vessel_name}`;
    if (/\b(route|move|send)\b.{0,40}\bwaitlist\b/.test(lp) || /\bwaitlist\b/.test(lp)) {
      return {
        stream: [
          `Routing ${app.number} (${app.applicant_first_name} ${app.applicant_last_name}) to the waitlist. `,
          `Approve below to fire — the applicant will be notified.`,
        ],
        action: {
          kind: "route_application_to_waitlist",
          label: `Route ${app.number} to waitlist`,
          application_id: app.id,
          summary,
        },
      };
    }
    if (/\b(decline|reject|deny|refuse)\b/.test(lp)) {
      // Pull any free-text reason after "decline / reject / etc — reason"
      const reasonMatch = lp.match(/(?:decline|reject|deny|refuse)[^—-]*[—-]\s*(.+)$/);
      const internal_review_notes = reasonMatch
        ? reasonMatch[1].trim()
        : undefined;
      return {
        stream: [
          `Declining ${app.number}. `,
          `A polite decline comm will be drafted to ${app.applicant_email}.`,
        ],
        action: {
          kind: "decline_application",
          label: `Decline ${app.number}`,
          application_id: app.id,
          internal_review_notes,
          summary,
        },
      };
    }
    return {
      stream: [
        `Approving ${app.number}. `,
        `I'll mint a Boater + Vessel and draft a welcome email to ${app.applicant_email}.`,
      ],
      action: {
        kind: "approve_application",
        label: `Approve ${app.number}`,
        application_id: app.id,
        summary,
      },
    };
  }

  // ── DEFAULT fallback ─────────────────────────────────────────
  return {
    stream: [
      `I can help with: `,
      `slip occupancy ("vacant 30-footers with power"), `,
      `A/R ("largest open balance"), `,
      `charges ("charge a hoist fee to David"), `,
      `meters ("any anomalies?"), `,
      `contracts ("when does David's lease expire?"), `,
      `work orders ("active jobs"), `,
      `and fuel ("what's our margin?").`,
    ],
  };
}

// Use `getSlip` to silence the unused import — it's there to support future
// intents like "show me the boater in slip A29".
void getSlip;
