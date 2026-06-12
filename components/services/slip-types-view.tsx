"use client";

import * as React from "react";
import { Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilterSelect } from "@/components/ui/list-filter-select";
import {
  RecordEditDialog,
  type FieldSpec,
} from "@/components/record-edit-dialog";
import { formatMoney } from "@/lib/mock-data";
import {
  addSlipType,
  deleteSlipType,
  updateSlipType,
  useFees,
  useRates,
  useSlipTypes,
  useSlips,
} from "@/lib/client-store";
import {
  effectiveTypeRate,
  groupSlipsByType,
  rateForSlipTypeCadence,
} from "@/lib/slip-type-helpers";
import type { SlipClass, SlipType } from "@/lib/types";

/*
 * Slip Types CRUD surface — matches the canonical Marina Stee list-
 * page pattern (see ~/Desktop/Claude/marina-stee/CLAUDE.md §
 * "List-page UX consistency"):
 *   - filter bar at the top (search + dropdowns + Add button)
 *   - flat row list — no sectioning
 *   - click row → RecordEditDialog modal
 *   - pricing pulled from /services/rates rather than redefined inline
 */

const CLASS_LABEL: Record<SlipClass, string> = {
  covered: "Covered",
  uncovered: "Uncovered",
  t_head: "T-head",
  buoy: "Buoy / Mooring",
  dry_storage: "Dry storage",
};

// Grid: TIER label · CLASS · SIZE · ANNUAL · MONTHLY · SEASONAL · SLIPS · STATUS
const SLIP_TYPE_COLS =
  "minmax(0, 1.6fr) 110px 100px 110px 110px 110px 70px 78px";

type ClassFilter = "all" | SlipClass;
type StatusFilter = "all" | "active" | "inactive";

export function SlipTypesView() {
  const types = useSlipTypes();
  const slips = useSlips();
  const rates = useRates();
  const fees = useFees();

  const [query, setQuery] = React.useState("");
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

  // Field spec for the edit dialog. CATEGORIZATION ONLY — no pricing
  // fields. Pricing flows from /services/rates automatically.
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
      // NO pricing fields. Pricing flows from /services/rates: the
      // table column auto-resolves the matching Rate by (slip_class,
      // cadence). Operators edit pricing in one place, every slip
      // type in that class picks up the new amount on next render.
      // See lib/slip-type-helpers → relatedRatesForType().
      {
        key: "active",
        label: "Active",
        kind: "boolean",
      },
    ],
    [],
  );

  return (
    <section className="space-y-4">
      {/* No sub-heading — the Services layout's breadcrumb already
          identifies the page. List surfaces dive straight into the
          toolbar to match /services/roster. See marina-stee/CLAUDE.md
          → "List-page UX consistency". */}

      {/* Toolbar — search + class filter + status filter + Add tier.
          Same layout as /services/roster (Slips page). */}
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-surface-1 p-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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

      {/* Flat table — matches the Slips page grid pattern. */}
      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
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

      {/* Footer hint — same shape as the Slips page. */}
      <div className="text-[11px] text-fg-tertiary">
        {filtered.length} of {types.length} tier
        {types.length === 1 ? "" : "s"}
      </div>

      {/* Edit dialog — uses the canonical RecordEditDialog so the
          create + edit flow matches every other CRUD surface in the
          app (slip editor, fees, rates, vendors, etc.). */}
      <RecordEditDialog<SlipType>
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? `Edit ${editing.display_label}` : "New slip type"}
        description={
          editing
            ? "Edit the categorization (class + size band + amenities). Pricing pulls automatically from /services/rates by class + cadence; edit rates there."
            : "Define a new tier (class + size band). Pricing pulls automatically from /services/rates."
        }
        fields={FIELDS}
        record={editing}
        onSave={(values) => {
          if (editing) {
            updateSlipType(editing.id, values);
          } else {
            // The dialog returns a Partial<SlipType>-ish shape (caller-
            // populated fields plus null for the unset ones). Splat
            // first, then defaults — anything the operator didn't set
            // gets a safe initial value so the row type-checks.
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
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Row — flat table cell layout. Clicking the row opens the edit dialog.
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
   *  edits on /services/rates immediately. Default args on the
   *  helpers fall back to the module-level RATES seed otherwise. */
  rates: ReturnType<typeof useRates>;
}) {
  const annual = effectiveTypeRate(tier, "annual", rates);
  const monthly = effectiveTypeRate(tier, "monthly", rates);
  const seasonal = effectiveTypeRate(tier, "seasonal", rates);
  const annualRate = rateForSlipTypeCadence(tier, "annual", rates);
  const monthlyRate = rateForSlipTypeCadence(tier, "monthly", rates);
  const seasonalRate = rateForSlipTypeCadence(tier, "seasonal", rates);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group grid w-full items-center gap-x-3 px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-surface-2"
        style={{ gridTemplateColumns: SLIP_TYPE_COLS }}
      >
        {/* Single-line tier label — short_label moved to a title hint
            so row height matches the Slips page (px-3 py-2.5 = ~38px
            total). Two-line cells made this row visibly taller than
            adjacent surfaces; the canonical pattern is one line per
            row across every Marina Stee list page. */}
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
      title={fromRate ? "From a linked rate in /services/rates" : "Inline fallback"}
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
