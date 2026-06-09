"use client";

/*
 * Approval queue — sits above the BillsTable on the /vendors → Bills
 * sub-tab. Surfaces bills in `pending_approval` so the operator can
 * one-click approve without drilling into the row. Sorted by amount
 * descending (high-impact bills first); empty state collapses the
 * whole section.
 */

import * as React from "react";
import { anyApi } from "convex/server";
import { Check, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/mock-data";
import { approveVendorBill as mockApprove } from "@/lib/client-store";
import { useTenantMutation } from "@/lib/use-tenant-mutation";
import type { Vendor, VendorBill } from "@/lib/types";

export function ApprovalQueueSection({
  bills,
  vendors,
  onRowClick,
}: {
  bills: VendorBill[];
  vendors: Vendor[];
  onRowClick: (bill: VendorBill) => void;
}) {
  const vendorById = React.useMemo(
    () => new Map(vendors.map((v) => [v.id, v])),
    [vendors],
  );

  const approve = useTenantMutation<{ id: string }, void>({
    mock: ({ id }) => {
      mockApprove({ id });
    },
    convexRef: anyApi.vendorBills.approve,
    convexArgsAdapter: ({ id }) => ({ id }),
  });

  // Sort by amount descending so the most consequential approvals
  // surface first. Draft bills with zero amounts are excluded — they're
  // not ready for the queue.
  const queue = React.useMemo(
    () =>
      [...bills]
        .filter((b) => b.status === "pending_approval" && b.amount > 0)
        .sort((a, b) => b.amount - a.amount),
    [bills],
  );

  if (queue.length === 0) {
    return null;
  }

  const totalDue = queue.reduce((s, b) => s + b.amount, 0);

  return (
    <div className="rounded-[12px] border border-status-warn/30 bg-status-warn/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-3.5 text-status-warn" />
          <span className="text-[12px] font-medium text-fg">
            Approval queue
          </span>
          <Badge tone="warn" size="sm">
            {queue.length}
          </Badge>
        </div>
        <span className="text-[11px] text-fg-subtle">
          {formatMoney(totalDue)} pending
        </span>
      </div>

      <ul className="mt-2 space-y-1">
        {queue.map((b) => {
          const v = vendorById.get(b.vendor_id);
          return (
            <li
              key={b.id}
              className="group flex items-center justify-between gap-2 rounded-[8px] border border-hairline bg-surface-1 px-2.5 py-1.5"
            >
              <button
                type="button"
                onClick={() => onRowClick(b)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className="font-mono text-[11px] text-fg-tertiary">
                  {b.number}
                </span>
                <span className="truncate text-[12px] font-medium text-fg">
                  {v?.display_name ?? v?.name ?? b.vendor_id}
                </span>
                {b.description && (
                  <span className="truncate text-[11px] text-fg-tertiary">
                    · {b.description}
                  </span>
                )}
              </button>
              <span className="money-display text-[12px] text-fg">
                {formatMoney(b.amount)}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void approve({ id: b.id });
                }}
                className="inline-flex items-center gap-1 rounded-[6px] bg-primary px-2 py-1 text-[11px] font-medium text-on-primary hover:bg-primary-hover"
              >
                <Check className="size-3" />
                Approve
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
