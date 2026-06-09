"use client";

/*
 * components/staff/paystub-preview-modal.tsx
 *
 * Per-staff gross-pay breakdown for a payroll period. Two modes:
 *   - preview : read-only, used by the past-periods row click
 *   - close   : same breakdown + confirm-and-close primary action
 *
 * "Export CSV for payroll provider" emits a simple CSV the operator
 * pastes into Gusto / Rippling / ADP / their bookkeeper's spreadsheet.
 * The real provider API integration is deferred.
 */

import * as React from "react";
import { Lock, FileDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/mock-data";
import { downloadCsv } from "@/lib/utils";
import {
  closePayrollPeriod,
  computePaystubPreview,
  useStaff,
} from "@/lib/client-store";
import type { PayrollPeriod } from "@/lib/types";

interface Props {
  period: PayrollPeriod;
  mode: "preview" | "close";
  onClose: () => void;
}

export function PaystubPreviewModal({ period, mode, onClose }: Props) {
  const staff = useStaff();
  const staffById = React.useMemo(
    () => new Map(staff.map((s) => [s.id, s])),
    [staff]
  );

  // For closed periods we already have the snapshot on the period
  // record. For open periods we recompute live from the current state.
  const preview = React.useMemo(
    () => computePaystubPreview(period.id),
    [period.id]
  );

  function exportCsv() {
    // Shared downloadCsv (lib/utils.ts) handles RFC-4180 escape —
    // wraps cells containing commas/quotes/newlines instead of the
    // old in-place .replace(/,/g, "") strip that silently destroyed
    // names like "Smith, Jr." and misaligned the downstream payroll
    // CSV (Gusto/ADP).
    downloadCsv({
      columns: [
        { key: "staff_name", label: "staff_name" },
        { key: "regular_hours", label: "regular_hours" },
        { key: "overtime_hours", label: "overtime_hours" },
        { key: "regular_pay", label: "regular_pay" },
        { key: "overtime_pay", label: "overtime_pay" },
        { key: "gross", label: "gross" },
      ],
      rows: preview.rows.map((r) => {
        const s = staffById.get(r.staff_member_id);
        return {
          staff_name: s?.name ?? r.staff_member_id,
          regular_hours: r.regular_hours,
          overtime_hours: r.overtime_hours,
          regular_pay: r.regular_pay,
          overtime_pay: r.overtime_pay,
          gross: r.gross,
        };
      }),
      filename: `payroll-${period.start_date}-to-${period.end_date}`,
    });
  }

  function confirmClose() {
    if (
      !window.confirm(
        `Close period ${period.start_date} → ${period.end_date}? Approved time entries in the window will be locked.`
      )
    )
      return;
    const closer = staff[0]?.id ?? "";
    const result = closePayrollPeriod(period.id, closer);
    if (!result.ok) {
      window.alert(
        result.reason === "not_open"
          ? "Period is already closed."
          : "Could not close period."
      );
      return;
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-t-[16px] border border-hairline bg-surface-1 shadow-xl sm:rounded-[16px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div>
            <h3 className="text-[15px] font-medium text-fg">
              Paystub preview
            </h3>
            <p className="mt-0.5 text-[12px] text-fg-tertiary">
              {period.start_date} → {period.end_date}
              {" · "}
              <Badge
                tone={
                  period.status === "open"
                    ? "info"
                    : period.status === "paid"
                    ? "ok"
                    : "neutral"
                }
                size="sm"
              >
                {period.status}
              </Badge>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1 text-fg-tertiary hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {preview.rows.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-fg-tertiary">
              No paystubs in this window. Active staff need either a salary
              or hourly_rate plus logged time entries.
            </p>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-hairline text-fg-tertiary">
                  <th className="py-2 text-left font-medium">Staff</th>
                  <th className="py-2 text-right font-medium">Reg hrs</th>
                  <th className="py-2 text-right font-medium">OT hrs</th>
                  <th className="py-2 text-right font-medium">Reg pay</th>
                  <th className="py-2 text-right font-medium">OT pay</th>
                  <th className="py-2 text-right font-medium">Gross</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => {
                  const s = staffById.get(r.staff_member_id);
                  return (
                    <tr
                      key={r.staff_member_id}
                      className="border-b border-hairline/60"
                    >
                      <td className="py-2 text-fg">{s?.name ?? r.staff_member_id}</td>
                      <td className="tabular py-2 text-right text-fg">
                        {r.regular_hours.toFixed(2)}
                      </td>
                      <td className="tabular py-2 text-right text-fg">
                        {r.overtime_hours.toFixed(2)}
                      </td>
                      <td className="tabular py-2 text-right text-fg">
                        {formatMoney(r.regular_pay)}
                      </td>
                      <td className="tabular py-2 text-right text-fg">
                        {formatMoney(r.overtime_pay)}
                      </td>
                      <td className="money-display py-2 text-right text-fg">
                        {formatMoney(r.gross)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="pt-3 text-[12px] font-medium text-fg">Total</td>
                  <td className="tabular pt-3 text-right font-medium text-fg">
                    {preview.totalHours.toFixed(2)}
                  </td>
                  <td colSpan={3} />
                  <td className="money-display pt-3 text-right text-[14px] font-medium text-fg">
                    {formatMoney(preview.totalGross)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          <div className="mt-3 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[11px] text-fg-subtle">
            Tax + deduction details (federal / state withholding, FICA,
            benefits) are deferred to your payroll provider. Export the
            CSV and paste into Gusto / Rippling / ADP — they handle the
            withholding math.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-hairline px-5 py-3">
          <Button variant="ghost" size="sm" onClick={exportCsv}>
            <FileDown className="size-3.5" />
            Export CSV
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {mode === "close" ? "Cancel" : "Close"}
            </Button>
            {mode === "close" && (
              <Button variant="primary" size="sm" onClick={confirmClose}>
                <Lock className="size-3.5" />
                Close period
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
