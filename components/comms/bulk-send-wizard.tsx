"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Megaphone,
  Send,
} from "lucide-react";
import { Field, NumberInput, Select } from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BOATERS,
  SEED_TENANT_ID,
  VESSELS,
} from "@/lib/mock-data";
import { executeAgentAction } from "@/lib/agent-actions";
import { getCurrentTenantId, useCommTemplates, useStore } from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { AgentAction } from "@/lib/simulated-agent";
import type { Boater } from "@/lib/types";

/*
 * Bulk comm send wizard.
 *
 * Template → Filter → Preview (merged tokens for first 3) → Confirm.
 *
 * The preview renders the actual {{token}} substitution so the operator
 * sees what each recipient will get — this is the audit-trail moment.
 * On confirm, fires `bulk_send_comms` which fans out one Communication
 * per audience member through the Convex (or mock) path.
 *
 * When W2's lib/notification-dispatch.ts ships, the executor swaps the
 * delivered-stamp shortcut for the real provider call. The wizard
 * doesn't need to change.
 */

type FilterKind = "all_boaters" | "cadence" | "vessel_loa_over" | "has_open_balance";
type Filter =
  | { kind: "all_boaters" }
  | { kind: "cadence"; cadence: "annual" | "seasonal" | "monthly" | "transient" }
  | { kind: "vessel_loa_over"; inches: number }
  | { kind: "has_open_balance" };

type Step = "template" | "filter" | "preview" | "confirm";

const STEPS: { key: Step; label: string }[] = [
  { key: "template", label: "Template" },
  { key: "filter", label: "Filter" },
  { key: "preview", label: "Preview" },
  { key: "confirm", label: "Confirm" },
];

