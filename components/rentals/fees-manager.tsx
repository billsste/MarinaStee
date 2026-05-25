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
  useFees,
} from "@/lib/client-store";
import { formatMoney } from "@/lib/mock-data";
import type { AdditionalFee, FeeBillingMode } from "@/lib/types";

/*
 * /rentals/fees — Edit/Remove/Add for the additional-fee catalog.
 * Click a card to edit, "+ New additional fee" tile to create, delete inside
 * the dialog. Same RecordEditDialog as Rates.
 */

const FEE_ICONS: Record<string, React.ReactNode> = {
  fee_hoist: <Anchor className="size-4" />,
  fee_transfer: <ArrowLeftRight className="size-4" />,
  fee_pump_out: <Droplets className="size-4" />,
  fee_winterize: <Snowflake className="size-4" />,
  fee_storage_move: <Move3D className="size-4" />,
  fee_pet_fee: <PawPrint className="size-4" />,
};

const BILLING_LABEL: Record<FeeBillingMode, string> = {
  single_billing: "One-time",
  bill_with_rental: "Add to rental invoice",
  recurring_monthly: "Recurring monthly",
  recurring_annual: "Recurring annual",
};

const BILLING_TONE: Record<FeeBillingMode, "ok" | "warn" | "info" | "neutral"> = {
  single_billing: "neutral",
  bill_with_rental: "info",
  recurring_monthly: "warn",
  recurring_annual: "warn",
};

const FEE_FIELDS: FieldSpec<AdditionalFee>[] = [
  { key: "name", label: "Fee name", kind: "text", required: true, placeholder: "Hoist Fee" },
  { key: "amount", label: "Amount ($)", kind: "money", required: true, step: "1", placeholder: "85" },
  {
    key: "billing_mode",
    label: "Billing mode",
    kind: "select",
    required: true,
    options: [
      { value: "single_billing", label: "One-time" },
      { value: "bill_with_rental", label: "Add to rental invoice" },
      { value: "recurring_monthly", label: "Recurring monthly" },
      { value: "recurring_annual", label: "Recurring annual" },
    ],
  },
  {
    key: "accounting_line_item",
    label: "QuickBooks line item",
    kind: "text",
    required: true,
    placeholder: "Marina services",
  },
  {
    key: "description",
    label: "Description",
    kind: "textarea",
    placeholder: "What boaters see on the invoice line item.",
  },
];

export function FeesManager() {
  const fees = useFees();
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
          Click a fee to edit. Use <span className="font-medium text-fg-subtle">+ New fee</span> to add to the catalog.
        </p>
        <Button variant="primary" size="sm" onClick={openAdd}>
          <Plus className="size-3.5" />
          New fee
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {fees.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => openEdit(f)}
            className="rounded-[12px] border border-hairline bg-surface-1 p-4 text-left transition-colors hover:border-hairline-strong hover:bg-surface-2"
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="flex size-9 items-center justify-center rounded-[8px] bg-surface-3 text-primary">
                {FEE_ICONS[f.id] ?? <Anchor className="size-4" />}
              </div>
              <Badge tone={BILLING_TONE[f.billing_mode]} size="sm">
                {BILLING_LABEL[f.billing_mode]}
              </Badge>
            </div>
            <h3 className="text-[14px] font-medium text-fg">{f.name}</h3>
            {f.description && (
              <p className="mt-1 line-clamp-2 text-[12px] text-fg-subtle">{f.description}</p>
            )}
            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="money-display text-[24px] text-fg">{formatMoney(f.amount)}</div>
                <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
                  {f.accounting_line_item}
                </div>
              </div>
              <span className="text-[11px] text-fg-tertiary group-hover:text-fg">Edit →</span>
            </div>
          </button>
        ))}

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
        description="Fees catalog applies across all boaters. Existing invoices keep the amount they were billed at."
        record={editing}
        fields={FEE_FIELDS}
        onSave={handleSave}
        onDelete={editing ? handleDelete : undefined}
      />
    </>
  );
}
