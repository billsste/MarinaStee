// Server-safe — no "use client" so this can be imported from /api/agent
// route handlers. The action EXECUTOR lives in lib/agent-actions.ts (client).

import {
  ADDITIONAL_FEES,
  BOATERS,
  CONTRACTS,
  METER_READINGS,
  POS_CATALOG,
  POS_LOCATIONS,
  RENTAL_GROUPS,
  RENTAL_SPACES,
  VESSELS,
  WORK_ORDERS,
  formatMoney,
  getSlip,
  meterAnomaly,
  meterDelta,
} from "@/lib/mock-data";
import type {
  Boater,
  LedgerEntry,
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
  | {
      kind: "request_coi_renewal";
      label: string;
      coi_id: string;
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

function matchChargeable(text: string): ChargeableItem | undefined {
  const t = text.toLowerCase();

  // First, try POS catalog (fuel, ship store, restaurant items)
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

  // Then, try additional service fees (hoist, transfer, pump-out, etc.)
  // These are billed via the Harbormaster register conceptually.
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

export function generateAgentResponse(
  prompt: string,
  ledgerSnapshot: LedgerEntry[]
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
    const item = matchChargeable(p);
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
