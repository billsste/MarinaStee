"use client";

import * as React from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilterSelect } from "@/components/ui/list-filter-select";
import {
  RecordEditDialog,
  type FieldSpec,
} from "@/components/record-edit-dialog";
import { formatMoney } from "@/lib/mock-data";
import { useCan } from "@/lib/auth";
import {
  addSlipType,
  deleteRate,
  deleteSlipType,
  nextRateId,
  updateSlipType,
  upsertRate,
  useFees,
  usePicklistValues,
  useRates,
  useSlipTypes,
  useSlips,
} from "@/lib/client-store";
import {
  effectiveTypeRate,
  groupSlipsByType,
  rateForSlipTypeCadence,
} from "@/lib/slip-type-helpers";
import type {
  OccupancyType,
  Rate,
  RateCadence,
  SlipClass,
  SlipType,
} from "@/lib/types";

/*
 * /services/rates — unified pricing surface.
 *
 * One page, two tabs, one nav entry. Replaces the prior split between
 * /services/slip-types (categorization) and /services/rates (amounts):
 *
 *   "Slip pricing"  — SlipType rows. Each row = a Marina category
 *                     (Covered 30ft, Uncovered 40ft, Buoy, …) with class
 *                     + size band + inline Annual / Monthly / Seasonal
 *                     / Transient columns. Prices auto-resolve via
 *                     effectiveTypeRate() so editing a Rate on the
 *                     "Other rates" tab (or via the agent) reflects
 *                     here immediately.
 *
 *   "Other rates"   — Rate rows that don't map to a SlipType. Today
 *                     that's Jet Ski day/week, plus the Rental Club
 *                     plan tiers + per-tier setup fees. Same flat
 *                     row → RecordEditDialog pattern as everywhere
 *                     else in the app.
 *
 * Both tabs share the search box + Add button (context-switches based
 * on tab) so operators don't learn two layouts.
 *
 * See marina-stee/CLAUDE.md → "List-page UX consistency" for the
 * structural template every list page must follow.
 */

// ─────────────────────────────────────────────────────────────────────
// Constants — column grids, label maps, cadence ordering.
// ─────────────────────────────────────────────────────────────────────

const CLASS_LABEL: Record<SlipClass, string> = {
  covered: "Covered",
  uncovered: "Uncovered",
  t_head: "T-head",
  buoy: "Buoy / Mooring",
  dry_storage: "Dry storage",
};

// Grid for the Slip Pricing table:
// TIER · CLASS · SIZE · ANNUAL · MONTHLY · SEASONAL · TRANSIENT · SLIPS · STATUS
const SLIP_TYPE_COLS =
  "minmax(0, 1.5fr) 100px 90px 100px 100px 100px 100px 64px 76px";

// Grid for the Other Rates table — simpler: NAME · TYPE · CADENCE · AMOUNT · trash
const RATE_COLS =
  "minmax(160px, 2.2fr) minmax(120px, 1.2fr) 110px 110px 36px";

const CADENCE_ORDER: RateCadence[] = [
  "one_time",
  "annual",
  "seasonal",
  "monthly",
  "weekly",
  "daily",
];

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

// Occupancy types whose pricing is fully expressed by SlipType rows on
// the "Slip pricing" tab. The "Other rates" tab hides these so we don't
// double-render the same prices in two places.
const SLIP_PRICING_OCCUPANCY: ReadonlySet<OccupancyType> = new Set([
  "Standard",
  "Buoy",
  "Dry Storage",
  "Mooring",
]);

type ClassFilter = "all" | SlipClass;
type StatusFilter = "all" | "active" | "inactive";
type Tab = "slip_pricing" | "other_rates";

// ─────────────────────────────────────────────────────────────────────
// Top-level view.
// ─────────────────────────────────────────────────────────────────────

