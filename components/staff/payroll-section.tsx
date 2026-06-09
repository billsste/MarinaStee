"use client";

/*
 * components/staff/payroll-section.tsx
 *
 * Operator Payroll sub-tab. Three panels:
 *   - Current period card  (running total hours + projected gross)
 *   - Past periods table   (closed / paid history)
 *   - Close-Period modal   (paystub preview + CSV export)
 *
 * Tax + deduction math is deferred to the actual payroll provider
 * (Gusto / Rippling). This page captures gross hours + gross pay
 * only — what an operator hands their bookkeeper.
 */

import * as React from "react";
import { DollarSign, Calendar, Lock, FileDown, Sparkles, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/mock-data";
import {
  computePaystubPreview,
  openNextPayrollPeriod,
  useCurrentPayrollPeriod,
  usePayrollPeriods,
  useStaff,
  useTimeEntries,
} from "@/lib/client-store";
import type { PayrollPeriod } from "@/lib/types";
import { PaystubPreviewModal } from "@/components/staff/paystub-preview-modal";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function PayrollSection() {
  const periods = usePayrollPeriods();
  const current = useCurrentPayrollPeriod();
  const allEntries = useTimeEntries();
  const staff = useStaff();
  const [closing, setClosing] = React.useState<PayrollPeriod | null>(null);
  const [previewing, setPreviewing] = React.useState<PayrollPeriod | null>(null);

  // Running totals for the open period.
  const running = current
    ? computePaystubPreview(current.id)
    : { rows: [], totalHours: 0, totalGross: 0 };

  // Distinct active staff with logged hours this period — gives the
  // operator a quick "who's in the cycle" count without expanding the
  // preview modal.
  const activeCount = running.rows.length;

  function handleOpenNew() {
    const result = openNextPayrollPeriod();
    if (!result.ok) {
      window.alert(
        result.reason === "already_open"
          ? "A period is already open."
          : "Could not open new period."
      );
    }
  }

  const past = periods.filter((p) => p.status !== "open");

  return (
    <div className="space-y-6">
      {/* ── Current period card ── */}
      <section>
        <div className="mb-2 flex items-end justify-between">
          <div>
            <h2 className="text-[14px] font-medium text-fg">Current pay period</h2>
            <p className="mt-0.5 text-[12px] text-fg-tertiary">
              Running totals — close to lock + export to your payroll provider.
            </p>
          </div>
          {!current && (
            <Button variant="primary" size="sm" onClick={handleOpenNew}>
              <Plus className="size-3.5" />
              Open period
            </Button>
          )}
        </div>

        {current ? (
          <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Calendar className="size-3.5 text-fg-tertiary" />
                  <span className="text-[13px] font-medium text-fg">
                    {fmtDate(current.start_date)} → {fmtDate(current.end_date)}
                  </span>
                  <Badge tone="info" size="sm">
                    open
                  </Badge>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-6">
                  <Metric label="Hours" value={running.totalHours.toFixed(1)} />
                  <Metric
                    label="Projected gross"
                    value={formatMoney(running.totalGross)}
                  />
                  <Metric label="Staff" value={activeCount.toString()} />
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setPreviewing(current)}
                >
                  Preview paystubs
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setClosing(current)}
                >
                  <Lock className="size-3.5" />
                  Close period
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-[12px] border border-dashed border-hairline bg-surface-1 px-4 py-6 text-center text-[12px] text-fg-tertiary">
            No open period. Open the next biweekly window to start collecting hours.
          </div>
        )}
      </section>

      {/* ── Past periods ── */}
      <section>
        <div className="mb-2">
          <h2 className="text-[14px] font-medium text-fg">Past periods</h2>
          <p className="mt-0.5 text-[12px] text-fg-tertiary">
            Closed cycles. Click to re-open the paystub breakdown.
          </p>
        </div>
        {past.length === 0 ? (
          <div className="rounded-[12px] border border-hairline bg-surface-1 px-4 py-6 text-center text-[12px] text-fg-tertiary">
            No past periods yet.
          </div>
        ) : (
          <ul className="divide-y divide-hairline rounded-[12px] border border-hairline bg-surface-1">
            {past.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setPreviewing(p)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-fg">
                        {fmtDate(p.start_date)} → {fmtDate(p.end_date)}
                      </span>
                      <Badge
                        tone={p.status === "paid" ? "ok" : "neutral"}
                        size="sm"
                      >
                        {p.status}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-fg-tertiary">
                      {p.total_hours?.toFixed(1) ?? "—"}h ·{" "}
                      {p.total_gross !== undefined
                        ? formatMoney(p.total_gross)
                        : "—"}{" "}
                      gross
                      {p.closed_at ? ` · closed ${new Date(p.closed_at).toLocaleDateString()}` : ""}
                    </div>
                  </div>
                  <FileDown className="size-4 text-fg-tertiary" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
        <div className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-fg-subtle">
          <Sparkles className="size-3 text-primary" />
          Try the agent
        </div>
        <p className="text-[12px] text-fg-subtle">
          &ldquo;Close payroll for this period&rdquo; &middot;
          &ldquo;Run payroll for the last two weeks&rdquo; &middot;
          &ldquo;What&apos;s the running total this cycle?&rdquo;
        </p>
      </div>

      {closing && (
        <PaystubPreviewModal
          period={closing}
          mode="close"
          onClose={() => setClosing(null)}
        />
      )}
      {previewing && (
        <PaystubPreviewModal
          period={previewing}
          mode="preview"
          onClose={() => setPreviewing(null)}
        />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </div>
      <div className="money-display mt-0.5 text-[20px] text-fg">{value}</div>
    </div>
  );
}
