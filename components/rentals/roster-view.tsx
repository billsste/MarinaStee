"use client";

import * as React from "react";
import Link from "next/link";
import { Pencil, Plus, Search, Sparkles, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import { SpacesToolbar } from "@/components/rentals/spaces-toolbar";
import { useRouter } from "next/navigation";
import {
  BOATERS,
  VESSELS,
  formatMoney,
} from "@/lib/mock-data";
import {
  upsertSlip,
  useContracts,
  usePicklistLabel,
  useReservations,
  useSlips,
} from "@/lib/client-store";
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

// Slip-edit fields. Class is wired to the `slip_class` picklist so the
// super-user can rename or add classes from Settings → Customization
// without touching code. Rates are dollars per year.
const SLIP_FIELDS: FieldSpec<Slip>[] = [
  { key: "number", label: "Number", kind: "text", required: true, col: 2 },
  { key: "dock", label: "Dock", kind: "text", required: true, col: 2 },
  {
    key: "slip_class",
    label: "Class",
    kind: "select",
    col: 2,
    picklist: "slip_class",
  },
  { key: "invoice_category", label: "Invoice category", kind: "text", col: 2 },
  { key: "max_loa_inches", label: "Max LOA (inches)", kind: "number", col: 2 },
  { key: "max_beam_inches", label: "Max beam (inches)", kind: "number", col: 2 },
  { key: "has_power", label: "Power available", kind: "boolean" },
  { key: "has_water", label: "Water available", kind: "boolean" },
  {
    key: "default_annual_rate",
    label: "Default annual rate ($)",
    kind: "number",
    col: 2,
  },
  {
    key: "default_monthly_rate",
    label: "Default monthly rate ($)",
    kind: "number",
    col: 2,
  },
  {
    key: "default_seasonal_rate",
    label: "Default seasonal rate ($)",
    kind: "number",
    col: 2,
  },
];

export function RosterView() {
  const contracts = useContracts();
  const reservations = useReservations();
  // Slip-intrinsic data lives in the store now so the row-level "Edit
  // slip" affordance can mutate slip_class / default_annual_rate /
  // dimensions without crossing the server/seed boundary.
  const slips = useSlips();

  const docks = React.useMemo(
    () => Array.from(new Set(slips.map((s) => s.dock))).sort(),
    [slips]
  );

  // Slip-edit dialog state — opens from the small pencil affordance
  // appearing on each row hover.
  const [editingSlip, setEditingSlip] = React.useState<Slip | undefined>();
  const [slipEditOpen, setSlipEditOpen] = React.useState(false);
  function openSlipEdit(slip: Slip) {
    setEditingSlip(slip);
    setSlipEditOpen(true);
  }

  const [dock, setDock] = React.useState<string>("all");
  const [cadence, setCadence] = React.useState<CadenceFilter>("all");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [query, setQuery] = React.useState("");
  // Vacant slips → navigate into the assignment wizard at
  // /slips/[id]/assign instead of opening a one-shot dialog.
  const router = useRouter();

  // Build joined rows once per change
  const rows: Row[] = React.useMemo(() => {
    const now = Date.now();
    return slips.map((slip) => {
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
      {/* Toolbar — Day pass for walk-ups, + Add slip for inventory growth */}
      <div className="flex items-center justify-between gap-3">
        <SpacesToolbar />
        <Button
          variant="secondary"
          size="md"
          onClick={() => {
            setEditingSlip(undefined);
            setSlipEditOpen(true);
          }}
        >
          <Plus className="size-3.5" />
          Add slip
        </Button>
      </div>

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
          <span>Expires</span>
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
                onAssign={() => router.push(`/slips/${r.slip.id}/assign`)}
                onEditSlip={() => openSlipEdit(r.slip)}
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

      <RecordEditDialog<Slip>
        open={slipEditOpen}
        onOpenChange={setSlipEditOpen}
        title={
          editingSlip
            ? `Edit slip ${editingSlip.id}`
            : "Add slip"
        }
        description={
          editingSlip
            ? "Slip defaults flow into the assignment wizard for any new contract on this slip. Existing contracts keep what they were signed at."
            : "New slip — pick a dock, number, class, and dimensions. New dock names auto-create a dock; existing ones get the new slip appended."
        }
        fields={SLIP_FIELDS}
        record={editingSlip}
        onSave={(values) => {
          // Generate a synthetic id for new slips. Convention: short
          // dock prefix + slip number — keeps demo IDs readable
          // (e.g. "DSM-15"). Falls back to a timestamp if dock/number
          // missing so we still get a unique id.
          const dockPrefix = (values.dock || "SLP")
            .replace(/[^A-Za-z]/g, "")
            .toUpperCase()
            .slice(0, 3);
          const number = values.number || "1";
          const generatedId =
            !values.id || values.id === ""
              ? `${dockPrefix}-${number}`
              : values.id;
          upsertSlip({
            ...values,
            id: generatedId,
            number: values.number || "1",
            dock: values.dock || "Unsorted",
            slip_class: values.slip_class || "uncovered",
            max_loa_inches: Number(values.max_loa_inches) || 0,
            max_beam_inches: Number(values.max_beam_inches) || 0,
            has_power: Boolean(values.has_power),
            has_water: Boolean(values.has_water),
            default_annual_rate: Number(values.default_annual_rate) || 0,
            invoice_category: values.invoice_category || "Marina Slip Fees",
          });
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function RosterRow({
  row,
  onAssign,
  onEditSlip,
}: {
  row: Row;
  onAssign: () => void;
  onEditSlip: () => void;
}) {
  const { slip, contract, boater, vessel, rowStatus, daysUntilExpiry } = row;
  const statusBadge = (() => {
    if (rowStatus === "vacant") return <Badge tone="ok" size="sm">Vacant</Badge>;
    if (rowStatus === "lapsed") return <Badge tone="danger" size="sm">Lapsed</Badge>;
    if (rowStatus === "expiring") return <Badge tone="warn" size="sm">Expiring</Badge>;
    return <Badge tone="neutral" size="sm">Active</Badge>;
  })();

  const gridClass =
    "grid grid-cols-[64px_minmax(0,1.6fr)_minmax(0,1.5fr)_minmax(0,1.1fr)_88px_minmax(0,1.2fr)_96px_120px] items-center gap-3 px-3 py-2 text-[13px] transition-colors";

  // Hover-only pencil affordance for editing the slip's intrinsic
  // defaults (class, max LOA/beam, default rates). Sits above the row's
  // primary click target so the click doesn't navigate or open assign.
  const editPencil = (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onEditSlip();
      }}
      title="Edit slip defaults"
      aria-label="Edit slip defaults"
      className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-md border border-hairline bg-surface-1 p-1 text-fg-subtle opacity-0 shadow-sm transition-opacity hover:bg-surface-2 hover:text-fg group-hover:opacity-100"
    >
      <Pencil className="size-3" />
    </button>
  );

  // Vacant slips → "Assign holder" action. Occupied / lapsed / expiring →
  // navigate to the boater detail.
  if (!boater) {
    return (
      <li className="group relative">
        {editPencil}
        <button
          type="button"
          onClick={onAssign}
          className={cn(
            gridClass,
            "group w-full cursor-pointer text-left hover:bg-surface-2"
          )}
        >
          <span className="flex items-center gap-1.5 font-mono text-[12px] font-medium text-fg">
            {slip.id}
            <SlipClassDot slipClass={slip.slip_class} />
          </span>
          <span className="min-w-0 truncate">
            <span className="inline-flex items-center gap-1 text-fg-tertiary group-hover:text-primary">
              <UserPlus className="size-3" />
              <span className="italic">Assign holder</span>
            </span>
          </span>
          <span className="text-fg-tertiary">—</span>
          <span className="text-fg-tertiary">—</span>
          {/* Show the slip's default annual rate so staff can quote a
              vacancy without opening the slip — pricing rides on the slip. */}
          <span className="text-right tabular text-[12px] text-fg-subtle">
            {slip.default_annual_rate
              ? formatMoney(slip.default_annual_rate)
              : "—"}
          </span>
          <span className="text-fg-tertiary">—</span>
          <span className="text-right text-fg-tertiary">—</span>
          <span>{statusBadge}</span>
        </button>
      </li>
    );
  }

  return (
    <li className="group relative">
      {editPencil}
      <Link
        href={`/holders/${boater.id}`}
        className={cn(gridClass, "cursor-pointer hover:bg-surface-2")}
      >
        <span className="flex items-center gap-1.5 font-mono text-[12px] font-medium text-fg">
          {slip.id}
          <SlipClassDot slipClass={slip.slip_class} />
        </span>
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
          {contract?.annual_rate ? (
            <span className="inline-flex items-baseline justify-end gap-1">
              {/* Override flag — rendered BEFORE the money so the
                  money's right edge aligns identically across all rows
                  (with or without an override). Staff sees discounted
                  / comp'd / grandfathered pricing at a glance. */}
              {slip.default_annual_rate > 0 &&
                Math.abs(contract.annual_rate - slip.default_annual_rate) >= 100 && (
                  <span
                    className={cn(
                      "text-[10px]",
                      contract.annual_rate < slip.default_annual_rate
                        ? "text-status-warn"
                        : "text-status-info"
                    )}
                    title={`Slip default ${formatMoney(slip.default_annual_rate)}`}
                  >
                    {contract.annual_rate < slip.default_annual_rate ? "↓" : "↑"}
                  </span>
                )}
              <span>{formatMoney(contract.annual_rate)}</span>
            </span>
          ) : (
            "—"
          )}
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

/**
 * Tiny dot showing slip class (covered/uncovered/t-head/buoy/dry).
 * Hovering shows the class name. Density-first — a chip would dominate
 * the 64px slip column.
 */
function SlipClassDot({ slipClass }: { slipClass: import("@/lib/types").SlipClass }) {
  // Color stays hard-coded (visual semantics tied to the canonical
  // class taxonomy); label resolves from the tenant picklist so a
  // super-user renaming "Covered" → "Indoor" updates the tooltip too.
  const colors: Record<import("@/lib/types").SlipClass, string> = {
    covered: "bg-status-info",
    uncovered: "bg-fg-tertiary/60",
    t_head: "bg-primary",
    buoy: "bg-status-warn",
    dry_storage: "bg-fg-subtle",
  };
  const label = usePicklistLabel("slip_class", slipClass);
  return (
    <span
      title={label}
      aria-label={label}
      className={cn("inline-block size-1.5 rounded-full", colors[slipClass])}
    />
  );
}
