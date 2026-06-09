"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  Sparkles,
} from "lucide-react";
import { Field, NumberInput, Select, TextInput } from "@/components/create-sheet";
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
 * Bulk renewal sweep wizard.
 *
 * Period (days_out) → Filter (rate adjustment + dock filter) → Preview
 * (list of N contracts) → Confirm. On confirm, fires `bulk_renew_contracts`
 * which writes one `status: "draft"` successor per candidate. Signing
 * stays per-contract (operator dispatches via the existing onboarding
 * flow from the renewal-pipeline view).
 *
 * Skip logic: candidates whose slip already has a draft successor are
 * silently filtered out so re-running this is idempotent.
 */

type Step = "period" | "filter" | "preview" | "confirm";

const STEPS: { key: Step; label: string }[] = [
  { key: "period", label: "Period" },
  { key: "filter", label: "Filter" },
  { key: "preview", label: "Preview" },
  { key: "confirm", label: "Confirm" },
];

export function BulkRenewalWizard({
  onComplete,
}: {
  onComplete?: (summary: { count: number }) => void;
}) {
  const liveContracts = useContracts();

  const [step, setStep] = React.useState<Step>("period");
  const [daysOut, setDaysOut] = React.useState("90");
  const [pct, setPct] = React.useState("5");
  const [dockScope, setDockScope] = React.useState("all");
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState<{ count: number } | null>(null);

  const tenantId = getCurrentTenantId();
  const docks = React.useMemo(
    () => Array.from(new Set(SLIPS.map((s) => s.dock))).sort(),
    [],
  );

  const candidates = React.useMemo(() => {
    const todayMs = Date.now();
    const window = Number(daysOut) || 0;
    if (window <= 0) return [];
    const cutoffMs = todayMs + window * 86_400_000;
    const draftSlipIds = new Set(
      liveContracts.filter((c) => c.status === "draft" && c.slip_id).map((c) => c.slip_id),
    );
    return liveContracts.filter((c) => {
      if (c.status !== "active") return false;
      const boater = BOATERS.find((b) => b.id === c.boater_id);
      const cTenant = boater?.tenant_id ?? SEED_TENANT_ID;
      if (cTenant !== tenantId) return false;
      if (!c.effective_end) return false;
      const endMs = new Date(c.effective_end).getTime();
      if (endMs < todayMs || endMs > cutoffMs) return false;
      if (dockScope !== "all") {
        const slip = c.slip_id ? SLIPS.find((s) => s.id === c.slip_id) : undefined;
        if (slip?.dock !== dockScope) return false;
      }
      if (c.slip_id && draftSlipIds.has(c.slip_id)) return false;
      return true;
    });
  }, [liveContracts, daysOut, dockScope, tenantId]);

  const lift = (Number(pct) || 0) / 100;
  const projectedDelta = candidates.reduce(
    (s, c) => s + (c.annual_rate ?? 0) * lift,
    0,
  );

  function confirm() {
    if (submitting) return;
    setSubmitting(true);
    const action: AgentAction = {
      kind: "bulk_renew_contracts",
      label: `Draft ${candidates.length} renewals (${daysOut}d, ${pct}%)`,
      days_out: Number(daysOut),
      rate_adjustment_pct: Number(pct) || undefined,
      target_count: candidates.length,
    };
    const result = executeAgentAction(action);
    if (!result.ok) {
      setSubmitting(false);
      setDone({ count: 0 });
      return;
    }
    const summary = { count: candidates.length };
    setDone(summary);
    setSubmitting(false);
    onComplete?.(summary);
  }

  function reset() {
    setStep("period");
    setDone(null);
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div className="rounded-[12px] border border-status-ok/30 bg-status-ok/10 p-5 text-center">
          <CheckCircle2 className="mx-auto mb-2 size-8 text-status-ok" />
          <h3 className="text-[16px] font-medium text-fg">Drafts created</h3>
          <p className="mt-1 text-[13px] text-fg-subtle">
            {done.count} renewal contract{done.count === 1 ? "" : "s"} drafted · projected +{formatMoney(projectedDelta)} ARR
          </p>
          <p className="mt-1 text-[11px] text-fg-tertiary">
            Send each for signature from the renewal pipeline.
          </p>
        </div>
        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="md" onClick={reset}>
            Run another
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => (window.location.href = "/services/contracts")}
          >
            <FileText className="size-3.5" />
            Open renewal pipeline
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StepPills
        step={step}
        setStep={setStep}
        canAdvanceTo={(target) => canAdvance(step, target, candidates.length)}
      />

      {step === "period" && (
        <Card title="Renewal window" hint="Draft renewals for contracts expiring within N days.">
          <Field label="Days out">
            <NumberInput
              value={daysOut}
              onChange={(e) => setDaysOut(e.target.value)}
              min="1"
              max="365"
              inputMode="numeric"
            />
          </Field>
          <p className="mt-2 text-[12px] text-fg-subtle">
            Common choices: 30 (urgent), 60 (typical), 90 (full quarter), 180 (early-bird campaigns).
          </p>
        </Card>
      )}

      {step === "filter" && (
        <Card title="Rate + scope" hint="Optional rate lift and dock filter for the sweep.">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rate lift %" hint="Applied to current annual_rate on each successor.">
              <NumberInput
                value={pct}
                onChange={(e) => setPct(e.target.value)}
                step="0.5"
                min="-25"
                max="50"
                inputMode="decimal"
              />
            </Field>
            <Field label="Dock scope">
              <Select value={dockScope} onChange={setDockScope}>
                <option value="all">All docks</option>
                {docks.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>
      )}

      {step === "preview" && (
        <Card
          title="Preview"
          right={
            <Badge tone={candidates.length > 0 ? "primary" : "warn"} size="sm">
              {candidates.length} renewal{candidates.length === 1 ? "" : "s"}
            </Badge>
          }
        >
          {candidates.length === 0 ? (
            <p className="text-[12px] text-status-warn">
              No active contracts expiring within {daysOut} days that don't already have a draft successor.
            </p>
          ) : (
            <>
              <div className="overflow-hidden rounded-[8px] border border-hairline">
                <table className="w-full text-[12px]">
                  <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-fg-tertiary">
                    <tr>
                      <th className="px-3 py-2 text-left">Boater</th>
                      <th className="px-3 py-2 text-left">Slip</th>
                      <th className="px-3 py-2 text-left">Expires</th>
                      <th className="px-3 py-2 text-right">Current rate</th>
                      <th className="px-3 py-2 text-right">New rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.slice(0, 50).map((c) => {
                      const boater = BOATERS.find((b) => b.id === c.boater_id);
                      const slip = c.slip_id ? SLIPS.find((s) => s.id === c.slip_id) : undefined;
                      const newRate = c.annual_rate
                        ? Math.round(c.annual_rate * (1 + lift))
                        : 0;
                      return (
                        <tr key={c.id} className="border-t border-hairline">
                          <td className="px-3 py-1.5">{boater?.display_name ?? c.boater_id}</td>
                          <td className="px-3 py-1.5">{slip?.id ?? "—"}</td>
                          <td className="px-3 py-1.5 tabular text-fg-subtle">{c.effective_end}</td>
                          <td className="px-3 py-1.5 text-right tabular">{formatMoney(c.annual_rate ?? 0)}</td>
                          <td className="px-3 py-1.5 text-right tabular text-status-ok">
                            {formatMoney(newRate)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {candidates.length > 50 && (
                  <div className="border-t border-hairline bg-surface-2 px-3 py-2 text-[11px] text-fg-tertiary">
                    Showing first 50 of {candidates.length}. All {candidates.length} will be drafted on confirm.
                  </div>
                )}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3 text-[12px]">
                <Stat
                  label="Current ARR"
                  value={formatMoney(candidates.reduce((s, c) => s + (c.annual_rate ?? 0), 0))}
                />
                <Stat label={`+${pct}% lift`} value={`+${formatMoney(projectedDelta)}`} tone="ok" />
                <Stat
                  label="Projected ARR"
                  value={formatMoney(
                    candidates.reduce((s, c) => s + (c.annual_rate ?? 0) * (1 + lift), 0),
                  )}
                />
              </div>
            </>
          )}
        </Card>
      )}

      {step === "confirm" && (
        <Card title="Confirm" hint="Approve below to draft renewal contracts.">
          <div className="grid grid-cols-3 gap-3 text-[12px]">
            <Stat label="Window" value={`${daysOut} days`} />
            <Stat label="Rate lift" value={`${pct}%`} />
            <Stat
              label="Drafts"
              value={`${candidates.length} · +${formatMoney(projectedDelta)} ARR`}
              tone="ok"
            />
          </div>
          <p className="mt-3 text-[11px] text-fg-tertiary">
            Successors land in <code>status: "draft"</code> with effective_start = predecessor.effective_end + 1 day and a 1-year term. Signing happens per-contract from the renewal pipeline.
          </p>
        </Card>
      )}

      <footer className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="md"
          onClick={() => {
            const idx = STEPS.findIndex((s) => s.key === step);
            if (idx > 0) setStep(STEPS[idx - 1].key);
          }}
          disabled={step === "period" || submitting}
        >
          <ArrowLeft className="size-3.5" />
          Back
        </Button>
        {step === "confirm" ? (
          <Button
            variant="primary"
            size="md"
            onClick={confirm}
            disabled={candidates.length === 0 || submitting}
          >
            <Sparkles className="size-3.5" />
            {submitting ? "Drafting…" : `Confirm — ${candidates.length} drafts`}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              const idx = STEPS.findIndex((s) => s.key === step);
              if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].key);
            }}
            disabled={step === "preview" && candidates.length === 0}
          >
            Next
            <ArrowRight className="size-3.5" />
          </Button>
        )}
      </footer>
    </div>
  );
}

