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
  INSURANCE_CERTIFICATES,
  POS_CATALOG,
  POS_LOCATIONS,
  RENTAL_BOATS,
  RENTAL_SPACES,
  SLIPS,
  VESSELS,
} from "@/lib/mock-data";
import {
  generateAgentResponse,
  type AgentAction,
} from "@/lib/simulated-agent";
import type { Boater, LedgerEntry } from "@/lib/types";

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
  let res: Response | null = null;
  try {
    res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, ledger }),
    });
  } catch {
    res = null;
  }

  if (!res || !res.body || !res.ok) {
    yield* localFallback(prompt, ledger);
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

      const ev = translate(parsed);
      if (ev) yield ev;
    }
  }
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

function findBoaterFuzzy(q: string): Boater | undefined {
  if (!q) return undefined;
  // direct id match (when server pre-resolved)
  const byId = BOATERS.find((b) => b.id === q);
  if (byId) return byId;
  const t = q.toLowerCase();
  return (
    BOATERS.find((b) => t.includes(b.last_name.toLowerCase())) ??
    BOATERS.find((b) => t.includes(b.first_name.toLowerCase())) ??
    BOATERS.find((b) => b.code && t.includes(b.code.toLowerCase()))
  );
}

function matchChargeable(text: string) {
  const t = text.toLowerCase();
  const catalogHit = POS_CATALOG.find((c) =>
    [c.name.toLowerCase(), c.sku.toLowerCase(), c.category.toLowerCase()].some((s) =>
      t.includes(s.toLowerCase().split(" ")[0])
    )
  );
  if (catalogHit) {
    const loc = POS_LOCATIONS.find((l) => catalogHit.location_keys.includes(l.key));
    if (loc) {
      return { name: catalogHit.name, price: catalogHit.price, sku: catalogHit.sku, location_id: loc.id };
    }
  }
  const hm = POS_LOCATIONS.find((l) => l.key === "harbormaster");
  const feeHit = ADDITIONAL_FEES.find((f) => {
    const tokens = f.name.toLowerCase().split(/\s+/);
    return tokens.some((tok) => tok.length > 3 && t.includes(tok));
  });
  if (feeHit && hm) {
    return { name: feeHit.name, price: feeHit.amount, sku: feeHit.id.toUpperCase(), location_id: hm.id };
  }
  return undefined;
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
