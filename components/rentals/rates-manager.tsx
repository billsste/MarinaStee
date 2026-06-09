"use client";

import * as React from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListFilterSelect } from "@/components/ui/list-filter-select";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import {
  deleteRate,
  nextRateId,
  upsertRate,
  usePicklistValues,
  useRates,
} from "@/lib/client-store";
import { useCan } from "@/lib/auth";
import { formatMoney } from "@/lib/mock-data";
import type { OccupancyType, Rate, RateCadence } from "@/lib/types";

/*
 * /services/rates — tabular surface. Row-click opens the rate edit dialog;
 * same UX as the Slips Roster (click row → edit). One affordance per
 * row, not per cell. Delete sits as a hover-only trash icon top-right.
 *
 * "+ New rate" reuses the same dialog with no `record` for the create
 * flow.
 */

const CADENCE_ORDER: RateCadence[] = ["one_time", "annual", "seasonal", "monthly", "weekly", "daily"];
const ALL_OCCUPANCY: OccupancyType[] = ["Standard", "Jet Ski", "Buoy", "Dry Storage", "Mooring", "Rental Club"];

const CADENCE_LABELS: Record<RateCadence, string> = {
  one_time: "One-time",
  annual: "Annual",
  seasonal: "Seasonal",
  monthly: "Monthly",
  weekly: "Weekly",
  daily: "Daily",
};

const CADENCE_OPTIONS = CADENCE_ORDER.map((c) => ({
  value: c,
  label: CADENCE_LABELS[c],
}));

// Grid template matched to the slip page's density convention.
// Five columns: Name (identity, wide) · Service Type (category) ·
// Cadence (category) · Amount (money) · trash slot.
const RATE_COLS =
  "minmax(160px, 2.2fr) minmax(120px, 1.2fr) 110px 110px 36px";

// Generic rate fields — name, amount, service type, cadence. The
// Rental-Club-specific extras (join_fee, days_per_month, plan_tier)
// used to live here too but they cluttered every non-club rate edit
// with irrelevant Boat-Club fields. Those plan-specific attributes
// are now edited exclusively from Services → Rental Club → Plans,
// where they're shown in context. Operators attach the setup fee
// itself via the unified service-fee catalog (rate_club_setup +
// any per-tier setup rows), so it never needs to be re-typed on the
// plan row.
const RATE_FIELDS: FieldSpec<Rate>[] = [
  { key: "name", label: "Rate name", kind: "text", required: true, col: 2, placeholder: "2027 Annual Slip — Standard" },
  { key: "amount", label: "Amount ($)", kind: "money", required: true, col: 2, step: "1", placeholder: "3900" },
  {
    key: "occupancy_type",
    label: "Service type",
    kind: "select",
    required: true,
    col: 2,
    picklist: "occupancy_type",
  },
  {
    key: "cadence",
    label: "Cadence",
    kind: "select",
    required: true,
    col: 2,
    options: CADENCE_OPTIONS,
  },
];

