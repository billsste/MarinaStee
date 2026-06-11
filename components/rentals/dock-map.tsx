"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { ListFilterSelect } from "@/components/ui/list-filter-select";
import {
  addReservation,
  nextReservationId,
  nextReservationNumber,
  useBoaters,
  useRentalGroups,
  useRentalSpaces,
  useReservations,
  useVessels,
} from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { RentalGroup, RentalSpace, Reservation, SpaceStatus } from "@/lib/types";

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
 *
 * Clicking a tile:
 *   - Vacant → opens SlipActionSheet with new-reservation form
 *   - Occupied / Reserved → opens SlipActionSheet showing current booking
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
  const [selected, setSelected] = React.useState<RentalSpace | null>(null);

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
        {/* Standardized filter chip — matches every other list page
            in the app (Slips, Contracts, etc.). Per CLAUDE.md §6.3
            ListFilterSelect is the established exception to the
            "comboboxes for >5 options" rule because filter chips
            read better at toolbar-density than a Combobox trigger. */}
        <ListFilterSelect
          value={groupFilter}
          onChange={setGroupFilter}
          label="Group"
          options={[
            { value: "all", label: "All groups" },
            ...allGroups.map((g) => ({ value: g.id, label: g.name })),
          ]}
        />
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
                <FingerPier group={g} spaces={spaces} onSelect={setSelected} />
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(60px,1fr))] gap-1.5">
                  {spaces.map((s) => (
                    <SpaceTile key={s.id} space={s} onClick={() => setSelected(s)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selected && (
        <SlipActionSheet space={selected} onClose={() => setSelected(null)} />
      )}

      <p className="text-[11px] text-fg-tertiary">
        <Badge tone="primary" size="sm">v0.1 finger pier</Badge>{" "}
        Slip groups split into port (top) / starboard (bottom) by odd/even number. Future iteration:
        per-group layout config (T-heads, fairways, buoy positions on a map).
      </p>
    </div>
  );
}

// ── Slip action sheet ────────────────────────────────────────────────────────
//
// Vacant → new reservation form pre-filled with slip.
// Occupied / Reserved → current booking summary + link.

function SlipActionSheet({
  space,
  onClose,
}: {
  space: RentalSpace;
  onClose: () => void;
}) {
  const reservations = useReservations();
  const boaters = useBoaters();
  const vessels = useVessels();

  // Find the current or upcoming reservation for this space.
  const current = reservations.find(
    (r) =>
      r.slip_id === space.id &&
      (r.status === "occupied" || r.status === "scheduled")
  );
  const boater = current ? boaters.find((b) => b.id === current.boater_id) : null;
  const vessel = current ? vessels.find((v) => v.id === current.vessel_id) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-[480px] rounded-t-[20px] border border-hairline bg-surface-1 p-5 shadow-xl sm:rounded-[16px]">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[16px] font-semibold text-fg">Slip {space.number}</h3>
              <Badge
                tone={
                  space.status === "occupied"
                    ? "danger"
                    : space.status === "reserved"
                    ? "warn"
                    : space.status === "vacant"
                    ? "ok"
                    : "neutral"
                }
                size="sm"
              >
                {STATUS_LABEL[space.status]}
              </Badge>
            </div>
            {space.length_inches && (
              <p className="text-[11px] text-fg-tertiary">
                {Math.round(space.length_inches / 12)}′
                {space.beam_inches ? ` × ${Math.round(space.beam_inches / 12)}′ beam` : ""}
                {space.has_power ? " · Power" : ""}
                {space.has_water ? " · Water" : ""}
                {space.has_pump_out ? " · Pump-out" : ""}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close slip details"
            className="rounded-[6px] p-1 text-fg-tertiary hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Occupied / reserved — show booking summary */}
        {current && boater ? (
          <div className="space-y-3">
            <div className="rounded-[10px] border border-hairline bg-surface-2 p-3 text-[13px]">
              <div className="font-medium text-fg">{boater.display_name}</div>
              {vessel && (
                <div className="mt-0.5 text-[11px] text-fg-tertiary">
                  {vessel.name} · {vessel.make} {vessel.model}
                </div>
              )}
              <div className="mt-1.5 flex gap-3 text-[11px] text-fg-subtle">
                <span>Arrival {current.arrival_date}</span>
                <span>→</span>
                <span>Departure {current.departure_date}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Link
                href={`/reservations/${current.id}`}
                onClick={onClose}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-primary px-3 py-2 text-[13px] font-medium text-on-primary hover:bg-primary-hover"
              >
                View reservation <ArrowRight className="size-3.5" />
              </Link>
              <Link
                href={`/members/${boater.id}`}
                onClick={onClose}
                className="flex items-center gap-1.5 rounded-[8px] border border-hairline px-3 py-2 text-[13px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
              >
                Boater profile
              </Link>
            </div>
          </div>
        ) : space.status === "vacant" ? (
          /* Vacant — new reservation form */
          <NewReservationForm space={space} onClose={onClose} />
        ) : (
          <p className="text-[12px] text-fg-tertiary">No active reservation found for this slip.</p>
        )}
      </div>
    </div>
  );
}

function NewReservationForm({
  space,
  onClose,
}: {
  space: RentalSpace;
  onClose: () => void;
}) {
  const boaters = useBoaters();
  const vessels = useVessels();

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const [boaterId, setBoaterId] = React.useState("");
  const [vesselId, setVesselId] = React.useState("");
  const [arrival, setArrival] = React.useState(today);
  const [departure, setDeparture] = React.useState(tomorrow);
  const [type, setType] = React.useState<Reservation["type"]>("transient");

  const boaterOptions: ComboboxOption[] = boaters.map((b) => ({
    value: b.id,
    label: b.display_name,
    hint: b.code ?? undefined,
  }));

  const vesselOptions: ComboboxOption[] = vessels
    .filter((v) => !boaterId || v.boater_id === boaterId)
    .map((v) => ({
      value: v.id,
      label: v.name,
      hint: `${v.make} ${v.model}`.trim() || undefined,
    }));

  // Auto-select first vessel when boater is chosen.
  React.useEffect(() => {
    if (!boaterId) { setVesselId(""); return; }
    const first = vessels.find((v) => v.boater_id === boaterId);
    if (first) setVesselId(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boaterId]);

  function save() {
    if (!boaterId || !vesselId || !arrival || !departure) return;
    const id = nextReservationId();
    addReservation({
      id,
      number: nextReservationNumber(),
      seq: "1/1",
      boater_id: boaterId,
      vessel_id: vesselId,
      slip_id: space.id,
      arrival_date: arrival,
      departure_date: departure,
      status: "scheduled",
      type,
    });
    onClose();
  }

  const canSave = Boolean(boaterId && vesselId && arrival && departure && arrival < departure);

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-fg-subtle">
        New reservation for slip <span className="font-medium text-fg">{space.number}</span>.
        Pick a boater, vessel and dates — then confirm.
      </p>

      <FormField label="Boater *">
        <Combobox
          value={boaterId}
          onChange={setBoaterId}
          options={boaterOptions}
          placeholder="Search boaters…"
          searchPlaceholder="Name or code…"
        />
      </FormField>

      {boaterId && (
        <FormField label="Vessel *">
          <Combobox
            value={vesselId}
            onChange={setVesselId}
            options={vesselOptions}
            placeholder="Pick a vessel"
            emptyText="No vessels for this boater."
          />
        </FormField>
      )}

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Arrival *">
          <input
            type="date"
            value={arrival}
            onChange={(e) => setArrival(e.target.value)}
            className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
          />
        </FormField>
        <FormField label="Departure *">
          <input
            type="date"
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
            className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
          />
        </FormField>
      </div>

      <FormField label="Type">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as Reservation["type"])}
          className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
        >
          <option value="transient">Transient</option>
          <option value="annual">Annual</option>
          <option value="seasonal">Seasonal</option>
          <option value="monthly">Monthly</option>
          <option value="recurring">Recurring</option>
        </select>
      </FormField>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="rounded-[8px] px-3 py-1.5 text-[13px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className={cn(
            "rounded-[10px] px-4 py-2 text-[13px] font-medium transition-colors",
            canSave
              ? "bg-primary text-on-primary hover:bg-primary-hover"
              : "cursor-not-allowed bg-surface-3 text-fg-tertiary"
          )}
        >
          Create reservation
        </button>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// ── Dock layout ──────────────────────────────────────────────────────────────

