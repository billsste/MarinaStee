"use client";

/*
 * VendorBills table — rows for the Bills sub-tab on /vendors.
 *
 * Status filter chips above + amount-due KPI ribbon. Click a row to
 * open the BillDetailModal; the chip-click filters by lifecycle stage.
 * Disputed bills get a danger badge; scheduled bills surface the
 * scheduled payment date in the row.
 */

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/mock-data";
import type { Vendor, VendorBill, VendorBillStatus } from "@/lib/types";

export type BillsFilterStatus = "all" | VendorBillStatus;

const STATUS_FILTERS: { key: BillsFilterStatus; label: string; tone?: "ok" | "warn" | "danger" | "info" }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "pending_approval", label: "Pending approval", tone: "warn" },
  { key: "approved", label: "Approved", tone: "info" },
  { key: "scheduled", label: "Scheduled", tone: "info" },
  { key: "paid", label: "Paid", tone: "ok" },
  { key: "disputed", label: "Disputed", tone: "danger" },
  { key: "void", label: "Void" },
];

function badgeTone(s: VendorBillStatus): "ok" | "warn" | "danger" | "info" | "neutral" {
  switch (s) {
    case "paid":
      return "ok";
    case "pending_approval":
      return "warn";
    case "approved":
    case "scheduled":
      return "info";
    case "disputed":
      return "danger";
    case "draft":
    case "void":
    default:
      return "neutral";
  }
}

function statusLabel(s: VendorBillStatus): string {
  switch (s) {
    case "pending_approval":
      return "Pending";
    case "scheduled":
      return "Scheduled";
    case "draft":
      return "Draft";
    case "approved":
      return "Approved";
    case "paid":
      return "Paid";
    case "disputed":
      return "Disputed";
    case "void":
      return "Void";
  }
}

export function BillsTable({
  bills,
  vendors,
  filter,
  onFilterChange,
  onRowClick,
  rightAction,
}: {
  bills: VendorBill[];
  vendors: Vendor[];
  filter: BillsFilterStatus;
  onFilterChange: (next: BillsFilterStatus) => void;
  onRowClick: (bill: VendorBill) => void;
  rightAction?: React.ReactNode;
}) {
  const vendorById = React.useMemo(
    () => new Map(vendors.map((v) => [v.id, v])),
    [vendors],
  );

  const counts = React.useMemo(() => {
    const map: Record<string, number> = { all: bills.length };
    for (const b of bills) {
      map[b.status] = (map[b.status] ?? 0) + 1;
    }
    return map;
  }, [bills]);

  // Amount due — sum of pending_approval + approved + scheduled.
  // Disputed bills are excluded (operator hasn't committed to pay).
  const amountDue = React.useMemo(
    () =>
      bills
        .filter(
          (b) =>
            b.status === "pending_approval" ||
            b.status === "approved" ||
            b.status === "scheduled",
        )
        .reduce((s, b) => s + b.amount, 0),
    [bills],
  );

  const filtered =
    filter === "all" ? bills : bills.filter((b) => b.status === filter);
  // Sort: actionable (pending/approved/scheduled) on top by due_date asc;
  // then disputed, draft, paid, void at the bottom.
  const order: Record<VendorBillStatus, number> = {
    pending_approval: 0,
    approved: 1,
    scheduled: 2,
    disputed: 3,
    draft: 4,
    paid: 5,
    void: 6,
  };
  const sorted = [...filtered].sort((a, b) => {
    if (order[a.status] !== order[b.status]) {
      return order[a.status] - order[b.status];
    }
    return a.due_date < b.due_date ? -1 : 1;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => {
            const count = f.key === "all" ? counts.all : (counts[f.key] ?? 0);
            const active = filter === f.key;
            const toneClass = active
              ? f.tone === "ok"
                ? "bg-status-ok/15 text-status-ok"
                : f.tone === "warn"
                  ? "bg-status-warn/15 text-status-warn"
                  : f.tone === "danger"
                    ? "bg-status-danger/15 text-status-danger"
                    : f.tone === "info"
                      ? "bg-status-info/15 text-status-info"
                      : "bg-surface-3 text-fg"
              : "bg-surface-1 text-fg-subtle hover:bg-surface-2";
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => onFilterChange(f.key)}
                className={cn(
                  "rounded-full border border-hairline px-2.5 py-1 text-[11px] font-medium transition-colors",
                  toneClass,
                )}
              >
                {f.label} ({count})
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-wide text-fg-tertiary">
              Amount due
            </span>
            <span className="money-display-lg text-[15px] text-fg">
              {formatMoney(amountDue)}
            </span>
          </div>
          {rightAction}
        </div>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{
            gridTemplateColumns:
              "100px minmax(0, 2fr) 110px 110px 120px 110px 100px",
          }}
        >
          <span>Bill #</span>
          <span>Vendor / desc</span>
          <span>Bill date</span>
          <span>Due / scheduled</span>
          <span>Amount</span>
          <span>Status</span>
          <span></span>
        </div>
        {sorted.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-fg-tertiary">
            Nothing in this view yet.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {sorted.map((b) => {
              const v = vendorById.get(b.vendor_id);
              const today = new Date().toISOString().slice(0, 10);
              const isPastDue =
                (b.status === "pending_approval" ||
                  b.status === "approved" ||
                  b.status === "scheduled") &&
                b.due_date < today;
              const dueLabel = b.scheduled_payment_date ?? b.due_date;
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => onRowClick(b)}
                    style={{
                      gridTemplateColumns:
                        "100px minmax(0, 2fr) 110px 110px 120px 110px 100px",
                    }}
                    className="grid w-full cursor-pointer items-center gap-x-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className="font-mono text-[12px] text-fg-subtle">
                      {b.number}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-fg">
                        {v?.display_name ?? v?.name ?? b.vendor_id}
                      </div>
                      <div className="truncate text-[11px] text-fg-tertiary">
                        {b.description ?? b.vendor_invoice_number ?? "—"}
                      </div>
                    </div>
                    <span className="text-[12px] text-fg-subtle">
                      {b.bill_date}
                    </span>
                    <span
                      className={cn(
                        "text-[12px]",
                        isPastDue ? "text-status-danger" : "text-fg-subtle",
                      )}
                    >
                      {dueLabel}
                      {b.scheduled_payment_date && (
                        <span className="ml-1 text-[10px] uppercase text-fg-tertiary">
                          sched
                        </span>
                      )}
                    </span>
                    <span className="money-display text-[13px] text-fg">
                      {b.amount > 0 ? formatMoney(b.amount) : "—"}
                    </span>
                    <Badge tone={badgeTone(b.status)} size="sm">
                      {statusLabel(b.status)}
                    </Badge>
                    <span className="text-[10px] text-fg-tertiary">
                      {b.scheduled_payment_method?.toUpperCase()}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
