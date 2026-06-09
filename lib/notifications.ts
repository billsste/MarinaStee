// Notifications aggregator.
//
// Pulls from every domain we already model (ledger, work orders, meters,
// fuel, contracts, comms) and produces a flat, sortable list of Alert
// objects for the /notifications page + the sidebar unread badge.
//
// No state of its own — the consumer (React hook) passes in the live
// store snapshot so this stays pure + testable. Acknowledgement state
// lives in component state (local triage), not here.
//
// Adding a new source: write a function that returns Alert[] and add it
// to buildAlerts() below. Severity heuristics live in each builder so the
// concept of "what counts as urgent" stays close to the data.

import {
  BOATERS,
  CONTRACTS,
  FUEL_INVENTORY,
  METER_READINGS,
  RENTAL_SPACES,
  VESSELS,
  fuelPct,
  meterAnomaly,
  meterDelta,
} from "@/lib/mock-data";
import type {
  Communication,
  InsuranceCertificate,
  LedgerEntry,
  WorkOrder,
} from "@/lib/types";

export type AlertSeverity = "danger" | "warn" | "info";

export type AlertSource =
  | "overdue_payment"
  | "meter_anomaly"
  | "contract_expiry"
  | "fuel_low"
  | "urgent_work_order"
  | "unanswered_inbound"
  | "insurance_expiry";

