"use client";

import {
  ADDITIONAL_FEES,
  BOATERS,
  CONTRACTS,
  METER_READINGS,
  POS_CATALOG,
  POS_LOCATIONS,
  RENTAL_GROUPS,
  RENTAL_SPACES,
  WORK_ORDERS,
  formatMoney,
  getSlip,
  meterAnomaly,
  meterDelta,
} from "@/lib/mock-data";
import {
  addCommunication,
  addLedgerEntry,
  addPosOrder,
  nextInvoiceNumber,
  nextLedgerId,
  nextPosOrderId,
  nextPosOrderNumber,
} from "@/lib/client-store";
import type {
  Boater,
  Communication,
  LedgerEntry,
  PosOrder,
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

// Execute the agent's proposed action against the client store.
export function executeAgentAction(action: AgentAction): void {
  if (action.kind === "charge_to_account") {
    const now = new Date().toISOString();
    const orderId = nextPosOrderId();
    const orderNumber = nextPosOrderNumber();
    const boater = BOATERS.find((b) => b.id === action.boater_id);
    if (!boater) return;
    const location = POS_LOCATIONS.find((l) => l.id === action.location_id);
    if (!location) return;
    const subtotal = action.line.price;
    const tax = Math.round(subtotal * location.default_tax_rate * 100) / 100;
    const total = subtotal + tax;
    const invoiceId = nextLedgerId();
    const invoiceNum = nextInvoiceNumber();

    const order: PosOrder = {
      id: orderId,
      number: orderNumber,
      location_id: location.id,
      customer_kind: "boater",
      boater_id: boater.id,
      line_items: [{ sku: action.line.sku, name: action.line.name, qty: 1, unit_price: action.line.price, total: subtotal }],
      subtotal,
      tax,
      total,
      payment_method: "charge_to_account",
      status: "paid",
      created_at: now,
      closed_at: now,
      linked_ledger_entry_id: invoiceId,
    };
    const invoice: LedgerEntry = {
      id: invoiceId,
      boater_id: boater.id,
      type: "invoice",
      number: invoiceNum,
      date: now.slice(0, 10),
      amount: total,
      open_balance: total,
      method: null,
      status: "open",
      line_items: [{ description: action.line.name, amount: subtotal }],
      linked_pos_order_id: orderId,
    };
    addLedgerEntry(invoice);
    addPosOrder(order);

    // Auto-receipt
    const receipt: Communication = {
      id: `cm_agent_${Date.now()}`,
      boater_id: boater.id,
      type: boater.communication_prefs.preferred_channel,
      direction: "outbound",
      subject: `Marina Stee Receipt — ${location.name}`,
      body_preview: `Charged ${formatMoney(total)} for ${action.line.name} to your account.`,
      sender_label: "Marina Stee Agent",
      sender_is_system: true,
      recipient:
        boater.communication_prefs.preferred_channel === "email"
          ? boater.primary_contact.email ?? "—"
          : boater.primary_contact.phone ?? "—",
      sent_at: now,
      status: "delivered",
      related_entity: { type: "invoice", id: orderId },
    };
    addCommunication(receipt);
    return;
  }

  if (action.kind === "send_message") {
    const boater = BOATERS.find((b) => b.id === action.boater_id);
    if (!boater) return;
    const comm: Communication = {
      id: `cm_agent_${Date.now()}`,
      boater_id: boater.id,
      type: action.type,
      direction: "outbound",
      subject: action.subject,
      body_preview: action.body,
      sender_label: "Marina Stee Agent",
      sender_is_system: true,
      recipient:
        action.type === "email"
          ? boater.primary_contact.email ?? "—"
          : boater.primary_contact.phone ?? "—",
      sent_at: new Date().toISOString(),
      status: "delivered",
    };
    addCommunication(comm);
  }
}

// Use `getSlip` to silence the unused import — it's there to support future
// intents like "show me the boater in slip A29".
void getSlip;
