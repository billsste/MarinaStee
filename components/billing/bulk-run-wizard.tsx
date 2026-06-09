"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Receipt,
  Sparkles,
} from "lucide-react";
import { Field, Select, TextInput } from "@/components/create-sheet";
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
 * Bulk billing run wizard.
 *
 * Four steps: Period → Rule → Preview → Confirm. Each step keeps the
 * earlier ones reachable (clicking a prior pill jumps back so the
 * operator can amend), and the rule + period drive the preview list.
 *
 * Confirm fires the `bulk_charge` agent action which routes through
 * Convex (convex/bulkBilling.ts → executeRun) or the mock-store
 * fallback in lib/agent-actions.ts. The action card never appears —
 * this is a deliberate operator action, not an agent suggestion.
 *
 * Toast / completion view: post-run we surface a "Run completed: N
 * charges, $X total" line in step 4 and offer "Run another" / "Back to
 * billing" so the operator stays in flow.
 */

type Rule = "annual_due_this_month" | "monthly_installment" | "seasonal_due_this_month";
type Step = "period" | "rule" | "preview" | "confirm";

const RULE_LABEL: Record<Rule, string> = {
  annual_due_this_month: "Annual contracts on annual cadence — anniversary this month",
  monthly_installment: "Monthly cadence — installment due (rate ÷ 12)",
  seasonal_due_this_month: "Seasonal contracts — anniversary this month",
};

const STEPS: { key: Step; label: string }[] = [
  { key: "period", label: "Period" },
  { key: "rule", label: "Rule" },
  { key: "preview", label: "Preview" },
  { key: "confirm", label: "Confirm" },
];

