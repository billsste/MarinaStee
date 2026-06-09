"use client";

/*
 * Client wrapper for the agent stream.
 *
 * Speaks NDJSON to /api/agent. Yields a small union of events:
 *   { kind: "text"; text: string }
 *   { kind: "action"; action: AgentAction }
 *   { kind: "source"; source: "claude" | "simulated" }
 *
 * If the network fetch fails entirely (offline, server crash), we fall back
 * to a local-only simulated stream so the agent UI never appears broken.
 */

import {
  ADDITIONAL_FEES,
  BOAT_RENTALS,
  BOATERS,
  CLUB_SUBSCRIPTIONS,
  COMM_TEMPLATES_SEED,
  CONTRACTS,
  DOCKS,
  INSURANCE_CERTIFICATES,
  POS_CATALOG,
  POS_LOCATIONS,
  PROVIDER_CONFIGS_SEED,
  RATES,
  RENTAL_BOATS,
  RENTAL_GROUPS,
  RENTAL_SPACES,
  RESERVATIONS,
  ROLES_SEED,
  SLIPS,
  STAFF_SEED,
  TIME_ENTRIES_SEED,
  VENDORS_SEED,
  BILLS_SEED,
  MARINA_ASSETS_SEED,
  VESSELS,
  WORK_ORDERS,
} from "@/lib/mock-data";
import { getCurrentTenantId } from "@/lib/client-store";
// Route helpers moved into the registered NavigateToTool — see
// lib/agent-tools/navigate-to.ts.
import type { TableResult } from "@/lib/agent-reports";
import { resolveRegisteredTool } from "@/lib/agent-tools";
import {
  generateAgentResponse,
  type AgentAction,
} from "@/lib/simulated-agent";
import type { Boater, Contract, LedgerEntry } from "@/lib/types";

export type AgentStreamEvent =
  | { kind: "text"; text: string }
  | { kind: "action"; action: AgentAction }
  | { kind: "tool_step"; name: string; result: unknown }
  | { kind: "source"; source: "claude" | "simulated" }
  | { kind: "error"; message: string };

export async function* streamAgent(
  prompt: string,
  ledger: LedgerEntry[]
): AsyncGenerator<AgentStreamEvent, void, void> {
  yield* streamAgentInternal({ prompt, ledger, mode: "staff" });
}

/**
 * Holder-scoped stream. Same wire format as streamAgent, but POSTs
 * mode="holder" + holder_boater_id so the server uses the holder tool
 * registry + holder system prompt + holder-scoped context. Action
 * resolution is also holder-aware: tool inputs are merged with the
 * captured boater_id so the resulting AgentAction round-trips through
 * the existing executor.
 */
export async function* streamHolderAgent(
  prompt: string,
  ledger: LedgerEntry[],
  holderBoaterId: string
): AsyncGenerator<AgentStreamEvent, void, void> {
  yield* streamAgentInternal({
    prompt,
    ledger,
    mode: "holder",
    holderBoaterId,
  });
}

async function* streamAgentInternal({
  prompt,
  ledger,
  mode,
  holderBoaterId,
}: {
  prompt: string;
  ledger: LedgerEntry[];
  mode: "staff" | "holder";
  holderBoaterId?: string;
}): AsyncGenerator<AgentStreamEvent, void, void> {
  let res: Response | null = null;
  try {
    res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        ledger,
        mode,
        // Server-side staff agent scopes BOATERS + read tools to this
        // tenant. Holder mode ignores it (the holder's boater_id is
        // already the scope) but we include it anyway for consistency.
        tenant_id: getCurrentTenantId(),
        ...(holderBoaterId ? { holder_boater_id: holderBoaterId } : {}),
      }),
    });
  } catch {
    res = null;
  }

  if (!res || !res.body || !res.ok) {
    if (mode === "holder") {
      yield* holderLocalFallback(prompt, holderBoaterId);
    } else {
      yield* localFallback(prompt, ledger);
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Drain complete lines
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;

      let parsed: WireEvent;
      try {
        parsed = JSON.parse(line) as WireEvent;
      } catch {
        continue;
      }

      const ev =
        mode === "holder" && holderBoaterId
          ? translateHolder(parsed, holderBoaterId)
          : translate(parsed);
      if (ev) yield ev;
    }
  }
}

async function* holderLocalFallback(
  prompt: string,
  boaterId?: string
): AsyncGenerator<AgentStreamEvent, void, void> {
  const boater = boaterId
    ? BOATERS.find((b) => b.id === boaterId)
    : undefined;
  const first = boater?.first_name ?? "there";
  const text = `Hi ${first}, I heard "${prompt.slice(
    0,
    120
  )}${prompt.length > 120 ? "…" : ""}". The agent isn't online right now — try again in a moment.`;
  for (const word of text.split(/(\s+)/)) {
    yield { kind: "text", text: word };
    await new Promise((r) => setTimeout(r, 15));
  }
}

/**
 * Translate a wire event for HOLDER mode. The holder-* tools have a
 * simpler resolution path: every action implicitly belongs to the
 * signed-in holder, so we inject boater_id and pass the rest through.
 */
function translateHolder(
  ev: WireEvent,
  holderBoaterId: string
): AgentStreamEvent | null {
  if (ev.type === "source") return { kind: "source", source: ev.source };
  if (ev.type === "text") return { kind: "text", text: ev.delta };
  if (ev.type === "error") return { kind: "error", message: ev.message };
  if (ev.type === "done") return null;
  if (ev.type === "tool_step")
    return { kind: "tool_step", name: ev.name, result: ev.result };
  if (ev.type === "tool") {
    const action = resolveHolderTool(ev.name, ev.input, holderBoaterId);
    if (action) return { kind: "action", action };
    return null;
  }
  return null;
}

function resolveHolderTool(
  name: string,
  input: Record<string, unknown>,
  boaterId: string
): AgentAction | null {
  const boater = BOATERS.find((b) => b.id === boaterId);
  if (!boater) return null;
  const inp = input ?? {};

  if (name === "holder_message_marina") {
    const body = String(inp.body ?? "").trim();
    if (!body) return null;
    return {
      kind: "holder_message_marina",
      label: `Send message to marina — "${body.slice(0, 40)}${body.length > 40 ? "…" : ""}"`,
      boater_id: boaterId,
      subject: typeof inp.subject === "string" ? inp.subject : undefined,
      body,
    };
  }

  if (name === "holder_request_work_order") {
    const subject = String(inp.subject ?? "").trim();
    if (!subject) return null;
    return {
      kind: "holder_request_work_order",
      label: `Submit service request — ${subject}`,
      boater_id: boaterId,
      subject,
      description:
        typeof inp.description === "string" ? inp.description : undefined,
      activity_type:
        typeof inp.activity_type === "string"
          ? (inp.activity_type as
              | "pump_out"
              | "service"
              | "inspection"
              | "haul_out"
              | "winterization"
              | "bottom_paint"
              | "task"
              | "other")
          : "service",
      priority:
        typeof inp.priority === "string"
          ? (inp.priority as "low" | "normal" | "high" | "urgent")
          : "normal",
      preferred_date:
        typeof inp.preferred_date === "string" ? inp.preferred_date : undefined,
    };
  }

  if (name === "holder_schedule_pump_out") {
    return {
      kind: "holder_schedule_pump_out",
      label: `Schedule pump-out${
        typeof inp.preferred_date === "string"
          ? ` for ${inp.preferred_date}`
          : ""
      }`,
      boater_id: boaterId,
      preferred_date:
        typeof inp.preferred_date === "string" ? inp.preferred_date : undefined,
      notes: typeof inp.notes === "string" ? inp.notes : undefined,
    };
  }

  if (name === "holder_pay_balance") {
    const amount = Number(inp.amount ?? 0);
    const method = inp.method === "ach" ? "ach" : "card";
    return {
      kind: "holder_pay_balance",
      label: `Pay $${amount.toFixed(2)} by ${method}`,
      boater_id: boaterId,
      amount,
      method,
      card_id: typeof inp.card_id === "string" ? inp.card_id : undefined,
      applied_to_invoice_ids: Array.isArray(inp.applied_to_invoice_ids)
        ? (inp.applied_to_invoice_ids as string[])
        : undefined,
    };
  }

  if (name === "holder_update_contact") {
    const fields: string[] = [];
    if (inp.email) fields.push("email");
    if (inp.phone) fields.push("phone");
    if (inp.address_line_1 || inp.city || inp.state || inp.postal_code)
      fields.push("address");
    return {
      kind: "holder_update_contact",
      label: `Update contact info (${fields.join(", ") || "—"})`,
      boater_id: boaterId,
      email: typeof inp.email === "string" ? inp.email : undefined,
      phone: typeof inp.phone === "string" ? inp.phone : undefined,
      address_line_1:
        typeof inp.address_line_1 === "string" ? inp.address_line_1 : undefined,
      address_line_2:
        typeof inp.address_line_2 === "string" ? inp.address_line_2 : undefined,
      city: typeof inp.city === "string" ? inp.city : undefined,
      state: typeof inp.state === "string" ? inp.state : undefined,
      postal_code:
        typeof inp.postal_code === "string" ? inp.postal_code : undefined,
    };
  }

  if (name === "holder_add_card") {
    const last4 = String(inp.last4 ?? "");
    const brand = (inp.brand as "visa" | "mastercard" | "amex" | "discover") ?? "visa";
    return {
      kind: "holder_add_card",
      label: `Add ${brand} ending ${last4}`,
      boater_id: boaterId,
      brand,
      last4,
      exp_month: Number(inp.exp_month ?? 0),
      exp_year: Number(inp.exp_year ?? 0),
      nickname: typeof inp.nickname === "string" ? inp.nickname : undefined,
      is_default: inp.is_default === true,
    };
  }

  if (name === "holder_remove_card") {
    return {
      kind: "holder_remove_card",
      label: `Remove ${inp.card_summary ?? "card"}`,
      boater_id: boaterId,
      card_id: String(inp.card_id ?? ""),
      card_summary: String(inp.card_summary ?? "card"),
    };
  }

  if (name === "holder_request_slip_change") {
    return {
      kind: "holder_request_slip_change",
      label: "Request a different slip",
      boater_id: boaterId,
      reason: String(inp.reason ?? "Slip change requested"),
      desired_slip_traits:
        typeof inp.desired_slip_traits === "string"
          ? inp.desired_slip_traits
          : undefined,
    };
  }

  if (name === "holder_request_termination") {
    const active =
      CONTRACTS.find(
        (c) => c.boater_id === boaterId && c.status === "executed"
      ) ?? CONTRACTS.find((c) => c.boater_id === boaterId);
    if (!active) return null;
    return {
      kind: "holder_request_termination",
      label: `Request to terminate ${active.number}`,
      boater_id: boaterId,
      contract_id: active.id,
      contract_number: active.number,
      desired_end_date:
        typeof inp.desired_end_date === "string"
          ? inp.desired_end_date
          : undefined,
      reason: typeof inp.reason === "string" ? inp.reason : undefined,
    };
  }

  if (name === "holder_request_renewal_inquiry") {
    const active =
      CONTRACTS.find(
        (c) => c.boater_id === boaterId && c.status === "executed"
      ) ?? CONTRACTS.find((c) => c.boater_id === boaterId);
    return {
      kind: "holder_request_renewal_inquiry",
      label: "Ask about renewal terms",
      boater_id: boaterId,
      contract_id: active?.id,
      season_year:
        typeof inp.season_year === "number" ? inp.season_year : undefined,
      questions: String(inp.questions ?? "Holder wants to discuss renewal."),
    };
  }

  if (name === "holder_request_club_booking") {
    const date = typeof inp.date === "string" ? inp.date : "";
    return {
      kind: "holder_request_club_booking",
      label: `Request club day for ${date || "—"}`,
      boater_id: boaterId,
      date,
      notes: typeof inp.notes === "string" ? inp.notes : undefined,
    };
  }

  if (name === "holder_cancel_club_booking") {
    const bookingId =
      typeof inp.booking_id === "string" ? inp.booking_id : undefined;
    const date = typeof inp.date === "string" ? inp.date : undefined;
    return {
      kind: "holder_cancel_club_booking",
      label: bookingId
        ? `Cancel booking ${bookingId}`
        : date
        ? `Cancel club day on ${date}`
        : "Cancel club booking",
      boater_id: boaterId,
      booking_id: bookingId,
      date,
    };
  }

  return null;
}

// ────────────────────────────────────────────────────────────
// Wire format → public event shape
// ────────────────────────────────────────────────────────────

type WireEvent =
  | { type: "source"; source: "claude" | "simulated" }
  | { type: "text"; delta: string }
  | { type: "tool_step"; name: string; result: unknown }
  | {
      type: "tool";
      name: string;
      input: Record<string, unknown>;
      resolved?: {
        boater_id?: string;
        location_id?: string;
        line?: { name: string; price: number; sku: string };
        type?: "sms" | "email";
        subject?: string;
        body?: string;
      };
    }
  | { type: "done" }
  | { type: "error"; message: string };