export type Alert = {
  id: string;
  source: AlertSource;
  severity: AlertSeverity;
  title: string;
  detail: string;
  // ISO timestamp used to sort newest-first
  occurred_at: string;
  // Optional links for one-click drill-down
  boater_id?: string;
  href?: string;
  // Optional one-line "what the agent could do next" hint that the UI may
  // surface as a button or hand to the agent chat prompt.
  suggested_prompt?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-source builders
// ─────────────────────────────────────────────────────────────────────────────

const OVERDUE_DAYS = 30;

function overduePayments(ledger: LedgerEntry[], now: Date): Alert[] {
  const cutoff = new Date(now.getTime() - OVERDUE_DAYS * 86_400_000);
  return ledger
    .filter((l) => l.type === "invoice" && l.open_balance > 0 && new Date(l.date) < cutoff)
    .map((l) => {
      const boater = BOATERS.find((b) => b.id === l.boater_id);
      const ageDays = Math.round((now.getTime() - new Date(l.date).getTime()) / 86_400_000);
      const severity: AlertSeverity = ageDays > 60 ? "danger" : "warn";
      return {
        id: `overdue_${l.id}`,
        source: "overdue_payment" as const,
        severity,
        title: `${boater?.display_name ?? "Boater"} — $${l.open_balance.toFixed(2)} overdue`,
        detail: `Invoice ${l.number ?? l.id.slice(-6)} dated ${l.date} (${ageDays} days old).`,
        occurred_at: l.date,
        boater_id: l.boater_id,
        href: boater ? `/members/${boater.id}` : undefined,
        suggested_prompt: boater
          ? `Send a payment reminder to ${boater.first_name}`
          : undefined,
      };
    });
}

function meterAnomalies(now: Date): Alert[] {
  return METER_READINGS.filter(meterAnomaly).map((m) => {
    const sp = RENTAL_SPACES.find((s) => s.id === m.space_id);
    const delta = meterDelta(m);
    return {
      id: `anomaly_${m.id}`,
      source: "meter_anomaly" as const,
      severity: delta > 20 ? ("danger" as const) : ("warn" as const),
      title: `Slip ${sp?.number ?? "?"} pedestal jumped +${delta} ${m.unit ?? "units"}`,
      detail: `Meter ${m.meter_number} reading ${m.current_reading.toLocaleString()} — investigate before billing.`,
      occurred_at: m.current_ts ?? now.toISOString(),
      href: "/services/meters",
      suggested_prompt: `Open a work order to investigate pedestal ${sp?.number ?? m.meter_number}`,
    };
  });
}

const EXPIRY_WINDOW_DAYS = 30;

function contractExpiry(now: Date): Alert[] {
  const cutoff = now.getTime() + EXPIRY_WINDOW_DAYS * 86_400_000;
  return CONTRACTS.filter((c) => c.status === "active")
    .filter((c) => {
      const end = new Date(c.effective_end).getTime();
      return end > 0 && end <= cutoff;
    })
    .map((c) => {
      const boater = BOATERS.find((b) => b.id === c.boater_id);
      const daysRemaining = Math.round(
        (new Date(c.effective_end).getTime() - now.getTime()) / 86_400_000
      );
      const severity: AlertSeverity =
        daysRemaining < 0 ? "danger" : daysRemaining < 14 ? "warn" : "info";
      return {
        id: `expiry_${c.id}`,
        source: "contract_expiry" as const,
        severity,
        title: `${boater?.display_name ?? "Contract"} ${c.number} expires ${c.effective_end}`,
        detail:
          daysRemaining < 0
            ? `Lapsed ${-daysRemaining} days ago — should be renewed or terminated.`
            : `${daysRemaining} days remaining. Annual rate $${(c.annual_rate ?? 0).toLocaleString()}.`,
        occurred_at: c.effective_end,
        boater_id: c.boater_id,
        href: boater ? `/members/${boater.id}` : "/services/contracts",
        suggested_prompt: boater
          ? `Draft a renewal contract for ${boater.first_name}`
          : undefined,
      };
    });
}

function fuelLow(now: Date): Alert[] {
  return FUEL_INVENTORY.filter((inv) => fuelPct(inv) <= inv.reorder_threshold_pct).map((inv) => {
    const pct = fuelPct(inv);
    const severity: AlertSeverity =
      pct < inv.reorder_threshold_pct - 10 ? "danger" : "warn";
    return {
      id: `fuel_${inv.id}`,
      source: "fuel_low" as const,
      severity,
      title: `${cap(inv.fuel_type)} tank at ${pct.toFixed(0)}%`,
      detail: `${inv.current_level_gallons.toLocaleString()} of ${inv.tank_capacity_gallons.toLocaleString()} gal. Reorder threshold ${inv.reorder_threshold_pct}%.`,
      occurred_at: inv.last_updated_at ?? now.toISOString(),
      href: "/services/gas",
      suggested_prompt: `Place a fuel reorder for ${inv.fuel_type}`,
    };
  });
}

function urgentWorkOrders(workOrders: WorkOrder[]): Alert[] {
  return workOrders
    .filter(
      (w) =>
        (w.priority === "urgent" || w.flagged) &&
        ["open", "scheduled", "in_progress", "blocked"].includes(w.status)
    )
    .map((w) => {
      const boater = BOATERS.find((b) => b.id === w.boater_id);
      const severity: AlertSeverity = w.priority === "urgent" ? "danger" : "warn";
      return {
        id: `wo_${w.id}`,
        source: "urgent_work_order" as const,
        severity,
        title: `${w.priority === "urgent" ? "Urgent" : "Flagged"} — ${w.subject}`,
        detail: `${w.number} · ${boater?.display_name ?? "—"} · status ${w.status.replace("_", " ")}.`,
        occurred_at: w.start_date ?? w.due_date ?? new Date().toISOString(),
        boater_id: w.boater_id,
        href: `/work-orders/${w.id}`,
        suggested_prompt: boater
          ? `Reassign ${w.subject} to a different technician`
          : undefined,
      };
    });
}

const INSURANCE_EXPIRY_WINDOW_DAYS = 60;

function insuranceExpiry(insurance: InsuranceCertificate[], now: Date): Alert[] {
  const cutoff = now.getTime() + INSURANCE_EXPIRY_WINDOW_DAYS * 86_400_000;
  // Per vessel, only the LATEST cert matters — if a fresh policy supersedes
  // an old one, the old one shouldn't continue to alert.
  const byVessel = new Map<string, InsuranceCertificate>();
  for (const c of insurance) {
    const existing = byVessel.get(c.vessel_id);
    if (!existing || existing.effective_end < c.effective_end) {
      byVessel.set(c.vessel_id, c);
    }
  }
  const alerts: Alert[] = [];
  for (const c of byVessel.values()) {
    const end = new Date(c.effective_end).getTime();
    if (end > cutoff) continue;
    const daysRemaining = Math.round((end - now.getTime()) / 86_400_000);
    const vessel = VESSELS.find((v) => v.id === c.vessel_id);
    const boater = BOATERS.find((b) => b.id === c.boater_id);
    const severity: AlertSeverity =
      daysRemaining < 0 ? "danger" : daysRemaining < 14 ? "warn" : "info";
    alerts.push({
      id: `coi_${c.id}`,
      source: "insurance_expiry",
      severity,
      title:
        daysRemaining < 0
          ? `Insurance lapsed — ${vessel?.name ?? "vessel"} (${boater?.display_name ?? ""})`
          : `Insurance expires in ${daysRemaining}d — ${vessel?.name ?? "vessel"}`,
      detail: `${c.carrier} policy ${c.policy_number} · liability ${
        c.liability_limit ? `$${c.liability_limit.toLocaleString()}` : "—"
      } · through ${c.effective_end}.`,
      occurred_at: c.effective_end,
      boater_id: c.boater_id,
      href: boater ? `/members/${boater.id}` : undefined,
      suggested_prompt: boater
        ? `Ask ${boater.first_name} to upload a renewed COI for ${vessel?.name ?? "their vessel"}`
        : undefined,
    });
  }
  return alerts;
}

function unansweredInbound(communications: Communication[]): Alert[] {
  // Inbound messages without a subsequent outbound from the marina to the
  // same boater = unanswered. Per-message timestamp comparison.
  const byBoater = new Map<string, Communication[]>();
  for (const c of communications) {
    const list = byBoater.get(c.boater_id) ?? [];
    list.push(c);
    byBoater.set(c.boater_id, list);
  }
  const alerts: Alert[] = [];
  for (const [boaterId, msgs] of byBoater) {
    const sorted = msgs.slice().sort((a, b) => (a.sent_at < b.sent_at ? -1 : 1));
    // Find the last inbound and see if any outbound came after
    const lastInbound = [...sorted].reverse().find((m) => m.direction === "inbound");
    if (!lastInbound) continue;
    const respondedAfter = sorted.some(
      (m) => m.direction === "outbound" && m.sent_at > lastInbound.sent_at
    );
    if (respondedAfter) continue;
    const boater = BOATERS.find((b) => b.id === boaterId);
    const ageHours = Math.round(
      (Date.now() - new Date(lastInbound.sent_at).getTime()) / 3_600_000
    );
    const severity: AlertSeverity =
      ageHours > 24 ? "warn" : "info";
    alerts.push({
      id: `inbound_${lastInbound.id}`,
      source: "unanswered_inbound",
      severity,
      title: `${boater?.display_name ?? "Boater"} message awaiting reply`,
      detail: `"${lastInbound.body_preview.slice(0, 100)}${lastInbound.body_preview.length > 100 ? "…" : ""}"`,
      occurred_at: lastInbound.sent_at,
      boater_id: boaterId,
      href: "/inbox",
      suggested_prompt: boater
        ? `Draft a reply to ${boater.first_name}`
        : undefined,
    });
  }
  return alerts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public aggregator
// ─────────────────────────────────────────────────────────────────────────────

export function buildAlerts({
  ledger,
  workOrders,
  communications,
  insurance = [],
  now = new Date(),
}: {
  ledger: LedgerEntry[];
  workOrders: WorkOrder[];
  communications: Communication[];
  insurance?: InsuranceCertificate[];
  now?: Date;
}): Alert[] {
  const all = [
    ...overduePayments(ledger, now),
    ...meterAnomalies(now),
    ...contractExpiry(now),
    ...fuelLow(now),
    ...urgentWorkOrders(workOrders),
    ...unansweredInbound(communications),
    ...insuranceExpiry(insurance, now),
  ];
  // Sort: severity (danger > warn > info), then newest first
  const rank: Record<AlertSeverity, number> = { danger: 0, warn: 1, info: 2 };
  return all.sort((a, b) => {
    if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
    return a.occurred_at < b.occurred_at ? 1 : -1;
  });
}

export const SOURCE_LABEL: Record<AlertSource, string> = {
  overdue_payment: "Overdue payment",
  meter_anomaly: "Meter anomaly",
  contract_expiry: "Contract expiry",
  fuel_low: "Fuel low",
  urgent_work_order: "Urgent / flagged WO",
  unanswered_inbound: "Awaiting reply",
  insurance_expiry: "Insurance / COI",
};

function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}
