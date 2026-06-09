"use client";

import * as React from "react";
import { payBill } from "@/lib/client-store";
import { formatMoney } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import type { Bill, BillPaymentMethod } from "@/lib/types";

/*
 * Sheet to pay (or partial-pay) a vendor bill. Calls the
 * `payBill` store mutator which handles the BillPayment row,
 * status update on the Bill, and the ledger entry for the
 * cash outflow (Cash / Operating → Accounts Payable).
 */
export function PayBillSheet({
  bill,
  onClose,
}: {
  bill: Bill;
  onClose: () => void;
}) {
  const remaining = +(bill.amount - bill.amount_paid).toFixed(2);
  const [amount, setAmount] = React.useState(String(remaining));
  const [method, setMethod] = React.useState<BillPaymentMethod>("ach");
  const [paidAt, setPaidAt] = React.useState(
    new Date().toISOString().slice(0, 10)
  );
  const [checkNumber, setCheckNumber] = React.useState("");
  const [notes, setNotes] = React.useState("");

  function submit() {
    const num = Number(amount);
    if (!num || num <= 0) return;
    const id = payBill({
      bill_id: bill.id,
      amount: Math.min(num, remaining),
      method,
      paid_at: paidAt,
      check_number: method === "check" ? checkNumber.trim() || undefined : undefined,
      notes: notes.trim() || undefined,
    });
    if (id) {
      window.alert(
        `Payment posted — ${formatMoney(Math.min(num, remaining))}.`
      );
      onClose();
    } else {
      window.alert("Couldn't post payment. Check amount + try again.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[440px] rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-fg">
          Pay bill {bill.number}
        </h3>
        <p className="mt-1 text-[12px] text-fg-subtle">
          Remaining: {formatMoney(remaining)}
        </p>

        <div className="mt-4 space-y-3">
          <Field label="Amount *">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[14px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Method">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as BillPaymentMethod)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            >
              <option value="ach">ACH</option>
              <option value="check">Check</option>
              <option value="card">Card</option>
              <option value="wire">Wire</option>
              <option value="cash">Cash</option>
            </select>
          </Field>
          {method === "check" && (
            <Field label="Check number">
              <input
                value={checkNumber}
                onChange={(e) => setCheckNumber(e.target.value)}
                inputMode="numeric"
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
              />
            </Field>
          )}
          <Field label="Paid date">
            <input
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
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
            onClick={submit}
            disabled={!amount || Number(amount) <= 0}
            className={cn(
              "rounded-[10px] px-3 py-2 text-[13px] font-medium transition-colors",
              amount && Number(amount) > 0
                ? "bg-primary text-on-primary hover:bg-primary-hover"
                : "cursor-not-allowed bg-surface-3 text-fg-tertiary"
            )}
          >
            Post payment
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