function translate(ev: WireEvent): AgentStreamEvent | null {
  if (ev.type === "source") return { kind: "source", source: ev.source };
  if (ev.type === "text") return { kind: "text", text: ev.delta };
  if (ev.type === "error") return { kind: "error", message: ev.message };
  if (ev.type === "done") return null;
  if (ev.type === "tool_step")
    return { kind: "tool_step", name: ev.name, result: ev.result };

  if (ev.type === "tool") {
    // Registry-backed tools come first — anything written with defineTool
    // and registered in lib/agent-tools/index.ts is dispatched here. Old
    // hand-wired resolvers below stay for backward compat.
    const registryResult = resolveRegisteredTool({
      type: "tool",
      name: ev.name,
      input: ev.input,
    });
    if (registryResult) {
      if (registryResult.ok) {
        return { kind: "action", action: registryResult.action };
      }
      // Surface the refusal reason as a tool_step so the operator sees
      // why the agent's suggestion didn't render — silent-null is the
      // legacy behavior and it's confusing.
      return { kind: "tool_step", name: ev.name, result: { refused: registryResult.reason } };
    }
    // (navigate_to now lives in the registry above — was inline here
    // until the migration to defineTool. Kept this comment as a
    // breadcrumb for future tool authors.)
    // Tools that DON'T key off boater_query — they look up by boat /
    // slip / rental / coi instead. Handle these before the boater path.
    if (ev.name === "create_boater") {
      const action = resolveCreateBoaterAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "create_boat_rental") {
      const action = resolveCreateBoatRentalAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (
      ev.name === "close_boat_rental" ||
      ev.name === "send_pickup_link"
    ) {
      const action = resolveRentalLookupAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "notify_waitlist") {
      const action = resolveNotifyWaitlistAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "request_coi_renewal") {
      const action = resolveCoiRenewalAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "invite_staff") {
      const action = resolveInviteStaffAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "update_work_order") {
      const action = resolveUpdateWorkOrderAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    // Batch A: operator setup + catalog edits — none of these key off
    // boater_query, so they each get their own early-dispatch resolver.
    if (ev.name === "update_marina_profile") {
      const action = resolveUpdateMarinaProfileAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "create_dock") {
      const action = resolveCreateDockAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "update_dock") {
      const action = resolveUpdateDockAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "update_pos_location") {
      const action = resolveUpdatePosLocationAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "create_pos_item") {
      const action = resolveCreatePosItemAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "update_pos_item") {
      const action = resolveUpdatePosItemAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "create_fee") {
      const action = resolveCreateFeeAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "update_fee") {
      const action = resolveUpdateFeeAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    // Batch B
    if (ev.name === "update_comm_template") {
      const action = resolveUpdateCommTemplateAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "connect_provider") {
      const action = resolveConnectProviderAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "disconnect_provider") {
      const action = resolveDisconnectProviderAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "create_role") {
      const action = resolveCreateRoleAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "update_role") {
      const action = resolveUpdateRoleAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "update_staff") {
      const action = resolveUpdateStaffAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    // Batch C
    if (ev.name === "update_boater") {
      const action = resolveUpdateBoaterAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "update_vessel") {
      const action = resolveUpdateVesselAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "update_contract") {
      const action = resolveUpdateContractAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "terminate_contract") {
      const action = resolveTerminateContractAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "update_reservation") {
      const action = resolveUpdateReservationAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "cancel_reservation") {
      const action = resolveCancelReservationAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "send_for_signature") {
      const action = resolveSendForSignatureAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    // Batch D
    if (ev.name === "bulk_send_message") {
      const action = resolveBulkSendMessageAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "bulk_draft_renewals") {
      const action = resolveBulkDraftRenewalsAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "bulk_apply_fee") {
      const action = resolveBulkApplyFeeAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "run_billing_run") {
      const action = resolveRunBillingRunAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "run_qb_sync") {
      const action = resolveRunQbSyncAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    // Batch F
    if (ev.name === "create_threshold_rule") {
      const action = resolveCreateThresholdRuleAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    // Rental Club — update + booking can use subscription_id alone, so
    // they bypass the boater_query path entirely.
    if (ev.name === "update_club_subscription") {
      const action = resolveUpdateClubSubscriptionAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "create_club_booking") {
      const action = resolveCreateClubBookingAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "run_club_billing") {
      const asOfDate =
        typeof ev.input.as_of_date === "string" ? ev.input.as_of_date : undefined;
      return {
        kind: "action",
        action: {
          kind: "run_club_billing",
          label: asOfDate
            ? `Run Rental Club billing — ${asOfDate}`
            : "Run Rental Club billing — today",
          as_of_date: asOfDate,
        },
      };
    }
    if (ev.name === "run_club_reactivation") {
      const minDays =
        typeof ev.input.min_days_ago === "number"
          ? ev.input.min_days_ago
          : undefined;
      const maxDays =
        typeof ev.input.max_days_ago === "number"
          ? ev.input.max_days_ago
          : undefined;
      const window =
        minDays != null && maxDays != null
          ? `${minDays}–${maxDays} days`
          : "30–90 days";
      return {
        kind: "action",
        action: {
          kind: "run_club_reactivation",
          label: `Send Rental Club reactivation (${window} ago)`,
          min_days_ago: minDays,
          max_days_ago: maxDays,
        },
      };
    }
    // ── Services catalog parity wave ──
    if (ev.name === "create_club_plan") {
      const action = resolveCreateClubPlanAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "update_rate") {
      const action = resolveUpdateRateAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "set_boat_club_rotation") {
      const action = resolveSetBoatClubRotationAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "create_rental_boat") {
      const action = resolveCreateRentalBoatAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "create_meter_reading") {
      const action = resolveCreateMeterReadingAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "create_slip") {
      const action = resolveCreateSlipAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "create_rental_group") {
      const action = resolveCreateRentalGroupAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "create_rental_space") {
      const action = resolveCreateRentalSpaceAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "create_insurance_certificate") {
      const action = resolveCreateInsuranceCertificateAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    if (ev.name === "create_contract_template") {
      const action = resolveCreateContractTemplateAction(ev);
      if (action) return { kind: "action", action };
      return null;
    }
    // ── Back office ──
    if (ev.name === "create_shift") {
      const a = resolveCreateShiftAction(ev);
      if (a) return { kind: "action", action: a };
      return null;
    }
    if (ev.name === "run_payroll") {
      const a = resolveRunPayrollAction(ev);
      if (a) return { kind: "action", action: a };
      return null;
    }
    if (ev.name === "create_certification") {
      const a = resolveCreateCertificationAction(ev);
      if (a) return { kind: "action", action: a };
      return null;
    }
    if (ev.name === "create_vendor") {
      const a = resolveCreateVendorAction(ev);
      if (a) return { kind: "action", action: a };
      return null;
    }
    if (ev.name === "create_bill") {
      const a = resolveCreateBillAction(ev);
      if (a) return { kind: "action", action: a };
      return null;
    }
    if (ev.name === "pay_bill") {
      const a = resolvePayBillAction(ev);
      if (a) return { kind: "action", action: a };
      return null;
    }
    if (ev.name === "receive_stock") {
      const a = resolveReceiveStockAction(ev);
      if (a) return { kind: "action", action: a };
      return null;
    }
    if (ev.name === "create_asset") {
      const a = resolveCreateAssetAction(ev);
      if (a) return { kind: "action", action: a };
      return null;
    }
    if (ev.name === "create_pm_schedule") {
      const a = resolveCreatePmScheduleAction(ev);
      if (a) return { kind: "action", action: a };
      return null;
    }
    if (ev.name === "run_pm_check") {
      return {
        kind: "action",
        action: { kind: "run_pm_check", label: "Run PM check — auto-create due work orders" },
      };
    }
    // ── Back office round 2 ──
    if (ev.name === "approve_time_entry") {
      const a = resolveApproveTimeEntryAction(ev);
      if (a) return { kind: "action", action: a };
      return null;
    }
    if (ev.name === "create_staff") {
      const a = resolveCreateStaffAction(ev);
      if (a) return { kind: "action", action: a };
      return null;
    }
    if (ev.name === "update_staff_wage") {
      const a = resolveUpdateStaffWageAction(ev);
      if (a) return { kind: "action", action: a };
      return null;
    }
    if (ev.name === "adjust_stock") {
      const a = resolveAdjustStockAction(ev);
      if (a) return { kind: "action", action: a };
      return null;
    }
    if (ev.name === "log_stock_loss") {
      const a = resolveLogStockLossAction(ev);
      if (a) return { kind: "action", action: a };
      return null;
    }
    const action = resolveToolToAction(ev);
    if (action) return { kind: "action", action };
    return null;
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// Tool → AgentAction resolution
// (fuzzy resolves boater_query / item_query when the server didn't
// pre-resolve — i.e. when the call came from Claude tool_use)
// ────────────────────────────────────────────────────────────

function resolveToolToAction(ev: Extract<WireEvent, { type: "tool" }>): AgentAction | null {
  // If the server pre-resolved everything (simulated path), shortcut
  if (ev.resolved?.boater_id) {
    if (ev.name === "charge_to_account" && ev.resolved.location_id && ev.resolved.line) {
      return {
        kind: "charge_to_account",
        label: "", // re-derived below
        boater_id: ev.resolved.boater_id,
        location_id: ev.resolved.location_id,
        line: ev.resolved.line,
      } as AgentAction & { label: string };
    }
    if (ev.name === "send_message" && ev.resolved.type && ev.resolved.body !== undefined) {
      return {
        kind: "send_message",
        label: "",
        boater_id: ev.resolved.boater_id,
        type: ev.resolved.type,
        subject: ev.resolved.subject,
        body: ev.resolved.body,
      } as AgentAction & { label: string };
    }
  }

  // Otherwise resolve from fuzzy strings (Claude path)
  const boaterQuery = String(ev.input.boater_query ?? "");
  const boater = findBoaterFuzzy(boaterQuery);
  if (!boater) return null;

  if (ev.name === "charge_to_account") {
    const itemQuery = String(ev.input.item_query ?? "");
    const item = matchChargeable(itemQuery);
    if (!item) return null;
    return {
      kind: "charge_to_account",
      label: `Charge ${formatMoney(item.price)} to ${boater.display_name}`,
      boater_id: boater.id,
      location_id: item.location_id,
      line: { name: item.name, price: item.price, sku: item.sku },
    };
  }

  if (ev.name === "send_message") {
    const channel = (ev.input.channel === "email" ? "email" : "sms") as "sms" | "email";
    const body = String(ev.input.body ?? "");
    const subject = ev.input.subject ? String(ev.input.subject) : undefined;
    if (!body) return null;
    return {
      kind: "send_message",
      label: `Send ${channel.toUpperCase()} to ${boater.first_name}`,
      boater_id: boater.id,
      type: channel,
      subject,
      body,
    };
  }

  if (ev.name === "create_work_order") {
    const subject = String(ev.input.subject ?? "").trim();
    if (!subject) return null;
    const activityType = (ev.input.activity_type as
      | "winterization"
      | "bottom_paint"
      | "service"
      | "inspection"
      | "haul_out"
      | "pump_out"
      | "task"
      | "other"
      | undefined) ?? "service";
    const priority = (ev.input.priority as "low" | "normal" | "high" | "urgent" | undefined) ?? "normal";
    const vesselQuery = ev.input.vessel_query ? String(ev.input.vessel_query) : "";
    const slipQuery = ev.input.slip_query ? String(ev.input.slip_query) : "";
    const description = ev.input.description ? String(ev.input.description) : undefined;
    const dueDate = ev.input.due_date ? String(ev.input.due_date) : undefined;

    const vessel = vesselQuery ? findVesselFuzzy(vesselQuery, boater.id) : undefined;
    const slip = slipQuery ? findSlipFuzzy(slipQuery) : undefined;

    return {
      kind: "create_work_order",
      label: `New ${activityType.replace("_", " ")} work order for ${boater.display_name}`,
      boater_id: boater.id,
      subject,
      description,
      activity_type: activityType,
      priority,
      vessel_id: vessel?.id,
      slip_id: slip?.id,
      due_date: dueDate,
    };
  }

  if (ev.name === "create_reservation") {
    const slipQuery = String(ev.input.slip_query ?? "");
    const slip = findSlipFuzzy(slipQuery);
    if (!slip) return null;
    const arrival = String(ev.input.arrival_date ?? "");
    const departure = String(ev.input.departure_date ?? "");
    if (!arrival || !departure) return null;
    const type = (ev.input.type as
      | "annual"
      | "seasonal"
      | "monthly"
      | "transient"
      | "recurring"
      | undefined) ?? "transient";
    const vesselQuery = ev.input.vessel_query ? String(ev.input.vessel_query) : "";
    const vessel = vesselQuery ? findVesselFuzzy(vesselQuery, boater.id) : undefined;

    return {
      kind: "create_reservation",
      label: `Reserve ${slip.number} for ${boater.display_name} (${arrival} → ${departure})`,
      boater_id: boater.id,
      slip_id: slip.id,
      vessel_id: vessel?.id,
      arrival_date: arrival,
      departure_date: departure,
      type,
    };
  }

  if (ev.name === "record_payment") {
    const amount = Number(ev.input.amount ?? 0);
    if (!amount || amount <= 0) return null;
    const method = (ev.input.method as "card" | "cash" | "check" | "ach" | undefined) ?? "check";
    const notes = ev.input.notes ? String(ev.input.notes) : undefined;
    return {
      kind: "record_payment",
      label: `Record ${formatMoney(amount)} ${method} from ${boater.display_name}`,
      boater_id: boater.id,
      amount,
      method,
      notes,
    };
  }

  if (ev.name === "create_vessel") {
    const name = String(ev.input.name ?? "").trim();
    if (!name) return null;
    return {
      kind: "create_vessel",
      label: `Add ${name} to ${boater.display_name}`,
      boater_id: boater.id,
      name,
      year: ev.input.year ? Number(ev.input.year) : undefined,
      make: ev.input.make ? String(ev.input.make) : undefined,
      model: ev.input.model ? String(ev.input.model) : undefined,
      vessel_type: ev.input.vessel_type as
        | "powerboat" | "sailboat" | "pontoon" | "houseboat" | "pwc" | "other"
        | undefined,
      fuel_type: ev.input.fuel_type as
        | "gasoline" | "diesel" | "electric" | "none"
        | undefined,
      loa_inches: ev.input.loa_inches ? Number(ev.input.loa_inches) : undefined,
      beam_inches: ev.input.beam_inches ? Number(ev.input.beam_inches) : undefined,
      draft_inches: ev.input.draft_inches ? Number(ev.input.draft_inches) : undefined,
      hull_vin: ev.input.hull_vin ? String(ev.input.hull_vin) : undefined,
      registration: ev.input.registration ? String(ev.input.registration) : undefined,
    };
  }

  if (ev.name === "create_contract") {
    const templateId = String(ev.input.template_id ?? "");
    const effStart = String(ev.input.effective_start ?? "");
    const effEnd = String(ev.input.effective_end ?? "");
    if (!templateId || !effStart || !effEnd) return null;
    const cadence = (ev.input.billing_cadence as
      | "annual" | "seasonal" | "monthly" | "transient"
      | undefined) ?? "monthly";
    const vesselQuery = ev.input.vessel_query ? String(ev.input.vessel_query) : "";
    const slipQuery = ev.input.slip_query ? String(ev.input.slip_query) : "";
    const vessel = vesselQuery ? findVesselFuzzy(vesselQuery, boater.id) : undefined;
    const slip = slipQuery ? findSlipFuzzy(slipQuery) : undefined;
    return {
      kind: "create_contract",
      label: `Draft ${templateId.replace("tpl_", "").replace("_", " ")} for ${boater.display_name}`,
      boater_id: boater.id,
      template_id: templateId,
      vessel_id: vessel?.id,
      slip_id: slip?.id,
      effective_start: effStart,
      effective_end: effEnd,
      annual_rate: ev.input.annual_rate ? Number(ev.input.annual_rate) : undefined,
      billing_cadence: cadence,
      attached_fee_ids: Array.isArray(ev.input.attached_fee_ids)
        ? (ev.input.attached_fee_ids as unknown[]).map(String)
        : undefined,
    };
  }

  if (ev.name === "add_card") {
    const brand = ev.input.brand as "visa" | "mastercard" | "amex" | "discover" | undefined;
    const last4 = String(ev.input.last4 ?? "").trim();
    const expMonth = Number(ev.input.exp_month ?? 0);
    const expYear = Number(ev.input.exp_year ?? 0);
    if (!brand || !last4 || !expMonth || !expYear) return null;
    return {
      kind: "add_card",
      label: `Add ${brand} ····${last4} to ${boater.display_name}`,
      boater_id: boater.id,
      brand,
      last4,
      exp_month: expMonth,
      exp_year: expYear,
      nickname: ev.input.nickname ? String(ev.input.nickname) : undefined,
      is_default: Boolean(ev.input.is_default),
    };
  }

  // ── Rental Club ────────────────────────────────────────────
  if (ev.name === "create_club_subscription") {
    const plan = (
      ev.input.plan_tier === "premium"
        ? "premium"
        : ev.input.plan_tier === "plus"
        ? "plus"
        : "basic"
    ) as "basic" | "plus" | "premium";
    return {
      kind: "create_club_subscription",
      label: `Enroll ${boater.display_name} in ${plan} plan`,
      boater_id: boater.id,
      boater_query: boaterQuery,
      plan_tier: plan,
      join_fee:
        ev.input.join_fee !== undefined ? Number(ev.input.join_fee) : undefined,
      monthly_fee:
        ev.input.monthly_fee !== undefined
          ? Number(ev.input.monthly_fee)
          : undefined,
      days_per_month:
        ev.input.days_per_month !== undefined
          ? Number(ev.input.days_per_month)
          : undefined,
      notes: ev.input.notes ? String(ev.input.notes) : undefined,
    };
  }

  // Note: update_club_subscription + create_club_booking handled by
  // their own early-dispatch resolvers (they can act on subscription_id
  // without a boater_query).

  return null;
}

// ── New chain resolvers (Boat Rentals + Waitlist + COI) ─────────────

function resolveCreateBoatRentalAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const boatQuery = String(ev.input.boat_query ?? "").trim();
  if (!boatQuery) return null;
  const boat = findRentalBoatFuzzy(boatQuery);
  if (!boat) return null;
  const start_at = String(ev.input.start_at ?? "").trim();
  const end_at = String(ev.input.end_at ?? "").trim();
  if (!start_at || !end_at) return null;
  const rateKind =
    (ev.input.rate_kind as "hourly" | "half_day" | "full_day" | undefined) ??
    "hourly";

  // Customer — either existing boater or walk-in
  const boaterQuery = ev.input.boater_query ? String(ev.input.boater_query) : "";
  const boater = boaterQuery ? findBoaterFuzzy(boaterQuery) : undefined;
  const patronName = ev.input.patron_name ? String(ev.input.patron_name) : undefined;
  const patronEmail = ev.input.patron_email ? String(ev.input.patron_email) : undefined;
  const patronPhone = ev.input.patron_phone ? String(ev.input.patron_phone) : undefined;
  if (!boater && !patronName) return null;

  const customerLabel = boater
    ? boater.display_name
    : (patronName ?? "Walk-in");
  return {
    kind: "create_boat_rental",
    label: `Book ${boat.name} for ${customerLabel}`,
    boat_id: boat.id,
    boater_id: boater?.id,
    patron_name: patronName,
    patron_email: patronEmail,
    patron_phone: patronPhone,
    start_at,
    end_at,
    rate_kind: rateKind,
  };
}

function resolveRentalLookupAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.rental_query ?? "").trim();
  if (!q) return null;
  const rental = findBoatRentalFuzzy(q);
  if (!rental) return null;
  if (ev.name === "close_boat_rental") {
    return {
      kind: "close_boat_rental",
      label: `Close ${rental.number}`,
      rental_id: rental.id,
      fuel_in_pct:
        ev.input.fuel_in_pct != null ? Number(ev.input.fuel_in_pct) : undefined,
      hours_in:
        ev.input.hours_in != null ? Number(ev.input.hours_in) : undefined,
      damage_notes: ev.input.damage_notes
        ? String(ev.input.damage_notes)
        : undefined,
      damage_charge:
        ev.input.damage_charge != null
          ? Number(ev.input.damage_charge)
          : undefined,
    };
  }
  if (ev.name === "send_pickup_link") {
    return {
      kind: "send_pickup_link",
      label: `Send pickup link for ${rental.number}`,
      rental_id: rental.id,
    };
  }
  return null;
}

function resolveNotifyWaitlistAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.slip_query ?? "").trim();
  if (!q) return null;
  const slip = findSlipFuzzy(q);
  if (!slip) return null;
  const topN = ev.input.top_n != null ? Number(ev.input.top_n) : 5;
  return {
    kind: "notify_waitlist",
    label: `Notify top ${topN} waitlisters about slip ${slip.id}`,
    slip_id: slip.id,
    top_n: topN,
  };
}

// ── Batch D: bulk-ops resolvers ───────────────────────────────

function resolveBoaterTargets(filter: string): string[] {
  const today = new Date().toISOString().slice(0, 10);
  if (filter === "arrivals_today" || filter === "transient_today") {
    return RESERVATIONS.filter((r) => r.arrival_date === today).map(
      (r) => r.boater_id,
    );
  }
  if (filter === "departures_today") {
    return RESERVATIONS.filter((r) => r.departure_date === today).map(
      (r) => r.boater_id,
    );
  }
  if (filter === "overdue_balance") {
    // Static seed view — runtime overdues come from ledger which lives
    // in the store. Server-side we approximate from seed only.
    return BOATERS.filter((b) => b.active).map((b) => b.id);
  }
  if (filter === "annual_holders") {
    return BOATERS.filter((b) => b.billing_cadence === "annual").map((b) => b.id);
  }
  if (filter === "all_active") {
    return BOATERS.filter((b) => b.active).map((b) => b.id);
  }
  if (filter === "expiring_soon") {
    const now = Date.now();
    const cutoff = now + 90 * 86_400_000;
    const ids = new Set(
      CONTRACTS.filter(
        (c) =>
          c.status === "active" &&
          new Date(c.effective_end).getTime() <= cutoff,
      ).map((c) => c.boater_id),
    );
    return Array.from(ids);
  }
  return [];
}

function resolveBulkSendMessageAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const filter = String(ev.input.filter ?? "");
  const channel = String(ev.input.channel ?? "");
  const body = String(ev.input.body ?? "");
  if (!filter || !channel || !body) return null;
  if (!["email", "sms"].includes(channel)) return null;
  const targets = resolveBoaterTargets(filter);
  if (targets.length === 0) return null;
  return {
    kind: "bulk_send_message",
    label: `Send ${channel.toUpperCase()} to ${targets.length} boater${targets.length === 1 ? "" : "s"}`,
    target_boater_ids: targets,
    filter_summary: `${targets.length} via ${filter.replace(/_/g, " ")}`,
    channel: channel as "email" | "sms",
    subject: ev.input.subject ? String(ev.input.subject) : undefined,
    body,
    preview_table: buildBulkSendPreview(targets, channel as "email" | "sms"),
  };
}

// ── Confirm-before-commit preview builders ──────────────────
//
// For each bulk action, generate a per-target preview table the
// operator can scan before clicking Approve. Reuses the same
// TableResult shape as saved reports so <TableCard> renders it
// without a second renderer.

function buildBulkSendPreview(
  boaterIds: string[],
  channel: "email" | "sms",
): TableResult {
  // boaterByIdMap is a shared O(1) lookup — beats the per-id .find()
  // that was O(targets × BOATERS) and quadratic past 500 entries.
  const byId = boaterByIdMap();
  const rows = boaterIds
    .map((id) => byId.get(id))
    .filter((b): b is Boater => !!b)
    .map((b) => ({
      boater: b.display_name,
      slip: b.code ?? "—",
      destination:
        channel === "email"
          ? b.primary_contact.email ?? "—"
          : b.primary_contact.phone ?? "—",
    }));
  return {
    kind: "table",
    title: "Recipients",
    subtitle: `${rows.length} via ${channel.toUpperCase()}`,
    report_key: "preview_bulk_send_message",
    count: rows.length,
    columns: [
      { key: "boater", label: "Boater" },
      { key: "slip", label: "Slip" },
      { key: "destination", label: channel === "email" ? "Email" : "Phone" },
    ],
    rows,
  };
}

function buildBulkApplyFeePreview(
  boaterIds: string[],
  fee: { name: string; amount: number },
): TableResult {
  const byId = boaterByIdMap();
  const rows = boaterIds
    .map((id) => byId.get(id))
    .filter((b): b is Boater => !!b)
    .map((b) => ({
      boater: b.display_name,
      slip: b.code ?? "—",
      fee: fee.name,
      amount: fee.amount,
    }));
  const total = rows.reduce((s, r) => s + (r.amount as number), 0);
  return {
    kind: "table",
    title: "Fee preview",
    subtitle: `${rows.length} × $${fee.amount.toFixed(2)} = $${total.toFixed(2)}`,
    report_key: "preview_bulk_apply_fee",
    count: rows.length,
    columns: [
      { key: "boater", label: "Boater" },
      { key: "slip", label: "Slip" },
      { key: "fee", label: "Fee" },
      { key: "amount", label: "Amount", format: "currency", align: "right" },
    ],
    rows,
    total_row: { boater: "Total", slip: "", fee: "", amount: total },
  };
}

function buildBulkDraftRenewalsPreview(
  contracts: Contract[],
  pctAdjustment: number,
): TableResult {
  const byId = boaterByIdMap();
  const rows = contracts.map((c) => {
    const b = byId.get(c.boater_id);
    const currentRate = c.annual_rate ?? 0;
    const newRate = pctAdjustment
      ? Math.round(currentRate * (1 + pctAdjustment / 100) * 100) / 100
      : currentRate;
    return {
      boater: b?.display_name ?? c.boater_id,
      slip: c.slip_id ?? "—",
      contract: c.number,
      current_rate: currentRate,
      new_rate: newRate,
      delta: newRate - currentRate,
    };
  });
  const totalCurrent = rows.reduce((s, r) => s + (r.current_rate as number), 0);
  const totalNew = rows.reduce((s, r) => s + (r.new_rate as number), 0);
  return {
    kind: "table",
    title: "Renewal preview",
    subtitle: pctAdjustment
      ? `${rows.length} contracts · ${pctAdjustment > 0 ? "+" : ""}${pctAdjustment}% rate adjustment`
      : `${rows.length} contracts · same rate`,
    report_key: "preview_bulk_draft_renewals",
    count: rows.length,
    columns: [
      { key: "boater", label: "Boater" },
      { key: "slip", label: "Slip" },
      { key: "contract", label: "Contract" },
      { key: "current_rate", label: "Current", format: "currency", align: "right" },
      { key: "new_rate", label: "New", format: "currency", align: "right" },
      { key: "delta", label: "Δ", format: "currency", align: "right" },
    ],
    rows,
    total_row: {
      boater: "Total",
      slip: "",
      contract: "",
      current_rate: totalCurrent,
      new_rate: totalNew,
      delta: totalNew - totalCurrent,
    },
  };
}

function buildBillingRunPreview(contracts: Contract[]): TableResult {
  const byId = boaterByIdMap();
  const rows = contracts.map((c) => {
    const b = byId.get(c.boater_id);
    return {
      boater: b?.display_name ?? c.boater_id,
      slip: c.slip_id ?? "—",
      cadence: c.billing_cadence,
      amount: c.annual_rate ?? 0,
    };
  });
  const total = rows.reduce((s, r) => s + (r.amount as number), 0);
  return {
    kind: "table",
    title: "Billing run preview",
    subtitle: `${rows.length} invoices · $${total.toLocaleString()}`,
    report_key: "preview_run_billing_run",
    count: rows.length,
    columns: [
      { key: "boater", label: "Boater" },
      { key: "slip", label: "Slip" },
      { key: "cadence", label: "Cadence" },
      { key: "amount", label: "Amount", format: "currency", align: "right" },
    ],
    rows,
    total_row: { boater: "Total", slip: "", cadence: "", amount: total },
  };
}

function resolveBulkDraftRenewalsAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const filter = String(ev.input.filter ?? "");
  if (!filter) return null;
  const dockQuery = ev.input.dock_query ? String(ev.input.dock_query) : "";
  const pct = ev.input.rate_adjustment_pct != null
    ? Number(ev.input.rate_adjustment_pct)
    : 0;
  const now = Date.now();
  const windowDays =
    filter === "expiring_180_days" ? 180 : filter === "expiring_90_days" ? 90 : 0;
  let candidates = CONTRACTS.filter((c) => c.status === "active");
  if (windowDays > 0) {
    const cutoff = now + windowDays * 86_400_000;
    candidates = candidates.filter(
      (c) => new Date(c.effective_end).getTime() <= cutoff,
    );
  }
  if (dockQuery) {
    const dock = findDockFuzzy(dockQuery);
    if (dock) {
      const slipIds = new Set(
        SLIPS.filter((s) => s.dock_id === dock.id).map((s) => s.id),
      );
      candidates = candidates.filter(
        (c) => c.slip_id && slipIds.has(c.slip_id),
      );
    }
  }
  if (candidates.length === 0) return null;
  return {
    kind: "bulk_draft_renewals",
    label: `Draft ${candidates.length} renewal${candidates.length === 1 ? "" : "s"}${pct ? ` at ${pct > 0 ? "+" : ""}${pct}%` : ""}`,
    target_contract_ids: candidates.map((c) => c.id),
    filter_summary: `${candidates.length} contracts via ${filter.replace(/_/g, " ")}${dockQuery ? ` on ${dockQuery}` : ""}`,
    rate_adjustment_pct: pct || undefined,
    preview_table: buildBulkDraftRenewalsPreview(candidates, pct),
  };
}

function resolveBulkApplyFeeAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const feeQuery = String(ev.input.fee_query ?? "");
  const filter = String(ev.input.filter ?? "");
  if (!feeQuery || !filter) return null;
  const fee = findFeeFuzzy(feeQuery);
  if (!fee) return null;
  const targets = resolveBoaterTargets(filter);
  if (targets.length === 0) return null;
  return {
    kind: "bulk_apply_fee",
    label: `Apply ${fee.name} to ${targets.length} boater${targets.length === 1 ? "" : "s"}`,
    target_boater_ids: targets,
    filter_summary: `${targets.length} via ${filter.replace(/_/g, " ")}`,
    fee_id: fee.id,
    fee_name: fee.name,
    fee_amount: fee.amount,
    preview_table: buildBulkApplyFeePreview(targets, fee),
  };
}

function resolveRunBillingRunAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const runType = String(ev.input.run_type ?? "");
  if (!["annual", "monthly_recurring"].includes(runType)) return null;
  // Estimate target count from active contracts matching the cadence
  const targets =
    runType === "annual"
      ? CONTRACTS.filter(
          (c) => c.status === "active" && c.billing_cadence === "annual",
        )
      : CONTRACTS.filter(
          (c) => c.status === "active" && c.billing_cadence === "monthly",
        );
  const total = targets.reduce((s, c) => s + (c.annual_rate ?? 0), 0);
  return {
    kind: "run_billing_run",
    label: `Run ${runType.replace("_", " ")} billing — ${targets.length} contract${targets.length === 1 ? "" : "s"}`,
    run_type: runType as "annual" | "monthly_recurring",
    target_count: targets.length,
    estimated_total: total,
    preview_table: buildBillingRunPreview(targets),
  };
}

function resolveRunQbSyncAction(
  _ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  // Count entries that are still pending in the static seed. Runtime
  // entries are visible via the QB Sync tab — this gives an estimate.
  return {
    kind: "run_qb_sync",
    label: "Push pending entries to QuickBooks",
    pending_count: 0,
    pending_total: 0,
  };
}

// navigate_to resolver migrated to lib/agent-tools/navigate-to.ts via
// defineTool. The registry early-dispatch at the top of translate()
// handles it; this section is empty by design.

// ── Batch F: alerts ──────────────────────────────────────────

function resolveCreateThresholdRuleAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const kind = String(ev.input.kind ?? "");
  const action = String(ev.input.action ?? "");
  if (
    !["fuel_reorder", "occupancy_low", "ar_aging", "anomaly_spike"].includes(
      kind,
    )
  )
    return null;
  if (
    !["notify_staff", "create_work_order", "send_message"].includes(action)
  )
    return null;
  const threshold = Number(ev.input.threshold_value);
  if (!Number.isFinite(threshold)) return null;
  return {
    kind: "create_threshold_rule",
    label: `Alert: ${kind.replace(/_/g, " ")} → ${action.replace(/_/g, " ")}`,
    kind_of: kind as Extract<AgentAction, { kind: "create_threshold_rule" }>["kind_of"],
    threshold_value: threshold,
    threshold_unit: ev.input.threshold_unit
      ? String(ev.input.threshold_unit)
      : "",
    action: action as Extract<AgentAction, { kind: "create_threshold_rule" }>["action"],
    notes: ev.input.notes ? String(ev.input.notes) : undefined,
  };
}

