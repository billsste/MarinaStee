"use client";

import * as React from "react";
import { Plus, Search } from "lucide-react";
import { ListFilterSelect } from "@/components/ui/list-filter-select";
import { Badge } from "@/components/ui/badge";
import {
  useFeesForEntity,
  useRentalBoats,
} from "@/lib/client-store";
import { NewBoatButton } from "@/components/rentals/new-boat-button";
import { RentalBoatEditSheet } from "@/components/rentals/rental-boat-edit-sheet";
import { formatMoney } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import type { RentalBoat } from "@/lib/types";

/*
 * Services → Rental Boats — fleet catalog only.
 *
 * Plans (Basic / Plus / Premium) used to live here as a second stacked
 * section. They're now managed exclusively on /services/rates → Other
 * rates tab (Rate rows with occupancy_type="Rental Club"). The dead
 * PlansSection function + h2/description header that lived above it
 * were removed in the §"List-page UX consistency" audit — see
 * marina-stee/CLAUDE.md rule #10 (no h2 + description above the
 * toolbar) and the commit history for the Plans removal rationale.
 *
 * This page is now the canonical single-toolbar list surface for the
 * fleet itself: which boats exist, which rotate into the Boat Club
 * pool, which are walk-up only.
 */
export function ClubCatalogManager() {
  return <FleetSection />;
}

// ─── FLEET ────────────────────────────────────────────────────────

// Grid template matched to the slip page's pattern. Six columns
// laid out in the same identity → location → category → detail →
// money → status order the slip roster uses:
//   BOAT · DOCK · TYPE · SEATS · FEES · STATUS
// (slip equivalent: SLIP · DOCK · MEMBER · VESSEL · RATE · STATUS).
const FLEET_COLS =
  "minmax(160px, 2.2fr) minmax(110px, 1.2fr) 110px 60px minmax(130px, 1.3fr) 110px";