export function BulkSendWizard({
  onComplete,
}: {
  onComplete?: (summary: { count: number }) => void;
}) {
  const templates = useCommTemplates();
  const { ledger } = useStore();

  const [step, setStep] = React.useState<Step>("template");
  const [templateId, setTemplateId] = React.useState<string>(() => templates[0]?.id ?? "");
  const [filterKind, setFilterKind] = React.useState<FilterKind>("all_boaters");
  const [cadence, setCadence] = React.useState<"annual" | "seasonal" | "monthly" | "transient">(
    "annual",
  );
  const [loaInches, setLoaInches] = React.useState("480"); // 40 ft
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState<{ count: number } | null>(null);

  const tenantId = getCurrentTenantId();
  const template = templates.find((t) => t.id === templateId);

  const filter: Filter = React.useMemo(() => {
    if (filterKind === "cadence") return { kind: "cadence", cadence };
    if (filterKind === "vessel_loa_over")
      return { kind: "vessel_loa_over", inches: Number(loaInches) || 0 };
    if (filterKind === "has_open_balance") return { kind: "has_open_balance" };
    return { kind: "all_boaters" };
  }, [filterKind, cadence, loaInches]);

  const audience = React.useMemo(
    () => resolveAudience(filter, tenantId, ledger),
    [filter, tenantId, ledger],
  );

  // Channel feasibility — drop recipients that don't have the contact
  // method this template uses. Matches the broadcast-sheet's guard.
  const channelFilteredAudience = React.useMemo(() => {
    if (!template) return [];
    return audience.filter((b) => {
      if (template.channel === "email") return !!b.primary_contact.email;
      if (template.channel === "sms") return !!b.primary_contact.phone;
      return true;
    });
  }, [audience, template]);

  function confirm() {
    if (submitting || !template) return;
    setSubmitting(true);
    const action: AgentAction = {
      kind: "bulk_send_comms",
      label: `Bulk send: ${template.name} → ${channelFilteredAudience.length}`,
      template_id: template.id,
      template_name: template.name,
      filter,
      filter_summary: filterSummary(filter, channelFilteredAudience.length),
      target_count: channelFilteredAudience.length,
    };
    const result = executeAgentAction(action);
    if (!result.ok) {
      setSubmitting(false);
      setDone({ count: 0 });
      return;
    }
    const summary = { count: channelFilteredAudience.length };
    setDone(summary);
    setSubmitting(false);
    onComplete?.(summary);
  }

  function reset() {
    setStep("template");
    setDone(null);
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div className="rounded-[12px] border border-status-ok/30 bg-status-ok/10 p-5 text-center">
          <CheckCircle2 className="mx-auto mb-2 size-8 text-status-ok" />
          <h3 className="text-[16px] font-medium text-fg">Sent</h3>
          <p className="mt-1 text-[13px] text-fg-subtle">
            {done.count} message{done.count === 1 ? "" : "s"} dispatched
          </p>
        </div>
        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="md" onClick={reset}>
            Send another
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => (window.location.href = "/inbox")}
          >
            <Megaphone className="size-3.5" />
            Open inbox
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
        canAdvanceTo={(target) => canAdvance(target, template, channelFilteredAudience.length)}
      />

      {step === "template" && (
        <Card title="Template" hint="The merge tokens render at preview time.">
          <Field label="Comm template">
            <Select value={templateId} onChange={setTemplateId}>
              {templates.length === 0 && <option value="">— No templates —</option>}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.channel.toUpperCase()}
                </option>
              ))}
            </Select>
          </Field>
          {template && (
            <div className="mt-3 rounded-[8px] border border-hairline bg-surface-2 p-3">
              <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">Subject</div>
              <p className="mt-0.5 text-[13px] font-medium text-fg">{template.subject}</p>
              <div className="mt-2 text-[11px] uppercase tracking-wide text-fg-tertiary">Body</div>
              <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-5 text-fg-subtle">
                {template.body_markdown}
              </p>
            </div>
          )}
        </Card>
      )}

      {step === "filter" && (
        <Card title="Filter audience" hint="Choose which boaters receive this message.">
          <Field label="Filter">
            <Select value={filterKind} onChange={(v) => setFilterKind(v as FilterKind)}>
              <option value="all_boaters">All boaters</option>
              <option value="cadence">By billing cadence</option>
              <option value="vessel_loa_over">Vessel LOA over…</option>
              <option value="has_open_balance">Boaters with open balance</option>
            </Select>
          </Field>
          {filterKind === "cadence" && (
            <Field label="Cadence">
              <Select value={cadence} onChange={(v) => setCadence(v as typeof cadence)}>
                <option value="annual">Annual</option>
                <option value="seasonal">Seasonal</option>
                <option value="monthly">Monthly</option>
                <option value="transient">Transient</option>
              </Select>
            </Field>
          )}
          {filterKind === "vessel_loa_over" && (
            <Field
              label="LOA (inches)"
              hint="Vessels at or above this length overall. 480 = 40 feet."
            >
              <NumberInput
                value={loaInches}
                onChange={(e) => setLoaInches(e.target.value)}
                min="12"
                max="2400"
                step="12"
                inputMode="numeric"
              />
            </Field>
          )}
          <p className="mt-2 text-[12px] text-fg-subtle">
            Audience: <strong className="text-fg">{audience.length}</strong> match
            {audience.length === 1 ? "" : "es"} the filter
            {template
              ? `, ${channelFilteredAudience.length} have the ${template.channel === "email" ? "email" : "phone"} on file.`
              : "."}
          </p>
        </Card>
      )}

      {step === "preview" && template && (
        <Card
          title="Preview"
          right={
            <Badge tone={channelFilteredAudience.length > 0 ? "primary" : "warn"} size="sm">
              {channelFilteredAudience.length} recipient{channelFilteredAudience.length === 1 ? "" : "s"}
            </Badge>
          }
        >
          {channelFilteredAudience.length === 0 ? (
            <p className="text-[12px] text-status-warn">
              Nobody in the audience has a {template.channel === "email" ? "email" : "phone"} on file. Switch the template or broaden the filter.
            </p>
          ) : (
            <div className="space-y-3">
              {channelFilteredAudience.slice(0, 3).map((b) => {
                const subject = renderTokens(template.subject, b);
                const body = renderTokens(template.body_markdown, b);
                return (
                  <div
                    key={b.id}
                    className="rounded-[8px] border border-hairline bg-surface-2 p-3"
                  >
                    <div className="mb-1 flex items-center justify-between text-[11px] text-fg-tertiary">
                      <span>To: {b.display_name}</span>
                      <span>
                        {template.channel === "email"
                          ? b.primary_contact.email
                          : b.primary_contact.phone}
                      </span>
                    </div>
                    {template.channel === "email" && (
                      <p className="text-[13px] font-medium text-fg">{subject}</p>
                    )}
                    <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-fg-subtle">
                      {body}
                    </p>
                  </div>
                );
              })}
              {channelFilteredAudience.length > 3 && (
                <p className="text-[11px] text-fg-tertiary">
                  {channelFilteredAudience.length - 3} more recipients will get the same template
                  rendered with their own merge values.
                </p>
              )}
            </div>
          )}
        </Card>
      )}

      {step === "confirm" && template && (
        <Card title="Confirm" hint="Approve below to dispatch.">
          <div className="grid grid-cols-3 gap-3 text-[12px]">
            <Stat label="Template" value={template.name} />
            <Stat label="Channel" value={template.channel.toUpperCase()} />
            <Stat
              label="Recipients"
              value={`${channelFilteredAudience.length}`}
              tone="ok"
            />
          </div>
          <p className="mt-3 text-[11px] text-fg-tertiary">
            One Communication per recipient + one bulk-run audit row + per-recipient audit rows. When Postmark/Twilio is connected for this tenant, comms dispatch through the provider; otherwise they land as `delivered` for the inbox timeline.
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
          disabled={step === "template" || submitting}
        >
          <ArrowLeft className="size-3.5" />
          Back
        </Button>
        {step === "confirm" ? (
          <Button
            variant="primary"
            size="md"
            onClick={confirm}
            disabled={!template || channelFilteredAudience.length === 0 || submitting}
          >
            <Send className="size-3.5" />
            {submitting ? "Sending…" : `Confirm — ${channelFilteredAudience.length} recipients`}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              const idx = STEPS.findIndex((s) => s.key === step);
              if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].key);
            }}
            disabled={!template || (step === "preview" && channelFilteredAudience.length === 0)}
          >
            Next
            <ArrowRight className="size-3.5" />
          </Button>
        )}
      </footer>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Audience resolver