function FingerPier({
  group,
  spaces,
  onSelect,
}: {
  group: RentalGroup;
  spaces: RentalSpace[];
  onSelect: (s: RentalSpace) => void;
}) {
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
        <div className="flex gap-1">
          {port.length === 0 && <div className="text-[11px] italic text-fg-tertiary px-1 py-2">port: —</div>}
          {port.map((s) => (
            <SpaceTile key={s.id} space={s} compact onClick={() => onSelect(s)} />
          ))}
        </div>
        <div className="flex h-3 items-center gap-2 px-1">
          <div className="h-px flex-1 bg-fg-tertiary/40" />
          <span className="text-[9px] uppercase tracking-wider text-fg-tertiary">
            {group.name.replace(/Dock|dock/, "").trim() || "Pier"} ▸ walkway
          </span>
          <div className="h-px flex-1 bg-fg-tertiary/40" />
        </div>
        <div className="flex gap-1">
          {starboard.length === 0 && <div className="text-[11px] italic text-fg-tertiary px-1 py-2">starboard: —</div>}
          {starboard.map((s) => (
            <SpaceTile key={s.id} space={s} compact onClick={() => onSelect(s)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SpaceTile({
  space,
  compact,
  onClick,
}: {
  space: RentalSpace;
  compact?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={`${space.number} — ${STATUS_LABEL[space.status]}${space.status === "vacant" ? " · Click to reserve" : " · Click to view"}`}
      onClick={onClick}
      disabled={space.status === "out_of_service"}
      className={cn(
        "flex flex-col items-center justify-center rounded-[6px] border text-[11px] font-medium transition-colors",
        STATUS_BG[space.status],
        compact ? "h-12 min-w-[44px] px-1.5" : "aspect-square",
        space.status !== "out_of_service" && "cursor-pointer"
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

export { Badge };
