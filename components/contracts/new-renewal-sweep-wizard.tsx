"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import {
  Field,
  NumberInput,
  TextInput,
  Textarea,
} from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BOATERS,
  SEED_TENANT_ID,
  SLIPS,
  formatMoney,
} from "@/lib/mock-data";
import { executeAgentAction } from "@/lib/agent-actions";
import { getCurrentTenantId, useContracts } from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { AgentAction } from "@/lib/simulated-agent";
import type { Contract } from "@/lib/types";

/*
 * New renewal sweep wizard — 4 steps.
 *
 *   1. Window — name + start/end dates (default = next 90 days).
 *   2. Select contracts — auto-pick active contracts in the window;
 *      operator deselects / expands.
 *   3. Default rate adjustment — % applied to each source contract's
 *      annual_rate when the sweep is launched and successors get drafted.
 *      Per-item overrides land on the coordinator page after launch.
 *   4. Review + launch — preview totals (count + projected revenue if
 *      every item accepts).
 *
 * Launching the sweep creates it in `status: "in_progress"` (not draft)
 * + mints successor drafts immediately so the coordinator surface can
 * fan out renewal links per-item. That collapses two steps into one for
 * the common case; the operator still has the per-item Withdraw escape
 * hatch if they need to back out.
 */

type Step = "window" | "select" | "rate" | "review";

const STEPS: { key: Step; label: string }[] = [
  { key: "window", label: "Window" },
  { key: "select", label: "Contracts" },
  { key: "rate", label: "Rate adjust" },
  { key: "review", label: "Review" },
];

function defaultIsoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function NewRenewalSweepWizard({
  onLaunched,
  onCancel,
}: {
  onLaunched?: (sweepId: string) => void;
  onCancel?: () => void;
}) {
  const liveContracts = useContracts();
  const tenantId = getCurrentTenantId();

  const [step, setStep] = React.useState<Step>("window");
  const [name, setName] = React.useState(() => {
    const year = new Date().getFullYear();
    return `Winter ${year} sweep`;
  });
  const [windowStart, setWindowStart] = React.useState(defaultIsoToday());
  const [windowEnd, setWindowEnd] = React.useState(isoDaysFromToday(90));
  const [pct, setPct] = React.useState("5");
  const [notes, setNotes] = React.useState("");
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState<{
    sweepId: string;
    count: number;
  } | null>(null);

  // Window candidates — active contracts whose effective_end lands in
  // [windowStart, windowEnd], tenant-scoped, ignoring contracts already
  // tied to an in-progress sweep is left to the coordinator surface.
  const candidates: Contract[] = React.useMemo(() => {
    if (!windowStart || !windowEnd) return [];
    return liveContracts.filter((c) => {
      if (c.status !== "active") return false;
      if (!c.effective_end) return false;
      const boater = BOATERS.find((b) => b.id === c.boater_id);
      const cTenant = boater?.tenant_id ?? SEED_TENANT_ID;
      if (cTenant !== tenantId) return false;
      return c.effective_end >= windowStart && c.effective_end <= windowEnd;
    });
  }, [liveContracts, windowStart, windowEnd, tenantId]);

  const selected = candidates.filter((c) => !excluded.has(c.id));
  const lift = (Number(pct) || 0) / 100;
  const currentARR = selected.reduce(
    (s, c) => s + (c.annual_rate ?? 0),
    0,
  );
  const projectedARR = selected.reduce(
    (s, c) => s + (c.annual_rate ?? 0) * (1 + lift),
    0,
  );

  function toggleExclude(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function launchSweep() {
    if (submitting || selected.length === 0) return;
    setSubmitting(true);

    // Step 1 — start the sweep (status=draft) with the picked items.
    const startAction: AgentAction = {
      kind: "start_renewal_sweep",
      label: `Start "${name}" — ${selected.length} contracts`,
      name,
      window_start: windowStart,
      window_end: windowEnd,
      default_rate_adjustment_pct: Number(pct) || 0,
      source_contract_ids: selected.map((c) => c.id),
      notes: notes || undefined,
    };
    const startResult = executeAgentAction(startAction);
    if (!startResult.ok || !startResult.createdId) {
      setSubmitting(false);
      return;
    }
    const sweepId = startResult.createdId;

    // Step 2 — launch immediately (status → in_progress, drafts minted).
    const launchAction: AgentAction = {
      kind: "launch_renewal_sweep",
      label: `Launch "${name}"`,
      sweep_id: sweepId,
      sweep_name: name,
      item_count: selected.length,
    };
    executeAgentAction(launchAction);

    setDone({ sweepId, count: selected.length });
    setSubmitting(false);
    onLaunched?.(sweepId);
  }

  if (done) {
    return (
      <div className="rounded-[12px] border border-status-ok/30 bg-status-ok/10 p-5 text-center">
        <CheckCircle2 className="mx-auto mb-2 size-8 text-status-ok" />
        <h3 className="text-[16px] font-medium text-fg">Sweep launched</h3>
        <p className="mt-1 text-[13px] text-fg-subtle">
          {done.count} successor draft{done.count === 1 ? "" : "s"} minted ·
          send renewal links from the coordinator below.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StepPills step={step} setStep={setStep} canAdvance={canAdvance(step, selected.length)} />

      {step === "window" && (
        <Card title="Sweep window" hint="Name the sweep + pick the expiry window.">
          <div className="space-y-3">
            <Field label="Sweep name" required>
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Winter 2026 sweep"
                autoFocus
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Window start" required>
                <TextInput
                  type="date"
                  value={windowStart}
                  onChange={(e) => setWindowStart(e.target.value)}
                />
              </Field>
              <Field label="Window end" required>
                <TextInput
                  type="date"
                  value={windowEnd}
                  onChange={(e) => setWindowEnd(e.target.value)}
                />
              </Field>
            </div>
            <p className="text-[11px] text-fg-tertiary">
              Common windows: 90 days (single quarter), 120 days (full
              fall + holiday slack), Dec 1 – Mar 31 (classic Dec 31
              expiry cohort).
            </p>
          </div>
        </Card>
      )}

      {step === "select" && (
        <Card
          title="Contracts in window"
          hint="Auto-selected. Deselect any you don't want in the sweep."
          right={
            <Badge
              tone={selected.length > 0 ? "primary" : "warn"}
              size="sm"
            >
              {selected.length} of {candidates.length}
            </Badge>
          }
        >
          {candidates.length === 0 ? (
            <p className="text-[12px] text-status-warn">
              No active contracts expire between {windowStart} and{" "}
              {windowEnd}. Widen the window.
            </p>
          ) : (
            <div className="overflow-hidden rounded-[8px] border border-hairline">
              <table className="w-full text-[12px]">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-fg-tertiary">
                  <tr>
                    <th className="px-2 py-2 text-left">In sweep</th>
                    <th className="px-3 py-2 text-left">Boater</th>
                    <th className="px-3 py-2 text-left">Slip</th>
                    <th className="px-3 py-2 text-left">Expires</th>
                    <th className="px-3 py-2 text-right">Annual rate</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => {
                    const boater = BOATERS.find(
                      (b) => b.id === c.boater_id,
                    );
                    const slip = c.slip_id
                      ? SLIPS.find((s) => s.id === c.slip_id)
                      : undefined;
                    const checked = !excluded.has(c.id);
                    return (
                      <tr
                        key={c.id}
                        className="border-t border-hairline hover:bg-surface-2/40"
                      >
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleExclude(c.id)}
                            aria-label={`${checked ? "Remove" : "Add"} ${boater?.display_name ?? c.id}`}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          {boater?.display_name ?? c.boater_id}
                        </td>
                        <td className="px-3 py-1.5 text-fg-subtle">
                          {slip?.id ?? "—"}
                        </td>
                        <td className="px-3 py-1.5 tabular text-fg-subtle">
                          {c.effective_end}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular">
                          {formatMoney(c.annual_rate ?? 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {step === "rate" && (
        <Card
          title="Default rate adjustment"
          hint="Applied to each item's source annual_rate when successors are drafted. Per-item overrides land later."
        >
          <Field label="Adjustment %" hint="+5 means +5%, -2.5 means -2.5%.">
            <NumberInput
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              step="0.5"
              min="-25"
              max="50"
              inputMode="decimal"
            />
          </Field>
          <div className="mt-3 grid grid-cols-3 gap-3 text-[12px]">
            <Stat label="Current ARR" value={formatMoney(currentARR)} />
            <Stat
              label={`+${pct || 0}% lift`}
              value={`+${formatMoney(projectedARR - currentARR)}`}
              tone="ok"
            />
            <Stat label="Projected ARR" value={formatMoney(projectedARR)} />
          </div>
          <Field label="Notes (optional)" hint="Internal — surfaces in the sweep coordinator header.">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Standard +5% lift, hold the line on long-tenure board members…"
              rows={2}
            />
          </Field>
        </Card>
      )}

      {step === "review" && (
        <Card title="Review + launch" hint="Approve to mint successor drafts.">
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <ReviewRow label="Name" value={name} />
            <ReviewRow label="Window" value={`${windowStart} → ${windowEnd}`} />
            <ReviewRow label="Default lift" value={`${pct || 0}%`} />
            <ReviewRow
              label="Contracts in sweep"
              value={String(selected.length)}
            />
            <ReviewRow label="Current ARR" value={formatMoney(currentARR)} />
            <ReviewRow
              label="Projected ARR"
              value={formatMoney(projectedARR)}
              tone="ok"
            />
          </div>
          <p className="mt-3 text-[11px] text-fg-tertiary">
            Launching mints one draft successor per selected contract +
            generates renewal link tokens. Renewal links don't go out
            until you send them (per-item or in bulk) from the coordinator.
          </p>
        </Card>
      )}

      <footer className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button
              variant="ghost"
              size="md"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </Button>
          )}
          <Button
            variant="ghost"
            size="md"
            onClick={() => {
              const idx = STEPS.findIndex((s) => s.key === step);
              if (idx > 0) setStep(STEPS[idx - 1].key);
            }}
            disabled={step === "window" || submitting}
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Button>
        </div>
        {step === "review" ? (
          <Button
            variant="primary"
            size="md"
            onClick={launchSweep}
            disabled={selected.length === 0 || submitting}
          >
            <Sparkles className="size-3.5" />
            {submitting ? "Launching…" : `Launch — ${selected.length} drafts`}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              const idx = STEPS.findIndex((s) => s.key === step);
              if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].key);
            }}
            disabled={
              (step === "select" && selected.length === 0) ||
              !windowStart ||
              !windowEnd
            }
          >
            Next
            <ArrowRight className="size-3.5" />
          </Button>
        )}
      </footer>
    </div>
  );
}

function canAdvance(step: Step, selectedCount: number): boolean {
  if (step === "window") return true;
  if (step === "select") return selectedCount > 0;
  if (step === "rate") return selectedCount > 0;
  if (step === "review") return selectedCount > 0;
  return false;
}

function StepPills({
  step,
  setStep,
  canAdvance,
}: {
  step: Step;
  setStep: (s: Step) => void;
  canAdvance: boolean;
}) {
  return (
    <ol className="flex items-center gap-1 text-[12px]">
      {STEPS.map((s, i) => {
        const isActive = s.key === step;
        return (
          <React.Fragment key={s.key}>
            {i > 0 && (
              <span aria-hidden className="text-fg-tertiary">
                ›
              </span>
            )}
            <button
              type="button"
              onClick={() => setStep(s.key)}
              disabled={!canAdvance && i > STEPS.findIndex((x) => x.key === step)}
              className={cn(
                "rounded-[6px] px-2 py-1 font-medium transition-colors",
                isActive
                  ? "bg-primary text-on-primary"
                  : "bg-surface-2 text-fg-subtle hover:text-fg",
              )}
            >
              {i + 1}. {s.label}
            </button>
          </React.Fragment>
        );
      })}
    </ol>
  );
}

function Card({
  title,
  hint,
  right,
  children,
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-medium text-fg">{title}</h3>
          {hint && (
            <p className="mt-0.5 text-[12px] text-fg-subtle">{hint}</p>
          )}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok";
}) {
  return (
    <div className="rounded-[8px] border border-hairline bg-surface-2 p-3">
      <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
        {label}
      </div>
      <div
        className={cn(
          "tabular mt-0.5 text-[13px] font-medium",
          tone === "ok" ? "text-status-ok" : "text-fg",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok";
}) {
  return (
    <div className="rounded-[8px] border border-hairline bg-surface-2 p-3">
      <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
        {label}
      </div>
      <div
        className={cn(
          "tabular mt-0.5 text-[13px] font-medium",
          tone === "ok" ? "text-status-ok" : "text-fg",
        )}
      >
        {value}
      </div>
    </div>
  );
}
