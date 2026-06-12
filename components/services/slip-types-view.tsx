"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/mock-data";
import {
  addSlipType,
  deleteSlipType,
  updateSlipType,
  useFees,
  useSlipTypes,
  useSlips,
} from "@/lib/client-store";
import { groupSlipsByType } from "@/lib/slip-type-helpers";
import type { SlipClass, SlipType } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * Slip Types CRUD surface.
 *
 * Operators rarely add a class but routinely tune size bands + pricing
 * (renewals season, market shifts). Layout reflects that: types render
 * grouped by class (covered first, then uncovered, t-head, buoy, dry
 * storage) with each row clickable to expand into an inline edit form.
 *
 * Each row shows at-a-glance:
 *   - display label
 *   - size band (LOA range)
 *   - annual / monthly / seasonal rates
 *   - included-fee count + amenity chips
 *   - count of slips currently in this tier
 *
 * Edit-in-place follows global §6.1 — click the row, autoFocus the
 * first field, Enter saves, Esc cancels.
 */

const CLASS_ORDER: SlipClass[] = [
  "covered",
  "uncovered",
  "t_head",
  "buoy",
  "dry_storage",
];
const CLASS_LABEL: Record<SlipClass, string> = {
  covered: "Covered",
  uncovered: "Uncovered",
  t_head: "T-head",
  buoy: "Buoy / Mooring",
  dry_storage: "Dry storage",
};

