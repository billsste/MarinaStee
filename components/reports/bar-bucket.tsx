"use client";

/*
 * BarBucket — categorical horizontal bar visualization for buckets like
 * A/R aging (Current / 30 / 60 / 90+) and revenue mix.
 *
 * Why this and not the existing stacked-bar in `reports-view.tsx`?
 *   - That bar is one continuous gradient with a separate legend list.
 *     For aging buckets we want a per-bucket row with its own label,
 *     count, and money value next to a proportional bar — same row
 *     density as a table but with proportional fill that reads as a
 *     chart at a glance.
 *
 * Layout: each row renders as
 *     [label]  [bar fill] [$ amount]   (count)
 * Bar widths sum to 100% across the visible buckets — meaning we pass
 * the grand total in once and each bar fills (value / total) * 100.
 *
 * Optional `onSelect` makes a bucket clickable — used by the A/R aging
 * panel to drill down into a list of contributing boaters. When omitted
 * the row is informational only.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export interface BarBucketRow {
  /** Stable key — usually the bucket id ("0_30", "31_60", etc.). */
  key: string;
  /** Display label ("Current 0-30d"). */
  label: string;
  /** Dollar amount in this bucket. Use 0 to render an empty bar. */
  amount: number;
  /** Count of items in this bucket — shown as a small badge. */
  count: number;
  /**
   * CSS color for the bar fill — accepts any token expression like
   * `var(--status-ok)`. Caller picks tone so palette discipline stays
   * in the call site, not buried in a switch here.
   */
  tone: string;
}

export interface BarBucketProps {
  rows: BarBucketRow[];
  /**
   * Grand total used as the denominator for the bar widths. Pass the
   * sum once — keeps the rows visually proportional to each other
   * (vs each row normalizing to its own scale).
   */
  total: number;
  /**
   * Currency formatter. Pass `formatMoney` from `lib/mock-data` so the
   * primitive stays format-agnostic.
   */
  fmt: (n: number) => string;
  /** Optional drill-through. Receives the row's key. */
  onSelect?: (key: string) => void;
  /** Currently active row key — highlights when set. */
  activeKey?: string | null;
}

export function BarBucket({ rows, total, fmt, onSelect, activeKey }: BarBucketProps) {
  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const pct = total > 0 ? Math.min(100, (r.amount / total) * 100) : 0;
        const isActive = activeKey === r.key;
        const clickable = typeof onSelect === "function";
        const Wrapper: "button" | "div" = clickable ? "button" : "div";
        return (
          <li key={r.key}>
            <Wrapper
              type={clickable ? "button" : undefined}
              onClick={clickable ? () => onSelect?.(r.key) : undefined}
              className={cn(
                "block w-full rounded-[8px] px-2 py-1.5 text-left transition-colors",
                clickable && "cursor-pointer hover:bg-surface-2",
                isActive && "bg-surface-2 ring-1 ring-hairline-strong",
              )}
            >
              <div className="mb-1 flex items-center justify-between gap-3 text-[12px]">
                <span className="font-medium text-fg">{r.label}</span>
                <span className="flex items-center gap-2 text-fg-subtle">
                  <span className="tabular text-fg">{fmt(r.amount)}</span>
                  <span
                    className="inline-flex items-center rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-fg-tertiary"
                    aria-label={`${r.count} item${r.count === 1 ? "" : "s"}`}
                  >
                    {r.count}
                  </span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: r.tone }}
                />
              </div>
            </Wrapper>
          </li>
        );
      })}
    </ul>
  );
}