export function RatesManager() {
  const rates = useRates();
  const canCreate = useCan("create", "rate");
  const occupancyPicklist = usePicklistValues("occupancy_type");
  const occupancyOptions = React.useMemo(
    () =>
      occupancyPicklist
        .filter((v) => !v.archived)
        .map((v) => ({ value: v.value, label: v.label })),
    [occupancyPicklist]
  );
  // Single dialog handles both create and edit. `editing` is the record
  // when set, otherwise we're in create mode.
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Rate | undefined>();

  // Toolbar filter state — mirrors the slip-page (roster-view) pattern:
  // search box + compact filter dropdowns + create button on one row.
  const [query, setQuery] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<string>("all");
  const [cadenceFilter, setCadenceFilter] = React.useState<string>("all");

  function openCreate() {
    setEditing(undefined);
    setDialogOpen(true);
  }
  function openEdit(rate: Rate) {
    setEditing(rate);
    setDialogOpen(true);
  }
  function handleSave(values: Rate) {
    upsertRate({
      ...values,
      id: values.id || editing?.id || nextRateId(),
      amount: Number(values.amount) || 0,
    });
  }

  function handleDelete(rate: Rate) {
    if (!window.confirm(`Delete rate "${rate.name}"?`)) return;
    deleteRate(rate.id);
  }

  // Filter + sort. Filters: search (name substring), service type,
  // cadence. Sort: by service type, then cadence.
  const sorted = React.useMemo(() => {
    return [...rates]
      .filter((r) => {
        if (typeFilter !== "all" && r.occupancy_type !== typeFilter) return false;
        if (cadenceFilter !== "all" && r.cadence !== cadenceFilter) return false;
        if (query.trim().length > 0) {
          const q = query.trim().toLowerCase();
          if (!r.name.toLowerCase().includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aType = ALL_OCCUPANCY.indexOf(a.occupancy_type as OccupancyType);
        const bType = ALL_OCCUPANCY.indexOf(b.occupancy_type as OccupancyType);
        if (aType !== bType) return aType - bType;
        return CADENCE_ORDER.indexOf(a.cadence) - CADENCE_ORDER.indexOf(b.cadence);
      });
  }, [rates, query, typeFilter, cadenceFilter]);

  return (
    <>
      {/* Single-row toolbar — mirrors the slip page (roster-view).
          Search + Service Type filter + Cadence filter + Add button. */}
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-surface-1 p-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rate name…"
            className="w-full rounded-[8px] border border-hairline bg-surface-2 py-1.5 pl-8 pr-3 text-[12px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
          />
        </div>

        <ListFilterSelect
          value={typeFilter}
          onChange={setTypeFilter}
          label="Service type"
          options={[
            { value: "all", label: "All types" },
            ...occupancyOptions.map((o) => ({ value: o.value, label: o.label })),
          ]}
        />

        <ListFilterSelect
          value={cadenceFilter}
          onChange={setCadenceFilter}
          label="Cadence"
          options={[
            { value: "all", label: "All cadences" },
            ...CADENCE_ORDER.map((c) => ({
              value: c,
              label: CADENCE_LABELS[c],
            })),
          ]}
        />

        {canCreate && (
          <Button variant="primary" size="sm" onClick={openCreate}>
            <Plus className="size-3.5" />
            New rate
          </Button>
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{ gridTemplateColumns: RATE_COLS }}
        >
          <span>Rate name</span>
          <span>Service Type</span>
          <span>Cadence</span>
          <span>Amount</span>
          <span></span>
        </div>
        {sorted.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-fg-subtle">
            No rates configured. Click <span className="font-medium text-fg">New rate</span> to add one.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {sorted.map((r) => {
              const occupancyLabel =
                occupancyOptions.find((o) => o.value === r.occupancy_type)?.label ??
                r.occupancy_type;
              return (
                <li key={r.id} className="group relative">
                  {/* Hover-only trash. Absolute-positioned so it isn't
                      nested inside the row's click target. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDelete(r);
                    }}
                    className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-md p-1 text-fg-tertiary opacity-0 transition-opacity hover:bg-surface-3 hover:text-status-danger group-hover:opacity-100"
                    aria-label={`Delete ${r.name}`}
                    title="Delete rate"
                  >
                    <Trash2 className="size-3.5" />
                  </button>

                  {/* The whole row is the click target → opens edit dialog.
                      Same UX as /services Roster: single primary action per row. */}
                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    style={{ gridTemplateColumns: RATE_COLS }}
                    className="grid w-full cursor-pointer items-center gap-x-3 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-2"
                    title="Edit rate"
                  >
                    <span className="min-w-0 truncate text-[13px] font-medium text-fg">
                      {r.name}
                    </span>
                    <span className="truncate text-[12px] text-fg-subtle">
                      {occupancyLabel}
                    </span>
                    <span className="text-[12px] text-fg-subtle">
                      {CADENCE_LABELS[r.cadence] ?? r.cadence}
                    </span>
                    <span className="money-display text-[14px] text-fg">
                      {formatMoney(r.amount)}
                    </span>
                    <span />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <RecordEditDialog<Rate>
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? `Edit rate — ${editing.name}` : "New rate"}
        description="Slip rates apply to reservations and contract drafts. Existing contracts keep the rate they were signed at. Boat Club plan details (join fee, days/month, tier) live in Services → Rental Club → Plans."
        record={editing}
        fields={RATE_FIELDS}
        onSave={handleSave}
        onDelete={editing ? handleDelete : undefined}
        entity="rate"
      />
    </>
  );
}

