"use client";

/*
 * Fleet utilization (last 14 days) — per rental boat:
 *   - daily booking sparkline (0/1 per day)
 *   - utilization % bar
 *   - highlights for underused (<40%) and overused (>85%)
 *
 * Surfaces the boats the marina should retire, reallocate, or buy more
 * of. Underused boats are a margin drag; overused ones are a revenue
 * ceiling waiting to be raised (or a sign to add capacity).
 */

import * as React from "react";
import { Ship } from "lucide-react";
import { anyApi } from "convex/server";
import { useBoatRentals, useRentalBoats } from "@/lib/client-store";
import { localIsoDate } from "@/lib/contracts";
import { useTenantQuery } from "@/lib/use-tenant-query";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";

export interface FleetUtilizationRow {
  boat_id: string;
  name: string;
  type: string;
  daily: number[];
  pct: number;
}

const EMPTY_ARGS = {} as const;

export function FleetUtilizationPanel() {
  const boats = useRentalBoats();
  const rentals = useBoatRentals();

  const mock = React.useMemo<FleetUtilizationRow[]>(() => {
    const today = new Date();
    const window: string[] = [];
    for (let i = 13; i >= 0; i -= 1) {
      window.push(localIsoDate(new Date(today.getTime() - i * 86_400_000)));
    }
    return boats.map((b) => {
      const days = window.map((iso) => {
        const booked = rentals.some(
          (r) =>
            r.boat_id === b.id &&
            r.status !== "cancelled" &&
            r.status !== "no_show" &&
            r.start_at.slice(0, 10) <= iso &&
            r.end_at.slice(0, 10) >= iso,
        );
        return booked ? 1 : 0;
      });
      const sum = days.reduce<number>((a, n) => a + n, 0);
      return {
        boat_id: b.id,
        name: b.name,
        type: b.type,
        daily: days,
        pct: days.length > 0 ? (sum / days.length) * 100 : 0,
      };
    });
  }, [boats, rentals]);

  const rows = useTenantQuery<FleetUtilizationRow[]>({
    mock,
    convexRef: anyApi.reports.fleetUtilizationDaily,
    convexArgs: EMPTY_ARGS,
  });

  const sorted = React.useMemo(() => [...rows].sort((a, b) => b.pct - a.pct), [rows]);
  const overused = sorted.filter((r) => r.pct > 85).length;
  const underused = sorted.filter((r) => r.pct < 40).length;

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
          <Ship className="size-3.5" />
          Fleet utilization · last 14d
        </h3>
        <span className="text-[11px] text-fg-tertiary">
          {overused} hot · {underused} cold
        </span>
      </div>
      <div className="overflow-hidden">
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{ gridTemplateColumns: "minmax(0, 1.6fr) 90px 1fr 60px" }}
        >
          <span>Boat</span>
          <span>Trend</span>
          <span>Utilization</span>
          <span className="text-right">%</span>
        </div>
        <ul className="divide-y divide-hairline">
          {sorted.length === 0 ? (
            <li className="px-4 py-6 text-center text-[12px] text-fg-tertiary">
              No rental fleet on file.
            </li>
          ) : (
            sorted.map((r) => {
              const isHot = r.pct > 85;
              const isCold = r.pct < 40;
              const tone = isHot
                ? "var(--status-danger)"
                : isCold
                  ? "var(--status-warn)"
                  : "var(--primary)";
              const barTone = isHot
                ? "bg-status-danger"
                : isCold
                  ? "bg-status-warn"
                  : "bg-primary";
              return (
                <li
                  key={r.boat_id}
                  className="grid items-center gap-x-3 px-4 py-2 text-[12px]"
                  style={{ gridTemplateColumns: "minmax(0, 1.6fr) 90px 1fr 60px" }}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-fg">{r.name}</div>
                    <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
                      {r.type.replace("_", " ")}
                    </div>
                  </div>
                  <Sparkline
                    data={r.daily}
                    width={80}
                    height={24}
                    tone={tone}
                    title={`${r.pct.toFixed(0)}% utilization over 14 days`}
                  />
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div
                      className={cn("h-full transition-all", barTone)}
                      style={{ width: `${r.pct}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      "text-right tabular",
                      isHot ? "text-status-danger" : isCold ? "text-status-warn" : "text-fg",
                    )}
                  >
                    {r.pct.toFixed(0)}%
                  </span>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