// ── Batch C: entity edits + lifecycle resolvers ───────────────

function resolveUpdateBoaterAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.boater_query ?? "").trim();
  if (!q) return null;
  const b = findBoaterFuzzy(q);
  if (!b) return null;
  const patch: Extract<AgentAction, { kind: "update_boater" }>["patch"] = {};
  const bits: string[] = [];
  if (ev.input.email) {
    patch.email = String(ev.input.email);
    bits.push("email");
  }
  if (ev.input.phone) {
    patch.phone = String(ev.input.phone);
    bits.push("phone");
  }
  if (ev.input.preferred_channel) {
    const c = String(ev.input.preferred_channel);
    if (["email", "sms", "voice"].includes(c)) {
      patch.preferred_channel = c as NonNullable<typeof patch.preferred_channel>;
      bits.push(`prefers ${c}`);
    }
  }
  if (ev.input.billing_cadence) {
    const c = String(ev.input.billing_cadence);
    if (["annual", "seasonal", "monthly", "transient"].includes(c)) {
      patch.billing_cadence = c as NonNullable<typeof patch.billing_cadence>;
      bits.push(c);
    }
  }
  if (ev.input.notes !== undefined) {
    patch.notes = String(ev.input.notes);
    bits.push("notes updated");
  }
  if (ev.input.active !== undefined) {
    patch.active = Boolean(ev.input.active);
    bits.push(patch.active ? "active" : "archived");
  }
  if (Object.keys(patch).length === 0) return null;
  return {
    kind: "update_boater",
    label: `Update ${b.display_name}`,
    boater_id: b.id,
    boater_name: b.display_name,
    patch,
    summary: bits.join(" · "),
  };
}

function resolveUpdateVesselAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.vessel_query ?? "").trim();
  if (!q) return null;
  const boaterQuery = ev.input.boater_query ? String(ev.input.boater_query) : "";
  const scopeBoater = boaterQuery ? findBoaterFuzzy(boaterQuery) : undefined;
  const v = findVesselFuzzy(q, scopeBoater?.id);
  if (!v) return null;
  const patch: Extract<AgentAction, { kind: "update_vessel" }>["patch"] = {};
  const bits: string[] = [];
  if (ev.input.name) {
    patch.name = String(ev.input.name);
    bits.push(`name → ${patch.name}`);
  }
  if (ev.input.year != null) {
    patch.year = Number(ev.input.year);
    bits.push(`year ${patch.year}`);
  }
  if (ev.input.make) {
    patch.make = String(ev.input.make);
    bits.push(`make ${patch.make}`);
  }
  if (ev.input.model) {
    patch.model = String(ev.input.model);
    bits.push(`model ${patch.model}`);
  }
  if (ev.input.registration) {
    patch.registration = String(ev.input.registration);
    bits.push("reg updated");
  }
  if (ev.input.hull_vin) {
    patch.hull_vin = String(ev.input.hull_vin);
    bits.push("VIN updated");
  }
  if (ev.input.active !== undefined) {
    patch.active = Boolean(ev.input.active);
    bits.push(patch.active ? "active" : "archived");
  }
  if (Object.keys(patch).length === 0) return null;
  return {
    kind: "update_vessel",
    label: `Update ${v.name}`,
    vessel_id: v.id,
    vessel_name: v.name,
    patch,
    summary: bits.join(" · "),
  };
}

function findContractFuzzy(q: string) {
  const t = q.toLowerCase().trim();
  return (
    CONTRACTS.find((c) => c.id === q) ??
    CONTRACTS.find((c) => c.number.toLowerCase() === t) ??
    CONTRACTS.find((c) => c.number.toLowerCase().includes(t)) ??
    CONTRACTS.find((c) => {
      const b = BOATERS.find((x) => x.id === c.boater_id);
      return b?.display_name.toLowerCase().includes(t);
    })
  );
}

function resolveUpdateContractAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.contract_query ?? "").trim();
  if (!q) return null;
  const c = findContractFuzzy(q);
  if (!c) return null;
  const patch: Extract<AgentAction, { kind: "update_contract" }>["patch"] = {};
  const bits: string[] = [];
  if (ev.input.status) {
    const s = String(ev.input.status);
    if (
      [
        "draft",
        "sent",
        "partially_signed",
        "executed",
        "active",
        "expired",
        "terminated",
        "renewed",
      ].includes(s)
    ) {
      patch.status = s as NonNullable<typeof patch.status>;
      bits.push(`→ ${s}`);
    }
  }
  if (ev.input.annual_rate != null) {
    patch.annual_rate = Number(ev.input.annual_rate);
    bits.push(`$${patch.annual_rate.toLocaleString()}/yr`);
  }
  if (ev.input.effective_start) {
    patch.effective_start = String(ev.input.effective_start);
    bits.push(`start ${patch.effective_start}`);
  }
  if (ev.input.effective_end) {
    patch.effective_end = String(ev.input.effective_end);
    bits.push(`end ${patch.effective_end}`);
  }
  if (Object.keys(patch).length === 0) return null;
  return {
    kind: "update_contract",
    label: `Update ${c.number}`,
    contract_id: c.id,
    contract_number: c.number,
    patch,
    summary: bits.join(" · "),
  };
}

function resolveTerminateContractAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.contract_query ?? "").trim();
  if (!q) return null;
  const c = findContractFuzzy(q);
  if (!c) return null;
  return {
    kind: "terminate_contract",
    label: `Terminate ${c.number}`,
    contract_id: c.id,
    contract_number: c.number,
    reason: ev.input.reason ? String(ev.input.reason) : undefined,
  };
}

function findReservationFuzzy(q: string) {
  const t = q.toLowerCase().trim();
  return (
    RESERVATIONS.find((r) => r.id === q) ??
    RESERVATIONS.find((r) => r.number.toLowerCase() === t) ??
    RESERVATIONS.find((r) => r.number.toLowerCase().includes(t)) ??
    RESERVATIONS.find((r) => {
      const b = BOATERS.find((x) => x.id === r.boater_id);
      return b?.display_name.toLowerCase().includes(t);
    })
  );
}

function resolveUpdateReservationAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.reservation_query ?? "").trim();
  if (!q) return null;
  const r = findReservationFuzzy(q);
  if (!r) return null;
  const patch: Extract<AgentAction, { kind: "update_reservation" }>["patch"] = {};
  const bits: string[] = [];
  if (ev.input.arrival_date) {
    patch.arrival_date = String(ev.input.arrival_date);
    bits.push(`arr ${patch.arrival_date}`);
  }
  if (ev.input.departure_date) {
    patch.departure_date = String(ev.input.departure_date);
    bits.push(`dep ${patch.departure_date}`);
  }
  if (ev.input.slip_query) {
    const slip = findSlipFuzzy(String(ev.input.slip_query));
    if (slip) {
      patch.slip_id = slip.id;
      bits.push(`→ slip ${slip.id}`);
    }
  }
  if (ev.input.notes !== undefined) {
    patch.notes = String(ev.input.notes);
    bits.push("notes updated");
  }
  if (Object.keys(patch).length === 0) return null;
  return {
    kind: "update_reservation",
    label: `Update ${r.number}`,
    reservation_id: r.id,
    reservation_number: r.number,
    patch,
    summary: bits.join(" · "),
  };
}

function resolveCancelReservationAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.reservation_query ?? "").trim();
  if (!q) return null;
  const r = findReservationFuzzy(q);
  if (!r) return null;
  return {
    kind: "cancel_reservation",
    label: `Cancel ${r.number}`,
    reservation_id: r.id,
    reservation_number: r.number,
    reason: ev.input.reason ? String(ev.input.reason) : undefined,
  };
}

function resolveSendForSignatureAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.contract_query ?? "").trim();
  if (!q) return null;
  const c = findContractFuzzy(q);
  if (!c) return null;
  return {
    kind: "send_for_signature",
    label: `Send ${c.number} for signature`,
    contract_id: c.id,
    contract_number: c.number,
  };
}

// ── Batch B: comm template / provider / role / staff resolvers ──

function findCommTemplateFuzzy(q: string) {
  const t = q.toLowerCase().trim();
  return (
    COMM_TEMPLATES_SEED.find((x) => x.id === q) ??
    COMM_TEMPLATES_SEED.find((x) => x.kind.toLowerCase() === t) ??
    COMM_TEMPLATES_SEED.find((x) => x.name.toLowerCase() === t) ??
    COMM_TEMPLATES_SEED.find((x) =>
      x.kind.toLowerCase().includes(t.replace(/\s+/g, "_")),
    ) ??
    COMM_TEMPLATES_SEED.find((x) => x.name.toLowerCase().includes(t))
  );
}

function resolveUpdateCommTemplateAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.template_query ?? "").trim();
  if (!q) return null;
  const tmpl = findCommTemplateFuzzy(q);
  if (!tmpl) return null;
  const patch: Extract<AgentAction, { kind: "update_comm_template" }>["patch"] = {};
  const bits: string[] = [];
  if (ev.input.subject) {
    patch.subject = String(ev.input.subject);
    bits.push("subject changed");
  }
  if (ev.input.body_markdown) {
    patch.body_markdown = String(ev.input.body_markdown);
    bits.push("body rewritten");
  }
  if (ev.input.active !== undefined) {
    patch.active = Boolean(ev.input.active);
    bits.push(patch.active ? "active" : "disabled");
  }
  if (Object.keys(patch).length === 0) return null;
  return {
    kind: "update_comm_template",
    label: `Update ${tmpl.name}`,
    template_id: tmpl.id,
    template_name: tmpl.name,
    patch,
    summary: bits.join(" · "),
  };
}

function resolveConnectProviderAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const kind = String(ev.input.kind ?? "");
  const provider = String(ev.input.provider ?? "").toLowerCase().trim();
  if (
    !["payment", "email", "sms", "accounting"].includes(kind) ||
    !provider
  )
    return null;
  return {
    kind: "connect_provider",
    label: `Connect ${provider} for ${kind}`,
    kind_of: kind as Extract<AgentAction, { kind: "connect_provider" }>["kind_of"],
    provider,
    enabled: true,
  };
}

function resolveDisconnectProviderAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.provider_query ?? "").toLowerCase().trim();
  if (!q) return null;
  const cfg =
    PROVIDER_CONFIGS_SEED.find((p) => p.id === q) ??
    PROVIDER_CONFIGS_SEED.find((p) => p.provider.toLowerCase() === q) ??
    PROVIDER_CONFIGS_SEED.find((p) => p.provider.toLowerCase().includes(q));
  if (!cfg) return null;
  return {
    kind: "disconnect_provider",
    label: `Disconnect ${cfg.provider}`,
    config_id: cfg.id,
    provider: cfg.provider,
  };
}

function resolveCreateRoleAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const name = String(ev.input.name ?? "").trim();
  const perms = Array.isArray(ev.input.permissions)
    ? (ev.input.permissions as unknown[]).map(String)
    : [];
  if (!name || perms.length === 0) return null;
  return {
    kind: "create_role",
    label: `Add ${name} role`,
    name,
    description: ev.input.description ? String(ev.input.description) : undefined,
    permissions: perms,
  };
}

function findRoleFuzzy(q: string) {
  const t = q.toLowerCase().trim();
  return (
    ROLES_SEED.find((r) => r.id === q) ??
    ROLES_SEED.find((r) => r.name.toLowerCase() === t) ??
    ROLES_SEED.find((r) => r.name.toLowerCase().includes(t))
  );
}

function resolveUpdateRoleAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.role_query ?? "").trim();
  if (!q) return null;
  const role = findRoleFuzzy(q);
  if (!role) return null;
  const patch: Extract<AgentAction, { kind: "update_role" }>["patch"] = {};
  const bits: string[] = [];
  if (ev.input.name) {
    patch.name = String(ev.input.name);
    bits.push(`name → ${patch.name}`);
  }
  if (ev.input.description !== undefined) {
    patch.description = String(ev.input.description);
    bits.push("description updated");
  }
  if (Array.isArray(ev.input.permissions)) {
    patch.permissions = (ev.input.permissions as unknown[]).map(String);
    bits.push(`${patch.permissions.length} perms`);
  }
  if (Object.keys(patch).length === 0) return null;
  return {
    kind: "update_role",
    label: `Update ${role.name}`,
    role_id: role.id,
    role_name: role.name,
    patch,
    summary: bits.join(" · "),
  };
}

function findStaffFuzzy(q: string) {
  const t = q.toLowerCase().trim();
  return (
    STAFF_SEED.find((s) => s.id === q) ??
    STAFF_SEED.find((s) => s.email.toLowerCase() === t) ??
    STAFF_SEED.find((s) => s.name.toLowerCase() === t) ??
    STAFF_SEED.find((s) => s.name.toLowerCase().includes(t))
  );
}

function resolveUpdateStaffAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.staff_query ?? "").trim();
  if (!q) return null;
  const staff = findStaffFuzzy(q);
  if (!staff) return null;
  const patch: Extract<AgentAction, { kind: "update_staff" }>["patch"] = {};
  const bits: string[] = [];
  if (ev.input.role) {
    const roleName = String(ev.input.role);
    const role = findRoleFuzzy(roleName);
    if (role) {
      patch.role_id = role.id;
      patch.role_name = role.name;
      bits.push(`role → ${role.name}`);
    }
  }
  if (ev.input.status) {
    const s = String(ev.input.status);
    if (["invited", "active", "suspended"].includes(s)) {
      patch.status = s as NonNullable<typeof patch.status>;
      bits.push(s);
    }
  }
  if (ev.input.phone) {
    patch.phone = String(ev.input.phone);
    bits.push("phone");
  }
  if (ev.input.email) {
    patch.email = String(ev.input.email);
    bits.push("email");
  }
  if (Object.keys(patch).length === 0) return null;
  return {
    kind: "update_staff",
    label: `Update ${staff.name}`,
    staff_id: staff.id,
    staff_name: staff.name,
    patch,
    summary: bits.join(" · "),
  };
}

// ── Batch A: Marina Profile / Dock / POS / Fee resolvers ─────────

const MARINA_PROFILE_FIELDS = [
  "display_name",
  "short_name",
  "tagline",
  "email",
  "phone",
  "website",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "postal_code",
  "country",
  "timezone",
  "business_hours_open",
  "business_hours_close",
  "default_tax_rate",
  "outbound_email_from_name",
  "outbound_sms_sender_label",
] as const;

function resolveUpdateMarinaProfileAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const patch: Record<string, string | undefined> = {};
  const bits: string[] = [];
  for (const field of MARINA_PROFILE_FIELDS) {
    const v = ev.input[field];
    if (v === undefined || v === null || v === "") continue;
    patch[field] = String(v);
    bits.push(`${field.replace(/_/g, " ")} → ${String(v)}`);
  }
  if (Object.keys(patch).length === 0) return null;
  return {
    kind: "update_marina_profile",
    label: `Update marina profile (${Object.keys(patch).length} field${
      Object.keys(patch).length === 1 ? "" : "s"
    })`,
    patch,
    summary: bits.slice(0, 3).join(" · "),
  };
}

function resolveCreateDockAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const name = String(ev.input.name ?? "").trim();
  const slip_prefix = String(ev.input.slip_prefix ?? "").trim();
  if (!name || !slip_prefix) return null;
  return {
    kind: "create_dock",
    label: `Add ${name}`,
    name,
    slip_prefix,
    sort_order:
      ev.input.sort_order != null ? Number(ev.input.sort_order) : undefined,
    active: ev.input.active === undefined ? true : Boolean(ev.input.active),
  };
}

function findDockFuzzy(q: string) {
  const t = q.toLowerCase().trim();
  return (
    DOCKS.find((d) => d.id === q) ??
    DOCKS.find((d) => d.name.toLowerCase() === t) ??
    DOCKS.find((d) => d.short_name.toLowerCase() === t) ??
    DOCKS.find((d) => (d.prefix ?? "").toLowerCase() === t) ??
    DOCKS.find((d) => d.name.toLowerCase().includes(t)) ??
    DOCKS.find((d) => d.short_name.toLowerCase().includes(t))
  );
}

function resolveUpdateDockAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.dock_query ?? "").trim();
  if (!q) return null;
  const dock = findDockFuzzy(q);
  if (!dock) return null;
  const patch: Record<string, unknown> = {};
  const bits: string[] = [];
  if (ev.input.name) {
    patch.name = String(ev.input.name);
    bits.push(`name → ${patch.name}`);
  }
  if (ev.input.slip_prefix) {
    patch.prefix = String(ev.input.slip_prefix).toUpperCase();
    bits.push(`prefix → ${patch.prefix}`);
  }
  if (ev.input.sort_order != null) {
    patch.sort_order = Number(ev.input.sort_order);
    bits.push(`sort → ${patch.sort_order}`);
  }
  if (ev.input.active !== undefined) {
    patch.active = Boolean(ev.input.active);
    bits.push(patch.active ? "active" : "archived");
  }
  if (Object.keys(patch).length === 0) return null;
  return {
    kind: "update_dock",
    label: `Update ${dock.name}`,
    dock_id: dock.id,
    dock_name: dock.name,
    patch: patch as Extract<AgentAction, { kind: "update_dock" }>["patch"],
    summary: bits.join(" · "),
  };
}

// Tenant-scoped views of the static seed lists. Resolvers fuzzy-match
// against these so an agent action in Lakeside can't accidentally pick
// up a primary-tenant catalog item with the same SKU / name. Computed
// fresh on each call so a mid-session tenant switch is reflected.
function scopedPosLocations() {
  const t = getCurrentTenantId();
  return POS_LOCATIONS.filter(
    (l) => (l.tenant_id ?? "ten_marina_stee_demo") === t
  );
}
function scopedPosCatalog() {
  const t = getCurrentTenantId();
  return POS_CATALOG.filter(
    (i) => (i.tenant_id ?? "ten_marina_stee_demo") === t
  );
}
function scopedAdditionalFees() {
  const t = getCurrentTenantId();
  return ADDITIONAL_FEES.filter(
    (f) => (f.tenant_id ?? "ten_marina_stee_demo") === t
  );
}

function findPosLocationFuzzy(q: string) {
  const t = q.toLowerCase().trim();
  const pool = scopedPosLocations();
  return (
    pool.find((l) => l.id === q) ??
    pool.find((l) => l.key === q) ??
    pool.find((l) => l.name.toLowerCase() === t) ??
    pool.find((l) => l.name.toLowerCase().includes(t)) ??
    pool.find((l) => l.key.replace(/_/g, " ").includes(t))
  );
}

function resolveUpdatePosLocationAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.location_query ?? "").trim();
  if (!q) return null;
  const loc = findPosLocationFuzzy(q);
  if (!loc) return null;
  const patch: Extract<AgentAction, { kind: "update_pos_location" }>["patch"] = {};
  const bits: string[] = [];
  if (ev.input.name) {
    patch.name = String(ev.input.name);
    bits.push(`name → ${patch.name}`);
  }
  if (ev.input.icon_key) {
    patch.icon_key = String(ev.input.icon_key) as NonNullable<typeof patch.icon_key>;
    bits.push(`icon → ${patch.icon_key}`);
  }
  if (ev.input.default_tax_rate != null) {
    patch.default_tax_rate = Number(ev.input.default_tax_rate);
    bits.push(`tax → ${(patch.default_tax_rate * 100).toFixed(2)}%`);
  }
  if (ev.input.active !== undefined) {
    patch.active = Boolean(ev.input.active);
    bits.push(patch.active ? "active" : "archived");
  }
  if (Object.keys(patch).length === 0) return null;
  return {
    kind: "update_pos_location",
    label: `Update ${loc.name}`,
    location_id: loc.id,
    location_name: loc.name,
    patch,
    summary: bits.join(" · "),
  };
}

function resolveCreatePosItemAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const name = String(ev.input.name ?? "").trim();
  const sku = String(ev.input.sku ?? "").trim();
  const category = String(ev.input.category ?? "").trim();
  const price = Number(ev.input.price ?? 0);
  const location_key = String(ev.input.location_key ?? "");
  if (!name || !sku || !category || !price || !location_key) return null;
  const validKeys = ["fuel_dock", "ship_store", "restaurant", "harbormaster"];
  if (!validKeys.includes(location_key)) return null;
  const loc = scopedPosLocations().find((l) => l.key === location_key);
  if (!loc) return null;
  return {
    kind: "create_pos_item",
    label: `Add ${name} to ${loc.name}`,
    name,
    sku,
    category,
    price,
    cost: ev.input.cost != null ? Number(ev.input.cost) : undefined,
    location_key: location_key as Extract<AgentAction, { kind: "create_pos_item" }>["location_key"],
    location_name: loc.name,
    taxable: ev.input.taxable === undefined ? true : Boolean(ev.input.taxable),
    active: ev.input.active === undefined ? true : Boolean(ev.input.active),
  };
}

function findPosItemFuzzy(q: string) {
  const t = q.toLowerCase().trim();
  const pool = scopedPosCatalog();
  return (
    pool.find((i) => i.id === q) ??
    pool.find((i) => i.sku.toLowerCase() === t) ??
    pool.find((i) => i.name.toLowerCase() === t) ??
    pool.find((i) => i.name.toLowerCase().includes(t)) ??
    pool.find((i) => i.sku.toLowerCase().includes(t))
  );
}

function resolveUpdatePosItemAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.item_query ?? "").trim();
  if (!q) return null;
  const item = findPosItemFuzzy(q);
  if (!item) return null;
  const patch: Extract<AgentAction, { kind: "update_pos_item" }>["patch"] = {};
  const bits: string[] = [];
  if (ev.input.name) {
    patch.name = String(ev.input.name);
    bits.push(`name → ${patch.name}`);
  }
  if (ev.input.category) {
    patch.category = String(ev.input.category);
    bits.push(`cat → ${patch.category}`);
  }
  if (ev.input.price != null) {
    patch.price = Number(ev.input.price);
    bits.push(`$${patch.price.toFixed(2)}`);
  }
  if (ev.input.cost != null) {
    patch.cost = Number(ev.input.cost);
    bits.push(`cost $${patch.cost.toFixed(2)}`);
  }
  if (ev.input.active !== undefined) {
    patch.active = Boolean(ev.input.active);
    bits.push(patch.active ? "active" : "archived");
  }
  if (Object.keys(patch).length === 0) return null;
  return {
    kind: "update_pos_item",
    label: `Update ${item.name}`,
    item_id: item.id,
    item_name: item.name,
    patch,
    summary: bits.join(" · "),
  };
}

function resolveCreateFeeAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const name = String(ev.input.name ?? "").trim();
  const amount = Number(ev.input.amount ?? 0);
  const recurrence = String(ev.input.recurrence ?? "");
  const applies_to = String(ev.input.applies_to ?? "");
  const accounting = String(ev.input.accounting_line_item ?? "").trim();
  if (!name || !amount || !recurrence || !applies_to || !accounting) return null;
  if (!["one_time", "monthly", "annual"].includes(recurrence)) return null;
  if (
    ![
      "slip_contract",
      "work_order",
      "boat_rental",
      "pos",
      "annual_billing_run",
    ].includes(applies_to)
  )
    return null;
  return {
    kind: "create_fee",
    label: `Add ${name} fee — $${amount.toFixed(2)}`,
    name,
    amount,
    recurrence: recurrence as Extract<AgentAction, { kind: "create_fee" }>["recurrence"],
    applies_to: applies_to as Extract<AgentAction, { kind: "create_fee" }>["applies_to"],
    accounting_line_item: accounting,
    description: ev.input.description ? String(ev.input.description) : undefined,
    auto_attach:
      ev.input.auto_attach === undefined ? true : Boolean(ev.input.auto_attach),
  };
}

function findFeeFuzzy(q: string) {
  const t = q.toLowerCase().trim();
  const pool = scopedAdditionalFees();
  return (
    pool.find((f) => f.id === q) ??
    pool.find((f) => f.name.toLowerCase() === t) ??
    pool.find((f) => f.name.toLowerCase().includes(t))
  );
}

function resolveUpdateFeeAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.fee_query ?? "").trim();
  if (!q) return null;
  const fee = findFeeFuzzy(q);
  if (!fee) return null;
  const patch: Extract<AgentAction, { kind: "update_fee" }>["patch"] = {};
  const bits: string[] = [];
  if (ev.input.name) {
    patch.name = String(ev.input.name);
    bits.push(`name → ${patch.name}`);
  }
  if (ev.input.amount != null) {
    patch.amount = Number(ev.input.amount);
    bits.push(`$${patch.amount.toFixed(2)}`);
  }
  if (ev.input.recurrence) {
    const r = String(ev.input.recurrence);
    if (["one_time", "monthly", "annual"].includes(r)) {
      patch.recurrence = r as NonNullable<typeof patch.recurrence>;
      bits.push(r);
    }
  }
  if (ev.input.applies_to) {
    const a = String(ev.input.applies_to);
    if (
      [
        "slip_contract",
        "work_order",
        "boat_rental",
        "pos",
        "annual_billing_run",
      ].includes(a)
    ) {
      patch.applies_to = a as NonNullable<typeof patch.applies_to>;
      bits.push(a);
    }
  }
  if (ev.input.auto_attach !== undefined) {
    patch.auto_attach = Boolean(ev.input.auto_attach);
    bits.push(patch.auto_attach ? "auto-attach" : "manual");
  }
  if (Object.keys(patch).length === 0) return null;
  return {
    kind: "update_fee",
    label: `Update ${fee.name}`,
    fee_id: fee.id,
    fee_name: fee.name,
    patch,
    summary: bits.join(" · "),
  };
}

// Work order edit — Claude proposes a WO query (number / boater / activity)
// plus a patch (status / priority / assignee / due_date). We resolve
// the WO id and build a human-readable summary for the card.
function resolveUpdateWorkOrderAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.work_order_query ?? "").trim();
  if (!q) return null;
  const t = q.toLowerCase();
  const wo =
    WORK_ORDERS.find((w) => w.id === q) ??
    WORK_ORDERS.find((w) => w.number.toLowerCase() === t) ??
    WORK_ORDERS.find((w) => w.number.toLowerCase().includes(t)) ??
    WORK_ORDERS.find((w) => {
      const b = BOATERS.find((x) => x.id === w.boater_id);
      return b?.display_name.toLowerCase().includes(t);
    });
  if (!wo) return null;

  const patch: NonNullable<Extract<AgentAction, { kind: "update_work_order" }>["patch"]> = {};
  const summaryBits: string[] = [];

  const status = ev.input.status ? String(ev.input.status) : "";
  if (
    [
      "open",
      "scheduled",
      "in_progress",
      "blocked",
      "completed",
      "cancelled",
    ].includes(status)
  ) {
    patch.status = status as NonNullable<typeof patch.status>;
    summaryBits.push(`→ ${status.replace("_", " ")}`);
  }

  const priority = ev.input.priority ? String(ev.input.priority) : "";
  if (["low", "normal", "high", "urgent"].includes(priority)) {
    patch.priority = priority as NonNullable<typeof patch.priority>;
    summaryBits.push(`${priority} priority`);
  }

  const assigneeName = ev.input.assignee_name ? String(ev.input.assignee_name) : "";
  if (assigneeName) {
    patch.assignee_name = assigneeName;
    summaryBits.unshift(`→ ${assigneeName}`);
  }

  const dueDate = ev.input.due_date ? String(ev.input.due_date) : "";
  if (dueDate) {
    patch.due_date = dueDate;
    summaryBits.push(`by ${dueDate}`);
  }

  if (Object.keys(patch).length === 0) return null;

  const summary = summaryBits.join(" · ");
  return {
    kind: "update_work_order",
    label: `Update ${wo.number} ${summary}`,
    work_order_id: wo.id,
    work_order_number: wo.number,
    patch,
    summary,
  };
}

// Staff invite — Claude proposes a role name; we map it to the
// actual Role id. Falls back to "Dockhand" (least-privileged) if
// no role keyword is present, so the operator can re-grant from
// Settings → Staff after approval.
function resolveInviteStaffAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const name = String(ev.input.name ?? "").trim();
  if (!name) return null;
  const email = String(ev.input.email ?? "").trim();
  const phone = ev.input.phone ? String(ev.input.phone) : undefined;
  const roleQuery = String(ev.input.role ?? ev.input.role_name ?? "")
    .toLowerCase()
    .trim();

  let role =
    ROLES_SEED.find((r) => r.name.toLowerCase() === "dockhand") ??
    ROLES_SEED[ROLES_SEED.length - 1];
  if (roleQuery) {
    const exact = ROLES_SEED.find(
      (r) => r.name.toLowerCase() === roleQuery
    );
    const partial = ROLES_SEED.find((r) =>
      r.name.toLowerCase().includes(roleQuery)
    );
    role = exact ?? partial ?? role;
  }

  const resolvedEmail =
    email ||
    `${name.toLowerCase().replace(/[^\w]+/g, ".")}@example.com`;

  return {
    kind: "invite_staff",
    label: `Invite ${name} as ${role.name}`,
    name,
    email: resolvedEmail,
    phone,
    role_id: role.id,
    role_name: role.name,
  };
}

function resolveCoiRenewalAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.coi_query ?? "").trim();
  if (!q) return null;
  const coi = findCoiFuzzy(q);
  if (!coi) return null;
  return {
    kind: "request_coi_renewal",
    label: `Request renewal — ${coi.carrier} policy ${coi.policy_number}`,
    coi_id: coi.id,
  };
}

function findRentalBoatFuzzy(q: string) {
  const t = q.toLowerCase();
  return (
    RENTAL_BOATS.find((b) => b.id === q) ??
    RENTAL_BOATS.find((b) => b.name.toLowerCase().includes(t)) ??
    RENTAL_BOATS.find((b) => b.type.replace("_", " ").includes(t))
  );
}

function findBoatRentalFuzzy(q: string) {
  const t = q.toLowerCase().trim();
  return (
    BOAT_RENTALS.find((r) => r.id === q) ??
    BOAT_RENTALS.find((r) => r.number.toLowerCase() === t) ??
    BOAT_RENTALS.find((r) => r.number.toLowerCase().includes(t)) ??
    BOAT_RENTALS.find((r) =>
      (r.patron_name ?? "").toLowerCase().includes(t)
    ) ??
    BOAT_RENTALS.find((r) => {
      const b = BOATERS.find((x) => x.id === r.boater_id);
      return b?.display_name.toLowerCase().includes(t);
    })
  );
}

function findCoiFuzzy(q: string) {
  const t = q.toLowerCase().trim();
  // Exact id wins
  const byId = INSURANCE_CERTIFICATES.find((c) => c.id === q);
  if (byId) return byId;
  // Then expiring/lapsed for the named boater
  const now = Date.now();
  const expiringCerts = INSURANCE_CERTIFICATES.filter(
    (c) => new Date(c.effective_end).getTime() - now < 60 * 86_400_000
  );
  return (
    expiringCerts.find((c) => {
      const b = BOATERS.find((x) => x.id === c.boater_id);
      return b?.display_name.toLowerCase().includes(t);
    }) ??
    INSURANCE_CERTIFICATES.find((c) => c.policy_number.toLowerCase() === t) ??
    expiringCerts[0]
  );
}

// ── Rental Club resolvers ──────────────────────────────────
// These take subscription_id directly or resolve a member via boater_query.
// The seed CLUB_SUBSCRIPTIONS is the lookup source — runtime additions
// done via upsertClubSubscription don't show here, but the executor reads
// from the live store so the action still applies correctly.

function resolveUpdateClubSubscriptionAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const subId =
    typeof ev.input.subscription_id === "string"
      ? ev.input.subscription_id
      : undefined;
  const boaterQuery =
    typeof ev.input.boater_query === "string" ? ev.input.boater_query : "";

  // Need at least one way to find the subscription.
  if (!subId && !boaterQuery) return null;

  // Try to resolve to a member name for the action card label.
  let label = "Update club membership";
  if (boaterQuery) {
    const boater = findBoaterFuzzy(boaterQuery);
    if (boater) {
      const parts: string[] = [];
      if (ev.input.plan_tier) parts.push(`plan=${ev.input.plan_tier}`);
      if (ev.input.status) parts.push(`status=${ev.input.status}`);
      if (ev.input.monthly_fee !== undefined)
        parts.push(`monthly=$${ev.input.monthly_fee}`);
      const summary = parts.length ? parts.join(", ") : "edit";
      label = `Update ${boater.display_name}'s membership (${summary})`;
    }
  } else if (subId) {
    const sub = CLUB_SUBSCRIPTIONS.find((s) => s.id === subId);
    if (sub) {
      const boater = BOATERS.find((b) => b.id === sub.boater_id);
      label = `Update ${boater?.display_name ?? subId}'s membership`;
    }
  }

  return {
    kind: "update_club_subscription",
    label,
    subscription_id: subId,
    boater_query: boaterQuery || undefined,
    plan_tier: ev.input.plan_tier as
      | "basic"
      | "plus"
      | "premium"
      | undefined,
    status: ev.input.status as
      | "active"
      | "paused"
      | "cancelled"
      | "past_due"
      | undefined,
    join_fee:
      ev.input.join_fee !== undefined ? Number(ev.input.join_fee) : undefined,
    monthly_fee:
      ev.input.monthly_fee !== undefined
        ? Number(ev.input.monthly_fee)
        : undefined,
    days_per_month:
      ev.input.days_per_month !== undefined
        ? Number(ev.input.days_per_month)
        : undefined,
    next_billing_date: ev.input.next_billing_date
      ? String(ev.input.next_billing_date)
      : undefined,
    notes: ev.input.notes ? String(ev.input.notes) : undefined,
  };
}

function resolveCreateClubBookingAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const date = String(ev.input.date ?? "").trim();
  if (!date) return null;
  const subId =
    typeof ev.input.subscription_id === "string"
      ? ev.input.subscription_id
      : undefined;
  const boaterQuery =
    typeof ev.input.boater_query === "string" ? ev.input.boater_query : "";
  // Booking has to be for a known subscription OR a known member.
  if (!subId && !boaterQuery) return null;

  let memberLabel = "member";
  if (boaterQuery) {
    const boater = findBoaterFuzzy(boaterQuery);
    if (boater) memberLabel = boater.display_name;
  } else if (subId) {
    const sub = CLUB_SUBSCRIPTIONS.find((s) => s.id === subId);
    if (sub) {
      const boater = BOATERS.find((b) => b.id === sub.boater_id);
      memberLabel = boater?.display_name ?? subId;
    }
  }

  const status = (ev.input.status === "requested" ? "requested" : "confirmed") as
    | "confirmed"
    | "requested";

  return {
    kind: "create_club_booking",
    label: `Book ${memberLabel} for ${date}`,
    boater_query: boaterQuery || undefined,
    subscription_id: subId,
    date,
    start_time: ev.input.start_time ? String(ev.input.start_time) : undefined,
    end_time: ev.input.end_time ? String(ev.input.end_time) : undefined,
    rental_boat_id: ev.input.rental_boat_id
      ? String(ev.input.rental_boat_id)
      : undefined,
    status,
    notes: ev.input.notes ? String(ev.input.notes) : undefined,
  };
}

// create_boater doesn't carry boater_id (it creates one), so it's handled outside
// the boater-required block above. We splice it in by inspecting ev.name early.
function resolveCreateBoaterAction(ev: Extract<WireEvent, { type: "tool" }>): AgentAction | null {
  if (ev.name !== "create_boater") return null;
  const firstName = String(ev.input.first_name ?? "").trim();
  const lastName = String(ev.input.last_name ?? "").trim();
  if (!firstName || !lastName) return null;
  return {
    kind: "create_boater",
    label: `Onboard ${firstName} ${lastName}`,
    first_name: firstName,
    last_name: lastName,
    email: ev.input.email ? String(ev.input.email) : undefined,
    phone: ev.input.phone ? String(ev.input.phone) : undefined,
    preferred_channel: (ev.input.preferred_channel as "email" | "sms" | "voice" | undefined) ?? "email",
    billing_cadence: (ev.input.billing_cadence as
      | "annual" | "seasonal" | "monthly" | "transient"
      | undefined) ?? "transient",
    code: ev.input.code ? String(ev.input.code) : undefined,
    notes: ev.input.notes ? String(ev.input.notes) : undefined,
  };
}

function findVesselFuzzy(q: string, boaterId?: string) {
  if (!q) return undefined;
  const t = q.toLowerCase();
  const scoped = boaterId
    ? VESSELS.filter((v) => v.boater_id === boaterId || v.co_owner_ids.includes(boaterId))
    : VESSELS;
  return (
    scoped.find((v) => v.id === q) ??
    scoped.find((v) => t.includes(v.name.toLowerCase())) ??
    scoped.find((v) => v.name.toLowerCase().includes(t))
  );
}

function findSlipFuzzy(q: string) {
  if (!q) return undefined;
  const t = q.toLowerCase().trim();
  // SLIPS (current Roster) first — "A07" style ids land here. Then fall
  // back to RENTAL_SPACES for older surfaces that still seed sp_* ids.
  return (
    SLIPS.find((s) => s.id.toLowerCase() === t) ??
    SLIPS.find((s) => s.number.toLowerCase() === t) ??
    SLIPS.find((s) => t.includes(s.id.toLowerCase())) ??
    RENTAL_SPACES.find((s) => s.id === q) ??
    RENTAL_SPACES.find((s) => s.number.toLowerCase() === t) ??
    RENTAL_SPACES.find((s) => t.includes(s.number.toLowerCase()))
  );
}

// Slim local helpers (duplicate of simulated-agent internals to keep
// this file dependency-light)

// findBoaterFuzzy + boaterByIdMap live in lib/boater-lookup.ts so tools
// that need them in server contexts (lib/agent-tools/*.ts) can import
// without pulling this "use client" file into the server bundle.
// Re-export findBoaterFuzzy for backward-compat with existing callers.
import { boaterByIdMap, findBoaterFuzzy } from "@/lib/boater-lookup";
export { findBoaterFuzzy };

function matchChargeable(text: string) {
  const t = text.toLowerCase();
  // Tenant-scoped pools so a "charge a sunscreen" intent in Lakeside
  // can't accidentally pick up Marina Stee's sunscreen SKU (or vice
  // versa). All three pools recompute via getCurrentTenantId() so a
  // mid-session tenant switch flows through immediately.
  const catalog = scopedPosCatalog();
  const locations = scopedPosLocations();
  const fees = scopedAdditionalFees();
  const catalogHit = catalog.find((c) =>
    [c.name.toLowerCase(), c.sku.toLowerCase(), c.category.toLowerCase()].some((s) =>
      t.includes(s.toLowerCase().split(" ")[0])
    )
  );
  if (catalogHit) {
    const loc = locations.find((l) => catalogHit.location_keys.includes(l.key));
    if (loc) {
      return { name: catalogHit.name, price: catalogHit.price, sku: catalogHit.sku, location_id: loc.id };
    }
  }
  const hm = locations.find((l) => l.key === "harbormaster");
  const feeHit = fees.find((f) => {
    const tokens = f.name.toLowerCase().split(/\s+/);
    return tokens.some((tok) => tok.length > 3 && t.includes(tok));
  });
  if (feeHit && hm) {
    return { name: feeHit.name, price: feeHit.amount, sku: feeHit.id.toUpperCase(), location_id: hm.id };
  }
  return undefined;
}

