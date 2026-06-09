// Canonical COI (Certificate of Insurance) lifecycle helpers.
//
// Mirrors the shape of lib/contracts.ts `classifyContractStatus`: a pure,
// allocation-free function that takes a pre-computed `todayIso`
// (YYYY-MM-DD) and the certificate, and returns one of the cliff
// buckets. Callers in render hot-paths compute `todayIso` ONCE per
// render (`localIsoDate()`) and pass it down per row.
//
// The 90/60/30 day cliffs are the canonical operator-facing reminder
// cadence for boater insurance renewals — most marinas chase a renewal
// at 90 days out, escalate at 60, and treat 30 as "must have hands on
// it now or the boater is out of compliance."
//
// We compare effective_end as a YYYY-MM-DD STRING against today + the
// 30/60/90-day cutoff strings to avoid the `new Date("YYYY-MM-DD")`
// UTC-midnight footgun — same pattern used by classifyContractStatus.

import type { InsuranceCertificate } from "@/lib/types";

/** Day in ms — local constant so the cutoff computation is obvious. */
const DAY_MS = 86_400_000;

export const COI_EXPIRING_90_DAYS = 90;
export const COI_EXPIRING_60_DAYS = 60;
export const COI_EXPIRING_30_DAYS = 30;

export type CoiStatus =
  | "active"
  | "expiring_90"
  | "expiring_60"
  | "expiring_30"
  | "expired";

/**
 * Bucket a COI into its renewal-cliff status given a pre-computed
 * local-ISO `todayIso` (YYYY-MM-DD).
 *
 * Returns null when the cert has no expiry on file (defensive — every
 * real seed/Convex row carries `effective_end`, but the mock store
 * tolerates undefined for legacy rows).
 *
 * Bucket semantics:
 *   - expired       : effective_end on or before today
 *   - expiring_30   : ends within the next 30 days
 *   - expiring_60   : 31..60 days out
 *   - expiring_90   : 61..90 days out
 *   - active        : ends more than 90 days out
 *
 * The cliffs are computed once per call from `todayIso` so callers
 * don't have to pass three cutoff strings. If you're rendering 100s
 * of COIs in a list and want to be allocation-free, compute the
 * cutoffs once in the parent and inline this branch — but for normal
 * scale the per-row cost is negligible.
 */
export function classifyCoiStatus(
  c: InsuranceCertificate,
  todayIso: string,
): CoiStatus | null {
  if (!c.effective_end) return null;
  if (c.effective_end <= todayIso) return "expired";

  const today = new Date(`${todayIso}T00:00:00`);
  const cliff30 = isoFromDate(new Date(today.getTime() + COI_EXPIRING_30_DAYS * DAY_MS));
  const cliff60 = isoFromDate(new Date(today.getTime() + COI_EXPIRING_60_DAYS * DAY_MS));
  const cliff90 = isoFromDate(new Date(today.getTime() + COI_EXPIRING_90_DAYS * DAY_MS));

  if (c.effective_end <= cliff30) return "expiring_30";
  if (c.effective_end <= cliff60) return "expiring_60";
  if (c.effective_end <= cliff90) return "expiring_90";
  return "active";
}

/**
 * The set of statuses an operator dashboard surfaces in its "needs
 * attention" pile. Active certs intentionally excluded — they're not
 * actionable until they cross the 90-day cliff.
 */
export const COI_NEEDS_ATTENTION_STATUSES: ReadonlySet<CoiStatus> = new Set<CoiStatus>([
  "expiring_90",
  "expiring_60",
  "expiring_30",
  "expired",
]);

export function isCoiNeedsAttention(status: CoiStatus | null): boolean {
  return status !== null && COI_NEEDS_ATTENTION_STATUSES.has(status);
}

/**
 * Human-readable label for a status bucket. Kept here so the chip in
 * the operator surface and the badge in the holder portal can't drift
 * out of sync.
 */
export function coiStatusLabel(status: CoiStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "expiring_90":
      return "Expiring · 90d";
    case "expiring_60":
      return "Expiring · 60d";
    case "expiring_30":
      return "Expiring · 30d";
    case "expired":
      return "Expired";
  }
}

/**
 * Status → status-token tone mapping. Mirrors what the rest of the app
 * does with Badge tones (`text-status-warn` etc.).
 */
export function coiStatusTone(status: CoiStatus): "ok" | "warn" | "danger" | "neutral" {
  if (status === "active") return "ok";
  if (status === "expired") return "danger";
  // All three expiring cliffs are warn — the cliff label conveys urgency.
  return "warn";
}

/** YYYY-MM-DD from a Date in local time. Inlined to avoid a hot-path import. */
function isoFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
