"use client";

import * as React from "react";
import { CreateSheet, Field, NumberInput, Select, Textarea, TextInput } from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { BOATERS, formatMoney } from "@/lib/mock-data";
import { useStore } from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";

export function EnterPaymentSheet({
  open,
  onOpenChange,
  defaultBoaterId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  defaultBoaterId?: string;
}) {
  const { ledger } = useStore();
  const [boaterId, setBoaterId] = React.useState(defaultBoaterId ?? "");
  const [amount, setAmount] = React.useState<string>("");
  const [method, setMethod] = React.useState<"card" | "cash" | "check" | "ach">("check");
  const [date, setDate] = React.useState<string>("");
  const [notes, setNotes] = React.useState("");
  const [appliedIds, setAppliedIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (open) {
      setBoaterId(defaultBoaterId ?? "");
      setAmount("");
      setMethod("check");
      setDate(new Date().toISOString().slice(0, 10));
      setNotes("");
      setAppliedIds([]);
    }
  }, [open, defaultBoaterId]);

  const boater = BOATERS.find((b) => b.id === boaterId);
  const openInvoices = ledger.filter(
    (l) => l.boater_id === boaterId && l.type === "invoice" && l.open_balance > 0
  );
  const totalOpen = openInvoices.reduce((s, l) => s + l.open_balance, 0);
  const numAmount = Number(amount) || 0;

  const canSubmit = boaterId.length > 0 && numAmount > 0;

  function toggleApplied(id: string) {
    setAppliedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function submit() {
    if (!canSubmit) return;
    executeAgentAction({
      kind: "record_payment",
      label: "",
      boater_id: boaterId,
      amount: numAmount,
      method,
      applied_to_invoice_ids: appliedIds.length > 0 ? appliedIds : undefined,
      notes: notes.trim() || undefined,
    });
    onOpenChange(false);
  }

  return (
    <CreateSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Enter payment"
      description="Manually record a payment received outside the POS — check, cash, or ACH."
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Holder" required>
          <Combobox
            value={boaterId}
            onChange={setBoaterId}
            options={BOATERS.map((b) => ({
              value: b.id,
              label: b.display_name,
              hint: b.code ? `· ${b.code}` : undefined,
            }))}
            placeholder="Pick a holder…"
            searchPlaceholder="Search by name, code…"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount" required hint={boater && totalOpen > 0 ? `Open balance: ${formatMoney(totalOpen)}` : undefined}>
            <NumberInput
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(v) => setMethod(v as typeof method)}>
              <option value="check">Check</option>
              <option value="cash">Cash</option>
              <option value="ach">ACH</option>
              <option value="card">Card (manual)</option>
            </Select>
          </Field>
        </div>

        <Field label="Date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        {openInvoices.length > 0 && (
          <Field label={`Apply to invoices (${appliedIds.length} selected)`}>
            <ul className="space-y-1.5 rounded-[8px] border border-hairline bg-surface-2 p-2">
              {openInvoices.map((inv) => {
                const checked = appliedIds.includes(inv.id);
                return (
                  <li key={inv.id}>
                    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-[13px] hover:bg-surface-3">
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleApplied(inv.id)}
                          className="size-3.5"
                        />
                        <span className="font-mono text-[12px] text-fg">{inv.number ?? inv.id.slice(-6)}</span>
                        <span className="text-fg-tertiary">·</span>
                        <span className="text-fg-subtle">{inv.date}</span>
                      </span>
                      <span className="tabular text-fg">{formatMoney(inv.open_balance)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </Field>
        )}

        <Field label="Notes">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Check #, memo, anything to remember…"
          />
        </Field>
      </div>
    </CreateSheet>
  );
}
