"use client";

import * as React from "react";
import { CheckCircle2, Clock, TrendingUp, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RenewalSweep, RenewalSweepItem } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * Renewal sweep progress card.
 *
 * Renders the per-sweep dashboard summary: N total / M sent / K accepted
 * / J declined / X pending + an acceptance % sparkline over the items'
 * response order. Used on the coordinator page header (active sweep)
 * AND in the history rail (closed sweeps from prior cycles).
 */

export interface RenewalSweepStats {
  total: number;
  pending: number;
  sent: number;
  accepted: number;
  declined: number;
  withdrawn: number;
  no_response: number;
  acceptance_rate: number;          // 0..1
  response_rate: number;            // (accepted + declined) / sent
}

export function computeSweepStats(
  items: RenewalSweepItem[],
): RenewalSweepStats {
  const total = items.length;
  let pending = 0;
  let sent = 0;
  let accepted = 0;
  let declined = 0;
  let withdrawn = 0;
  let no_response = 0;
  for (const i of items) {
    switch (i.status) {
      case "pending":
        pending += 1;
        break;
      case "renewal_sent":
        sent += 1;
        break;
      case "accepted":
        accepted += 1;
        break;
      case "declined":
        declined += 1;
        break;
      case "withdrawn":
        withdrawn += 1;
        break;
      case "no_response":
        no_response += 1;
        break;
    }
  }
  // Acceptance % over the *responding* (eligible-non-withdrawn) cohort
  // so withdrawn items don't drag the metric down. Operator-aligned.
  const responded = accepted + declined + no_response;
  const acceptance_rate = responded > 0 ? accepted / responded : 0;
  // Of items that were sent OR responded.
  const reachable = sent + accepted + declined + no_response;
  const response_rate =
    reachable > 0 ? (accepted + declined) / reachable : 0;
  return {
    total,
    pending,
    sent,
    accepted,
    declined,
    withdrawn,
    no_response,
    acceptance_rate,
    response_rate,
  };
}

export function RenewalSweepProgressCard({
  sweep,
  items,
  compact = false,
}: {
  sweep: RenewalSweep;
  items: RenewalSweepItem[];
  compact?: boolean;
}) {
  const stats = React.useMemo(() => computeSweepStats(items), [items]);
  const acceptancePct = Math.round(stats.acceptance_rate * 100);

  return (
    <section
      className={cn(
        "rounded-[12px] border border-hairline bg-surface-1 p-4",
        compact && "p-3",
      )}
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3
              className={cn(
                "truncate font-medium text-fg",
                compact ? "text-[13px]" : "text-[15px]",
              )}
            >
              {sweep.name}
            </h3>
            <SweepStatusBadge status={sweep.status} />
          </div>
          <p className="mt-0.5 text-[11px] text-fg-subtle">
            {formatDate(sweep.window_start)} – {formatDate(sweep.window_end)}
            {sweep.launched_at && (
              <> · launched {formatDate(sweep.launched_at)}</>
            )}
            {sweep.closed_at && <> · closed {formatDate(sweep.closed_at)}</>}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
            Acceptance
          </div>
          <div
            className={cn(
              "tabular font-medium",
              compact ? "text-[18px]" : "text-[22px]",
              acceptancePct >= 80
                ? "text-status-ok"
                : acceptancePct >= 50
                  ? "text-status-warn"
                  : "text-fg",
            )}
          >
            {acceptancePct}%
          </div>
        </div>
      </header>

      <div className="grid grid-cols-5 gap-2 text-[11px]">
        <Stat
          label="Total"
          value={stats.total}
          icon={<TrendingUp className="size-3" />}
        />
        <Stat
          label="Pending"
          value={stats.pending}
          tone={stats.pending > 0 ? "warn" : "neutral"}
          icon={<Clock className="size-3" />}
        />
        <Stat
          label="Sent"
          value={stats.sent}
          tone={stats.sent > 0 ? "info" : "neutral"}
        />
        <Stat
          label="Accepted"
          value={stats.accepted}
          tone={stats.accepted > 0 ? "ok" : "neutral"}
          icon={<CheckCircle2 className="size-3" />}
        />
        <Stat
          label="Declined"
          value={stats.declined}
          tone={stats.declined > 0 ? "danger" : "neutral"}
          icon={<XCircle className="size-3" />}
        />
      </div>

      {/* Acceptance progress bar — visual stand-in for the "over time"
          sparkline. Resolution stays useful even when a sweep has only
          a handful of items, where a per-day sparkline would be sparse. */}
      <div className="mt-3 space-y-1">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
          aria-label={`${acceptancePct}% acceptance`}
        >
          <div className="flex h-full">
            <div
              className="h-full bg-status-ok"
              style={{
                width: `${ratioPct(stats.accepted, stats.total)}%`,
              }}
            />
            <div
              className="h-full bg-status-danger/70"
              style={{
                width: `${ratioPct(stats.declined, stats.total)}%`,
              }}
            />
            <div
              className="h-full bg-status-info/60"
              style={{
                width: `${ratioPct(stats.sent, stats.total)}%`,
              }}
            />
            <div
              className="h-full bg-status-warn/60"
              style={{
                width: `${ratioPct(stats.pending, stats.total)}%`,
              }}
            />
          </div>
        </div>
        <p className="text-[10px] text-fg-tertiary">
          Response rate {Math.round(stats.response_rate * 100)}% ·{" "}
          {stats.withdrawn > 0 && <>{stats.withdrawn} withdrawn · </>}
          {stats.no_response > 0 && <>{stats.no_response} no response</>}
        </p>
      </div>
    </section>
  );
}

function SweepStatusBadge({
  status,
}: {
  status: RenewalSweep["status"];
}) {
  if (status === "in_progress")
    return (
      <Badge tone="info" size="sm">
        In progress
      </Badge>
    );
  if (status === "closed")
    return (
      <Badge tone="neutral" size="sm">
        Closed
      </Badge>
    );
  return (
    <Badge tone="outline" size="sm">
      Draft
    </Badge>
  );
}

function Stat({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn" | "danger" | "info" | "neutral";
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-[6px] border border-hairline bg-surface-2 p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-fg-tertiary">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "tabular mt-0.5 text-[14px] font-medium",
          tone === "ok"
            ? "text-status-ok"
            : tone === "warn"
              ? "text-status-warn"
              : tone === "danger"
                ? "text-status-danger"
                : tone === "info"
                  ? "text-status-info"
                  : "text-fg",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ratioPct(n: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (n / total) * 100));
}

function formatDate(iso: string): string {
  // Display only the date portion; iso may be "YYYY-MM-DD" or full ISO.
  return iso.slice(0, 10);
}
