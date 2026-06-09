"use client";

/*
 * Expiring watchlist — Contracts | COIs tabs.
 *
 * Per-row action buttons:
 *   - Contracts row → "Draft renewal" link to the contracts list
 *     filtered to that contract (the agent's `bulk_draft_renewals` /
 *     "send for renewal" path is reachable from there).
 *   - COIs row → "Request renewal" link to the boater's insurance tab
 *     where the `request_coi_renewal` agent tool is already wired.
 *
 * Bucket math reuses `classifyContractStatus` + `classifyCoiStatus` so
 * the labels match every other surface (boater list, dashboard KPI,
 * etc.). The Convex side returns counts only; per-row drill-downs read
 * the underlying entity hooks directly since they're already tenant-
 * scoped and the rows we need are bounded (top N expiring).
 */

import * as React from "react";
import Link from "next/link";
import { CalendarClock, ShieldCheck } from "lucide-react";
import { useContracts, useStore } from "@/lib/client-store";
import { classifyContractStatus, localIsoDate } from "@/lib/contracts";
import { classifyCoiStatus, coiStatusLabel } from "@/lib/coi";
import { cn } from "@/lib/utils";

type Tab = "contracts" | "cois";

export function ExpiringWatchlistPanel() {
  const [tab, setTab] = React.useState<Tab>("contracts");
  const contracts = useContracts();
  const { insurance, vessels, boaters } = useStore();
  const todayIso = localIsoDate();
  const ninetyOutIso = localIsoDate(new Date(Date.now() + 90 * 86_400_000));

  const contractRows = React.useMemo(() => {
    const rows = contracts
      .map((c) => ({
        c,
        bucket: classifyContractStatus(c, todayIso, ninetyOutIso),
      }))
      .filter((r) => r.bucket === "expiring" || r.bucket === "lapsed")
      .sort((a, b) => a.c.effective_end.localeCompare(b.c.effective_end));
    return rows;
  }, [contracts, todayIso, ninetyOutIso]);

  const coiRows = React.useMemo(() => {
    const rows = insurance
      .map((coi) => ({ coi, status: classifyCoiStatus(coi, todayIso) }))
      .filter((r) => r.status !== null && r.status !== "active")
      .sort((a, b) => a.coi.effective_end.localeCompare(b.coi.effective_end));
    return rows;
  }, [insurance, todayIso]);

  const boatersById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const b of boaters) m.set(b.id, b.display_name);
    return m;
  }, [boaters]);
  const vesselsById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const v of vessels) m.set(v.id, v.name);
    return m;
  }, [vessels]);

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
          <CalendarClock className="size-3.5" />
          Expiring watchlist
        </h3>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setTab("contracts")}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
              tab === "contracts"
                ? "border-primary/40 bg-primary-soft text-primary"
                : "border-hairline bg-surface-1 text-fg-muted hover:bg-surface-2",
            )}
          >
            Contracts · {contractRows.length}
          </button>
          <button
            type="button"
            onClick={() => setTab("cois")}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
              tab === "cois"
                ? "border-primary/40 bg-primary-soft text-primary"
                : "border-hairline bg-surface-1 text-fg-muted hover:bg-surface-2",
            )}
          >
            COIs · {coiRows.length}
          </button>
        </div>
      </div>
      <div>
        {tab === "contracts" ? (
          contractRows.length === 0 ? (
            <div className="p-4 text-center text-[12px] text-fg-tertiary">
              No contracts expiring in the next 90 days.
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {contractRows.slice(0, 12).map(({ c, bucket }) => {
                const tone =
                  bucket === "lapsed"
                    ? "text-status-danger"
                    : "text-status-warn";
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12px]">
                    <div className="min-w-0">
                      <Link href={`/services/contracts`} className="block truncate font-medium text-fg hover:text-primary">
                        {c.number} · {boatersById.get(c.boater_id) ?? c.boater_id}
                      </Link>
                      <div className={cn("text-[11px]", tone)}>
                        Ends {c.effective_end} · {bucket === "lapsed" ? "lapsed" : "expiring"}
                      </div>
                    </div>
                    <Link
                      href={`/services/contracts?renew=${c.id}`}
                      className="shrink-0 rounded-full border border-hairline bg-surface-2 px-2.5 py-1 text-[11px] text-fg hover:border-hairline-strong hover:bg-surface-3"
                    >
                      Draft renewal
                    </Link>
                  </li>
                );
              })}
            </ul>
          )
        ) : coiRows.length === 0 ? (
          <div className="p-4 text-center text-[12px] text-fg-tertiary">
            No COIs expiring or lapsed.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {coiRows.slice(0, 12).map(({ coi, status }) => {
              const tone =
                status === "expired"
                  ? "text-status-danger"
                  : status === "expiring_30"
                    ? "text-status-warn"
                    : "text-fg-subtle";
              const boaterName = boatersById.get(coi.boater_id) ?? coi.boater_id;
              const vesselName = vesselsById.get(coi.vessel_id) ?? "—";
              return (
                <li key={coi.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12px]">
                  <div className="min-w-0">
                    <Link href={`/members/${coi.boater_id}#insurance`} className="block truncate font-medium text-fg hover:text-primary">
                      {boaterName} · {vesselName}
                    </Link>
                    <div className={cn("text-[11px]", tone)}>
                      <ShieldCheck className="mr-1 inline size-3" />
                      {coi.carrier} · ends {coi.effective_end} · {status ? coiStatusLabel(status) : "—"}
                    </div>
                  </div>
                  <Link
                    href={`/members/${coi.boater_id}#insurance`}
                    className="shrink-0 rounded-full border border-hairline bg-surface-2 px-2.5 py-1 text-[11px] text-fg hover:border-hairline-strong hover:bg-surface-3"
                  >
                    Request renewal
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