// ────────────────────────────────────────────────────────────

type LedgerEntryLite = {
  boater_id: string;
  type: string;
  open_balance: number;
};

function resolveAudience(
  filter: Filter,
  tenantId: string,
  ledger: LedgerEntryLite[],
): Boater[] {
  const tenantBoaters = BOATERS.filter(
    (b) => (b.tenant_id ?? SEED_TENANT_ID) === tenantId && b.active !== false,
  );
  if (filter.kind === "all_boaters") return tenantBoaters;
  if (filter.kind === "cadence") {
    return tenantBoaters.filter((b) => b.billing_cadence === filter.cadence);
  }
  if (filter.kind === "vessel_loa_over") {
    const inches = filter.inches;
    const ids = new Set(
      VESSELS.filter((v) => (v.loa_inches ?? 0) >= inches).map((v) => v.boater_id),
    );
    return tenantBoaters.filter((b) => ids.has(b.id));
  }
  if (filter.kind === "has_open_balance") {
    const owed = new Map<string, number>();
    for (const inv of ledger) {
      if (inv.type !== "invoice") continue;
      owed.set(inv.boater_id, (owed.get(inv.boater_id) ?? 0) + inv.open_balance);
    }
    return tenantBoaters.filter((b) => (owed.get(b.id) ?? 0) > 0);
  }
  return [];
}

function filterSummary(filter: Filter, count: number): string {
  if (filter.kind === "all_boaters") return `All boaters · ${count}`;
  if (filter.kind === "cadence") return `${filter.cadence} cadence · ${count}`;
  if (filter.kind === "vessel_loa_over") return `LOA ≥ ${filter.inches}" · ${count}`;
  if (filter.kind === "has_open_balance") return `Open balance · ${count}`;
  return `${count}`;
}

// ────────────────────────────────────────────────────────────
// Token renderer (mirrors convex/bulkComms.ts and lib/agent-actions.ts)
// ────────────────────────────────────────────────────────────

function renderTokens(template: string, b: Boater): string {
  if (!template) return "";
  return template
    .replace(/\{\{\s*boater\.first_name\s*\}\}/g, b.first_name)
    .replace(/\{\{\s*boater\.last_name\s*\}\}/g, b.last_name)
    .replace(/\{\{\s*boater\.display_name\s*\}\}/g, b.display_name)
    .replace(/\{\{\s*customer\.first_name\s*\}\}/g, b.first_name)
    .replace(/\{\{\s*customer\.display_name\s*\}\}/g, b.display_name)
    .replace(/\{\{\s*first_name\s*\}\}/g, b.first_name)
    .replace(/\{\{\s*last_name\s*\}\}/g, b.last_name)
    .replace(/\{\{\s*display_name\s*\}\}/g, b.display_name)
    .replace(/\{\{\s*marina\.short_name\s*\}\}/g, "Marina Stee");
}

function canAdvance(
  target: Step,
  template: { id: string } | undefined,
  count: number,
): boolean {
  if (target === "template") return true;
  // After the early-return, target is "filter" | "preview" | "confirm";
  // without a template chosen, none of those are reachable.
  if (!template) return false;
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
