"use client";

import * as React from "react";
import { CreditCard, Lock } from "lucide-react";
import { CreateSheet, Field, NumberInput, Select, TextInput } from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/mock-data";
import { useCardsForBoater, useLedgerForBoater } from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";

/*
 * Boater-facing pay sheet. Optionally preset to a single invoice. Posts
 * a `record_payment` action which (via the executor) writes a payment
 * ledger entry and calls applyPaymentToInvoices to close the targeted
 * invoice(s). Reflects on the admin Financials tab + Notifications
 * immediately.
 */
export function PortalPaySheet({
  open,
  onOpenChange,
  boaterId,
  invoiceId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  boaterId: string;
  invoiceId?: string;
}) {
  const ledger = useLedgerForBoater(boaterId);
  const cards = useCardsForBoater(boaterId);

  const openInvoices = ledger
    .filter((l) => l.type === "invoice" && l.open_balance > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const totalOpen = openInvoices.reduce((s, l) => s + l.open_balance, 0);
  const targetInvoice = invoiceId ? openInvoices.find((i) => i.id === invoiceId) : null;
  const defaultAmount = targetInvoice ? targetInvoice.open_balance : totalOpen;

  const [amount, setAmount] = React.useState(defaultAmount.toFixed(2));
  const [method, setMethod] = React.useState<"card" | "ach">(
    cards.length > 0 ? "card" : "ach"
  );
  const [cardId, setCardId] = React.useState<string>(cards[0]?.id ?? "");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setAmount(defaultAmount.toFixed(2));
      setMethod(cards.length > 0 ? "card" : "ach");
      setCardId(cards[0]?.id ?? "");
      setSubmitting(false);
    }
  }, [open, defaultAmount, cards]);

  const numericAmount = Number(amount);
  const canSubmit = numericAmount > 0 && numericAmount <= totalOpen + 0.01 && !submitting;

  function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    // Brief simulated "processing" delay so the demo feels real.
    setTimeout(() => {
      executeAgentAction({
        kind: "record_payment",
        label: "",
        boater_id: boaterId,
        amount: numericAmount,
        method,
        applied_to_invoice_ids: invoiceId ? [invoiceId] : undefined,
        notes:
          method === "card"
            ? `Self-service portal payment via card${cardId ? ` ${cardId.slice(-6)}` : ""}`
            : "Self-service portal payment via ACH",
      });
      onOpenChange(false);
    }, 700);
  }

  return (
    <CreateSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Pay your balance"
      description={
        targetInvoice
          ? `Paying invoice ${targetInvoice.number ?? targetInvoice.id.slice(-6)}.`
          : `Pay any amount up to ${formatMoney(totalOpen)}.`
      }
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            <Lock className="size-3.5" />
            {submitting ? "Processing…" : `Pay ${formatMoney(numericAmount || 0)}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Amount" required hint={`Open balance: ${formatMoney(totalOpen)}`}>
          <NumberInput
            min="0.01"
            max={totalOpen.toFixed(2)}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={Boolean(targetInvoice)}
          />
        </Field>

        <Field label="Method" required>
          <Select value={method} onChange={(v) => setMethod(v as typeof method)}>
            {cards.length > 0 && <option value="card">Card on file</option>}
            <option value="ach">Bank transfer (ACH)</option>
          </Select>
        </Field>

        {method === "card" && cards.length > 0 && (
          <Field label="Card">
            <Select value={cardId} onChange={setCardId}>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.brand} ····{c.last4} · exp {String(c.exp_month).padStart(2, "0")}/{String(c.exp_year).slice(-2)}
                  {c.is_default ? " · default" : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {method === "ach" && (
          <Field label="Bank account">
            <TextInput value="Chase ····1234 (verified)" readOnly />
          </Field>
        )}

        <div className="rounded-[10px] border border-hairline bg-surface-2 px-3 py-2.5 text-[12px] text-fg-subtle">
          <CreditCard className="mr-1 inline size-3 text-primary" />
          Demo only — no charge is processed. In production this would tokenize the card via
          the payment processor before the marina sees the form data.
        </div>
      </div>
    </CreateSheet>
  );
}
