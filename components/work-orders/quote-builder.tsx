"use client";

import * as React from "react";
import { CheckCheck, Send, FileText, Receipt, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney, recalcQuote } from "@/lib/mock-data";
import type { Quote, QuoteLineItem, QuoteLineKind } from "@/lib/types";

const KIND_LABEL: Record<QuoteLineKind, string> = {
  part: "Part",
  labor: "Labor",
  fee: "Fee",
  discount: "Discount",
};

const KIND_TONE: Record<QuoteLineKind, "info" | "primary" | "warn" | "ok"> = {
  part: "info",
  labor: "primary",
  fee: "warn",
  discount: "ok",
};

export function QuoteBuilder({
  quote,
  onChange,
}: {
  quote: Quote;
  onChange?: (q: Quote) => void;
}) {
  const editable = quote.status === "draft" && !!onChange;
  const isSigned = !!quote.signed_at;
  const isInvoiced = quote.status === "invoiced";

  function updateLine(id: string, patch: Partial<QuoteLineItem>) {
    if (!onChange) return;
    const next = {
      ...quote,
      line_items: quote.line_items.map((l) => {
        if (l.id !== id) return l;
        const merged = { ...l, ...patch };
        // Recompute total when qty or unit_price changes
        merged.total = Math.round(merged.qty * merged.unit_price * 100) / 100;
        return merged;
      }),
    };
    onChange(recalcQuote(next));
  }

  function removeLine(id: string) {
    if (!onChange) return;
    const next = { ...quote, line_items: quote.line_items.filter((l) => l.id !== id) };
    onChange(recalcQuote(next));
  }

  function addLine(kind: QuoteLineKind) {
    if (!onChange) return;
    const newLine: QuoteLineItem = {
      id: `qd_new_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      kind,
      name: kind === "labor" ? "Labor" : kind === "part" ? "Part" : kind === "fee" ? "Fee" : "Discount",
      qty: 1,
      unit_price: 0,
      total: 0,
    };
    onChange(recalcQuote({ ...quote, line_items: [...quote.line_items, newLine] }));
  }

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-fg-subtle" />
          <h3 className="text-[14px] font-medium text-fg">Quote {quote.number}</h3>
          <StatusBadge status={quote.status} />
          {editable && <Badge tone="primary" size="sm">Editable</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {!isSigned && quote.status === "draft" && (
            <Button variant="primary" size="sm">
              <Send className="size-3.5" />
              Send for signature
            </Button>
          )}
          {isSigned && !isInvoiced && (
            <Button variant="primary" size="sm">
              <Receipt className="size-3.5" />
              Generate invoice
            </Button>
          )}
          {isInvoiced && (
            <Badge tone="ok">
              <CheckCheck className="size-3" />
              Invoice posted
            </Badge>
          )}
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-[11px] uppercase tracking-wide text-fg-tertiary">
              <Th className="w-[110px]">Kind</Th>
              <Th>Item</Th>
              <Th className="w-[64px] text-right">Qty</Th>
              <Th className="w-[100px] text-right">Unit</Th>
              <Th className="w-[110px] text-right">Total</Th>
              {editable && <Th className="w-[36px]" />}
            </tr>
          </thead>
          <tbody>
            {quote.line_items.length === 0 && (
              <tr>
                <td colSpan={editable ? 6 : 5} className="px-3 py-6 text-center text-[12px] text-fg-tertiary">
                  No line items yet. Use the buttons below to add one.
                </td>
              </tr>
            )}
            {quote.line_items.map((li) => (
              <tr key={li.id} className="border-b border-hairline last:border-b-0">
                <Td>
                  {editable ? (
                    <select
                      value={li.kind}
                      onChange={(e) => updateLine(li.id, { kind: e.target.value as QuoteLineKind })}
                      className="rounded-[6px] border border-hairline bg-surface-2 px-1.5 py-0.5 text-[12px] text-fg focus:border-hairline-strong focus:outline-none"
                    >
                      {(Object.keys(KIND_LABEL) as QuoteLineKind[]).map((k) => (
                        <option key={k} value={k}>{KIND_LABEL[k]}</option>
                      ))}
                    </select>
                  ) : (
                    <Badge tone={KIND_TONE[li.kind]} size="sm">{KIND_LABEL[li.kind]}</Badge>
                  )}
                </Td>
                <Td>
                  {editable ? (
                    <input
                      type="text"
                      value={li.name}
                      onChange={(e) => updateLine(li.id, { name: e.target.value })}
                      className="w-full rounded-[6px] border border-hairline bg-surface-2 px-2 py-1 text-[13px] text-fg focus:border-hairline-strong focus:outline-none"
                    />
                  ) : (
                    <>
                      <div className="text-fg">{li.name}</div>
                      {li.description && (
                        <div className="text-[11px] text-fg-subtle">{li.description}</div>
                      )}
                    </>
                  )}
                </Td>
                <Td className="text-right">
                  {editable ? (
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={li.qty}
                      onChange={(e) => updateLine(li.id, { qty: Number(e.target.value) || 0 })}
                      className="w-[56px] rounded-[6px] border border-hairline bg-surface-2 px-1.5 py-1 text-right text-[13px] text-fg tabular-nums focus:border-hairline-strong focus:outline-none"
                    />
                  ) : (
                    <span className="text-fg-subtle">{li.qty}</span>
                  )}
                </Td>
                <Td className="text-right">
                  {editable ? (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={li.unit_price}
                      onChange={(e) => updateLine(li.id, { unit_price: Number(e.target.value) || 0 })}
                      className="w-[88px] rounded-[6px] border border-hairline bg-surface-2 px-1.5 py-1 text-right text-[13px] text-fg tabular-nums focus:border-hairline-strong focus:outline-none"
                    />
                  ) : (
                    <span className="text-fg-subtle">{formatMoney(li.unit_price)}</span>
                  )}
                </Td>
                <Td className={cn("text-right font-medium tabular-nums", li.kind === "discount" ? "text-status-ok" : "text-fg")}>
                  {formatMoney(li.total)}
                </Td>
                {editable && (
                  <Td>
                    <button
                      type="button"
                      onClick={() => removeLine(li.id)}
                      aria-label="Remove line"
                      className="text-fg-tertiary hover:text-status-danger"
                    >
                      <X className="size-3.5" />
                    </button>
                  </Td>
                )}
              </tr>
            ))}
            {editable && (
              <tr>
                <td colSpan={6} className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(["labor", "part", "fee", "discount"] as QuoteLineKind[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => addLine(k)}
                        className="inline-flex items-center gap-1 rounded-[6px] border border-dashed border-hairline-strong bg-surface-1 px-2 py-1 text-[11px] text-fg-subtle transition-colors hover:border-primary/50 hover:bg-surface-2 hover:text-fg"
                      >
                        <Plus className="size-3" />
                        {KIND_LABEL[k]}
                      </button>
                    ))}
                    <span className="text-[11px] text-fg-tertiary">or ask the agent for a standard package</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-1.5 border-t border-hairline px-4 py-3 text-[13px] sm:grid-cols-[1fr_auto]">
        <div className="space-y-1.5 text-fg-subtle">
          <Row label="Parts">{formatMoney(quote.parts_subtotal)}</Row>
          <Row label="Labor">{formatMoney(quote.labor_subtotal)}</Row>
          {quote.fees_subtotal > 0 && <Row label="Fees">{formatMoney(quote.fees_subtotal)}</Row>}
          {quote.discount_subtotal !== 0 && <Row label="Discounts">{formatMoney(quote.discount_subtotal)}</Row>}
          <Row label={`Tax (${(quote.tax_rate * 100).toFixed(2)}%)`}>{formatMoney(quote.tax_amount)}</Row>
          {editable && (
            <p className="pt-1 text-[10px] text-fg-tertiary">
              Tax applies to parts + fees. Labor is not taxed in this jurisdiction.
            </p>
          )}
        </div>
        <div className="flex items-end justify-end sm:col-start-2 sm:row-start-1">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">Total</div>
            <div className="text-[24px] font-semibold tracking-tight text-fg tabular-nums">
              {formatMoney(quote.total)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Quote["status"] }) {
  const tone =
    status === "signed" || status === "invoiced"
      ? "ok"
      : status === "sent" || status === "viewed"
        ? "info"
        : status === "expired" || status === "voided"
          ? "danger"
          : "neutral";
  return (
    <Badge tone={tone} size="sm">
      {status}
    </Badge>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={"px-3 py-2 text-left font-medium " + (className ?? "")}>{children}</th>;
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={"px-3 py-2 align-middle " + (className ?? "")}>{children}</td>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className="ml-8 font-mono text-fg">{children}</span>
    </div>
  );
}
