"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Sparkles, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilterSelect } from "@/components/ui/list-filter-select";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import { AssignHolderWizard } from "@/app/services/[id]/assign/assign-slip-client";
import { ContractPreviewSheet } from "@/components/contracts/contract-preview-sheet";
import {
  BOATERS,
  VESSELS,
  formatMoney,
} from "@/lib/mock-data";
import {
  upsertSlip,
  useActiveDocks,
  useBoaters,
  useContracts,
  useDocks,
  usePicklistLabel,
  useReservations,
  useSlips,
  useVessels,
} from "@/lib/client-store";
import {
  EXPIRING_SOON_WINDOW_MS,
  classifyContractStatus,
  localIsoDate,
} from "@/lib/contracts";
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
type StatusFilter = "all" | "active" | "pending" | "expiring" | "lapsed" | "vacant";

type Row = {
  slip: Slip;
  contract?: Contract;
  boater?: Boater;
  vessel?: Vessel;
  reservation?: Reservation;
  // Derived — "pending" = contract drafted/sent but not yet signed.
  rowStatus: "active" | "pending" | "expiring" | "lapsed" | "vacant";
  daysUntilExpiry: number | null; // null when vacant
};

// Grid columns for the roster table. Inlined as a JS constant — the
// Tailwind v4 JIT silently drops `grid-cols-[…minmax(0,1.8fr)…]` so
// rows collapse to a single column.
const ROSTER_COLS =
  "64px 84px minmax(0, 1.8fr) minmax(0, 1.7fr) 88px 140px 100px";

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
  // Used to route the operator from an occupied-slip row to the
  // existing holder's detail page instead of opening the
  // assign-holder wizard (which is the wrong destination when the
  // slip already has someone holding it).
  const router = useRouter();
  const contracts = useContracts();
  const reservations = useReservations();
  // Live store reads so newly-added members + vessels show up immediately
  // instead of dropping through to the static seed BOATERS/VESSELS array.
  const allBoaters = useBoaters();
  const allVessels = useVessels();
  const boaterById = React.useMemo(() => {
    const m = new Map<string, Boater>();
    for (const b of allBoaters) m.set(b.id, b);
    for (const b of BOATERS) if (!m.has(b.id)) m.set(b.id, b);
    return m;
  }, [allBoaters]);
  const vesselById = React.useMemo(() => {
    const m = new Map<string, Vessel>();
    for (const v of allVessels) m.set(v.id, v);
    for (const v of VESSELS) if (!m.has(v.id)) m.set(v.id, v);
    return m;
  }, [allVessels]);
  // Slip-intrinsic data lives in the store now so the row-level "Edit
  // slip" affordance can mutate slip_class / default_annual_rate /
  // dimensions without crossing the server/seed boundary.
  const slips = useSlips();
  // First-class Dock entity drives filter chips + the dock-name lookup
  // in row rendering. Operators rename docks in Settings → Docks and
  // every row picks up the new name without touching slip records.
  const activeDocks = useActiveDocks();
  const allDocks = useDocks();
  const dockNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const d of allDocks) m.set(d.id, d.short_name || d.name);
    return m;
  }, [allDocks]);

  // Slip-actions modal state — opens by clicking any slip row. The
  // modal hosts BOTH the 5-step assign-holder wizard and the slip
  // metadata editor under one shell, swapped via the footer's
  // "Edit slip info instead" / "Back to assign holder" links. No
  // separate edit dialog any more.
  const [assignSlipId, setAssignSlipId] = React.useState<string | undefined>();
  const [assignOpen, setAssignOpen] = React.useState(false);
  // Contract Preview state — set by the wizard when it finishes
  // drafting a contract via /api/draft-contract. The Preview sheet
  // mounts here so it survives the wizard modal closing.
  const [previewContractId, setPreviewContractId] = React.useState<
    string | undefined
  >();
  const [previewOpen, setPreviewOpen] = React.useState(false);
  function openAssign(slip: Slip) {
    setAssignSlipId(slip.id);
    setAssignOpen(true);
  }

  // "New slip" still uses the lightweight RecordEditDialog — it's an
  // identity-only create flow (no assignment context yet). Repurposed
  // state below; the "edit" path no longer mounts the dialog.
  const [editingSlip, setEditingSlip] = React.useState<Slip | undefined>();
  const [slipEditOpen, setSlipEditOpen] = React.useState(false);

  const [dock, setDock] = React.useState<string>("all");
  const [cadence, setCadence] = React.useState<CadenceFilter>("all");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [query, setQuery] = React.useState("");

  // Date strings (YYYY-MM-DD) for the rowStatus classifier — computed
  // ONCE per render so the per-row classify is allocation-free and
  // timezone-stable. classifyContractStatus uses ISO string compare so
  // these strings, not Date.now(), drive the active/expiring/lapsed
  // decision.
  const todayIso = localIsoDate();
  const ninetyDaysOutIso = localIsoDate(
    new Date(Date.now() + EXPIRING_SOON_WINDOW_MS),
  );

  // Build joined rows once per change
  const rows: Row[] = React.useMemo(() => {
    const now = Date.now();
    return slips.map((slip) => {
      // Most recent contract for this slip — exclude terminated/renewed
      // since those are no longer "the contract on this slip."
      const slipContracts = contracts
        .filter(
          (c) =>
            c.slip_id === slip.id &&
            c.status !== "terminated" &&
            c.status !== "renewed"
        )
        .sort((a, b) => (a.effective_end < b.effective_end ? 1 : -1));
      const contract = slipContracts[0];
      const boater = contract ? boaterById.get(contract.boater_id) : undefined;
      const vessel = contract?.vessel_id
        ? vesselById.get(contract.vessel_id)
        : undefined;
      const reservation = reservations.find(
        (r) => r.slip_id === slip.id && r.status === "occupied"
      );

      let rowStatus: Row["rowStatus"] = "vacant";
      let daysUntilExpiry: number | null = null;
      if (contract) {
        // daysUntilExpiry is purely cosmetic (renders "Expires in 12d"
        // / "Expired 4d ago" in the cell) — the classification uses
        // the ISO-string classifier below to stay timezone-stable.
        const end = new Date(contract.effective_end).getTime();
        daysUntilExpiry = Math.round((end - now) / 86_400_000);

        // Status derivation:
        //   draft / sent / partially_signed → pending (not yet operational)
        //   expired OR past end_date         → lapsed
        //   within 90-day window             → expiring
        //   executed / active                → active
        //
        // Pending wins over the date-driven verdict — a draft contract
        // that happens to "expire" tomorrow is still pending, not
        // expiring/lapsed (it was never operational in the first place).
        if (
          contract.status === "draft" ||
          contract.status === "sent" ||
          contract.status === "partially_signed"
        ) {
          rowStatus = "pending";
        } else if (contract.status === "expired") {
          rowStatus = "lapsed";
        } else {
          const classified = classifyContractStatus(
            contract,
            todayIso,
            ninetyDaysOutIso,
          );
          if (classified === "lapsed") rowStatus = "lapsed";
          else if (classified === "expiring") rowStatus = "expiring";
          else if (classified === "active") rowStatus = "active";
          // classified === null only happens for terminal statuses,
          // which are already filtered above — defensive fallthrough
          // keeps rowStatus at its "vacant" default.
        }
      }
      return { slip, contract, boater, vessel, reservation, rowStatus, daysUntilExpiry };
    });
  }, [contracts, reservations, boaterById, vesselById, todayIso, ninetyDaysOutIso]);

  // Apply filters
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (dock !== "all" && r.slip.dock_id !== dock) return false;
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
    const c = { active: 0, pending: 0, expiring: 0, lapsed: 0, vacant: 0 };
    for (const r of rows) c[r.rowStatus] += 1;
    return c;
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* Single-row toolbar — search + three compact filters + Add slip.
          Filters are collapsed to dropdowns because annual-only marinas
          rarely touch Cadence and rarely jump between docks. The Status
          dropdown carries live counts so "how many are lapsed?" is one
          glance away even when the filter isn't active. */}
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-surface-1 p-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Slip, holder, or vessel…"
            className="w-full rounded-[8px] border border-hairline bg-surface-2 py-1.5 pl-8 pr-3 text-[12px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
          />
        </div>

        <ListFilterSelect
          value={dock}
          onChange={(v) => setDock(v)}
          label="Dock"
          options={[
            { value: "all", label: "All docks" },
            ...activeDocks.map((d) => ({
              value: d.id,
              label: d.short_name || d.name,
            })),
          ]}
        />

        <ListFilterSelect
          value={cadence}
          onChange={(v) => setCadence(v as CadenceFilter)}
          label="Cadence"
          options={[
            { value: "all", label: "All cadences" },
            { value: "annual", label: "Annual" },
            { value: "seasonal", label: "Seasonal" },
            { value: "monthly", label: "Monthly" },
            { value: "transient", label: "Transient" },
          ]}
        />

        <ListFilterSelect
          value={status}
          onChange={(v) => setStatus(v as StatusFilter)}
          label="Status"
          options={[
            { value: "all", label: `All · ${rows.length}` },
            { value: "active", label: `Active · ${counts.active}` },
            { value: "pending", label: `Pending approval · ${counts.pending}` },
            { value: "expiring", label: `Expiring · ${counts.expiring}` },
            { value: "lapsed", label: `Lapsed · ${counts.lapsed}` },
            { value: "vacant", label: `Vacant · ${counts.vacant}` },
          ]}
        />

        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setEditingSlip(undefined);
            setSlipEditOpen(true);
          }}
        >
          <Plus className="size-3.5" />
          Add slip
        </Button>
      </div>

      {/* Roster table — flat row list. The Dock column + the Dock
          filter at the top do the per-dock partitioning when the
          operator needs it; the collapsible per-dock sections we
          used to render were noise for the default "show everything"
          view and forced an extra click for any cross-dock query
          ("who's expiring across the whole marina?"). */}
      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-3 py-2 pr-10 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{ gridTemplateColumns: ROSTER_COLS }}
        >
          <span>Slip</span>
          <span>Dock</span>
          <span>Member</span>
          <span>Vessel</span>
          <span>Cadence</span>
          <span>Rate</span>
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
                dockLabel={dockNameById.get(r.slip.dock_id) ?? r.slip.dock}
                onAssign={() => openAssign(r.slip)}
                onViewHolder={(boaterId) =>
                  router.push(`/members/${boaterId}`)
                }
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
          // Resolve dock_id from the dock name. If the dock string
          // matches an existing dock (case-insensitive), reuse its id;
          // otherwise mint a runtime id derived from the name. Real
          // operator workflow: pick the dock from Settings → Docks
          // first, then add slips to it.
          const dockName = (values.dock || "Unsorted").trim();
          const existing = allDocks.find(
            (d) =>
              d.name.toLowerCase() === dockName.toLowerCase() ||
              d.short_name.toLowerCase() === dockName.toLowerCase()
          );
          const dockId =
            existing?.id ??
            `dock_runtime_${dockName.replace(/\s+/g, "_").toLowerCase()}`;
          const dockPrefix =
            existing?.prefix ??
            (dockName.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 3) ||
              "SLP");
          const number = values.number || "1";
          const generatedId =
            !values.id || values.id === ""
              ? `${dockPrefix}-${number}`
              : values.id;
          upsertSlip({
            ...values,
            id: generatedId,
            dock_id: dockId,
            number: values.number || "1",
            dock: dockName,
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

      {/* Slip-actions modal — opened by every slip row click. Hosts
          both the assign-holder wizard and the slip metadata editor
          under one shell; the operator swaps modes via the footer
          "Edit slip info instead" link without losing modal context. */}
      {assignSlipId && (
        <AssignHolderWizard
          slipId={assignSlipId}
          open={assignOpen}
          onOpenChange={setAssignOpen}
          onContractDrafted={(contractId) => {
            // Wizard just drafted a contract — surface the Preview
            // sheet so the operator reviews + sends.
            setPreviewContractId(contractId);
            setPreviewOpen(true);
          }}
        />
      )}

      <ContractPreviewSheet
        contractId={previewContractId}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function RosterRow({
  row,
  dockLabel,
  onAssign,
  onViewHolder,
}: {
  row: Row;
  dockLabel: string;
  onAssign: () => void;
  /** Called when the row's slip already has a holder — route to the
      holder's detail page rather than re-running the assignment
      wizard, which was the long-standing bug operators flagged. */
  onViewHolder: (boaterId: string) => void;
}) {
  const { slip, contract, boater, vessel, rowStatus } = row;
  const statusBadge = (() => {
    if (rowStatus === "vacant") return <Badge tone="ok" size="sm">Vacant</Badge>;
    if (rowStatus === "pending") return <Badge tone="warn" size="sm">Pending approval</Badge>;
    if (rowStatus === "lapsed") return <Badge tone="danger" size="sm">Lapsed</Badge>;
    if (rowStatus === "expiring") return <Badge tone="warn" size="sm">Expiring</Badge>;
    return <Badge tone="neutral" size="sm">Active</Badge>;
  })();

  const gridClass =
    "grid items-center gap-x-3 px-3 py-2 text-[13px] transition-colors";
  const gridStyle = { gridTemplateColumns: ROSTER_COLS };

  // Row click branches on whether the slip is held:
  //
  //   - Vacant slip → assign-holder modal (the create-new flow). This
  //     is what an operator is looking for when they click an "Assign
  //     holder" row.
  //
  //   - Occupied slip (any boater attached, including lapsed/pending)
  //     → route to /members/[boater.id], the holder detail page where
  //     the operator can edit vessel, financials, comms, etc. Opening
  //     the assign wizard here was a long-standing bug — operators
  //     clicked Robert Jones's A04 row expecting his profile and got
  //     a wizard that suggested they create a new holder.
  //
  // The assign-holder modal still has an "Edit slip info instead"
  // escape hatch for operators who explicitly want to edit slip
  // metadata (rate, class, LOA) while a holder is attached.
  if (!boater) {
    return (
      <li className="group relative">
        <button
          type="button"
          onClick={onAssign}
          style={gridStyle}
          className={cn(
            gridClass,
            "group w-full cursor-pointer text-left hover:bg-surface-2"
          )}
        >
          <span className="flex items-center gap-1.5 font-mono text-[12px] font-medium text-fg">
            {slip.id}
            <SlipClassDot slipClass={slip.slip_class} />
          </span>
          <span className="truncate text-[12px] text-fg-subtle">{dockLabel}</span>
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
          <span className="tabular text-[12px] text-fg-subtle">
            {slip.default_annual_rate
              ? formatMoney(slip.default_annual_rate)
              : "—"}
          </span>
          <span>{statusBadge}</span>
        </button>
      </li>
    );
  }

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => onViewHolder(boater.id)}
        style={gridStyle}
        className={cn(
          gridClass,
          "w-full cursor-pointer text-left hover:bg-surface-2"
        )}
      >
        <span className="flex items-center gap-1.5 font-mono text-[12px] font-medium text-fg">
          {slip.id}
          <SlipClassDot slipClass={slip.slip_class} />
        </span>
        <span className="truncate text-[12px] text-fg-subtle">{dockLabel}</span>
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
        <span className="tabular text-fg">
          {/* Rate always reflects the slip's current rate from
              Services → Rates — never a contract-level override.
              Single source of truth keeps reports clean. */}
          {slip.default_annual_rate > 0 ? formatMoney(slip.default_annual_rate) : "—"}
        </span>
        <span>{statusBadge}</span>
      </button>
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
