"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  classifyCoiStatus,
  coiStatusLabel,
  coiStatusTone,
  isCoiNeedsAttention,
  type CoiStatus,
} from "@/lib/coi";
import { localIsoDate } from "@/lib/contracts";
import {
  requestCoiRenewal,
  useBoaters,
  useStore,
  useVessels,
} from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { InsuranceCertificate } from "@/lib/types";

/*
 * "Expiring soon" — the operator's morning-coffee surface for COIs
 * that need a renewal nudge. Sits ABOVE the existing certificate list
 * in InsuranceView; the existing list still acts as the full ledger.
 *
 * Three chips (90 / 60 / 30) let the operator drill into a cliff. Each
 * row carries a "Draft renewal reminder" button that fires the existing
 * `requestCoiRenewal` mock-store path (which mints the upload token +
 * dispatches a templated comm). When Convex is online the same button
 * routes to `convex/insuranceCoi.ts:draftRenewalReminder`.
 *
 * "Expired" entries are shown when the 90/60/30 chip set is "all" so
 * lapsed policies aren't hidden — they're the most urgent of all.
 */

type Cliff = "all" | "expiring_90" | "expiring_60" | "expiring_30" | "expired";

export function ExpiringSection() {
  const { insurance } = useStore();
  const boaters = useBoaters();
  const vessels = useVessels();
  const [cliff, setCliff] = React.useState<Cliff>("all");
  const [sentForId, setSentForId] = React.useState<string | null>(null);

  // Compute once per render — passed into the classifier so per-row
  // calls don't each re-derive today.
  const todayIso = localIsoDate();

  const rows = React.useMemo(() => {
    const boaterIds = new Set(boaters.map((b) => b.id));
    return insurance
      .filter((c) => boaterIds.has(c.boater_id))
      .map((c) => {
        const status = classifyCoiStatus(c, todayIso);
        if (!status || !isCoiNeedsAttention(status)) return null;
        const boater = boaters.find((b) => b.id === c.boater_id);
        const vessel = vessels.find((v) => v.id === c.vessel_id);
        return { coi: c, status, boater, vessel };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      // Soonest first — expired at the top, then 30 / 60 / 90.
      .sort((a, b) => a.coi.effective_end.localeCompare(b.coi.effective_end));
  }, [insurance, boaters, vessels, todayIso]);

  const counts = React.useMemo(() => {
    const c: Record<CoiStatus, number> = {
      active: 0,
      expiring_90: 0,
      expiring_60: 0,
      expiring_30: 0,
      expired: 0,
    };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  const visible = cliff === "all" ? rows : rows.filter((r) => r.status === cliff);

  function handleDraftReminder(coi: InsuranceCertificate) {
    requestCoiRenewal(coi.id);
    setSentForId(coi.id);
    // Clear the "Sent" stamp on the row after a short beat so a second
    // press feels responsive rather than locked.
    window.setTimeout(() => setSentForId((id) => (id === coi.id ? null : id)), 2400);
  }

  if (rows.length === 0) {
    return null; // Quiet when nothing needs attention.
  }

  return (
    <section className="rounded-[12px] border border-hairline bg-surface-1">
      <header className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2.5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-3.5 text-status-warn" />
          <h2 className="text-[13px] font-medium text-fg">Expiring soon</h2>
          <span className="text-[11px] text-fg-tertiary">
            · {rows.length} need attention
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <CliffChip
            label={`All · ${rows.length}`}
            value="all"
            current={cliff}
            onClick={setCliff}
          />
          <CliffChip
            label={`90d · ${counts.expiring_90}`}
            value="expiring_90"
            current={cliff}
            onClick={setCliff}
            tone="warn"
          />
          <CliffChip
            label={`60d · ${counts.expiring_60}`}
            value="expiring_60"
            current={cliff}
            onClick={setCliff}
            tone="warn"
          />
          <CliffChip
            label={`30d · ${counts.expiring_30}`}
            value="expiring_30"
            current={cliff}
            onClick={setCliff}
            tone="danger"
          />
          {counts.expired > 0 && (
            <CliffChip
              label={`Expired · ${counts.expired}`}
              value="expired"
              current={cliff}
              onClick={setCliff}
              tone="danger"
            />
          )}
        </div>
      </header>

      {visible.length === 0 ? (
        <div className="px-4 py-6 text-center text-[12px] text-fg-tertiary">
          Nothing in this bucket.
        </div>
      ) : (
        <ul className="divide-y divide-hairline">
          {visible.map((r) => {
            const sent = sentForId === r.coi.id;
            return (
              <li
                key={r.coi.id}
                className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {r.boater ? (
                      <Link
                        href={`/members/${r.boater.id}`}
                        className="truncate font-medium text-fg hover:underline"
                      >
                        {r.boater.display_name}
                      </Link>
                    ) : (
                      <span className="truncate text-fg-tertiary">—</span>
                    )}
                    <Badge tone={coiStatusTone(r.status)} size="sm">
                      {coiStatusLabel(r.status)}
                    </Badge>
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-fg-subtle">
                    {r.vessel?.name ?? "—"}
                    {" · "}
                    {r.coi.carrier} · {r.coi.policy_number}
                    {" · expires "}
                    <span className="tabular text-fg">{r.coi.effective_end}</span>
                  </div>
                </div>
                <Button
                  variant={sent ? "ghost" : "secondary"}
                  size="sm"
                  onClick={() => handleDraftReminder(r.coi)}
                  disabled={sent}
                  className={cn(sent && "text-status-ok")}
                >
                  <Mail className="size-3.5" />
                  {sent ? "Reminder sent" : "Draft renewal reminder"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t border-hairline px-4 py-2 text-[11px] text-fg-tertiary">
        <Badge tone="primary" size="sm">Agent</Badge>{" "}
        Try: &ldquo;Draft renewal reminders for every COI expiring in 30 days.&rdquo;
      </div>
    </section>
  );
}

function CliffChip({
  label,
  value,
  current,
  onClick,
  tone,
}: {
  label: string;
  value: Cliff;
  current: Cliff;
  onClick: (v: Cliff) => void;
  tone?: "warn" | "danger";
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
        active
          ? tone === "danger"
            ? "border-status-danger/40 bg-status-danger/10 text-status-danger"
            : tone === "warn"
              ? "border-status-warn/40 bg-status-warn/10 text-status-warn"
              : "border-primary/40 bg-primary-soft text-primary"
          : "border-hairline bg-surface-1 text-fg-muted hover:border-hairline-strong hover:bg-surface-2"
      )}
    >
      {label}
    </button>
  );
}