export function SlipTypesView() {
  const types = useSlipTypes();
  const slips = useSlips();
  const fees = useFees();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [addingClass, setAddingClass] = React.useState<SlipClass | null>(null);

  // Resolved slip → type so each row can show "12 slips in this tier".
  const slipsByType = React.useMemo(
    () => groupSlipsByType(slips, types),
    [slips, types],
  );

  // Group types by class for the section headers.
  const typesByClass = React.useMemo(() => {
    const map = new Map<SlipClass, SlipType[]>();
    for (const c of CLASS_ORDER) map.set(c, []);
    for (const t of types) {
      map.get(t.class)?.push(t);
    }
    return map;
  }, [types]);

  function close() {
    setEditingId(null);
    setAddingClass(null);
  }

  return (
    <div className="space-y-6">
      {CLASS_ORDER.map((cls) => {
        const rows = typesByClass.get(cls) ?? [];
        const slipsInClass = slips.filter((s) => s.slip_class === cls).length;
        return (
          <section
            key={cls}
            className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1"
          >
            {/* Class header — count + add button */}
            <header className="flex items-center justify-between gap-3 border-b border-hairline bg-surface-2 px-4 py-2.5">
              <div className="flex items-baseline gap-2.5">
                <h2 className="text-[14px] font-semibold text-fg">
                  {CLASS_LABEL[cls]}
                </h2>
                <span className="text-[11.5px] text-fg-tertiary tabular">
                  {rows.length} tier{rows.length === 1 ? "" : "s"} · {slipsInClass} slip
                  {slipsInClass === 1 ? "" : "s"}
                </span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditingId(null);
                  setAddingClass(cls);
                }}
              >
                <Plus className="size-3.5" /> Add tier
              </Button>
            </header>

            {/* Inline add form for this class */}
            {addingClass === cls && (
              <EditForm
                initial={blankType(cls, rows.length)}
                feesList={fees}
                onCancel={close}
                onSave={(next) => {
                  addSlipType(next);
                  close();
                }}
              />
            )}

            {/* Rows */}
            {rows.length === 0 && addingClass !== cls ? (
              <div className="px-4 py-8 text-center text-[13px] text-fg-subtle">
                No tiers configured for {CLASS_LABEL[cls]}. Click{" "}
                <span className="font-medium text-fg">+ Add tier</span> to
                create one.
              </div>
            ) : (
              <ul className="divide-y divide-hairline">
                {rows.map((t) => {
                  const slipCount = slipsByType.get(t.id)?.length ?? 0;
                  const isEditing = editingId === t.id;
                  if (isEditing) {
                    return (
                      <li key={t.id}>
                        <EditForm
                          initial={t}
                          feesList={fees}
                          onCancel={close}
                          onSave={(next) => {
                            updateSlipType(t.id, next);
                            close();
                          }}
                          onDelete={() => {
                            if (
                              window.confirm(
                                `Deactivate "${t.display_label}"? Slips currently in this tier will fall back to a derived match.`,
                              )
                            ) {
                              deleteSlipType(t.id);
                              close();
                            }
                          }}
                        />
                      </li>
                    );
                  }
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setAddingClass(null);
                          setEditingId(t.id);
                        }}
                        className={cn(
                          "grid w-full grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 px-4 py-3 text-left transition-colors hover:bg-surface-2/60",
                          !t.active && "opacity-50",
                        )}
                      >
                        {/* Label + range */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[13.5px] font-medium text-fg">
                            {t.display_label}
                            {!t.active && (
                              <Badge tone="neutral" size="sm">
                                Inactive
                              </Badge>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-fg-tertiary">
                            <span className="tabular">
                              {sizeBandLabel(t)}
                            </span>
                            <span>·</span>
                            <span>{slipCount} slip{slipCount === 1 ? "" : "s"}</span>
                            {t.included_fee_ids.length > 0 && (
                              <>
                                <span>·</span>
                                <span>
                                  {t.included_fee_ids.length} fee
                                  {t.included_fee_ids.length === 1 ? "" : "s"} auto-attached
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Amenity chips */}
                        <div className="flex items-center gap-1">
                          {t.included_amenities.power && (
                            <Badge tone="outline" size="sm">
                              Power
                            </Badge>
                          )}
                          {t.included_amenities.water && (
                            <Badge tone="outline" size="sm">
                              Water
                            </Badge>
                          )}
                          {t.included_amenities.pump_out && (
                            <Badge tone="outline" size="sm">
                              Pump-out
                            </Badge>
                          )}
                        </div>

                        {/* Rates — compact table */}
                        <div className="flex items-center gap-3 text-[12px] text-fg-muted">
                          <RateCell label="Annual" value={t.default_annual_rate} />
                          <RateCell
                            label="Monthly"
                            value={t.default_monthly_rate}
                          />
                          <RateCell
                            label="Seasonal"
                            value={t.default_seasonal_rate}
                          />
                        </div>

                        <ChevronDown className="size-3.5 text-fg-tertiary" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Edit form (inline)
// ─────────────────────────────────────────────────────────────────────

function EditForm({
  initial,
  feesList,
  onCancel,
  onSave,
  onDelete,
}: {
  initial: SlipType;
  feesList: ReturnType<typeof useFees>;
  onCancel: () => void;
  onSave: (next: SlipType) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = React.useState<SlipType>(initial);

  function patch<K extends keyof SlipType>(key: K, value: SlipType[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toggleAmenity(k: "power" | "water" | "pump_out") {
    setDraft((d) => ({
      ...d,
      included_amenities: {
        ...d.included_amenities,
        [k]: !d.included_amenities[k],
      },
    }));
  }
  function toggleFee(feeId: string) {
    setDraft((d) => ({
      ...d,
      included_fee_ids: d.included_fee_ids.includes(feeId)
        ? d.included_fee_ids.filter((id) => id !== feeId)
        : [...d.included_fee_ids, feeId],
    }));
  }

  return (
    <div
      className="space-y-4 border-y border-primary/30 bg-primary-soft/30 px-4 py-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave(draft);
      }}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Display label" required>
          <input
            autoFocus
            type="text"
            value={draft.display_label}
            onChange={(e) => patch("display_label", e.target.value)}
            className="w-full rounded-[8px] border border-hairline bg-surface-1 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
          />
        </Field>
        <Field label="Short label">
          <input
            type="text"
            value={draft.short_label}
            onChange={(e) => patch("short_label", e.target.value)}
            placeholder="C30–40"
            className="w-full rounded-[8px] border border-hairline bg-surface-1 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Field label="Min LOA (ft)" hint="Leave blank for no minimum.">
          <input
            type="text"
            inputMode="numeric"
            value={
              draft.min_loa_inches == null
                ? ""
                : Math.round(draft.min_loa_inches / 12).toString()
            }
            onChange={(e) =>
              patch(
                "min_loa_inches",
                e.target.value === "" ? undefined : Number(e.target.value) * 12,
              )
            }
            className="w-full rounded-[8px] border border-hairline bg-surface-1 px-2.5 py-1.5 text-[13px] text-fg tabular focus:border-primary focus:outline-none"
          />
        </Field>
        <Field label="Max LOA (ft)" required>
          <input
            type="text"
            inputMode="numeric"
            value={Math.round(draft.max_loa_inches / 12).toString()}
            onChange={(e) =>
              patch("max_loa_inches", Number(e.target.value) * 12)
            }
            className="w-full rounded-[8px] border border-hairline bg-surface-1 px-2.5 py-1.5 text-[13px] text-fg tabular focus:border-primary focus:outline-none"
          />
        </Field>
        <Field label="Sort order">
          <input
            type="text"
            inputMode="numeric"
            value={draft.sort_order.toString()}
            onChange={(e) => patch("sort_order", Number(e.target.value) || 0)}
            className="w-full rounded-[8px] border border-hairline bg-surface-1 px-2.5 py-1.5 text-[13px] text-fg tabular focus:border-primary focus:outline-none"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MoneyField
          label="Annual rate"
          value={draft.default_annual_rate}
          // Annual rate is required on the SlipType, so coerce undefined
          // (user cleared the field) back to 0 — operator can fix up
          // before saving but the type stays well-formed.
          onChange={(v) => patch("default_annual_rate", v ?? 0)}
          required
        />
        <MoneyField
          label="Monthly rate"
          value={draft.default_monthly_rate}
          onChange={(v) => patch("default_monthly_rate", v)}
        />
        <MoneyField
          label="Seasonal rate"
          value={draft.default_seasonal_rate}
          onChange={(v) => patch("default_seasonal_rate", v)}
        />
        <MoneyField
          label="Transient /night"
          value={draft.default_transient_rate_per_night}
          onChange={(v) => patch("default_transient_rate_per_night", v)}
        />
      </div>

      <Field label="Description">
        <input
          type="text"
          value={draft.description ?? ""}
          onChange={(e) => patch("description", e.target.value)}
          placeholder="Short context shown on the type's tooltip + the assign-slip wizard."
          className="w-full rounded-[8px] border border-hairline bg-surface-1 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
        />
      </Field>

      {/* Amenities + Fees side-by-side */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <FieldLabel>Included amenities</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { key: "power", label: "Shore power" },
                { key: "water", label: "Water" },
                { key: "pump_out", label: "Pump-out" },
              ] as const
            ).map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => toggleAmenity(a.key)}
                className={cn(
                  "rounded-[8px] border px-2.5 py-1 text-[12px] font-medium transition-colors",
                  draft.included_amenities[a.key]
                    ? "border-primary/30 bg-primary-soft text-primary"
                    : "border-hairline bg-surface-1 text-fg-subtle hover:bg-surface-2",
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <FieldLabel>
            Auto-attached fees
            <span className="ml-1 text-[11px] font-normal text-fg-tertiary">
              ({draft.included_fee_ids.length} selected)
            </span>
          </FieldLabel>
          {feesList.length === 0 ? (
            <p className="text-[12px] text-fg-tertiary">
              No fees configured yet. Add fees on{" "}
              <span className="font-medium text-fg">/services/fees</span>.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {feesList.map((f) => {
                const on = draft.included_fee_ids.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggleFee(f.id)}
                    className={cn(
                      "rounded-[8px] border px-2.5 py-1 text-[12px] font-medium transition-colors",
                      on
                        ? "border-primary/30 bg-primary-soft text-primary"
                        : "border-hairline bg-surface-1 text-fg-subtle hover:bg-surface-2",
                    )}
                  >
                    {f.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => onSave(draft)}>
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X className="size-3.5" /> Cancel
          </Button>
        </div>
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-status-danger hover:bg-status-danger/10"
          >
            <Trash2 className="size-3.5" /> Deactivate
          </Button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <FieldLabel required={required}>{label}</FieldLabel>
      {children}
      {hint && (
        <p className="mt-0.5 text-[11px] text-fg-tertiary">{hint}</p>
      )}
    </div>
  );
}

function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
      {children}
      {required && <span className="ml-0.5 text-status-danger">*</span>}
    </label>
  );
}

function MoneyField({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  required?: boolean;
}) {
  return (
    <Field label={label} required={required}>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[12px] text-fg-tertiary">
          $
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={value == null ? "" : value.toString()}
          onChange={(e) =>
            onChange(
              e.target.value === ""
                ? undefined
                : Number(e.target.value.replace(/[^0-9.]/g, "")),
            )
          }
          className="w-full rounded-[8px] border border-hairline bg-surface-1 py-1.5 pl-6 pr-2.5 text-[13px] text-fg tabular focus:border-primary focus:outline-none"
        />
      </div>
    </Field>
  );
}

function RateCell({ label, value }: { label: string; value?: number }) {
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
        {label}
      </div>
      <div className={value == null ? "text-fg-tertiary" : "tabular text-fg"}>
        {value == null ? "—" : formatMoney(value)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function sizeBandLabel(t: SlipType): string {
  const max = Math.round(t.max_loa_inches / 12);
  if (t.min_loa_inches == null) return `Up to ${max} ft`;
  const min = Math.round(t.min_loa_inches / 12);
  if (max >= 999) return `${min}+ ft`;
  return `${min}–${max} ft`;
}

function blankType(cls: SlipClass, existingInClass: number): SlipType {
  const id = `st_new_${Date.now().toString(36)}`;
  return {
    id,
    tenant_id: "",
    class: cls,
    max_loa_inches: 40 * 12,
    display_label: `New ${cls.replace("_", " ")} tier`,
    short_label: cls.slice(0, 1).toUpperCase(),
    default_annual_rate: 0,
    included_amenities: {},
    included_fee_ids: [],
    sort_order: existingInClass * 10 + 99,
    active: true,
  };
}

// Suppress unused import warning for icons referenced only when adjusting
// layout. ChevronUp is reserved for future ordering controls.
void ChevronUp;
