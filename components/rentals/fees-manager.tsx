"use client";

import * as React from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilterSelect } from "@/components/ui/list-filter-select";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import {
  deleteFee,
  nextFeeId,
  upsertFee,
  useFeeUsage,
  useFees,
} from "@/lib/client-store";
import { useCan } from "@/lib/auth";
import { formatMoney } from "@/lib/mock-data";
import type { AdditionalFee, FeeAppliesTo, FeeRecurrence } from "@/lib/types";

/*
 * /services/fees — tabular catalog. Row-click opens the Configure dialog;
 * same UX as /services Roster and /services/rates (click row → edit). One
 * affordance per row instead of per-cell pencils. Delete + Configure
 * collapse into the dialog itself; just the row hover signals it's
 * clickable.
 *
 * Two cadence-shaped fields coexist on AdditionalFee:
 *  - `recurrence` — legacy SKU-level flag (one_time / monthly / annual)
 *    that already drove POS, work-order closeout, and annual-billing-run
 *    behavior. Kept for back-compat with existing callsites.
 *  - `cadence` — new unified service-fees flag introduced in Phase 1,
 *    used by booking entities (reservations, contracts, club subs) to
 *    roll up one-time vs ongoing charges through `totalFromAttachedFees`.
 *    For all new rows we keep these two in sync; the table surfaces the
 *    new `cadence` because that's the field downstream wizards read.
 *
 * `applies_to_entities` (new in Phase 1) narrows which booking entity
 * each fee surfaces on. Undefined = available on all three. We display
 * empty as "All entities" and surface the explicit set as chips.
 */

const APPLIES_LABEL: Record<FeeAppliesTo, string> = {
  slip_contract: "Slip contracts",
  work_order: "Work orders",
  boat_rental: "Boat rentals",
  pos: "POS",
  annual_billing_run: "Annual run",
};

const CADENCE_ORDER: FeeRecurrence[] = ["one_time", "monthly", "annual"];

const CADENCE_META: Record<
  FeeRecurrence,
  { label: string; short: string; chip: string }
> = {
  one_time: {
    label: "One-time",
    short: "one-time",
    chip: "border-hairline bg-surface-2 text-fg-subtle",
  },
  monthly: {
    label: "Monthly",
    short: "monthly",
    chip: "border-status-info/30 bg-status-info/10 text-status-info",
  },
  annual: {
    label: "Annual",
    short: "annual",
    chip: "border-status-warn/30 bg-status-warn/10 text-status-warn",
  },
};

const CADENCE_OPTIONS = CADENCE_ORDER.map((c) => ({
  value: c,
  label: CADENCE_META[c].label,
}));

type FeeEntity = NonNullable<AdditionalFee["applies_to_entities"]>[number];

const ENTITY_ORDER: FeeEntity[] = [
  "reservation",
  "contract",
  "club_subscription",
  "rental_boat",
];

const ENTITY_LABEL: Record<FeeEntity, string> = {
  reservation: "Reservation",
  contract: "Contract",
  club_subscription: "Club",
  rental_boat: "Rental boat",
};

const ENTITY_OPTIONS = ENTITY_ORDER.map((e) => ({
  value: e,
  label: ENTITY_LABEL[e],
}));

// Single grid template shared by header + every row so columns stay aligned.
// Seven visible columns + trailing slot for the hover trash button.
// Order matches the slip-page pattern: identity → category → detail
// → detail → detail → money → status.
//   name | cadence | applies_to_entities | applies_to (surfaces) | QB | amount | usage | (trash)
const FEE_COLS =
  "minmax(160px, 1.6fr) 110px minmax(110px, 1.1fr) minmax(120px, 1.2fr) minmax(120px, 1.3fr) 100px 80px 24px";

const FEE_FIELDS: FieldSpec<AdditionalFee>[] = [
  { key: "name", label: "Fee name", kind: "text", required: true, placeholder: "Hoist Fee", col: 2 },
  { key: "amount", label: "Amount ($)", kind: "money", required: true, step: "1", placeholder: "85", col: 2 },
  {
    key: "cadence",
    label: "Cadence",
    kind: "select",
    required: true,
    col: 2,
    options: CADENCE_OPTIONS,
    hint: "One-time service, monthly add-on, or annual recurring fee.",
  },
  {
    key: "applies_to_entities",
    label: "Booking surfaces",
    kind: "multiselect",
    col: 2,
    options: ENTITY_OPTIONS,
    hint: "Which booking flows this fee is offered on. Leave all empty to surface everywhere.",
  },
  {
    key: "accounting_line_item",
    label: "QuickBooks line item",
    kind: "text",
    required: true,
    placeholder: "Marina services",
    col: 2,
  },
  {
    key: "linked_activity_type",
    label: "Linked work-order type",
    kind: "select",
    col: 2,
    hint: "Auto-attached to closeout invoices for matching WOs.",
    options: [
      { value: "", label: "— none —" },
      { value: "pump_out", label: "Pump-out" },
      { value: "winterization", label: "Winterization" },
      { value: "haul_out", label: "Haul out / Hoist" },
      { value: "bottom_paint", label: "Bottom paint" },
      { value: "service", label: "Service" },
      { value: "inspection", label: "Inspection" },
      { value: "task", label: "Task" },
      { value: "other", label: "Other" },
    ],
  },
  {
    key: "auto_attach",
    label: "Auto-attach on closeout",
    kind: "boolean",
    col: 2,
    hint: "If off, staff must opt-in per closeout.",
  },
  {
    key: "description",
    label: "Description",
    kind: "textarea",
    placeholder: "What holders see on the invoice line item.",
  },
];

