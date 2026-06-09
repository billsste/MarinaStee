"use client";

/*
 * A/R aging — buckets Current (0-30) / 31-60 / 61-90 / 90+. Each bar is
 * proportional to the bucket's open balance. Click any bucket to expand
 * a drill list of the contributing boaters + their share of the bucket.
 */

import * as React from "react";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { anyApi } from "convex/server";
import { useBoaters, useLedger } from "@/lib/client-store";
import { formatMoney } from "@/lib/mock-data";
import { useTenantQuery } from "@/lib/use-tenant-query";
import { BarBucket, type BarBucketRow } from "./bar-bucket";

type BucketKey = "0_30" | "31_60" | "61_90" | "90_plus";

interface BucketShape {
  amount: number;
  count: number;
  boater_ids: string[];
}

export type ArAgingShape = Record<BucketKey, BucketShape>;

const EMPTY_ARGS = {} as const;

const ORDERED_KEYS: BucketKey[] = ["0_30", "31_60", "61_90", "90_plus"];
const BUCKET_LABEL: Record<BucketKey, string> = {
  "0_30": "Current · 0-30d",
  "31_60": "31-60 days",
  "61_90": "61-90 days",
  "90_plus": "90+ days",
};
const BUCKET_TONE: Record<BucketKey, string> = {
  "0_30": "var(--status-ok)",
  "31_60": "var(--status-info)",
  "61_90": "var(--status-warn)",
  "90_plus": "var(--status-danger)",
};

export function ArAgingPanel() {
  const ledger = useLedger();
  const boaters = useBoaters();
  const todayMs = Date.now();

  const mock = React.useMemo<ArAgingShape>(() => {
    const out: ArAgingShape = {
      "0_30": { amount: 0, count: 0, boater_ids: [] },
      "31_60": { amount: 0, count: 0, boater_ids: [] },
      "61_90": { amount: 0, count: 0, boater_ids: [] },
      "90_plus": { amount: 0, count: 0, boater_ids: [] },
    };
    const seen: Record<BucketKey, Set<string>> = {
      "0_30": new Set(),
      "31_60": new Set(),
      "61_90": new Set(),
      "90_plus": new Set(),
    };
    for (const l of ledger) {
      if (l.type !== "invoice") continue;
      if (l.open_balance <= 0) continue;
      if (l.status !== "open" && l.status !== "partial") continue;
      const ageDays = Math.floor((todayMs - new Date(l.date).getTime()) / 86_400_000);
      const bk: BucketKey =
        ageDays <= 30 ? "0_30" : ageDays <= 60 ? "31_60" : ageDays <= 90 ? "61_90" : "90_plus";
      out[bk].amount += l.open_balance;
      out[bk].count += 1;
      if (!seen[bk].has(l.boater_id)) {
        seen[bk].add(l.boater_id);
        out[bk].boater_ids.push(l.boater_id);
      }
    }
    return out;
  }, [ledger, todayMs]);

  const buckets = useTenantQuery<ArAgingShape>({
    mock,
    convexRef: anyApi.reports.arAgingBuckets,
    convexArgs: EMPTY_ARGS,
  });

  const total = ORDERED_KEYS.reduce((s, k) => s + buckets[k].amount, 0);
  const [activeKey, setActiveKey] = React.useState<BucketKey | null>(null);

  const rows: BarBucketRow[] = ORDERED_KEYS.map((k) => ({
    key: k,
    label: BUCKET_LABEL[k],
    amount: buckets[k].amount,
    count: buckets[k].count,
    tone: BUCKET_TONE[k],
  }));

  // Resolve drill-down boaters by id. Boaters list is already tenant-
  // scoped via useBoaters().
  const boatersById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const b of boaters) m.set(b.id, b.display_name);
    return m;
  }, [boaters]);

  const activeIds = activeKey ? buckets[activeKey].boater_ids : [];
  const isEmpty = total === 0;

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
          <Wallet className="size-3.5" />
          A/R aging
        </h3>
        <span className="text-[12px] text-fg-subtle">{formatMoney(total)} outstanding</span>
      </div>
      <div className="p-4">
        {isEmpty ? (
          <div className="rounded-[8px] border border-dashed border-hairline px-3 py-6 text-center text-[12px] text-fg-tertiary">
            No open invoices. All clear.
          </div>
        ) : (
          <>
            <BarBucket
              rows={rows}
              total={total}
              fmt={formatMoney}
              onSelect={(k) => setActiveKey(activeKey === k ? null : (k as BucketKey))}
              activeKey={activeKey}
            />
            {activeKey && activeIds.length > 0 && (
              <div className="mt-4 rounded-[8px] border border-hairline bg-surface-2 p-3">
                <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-fg-tertiary">
                  <span>Contributing boaters · {BUCKET_LABEL[activeKey]}</span>
                  <button
                    type="button"
                    onClick={() => setActiveKey(null)}
                    className="text-fg-subtle hover:text-fg"
                  >
                    Close
                  </button>
                </div>
                <ul className="space-y-1 text-[12px]">
                  {activeIds.map((id) => (
                    <li key={id} className="flex items-center justify-between gap-2">
                      <Link
                        href={`/members/${id}`}
                        className="truncate text-fg hover:text-primary"
                      >
                        {boatersById.get(id) ?? id}
                      </Link>
                      <Link
                        href={`/members/${id}#ledger`}
                        className="text-fg-tertiary hover:text-primary"
                      >
                        View ledger →
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

