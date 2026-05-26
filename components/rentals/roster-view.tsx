"use client";

import * as React from "react";
import Link from "next/link";
import { Search, Sparkles, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SpacesToolbar } from "@/components/rentals/spaces-toolbar";
import { NewContractSheet } from "@/components/financials/new-contract-sheet";
import {
  BOATERS,
  SLIPS,
  VESSELS,
  formatMoney,
} from "@/lib/mock-data";
import { useContracts, useReservations } from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { Boater, Contract, Reservation, Slip, Vessel } from "@/lib/types";

/*
 * Slip roster — the harbormaster's "who occupies every slip this season"
 * view. For an annual-holder-heavy marina (90% case) this is the morning
 * screen, not arrivals/departures.
 *
 * Row = one slip in SLIPS. Joined to:
 *   - active Contract (by slip_id) → tenure + rate + expiry
 *   - Boater (contract.boater_id) → holder name + cadence
 *   - Vessel (contract.vessel_id) → boat name + LOA
 *
 * Filters AND together. Search hits slip number, holder name, vessel name.
 */

type CadenceFilter = "all" | "annual" | "seasonal" | "monthly" | "transient";
type StatusFilter = "all" | "active" | "expiring" | "lapsed" | "vacant";

type Row = {
  slip: Slip;
  contract?: Contract;
  boater?: Boater;
  vessel?: Vessel;
  reservation?: Reservation;
  // Derived
  rowStatus: "active" | "expiring" | "lapsed" | "vacant";
  daysUntilExpiry: number | null; // null when vacant
};

// "Expiring" = active contract with effective_end <= 90 days out
const EXPIRY_WINDOW_DAYS = 90;