export function ServiceRatesView() {
  const [tab, setTab] = React.useState<Tab>("slip_pricing");

  // Shared toolbar state — search is reused across tabs but each tab
  // applies it to its own field (tier name vs rate name). Filter
  // dropdowns are tab-specific so they live inside each tab body.
  const [query, setQuery] = React.useState("");

  return (
    <section className="space-y-4">
      {/* Tab strip — segmented, lives ABOVE the toolbar so the toolbar
          + table feel like one unit per tab. Same visual weight as the
          ListFilterSelect chips so it reads as a primary filter, not
          a heavyweight nav. */}
      <div
        role="tablist"
        aria-label="Rates view"
        className="inline-flex items-center gap-1 rounded-[10px] border border-hairline bg-surface-1 p-1"
      >
        <TabButton
          active={tab === "slip_pricing"}
          onClick={() => setTab("slip_pricing")}
        >
          Slip pricing
        </TabButton>
        <TabButton
          active={tab === "other_rates"}
          onClick={() => setTab("other_rates")}
        >
          Other rates
        </TabButton>
      </div>

      {tab === "slip_pricing" ? (
        <SlipPricingTab query={query} onQueryChange={setQuery} />
      ) : (
        <OtherRatesTab query={query} onQueryChange={setQuery} />
      )}
    </section>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-[7px] px-3 py-1.5 text-[12px] font-medium transition-colors ${
        active
          ? "bg-surface-3 text-fg"
          : "text-fg-subtle hover:bg-surface-2 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tab 1 — Slip Pricing (SlipType rows).
// Replaces the prior /services/slip-types content. Same shape, but
// now lives inside the unified rates surface and gained a Transient
// column so all 4 cadences are visible inline.
// ─────────────────────────────────────────────────────────────────────

function SlipPricingTab({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (s: string) => void;
}) {
  const types = useSlipTypes();
  const slips = useSlips();
  const rates = useRates();
  const fees = useFees();

  const [classFilter, setClassFilter] = React.useState<ClassFilter>("all");
  const [statusFilter, setStatusFilter] =
    React.useState<StatusFilter>("active");

  const [editing, setEditing] = React.useState<SlipType | undefined>();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const slipsByType = React.useMemo(
    () => groupSlipsByType(slips, types),
    [slips, types],
  );

  const counts = React.useMemo(() => {
    let active = 0;
    let inactive = 0;
    for (const t of types) {
      if (t.active) active++;
      else inactive++;
    }
    return { active, inactive, all: types.length };
  }, [types]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return types.filter((t) => {
      if (classFilter !== "all" && t.class !== classFilter) return false;
      if (statusFilter === "active" && !t.active) return false;
      if (statusFilter === "inactive" && t.active) return false;
      if (q) {
        const hay =
          `${t.display_label} ${t.short_label ?? ""} ${CLASS_LABEL[t.class]}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [types, query, classFilter, statusFilter]);

  function openEdit(t?: SlipType) {
    setEditing(t);
    setDialogOpen(true);
  }

  // Field spec — categorization only. Pricing flows from /services/rates
  // (or the "Other rates" tab on this same page).
  const FIELDS: FieldSpec<SlipType>[] = React.useMemo(
    () => [
      {
        key: "display_label",
        label: "Display label",
        kind: "text",
        required: true,
        col: 2,
        placeholder: "Covered 30–40 ft",
      },
      {
        key: "short_label",
        label: "Short label",
        kind: "text",
        col: 2,
        placeholder: "C30–40",
      },
      {
        key: "class",
        label: "Class",
        kind: "select",
        col: 2,
        required: true,
        options: (Object.keys(CLASS_LABEL) as SlipClass[]).map((c) => ({
          value: c,
          label: CLASS_LABEL[c],
        })),
      },
      {
        key: "sort_order",
        label: "Sort order",
        kind: "number",
        col: 2,
      },
      {
        key: "min_loa_inches",
        label: "Min LOA (inches)",
        kind: "number",
        col: 2,
        hint: "Leave blank for no minimum.",
      },
      {
        key: "max_loa_inches",
        label: "Max LOA (inches)",
        kind: "number",
        col: 2,
        required: true,
      },
      {
        key: "active",
        label: "Active",
        kind: "boolean",
      },
    ],
    [],
  );

  return (
    <>
      {/* Toolbar — search + class filter + status filter + Add tier */}
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-surface-1 p-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Tier name, class, or label…"
            className="w-full rounded-[8px] border border-hairline bg-surface-2 py-1.5 pl-8 pr-3 text-[12px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
          />
        </div>

        <ListFilterSelect
          value={classFilter}
          onChange={(v) => setClassFilter(v as ClassFilter)}
          label="Class"
          options={[
            { value: "all", label: "All classes" },
            ...(Object.keys(CLASS_LABEL) as SlipClass[]).map((c) => ({
              value: c,
              label: CLASS_LABEL[c],
            })),
          ]}
        />

        <ListFilterSelect
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
          label="Status"
          options={[
            { value: "all", label: `All · ${counts.all}` },
            { value: "active", label: `Active · ${counts.active}` },
            { value: "inactive", label: `Inactive · ${counts.inactive}` },
          ]}
        />

        <Button variant="secondary" size="sm" onClick={() => openEdit()}>
          <Plus className="size-3.5" /> Add tier
        </Button>
      </div>

      {/* Flat table */}
      <div className="mt-4 overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{ gridTemplateColumns: SLIP_TYPE_COLS }}
        >
          <span>Tier</span>
          <span>Class</span>
          <span>Size</span>
          <span className="text-right">Annual</span>
          <span className="text-right">Monthly</span>
          <span className="text-right">Seasonal</span>
          <span className="text-right">Transient</span>
          <span className="text-right">Slips</span>
          <span>Status</span>
        </div>
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-fg-subtle">
            No tiers match these filters.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {filtered.map((t) => (
              <SlipTypeRow
                key={t.id}
                tier={t}
                slipCount={slipsByType.get(t.id)?.length ?? 0}
                onOpen={() => openEdit(t)}
                rates={rates}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="text-[11px] text-fg-tertiary">
        {filtered.length} of {types.length} tier
        {types.length === 1 ? "" : "s"}
      </div>

      <RecordEditDialog<SlipType>
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? `Edit ${editing.display_label}` : "New slip tier"}
        description={
          editing
            ? "Edit the categorization (class + size band). Prices on this row flow from rate amounts — switch to the Other rates tab to edit the underlying rate."
            : "Define a new slip tier. Class + size band determine which slips fall into this tier; pricing flows from Rate rows that share the tier's occupancy."
        }
        fields={FIELDS}
        record={editing}
        onSave={(values) => {
          if (editing) {
            updateSlipType(editing.id, values);
          } else {
            const blank: SlipType = {
              ...values,
              id: values.id ?? `st_${Date.now().toString(36)}`,
              tenant_id: values.tenant_id ?? "",
              class: values.class ?? "covered",
              max_loa_inches: values.max_loa_inches ?? 40 * 12,
              display_label: values.display_label ?? "New tier",
              short_label: values.short_label ?? "T",
              default_annual_rate: values.default_annual_rate ?? 0,
              included_amenities: values.included_amenities ?? {},
              included_fee_ids: values.included_fee_ids ?? [],
              sort_order: values.sort_order ?? 99,
              active: values.active ?? true,
            };
            addSlipType(blank);
          }
          setDialogOpen(false);
        }}
        onDelete={
          editing
            ? () => {
                if (
                  window.confirm(
                    `Deactivate "${editing.display_label}"? Slips currently in this tier will fall back to derived matching.`,
                  )
                ) {
                  deleteSlipType(editing.id);
                  setDialogOpen(false);
                }
              }
            : undefined
        }
        submitLabel={editing ? "Save changes" : "Create tier"}
        entity="settings"
      />
      {/* Suppress unused — reserved for an upcoming fee multi-select pass. */}
      {void fees}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tab 2 — Other Rates (non-slip Rate rows).
// Folds the prior /components/rentals/rates-manager.tsx content into
// the unified surface. Filters out occupancy types that the Slip
// Pricing tab already covers — operators don't see the same price in
// two places.
// ─────────────────────────────────────────────────────────────────────

function OtherRatesTab({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (s: string) => void;
}) {
  const rates = useRates();
  const canCreate = useCan("create", "rate");
  const occupancyPicklist = usePicklistValues("occupancy_type");

  // Same filter chips as the prior /services/rates page so the move
  // doesn't lose any controls.
  const [typeFilter, setTypeFilter] = React.useState<string>("all");
  const [cadenceFilter, setCadenceFilter] = React.useState<string>("all");

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Rate | undefined>();

  // Hide occupancy types whose pricing belongs on the Slip Pricing
  // tab. Rental Club + Jet Ski (and any future ad-hoc service rates)
  // remain because they aren't categorized by SlipType today.
  const visibleOccupancies = React.useMemo(
    () =>
      occupancyPicklist
        .filter((v) => !v.archived)
        .filter((v) => !SLIP_PRICING_OCCUPANCY.has(v.value as OccupancyType))
        .map((v) => ({ value: v.value, label: v.label })),
    [occupancyPicklist],
  );

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

  const RATE_FIELDS: FieldSpec<Rate>[] = React.useMemo(
    () => [
      {
        key: "name",
        label: "Rate name",
        kind: "text",
        required: true,
        col: 2,
        placeholder: "Jet Ski — Day Rental",
      },
      {
        key: "amount",
        label: "Amount ($)",
        kind: "money",
        required: true,
        col: 2,
        step: "1",
        placeholder: "35",
      },
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
    ],
    [],
  );

  const sorted = React.useMemo(() => {
    return [...rates]
      .filter((r) => {
        // Hide rates that belong on the Slip Pricing tab.
        if (SLIP_PRICING_OCCUPANCY.has(r.occupancy_type)) return false;
        if (typeFilter !== "all" && r.occupancy_type !== typeFilter)
          return false;
        if (cadenceFilter !== "all" && r.cadence !== cadenceFilter)
          return false;
        if (query.trim().length > 0) {
          const q = query.trim().toLowerCase();
          if (!r.name.toLowerCase().includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.occupancy_type !== b.occupancy_type) {
          return a.occupancy_type.localeCompare(b.occupancy_type);
        }
        return (
          CADENCE_ORDER.indexOf(a.cadence) - CADENCE_ORDER.indexOf(b.cadence)
        );
      });
  }, [rates, query, typeFilter, cadenceFilter]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-surface-1 p-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
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
            ...visibleOccupancies,
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
          <span>Service type</span>
          <span>Cadence</span>
          <span>Amount</span>
          <span></span>
        </div>
        {sorted.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-fg-subtle">
            No additional rates. Slip pricing lives on the Slip pricing tab —
            click <span className="font-medium text-fg">New rate</span> to add
            a Jet Ski, Rental Club, or ad-hoc service rate.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {sorted.map((r) => {
              const occupancyLabel =
                visibleOccupancies.find((o) => o.value === r.occupancy_type)
                  ?.label ?? r.occupancy_type;
              return (
                <li key={r.id} className="group relative">
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

                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    style={{ gridTemplateColumns: RATE_COLS }}
                    className="grid w-full cursor-pointer items-center gap-x-3 px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-surface-2"
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

      <div className="text-[11px] text-fg-tertiary">
        {sorted.length} rate{sorted.length === 1 ? "" : "s"} on this tab. Slip
        pricing lives on the Slip pricing tab.
      </div>

      <RecordEditDialog<Rate>
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? `Edit rate — ${editing.name}` : "New rate"}
        description="Non-slip service rates: jet ski rentals, rental club plan tiers, ad-hoc services. Slip pricing edits happen on the Slip pricing tab. Existing contracts keep the rate they were signed at."
        record={editing}
        fields={RATE_FIELDS}
        onSave={handleSave}
        onDelete={editing ? handleDelete : undefined}
        entity="rate"
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SlipType row — same shape as the prior slip-types-view, with a
// Transient column added.
// ─────────────────────────────────────────────────────────────────────

function SlipTypeRow({
  tier,
  slipCount,
  onOpen,
  rates,
}: {
  tier: SlipType;
  slipCount: number;
  onOpen: () => void;
  /** Pass the live useRates() result so the row reflects operator
   *  edits on the Other rates tab (or via the agent) immediately. */
  rates: ReturnType<typeof useRates>;
}) {
  const annual = effectiveTypeRate(tier, "annual", rates);
  const monthly = effectiveTypeRate(tier, "monthly", rates);
  const seasonal = effectiveTypeRate(tier, "seasonal", rates);
  const transient = effectiveTypeRate(tier, "transient", rates);
  const annualRate = rateForSlipTypeCadence(tier, "annual", rates);
  const monthlyRate = rateForSlipTypeCadence(tier, "monthly", rates);
  const seasonalRate = rateForSlipTypeCadence(tier, "seasonal", rates);
  const transientRate = rateForSlipTypeCadence(tier, "transient", rates);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group grid w-full items-center gap-x-3 px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-surface-2"
        style={{ gridTemplateColumns: SLIP_TYPE_COLS }}
      >
        <span
          className="min-w-0 truncate font-medium text-fg"
          title={
            tier.short_label
              ? `${tier.display_label} (${tier.short_label})`
              : tier.display_label
          }
        >
          {tier.display_label}
        </span>
        <span className="text-fg-muted">{CLASS_LABEL[tier.class]}</span>
        <span className="tabular text-fg-muted">{sizeBandLabel(tier)}</span>
        <RateCell amount={annual} fromRate={!!annualRate} />
        <RateCell amount={monthly} fromRate={!!monthlyRate} />
        <RateCell amount={seasonal} fromRate={!!seasonalRate} />
        <RateCell amount={transient} fromRate={!!transientRate} />
        <span className="text-right tabular text-fg-muted">{slipCount}</span>
        <span>
          {tier.active ? (
            <Badge tone="ok" size="sm">
              Active
            </Badge>
          ) : (
            <Badge tone="neutral" size="sm">
              Inactive
            </Badge>
          )}
        </span>
      </button>
    </li>
  );
}

function RateCell({
  amount,
  fromRate,
}: {
  amount?: number;
  fromRate: boolean;
}) {
  if (amount == null) {
    return <span className="text-right text-fg-tertiary">—</span>;
  }
  return (
    <span
      className="text-right tabular text-fg"
      title={fromRate ? "From a linked rate on the Other rates tab" : "Inline fallback"}
    >
      {formatMoney(amount)}
      {!fromRate && (
        <span className="ml-1 text-[10px] text-fg-tertiary" aria-hidden>
          •
        </span>
      )}
    </span>
  );
}

function sizeBandLabel(t: SlipType): string {
  const max = Math.round(t.max_loa_inches / 12);
  if (t.min_loa_inches == null) return `≤ ${max}'`;
  const min = Math.round(t.min_loa_inches / 12);
  if (max >= 999) return `${min}+'`;
  return `${min}–${max}'`;
}
