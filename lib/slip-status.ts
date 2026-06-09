/*
 * Canonical slip-status derivation.
 *
 * Three different places used to roll their own "which slips are
 * occupied / lapsed" logic from CONTRACTS:
 *   - components/services/waitlist-applicant-sheet.tsx (occupiedSlipIds)
 *   - lib/agent-reports.ts → reportOccupancyByDock (lapsedSlipIds)
 *   - lib/agent-reports.ts → reportLapsedAccounts (lapsedSpaces)
 *
 * Each one had a slightly different status-exclusion set:
 *   - sheet excluded 'terminated' only
 *   - occupancy excluded 'terminated' only (computed lapsed via classify)
 *   - lapsed excluded 'terminated' only (computed lapsed via classify)
 *
 * Translation: 'expired' and 'renewed' contracts were treated as live
 * by the sheet's "occupied" filter (incorrectly — those are terminal
 * states), which meant the wizard could show a slip as "taken" when
 * the agent's occupancy report knew it was vacant.
 *
 * This helper is the single source of truth. Every consumer calls in
 * here — sheet, reports, future renewal pipeline, anything else.
 *
 * Server-safe (no "use client") so reports can import directly. The
 * React hook wrapper lives in lib/client-store.ts.
 */

import {
  EXPIRING_SOON_WINDOW_MS,
  classifyContractStatus,
  localIsoDate,
} from "@/lib/contracts";
import type { Contract } from "@/lib/types";

/**
 * Terminal contract statuses — slip is effectively vacant from these.
 * The remaining live statuses (active, executed, sent, partially_signed,
 * draft) all occupy the slip.
 */
const TERMINAL_STATUSES: ReadonlySet<Contract["status"]> = new Set([
  "terminated",
  "expired",
  "renewed",
]);

export interface SlipStatusResult {
  /** slip_id → true when a live contract holds the slip. */
  occupiedSlipIds: Set<string>;
  /** slip_id → true when the live contract has run past effective_end. */
  lapsedSlipIds: Set<string>;
  /** slip_id → boater_id of the holder of record (live contracts only). */
  slipToBoater: Map<string, string>;
}

/**
 * Single pass over the contracts array. Callers pass either the live
 * store slice (via the useSlipStatus hook) or the static CONTRACTS
 * import (for server-side reports).
 *
 * `today` + `ninetyDaysOut` are pluggable so reports doing windowed
 * "as of this date" math can override. Defaults match the operator
 * roster view's day-rollover logic.
 */
export function deriveSlipStatus(
  contracts: readonly Contract[],
  options: { today?: string; ninetyDaysOut?: string } = {},
): SlipStatusResult {
  const today = options.today ?? localIsoDate();
  const ninetyDaysOut =
    options.ninetyDaysOut ??
    localIsoDate(new Date(Date.now() + EXPIRING_SOON_WINDOW_MS));

  const occupiedSlipIds = new Set<string>();
  const lapsedSlipIds = new Set<string>();
  const slipToBoater = new Map<string, string>();

  for (const c of contracts) {
    if (!c.slip_id) continue;
    if (TERMINAL_STATUSES.has(c.status)) continue;

    occupiedSlipIds.add(c.slip_id);
    slipToBoater.set(c.slip_id, c.boater_id);

    const cls = classifyContractStatus(c, today, ninetyDaysOut);
    if (cls === "lapsed") lapsedSlipIds.add(c.slip_id);
  }

  return { occupiedSlipIds, lapsedSlipIds, slipToBoater };
}