export function RosterView() {
  const contracts = useContracts();
  const reservations = useReservations();

  const docks = React.useMemo(
    () => Array.from(new Set(SLIPS.map((s) => s.dock))).sort(),
    []
  );

  const [dock, setDock] = React.useState<string>("all");
  const [cadence, setCadence] = React.useState<CadenceFilter>("all");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [query, setQuery] = React.useState("");
  // Vacant slips become "assign" actions — clicking opens the contract
  // dialog pre-seeded with the slip id so staff can claim it in one shot.
  const [assignSlipId, setAssignSlipId] = React.useState<string | null>(null);

  // Build joined rows once per change
  const rows: Row[] = React.useMemo(() => {
    const now = Date.now();
    return SLIPS.map((slip) => {
      // Most recent ACTIVE or LAPSED contract for this slip
      const slipContracts = contracts
        .filter((c) => c.slip_id === slip.id)
        .sort((a, b) => (a.effective_end < b.effective_end ? 1 : -1));
      const contract = slipContracts[0];
      const boater = contract
        ? BOATERS.find((b) => b.id === contract.boater_id)
        : undefined;
      const vessel = contract?.vessel_id
        ? VESSELS.find((v) => v.id === contract.vessel_id)
        : undefined;
      const reservation = reservations.find(
        (r) => r.slip_id === slip.id && r.status === "occupied"
      );

      let rowStatus: Row["rowStatus"] = "vacant";
      let daysUntilExpiry: number | null = null;
      if (contract) {
        const end = new Date(contract.effective_end).getTime();
        daysUntilExpiry = Math.round((end - now) / 86_400_000);
        if (contract.status === "expired" || daysUntilExpiry < 0) {
          rowStatus = "lapsed";
        } else if (daysUntilExpiry <= EXPIRY_WINDOW_DAYS) {
          rowStatus = "expiring";
        } else {
          rowStatus = "active";
        }
      }
      return { slip, contract, boater, vessel, reservation, rowStatus, daysUntilExpiry };
    });
  }, [contracts, reservations]);

  // Apply filters
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (dock !== "all" && r.slip.dock !== dock) return false;
      if (cadence !== "all" && r.boater?.billing_cadence !== cadence) {
        // vacant slips have no cadence — they only match when filter is "all"
        return false;
      }
      if (status !== "all" && r.rowStatus !== status) return false;
      if (q) {
        const hit =
          r.slip.id.toLowerCase().includes(q) ||
          (r.boater?.display_name.toLowerCase().includes(q) ?? false) ||
          (r.vessel?.name.toLowerCase().includes(q) ?? false);
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, dock, cadence, status, query]);

  // Counts for filter chips
  const counts = React.useMemo(() => {
    const c = { active: 0, expiring: 0, lapsed: 0, vacant: 0 };
    for (const r of rows) c[r.rowStatus] += 1;
    return c;
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* Day-pass toolbar (kept above the roster for walk-up flow) */}
      <SpacesToolbar />

      {/* Filter row */}
      <div className="space-y-2 rounded-[12px] border border-hairline bg-surface-1 p-3">
        {/* Search + dock + cadence */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Slip, holder, or vessel…"
              className="w-full rounded-[8px] border border-hairline bg-surface-2 py-1.5 pl-8 pr-3 text-[12px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
            />
          </div>
          <Seg
            label="Dock"
            value={dock}
            options={[{ value: "all", label: "All" }, ...docks.map((d) => ({ value: d, label: shortenDock(d) }))]}
            onChange={setDock}
          />
          <Seg
            label="Cadence"
            value={cadence}
            options={[
              { value: "all", label: "All" },
              { value: "annual", label: "Annual" },
              { value: "seasonal", label: "Seasonal" },
              { value: "monthly", label: "Monthly" },
              { value: "transient", label: "Transient" },
            ]}
            onChange={(v) => setCadence(v as CadenceFilter)}
          />
        </div>
        {/* Status chips with counts */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-fg-tertiary">Status:</span>
          {(
            [
              { v: "all", label: `All · ${rows.length}` },
              { v: "active", label: `Active · ${counts.active}` },
              { v: "expiring", label: `Expiring · ${counts.expiring}` },
              { v: "lapsed", label: `Lapsed · ${counts.lapsed}` },
              { v: "vacant", label: `Vacant · ${counts.vacant}` },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setStatus(o.v as StatusFilter)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                status === o.v
                  ? "border-primary/40 bg-primary-soft text-primary"
                  : "border-hairline bg-surface-1 text-fg-muted hover:bg-surface-2"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Roster table */}
      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div className="grid grid-cols-[64px_minmax(0,1.6fr)_minmax(0,1.5fr)_minmax(0,1.1fr)_88px_minmax(0,1.2fr)_96px_120px] gap-3 border-b border-hairline bg-surface-2 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
          <span>Slip</span>
          <span>Holder</span>
          <span>Vessel</span>
          <span>Cadence</span>
          <span className="text-right">Rate</span>
          <span>Through</span>
          <span className="text-right">Days</span>
          <span>Status</span>
        </div>
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-fg-subtle">
            No slips match these filters.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {filtered.map((r) => (
              <RosterRow
                key={r.slip.id}
                row={r}
                onAssign={() => setAssignSlipId(r.slip.id)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between text-[11px] text-fg-tertiary">
        <span>
          {filtered.length} of {rows.length} slips
        </span>
        <span>
          <Badge tone="primary" size="sm">Agent</Badge>{" "}
          Try: "Show me everyone expiring in the next 60 days" — or "Draft 2027 renewals for everyone on A Dock".
        </span>
      </div>

      <NewContractSheet
        open={assignSlipId !== null}
        onOpenChange={(b) => { if (!b) setAssignSlipId(null); }}
        defaultSlipId={assignSlipId ?? undefined}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function RosterRow({ row, onAssign }: { row: Row; onAssign: () => void }) {
  const { slip, contract, boater, vessel, rowStatus, daysUntilExpiry } = row;
  const statusBadge = (() => {
    if (rowStatus === "vacant") return <Badge tone="ok" size="sm">Vacant</Badge>;
    if (rowStatus === "lapsed") return <Badge tone="danger" size="sm">Lapsed</Badge>;
    if (rowStatus === "expiring") return <Badge tone="warn" size="sm">Expiring</Badge>;
    return <Badge tone="neutral" size="sm">Active</Badge>;
  })();

  const gridClass =
    "grid grid-cols-[64px_minmax(0,1.6fr)_minmax(0,1.5fr)_minmax(0,1.1fr)_88px_minmax(0,1.2fr)_96px_120px] items-center gap-3 px-3 py-2 text-[13px] transition-colors";

  // Vacant slips → "Assign holder" action. Occupied / lapsed / expiring →
  // navigate to the boater detail.
  if (!boater) {
    return (
      <li>
        <button
          type="button"
          onClick={onAssign}
          className={cn(
            gridClass,
            "group w-full cursor-pointer text-left hover:bg-surface-2"
          )}
        >
          <span className="font-mono text-[12px] font-medium text-fg">{slip.id}</span>
          <span className="min-w-0 truncate">
            <span className="inline-flex items-center gap-1 text-fg-tertiary group-hover:text-primary">
              <UserPlus className="size-3" />
              <span className="italic">Assign holder</span>
            </span>
          </span>
          <span className="text-fg-tertiary">—</span>
          <span className="text-fg-tertiary">—</span>
          <span className="text-right text-fg-tertiary">—</span>
          <span className="text-fg-tertiary">—</span>
          <span className="text-right text-fg-tertiary">—</span>
          <span>{statusBadge}</span>
        </button>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={`/boaters/${boater.id}`}
        className={cn(gridClass, "cursor-pointer hover:bg-surface-2")}
      >
        <span className="font-mono text-[12px] font-medium text-fg">{slip.id}</span>
        <span className="min-w-0 truncate">
          <span className="font-medium text-fg">{boater.display_name}</span>
          {boater.tags.includes("board_member") && (
            <span className="ml-1.5 text-[10px] text-status-info">★</span>
          )}
        </span>
        <span className="min-w-0 truncate text-fg-subtle">
          {vessel
            ? `${vessel.name}${vessel.year ? ` · ${vessel.year}` : ""}${vessel.make ? ` ${vessel.make}` : ""}`
            : "—"}
        </span>
        <span className="text-[12px] capitalize text-fg-subtle">
          {boater?.billing_cadence ?? "—"}
        </span>
        <span className="text-right tabular text-fg">
          {contract?.annual_rate ? formatMoney(contract.annual_rate) : "—"}
        </span>
        <span className="text-[12px] text-fg-subtle">
          {contract?.effective_end ?? "—"}
        </span>
        <span
          className={cn(
            "text-right tabular text-[12px]",
            daysUntilExpiry === null && "text-fg-tertiary",
            daysUntilExpiry !== null && daysUntilExpiry < 0 && "text-status-danger",
            daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= 90 && "text-status-warn",
            daysUntilExpiry !== null && daysUntilExpiry > 90 && "text-fg-subtle"
          )}
        >
          {daysUntilExpiry === null
            ? "—"
            : daysUntilExpiry < 0
            ? `${-daysUntilExpiry}d ago`
            : `${daysUntilExpiry}d`}
        </span>
        <span>{statusBadge}</span>
      </Link>
    </li>
  );
}

function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">{label}</span>
      <div className="flex rounded-[8px] border border-hairline bg-surface-2 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-[6px] px-2 py-0.5 text-[11px] font-medium transition-colors",
              value === o.value
                ? "bg-surface-1 text-fg shadow-sm"
                : "text-fg-subtle hover:text-fg"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// "Damsite A Dock" → "A", "Marina Del Sur A Dock" → "MDS A", "Transient Dock" → "T"
function shortenDock(name: string): string {
  if (name === "Transient Dock") return "T";
  const m = name.match(/Damsite (\w+) Dock/);
  if (m) return m[1];
  const m2 = name.match(/Marina Del Sur (\w+)/);
  if (m2) return `MDS ${m2[1]}`;
  return name;
}

// Re-export Sparkles to silence unused warning if any
void Sparkles;
void Button;