// ────────────────────────────────────────────────────────────
// Services catalog resolvers (S-grade parity wave)
// ────────────────────────────────────────────────────────────

// Tenant-scoped seed slices — each fuzzy lookup runs against the
// active tenant only so the agent can't accidentally pick a record
// from the wrong marina.
function scopedRates() {
  const t = getCurrentTenantId();
  return RATES.filter((r) => (r.tenant_id ?? "ten_marina_stee_demo") === t);
}
function scopedRentalBoats() {
  const t = getCurrentTenantId();
  return RENTAL_BOATS.filter(
    (b) => (b.tenant_id ?? "ten_marina_stee_demo") === t
  );
}
function scopedRentalSpaces() {
  const t = getCurrentTenantId();
  return RENTAL_SPACES.filter(
    (s) => (s.tenant_id ?? "ten_marina_stee_demo") === t
  );
}
function scopedRentalGroups() {
  const t = getCurrentTenantId();
  return RENTAL_GROUPS.filter(
    (g) => (g.tenant_id ?? "ten_marina_stee_demo") === t
  );
}
function scopedDocks() {
  const t = getCurrentTenantId();
  return DOCKS.filter((d) => (d.tenant_id ?? "ten_marina_stee_demo") === t);
}

function findRateFuzzy(q: string) {
  const t = q.toLowerCase().trim();
  const pool = scopedRates();
  return (
    pool.find((r) => r.id === q) ??
    pool.find((r) => r.name.toLowerCase() === t) ??
    pool.find((r) => r.name.toLowerCase().includes(t))
  );
}
// findRentalBoatFuzzy + findDockFuzzy already defined upstream — these
// are the catalog-aware fuzzy helpers unique to this resolver batch.
function findRentalSpaceFuzzy(q: string) {
  const t = q.toLowerCase().trim();
  const pool = scopedRentalSpaces();
  return (
    pool.find((s) => s.id === q) ??
    pool.find((s) => s.number.toLowerCase() === t) ??
    pool.find((s) => s.number.toLowerCase().includes(t))
  );
}
function findRentalGroupFuzzy(q: string) {
  const t = q.toLowerCase().trim();
  const pool = scopedRentalGroups();
  return (
    pool.find((g) => g.id === q) ??
    pool.find((g) => g.name.toLowerCase() === t) ??
    pool.find((g) => g.name.toLowerCase().includes(t))
  );
}
function findVesselFuzzyForBoater(boaterId: string, q: string) {
  const t = q.toLowerCase().trim();
  const pool = VESSELS.filter((v) => v.boater_id === boaterId);
  return (
    pool.find((v) => v.id === q) ??
    pool.find((v) => v.name.toLowerCase() === t) ??
    pool.find((v) => v.name.toLowerCase().includes(t)) ??
    pool.find((v) => v.hull_vin?.toLowerCase() === t)
  );
}

function resolveCreateClubPlanAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const name = String(ev.input.name ?? "").trim();
  const tier = String(ev.input.plan_tier ?? "") as "basic" | "plus" | "premium";
  const amount = Number(ev.input.amount ?? 0);
  const days = Number(ev.input.days_per_month ?? 0);
  if (!name || !tier || amount <= 0 || days <= 0) return null;
  return {
    kind: "create_club_plan",
    label: `New club plan: ${name} — ${formatMoney(amount)}/mo · ${days} days`,
    name,
    plan_tier: tier,
    amount,
    join_fee: ev.input.join_fee != null ? Number(ev.input.join_fee) : undefined,
    days_per_month: days,
  };
}

function resolveUpdateRateAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.rate_query ?? "").trim();
  if (!q) return null;
  const rate = findRateFuzzy(q);
  if (!rate) return null;
  const patch: Extract<AgentAction, { kind: "update_rate" }>["patch"] = {};
  const bits: string[] = [];
  if (ev.input.name) {
    patch.name = String(ev.input.name);
    bits.push(`name → ${patch.name}`);
  }
  if (ev.input.amount != null) {
    patch.amount = Number(ev.input.amount);
    bits.push(`amount → ${formatMoney(patch.amount)}`);
  }
  if (ev.input.join_fee != null) {
    patch.join_fee = Number(ev.input.join_fee);
    bits.push(`join fee → ${formatMoney(patch.join_fee)}`);
  }
  if (ev.input.days_per_month != null) {
    patch.days_per_month = Number(ev.input.days_per_month);
    bits.push(`days → ${patch.days_per_month}/mo`);
  }
  if (Object.keys(patch).length === 0) return null;
  return {
    kind: "update_rate",
    label: `Update ${rate.name}`,
    rate_id: rate.id,
    rate_name: rate.name,
    patch,
    summary: bits.join(" · "),
  };
}

function resolveSetBoatClubRotationAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.boat_query ?? "").trim();
  if (!q) return null;
  const boat = findRentalBoatFuzzy(q);
  if (!boat) return null;
  const available = Boolean(ev.input.available_for_club);
  return {
    kind: "set_boat_club_rotation",
    label: available
      ? `Add ${boat.name} to club rotation`
      : `Remove ${boat.name} from club rotation`,
    boat_id: boat.id,
    boat_name: boat.name,
    available_for_club: available,
  };
}

function resolveCreateRentalBoatAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const name = String(ev.input.name ?? "").trim();
  const type = String(ev.input.type ?? "");
  const capacity = Number(ev.input.capacity ?? 0);
  const homeDock = String(ev.input.home_dock ?? "").trim();
  const deposit = Number(ev.input.deposit_amount ?? 0);
  if (!name || !type || capacity <= 0 || deposit <= 0) return null;
  return {
    kind: "create_rental_boat",
    label: `New boat: ${name}`,
    name,
    type: type as Extract<AgentAction, { kind: "create_rental_boat" }>["type"],
    capacity,
    home_dock: homeDock || undefined,
    deposit_amount: deposit,
    hourly_rate:
      ev.input.hourly_rate != null ? Number(ev.input.hourly_rate) : undefined,
    half_day_rate:
      ev.input.half_day_rate != null ? Number(ev.input.half_day_rate) : undefined,
    full_day_rate:
      ev.input.full_day_rate != null ? Number(ev.input.full_day_rate) : undefined,
    fuel_capacity_gal:
      ev.input.fuel_capacity_gal != null
        ? Number(ev.input.fuel_capacity_gal)
        : undefined,
    available_for_club:
      ev.input.available_for_club === undefined
        ? true
        : Boolean(ev.input.available_for_club),
    notes: ev.input.notes ? String(ev.input.notes) : undefined,
  };
}

function resolveCreateMeterReadingAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const q = String(ev.input.space_query ?? "").trim();
  const current = Number(ev.input.current_reading ?? 0);
  if (!q || current <= 0) return null;
  const space = findRentalSpaceFuzzy(q);
  if (!space) return null;
  return {
    kind: "create_meter_reading",
    label: `Log meter reading for ${space.number} — ${current}`,
    space_id: space.id,
    space_number: space.number,
    meter_number: ev.input.meter_number ? String(ev.input.meter_number) : undefined,
    current_reading: current,
    unit: (ev.input.unit as "kWh" | "gallons" | undefined) ?? "kWh",
    rate_per_unit:
      ev.input.rate_per_unit != null ? Number(ev.input.rate_per_unit) : undefined,
  };
}

function resolveCreateSlipAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const dockQ = String(ev.input.dock_query ?? "").trim();
  const number = String(ev.input.number ?? "").trim();
  const slipClass = String(ev.input.slip_class ?? "");
  const loa = Number(ev.input.max_loa_inches ?? 0);
  const beam = Number(ev.input.max_beam_inches ?? 0);
  if (!dockQ || !number || !slipClass || loa <= 0 || beam <= 0) return null;
  const dock = findDockFuzzy(dockQ);
  if (!dock) return null;
  return {
    kind: "create_slip",
    label: `New slip ${(dock.prefix ?? "")}${number} on ${dock.name}`,
    dock_id: dock.id,
    dock_name: dock.name,
    number,
    slip_class: slipClass as Extract<AgentAction, { kind: "create_slip" }>["slip_class"],
    max_loa_inches: loa,
    max_beam_inches: beam,
    has_power: ev.input.has_power === undefined ? true : Boolean(ev.input.has_power),
    has_water: ev.input.has_water === undefined ? true : Boolean(ev.input.has_water),
    default_annual_rate:
      ev.input.default_annual_rate != null
        ? Number(ev.input.default_annual_rate)
        : undefined,
  };
}

function resolveCreateRentalGroupAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const name = String(ev.input.name ?? "").trim();
  const type = String(ev.input.type ?? "");
  if (!name || !type) return null;
  return {
    kind: "create_rental_group",
    label: `New group: ${name}`,
    name,
    type: type as Extract<AgentAction, { kind: "create_rental_group" }>["type"],
    check_in_time: ev.input.check_in_time ? String(ev.input.check_in_time) : undefined,
    check_out_time: ev.input.check_out_time ? String(ev.input.check_out_time) : undefined,
    total_spaces: ev.input.total_spaces != null ? Number(ev.input.total_spaces) : undefined,
  };
}

function resolveCreateRentalSpaceAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const groupQ = String(ev.input.group_query ?? "").trim();
  const number = String(ev.input.number ?? "").trim();
  const occ = String(ev.input.occupancy_type ?? "");
  if (!groupQ || !number || !occ) return null;
  const group = findRentalGroupFuzzy(groupQ);
  if (!group) return null;
  return {
    kind: "create_rental_space",
    label: `New space ${number} on ${group.name}`,
    group_id: group.id,
    group_name: group.name,
    number,
    occupancy_type: occ as Extract<AgentAction, { kind: "create_rental_space" }>["occupancy_type"],
    length_inches: ev.input.length_inches != null ? Number(ev.input.length_inches) : undefined,
    beam_inches: ev.input.beam_inches != null ? Number(ev.input.beam_inches) : undefined,
    has_power: ev.input.has_power === undefined ? true : Boolean(ev.input.has_power),
    has_water: ev.input.has_water === undefined ? true : Boolean(ev.input.has_water),
    has_pump_out: Boolean(ev.input.has_pump_out),
  };
}

function resolveCreateInsuranceCertificateAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const boaterQ = String(ev.input.boater_query ?? "").trim();
  const vesselQ = String(ev.input.vessel_query ?? "").trim();
  const carrier = String(ev.input.carrier ?? "").trim();
  const policy = String(ev.input.policy_number ?? "").trim();
  const start = String(ev.input.effective_start ?? "");
  const end = String(ev.input.effective_end ?? "");
  if (!boaterQ || !vesselQ || !carrier || !policy || !start || !end) return null;
  const boater = findBoaterFuzzy(boaterQ);
  if (!boater) return null;
  const vessel = findVesselFuzzyForBoater(boater.id, vesselQ);
  if (!vessel) return null;
  return {
    kind: "create_insurance_certificate",
    label: `New COI: ${vessel.name} (${carrier})`,
    boater_id: boater.id,
    vessel_id: vessel.id,
    carrier,
    policy_number: policy,
    liability_limit:
      ev.input.liability_limit != null ? Number(ev.input.liability_limit) : undefined,
    hull_value: ev.input.hull_value != null ? Number(ev.input.hull_value) : undefined,
    effective_start: start,
    effective_end: end,
    pdf_url: ev.input.pdf_url ? String(ev.input.pdf_url) : undefined,
  };
}

function resolveCreateContractTemplateAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const name = String(ev.input.name ?? "").trim();
  const type = String(ev.input.type ?? "");
  const body = String(ev.input.body_markdown ?? "").trim();
  if (!name || !type || !body) return null;
  return {
    kind: "create_contract_template",
    label: `New contract template: ${name}`,
    name,
    type: type as Extract<AgentAction, { kind: "create_contract_template" }>["type"],
    body_markdown: body,
  };
}

// ────────────────────────────────────────────────────────────
// Back office resolvers (Staffing / Vendor / Inventory / Assets)
// ────────────────────────────────────────────────────────────

// Tenant-scoped seed views — fall back to the seed when the runtime
// store isn't reachable from this file. New entities created via
// the UI live in the store and won't appear here; the agent's main
// use case is resolving seeded vendors/assets to log transactions.
function scopedStaff() {
  const t = getCurrentTenantId();
  return STAFF_SEED.filter((s) => (s.tenant_id ?? "ten_marina_stee_demo") === t);
}
function scopedVendors() {
  const t = getCurrentTenantId();
  return VENDORS_SEED.filter((v) => v.tenant_id === t);
}
function scopedBills() {
  const t = getCurrentTenantId();
  return BILLS_SEED.filter((b) => b.tenant_id === t);
}
function scopedAssets() {
  const t = getCurrentTenantId();
  return MARINA_ASSETS_SEED.filter((a) => a.tenant_id === t);
}