function canAdvance(_current: Step, target: Step, count: number): boolean {
  if (target === "confirm") return count > 0;
  return true;
}

function StepPills({
  step,
  setStep,
  canAdvanceTo,
}: {
  step: Step;
  setStep: (s: Step) => void;
  canAdvanceTo: (s: Step) => boolean;
}) {
  return (
    <ol className="flex items-center gap-1 text-[12px]">
      {STEPS.map((s, i) => {
        const isActive = s.key === step;
        const canClick = canAdvanceTo(s.key);
        return (
          <React.Fragment key={s.key}>
            {i > 0 && <span aria-hidden className="text-fg-tertiary">›</span>}
            <button
              type="button"
              onClick={() => canClick && setStep(s.key)}
              disabled={!canClick}
              className={cn(
                "rounded-[6px] px-2 py-1 font-medium transition-colors",
                isActive
                  ? "bg-primary text-on-primary"
                  : canClick
                    ? "bg-surface-2 text-fg-subtle hover:text-fg"
                    : "bg-surface-2 text-fg-tertiary cursor-not-allowed",
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
          {hint && <p className="mt-0.5 text-[12px] text-fg-subtle">{hint}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" }) {
  return (
    <div className="rounded-[8px] border border-hairline bg-surface-2 p-3">
      <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">{label}</div>
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
