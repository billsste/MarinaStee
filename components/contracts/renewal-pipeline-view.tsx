"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Send, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabButton, TabStrip } from "@/components/ui/tab-button";
import { BOATERS, SLIPS, formatMoney } from "@/lib/mock-data";
import { updateContract, useContracts } from "@/lib/client-store";
import { BulkRenewalSheet } from "./bulk-renewal-sheet";
import { cn } from "@/lib/utils";
import type { Contract } from "@/lib/types";

/*
 * Renewal pipeline — the fall-cycle workflow for an annual-holder marina.
 *
 * Sub-tabs replace the 2×2 card grid: one table per renewal stage so
 * staff can drill into a specific bucket without competing visual
 * weight. Clicking a row routes to the contract detail page where
 * status-aware actions live.
 */

type Stage = "up_for_renewal" | "drafted" | "sent" | "signed";

export function RenewalPipelineView() {
  const contracts = useContracts();
  const router = useRouter();
  const now = new Date();
  const currentYear = now.getFullYear();
  const targetYear = currentYear + 1;

  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [stage, setStage] = React.useState<Stage>("up_for_renewal");

  // Active contracts ending this year
  const activeEndingThisYear = contracts.filter((c) => {
    if (c.status !== "active") return false;
    return new Date(c.effective_end).getFullYear() === currentYear;
  });

  // Successors (any contract for next year's term)
  const successors = contracts.filter((c) => {
    return new Date(c.effective_end).getFullYear() === targetYear;
  });

  const draftedSuccessors = successors.filter((c) => c.status === "draft");
  const sentSuccessors = successors.filter(
    (c) => c.status === "sent" || c.status === "partially_signed"
  );
  const signedSuccessors = successors.filter(
    (c) => c.status === "executed" || c.status === "active"
  );
  const upForRenewal = activeEndingThisYear.filter((c) => {
    return !successors.some((s) => s.slip_id === c.slip_id);
  });

  const renewedCount = signedSuccessors.length;
  const totalEnding = activeEndingThisYear.length;
  const renewalRate = totalEnding > 0 ? (renewedCount / totalEnding) * 100 : 0;

  const currentARR = activeEndingThisYear.reduce((s, c) => s + (c.annual_rate ?? 0), 0);
  const nextARR = successors.reduce((s, c) => s + (c.annual_rate ?? 0), 0);

  function openContract(id: string) {
    router.push(`/services/contracts/${id}`);
  }

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

      {/* Pipeline-stage tabs — canonical TabStrip + TabButton. Each
          tab's count gets a tone matching the urgency of that bucket
          (warn for Up for renewal, info for in-flight, ok for done). */}
      <TabStrip ariaLabel="Renewal pipeline stage">
        <TabButton
          active={stage === "up_for_renewal"}
          onClick={() => setStage("up_for_renewal")}
          label="Up for renewal"
          count={upForRenewal.length}
          countTone="warn"
        />
        <TabButton
          active={stage === "drafted"}
          onClick={() => setStage("drafted")}
          label="Drafted"
          count={draftedSuccessors.length}
          countTone="info"
        />
        <TabButton
          active={stage === "sent"}
          onClick={() => setStage("sent")}
          label="Sent"
          count={sentSuccessors.length}
          countTone="info"
        />
        <TabButton
          active={stage === "signed"}
          onClick={() => setStage("signed")}
          label="Signed"
          count={signedSuccessors.length}
          countTone="ok"
        />
      </TabStrip>

      {stage === "up_for_renewal" && (
        <PipelineTable
          stage="up_for_renewal"
          contracts={upForRenewal}
          emptyTitle="Every expiring contract has a successor in flight."
          emptyBody="Anything that lands in this stage gets a row here once it's active and ending this year."
          onOpen={openContract}
        />
      )}
      {stage === "drafted" && (
        <PipelineTable
          stage="drafted"
          contracts={draftedSuccessors}
          emptyTitle="No draft renewals yet."
          emptyBody="Use the 'Draft renewals' bulk action above, or draft individually from each holder's page."
          onOpen={openContract}
          onSend={(c) => updateContract(c.id, { status: "sent" })}
        />
      )}
      {stage === "sent" && (
        <PipelineTable
          stage="sent"
          contracts={sentSuccessors}
          emptyTitle="Nothing waiting on signatures."
          emptyBody="When a draft is sent for signature it'll appear here until the holder signs."
          onOpen={openContract}
          onMarkSigned={(c) =>
            updateContract(c.id, {
              status: "active",
              signed_at: new Date().toISOString().slice(0, 10),
            })
          }
        />
      )}
      {stage === "signed" && (
        <PipelineTable
          stage="signed"
          contracts={signedSuccessors}
          emptyTitle="No locked-in renewals yet."
          emptyBody={`Successors signed and active for the ${targetYear} season will land here.`}
          onOpen={openContract}
        />
      )}

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
  const valueTone =
    tone === "ok" ? "text-status-ok" : tone === "warn" ? "text-status-warn" : "text-fg";
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <div className="mb-1.5 text-[12px] font-medium text-fg-subtle">{label}</div>
      <div className={cn("money-display text-[26px]", valueTone)}>{value}</div>
      <div className="mt-1 text-[11px] text-fg-tertiary">{sub}</div>
    </div>
  );
}