function findStaffFuzzyBO(q: string) {
  const t = q.toLowerCase().trim();
  const pool = scopedStaff();
  return (
    pool.find((s) => s.id === q) ??
    pool.find((s) => s.name.toLowerCase() === t) ??
    pool.find((s) => s.name.toLowerCase().includes(t)) ??
    pool.find((s) => s.email.toLowerCase().includes(t))
  );
}
function findVendorFuzzy(q: string) {
  const t = q.toLowerCase().trim();
  const pool = scopedVendors();
  return (
    pool.find((v) => v.id === q) ??
    pool.find((v) => v.name.toLowerCase() === t) ??
    pool.find((v) => v.display_name?.toLowerCase() === t) ??
    pool.find((v) => v.name.toLowerCase().includes(t)) ??
    pool.find((v) => (v.display_name ?? "").toLowerCase().includes(t))
  );
}
function findBillFuzzy(q: string) {
  const t = q.toLowerCase().trim();
  const pool = scopedBills();
  return (
    pool.find((b) => b.id === q) ??
    pool.find((b) => b.number.toLowerCase() === t) ??
    pool.find((b) => b.number.toLowerCase().includes(t))
  );
}
function findAssetFuzzy(q: string) {
  const t = q.toLowerCase().trim();
  const pool = scopedAssets();
  return (
    pool.find((a) => a.id === q) ??
    pool.find((a) => a.name.toLowerCase() === t) ??
    pool.find((a) => a.name.toLowerCase().includes(t))
  );
}
function findPosItemFuzzyForBackOffice(q: string) {
  const t = q.toLowerCase().trim();
  const tenant = getCurrentTenantId();
  const pool = POS_CATALOG.filter(
    (i) => (i.tenant_id ?? "ten_marina_stee_demo") === tenant
  );
  return (
    pool.find((i) => i.id === q) ??
    pool.find((i) => i.sku.toLowerCase() === t) ??
    pool.find((i) => i.name.toLowerCase() === t) ??
    pool.find((i) => i.name.toLowerCase().includes(t)) ??
    pool.find((i) => i.sku.toLowerCase().includes(t))
  );
}

function resolveCreateShiftAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const sq = String(ev.input.staff_query ?? "").trim();
  const date = String(ev.input.date ?? "");
  const start = String(ev.input.start_time ?? "");
  const end = String(ev.input.end_time ?? "");
  if (!sq || !date || !start || !end) return null;
  const staff = findStaffFuzzyBO(sq);
  if (!staff) return null;
  const startISO = new Date(`${date}T${start}:00`).toISOString();
  const endISO = new Date(`${date}T${end}:00`).toISOString();
  return {
    kind: "create_shift",
    label: `Schedule ${staff.name} — ${date} ${start}–${end}`,
    staff_id: staff.id,
    staff_name: staff.name,
    start_at: startISO,
    end_at: endISO,
    position: String(ev.input.position ?? staff.default_position ?? "Dockhand"),
  };
}

function resolveRunPayrollAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const ps = String(ev.input.period_start ?? "");
  const pe = String(ev.input.period_end ?? "");
  if (!ps || !pe) return null;
  return {
    kind: "run_payroll",
    label: `Run payroll — ${ps} → ${pe}`,
    period_start: ps,
    period_end: pe,
    pay_date: ev.input.pay_date ? String(ev.input.pay_date) : undefined,
  };
}

function resolveCreateCertificationAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const sq = String(ev.input.staff_query ?? "").trim();
  const name = String(ev.input.name ?? "").trim();
  const issued = String(ev.input.issued_at ?? "");
  if (!sq || !name || !issued) return null;
  const staff = findStaffFuzzyBO(sq);
  if (!staff) return null;
  return {
    kind: "create_certification",
    label: `New cert: ${name} — ${staff.name}`,
    staff_id: staff.id,
    staff_name: staff.name,
    name,
    issuer: ev.input.issuer ? String(ev.input.issuer) : undefined,
    issued_at: issued,
    expires_at: ev.input.expires_at ? String(ev.input.expires_at) : undefined,
  };
}

function resolveCreateVendorAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const name = String(ev.input.name ?? "").trim();
  const terms = String(ev.input.payment_terms ?? "");
  if (!name || !terms) return null;
  return {
    kind: "create_vendor",
    label: `New vendor: ${name}`,
    name,
    display_name: ev.input.display_name ? String(ev.input.display_name) : undefined,
    contact_name: ev.input.contact_name ? String(ev.input.contact_name) : undefined,
    email: ev.input.email ? String(ev.input.email) : undefined,
    phone: ev.input.phone ? String(ev.input.phone) : undefined,
    payment_terms: terms as Extract<AgentAction, { kind: "create_vendor" }>["payment_terms"],
    default_gl_account: ev.input.default_gl_account
      ? String(ev.input.default_gl_account)
      : undefined,
    issue_1099: Boolean(ev.input.issue_1099),
  };
}

function resolveCreateBillAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const vq = String(ev.input.vendor_query ?? "").trim();
  const number = String(ev.input.number ?? "").trim();
  const amount = Number(ev.input.amount ?? 0);
  if (!vq || !number || amount <= 0) return null;
  const vendor = findVendorFuzzy(vq);
  if (!vendor) return null;
  const today = new Date().toISOString().slice(0, 10);
  const billDate = String(ev.input.bill_date ?? today);
  // Auto-roll due date from terms if not supplied
  let dueDate = String(ev.input.due_date ?? "");
  if (!dueDate) {
    const d = new Date(billDate);
    const days =
      vendor.payment_terms === "due_on_receipt"
        ? 0
        : vendor.payment_terms === "net_7"
        ? 7
        : vendor.payment_terms === "net_15"
        ? 15
        : vendor.payment_terms === "net_30"
        ? 30
        : 60;
    d.setDate(d.getDate() + days);
    dueDate = d.toISOString().slice(0, 10);
  }
  return {
    kind: "create_bill",
    label: `New bill: ${vendor.display_name ?? vendor.name} — ${formatMoney(amount)}`,
    vendor_id: vendor.id,
    vendor_name: vendor.display_name ?? vendor.name,
    number,
    bill_date: billDate,
    due_date: dueDate,
    amount,
    gl_account: ev.input.gl_account
      ? String(ev.input.gl_account)
      : vendor.default_gl_account,
    notes: ev.input.notes ? String(ev.input.notes) : undefined,
  };
}

function resolvePayBillAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const bq = String(ev.input.bill_query ?? "").trim();
  const method = String(ev.input.method ?? "");
  if (!bq || !method) return null;
  const bill = findBillFuzzy(bq);
  if (!bill) return null;
  const vendor = findVendorFuzzy(bill.vendor_id);
  const remaining = +(bill.amount - bill.amount_paid).toFixed(2);
  const amount =
    ev.input.amount != null ? Math.min(remaining, Number(ev.input.amount)) : remaining;
  if (amount <= 0) return null;
  return {
    kind: "pay_bill",
    label: `Pay ${bill.number} — ${formatMoney(amount)}`,
    bill_id: bill.id,
    bill_number: bill.number,
    vendor_name: vendor?.display_name ?? vendor?.name ?? bill.vendor_id,
    amount,
    method: method as Extract<AgentAction, { kind: "pay_bill" }>["method"],
    check_number: ev.input.check_number ? String(ev.input.check_number) : undefined,
  };
}

function resolveReceiveStockAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const iq = String(ev.input.item_query ?? "").trim();
  const qty = Number(ev.input.qty ?? 0);
  if (!iq || qty <= 0) return null;
  const item = findPosItemFuzzyForBackOffice(iq);
  if (!item) return null;
  let billId: string | undefined;
  if (ev.input.bill_query) {
    const bill = findBillFuzzy(String(ev.input.bill_query));
    billId = bill?.id;
  }
  return {
    kind: "receive_stock",
    label: `Receive ${qty} ${item.name}`,
    item_id: item.id,
    item_name: item.name,
    qty,
    bill_id: billId,
    notes: ev.input.notes ? String(ev.input.notes) : undefined,
  };
}

function resolveCreateAssetAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const name = String(ev.input.name ?? "").trim();
  const kind = String(ev.input.kind ?? "");
  if (!name || !kind) return null;
  return {
    kind: "create_asset",
    label: `New asset: ${name}`,
    name,
    asset_kind: kind as Extract<AgentAction, { kind: "create_asset" }>["asset_kind"],
    serial_number: ev.input.serial_number
      ? String(ev.input.serial_number)
      : undefined,
    location: ev.input.location ? String(ev.input.location) : undefined,
    purchase_date: ev.input.purchase_date
      ? String(ev.input.purchase_date)
      : undefined,
    purchase_price:
      ev.input.purchase_price != null
        ? Number(ev.input.purchase_price)
        : undefined,
  };
}

function resolveCreatePmScheduleAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const aq = String(ev.input.asset_query ?? "").trim();
  const name = String(ev.input.name ?? "").trim();
  const cadence = String(ev.input.cadence ?? "");
  const due = String(ev.input.next_due_at ?? "");
  if (!aq || !name || !cadence || !due) return null;
  const asset = findAssetFuzzy(aq);
  if (!asset) return null;
  return {
    kind: "create_pm_schedule",
    label: `New PM: ${name} — ${asset.name}`,
    asset_id: asset.id,
    asset_name: asset.name,
    name,
    cadence: cadence as Extract<AgentAction, { kind: "create_pm_schedule" }>["cadence"],
    next_due_at: due,
    auto_create_wo_days_ahead:
      ev.input.auto_create_wo_days_ahead != null
        ? Number(ev.input.auto_create_wo_days_ahead)
        : undefined,
  };
}

// ── Back office round 2 resolvers ──

function resolveApproveTimeEntryAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const sq = String(ev.input.staff_query ?? "").trim();
  const date = String(ev.input.date ?? "");
  if (!sq || !date) return null;
  const staff = findStaffFuzzyBO(sq);
  if (!staff) return null;
  // Resolve from the seed TIME_ENTRIES — runtime entries (from /dock
  // clock-in) live in the store and won't appear here, but the agent's
  // intent is the same: find an unapproved entry for this staffer on
  // this calendar date and approve it. The executor re-resolves
  // against live store state.
  const tenant = getCurrentTenantId();
  const pool = TIME_ENTRIES_SEED.filter(
    (t) => t.tenant_id === tenant && t.staff_id === staff.id
  );
  const match = pool.find((t) => {
    if (t.approved_at) return false; // already approved
    if (!t.clock_out_at) return false; // still on the clock
    return t.clock_in_at.slice(0, 10) === date;
  });
  if (!match) return null;
  return {
    kind: "approve_time_entry",
    label: `Approve ${staff.name}'s time card — ${date} (${(match.calculated_hours ?? 0).toFixed(2)} hrs)`,
    time_entry_id: match.id,
    staff_id: staff.id,
    staff_name: staff.name,
    hours: match.calculated_hours ?? 0,
    date,
  };
}

function resolveCreateStaffAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const name = String(ev.input.name ?? "").trim();
  const email = String(ev.input.email ?? "").trim();
  const pos = String(ev.input.default_position ?? "").trim();
  const empType = String(ev.input.employment_type ?? "");
  if (!name || !email || !pos || !empType) return null;
  if (empType !== "w2" && empType !== "1099") return null;
  return {
    kind: "create_staff",
    label: `New staff: ${name} — ${pos}`,
    name,
    email,
    phone: ev.input.phone ? String(ev.input.phone) : undefined,
    default_position: pos,
    employment_type: empType,
    hourly_rate:
      ev.input.hourly_rate != null ? Number(ev.input.hourly_rate) : undefined,
    salary_annual:
      ev.input.salary_annual != null ? Number(ev.input.salary_annual) : undefined,
    hire_date: ev.input.hire_date ? String(ev.input.hire_date) : undefined,
    mobile_clock_pin: ev.input.mobile_clock_pin
      ? String(ev.input.mobile_clock_pin)
      : undefined,
  };
}

function resolveUpdateStaffWageAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const sq = String(ev.input.staff_query ?? "").trim();
  if (!sq) return null;
  const staff = findStaffFuzzyBO(sq);
  if (!staff) return null;
  const hourly =
    ev.input.hourly_rate != null ? Number(ev.input.hourly_rate) : undefined;
  const salary =
    ev.input.salary_annual != null ? Number(ev.input.salary_annual) : undefined;
  const empType =
    ev.input.employment_type === "w2" || ev.input.employment_type === "1099"
      ? (ev.input.employment_type as "w2" | "1099")
      : undefined;
  const ot =
    ev.input.ot_multiplier != null
      ? Number(ev.input.ot_multiplier)
      : undefined;
  if (
    hourly === undefined &&
    salary === undefined &&
    empType === undefined &&
    ot === undefined
  ) {
    return null; // nothing to change
  }
  const summary =
    hourly !== undefined
      ? `${formatMoney(hourly)}/hr`
      : salary !== undefined
      ? `${formatMoney(salary)}/yr`
      : empType
      ? `→ ${empType.toUpperCase()}`
      : "OT multiplier";
  return {
    kind: "update_staff_wage",
    label: `Update wage: ${staff.name} ${summary}`,
    staff_id: staff.id,
    staff_name: staff.name,
    hourly_rate: hourly,
    salary_annual: salary,
    employment_type: empType,
    ot_multiplier: ot,
  };
}

function resolveAdjustStockAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const iq = String(ev.input.item_query ?? "").trim();
  const delta = Number(ev.input.delta ?? 0);
  if (!iq || delta === 0) return null;
  const item = findPosItemFuzzyForBackOffice(iq);
  if (!item) return null;
  return {
    kind: "adjust_stock",
    label: `Adjust ${item.name} ${delta > 0 ? "+" : ""}${delta}`,
    item_id: item.id,
    item_name: item.name,
    delta,
    notes: ev.input.notes ? String(ev.input.notes) : undefined,
  };
}

function resolveLogStockLossAction(
  ev: Extract<WireEvent, { type: "tool" }>
): AgentAction | null {
  const iq = String(ev.input.item_query ?? "").trim();
  const qty = Number(ev.input.qty ?? 0);
  if (!iq || qty <= 0) return null;
  const item = findPosItemFuzzyForBackOffice(iq);
  if (!item) return null;
  const reason = ev.input.reason ? String(ev.input.reason) : undefined;
  return {
    kind: "log_stock_loss",
    label: `Log loss: ${qty} × ${item.name}${reason ? ` (${reason})` : ""}`,
    item_id: item.id,
    item_name: item.name,
    qty,
    reason,
    notes: ev.input.notes ? String(ev.input.notes) : undefined,
  };
}

function formatMoney(amount: number) {
  return "$" + amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ────────────────────────────────────────────────────────────
// Local-only fallback when the fetch fails entirely
// ────────────────────────────────────────────────────────────

async function* localFallback(
  prompt: string,
  ledger: LedgerEntry[]
): AsyncGenerator<AgentStreamEvent, void, void> {
  yield { kind: "source", source: "simulated" };
  const { stream, action } = generateAgentResponse(prompt, ledger);
  await delay(250);
  for (const chunk of stream) {
    yield { kind: "text", text: chunk };
    await delay(Math.min(60 + chunk.length * 8, 250));
  }
  if (action) yield { kind: "action", action };
}

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
