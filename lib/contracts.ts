// Canonical contract-status helpers.
//
// This module is the single source of truth for "is this contract live?",
// "is it terminal?", and "is its end date close enough to flag for
// renewal?". Every consumer (boater list, rentals roster, contracts KPI,
// reports portfolio section, agent /query_contract_expiry tool, …) should
// import from here instead of hand-rolling the status sets and date math
// — that's how the 60-day vs 90-day, `=== "active"` vs `LIVE_*.has(...)`
// drift bugs crept in.
//
// Date math: every classifier takes pre-computed local-ISO YYYY-MM-DD
// strings (today + the cutoff) and compares them as strings. That avoids
// the `new Date("YYYY-MM-DD")` UTC-midnight footgun — `effective_end` is
// stored as a calendar date with no time-of-day, so a timezone-aware
// getTime() compare drifts by up to a day at the boundary. Callers in a
// render hot-path should compute today + cutoff ONCE per render and pass
// them down (don't recompute per row).

import type { Contract, ContractStatus } from "@/lib/types";

// Live (in-force or in-flight) contract statuses. A contract in any of
// these is currently "the contract" for its boater/slip — surfaces in
// slip-holder pickers, roster rows, KPI counters, and renewal pipelines.
// `draft` is included because the boater-list classifier treats it as
// live-ish (a contract on file, just not signed yet). Use the narrower
// `SIGNED_OR_SENT_CONTRACT_STATUSES` below when you only want signature-
// ready or signed contracts (e.g. slip-holder eligibility for the rental
// club picker).
export const LIVE_CONTRACT_STATUSES: ReadonlySet<ContractStatus> = new Set<
  ContractStatus
>(["active", "executed", "partially_signed", "sent", "draft"]);

// Narrower variant — excludes `draft`. Use this when the question is
// "is this contract real enough to count as a slip-holder?" rather than
// "does this boater have any contract in flight?". Today the rental-club
// picker and the new-club-holder wizard use this narrower set; the
// boater-list uses the broader LIVE_CONTRACT_STATUSES via classify*.
export const SIGNED_OR_SENT_CONTRACT_STATUSES: ReadonlySet<ContractStatus> =
  new Set<ContractStatus>([
    "active",
    "executed",
    "partially_signed",
    "sent",
  ]);

// Terminal — the contract is no longer in force. Drives the boater-list
// "Lapsed" fallback (when there's no live contract) and the bulk-renewal
// "skip if successor exists" logic. `renewed` is included so a boater
// whose contract was renewed into a successor doesn't accidentally count
// as still-live.
export const TERMINAL_CONTRACT_STATUSES: ReadonlySet<ContractStatus> =
  new Set<ContractStatus>(["expired", "terminated", "renewed"]);

// Live-contract ranking when one boater has multiple — `active` wins
// over `executed`, etc. Used by boater-list's liveContractByBoaterId
// reducer to surface the most-real contract for a holder. Exported here
// (not just inside boater-list) so any other consumer with the same
// pick-the-best-live-contract problem can reuse the priorities instead
// of re-deciding them.
export const LIVE_CONTRACT_PRIORITY: Readonly<Record<ContractStatus, number>> =
  {
    active: 5,
    executed: 4,
    partially_signed: 3,
    sent: 2,
    draft: 1,
    // Terminal statuses get 0 — they aren't live and shouldn't win.
    expired: 0,
    terminated: 0,
    renewed: 0,
  };

// 90 days in ms. The canonical "renewal window" used by the Contracts KPI
// card, the Rentals roster, the Reports portfolio section, the Boaters
// expiring-soon chip, and the agent's default `query_contract_expiry`
// window. Keep this as the default — use `isExpiringWithin` with a custom
// cutoff for the rare 60/180-day variants.
export const EXPIRING_SOON_WINDOW_MS = 90 * 86_400_000;

export function isLiveContract(c: Contract): boolean {
  return LIVE_CONTRACT_STATUSES.has(c.status);
}

export function isTerminalContract(c: Contract): boolean {
  return TERMINAL_CONTRACT_STATUSES.has(c.status);
}

// Classify a contract's effective state given pre-computed local ISO
// dates (YYYY-MM-DD). Pass-in-the-cutoff signature so the caller owns
// timezone choice (local-day vs UTC-day) and so day-rollover is a
// single re-render at the call site.
//
// Returns:
//   "lapsed"   — effective_end is on or before today
//   "expiring" — effective_end is within the 90-day window
//   "active"   — live status, ends later than 90 days out
//   null       — contract is in a non-live status (terminated/renewed/
//                expired) OR has no effective_end. Caller picks
//                "pending" / "vacant" / "past_due" overlays from there.
export function classifyContractStatus(
  c: Contract,
  todayIso: string,
  ninetyDaysOutIso: string,
): "active" | "expiring" | "lapsed" | null {
  if (!isLiveContract(c) || !c.effective_end) return null;
  if (c.effective_end <= todayIso) return "lapsed";
  if (c.effective_end <= ninetyDaysOutIso) return "expiring";
  return "active";
}

// Parameterized window helper for the agent's `query_contract_expiry`
// tool + reports' 60/180-day buckets. Same ISO-string semantics as
// classifyContractStatus — caller pre-computes today + cutoff so the
// helper is allocation-free and timezone-stable. Returns true when the
// contract is live AND effective_end > today AND effective_end <= cutoff.
export function isExpiringWithin(
  c: Contract,
  todayIso: string,
  cutoffIso: string,
): boolean {
  if (!isLiveContract(c) || !c.effective_end) return false;
  return c.effective_end > todayIso && c.effective_end <= cutoffIso;
}

// Local YYYY-MM-DD. Avoids the `new Date("YYYY-MM-DD")` UTC-midnight
// footgun (which shifts contracts by up to a day in non-UTC timezones).
// Promoted here from boater-list.tsx so every caller of the classifiers
// computes today the same way.
export function localIsoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