/**
 * The fee's effective cadence — `cadence` (Phase-1 unified field) wins
 * over `recurrence` (legacy SKU-level field). Falls back to "one_time"
 * for rows that pre-date both.
 */
function effectiveCadence(f: AdditionalFee): FeeRecurrence {
  return (f.cadence ?? f.recurrence ?? "one_time") as FeeRecurrence;
}

export function FeesManager() {
  const fees = useFees();
  const usage = useFeeUsage();
  const canCreate = useCan("create", "fee");
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AdditionalFee | undefined>();

  // Toolbar filter state — slip-page list pattern: search +
  // dropdowns + Add button on one row.
  const [query, setQuery] = React.useState("");
  const [cadenceFilter, setCadenceFilter] = React.useState<string>("all");
  const [entityFilter, setEntityFilter] = React.useState<string>("all");

  // Snapshot counts per cadence for the filter dropdown labels.
  const counts = React.useMemo(() => {
    const out: Record<FeeRecurrence, number> = { one_time: 0, monthly: 0, annual: 0 };
    for (const f of fees) out[effectiveCadence(f)]++;
    return out;
  }, [fees]);

  // Filter + sort. Sort by cadence then alphabetical.
  const sortedFees = React.useMemo(() => {
    return [...fees]
      .filter((f) => {
        const c = effectiveCadence(f);
        if (cadenceFilter !== "all" && c !== cadenceFilter) return false;
        if (entityFilter !== "all") {
          const entities = f.applies_to_entities;
          // undefined entities = applies to all → include in any filter
          if (entities && entities.length > 0 && !entities.includes(entityFilter as never)) {
            return false;
          }
        }
        if (query.trim().length > 0) {
          const q = query.trim().toLowerCase();
          const hay = `${f.name} ${f.description ?? ""} ${f.accounting_line_item ?? ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const ca = CADENCE_ORDER.indexOf(effectiveCadence(a));
        const cb = CADENCE_ORDER.indexOf(effectiveCadence(b));
        if (ca !== cb) return ca - cb;
        return a.name.localeCompare(b.name);
      });
  }, [fees, query, cadenceFilter, entityFilter]);

  function openAdd() {
    setEditing(undefined);
    setOpen(true);
  }
  function openConfigure(fee: AdditionalFee) {
    setEditing(fee);
    setOpen(true);
  }
  function handleSave(values: AdditionalFee) {
    // applies_to_entities semantics: undefined = "applies to all three".
    // Empty array from the multiselect means "user cleared everything",
    // which we treat as the same all-entities default to avoid the dead
    // "narrowed to zero entities" state.
    const rawEntities = (values as AdditionalFee).applies_to_entities;
    const normalizedEntities =
      Array.isArray(rawEntities) && rawEntities.length === 0
        ? undefined
        : rawEntities;

    // Keep legacy `recurrence` in sync with the new `cadence` field so
    // the older SKU surfaces (POS, work-order closeout, annual run) keep
    // working without a parallel migration. If neither is set we land
    // on one_time.
    const cadence =
      (values.cadence as FeeRecurrence | undefined) ??
      (editing?.cadence as FeeRecurrence | undefined) ??
      editing?.recurrence ??
      "one_time";

    const final: AdditionalFee = {
      ...values,
      id: values.id || nextFeeId(),
      amount: Number(values.amount) || 0,
      // applies_to (surface scope) isn't editable in this dialog; keep
      // the existing value so we don't strip POS / work-order routing.
      applies_to: values.applies_to ?? editing?.applies_to ?? [],
      linked_template_id: values.linked_template_id ?? editing?.linked_template_id,
      cadence,
      recurrence: cadence,
      applies_to_entities: normalizedEntities,
    };
    upsertFee(final);
  }
  function handleDelete(fee: AdditionalFee) {
    if (!window.confirm(`Delete fee "${fee.name}"?`)) return;
    deleteFee(fee.id);
  }

  // Track the cadence boundaries so we can render grouped subheaders
  // between sections without duplicating the row template.
  const groupBoundaries = new Set<number>();
  let prev: FeeRecurrence | null = null;
  sortedFees.forEach((f, i) => {
    const c = effectiveCadence(f);
    if (c !== prev) {
      groupBoundaries.add(i);
      prev = c;
    }
  });

  return (
    <>
      {/* Single-row toolbar — mirrors the slip page pattern. */}
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-surface-1 p-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Fee name, description, GL line…"
            className="w-full rounded-[8px] border border-hairline bg-surface-2 py-1.5 pl-8 pr-3 text-[12px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
          />
        </div>

        <ListFilterSelect
          value={cadenceFilter}
          onChange={setCadenceFilter}
          label="Cadence"
          options={[
            { value: "all", label: `All · ${fees.length}` },
            { value: "one_time", label: `One-time · ${counts.one_time}` },
            { value: "monthly", label: `Monthly · ${counts.monthly}` },
            { value: "annual", label: `Annual · ${counts.annual}` },
          ]}
        />

        <ListFilterSelect
          value={entityFilter}
          onChange={setEntityFilter}
          label="Applies to"
          options={[
            { value: "all", label: "All entities" },
            { value: "reservation", label: "Reservation" },
            { value: "contract", label: "Contract" },
            { value: "club_subscription", label: "Club subscription" },
            { value: "rental_boat", label: "Rental boat" },
          ]}
        />

        {canCreate && (
          <Button variant="primary" size="sm" onClick={openAdd}>
            <Plus className="size-3.5" />
            New fee
          </Button>
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{ gridTemplateColumns: FEE_COLS }}
        >
          <span>Fee name</span>
          <span>Cadence</span>
          <span>Applies to</span>
          <span>Surfaces</span>
          <span>QB line</span>
          <span>Amount</span>
          <span>Usage</span>
          <span></span>
        </div>
        {sortedFees.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-fg-subtle">
            No fees configured. Click <span className="font-medium text-fg">New fee</span> to add one.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {sortedFees.map((f, i) => {
              const cadence = effectiveCadence(f);
              const meta = CADENCE_META[cadence];
              const count = usage.get(f.id) ?? 0;
              const entities = f.applies_to_entities;
              const isGroupStart = groupBoundaries.has(i);

              return (
                <React.Fragment key={f.id}>
                  {isGroupStart && (
                    <li
                      className="bg-surface-2/40 px-4 py-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
                      aria-hidden
                    >
                      {meta.label} ({counts[cadence]})
                    </li>
                  )}
                  <li className="group relative">
                    {/* Hover-only trash. Absolute so it isn't nested in the
                        row button. Delete is also reachable from the dialog. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDelete(f);
                      }}
                      className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-md p-1 text-fg-tertiary opacity-0 transition-opacity hover:bg-surface-3 hover:text-status-danger group-hover:opacity-100"
                      aria-label={`Delete ${f.name}`}
                      title="Delete fee"
                    >
                      <Trash2 className="size-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => openConfigure(f)}
                      style={{ gridTemplateColumns: FEE_COLS }}
                      className="grid w-full cursor-pointer items-center gap-x-3 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-2"
                      title="Configure fee"
                    >
                      <span className="min-w-0 truncate font-medium text-fg">
                        {f.name}
                      </span>
                      <span>
                        <span
                          className={`inline-flex items-center rounded-[6px] border px-1.5 py-0.5 text-[11px] font-medium ${meta.chip}`}
                        >
                          {meta.label}
                        </span>
                      </span>
                      <span className="flex min-w-0 flex-wrap gap-1">
                        {!entities || entities.length === 0 ? (
                          <Badge tone="outline" size="sm">
                            All entities
                          </Badge>
                        ) : (
                          entities.map((e) => (
                            <Badge key={e} tone="outline" size="sm">
                              {ENTITY_LABEL[e]}
                            </Badge>
                          ))
                        )}
                      </span>
                      <span className="flex min-w-0 flex-wrap gap-1">
                        {f.applies_to.length === 0 ? (
                          <span className="text-[11px] italic text-fg-tertiary">
                            Not surfaced
                          </span>
                        ) : (
                          f.applies_to.map((a) => (
                            <Badge key={a} tone="outline" size="sm">
                              {APPLIES_LABEL[a]}
                            </Badge>
                          ))
                        )}
                      </span>
                      <span className="min-w-0 truncate text-[12px] text-fg-subtle">
                        {f.accounting_line_item}
                      </span>
                      <span className="money-display text-fg">
                        {formatMoney(f.amount)}
                      </span>
                      <span className="text-[11px] text-fg-tertiary">
                        {count > 0 ? `${count} in use` : "—"}
                      </span>
                      <span />
                    </button>
                  </li>
                </React.Fragment>
              );
            })}
          </ul>
        )}
      </div>

      <RecordEditDialog<AdditionalFee>
        open={open}
        onOpenChange={setOpen}
        title={editing ? `Configure fee — ${editing.name}` : "New additional fee"}
        description="Fees catalog applies across all holders. Existing invoices keep the amount they were billed at."
        record={editing}
        fields={FEE_FIELDS}
        onSave={handleSave}
        onDelete={editing ? handleDelete : undefined}
        entity="fee"
      />
    </>
  );
}
