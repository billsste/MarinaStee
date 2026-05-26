"use client";

import { CreditCard, Banknote, Building2, CheckCheck } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney, getLedgerEntry } from "@/lib/mock-data";
import type { Quote } from "@/lib/types";

export function PaymentPanel({ quote }: { quote: Quote }) {
  const invoice = quote.linked_invoice_ledger_entry_id ? getLedgerEntry(quote.linked_invoice_ledger_entry_id) : undefined;
  const payment = quote.linked_payment_ledger_entry_id ? getLedgerEntry(quote.linked_payment_ledger_entry_id) : undefined;

  if (payment) {
    return (
      <div className="rounded-[12px] border border-status-ok/30 bg-status-ok/[0.04] p-4">
        <div className="mb-2 flex items-center gap-2">
          <CheckCheck className="size-4 text-status-ok" />
          <h3 className="text-[13px] font-medium text-fg">Paid</h3>
          <Badge tone="ok" size="sm">{payment.method?.replace("_", " ") ?? "settled"}</Badge>
        </div>
        <div className="space-y-1 text-[12px] text-fg-subtle">
          <div>
            <span className="text-fg-tertiary">Amount:</span>{" "}
            <span className="font-medium text-fg">{formatMoney(payment.amount)}</span>
          </div>
          <div>
            <span className="text-fg-tertiary">Paid:</span>{" "}
            <span className="text-fg">{payment.date}</span>
          </div>
          {invoice && (
            <div>
              <span className="text-fg-tertiary">Invoice:</span>{" "}
              <Link
                href={`/holders/${invoice.boater_id}?tab=financials`}
                className="font-mono text-primary hover:underline"
              >
                {invoice.number}
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (invoice) {
    return (
      <div className="rounded-[12px] border border-status-warn/30 bg-status-warn/[0.06] p-4">
        <div className="mb-2 flex items-center gap-2">
          <Banknote className="size-4 text-status-warn" />
          <h3 className="text-[13px] font-medium text-fg">Invoice generated — awaiting payment</h3>
        </div>
        <div className="space-y-1 text-[12px] text-fg-subtle">
          <div>
            <span className="text-fg-tertiary">Invoice:</span>{" "}
            <Link
              href={`/holders/${invoice.boater_id}?tab=financials`}
              className="font-mono text-primary hover:underline"
            >
              {invoice.number}
            </Link>
          </div>
          <div>
            <span className="text-fg-tertiary">Open balance:</span>{" "}
            <span className="font-medium text-status-warn">{formatMoney(invoice.open_balance)}</span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <MethodButton label="Card" icon={<CreditCard className="size-3.5" />} />
          <MethodButton label="Cash" icon={<Banknote className="size-3.5" />} />
          <MethodButton label="Charge to account" icon={<Building2 className="size-3.5" />} />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-dashed border-hairline-strong bg-surface-1 p-4">
      <h3 className="text-[13px] font-medium text-fg">No invoice yet</h3>
      <p className="mt-1 text-[12px] text-fg-subtle">
        Generate an invoice once the quote is signed. Payment options will appear here.
      </p>
    </div>
  );
}

function MethodButton({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <Button variant="secondary" size="sm" className="flex-col gap-1 h-auto py-2">
      {icon}
      <span className="text-[10px]">{label}</span>
    </Button>
  );
}
