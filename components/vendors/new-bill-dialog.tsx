"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { nextBillId, upsertBill } from "@/lib/client-store";
import { formatMoney } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import type { BillLineItem, Vendor, VendorPaymentTerms } from "@/lib/types";

/*
 * Capture a new vendor bill. Auto-suggests the due_date from the
 * selected vendor's payment_terms. Line items must sum to the
 * total bill amount before save is enabled (operator can split
 * across GL accounts).
 */
export function NewBillDialog({
  onClose,
  vendors,
}: {
  onClose: () => void;
  vendors: Vendor[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [vendorId, setVendorId] = React.useState(vendors[0]?.id ?? "");
  const [number, setNumber] = React.useState("");
  const [billDate, setBillDate] = React.useState(today);
  const [dueDate, setDueDate] = React.useState(today);
  const [lines, setLines] = React.useState<BillLineItem[]>([
    { description: "", amount: 0, gl_account: "" },
  ]);
  const [notes, setNotes] = React.useState("");

  const vendor = vendors.find((v) => v.id === vendorId);

  // Auto-roll due_date from vendor's payment_terms on vendor change
  React.useEffect(() => {
    if (!vendor) return;
    setDueDate(rollDueDate(billDate, vendor.payment_terms));
    // also default GL account on each line that's blank
    setLines((prev) =>
      prev.map((l) =>
        l.gl_account ? l : { ...l, gl_account: vendor.default_gl_account ?? "" }
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  React.useEffect(() => {
    if (!vendor) return;
    setDueDate(rollDueDate(billDate, vendor.payment_terms));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billDate]);

  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const canSave = !!vendorId && number.trim() && total > 0;

  const vendorOptions: ComboboxOption[] = vendors.map((v) => ({
    value: v.id,
    label: v.display_name ?? v.name,
    hint: v.contact_name ?? undefined,
  }));

  function updateLine(idx: number, patch: Partial<BillLineItem>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [
      ...prev,
      { description: "", amount: 0, gl_account: vendor?.default_gl_account ?? "" },
    ]);
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function save() {
    if (!canSave) return;
    upsertBill({
      id: nextBillId(),
      tenant_id: "",
      vendor_id: vendorId,
      number: number.trim(),
      bill_date: billDate,
      due_date: dueDate,
      amount: +total.toFixed(2),
      amount_paid: 0,
      status: "open",
      line_items: lines
        .filter((l) => l.description.trim() && Number(l.amount) > 0)
        .map((l) => ({
          description: l.description.trim(),
          amount: Number(l.amount),
          gl_account: l.gl_account?.trim() || undefined,
        })),
      notes: notes.trim() || undefined,
      qb_sync_status: "pending",
      created_at: new Date().toISOString(),
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[640px] rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-fg">New bill</h3>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Vendor *" col={2}>
            <Combobox
              value={vendorId}
              onChange={setVendorId}
              options={vendorOptions}
              placeholder="Pick a vendor"
              searchPlaceholder="Search vendors…"
            />
          </Field>
          <Field label="Invoice # *">
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="PP-19421"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] font-mono text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Bill date">
            <input
              type="date"
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Due date" col={2}>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
            <p className="mt-0.5 text-[10px] text-fg-tertiary">
              {vendor
                ? `Auto-rolled from vendor's ${labelForTerms(vendor.payment_terms)} terms — adjust if needed.`
                : "Pick a vendor to auto-roll due date."}
            </p>
          </Field>
        </div>

        {/* Line items */}
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wide text-fg-tertiary">
              Line items
            </span>
            <button
              type="button"
              onClick={addLine}
              className="inline-flex items-center gap-1 rounded-[8px] border border-hairline px-2 py-1 text-[11px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              <Plus className="size-3" />
              Add line
            </button>
          </div>
          <ul className="space-y-2">
            {lines.map((l, idx) => (
              <li key={idx} className="grid grid-cols-12 items-center gap-2">
                <input
                  value={l.description}
                  onChange={(e) => updateLine(idx, { description: e.target.value })}
                  placeholder="Description"
                  className="col-span-6 block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[12px] text-fg focus:border-primary focus:outline-none"
                />
                <input
                  value={l.gl_account ?? ""}
                  onChange={(e) => updateLine(idx, { gl_account: e.target.value })}
                  placeholder="GL account"
                  className="col-span-3 block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[12px] text-fg focus:border-primary focus:outline-none"
                />
                <input
                  value={l.amount || ""}
                  onChange={(e) =>
                    updateLine(idx, { amount: Number(e.target.value) || 0 })
                  }
                  inputMode="decimal"
                  placeholder="0.00"
                  className="col-span-2 block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-right text-[12px] font-mono text-fg focus:border-primary focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeLine(idx)}
                  className="col-span-1 inline-flex items-center justify-center rounded-[8px] text-fg-tertiary hover:bg-surface-2 hover:text-status-danger"
                  aria-label="Remove line"
                  disabled={lines.length === 1}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t border-hairline pt-2 text-[12px]">
            <span className="text-fg-subtle">Total</span>
            <span className="money-display text-[15px] text-fg">
              {formatMoney(total)}
            </span>
          </div>
        </div>

        <div className="mt-3">
          <Field label="Notes">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] px-3 py-1.5 text-[13px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className={cn(
              "rounded-[10px] px-3 py-2 text-[13px] font-medium transition-colors",
              canSave
                ? "bg-primary text-on-primary hover:bg-primary-hover"
                : "cursor-not-allowed bg-surface-3 text-fg-tertiary"
            )}
          >
            Save bill
          </button>
        </div>
      </div>
    </div>
  );
}

function rollDueDate(billDate: string, terms: VendorPaymentTerms): string {
  const d = new Date(billDate);
  const days =
    terms === "due_on_receipt"
      ? 0
      : terms === "net_7"
      ? 7
      : terms === "net_15"
      ? 15
      : terms === "net_30"
      ? 30
      : 60;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function labelForTerms(t: VendorPaymentTerms) {
  switch (t) {
    case "due_on_receipt":
      return "Due on receipt";
    case "net_7":
      return "Net 7";
    case "net_15":
      return "Net 15";
    case "net_30":
      return "Net 30";
    case "net_60":
      return "Net 60";
  }
}

function Field({
  label,
  col = 1,
  children,
}: {
  label: string;
  col?: 1 | 2;
  children: React.ReactNode;
}) {
  return (
    <div className={col === 2 ? "col-span-2" : ""}>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
