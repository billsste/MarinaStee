"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import {
  useRentalGroups,
  useRentalSpaces,
} from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { RentalGroup, RentalSpace, SpaceStatus } from "@/lib/types";

/*
 * Dock map renderer.
 *
 * Slip-type groups render as a two-sided finger pier: port row above the
 * pier line, starboard row below. Numbering convention assumes odd
 * numbers are port, even are starboard — which matches most US marinas.
 * Groups that don't have a clear odd/even split fall back to a sequential
 * top-row/bottom-row split.
 *
 * Non-slip groups (buoy fields, jet-ski racks, dry storage) render as
 * a uniform grid — their layout is closer to inventory than to a dock.
 */

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

const FINGER_PIER_TYPES = new Set(["slips", "mooring"]);

export function DockMap() {
  const allGroups = useRentalGroups();
  const allSpaces = useRentalSpaces();
  const [filter, setFilter] = React.useState<"all" | SpaceStatus>("all");
  const [groupFilter, setGroupFilter] = React.useState<string | "all">("all");

  const groups = allGroups.filter((g) => groupFilter === "all" || g.id === groupFilter);

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
          {allGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-4">
        {groups.map((g) => {
          const spaces = allSpaces
            .filter((s) => s.group_id === g.id)
            .filter((s) => filter === "all" || s.status === filter);
          if (spaces.length === 0 && filter !== "all") return null;
          const total = allSpaces.filter((s) => s.group_id === g.id).length;
          const occupied = allSpaces.filter((s) => s.group_id === g.id && s.status === "occupied").length;
          const occPct = total ? (occupied / total) * 100 : 0;
          const usePier = FINGER_PIER_TYPES.has(g.type);
          return (
            <div key={g.id} className="rounded-[12px] border border-hairline bg-surface-1 p-4">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h3 className="text-[14px] font-medium text-fg">{g.name}</h3>
                  <p className="text-[11px] text-fg-tertiary">
                    {occupied} / {total} occupied · check-in {g.check_in_time}
                  </p>
                </div>
                <OccupancyGauge pct={occPct} />
              </div>

              {spaces.length === 0 ? (
                <p className="px-1 py-4 text-[12px] text-fg-tertiary">No spaces in this view.</p>
              ) : usePier ? (
                <FingerPier group={g} spaces={spaces} />
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

      <p className="text-[11px] text-fg-tertiary">
        <Badge tone="primary" size="sm">v0.1 finger pier</Badge>{" "}
        Slip groups split into port (top) / starboard (bottom) by odd/even number. Future iteration:
        per-group layout config (T-heads, fairways, buoy positions on a map).
      </p>
    </div>
  );
}

function FingerPier({ group, spaces }: { group: RentalGroup; spaces: RentalSpace[] }) {
  // Sort by numeric slip number. If numbers parse cleanly, split by parity
  // (odd=port, even=starboard — most US marinas). Otherwise split in half
  // sequentially (top row = first half, bottom row = second half).
  const parsed = spaces.map((s) => ({ s, n: Number(s.number) }));
  const hasNumeric = parsed.every((p) => Number.isFinite(p.n));
  let port: RentalSpace[] = [];
  let starboard: RentalSpace[] = [];

  if (hasNumeric) {
    const sorted = [...parsed].sort((a, b) => a.n - b.n);
    port = sorted.filter((p) => p.n % 2 === 1).map((p) => p.s);
    starboard = sorted.filter((p) => p.n % 2 === 0).map((p) => p.s);
  } else {
    const half = Math.ceil(spaces.length / 2);
    port = spaces.slice(0, half);
    starboard = spaces.slice(half);
  }

  return (
    <div className="overflow-x-auto pb-1">
      <div className="inline-flex flex-col gap-1 min-w-full">
        {/* Port (top) row */}
        <div className="flex gap-1">
          {port.length === 0 && <div className="text-[11px] italic text-fg-tertiary px-1 py-2">port: —</div>}
          {port.map((s) => (
            <SpaceTile key={s.id} space={s} compact />
          ))}
        </div>

        {/* Pier walkway */}
        <div className="flex h-3 items-center gap-2 px-1">
          <div className="h-px flex-1 bg-fg-tertiary/40" />
          <span className="text-[9px] uppercase tracking-wider text-fg-tertiary">
            {group.name.replace(/Dock|dock/, "").trim() || "Pier"} ▸ walkway
          </span>
          <div className="h-px flex-1 bg-fg-tertiary/40" />
        </div>

        {/* Starboard (bottom) row */}
        <div className="flex gap-1">
          {starboard.length === 0 && <div className="text-[11px] italic text-fg-tertiary px-1 py-2">starboard: —</div>}
          {starboard.map((s) => (
            <SpaceTile key={s.id} space={s} compact />
          ))}
        </div>
      </div>
    </div>
  );
}

function SpaceTile({ space, compact }: { space: RentalSpace; compact?: boolean }) {
  return (
    <button
      type="button"
      title={`${space.number} — ${STATUS_LABEL[space.status]}`}
      className={cn(
        "flex flex-col items-center justify-center rounded-[6px] border text-[11px] font-medium transition-colors",
        STATUS_BG[space.status],
        compact ? "h-12 min-w-[44px] px-1.5" : "aspect-square"
      )}
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
