"use client";

import * as React from "react";
import {
  CheckCircle2,
  CloudUpload,
  RefreshCw,
  Clock,
  AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getQbBatchLog,
  pendingForQb,
  pushPendingToQuickBooks,
  useStore,
} from "@/lib/client-store";
import { formatMoney } from "@/lib/mock-data";

const GL_BUCKETS = ["Fuel Sales", "Retail Sales", "Restaurant", "Services", "A/R"] as const;

export function QbSync() {
  // Subscribe to store changes so the view reacts to sync state flips.
  useStore();

  const { orders, entries } = pendingForQb();
  const log = getQbBatchLog();
  const [pushing, setPushing] = React.useState(false);
  const [lastResult, setLastResult] = React.useState<{ batchId: string; count: number; total: number } | null>(null);

  // GL breakdown — bucket all pending POS orders by location's GL, plus charge-to-account invoices to A/R.
  const glBreakdown: Record<string, { count: number; total: number }> = {};
  for (const o of orders) {
    const bucket = o.boater_id ? "A/R" : entryGlForLoc(o);
    glBreakdown[bucket] = glBreakdown[bucket] ?? { count: 0, total: 0 };
    glBreakdown[bucket].count += 1;
    glBreakdown[bucket].total += o.total;
  }
  for (const e of entries) {
    const bucket = e.gl_account ?? "A/R";
    if (e.type !== "invoice") continue; // payments + refunds reconcile against the invoice rows
    glBreakdown[bucket] = glBreakdown[bucket] ?? { count: 0, total: 0 };
    glBreakdown[bucket].count += 1;
    glBreakdown[bucket].total += e.amount;
  }
  const totalPending = Object.values(glBreakdown).reduce((s, b) => s + b.total, 0);
  const pendingCount = orders.length + entries.length;

  async function push() {
    setPushing(true);
    try {
      const result = await pushPendingToQuickBooks();
      setLastResult(result);
    } finally {
      setPushing(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-[12px] border border-hairline bg-surface-1 p-4">
        <div>
          <h3 className="inline-flex items-center gap-2 text-[15px] font-medium text-fg">
            <CloudUpload className="size-4 text-primary" />
            QuickBooks Online — Pending batch
          </h3>
          <p className="mt-1 text-[12px] text-fg-subtle">
            {pendingCount === 0
              ? "Everything posted to QuickBooks is up to date."
              : `${pendingCount} entries awaiting sync · ${formatMoney(totalPending)} across ${Object.keys(glBreakdown).length} GL accounts.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={pendingCount === 0 ? "ok" : "warn"} size="md">
            {pendingCount === 0 ? (
              <>
                <CheckCircle2 className="size-3" />
                All synced
              </>
            ) : (
              <>
                <Clock className="size-3" />
                {pendingCount} pending
              </>
            )}
          </Badge>
          <Button variant="primary" size="md" disabled={pendingCount === 0 || pushing} onClick={push}>
            <RefreshCw className={"size-3.5 " + (pushing ? "animate-spin" : "")} />
            {pushing ? "Pushing…" : "Push to QuickBooks"}
          </Button>
        </div>
      </div>

      {/* Last batch confirmation */}
      {lastResult && (
        <div className="rounded-[12px] border border-status-ok/30 bg-status-ok/[0.06] p-4">
          <div className="flex items-center gap-2 text-fg">
            <CheckCircle2 className="size-4 text-status-ok" />
            <span className="text-[13px] font-medium">{lastResult.batchId} posted</span>
            <Badge tone="ok" size="sm">{lastResult.count} entries</Badge>
            <span className="text-[12px] text-fg-subtle">{formatMoney(lastResult.total)} total</span>
          </div>
        </div>
      )}

      {/* GL breakdown */}
      <div className="rounded-[12px] border border-hairline bg-surface-1">
        <div className="border-b border-hairline px-4 py-2.5">
          <h3 className="text-[13px] font-medium text-fg">GL account breakdown</h3>
          <p className="text-[11px] text-fg-tertiary">Pending entries grouped by destination ledger.</p>
        </div>
        <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-5">
          {GL_BUCKETS.map((bucket) => {
            const b = glBreakdown[bucket];
            return (
              <div
                key={bucket}
                className="rounded-[10px] border border-hairline bg-surface-2 px-3 py-2.5"
              >
                <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">{bucket}</div>
                <div className="money-display mt-1 text-[20px] text-fg">
                  {formatMoney(b?.total ?? 0)}
                </div>
                <div className="mt-0.5 text-[11px] text-fg-subtle">
                  {b?.count ?? 0} {b?.count === 1 ? "entry" : "entries"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pending entries list */}
      {pendingCount > 0 && (
        <div className="rounded-[12px] border border-hairline bg-surface-1">
          <div className="border-b border-hairline px-4 py-2.5">
            <h3 className="text-[13px] font-medium text-fg">Awaiting sync</h3>
          </div>
          <ul className="divide-y divide-hairline">
            {entries
              .filter((e) => e.type === "invoice")
              .map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                  <div className="min-w-0">
                    <div className="font-mono text-[12px] font-medium text-fg">
                      Invoice {e.number ?? e.id.slice(-6)}
                    </div>
                    <div className="text-[11px] text-fg-tertiary">
                      {e.date} · {e.gl_account ?? "A/R"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium tabular-nums text-fg">{formatMoney(e.amount)}</span>
                    <Badge tone="warn" size="sm">
                      <Clock className="size-3" />
                      Pending
                    </Badge>
                  </div>
                </li>
              ))}
            {orders.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                <div className="min-w-0">
                  <div className="font-mono text-[12px] font-medium text-fg">POS {o.number}</div>
                  <div className="text-[11px] text-fg-tertiary">
                    {o.payment_method.replace("_", " ")}
                    {o.boater_id ? ` · A/R` : ` · ${entryGlForLoc(o)}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium tabular-nums text-fg">{formatMoney(o.total)}</span>
                  <Badge tone="warn" size="sm">
                    <Clock className="size-3" />
                    Pending
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recent batches */}
      <div className="rounded-[12px] border border-hairline bg-surface-1">
        <div className="border-b border-hairline px-4 py-2.5">
          <h3 className="text-[13px] font-medium text-fg">Recent batches</h3>
          <p className="text-[11px] text-fg-tertiary">Sync history for this session.</p>
        </div>
        {log.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-fg-tertiary">
            No batches pushed this session yet.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {log.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                <div>
                  <div className="font-mono text-[12px] font-medium text-fg">{b.id}</div>
                  <div className="text-[11px] text-fg-tertiary">
                    {new Date(b.pushed_at).toLocaleString()} · {b.count} entries
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-fg">{formatMoney(b.total)}</span>
                  {b.outcome === "ok" ? (
                    <Badge tone="ok" size="sm">
                      <CheckCircle2 className="size-3" />
                      Posted
                    </Badge>
                  ) : (
                    <Badge tone="danger" size="sm">
                      <AlertCircle className="size-3" />
                      Error
                    </Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Local helper — keeps this component self-contained
function entryGlForLoc(o: { location_id: string }) {
  // We don't pull mock-data here to keep the bundle tight; the store has already
  // tagged GLs on the linked ledger entry. This is a labeling fallback only.
  if (o.location_id === "loc_fuel") return "Fuel Sales";
  if (o.location_id === "loc_store") return "Retail Sales";
  if (o.location_id === "loc_rest") return "Restaurant";
  if (o.location_id === "loc_hm") return "Services";
  return "A/R";
}
