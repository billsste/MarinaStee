"use client";

/*
 * Shared compact list for "fees attached to this entity".
 *
 * Used on:
 *   - Reservation detail (one-off slip / transient bookings)
 *   - Contract detail (annual / seasonal slip holders)
 *   - Boater Overview tab (active contract + club subscription panels)
 *
 * Pattern (per spec):
 *   - resolve fee_ids -> AdditionalFee, drop stale ids silently
 *   - group rows by cadence: one-time -> monthly -> annual
 *   - cadence chip + tabular amount column per row
 *   - bottom total row driven by totalFromAttachedFees(...)
 *
 * termMonths flows through to the roll-up helper so monthly/annual
 * fees prorate against the booking horizon.
 */

import * as React from "react";
import { Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/mock-data";
import { totalFromAttachedFees, useFees } from "@/lib/client-store";
import type { AdditionalFee } from "@/lib/types";

type Cadence = "one_time" | "monthly" | "annual";

const CADENCE_ORDER: Cadence[] = ["one_time", "monthly", "annual"];

const CADENCE_LABEL: Record<Cadence, string> = {
  one_time: "One-time",
  monthly: "Monthly",
  annual: "Annual",
};

function cadenceOf(fee: AdditionalFee): Cadence {
  return fee.cadence ?? "one_time";
}

function suffixOf(cadence: Cadence): string {
  if (cadence === "monthly") return "/mo";
  if (cadence === "annual") return "/yr";
  return "";
}

export interface AttachedFeesListProps {
  feeIds: string[];
  /**
   * Term length in months. Used by totalFromAttachedFees to prorate
   * monthly / annual fees against the booking horizon. Defaults to 1
   * for one-off surfaces (e.g. transient reservations).
   */
  termMonths?: number;
  /**
   * Optional empty-state copy. Falls back to a generic "no fees" line
   * when omitted; pass null to suppress the empty state entirely (caller
   * conditionally renders only when there are fees).
   */
  emptyText?: string | null;
  /**
   * Dense variant — slightly tighter row padding for sub-section use
   * (e.g. inside an existing Contract panel on the Overview tab).
   */
  dense?: boolean;
}

export function AttachedFeesList({
  feeIds,
  termMonths = 1,
  emptyText = "No fees attached.",
  dense = false,
}: AttachedFeesListProps) {
  // useFees() is the reactive, tenant-scoped variant. Resolving via the
  // hook (not state directly) means the panel re-renders if a fee is
  // edited or removed in the Fees Manager while this page is open.
  const fees = useFees();

  const resolved: AdditionalFee[] = React.useMemo(() => {
    const byId = new Map(fees.map((f) => [f.id, f] as const));
    const out: AdditionalFee[] = [];
    for (const id of feeIds) {
      const fee = byId.get(id);
      if (fee) out.push(fee);
    }
    return out;
  }, [feeIds, fees]);

  if (resolved.length === 0) {
    if (emptyText === null) return null;
    return (
      <p className="text-[12px] text-fg-subtle">{emptyText}</p>
    );
  }

  // Group by cadence so the UI reads one-time -> monthly -> annual.
  const groups = new Map<Cadence, AdditionalFee[]>();
  for (const fee of resolved) {
    const c = cadenceOf(fee);
    const bucket = groups.get(c);
    if (bucket) bucket.push(fee);
    else groups.set(c, [fee]);
  }

  const rollup = totalFromAttachedFees(feeIds, termMonths);

  // Render the "$X one-time + $Y/month" headline. Only show the parts
  // that have a value so a one-time-only stack reads "$1,275 one-time".
  const headlineParts: string[] = [];
  if (rollup.oneTime > 0) {
    headlineParts.push(`${formatMoney(rollup.oneTime)} one-time`);
  }
  if (rollup.monthly > 0) {
    // monthly bucket from the helper is already term-multiplied; back
    // it out to a per-month figure for the headline, which reads
    // better than the prorated total.
    const perMonth = termMonths > 0 ? rollup.monthly / termMonths : rollup.monthly;
    headlineParts.push(`${formatMoney(perMonth)}/month`);
  }
  if (rollup.annual > 0) {
    // The helper prorates annual to (amount/12)*termMonths. Back into
    // the per-year figure for the headline so staff see what the fee
    // catalog says, not the prorated charge.
    const perYear = termMonths > 0 ? (rollup.annual * 12) / termMonths : rollup.annual;
    headlineParts.push(`${formatMoney(perYear)}/year`);
  }
  const headline = headlineParts.join(" + ");

  const rowPad = dense ? "py-1" : "py-1.5";

  return (
    <div className="space-y-2">
      {CADENCE_ORDER.flatMap((cadence) => {
        const bucket = groups.get(cadence);
        if (!bucket || bucket.length === 0) return [];
        return [
          <div key={cadence}>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-fg-tertiary">
              <Badge tone="outline" size="sm">
                {CADENCE_LABEL[cadence]}
              </Badge>
              <span>
                {bucket.length} {bucket.length === 1 ? "fee" : "fees"}
              </span>
            </div>
            <ul className="divide-y divide-hairline rounded-[8px] border border-hairline bg-surface-1">
              {bucket.map((fee) => (
                <li
                  key={fee.id}
                  className={`flex items-center justify-between gap-3 px-3 ${rowPad} text-[12px]`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-fg">{fee.name}</div>
                    {fee.description && (
                      <div className="truncate text-[11px] text-fg-tertiary">
                        {fee.description}
                      </div>
                    )}
                  </div>
                  <div className="tabular shrink-0 text-fg">
                    {formatMoney(fee.amount)}
                    <span className="text-fg-tertiary">{suffixOf(cadence)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>,
        ];
      })}

      {/* Roll-up footer */}
      <div className="flex items-center justify-between gap-3 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[12px]">
        <div className="inline-flex items-center gap-1.5 text-fg-subtle">
          <Receipt className="size-3.5" />
          <span>Total {termMonths > 1 ? `over ${termMonths} months` : ""}</span>
        </div>
        <div className="text-right">
          <div className="tabular text-[13px] font-medium text-fg">
            {formatMoney(rollup.total)}
          </div>
          {headline && (
            <div className="text-[11px] text-fg-tertiary">{headline}</div>
          )}
        </div>
      </div>
    </div>
  );
}