// CountChip removed — replaced by TabButton's `count` + `countTone` props
// from the canonical components/ui/tab-button.tsx.

function PipelineTable({
  stage,
  contracts,
  emptyTitle,
  emptyBody,
  onOpen,
  onSend,
  onMarkSigned,
}: {
  stage: Stage;
  contracts: Contract[];
  emptyTitle: string;
  emptyBody: string;
  onOpen: (id: string) => void;
  onSend?: (c: Contract) => void;
  onMarkSigned?: (c: Contract) => void;
}) {
  if (contracts.length === 0) {
    return (
      <div className="mt-3 rounded-[12px] border border-dashed border-hairline-strong bg-surface-1 px-6 py-10 text-center">
        <p className="text-[14px] font-medium text-fg">{emptyTitle}</p>
        <p className="mx-auto mt-1 max-w-md text-[12px] text-fg-subtle">{emptyBody}</p>
      </div>
    );
  }

  return (
    <div className="mt-3 overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-hairline bg-surface-2 text-[11px] uppercase tracking-wide text-fg-tertiary">
            <Th>Member</Th>
            <Th>Contract</Th>
            <Th>Slip</Th>
            <Th>Term</Th>
            <Th className="text-right">Rate</Th>
            <Th className="text-right">Action</Th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((c) => (
            <PipelineRow
              key={c.id}
              contract={c}
              stage={stage}
              onOpen={() => onOpen(c.id)}
              onSend={onSend ? () => onSend(c) : undefined}
              onMarkSigned={onMarkSigned ? () => onMarkSigned(c) : undefined}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={cn("px-3 py-2 text-left font-medium", className)}>{children}</th>
  );
}

function Td({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return <td className={cn("px-3 py-2 align-middle", className)}>{children}</td>;
}

function PipelineRow({
  contract,
  stage,
  onOpen,
  onSend,
  onMarkSigned,
}: {
  contract: Contract;
  stage: Stage;
  onOpen: () => void;
  onSend?: () => void;
  onMarkSigned?: () => void;
}) {
  const boater = BOATERS.find((b) => b.id === contract.boater_id);
  const slip = contract.slip_id ? SLIPS.find((s) => s.id === contract.slip_id) : undefined;
  const cadence = contract.billing_cadence;

  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b border-hairline transition-colors hover:bg-surface-2 last:border-b-0"
    >
      <Td>
        <span className="font-medium text-fg">{boater?.display_name ?? "—"}</span>
      </Td>
      <Td>
        <span className="font-mono text-[12px] font-medium text-primary">
          {contract.number}
        </span>
      </Td>
      <Td>
        {slip ? (
          <span className="font-mono text-[12px] text-fg">{slip.id}</span>
        ) : (
          <span className="text-fg-tertiary">—</span>
        )}
      </Td>
      <Td className="text-fg-subtle">
        {contract.effective_start} → {contract.effective_end}
      </Td>
      <Td className="text-right">
        {contract.annual_rate ? (
          <>
            <span className="tabular text-fg">{formatMoney(contract.annual_rate)}</span>
            <span className="ml-1 text-[10px] text-fg-tertiary">/ {cadence}</span>
          </>
        ) : (
          <span className="text-fg-tertiary">—</span>
        )}
      </Td>
      <Td className="text-right">
        {/* Stop propagation so action buttons don't double-fire row click */}
        <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {stage === "up_for_renewal" && (
            <Badge tone="warn" size="sm">No draft yet</Badge>
          )}
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
          {stage === "signed" && <Badge tone="ok" size="sm">Locked in</Badge>}
        </div>
      </Td>
    </tr>
  );
}
