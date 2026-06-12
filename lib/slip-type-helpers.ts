/*
 * Slip Type resolver + pricing inheritance.
 *
 * Slips can either reference a SlipType explicitly (Slip.type_id) or
 * let the system derive their tier from (slip_class, max_loa_inches).
 * That dual mode means existing slip data Just Works without an
 * explicit binding pass, and operators only need to override the
 * rare special-case slip.
 *
 * Pricing inheritance follows the chain:
 *   slip.default_*_rate  (per-slip override)
 *     → type.default_*_rate  (type default)
 *       → undefined           (unset — caller handles gracefully)
 *
 * Used by:
 *   - components/services/slip-types-view.tsx   (CRUD page)
 *   - assign-slip-client + new-reservation-sheet (auto-fee attach + pricing pre-fill)
 *   - components/services/waitlist-section.tsx   (class segment chips, match filter)
 *   - reports that aggregate by class / type
 */

import { SLIP_TYPES } from "@/lib/mock-data";
import type { Slip, SlipClass, SlipType } from "@/lib/types";

/**
 * Resolve the SlipType for a given Slip. Returns the explicitly-bound
 * type when `Slip.type_id` is set; otherwise derives from class + size
 * (the first matching type by sort_order whose class equals the
 * slip's class and whose size band contains the slip's max_loa_inches).
 *
 * Returns undefined when no matching type exists — caller should
 * gracefully degrade to the per-slip pricing fields.
 */
export function resolveSlipType(
  slip: Slip,
  allTypes: readonly SlipType[] = SLIP_TYPES,
): SlipType | undefined {
  // Explicit override wins.
  if (slip.type_id) {
    const explicit = allTypes.find((t) => t.id === slip.type_id);
    if (explicit) return explicit;
    // Bound to a deleted/inactive type — fall through to derive
    // rather than show no tier.
  }

  // Derived match — class + size band.
  const candidates = allTypes
    .filter((t) => t.class === slip.slip_class && t.active)
    .sort((a, b) => a.sort_order - b.sort_order);

  for (const t of candidates) {
    const aboveMin = t.min_loa_inches == null || slip.max_loa_inches >= t.min_loa_inches;
    const belowMax = slip.max_loa_inches <= t.max_loa_inches;
    if (aboveMin && belowMax) return t;
  }

  // Fallback: any active type in this class — better to show the
  // wrong tier than no tier.
  return candidates[0];
}

/**
 * Effective rate for a slip + cadence. Per-slip override wins; falls
 * back to the type default; returns undefined when neither is set.
 */
export function effectiveSlipRate(
  slip: Slip,
  cadence: "annual" | "monthly" | "seasonal" | "transient",
  allTypes: readonly SlipType[] = SLIP_TYPES,
): number | undefined {
  if (cadence === "annual") {
    if (slip.default_annual_rate != null) return slip.default_annual_rate;
    const t = resolveSlipType(slip, allTypes);
    return t?.default_annual_rate;
  }
  if (cadence === "monthly") {
    if (slip.default_monthly_rate != null) return slip.default_monthly_rate;
    const t = resolveSlipType(slip, allTypes);
    return t?.default_monthly_rate;
  }
  if (cadence === "seasonal") {
    if (slip.default_seasonal_rate != null) return slip.default_seasonal_rate;
    const t = resolveSlipType(slip, allTypes);
    return t?.default_seasonal_rate;
  }
  // transient — no per-slip override field today; type default is the
  // source of truth.
  const t = resolveSlipType(slip, allTypes);
  return t?.default_transient_rate_per_night;
}

/**
 * Fee ids that should auto-attach to a new reservation on this slip,
 * derived from the slip's type. Caller appends to the reservation's
 * attached_fee_ids; the operator can still remove specific fees.
 */
export function includedFeesForSlip(
  slip: Slip,
  allTypes: readonly SlipType[] = SLIP_TYPES,
): string[] {
  const t = resolveSlipType(slip, allTypes);
  return t?.included_fee_ids ?? [];
}

/**
 * Group slips by their resolved type — used by the Slip Types page to
 * show "this tier has N slips" + by the waitlist's class segment
 * chips to compute counts per class.
 *
 * Returns a Map keyed by SlipType.id (with `_unsorted` bucket for
 * slips that couldn't resolve to any type).
 */
export function groupSlipsByType(
  slips: readonly Slip[],
  allTypes: readonly SlipType[] = SLIP_TYPES,
): Map<string, Slip[]> {
  const out = new Map<string, Slip[]>();
  for (const s of slips) {
    const t = resolveSlipType(s, allTypes);
    const key = t?.id ?? "_unsorted";
    const arr = out.get(key);
    if (arr) arr.push(s);
    else out.set(key, [s]);
  }
  return out;
}

/**
 * Slip count per slip class (resolved via the same logic).
 * Used by the waitlist segment chips to show e.g. "Covered · 12 slips"
 * so the operator can see inventory depth alongside applicant queue.
 */
export function slipCountByClass(
  slips: readonly Slip[],
): Record<SlipClass, number> {
  const out: Record<SlipClass, number> = {
    covered: 0,
    uncovered: 0,
    t_head: 0,
    buoy: 0,
    dry_storage: 0,
  };
  for (const s of slips) out[s.slip_class]++;
  return out;
}
