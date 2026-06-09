"use client";

import * as React from "react";
import {
  FileText,
  Play,
  Receipt,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/create-sheet";
import { BOATERS, SLIPS, formatMoney } from "@/lib/mock-data";
import {
  bulkAddContracts,
  nextInvoiceNumber,
  nextLedgerId,
  postBillingRunInvoice,
  useContracts,
  useStore,
} from "@/lib/client-store";
import type { Contract, LedgerEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * Billing runs — the annual-cycle billing surface.
 *
 * Operator picks:
 *   - Scope (all annual / by dock / by cadence)
 *   - Run date (= invoice date)
 *   - What to bill: full annual_rate now (lump), or split into monthly
 *     installments (writes the FIRST month — staff repeats monthly via
 *     this same tool or a future scheduled task)
 *
 * Preview is a one-row-per-contract list with computed amount. Dispatch
 * writes one open invoice per contract; each appears on the boater's
 * Financials tab and in /reports MTD revenue immediately.
 */

type BillMode = "annual_lump" | "monthly_installment";

export function BillingRuns() {
  const contracts = useContracts();
  const { ledger } = useStore();

  const [dockScope, setDockScope] = React.useState("all");
  const [cadenceScope, setCadenceScope] = React.useState<"all" | "annual" | "seasonal">("all");
  const [billMode, setBillMode] = React.useState<BillMode>("annual_lump");
  const [runDate, setRunDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = React.useState(false);
  const [lastRun, setLastRun] = React.useState<{
    when: string;
    count: number;
    total: number;
    scope: string;
  } | null>(null);

  const docks = React.useMemo(() => Array.from(new Set(SLIPS.map((s) => s.dock))).sort(), []);

  // Active contracts in scope
  const scope = React.useMemo(() => {
    return contracts.filter((c) => {
      if (c.status !== "active") return false;
      if (dockScope !== "all") {
        const slip = c.slip_id ? SLIPS.find((s) => s.id === c.slip_id) : undefined;
        if (slip?.dock !== dockScope) return false;
      }
      if (cadenceScope !== "all") {
        const boater = BOATERS.find((b) => b.id === c.boater_id);
        const cad = boater?.billing_cadence;
        if (cadenceScope === "annual" && cad !== "annual" && cad !== "monthly") return false;
        if (cadenceScope === "seasonal" && cad !== "seasonal") return false;
      }
      return true;
    });
  }, [contracts, dockScope, cadenceScope]);

  function amountFor(c: Contract): number {
    const rate = c.annual_rate ?? 0;
    if (billMode === "annual_lump") return rate;
    return Math.round(rate / 12);
  }

  const totalAmount = scope.reduce((s, c) => s + amountFor(c), 0);

  // Has any contract in scope already been billed for this run date?
  // (Crude dedupe — production would track this on the contract itself.)
  const alreadyBilledIds = React.useMemo(() => {
    const set = new Set<string>();
    for (const inv of ledger) {
      if (inv.type !== "invoice") continue;
      if (inv.date !== runDate) continue;
      const note = inv.line_items?.[0]?.description ?? "";
      if (note.includes("Billing run")) {
        set.add(inv.boater_id);
      }
    }
    return set;
  }, [ledger, runDate]);

  const eligible = scope.filter((c) => !alreadyBilledIds.has(c.boater_id));
  const skippedCount = scope.length - eligible.length;

  const canSubmit = eligible.length > 0 && !submitting;

  function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setTimeout(() => {
      // postBillingRunInvoice fans out the full chain per contract:
      //   1. Post the invoice
      //   2. If a default card is on file, auto-post a Payment that
      //      closes the open balance
      //   3. Dispatch a per-boater comm — "paid" or "ready" copy based
      //      on whether the auto-charge fired
      for (const c of eligible) {
        const amount = amountFor(c);
        if (amount <= 0) continue;
        const slip = c.slip_id ? SLIPS.find((s) => s.id === c.slip_id) : undefined;
        const label =
          billMode === "annual_lump"
            ? `Annual slip fee · ${slip?.id ?? "—"}`
            : `Monthly slip installment · ${slip?.id ?? "—"}`;
        postBillingRunInvoice({
          boater_id: c.boater_id,
          amount,
          date: runDate,
          line_item_label: `Billing run · ${label}`,
          contract_id: c.id,
          slip_id: c.slip_id,
        });
      }
      setLastRun({
        when: new Date().toLocaleTimeString(),
        count: eligible.length,
        total: eligible.reduce((s, c) => s + amountFor(c), 0),
        scope: `${dockScope === "all" ? "All docks" : dockScope}, ${cadenceScope === "all" ? "all cadences" : cadenceScope}`,
      });
      setSubmitting(false);
    }, 600);
  }

  return (
    <div className="space-y-4">
      {/* Header / scope */}
      <div className="rounded-[12px] border border-primary/30 bg-primary-soft/20 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h3 className="text-[14px] font-medium text-fg">Generate annual invoices</h3>
          <Badge tone="primary" size="sm">Bulk run</Badge>
        </div>
        <p className="text-[12px] text-fg-subtle">
          Drafts one open invoice per contract in scope. Each lands in the boater's Financials tab, the global ledger, and the QuickBooks pending batch.
        </p>
        <p className="mt-2 text-[11px] text-fg-tertiary">
          Need a wizard with month + rule + preview steps?{" "}
          <a
            href="/billing/bulk-run"
            className="font-medium text-primary hover:underline"
          >
            Open the bulk billing wizard →
          </a>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Dock scope">
          <Select value={dockScope} onChange={setDockScope}>
            <option value="all">All docks</option>
            {docks.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cadence scope">
          <Select value={cadenceScope} onChange={(v) => setCadenceScope(v as typeof cadenceScope)}>
            <option value="all">All cadences</option>
            <option value="annual">Annual / Monthly</option>
            <option value="seasonal">Seasonal</option>
          </Select>
        </Field>
        <Field label="Bill mode">
          <Select value={billMode} onChange={(v) => setBillMode(v as BillMode)}>
            <option value="annual_lump">Full annual lump</option>
            <option value="monthly_installment">Monthly installment (rate ÷ 12)</option>
          </Select>
        </Field>
        <Field label="Run / invoice date">
          <TextInput type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)} />
        </Field>
      </div>

      {/* Preview */}
      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
          <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
            <Receipt className="size-3.5" />
            Preview
          </h3>
          <div className="flex items-center gap-2 text-[12px]">
            <Badge tone={eligible.length > 0 ? "primary" : "warn"} size="sm">
              {eligible.length} eligible
            </Badge>
            {skippedCount > 0 && (
              <Badge tone="neutral" size="sm">
                {skippedCount} already billed this date
              </Badge>
            )}
            <span className="tabular text-fg">
              Total: <strong>{formatMoney(eligible.reduce((s, c) => s + amountFor(c), 0))}</strong>
            </span>
          </div>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {eligible.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-fg-tertiary">
              {scope.length === 0
                ? "No active contracts match these filters."
                : "Everyone in scope has already been invoiced for this run date. Pick a different date."}
            </p>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="bg-surface-2 text-[10px] uppercase tracking-wide text-fg-tertiary">
                <tr>
                  <Th>Member</Th>
                  <Th>Slip</Th>
                  <Th>Cadence</Th>
                  <Th>Contract</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {eligible.map((c) => {
                  const boater = BOATERS.find((b) => b.id === c.boater_id);
                  return (
                    <tr key={c.id} className="border-b border-hairline last:border-b-0">
                      <Td>{boater?.display_name ?? "—"}</Td>
                      <Td className="font-mono text-[12px] text-fg-subtle">{c.slip_id ?? "—"}</Td>
                      <Td className="capitalize text-fg-subtle">
                        {boater?.billing_cadence ?? "—"}
                      </Td>
                      <Td className="font-mono text-[12px] text-fg-subtle">{c.number}</Td>
                      <Td className="text-right tabular font-medium text-fg">
                        {formatMoney(amountFor(c))}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-hairline-strong bg-surface-2">
                <tr>
                  <Td colSpan={4} className="font-medium text-fg">
                    Total
                  </Td>
                  <Td className="text-right tabular text-[14px] font-semibold text-fg">
                    {formatMoney(eligible.reduce((s, c) => s + amountFor(c), 0))}
                  </Td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {/* Dispatch */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-fg-tertiary">
          Each invoice is created with <code>open_balance</code> = amount and <code>status: open</code>. Payments through the portal, POS, or manual Enter Payment will reduce balances.
        </p>
        <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
          <Play className="size-3.5" />
          {submitting
            ? "Dispatching…"
            : `Dispatch ${eligible.length} invoice${eligible.length === 1 ? "" : "s"} (${formatMoney(totalAmount)})`}
        </Button>
      </div>

      {/* Last-run receipt */}
      {lastRun && (
        <div className="flex items-center gap-2 rounded-[10px] border border-status-ok/30 bg-status-ok/10 px-3 py-2 text-[12px] text-status-ok">
          <Sparkles className="size-3.5" />
          <span>
            Dispatched <strong>{lastRun.count}</strong> invoices totaling{" "}
            <strong>{formatMoney(lastRun.total)}</strong> at {lastRun.when}. Scope:{" "}
            {lastRun.scope}.
          </span>
        </div>
      )}
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={"px-4 py-2 text-left font-medium " + (className ?? "")}>{children}</th>;
}

function Td({
  children,
  className,
  colSpan,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={cn("px-4 py-2 align-middle", className)}>
      {children}
    </td>
  );
}

// Silence unused imports — kept for potential future flows
void FileText;
void bulkAddContracts;
