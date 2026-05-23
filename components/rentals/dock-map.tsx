"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import {
  RENTAL_GROUPS,
  RENTAL_SPACES,
} from "@/lib/mock-data";
import type { RentalSpace, SpaceStatus } from "@/lib/types";

const STATUS_BG: Record<SpaceStatus, string> = {
  vacant: "bg-status-ok/15 text-status-ok border-status-ok/30 hover:bg-status-ok/25",
  occupied: "bg-status-danger/15 text-status-danger border-status-danger/30 hover:bg-status-danger/25",
  reserved: "bg-status-warn/15 text-status-warn border-status-warn/30 hover:bg-status-warn/25",
  out_of_service: "bg-surface-3 text-fg-tertiary border-hairline",
};

const STATUS_LABEL: Record<SpaceStatus, string> = {
  vacant: "Vacant",
  occupied: "Occupied",
  reserved: "Reserved",
  out_of_service: "Out of service",
};

export function DockMap() {
  const [filter, setFilter] = React.useState<"all" | SpaceStatus>("all");
  const [groupFilter, setGroupFilter] = React.useState<string | "all">("all");

  const groups = RENTAL_GROUPS.filter((g) => groupFilter === "all" || g.id === groupFilter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Pill label="All" active={filter === "all"} onClick={() => setFilter("all")} />
          <Pill label="Vacant" active={filter === "vacant"} onClick={() => setFilter("vacant")} dot="bg-status-ok" />
          <Pill label="Occupied" active={filter === "occupied"} onClick={() => setFilter("occupied")} dot="bg-status-danger" />
          <Pill label="Reserved" active={filter === "reserved"} onClick={() => setFilter("reserved")} dot="bg-status-warn" />
        </div>
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          className="rounded-[8px] border border-hairline bg-surface-1 px-2 py-1 text-[12px] text-fg"
          aria-label="Filter by group"
        >
          <option value="all">All groups</option>
          {RENTAL_GROUPS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-4">
        {groups.map((g) => {
          const spaces = RENTAL_SPACES.filter((s) => s.group_id === g.id).filter(
            (s) => filter === "all" || s.status === filter
          );
          if (spaces.length === 0 && filter !== "all") return null;
          const occPct = g.total_spaces ? (g.occupied_spaces / g.total_spaces) * 100 : 0;
          return (
            <div key={g.id} className="rounded-[12px] border border-hairline bg-surface-1 p-4">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h3 className="text-[14px] font-medium text-fg">{g.name}</h3>
                  <p className="text-[11px] text-fg-tertiary">
                    {g.occupied_spaces} / {g.total_spaces} occupied · check-in {g.check_in_time}
                  </p>
                </div>
                <OccupancyGauge pct={occPct} />
              </div>

              {spaces.length === 0 ? (
                <p className="px-1 py-4 text-[12px] text-fg-tertiary">
                  No spaces in this view.
                </p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(60px,1fr))] gap-1.5">
                  {spaces.map((s) => (
                    <SpaceTile key={s.id} space={s} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SpaceTile({ space }: { space: RentalSpace }) {
  return (
    <button
      type="button"
      title={`${space.number} — ${STATUS_LABEL[space.status]}`}
      className={
        "flex aspect-square flex-col items-center justify-center rounded-[6px] border text-[11px] font-medium transition-colors " +
        STATUS_BG[space.status]
      }
    >
      <span className="leading-none">{space.number}</span>
      {space.length_inches && (
        <span className="mt-0.5 text-[9px] opacity-70">{Math.round(space.length_inches / 12)}'</span>
      )}
    </button>
  );
}

function OccupancyGauge({ pct }: { pct: number }) {
  const tone = pct >= 85 ? "danger" : pct >= 60 ? "warn" : "ok";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-3">
        <div
          className={
            "h-full transition-all " +
            (tone === "danger" ? "bg-status-danger" : tone === "warn" ? "bg-status-warn" : "bg-status-ok")
          }
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="text-[11px] font-medium text-fg-muted">{Math.round(pct)}%</span>
    </div>
  );
}

function Pill({
  label,
  active,
  onClick,
  dot,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  dot?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors " +
        (active
          ? "border-primary/40 bg-primary-soft text-primary"
          : "border-hairline bg-surface-1 text-fg-muted hover:bg-surface-2")
      }
    >
      {dot && <span className={"size-1.5 rounded-full " + dot} aria-hidden />}
      {label}
    </button>
  );
}

// Re-export Badge to silence unused-warning in case this file is split later
export { Badge };