function FleetSection() {
  const boats = useRentalBoats();
  const rentalBoatFees = useFeesForEntity("rental_boat");
  const [editing, setEditing] = React.useState<RentalBoat | null>(null);

  // Quick lookup of fee details by id so the FEES column can render
  // both the attached count and the deposit (the canonical money
  // value per boat — analogous to the slip's RATE column).
  const feeById = React.useMemo(() => {
    const m = new Map<string, (typeof rentalBoatFees)[number]>();
    for (const f of rentalBoatFees) m.set(f.id, f);
    return m;
  }, [rentalBoatFees]);

  function summarizeFees(boat: RentalBoat): { count: number; depositAmount: number } {
    const ids = boat.attached_fee_ids ?? [];
    let depositAmount = boat.deposit_amount ?? 0;
    for (const id of ids) {
      const fee = feeById.get(id);
      if (fee?.is_deposit) depositAmount = fee.amount;
    }
    return { count: ids.length, depositAmount };
  }

  // Slip-page-mirrored filter UX: single-row toolbar with search +
  // three dropdowns + the create button. Replaced the prior chip-row +
  // section-header layout for consistency across every list page.
  const [query, setQuery] = React.useState("");
  const [useFilter, setUseFilter] = React.useState<"all" | "club" | "transient">("all");
  const [typeFilter, setTypeFilter] = React.useState<string>("all");
  const [statusFilter, setStatusFilter] = React.useState<"all" | RentalBoat["status"]>("all");

  // Count rollups for the Status dropdown labels (slip page convention).
  const counts = React.useMemo(() => {
    const acc = {
      all: boats.length,
      available: 0,
      rented: 0,
      maintenance: 0,
      off_season: 0,
    };
    for (const b of boats) acc[b.status] = (acc[b.status] ?? 0) + 1;
    return acc;
  }, [boats]);

  // Unique boat types present in the fleet — drives the Type dropdown
  // options dynamically so a marina with no jet-skis doesn't see the
  // option at all.
  const typeOptions = React.useMemo(() => {
    const seen = new Set<string>();
    for (const b of boats) seen.add(b.type);
    return Array.from(seen);
  }, [boats]);

  const filtered = boats.filter((b) => {
    if (useFilter === "club" && b.available_for_club !== true) return false;
    if (useFilter === "transient" && b.available_for_club === true) return false;
    if (typeFilter !== "all" && b.type !== typeFilter) return false;
    if (statusFilter !== "all" && b.status !== statusFilter) return false;
    if (query.trim().length > 0) {
      const q = query.trim().toLowerCase();
      const hay =
        `${b.name} ${b.type} ${b.home_dock ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <section className="space-y-4">
      {/* Single-row toolbar — mirrors the slip page's roster toolbar.
          Search + three compact dropdowns + Add button. */}
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-surface-1 p-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Boat, type, or dock…"
            className="w-full rounded-[8px] border border-hairline bg-surface-2 py-1.5 pl-8 pr-3 text-[12px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
          />
        </div>

        <ListFilterSelect
          value={typeFilter}
          onChange={setTypeFilter}
          label="Type"
          options={[
            { value: "all", label: "All types" },
            ...typeOptions.map((t) => ({
              value: t,
              label: t.replace(/_/g, " "),
            })),
          ]}
        />

        <ListFilterSelect
          value={useFilter}
          onChange={(v) => setUseFilter(v as typeof useFilter)}
          label="Use"
          options={[
            { value: "all", label: "All uses" },
            { value: "club", label: "Boat Club" },
            { value: "transient", label: "Transient only" },
          ]}
        />

        <ListFilterSelect
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as typeof statusFilter)}
          label="Status"
          options={[
            { value: "all", label: `All · ${counts.all}` },
            { value: "available", label: `Available · ${counts.available}` },
            { value: "rented", label: `Rented · ${counts.rented}` },
            { value: "maintenance", label: `Maintenance · ${counts.maintenance}` },
            { value: "off_season", label: `Off season · ${counts.off_season}` },
          ]}
        />

        <NewBoatButton />
      </div>

      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        {/* Column header — same density tokens the slip page uses
            (px-3 py-2 + 10px uppercase) so the two tables sit at
            identical visual weight. Capacity gets its own narrow
            column instead of riding under the boat name as sub-text;
            keeps every row to exactly one line. */}
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{ gridTemplateColumns: FLEET_COLS }}
        >
          <span>Boat</span>
          <span>Dock</span>
          <span>Type</span>
          <span>Seats</span>
          <span>Fees</span>
          <span>Status</span>
        </div>

        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-fg-subtle">
            No boats match this filter.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {filtered.map((b) => {
              const fees = summarizeFees(b);
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => setEditing(b)}
                    className="grid w-full cursor-pointer items-center gap-x-3 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-2"
                    style={{ gridTemplateColumns: FLEET_COLS }}
                  >
                    {/* Identity — boat name + a subtle club/transient
                        side-marker so the operator can scan the column
                        and still tell at a glance which revenue stream a
                        given boat belongs to. Single line — capacity
                        moved to its own column. */}
                    <span className="flex min-w-0 items-center gap-1.5 truncate font-medium text-fg">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          b.available_for_club ? "bg-status-info" : "bg-status-ok"
                        )}
                        title={b.available_for_club ? "Boat Club rotation" : "Transient only"}
                        aria-hidden
                      />
                      <span className="truncate">{b.name}</span>
                    </span>
                    <span className="truncate text-[12px] text-fg-subtle">
                      {b.home_dock || "—"}
                    </span>
                    <span className="truncate text-[12px] capitalize text-fg-subtle">
                      {b.type.replace(/_/g, " ")}
                    </span>
                    <span className="tabular text-[12px] text-fg-subtle">
                      {b.capacity}
                    </span>
                    <span className="truncate text-[12px] text-fg-subtle">
                      {fees.count === 0 ? (
                        <span className="text-fg-tertiary">—</span>
                      ) : (
                        <>
                          <span className="tabular text-fg">{fees.count}</span>
                          {" "}
                          rate{fees.count === 1 ? "" : "s"}
                          {fees.depositAmount > 0 && (
                            <span className="ml-1 text-fg-tertiary">
                              · {formatMoney(fees.depositAmount)} hold
                            </span>
                          )}
                        </>
                      )}
                    </span>
                    <span>
                      <Badge tone={statusTone(b.status)} size="sm">
                        {statusLabel(b.status)}
                      </Badge>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Edit sheet — opens on row click. RentalBoatWizard handles new
          boats (multi-step UX for a fresh entity); RentalBoatEditSheet
          handles edits (single scrollable form, matched to the wizard
          for visual + behavioral parity, including the catalog-vs-
          custom rates toggle). */}
      {editing && (
        <RentalBoatEditSheet
          boat={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}


// ── Status badge helpers ────────────────────────────────────────
// Map the RentalBoat.status enum onto the Badge tones we already use
// elsewhere (Reservations, ledger, work orders) so the dashboard,
// catalog, and /boat-rentals all speak the same visual language.
function statusTone(status: RentalBoat["status"]): "ok" | "info" | "warn" | "neutral" {
  switch (status) {
    case "available":
      return "ok";
    case "rented":
      return "info";
    case "maintenance":
      return "warn";
    case "off_season":
      return "neutral";
    default:
      return "neutral";
  }
}

function statusLabel(status: RentalBoat["status"]): string {
  switch (status) {
    case "available":
      return "Available";
    case "rented":
      return "On the water";
    case "maintenance":
      return "Maintenance";
    case "off_season":
      return "Off-season";
    default:
      return status;
  }
}
