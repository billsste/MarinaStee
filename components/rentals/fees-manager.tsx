"use client";

import * as React from "react";
import { Anchor, ArrowLeftRight, Droplets, Move3D, PawPrint, Plus, Snowflake } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
 * /slips/fees — Edit/Remove/Add for the additional-fee catalog.
 *
 * Fees are the canonical SKU table. Each fee's recurrence + applies_to +
 * linked_activity_type drive where it shows up:
 *   - applies_to: slip_contract → Services step on the assign-slip wizard
 *   - applies_to: work_order    → auto-attached on WO closeout (when
 *                                  linked_activity_type matches WO type)
 *   - applies_to: boat_rental   → auto-attached on rental closeout
 *   - applies_to: pos           → quick-add tile in POS terminal palette
 *   - applies_to: annual_billing_run → rolled into every annual invoice
 */

const FEE_ICONS: Record<string, React.ReactNode> = {
  fee_hoist: <Anchor className="size-4" />,
  fee_transfer: <ArrowLeftRight className="size-4" />,
  fee_pump_out: <Droplets className="size-4" />,
  fee_winterize: <Snowflake className="size-4" />,
  fee_storage_move: <Move3D className="size-4" />,
  fee_pet_fee: <PawPrint className="size-4" />,
};

const RECURRENCE_LABEL: Record<FeeRecurrence, string> = {
  one_time: "One-time",
  monthly: "Monthly",
  annual: "Annual",
};

const RECURRENCE_TONE: Record<FeeRecurrence, "ok" | "warn" | "info" | "neutral"> = {
  one_time: "neutral",
  monthly: "info",
  annual: "warn",
};

const APPLIES_LABEL: Record<FeeAppliesTo, string> = {
  slip_contract: "Slip contracts",
  work_order: "Work orders",
  boat_rental: "Boat rentals",
  pos: "POS",
  annual_billing_run: "Annual run",
};

const FEE_FIELDS: FieldSpec<AdditionalFee>[] = [
  { key: "name", label: "Fee name", kind: "text", required: true, placeholder: "Hoist Fee", col: 2 },
  { key: "amount", label: "Amount ($)", kind: "money", required: true, step: "1", placeholder: "85", col: 2 },
  {
    key: "recurrence",
    label: "Recurrence",
    kind: "select",
    required: true,
    col: 2,
    options: [
      { value: "one_time", label: "One-time" },
      { value: "monthly", label: "Monthly" },
      { value: "annual", label: "Annual" },
    ],
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

export function FeesManager() {
  const fees = useFees();
  const usage = useFeeUsage();
  const canCreate = useCan("create", "fee");
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AdditionalFee | undefined>(undefined);

  function openAdd() {
    setEditing(undefined);
    setOpen(true);
  }
  function openEdit(fee: AdditionalFee) {
    setEditing(fee);
    setOpen(true);
  }
  function handleSave(values: AdditionalFee) {
    const final: AdditionalFee = {
      ...values,
      id: values.id || nextFeeId(),
      amount: Number(values.amount) || 0,
      // Preserve applies_to + linked_template_id across edits — these
      // aren't surfaced in the basic field form yet but must round-trip
      // so the sync invariants stay intact.
      applies_to: values.applies_to ?? editing?.applies_to ?? [],
      linked_template_id: values.linked_template_id ?? editing?.linked_template_id,
    };
    upsertFee(final);
  }
  function handleDelete(fee: AdditionalFee) {
    deleteFee(fee.id);
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-fg-tertiary">
          Click a fee to edit. Fees are referenced by Work Orders, Contracts,
          POS, and the Annual run — editing the amount flows everywhere.
        </p>
        {canCreate && (
          <Button variant="primary" size="sm" onClick={openAdd}>
            <Plus className="size-3.5" />
            New fee
          </Button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {fees.map((f) => {
          const count = usage.get(f.id) ?? 0;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => openEdit(f)}
              className="rounded-[12px] border border-hairline bg-surface-1 p-4 text-left transition-colors hover:border-hairline-strong hover:bg-surface-2"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex size-9 items-center justify-center rounded-[8px] bg-surface-3 text-primary">
                  {FEE_ICONS[f.id] ?? <Anchor className="size-4" />}
                </div>
                <Badge tone={RECURRENCE_TONE[f.recurrence]} size="sm">
                  {RECURRENCE_LABEL[f.recurrence]}
                </Badge>
              </div>
              <h3 className="text-[14px] font-medium text-fg">{f.name}</h3>
              {f.description && (
                <p className="mt-1 line-clamp-2 text-[12px] text-fg-subtle">{f.description}</p>
              )}
              {/* applies_to chips — show where the fee surfaces */}
              {f.applies_to.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {f.applies_to.map((a) => (
                    <span
                      key={a}
                      className="rounded-full border border-hairline px-1.5 py-0.5 text-[10px] text-fg-subtle"
                    >
                      {APPLIES_LABEL[a]}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <div className="money-display text-[24px] text-fg">{formatMoney(f.amount)}</div>
                  <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
                    {f.accounting_line_item}
                  </div>
                </div>
                <span className="text-right text-[10px] text-fg-tertiary">
                  {count > 0 ? (
                    <span title="Times applied across all records">
                      {count} in use
                    </span>
                  ) : (
                    "—"
                  )}
                  <span className="ml-2 text-fg-tertiary group-hover:text-fg">Edit →</span>
                </span>
              </div>
            </button>
          );
        })}

        <button
          type="button"
          onClick={openAdd}
          className="flex min-h-[180px] flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-hairline-strong bg-surface-1 p-4 text-fg-subtle transition-colors hover:border-primary/50 hover:text-fg"
        >
          <span className="text-[20px] font-semibold">+</span>
          <span className="text-[13px]">New additional fee</span>
          <span className="text-[11px] text-fg-tertiary">Or ask the agent to draft one</span>
        </button>
      </div>

      <RecordEditDialog<AdditionalFee>
        open={open}
        onOpenChange={setOpen}
        title={editing ? `Edit fee — ${editing.name}` : "New additional fee"}
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
