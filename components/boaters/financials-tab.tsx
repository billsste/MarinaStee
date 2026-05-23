"use client";

import * as React from "react";
import { CreditCard, FileText, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney, getTemplate } from "@/lib/mock-data";
import { useLedgerForBoater } from "@/lib/client-store";
import { useLedgerDrawer } from "@/components/ledger/ledger-entry-drawer";
import type { CardOnFile, Contract, LedgerEntry } from "@/lib/types";

type FilterKey = "all" | "invoices" | "payments" | "refunds";

export function FinancialsTab({
  boaterId,
  cards,
  contracts,
}: {
  boaterId: string;
  cards: CardOnFile[];
  contracts: Contract[];
}) {
  // Live ledger from client store — reflects POS sales completed this session.
  const ledger = useLedgerForBoater(boaterId);
  const [filter, setFilter] = React.useState<FilterKey>("all");

  const filtered = ledger
    .filter((l) => {
      if (filter === "all") return true;
      if (filter === "invoices") return l.type === "invoice";
      if (filter === "payments") return l.type === "payment";
      if (filter === "refunds") return l.type === "refund" || l.type === "credit";
      return true;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const totals = {
    open: ledger.filter((l) => l.type === "invoice" && l.open_balance > 0).reduce((s, l) => s + l.open_balance, 0),
    paidYTD: ledger
      .filter((l) => l.type === "payment" && new Date(l.date).getFullYear() === new Date().getFullYear())
      .reduce((s, l) => s + l.amount, 0),
    refundedYTD: ledger
      .filter((l) => l.type === "refund" && new Date(l.date).getFullYear() === new Date().getFullYear())
      .reduce((s, l) => s + Math.abs(l.amount), 0),
  };

  return (
    <div className="space-y-4">
      {/* Top stat strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Open balance" value={formatMoney(totals.open)} tone={totals.open > 0 ? "warn" : "ok"} />
        <SummaryCard label="Paid YTD" value={formatMoney(totals.paidYTD)} tone="neutral" />
        <SummaryCard label="Refunded YTD" value={formatMoney(totals.refundedYTD)} tone="neutral" />
      </div>

      {/* Cards on file */}
      <div className="rounded-[12px] border border-hairline bg-surface-1">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
          <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
            <CreditCard className="size-3.5 text-fg-subtle" />
            Cards on file
          </h3>
          <Button variant="ghost" size="sm">+ Add card</Button>
        </div>
        <div className="p-3">
          {cards.length === 0 ? (
            <p className="px-1 text-[13px] text-fg-subtle">
              No cards on file. Add one to enable auto-pay and one-click charges.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {cards.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-3 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2"
                >
                  <div className="text-[12px] font-medium uppercase text-fg-subtle">{c.brand}</div>
                  <div className="font-mono text-[13px] text-fg">•••• {c.last4}</div>
                  <div className="text-[11px] text-fg-tertiary">
                    {String(c.exp_month).padStart(2, "0")}/{String(c.exp_year).slice(-2)}
                  </div>
                  {c.nickname && <span className="text-[11px] text-fg-tertiary">· {c.nickname}</span>}
                  {c.is_default && <Badge tone="primary" size="sm">Default</Badge>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Contracts */}
      <div className="rounded-[12px] border border-hairline bg-surface-1">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
          <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
            <FileText className="size-3.5 text-fg-subtle" />
            Contracts
          </h3>
          <Button variant="ghost" size="sm">+ New contract</Button>
        </div>
        <div className="p-3">
          {contracts.length === 0 ? (
            <p className="px-1 text-[13px] text-fg-subtle">No contracts on file.</p>
          ) : (
            <ul className="space-y-2">
              {contracts.map((c) => {
                const tpl = getTemplate(c.template_id);
                return (
                  <li
                    key={c.id}
                    className="flex items-start justify-between gap-3 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-fg">{c.number}</span>
                        <Badge tone={c.status === "active" ? "ok" : "neutral"} size="sm">
                          {c.status}
                        </Badge>
                        <span className="text-[11px] text-fg-tertiary">v{c.template_version}</span>
                      </div>
                      <div className="text-[12px] text-fg-subtle">
                        {tpl?.name ?? "Contract"} · {c.effective_start} → {c.effective_end}
                      </div>
                      {c.annual_rate && (
                        <div className="text-[11px] text-fg-tertiary">
                          {formatMoney(c.annual_rate)} / yr · billed {c.billing_cadence}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button variant="ghost" size="sm">View</Button>
                      <Button variant="secondary" size="sm">Renew</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Transaction history */}
      <div className="rounded-[12px] border border-hairline bg-surface-1">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
          <h3 className="text-[13px] font-medium text-fg">Transaction history</h3>
          <div className="flex items-center gap-2">
            <FilterPill label="All" active={filter === "all"} onClick={() => setFilter("all")} />
            <FilterPill label="Invoices" active={filter === "invoices"} onClick={() => setFilter("invoices")} />
            <FilterPill label="Payments" active={filter === "payments"} onClick={() => setFilter("payments")} />
            <FilterPill label="Refunds" active={filter === "refunds"} onClick={() => setFilter("refunds")} />
            <Button variant="primary" size="sm">+ Enter payment</Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-hairline text-[11px] uppercase tracking-wide text-fg-tertiary">
                <Th>Type</Th>
                <Th>Number</Th>
                <Th>Date</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Open Bal</Th>
                <Th>Method</Th>
                <Th>Applied to</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <LedgerRow key={e.id} entry={e} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-hairline px-4 py-2 text-[11px] text-fg-tertiary">
          All postings flow to a single A/R ledger for this boater.
        </div>
      </div>
    </div>
  );
}

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const isRefund = entry.type === "refund";
  const isOpen = entry.type === "invoice" && entry.open_balance > 0;
  const { openLedgerEntry } = useLedgerDrawer();

  return (
    <tr
      className={
        "cursor-pointer border-b border-hairline transition-colors hover:bg-surface-2 last:border-b-0 " +
        (isRefund ? "bg-status-danger/[0.04]" : "")
      }
      onClick={(e) => {
        // Avoid triggering when the row's action buttons are clicked
        if ((e.target as HTMLElement).closest("button, a")) return;
        openLedgerEntry(entry.id);
      }}
    >
      <Td>
        <span
          className={
            "inline-flex items-center gap-1.5 capitalize " +
            (isRefund ? "text-status-danger" : "text-fg")
          }
        >
          {isRefund && <RotateCcw className="size-3" />}
          {entry.type}
        </span>
      </Td>
      <Td className="font-mono text-[12px] font-medium text-primary">{entry.number ?? "—"}</Td>
      <Td className="text-fg-subtle">{entry.date}</Td>
      <Td className={"text-right " + (isRefund ? "text-status-danger" : "text-fg")}>
        {formatMoney(entry.amount)}
      </Td>
      <Td className="text-right text-fg-subtle">
        {entry.open_balance ? formatMoney(entry.open_balance) : "—"}
      </Td>
      <Td className="capitalize text-fg-subtle">
        {entry.method ? entry.method.replace("_", " ") : "—"}
      </Td>
      <Td className="text-fg-subtle">
        {entry.applied_to_invoice_ids?.length
          ? entry.applied_to_invoice_ids.length === 1
            ? "1 invoice"
            : `${entry.applied_to_invoice_ids.length} invoices`
          : entry.applied_payment_id
            ? "1 payment"
            : "—"}
      </Td>
      <Td>
        {isOpen ? (
          <Badge tone="warn" size="sm">Open</Badge>
        ) : entry.status === "partial_refund" ? (
          <Badge tone="warn" size="sm">Partial refund</Badge>
        ) : entry.status === "paid" ? (
          <Badge tone="ok" size="sm">Paid</Badge>
        ) : (
          <Badge tone="neutral" size="sm">{entry.status}</Badge>
        )}
      </Td>
      <Td>
        {entry.type === "payment" && entry.status !== "refunded" ? (
          <button className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
            <RotateCcw className="size-3" /> Refund
          </button>
        ) : isOpen ? (
          <button className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
            Pay
          </button>
        ) : null}
      </Td>
    </tr>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={"px-3 py-2 text-left font-medium " + (className ?? "")}>{children}</th>;
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={"px-3 py-2 align-middle " + (className ?? "")}>{children}</td>;
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors " +
        (active
          ? "border-primary/40 bg-primary-soft text-primary"
          : "border-hairline bg-surface-1 text-fg-muted hover:bg-surface-2")
      }
    >
      {label}
    </button>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "danger" | "neutral";
}) {
  const valueTone =
    tone === "warn" ? "text-status-warn" : tone === "danger" ? "text-status-danger" : "text-fg";
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">{label}</div>
      <div className={"mt-1 text-[20px] font-semibold tracking-tight " + valueTone}>{value}</div>
    </div>
  );
}