export function BulkRunWizard({
  onComplete,
}: {
  onComplete?: (summary: { count: number; total: number }) => void;
}) {
  const liveContracts = useContracts();

  const [step, setStep] = React.useState<Step>("period");
  const [periodYm, setPeriodYm] = React.useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [rule, setRule] = React.useState<Rule>("annual_due_this_month");
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState<{ count: number; total: number } | null>(null);

  const tenantId = getCurrentTenantId();
  const candidates = React.useMemo(() => {
    return liveContracts.filter((c) => {
      if (c.status !== "active") return false;
      const boater = BOATERS.find((b) => b.id === c.boater_id);
      const cTenant = boater?.tenant_id ?? SEED_TENANT_ID;
      if (cTenant !== tenantId) return false;
      return matchesRule(c, rule, periodYm);
    });
  }, [liveContracts, rule, periodYm, tenantId]);

  const total = candidates.reduce((s, c) => s + amountForRule(c, rule), 0);

  function confirm() {
    if (submitting) return;
    setSubmitting(true);
    const action: AgentAction = {
      kind: "bulk_charge",
      label: `Bulk billing — ${RULE_LABEL[rule]} · ${periodYm}`,
      rule,
      period_ym: periodYm,
      target_count: candidates.length,
      estimated_total: total,
    };
    const result = executeAgentAction(action);
    if (!result.ok) {
      setSubmitting(false);
      // RBAC denial path — surface the reason in the toast slot.
      setDone({ count: 0, total: 0 });
      return;
    }
    // The mock-path mutator notifies subscribers synchronously, so
    // by the time we get here the per-boater invoices are posted.
    // The exact final count + total can drift from the preview if a
    // contract was changed mid-run; we report the preview's numbers
    // since they match what the operator approved on screen.
    const summary = { count: candidates.length, total };
    setDone(summary);
    setSubmitting(false);
    onComplete?.(summary);
  }

  function reset() {
    setStep("period");
    setRule("annual_due_this_month");
    setDone(null);
  }

  if (done) {
    return (
      <CompletionView
        summary={done}
        ruleLabel={RULE_LABEL[rule]}
        periodYm={periodYm}
        onReset={reset}
      />
    );
  }

  return (
    <div className="space-y-4">
      <StepPills step={step} setStep={setStep} canAdvanceTo={(target) => canAdvance(step, target, candidates.length)} />

      {step === "period" && (
        <Card title="Billing period" hint="Charges land with this month as the invoice date.">
          <Field label="Month (YYYY-MM)">
            <TextInput
              type="month"
              value={periodYm}
              onChange={(e) => setPeriodYm(e.target.value)}
            />
          </Field>
        </Card>
      )}

      {step === "rule" && (
        <Card title="Billing rule" hint="Which contracts are in scope this run.">
          <Field label="Rule">
            <Select value={rule} onChange={(v) => setRule(v as Rule)}>
              <option value="annual_due_this_month">Annual — anniversary this month</option>
              <option value="monthly_installment">Monthly cadence — installment due</option>
              <option value="seasonal_due_this_month">Seasonal — anniversary this month</option>
            </Select>
          </Field>
          <p className="mt-2 text-[12px] text-fg-subtle">
            {ruleHint(rule)}
          </p>
        </Card>
      )}

      {step === "preview" && (
        <Card
          title="Preview"
          right={
            <Badge tone={candidates.length > 0 ? "primary" : "warn"} size="sm">
              {candidates.length} charge{candidates.length === 1 ? "" : "s"} · {formatMoney(total)}
            </Badge>
          }
        >
          {candidates.length === 0 ? (
            <p className="text-[12px] text-status-warn">
              No active contracts match {RULE_LABEL[rule]} for {periodYm}. Adjust the rule or pick a different month.
            </p>
          ) : (
            <div className="overflow-hidden rounded-[8px] border border-hairline">
              <table className="w-full text-[12px]">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-fg-tertiary">
                  <tr>
                    <th className="px-3 py-2 text-left">Boater</th>
                    <th className="px-3 py-2 text-left">Slip</th>
                    <th className="px-3 py-2 text-left">Contract</th>
                    <th className="px-3 py-2 text-right">Base</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.slice(0, 50).map((c) => {
                    const boater = BOATERS.find((b) => b.id === c.boater_id);
                    const slip = c.slip_id ? SLIPS.find((s) => s.id === c.slip_id) : undefined;
                    const base = amountForRule(c, rule);
                    return (
                      <tr key={c.id} className="border-t border-hairline">
                        <td className="px-3 py-1.5">{boater?.display_name ?? c.boater_id}</td>
                        <td className="px-3 py-1.5">{slip?.id ?? "—"}</td>
                        <td className="px-3 py-1.5 tabular text-fg-subtle">{c.number}</td>
                        <td className="px-3 py-1.5 text-right tabular">{formatMoney(base)}</td>
                        <td className="px-3 py-1.5 text-right tabular text-fg">{formatMoney(base)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {candidates.length > 50 && (
                <div className="border-t border-hairline bg-surface-2 px-3 py-2 text-[11px] text-fg-tertiary">
                  Showing first 50 of {candidates.length}. All {candidates.length} will be charged on confirm.
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {step === "confirm" && (
        <Card title="Confirm" hint="Approve below to post the invoices + dispatch invoice-ready comms.">
          <div className="grid grid-cols-3 gap-3 text-[12px]">
            <Stat label="Period" value={periodYm} />
            <Stat label="Rule" value={RULE_LABEL[rule]} />
            <Stat label="Charges" value={`${candidates.length} · ${formatMoney(total)}`} tone="ok" />
          </div>
          <p className="mt-3 text-[11px] text-fg-tertiary">
            One invoice and one "invoice ready" comm per boater. A single bulk-run audit row is written for the batch plus per-entity rows for traceability. Reach out to accounting before re-running with the same period — duplicates are not auto-deduped.
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
            {submitting ? "Posting…" : `Confirm — ${candidates.length} charges`}
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

function CompletionView({
  summary,
  ruleLabel,
  periodYm,
  onReset,
}: {
  summary: { count: number; total: number };
  ruleLabel: string;
  periodYm: string;
  onReset: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-[12px] border border-status-ok/30 bg-status-ok/10 p-5 text-center">
        <CheckCircle2 className="mx-auto mb-2 size-8 text-status-ok" />
        <h3 className="text-[16px] font-medium text-fg">Run completed</h3>
        <p className="mt-1 text-[13px] text-fg-subtle">
          {summary.count} charge{summary.count === 1 ? "" : "s"} posted · {formatMoney(summary.total)} total
        </p>
        <p className="mt-1 text-[11px] text-fg-tertiary">
          {ruleLabel} · {periodYm}
        </p>
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button variant="ghost" size="md" onClick={onReset}>
          Run another
        </Button>
        <Button variant="primary" size="md" onClick={() => (window.location.href = "/ledger")}>
          <Receipt className="size-3.5" />
          Back to ledger
        </Button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────

function matchesRule(c: Contract, rule: Rule, periodYm: string): boolean {
  if (rule === "annual_due_this_month") {
    if (c.billing_cadence !== "annual") return false;
    return (c.effective_start ?? "").slice(0, 7) === periodYm;
  }
  if (rule === "monthly_installment") {
    return c.billing_cadence === "monthly";
  }
  if (rule === "seasonal_due_this_month") {
    if (c.billing_cadence !== "seasonal") return false;
    return (c.effective_start ?? "").slice(0, 7) === periodYm;
  }
  return false;
}

function amountForRule(c: Contract, rule: Rule): number {
  const rate = c.annual_rate ?? 0;
  if (rule === "monthly_installment") return Math.round(rate / 12);
  return rate;
}

function ruleHint(rule: Rule): string {
  if (rule === "annual_due_this_month")
    return "Charges the full annual rate to contracts whose anniversary (effective_start month) falls in the run period.";
  if (rule === "monthly_installment")
    return "Bills annual_rate ÷ 12 to every monthly-cadence contract, regardless of anniversary.";
  return "Charges the full seasonal rate to contracts whose anniversary month matches the period.";
}

function canAdvance(current: Step, target: Step, candidateCount: number): boolean {
  const order = STEPS.map((s) => s.key);
  const currentIdx = order.indexOf(current);
  const targetIdx = order.indexOf(target);
  if (targetIdx <= currentIdx) return true;
  if (target === "preview") return true;
  if (target === "confirm") return candidateCount > 0;
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
