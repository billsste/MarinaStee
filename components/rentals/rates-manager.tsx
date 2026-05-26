"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import {
  deleteRate,
  nextRateId,
  upsertRate,
  useRates,
} from "@/lib/client-store";
import { useCan } from "@/lib/auth";
import { formatMoney } from "@/lib/mock-data";
import type { OccupancyType, Rate, RateCadence } from "@/lib/types";

/*
 * /docks/rates — primary interactive surface for slip rates.
 *
 * Implements the user mandate: every row can be Edit / Remove / Add via a
 * centered pop-up. Click any rate row → opens the edit dialog. Use the
 * "+ Add rate" button on each occupancy-type card → opens the same dialog
 * in create mode pre-set to that occupancy type.
 */

const CADENCE_ORDER: RateCadence[] = ["annual", "seasonal", "monthly", "weekly", "daily"];
const ALL_OCCUPANCY: OccupancyType[] = ["Standard", "Jet Ski", "Buoy", "Dry Storage", "Mooring"];

const RATE_FIELDS: FieldSpec<Rate>[] = [
  { key: "name", label: "Rate name", kind: "text", required: true, col: 2, placeholder: "2027 Annual Slip — Standard" },
  { key: "amount", label: "Amount ($)", kind: "money", required: true, col: 2, step: "1", placeholder: "3900" },
  {
    key: "occupancy_type",
    label: "Occupancy type",
    kind: "select",
    required: true,
    col: 2,
    options: ALL_OCCUPANCY.map((o) => ({ value: o, label: o })),
  },
  {
    key: "cadence",
    label: "Cadence",
    kind: "select",
    required: true,
    col: 2,
    options: CADENCE_ORDER.map((c) => ({ value: c, label: c })),
  },
  { key: "effective_start", label: "Effective start", kind: "date", col: 2, hint: "Optional — leave blank for indefinite." },
  { key: "effective_end", label: "Effective end", kind: "date", col: 2 },
];

export function RatesManager() {
  const rates = useRates();
  const canCreate = useCan("create", "rate");
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Rate | undefined>(undefined);
  const [defaultOccupancy, setDefaultOccupancy] = React.useState<OccupancyType | null>(null);

  const byType = rates.reduce<Record<string, Rate[]>>((acc, r) => {
    (acc[r.occupancy_type] ||= []).push(r);
    return acc;
  }, {});

  function openAdd(occupancyType?: OccupancyType) {
    setEditing(undefined);
    setDefaultOccupancy(occupancyType ?? null);
    setOpen(true);
  }
  function openEdit(rate: Rate) {
    setEditing(rate);
    setDefaultOccupancy(null);
    setOpen(true);
  }
  function handleSave(values: Rate) {
    const final: Rate = {
      ...values,
      id: values.id || nextRateId(),
      amount: Number(values.amount) || 0,
    };
    upsertRate(final);
  }
  function handleDelete(rate: Rate) {
    deleteRate(rate.id);
  }

  // Seed an "add" with the clicked occupancy type pre-filled
  const seedRecord: Rate | undefined = editing
    ? editing
    : defaultOccupancy
      ? ({
          id: "",
          name: "",
          occupancy_type: defaultOccupancy,
          cadence: "annual",
          amount: 0,
        } as Rate)
      : undefined;

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-fg-tertiary">
          Click any rate to edit it. Use <span className="font-medium text-fg-subtle">+ Add rate</span> on a card to create a new one for that occupancy type.
        </p>
        {canCreate && (
          <Button variant="primary" size="sm" onClick={() => openAdd()}>
            <Plus className="size-3.5" />
            New rate
          </Button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {ALL_OCCUPANCY.map((type) => {
          const list = (byType[type] ?? []).sort(
            (a, b) => CADENCE_ORDER.indexOf(a.cadence) - CADENCE_ORDER.indexOf(b.cadence)
          );
          return (
            <div key={type} className="rounded-[12px] border border-hairline bg-surface-1">
              <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
                <h3 className="text-[14px] font-medium text-fg">{type}</h3>
                {canCreate && (
                  <Button variant="ghost" size="sm" onClick={() => openAdd(type)}>
                    <Plus className="size-3" />
                    Add rate
                  </Button>
                )}
              </div>
              {list.length === 0 ? (
                <div className="px-4 py-6 text-center text-[12px] text-fg-tertiary">
                  No rates configured for {type}.
                </div>
              ) : (
                <ul className="divide-y divide-hairline">
                  {list.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-fg">{r.name}</div>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-tertiary">
                            <Badge tone="outline" size="sm">{r.cadence}</Badge>
                            {r.effective_start && r.effective_end && (
                              <span>
                                {r.effective_start} → {r.effective_end}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="money-display text-[20px] text-fg">{formatMoney(r.amount)}</div>
                          <div className="text-[11px] text-fg-tertiary">/ {r.cadence}</div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <RecordEditDialog<Rate>
        open={open}
        onOpenChange={setOpen}
        title={editing ? `Edit rate — ${editing.name}` : "New rate"}
        description="Slip rates apply to reservations and contract drafts. Existing contracts keep the rate they were signed at."
        record={seedRecord}
        fields={RATE_FIELDS}
        onSave={handleSave}
        onDelete={editing ? handleDelete : undefined}
        entity="rate"
      />
    </>
  );
}
