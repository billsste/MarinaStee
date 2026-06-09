"use client";

/*
 * Occupancy by dock — table with occupied / vacant split + percent bar.
 *
 * Mock side derives from RENTAL_GROUPS + RENTAL_SPACES (the seed shape
 * that predates the Slip/Dock consolidation). Convex side reads
 * `reports.occupancyByDock` which builds the same shape from `docks` +
 * `slips`. The two return identical row shapes so the renderer is one
 * code path.
 */

import * as React from "react";
import { Anchor } from "lucide-react";
import { anyApi } from "convex/server";
import { RENTAL_GROUPS, RENTAL_SPACES } from "@/lib/mock-data";
import { useTenantQuery } from "@/lib/use-tenant-query";
import { cn } from "@/lib/utils";

export interface OccupancyRow {
  dock_id: string;
  name: string;
  total: number;
  occupied: number;
  reserved: number;
  out_of_service: number;
  vacant: number;
  occupancy_pct: number;
}

const EMPTY_ARGS = {} as const;

function computeMockOccupancy(): OccupancyRow[] {
  return RENTAL_GROUPS.map((g) => {
    const spaces = RENTAL_SPACES.filter((s) => s.group_id === g.id);
    const occupied = spaces.filter((s) => s.status === "occupied").length;
    const reserved = spaces.filter((s) => s.status === "reserved").length;
    const out_of_service = spaces.filter((s) => s.status === "out_of_service").length;
    const total = spaces.length || g.total_spaces;
    const vacant = Math.max(0, total - occupied - reserved - out_of_service);
    return {
      dock_id: g.id,
      name: g.name,
      total,
      occupied: spaces.length > 0 ? occupied : g.occupied_spaces,
      reserved,
      out_of_service,
      vacant: spaces.length > 0 ? vacant : Math.max(0, total - g.occupied_spaces),
      occupancy_pct:
        total > 0
          ? ((spaces.length > 0 ? occupied + reserved : g.occupied_spaces) / total) * 100
          : 0,
    };
  }).sort((a, b) => b.occupancy_pct - a.occupancy_pct);
}

export function OccupancyPanel() {
  const mock = React.useMemo(computeMockOccupancy, []);
  const rows = useTenantQuery<OccupancyRow[]>({
    mock,
    convexRef: anyApi.reports.occupancyByDock,
    convexArgs: EMPTY_ARGS,
  });

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
          <Anchor className="size-3.5" />
          Occupancy by dock
        </h3>
        <span className="text-[11px] text-fg-tertiary">{rows.length} dock{rows.length === 1 ? "" : "s"}</span>
      </div>
      <div className="overflow-hidden">
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{ gridTemplateColumns: "minmax(0, 1.6fr) 60px 60px 60px 1fr 70px" }}
        >
          <span>Dock</span>
          <span className="text-right">Slips</span>
          <span className="text-right">Occupied</span>
          <span className="text-right">Vacant</span>
          <span>Fill</span>
          <span className="text-right">%</span>
        </div>
        <ul className="divide-y divide-hairline">
          {rows.length === 0 ? (
            <li className="px-4 py-6 text-center text-[12px] text-fg-tertiary">
              No docks configured yet.
            </li>
          ) : (
            rows.map((r) => {
              const tone =
                r.occupancy_pct > 90
                  ? "bg-status-danger"
                  : r.occupancy_pct > 75
                    ? "bg-status-warn"
                    : r.occupancy_pct > 40
                      ? "bg-status-info"
                      : "bg-status-ok";
              return (
                <li
                  key={r.dock_id}
                  className="grid items-center gap-x-3 px-4 py-2 text-[12px]"
                  style={{ gridTemplateColumns: "minmax(0, 1.6fr) 60px 60px 60px 1fr 70px" }}
                >
                  <span className="truncate font-medium text-fg">{r.name}</span>
                  <span className="text-right tabular text-fg-subtle">{r.total}</span>
                  <span className="text-right tabular text-fg">{r.occupied + r.reserved}</span>
                  <span className="text-right tabular text-fg-subtle">{r.vacant}</span>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div className={cn("h-full transition-all", tone)} style={{ width: `${r.occupancy_pct}%` }} />
                  </div>
                  <span className="text-right tabular text-fg">{r.occupancy_pct.toFixed(0)}%</span>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
