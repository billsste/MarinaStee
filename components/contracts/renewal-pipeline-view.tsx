"use client";

import * as React from "react";
import Link from "next/link";
import { FilePlus2, Send, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BOATERS, SLIPS, formatMoney } from "@/lib/mock-data";
import { updateContract, useContracts } from "@/lib/client-store";
import { BulkRenewalSheet } from "./bulk-renewal-sheet";
import { cn } from "@/lib/utils";
import type { Contract } from "@/lib/types";

/*
 * Renewal pipeline — the fall-cycle workflow for an annual-holder marina.
 *
 * Layout:
 *   Top: this-year ARR + projected next-year ARR (with current lift) +
 *        renewal rate progress bar
 *   Bulk action: "Draft 202X renewals" → BulkRenewalSheet
 *   4 buckets:
 *     1. Up for renewal — active contracts ending THIS YEAR with no
 *        successor in the store yet (todo list)
 *     2. Drafted — successor contracts in draft status
 *     3. Sent — successor contracts in sent / partially_signed
 *     4. Signed — successors in executed / active for next season
 *
 * Each bucket is a card list. Per-row actions advance the contract
 * through the pipeline.
 */

export function RenewalPipelineView() {
  const contracts = useContracts();
  const now = new Date();
  const currentYear = now.getFullYear();
  const targetYear = currentYear + 1;

  const [bulkOpen, setBulkOpen] = React.useState(false);

  // Active contracts ending this year
  const activeEndingThisYear = contracts.filter((c) => {
    if (c.status !== "active") return false;
    return new Date(c.effective_end).getFullYear() === currentYear;
  });

  // Successors for those (any contract for same slip with end-year = next year)
  const successors = contracts.filter((c) => {
    return new Date(c.effective_end).getFullYear() === targetYear;
  });

  // Bucket the successors by status
  const draftedSuccessors = successors.filter((c) => c.status === "draft");
  const sentSuccessors = successors.filter(
    (c) => c.status === "sent" || c.status === "partially_signed"
  );
  const signedSuccessors = successors.filter(
    (c) => c.status === "executed" || c.status === "active"
  );

  // "Up for renewal" = endingThisYear without a successor of any status
  const upForRenewal = activeEndingThisYear.filter((c) => {
    return !successors.some((s) => s.slip_id === c.slip_id);
  });

  const renewedCount = signedSuccessors.length;
  const totalEnding = activeEndingThisYear.length;
  const renewalRate = totalEnding > 0 ? (renewedCount / totalEnding) * 100 : 0;

  const currentARR = activeEndingThisYear.reduce((s, c) => s + (c.annual_rate ?? 0), 0);
  const nextARR = successors.reduce((s, c) => s + (c.annual_rate ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Header: ARR pivot + bulk action */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiCard
          label={`${currentYear} ARR (expiring)`}
          value={formatMoney(currentARR)}
          sub={`${totalEnding} contracts ending this year`}
        />
        <KpiCard
          label={`${targetYear} ARR (so far)`}
          value={formatMoney(nextARR)}
          sub={`${successors.length} renewal draft${successors.length === 1 ? "" : "s"} in flight`}
          tone="ok"
        />
        <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
          <div className="mb-1.5 text-[12px] font-medium text-fg-subtle">
            Renewal progress
          </div>
          <div className="flex items-baseline justify-between">
            <span className="money-display text-[26px] text-fg">
              {totalEnding > 0 ? `${renewalRate.toFixed(0)}%` : "—"}
            </span>
            <span className="text-[11px] text-fg-tertiary">
              {renewedCount} / {totalEnding} signed
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
            <div
              className={cn(
                "h-full transition-all",
                renewalRate >= 85 ? "bg-status-ok" : renewalRate >= 60 ? "bg-status-info" : "bg-status-warn"
              )}
              style={{ width: `${Math.min(100, renewalRate)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Bulk action */}
      <div className="flex items-center justify-between rounded-[12px] border border-primary/30 bg-primary-soft/30 px-4 py-3">
        <div>
          <div className="text-[13px] font-medium text-fg">
            <Sparkles className="mr-1 inline size-3.5 text-primary" />
            Run the fall renewal cycle
          </div>
          <p className="mt-0.5 text-[12px] text-fg-subtle">
            Draft {targetYear} successor contracts for everyone expiring in {currentYear} — pick a rate lift and scope.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => setBulkOpen(true)}>
          <FilePlus2 className="size-3.5" />
          Draft {targetYear} renewals
        </Button>
      </div>

      {/* Buckets */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Bucket
          title={`Up for renewal — ${currentYear}`}
          tone="warn"
          count={upForRenewal.length}
          empty="Every expiring contract has a successor in flight."
          help="Active contracts ending this year that don't yet have a draft. Use the bulk action above to draft in batch."
        >
          {upForRenewal.map((c) => (
            <PipelineRow key={c.id} contract={c} stage="up_for_renewal" />
          ))}
        </Bucket>

        <Bucket
          title="Drafted"
          tone="info"
          count={draftedSuccessors.length}
          empty="No draft renewals yet."
          help="Successor contracts in draft. Click Send to push to the boater for signature."
        >
          {draftedSuccessors.map((c) => (
            <PipelineRow
              key={c.id}
              contract={c}
              stage="drafted"
              onSend={() => updateContract(c.id, { status: "sent" })}
            />
          ))}
        </Bucket>

        <Bucket
          title="Sent — awaiting signature"
          tone="info"
          count={sentSuccessors.length}
          empty="Nothing waiting on signatures."
          help="Contracts the boater has but hasn't signed yet. Nudge or mark received."
        >
          {sentSuccessors.map((c) => (
            <PipelineRow
              key={c.id}
              contract={c}
              stage="sent"
              onMarkSigned={() => updateContract(c.id, { status: "active", signed_at: new Date().toISOString().slice(0, 10) })}
            />
          ))}
        </Bucket>

        <Bucket
          title={`Signed — ${targetYear} season`}
          tone="ok"
          count={signedSuccessors.length}
          empty="No locked-in renewals yet."
          help="Successors that are signed and active for next season."
        >
          {signedSuccessors.map((c) => (
            <PipelineRow key={c.id} contract={c} stage="signed" />
          ))}
        </Bucket>
      </div>

      <BulkRenewalSheet
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        defaultExpiryYear={currentYear}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "ok" | "warn" | "neutral";
}) {
  const valueTone = tone === "ok" ? "text-status-ok" : tone === "warn" ? "text-status-warn" : "text-fg";
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <div className="mb-1.5 text-[12px] font-medium text-fg-subtle">{label}</div>
      <div className={cn("money-display text-[26px]", valueTone)}>{value}</div>
      <div className="mt-1 text-[11px] text-fg-tertiary">{sub}</div>
    </div>
  );
}

function Bucket({
  title,
  tone,
  count,
  empty,
  help,
  children,
}: {
  title: string;
  tone: "ok" | "warn" | "info" | "neutral";
  count: number;
  empty: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
          {title}
          <Badge tone={tone === "neutral" ? "neutral" : tone} size="sm">
            {count}
          </Badge>
        </h3>
      </div>
      <div className="space-y-2 p-3">
        {count === 0 ? (
          <div className="rounded-[8px] border border-dashed border-hairline px-3 py-5 text-center text-[12px] text-fg-tertiary">
            {empty}
          </div>
        ) : (
          children
        )}
      </div>
      <div className="border-t border-hairline px-4 py-2 text-[11px] text-fg-tertiary">{help}</div>
    </div>
  );
}

function PipelineRow({
  contract,
  stage,
  onSend,
  onMarkSigned,
}: {
  contract: Contract;
  stage: "up_for_renewal" | "drafted" | "sent" | "signed";
  onSend?: () => void;
  onMarkSigned?: () => void;
}) {
  const boater = BOATERS.find((b) => b.id === contract.boater_id);
  const slip = contract.slip_id ? SLIPS.find((s) => s.id === contract.slip_id) : undefined;
  const cadence = boater?.billing_cadence ?? "—";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-hairline bg-surface-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {boater ? (
            <Link
              href={`/holders/${boater.id}`}
              className="text-[13px] font-medium text-fg hover:text-primary"
            >
              {boater.display_name}
            </Link>
          ) : (
            <span className="text-[13px] font-medium text-fg-tertiary">—</span>
          )}
          <Badge tone="outline" size="sm">{contract.number}</Badge>
          {slip && (
            <span className="font-mono text-[11px] text-fg-tertiary">{slip.id}</span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-fg-tertiary">
          {contract.effective_start} → {contract.effective_end}
          {contract.annual_rate ? ` · ${formatMoney(contract.annual_rate)}/yr` : ""}
          {` · ${cadence}`}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {stage === "drafted" && onSend && (
          <Button variant="primary" size="sm" onClick={onSend}>
            <Send className="size-3.5" />
            Send
          </Button>
        )}
        {stage === "sent" && onMarkSigned && (
          <Button variant="primary" size="sm" onClick={onMarkSigned}>
            Mark signed
          </Button>
        )}
        {stage === "up_for_renewal" && (
          <Badge tone="warn" size="sm">No draft yet</Badge>
        )}
        {stage === "signed" && (
          <Badge tone="ok" size="sm">Locked in</Badge>
        )}
      </div>
    </div>
  );
}
