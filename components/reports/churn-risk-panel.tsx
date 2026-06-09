"use client";

/*
 * Churn risk — top 10 boaters by composite risk score (0-100).
 *
 * Signals fold into a single number so staff can scan a queue and act
 * on the highest first. Each row exposes the signals that triggered so
 * the operator knows *why* a boater is on the list (lapsed contract
 * dominates vs comms-bounce alone).
 */

import * as React from "react";
import Link from "next/link";
import { UserMinus } from "lucide-react";
import { anyApi } from "convex/server";
import { useBoaters, useContracts, useLedger, useStore } from "@/lib/client-store";
import { localIsoDate } from "@/lib/contracts";
import { useTenantQuery } from "@/lib/use-tenant-query";
import { cn } from "@/lib/utils";

export interface ChurnRiskRow {
  boater_id: string;
  display_name: string;
  score: number;
  signals: string[];
}

const EMPTY_ARGS = {} as const;

export function ChurnRiskPanel() {
  const boaters = useBoaters();
  const contracts = useContracts();
  const ledger = useLedger();
  const { communications } = useStore();

  const mock = React.useMemo<ChurnRiskRow[]>(() => {
    const todayMs = Date.now();
    const todayIso = localIsoDate();
    const sixtyOutIso = localIsoDate(new Date(todayMs + 60 * 86_400_000));
    const ninetyAgoIso = localIsoDate(new Date(todayMs - 90 * 86_400_000));
    const thirtyAgoIso = localIsoDate(new Date(todayMs - 30 * 86_400_000));

    const rows: ChurnRiskRow[] = [];
    for (const b of boaters) {
      let score = 0;
      const signals: string[] = [];
      const myContracts = contracts.filter((c) => c.boater_id === b.id);
      const myLedger = ledger.filter((l) => l.boater_id === b.id);
      const myComms = communications.filter((c) => c.boater_id === b.id);

      if (myContracts.some((c) => c.status === "expired" || c.status === "terminated")) {
        score += 35;
        signals.push("Lapsed contract");
      }
      const overdue60 = myLedger.some((l) => {
        if (l.type !== "invoice" || l.open_balance <= 0) return false;
        return (todayMs - new Date(l.date).getTime()) / 86_400_000 >= 60;
      });
      if (overdue60) {
        score += 25;
        signals.push("Payments 60+ days overdue");
      }
      const expiring = myContracts.find(
        (c) => c.status === "active" && c.effective_end > todayIso && c.effective_end <= sixtyOutIso,
      );
      if (expiring) {
        score += 20;
        signals.push("Contract expiring < 60d");
      }
      const recentFail = myComms.some(
        (c) =>
          c.direction === "outbound" &&
          (c.status === "failed" || c.status === "bounced") &&
          c.sent_at >= thirtyAgoIso,
      );
      if (recentFail) {
        score += 15;
        signals.push("Comm bounced (30d)");
      }
      const recentPayment = myLedger.some((l) => l.type === "payment" && l.date >= ninetyAgoIso);
      if (!recentPayment && myLedger.length > 0) {
        score += 5;
        signals.push("No payment in 90d");
      }

      if (score > 0) {
        rows.push({
          boater_id: b.id,
          display_name: b.display_name,
          score: Math.min(100, score),
          signals,
        });
      }
    }
    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, 10);
  }, [boaters, contracts, ledger, communications]);

  const rows = useTenantQuery<ChurnRiskRow[]>({
    mock,
    convexRef: anyApi.reports.churnRiskBoaters,
    convexArgs: EMPTY_ARGS,
  });

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
          <UserMinus className="size-3.5" />
          Churn risk · top 10
        </h3>
        <span className="text-[11px] text-fg-tertiary">composite signal score</span>
      </div>
      <div className="p-3">
        {rows.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-hairline px-3 py-6 text-center text-[12px] text-fg-tertiary">
            No churn signals firing. Healthy book.
          </div>
        ) : (
          <ol className="space-y-2 text-[12px]">
            {rows.map((r) => {
              const tone =
                r.score >= 70 ? "text-status-danger" : r.score >= 40 ? "text-status-warn" : "text-fg";
              const barTone =
                r.score >= 70 ? "bg-status-danger" : r.score >= 40 ? "bg-status-warn" : "bg-status-info";
              return (
                <li
                  key={r.boater_id}
                  className="rounded-[8px] border border-hairline bg-surface-2/40 p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/members/${r.boater_id}`}
                      className="truncate font-medium text-fg hover:text-primary"
                    >
                      {r.display_name}
                    </Link>
                    <span className={cn("money-display text-[16px]", tone)}>{r.score}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
                    <div className={cn("h-full", barTone)} style={{ width: `${r.score}%` }} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {r.signals.map((s) => (
                      <span
                        key={s}
                        className="inline-flex items-center rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-fg-subtle"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
