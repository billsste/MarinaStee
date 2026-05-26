"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Sparkles, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardFooter } from "@/components/wizard/wizard-footer";
import type { WizardStep } from "@/components/wizard/wizard-progress";
import { NewBoaterSheet } from "@/components/boaters/new-boater-sheet";
import { BOATERS, CONTRACT_TEMPLATES, VESSELS, formatMoney } from "@/lib/mock-data";
import {
  useBoaters,
  useContractTemplates,
  useFees,
  useRates,
} from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";
import { cn } from "@/lib/utils";

/*
 * Slip-assignment wizard client. Modeled on HomeField Raise's campaign
 * wizard (NewCampaignClient.tsx) — multi-step useState container,
 * sessionStorage resume, per-step `canStepN` validation gating the
 * Continue button.
 *
 * Steps:
 *   0. Holder       — pick existing (combobox) or create new (sheet)
 *   1. Rate         — pick a Rate card matching the slip's occupancy type
 *   2. Services     — toggle on optional AdditionalFee items
 *   3. Contract     — template + start/end dates + optional attachments
 *   4. Review       — full summary, then Draft contract
 */

type SlipMeta = {
  id: string;
  number: string;
  dock: string;
  loaInches: number;
  beamInches: number;
  hasPower: boolean;
  hasWater: boolean;
  occupancyType: string;
};

const STORAGE_KEY_PREFIX = "marina_assign_slip_draft_";

const STEPS: WizardStep[] = [
  { id: "holder", label: "Holder" },
  { id: "rate", label: "Rate" },
  { id: "services", label: "Services" },
  { id: "contract", label: "Contract" },
  { id: "review", label: "Review" },
];

type DraftState = {
  boaterId: string;
  rateId: string;
  selectedFeeIds: string[];
  templateId: string;
  vesselId: string;
  start: string;
  end: string;
  attachmentNames: string[]; // metadata only — actual files don't survive reload
};

type LocalAttachment = {
  name: string;
  dataUrl: string;
  mime: string;
  sizeBytes: number;
};

export function AssignSlipClient({ slip }: { slip: SlipMeta }) {
  const router = useRouter();
  const liveBoaters = useBoaters();
  const boaters = liveBoaters.length > 0 ? liveBoaters : BOATERS;
  const rates = useRates();
  const fees = useFees();
  const templates = useContractTemplates();

  const [stepIdx, setStepIdx] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);
  const [newHolderOpen, setNewHolderOpen] = React.useState(false);

  const [draft, setDraft] = React.useState<DraftState>(() => {
    const firstTpl = templates[0] ?? CONTRACT_TEMPLATES[0];
    const today = new Date().toISOString().slice(0, 10);
    const months = firstTpl?.default_term_months ?? 12;
    const endDate = new Date(Date.now() + months * 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return {
      boaterId: "",
      rateId: "",
      selectedFeeIds: [],
      templateId: firstTpl?.id ?? "",
      vesselId: "",
      start: today,
      end: endDate,
      attachmentNames: [],
    };
  });

  // Attachments live outside the draft state because File data doesn't
  // serialize to sessionStorage. Re-uploading on resume is fine.
  const [attachments, setAttachments] = React.useState<LocalAttachment[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // ── sessionStorage resume ────────────────────────────────────────────
  const storageKey = `${STORAGE_KEY_PREFIX}${slip.id}`;
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { step: number; draft: DraftState };
        if (parsed.draft) setDraft(parsed.draft);
        if (typeof parsed.step === "number") setStepIdx(parsed.step);
      }
    } catch {
      /* ignore corrupt drafts */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify({ step: stepIdx, draft })
      );
    } catch {
      /* ignore quota / privacy errors */
    }
  }, [stepIdx, draft, storageKey]);

  // ── Derived ──────────────────────────────────────────────────────────
  const selectedBoater = boaters.find((b) => b.id === draft.boaterId);
  const selectedRate = rates.find((r) => r.id === draft.rateId);
  const selectedTemplate = templates.find((t) => t.id === draft.templateId);
  const selectedFees = fees.filter((f) => draft.selectedFeeIds.includes(f.id));
  const vesselOptions = selectedBoater
    ? VESSELS.filter(
        (v) =>
          v.boater_id === selectedBoater.id ||
          v.co_owner_ids.includes(selectedBoater.id)
      )
    : [];

  // Recommend rates matching this slip's occupancy_type. Marina seeds
  // OccupancyType values like "Standard" / "Jet Ski" / etc.; SLIPS-derived
  // slips report "Standard" by default.
  const recommendedRates = rates.filter(
    (r) =>
      r.occupancy_type === slip.occupancyType ||
      r.occupancy_type === "Standard"
  );
  const otherRates = rates.filter((r) => !recommendedRates.includes(r));

  // Cadence + annual rate flow from the selected Rate card (Batch 2 #169).
  const cadence = selectedRate?.cadence ?? "monthly";
  const annualRate = selectedRate?.amount;

  // ── Validation gates ────────────────────────────────────────────────
  const canStep0 = draft.boaterId.length > 0;
  const canStep1 = draft.rateId.length > 0;
  const canStep2 = true; // services are optional
  const canStep3 =
    draft.templateId.length > 0 &&
    draft.start.length > 0 &&
    draft.end.length > 0 &&
    draft.start <= draft.end;
  const canStep4 = canStep0 && canStep1 && canStep3;

  const canContinue = [canStep0, canStep1, canStep2, canStep3, canStep4][stepIdx];

  // ── Actions ─────────────────────────────────────────────────────────
  function next() {
    if (stepIdx < STEPS.length - 1) setStepIdx((i) => i + 1);
  }
  function back() {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const reads = await Promise.all(
      files.map(
        (f) =>
          new Promise<LocalAttachment>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                name: f.name,
                dataUrl: typeof reader.result === "string" ? reader.result : "",
                mime: f.type || "application/octet-stream",
                sizeBytes: f.size,
              });
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(f);
          })
      )
    );
    setAttachments((prev) => [...prev, ...reads]);
    setDraft((d) => ({
      ...d,
      attachmentNames: [...d.attachmentNames, ...reads.map((r) => r.name)],
    }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
    setDraft((d) => ({
      ...d,
      attachmentNames: d.attachmentNames.filter((_, i) => i !== idx),
    }));
  }

  async function submit() {
    if (!canStep4 || !selectedRate) return;
    setSubmitting(true);
    try {
      executeAgentAction({
        kind: "create_contract",
        label: "",
        boater_id: draft.boaterId,
        template_id: draft.templateId,
        vessel_id: draft.vesselId || undefined,
        slip_id: slip.id,
        effective_start: draft.start,
        effective_end: draft.end,
        annual_rate: annualRate,
        billing_cadence: cadence as "annual" | "seasonal" | "monthly" | "transient",
        attachments:
          attachments.length > 0
            ? attachments.map((a) => ({
                name: a.name,
                url: a.dataUrl,
                mime_type: a.mime,
                size_bytes: a.sizeBytes,
                type: "supporting_doc",
              }))
            : undefined,
      });
      // Clear the draft cache once committed
      try {
        window.sessionStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
      // Land them on the holder's page so they see the new contract
      // inline. If we couldn't resolve a boater for some reason, fall
      // back to the contracts list.
      const dest = selectedBoater
        ? `/holders/${selectedBoater.id}`
        : "/slips/contracts";
      router.push(dest);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Right-rail context: the slip itself (always visible) ─────────────
  const rightRail = (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
          Slip
        </div>
        <div className="mt-1 text-[20px] font-semibold text-fg">
          {slip.number}
        </div>
        <div className="text-[12px] text-fg-subtle">{slip.dock}</div>
      </div>
      <dl className="space-y-1.5 border-t border-hairline pt-3 text-[12px]">
        <RailRow label="Type" value={slip.occupancyType} />
        {slip.loaInches > 0 && (
          <RailRow label="Max LOA" value={`${Math.round(slip.loaInches / 12)}'`} />
        )}
        {slip.beamInches > 0 && (
          <RailRow label="Max Beam" value={`${Math.round(slip.beamInches / 12)}'`} />
        )}
        <RailRow label="Power" value={slip.hasPower ? "Yes" : "No"} />
        <RailRow label="Water" value={slip.hasWater ? "Yes" : "No"} />
      </dl>
      {/* Agent affordance — Marina Stee's differentiator */}
      <div className="rounded-[10px] border border-primary/30 bg-primary-soft/40 p-3">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-primary">
          <Sparkles className="size-3.5" />
          Ask the agent
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-subtle">
          Try: "Annual contract for {slip.number}, standard rate, monthly billing,
          start today" — the agent fills the whole wizard.
        </p>
      </div>
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <>
      <NewBoaterSheet
        open={newHolderOpen}
        onOpenChange={(b) => {
          setNewHolderOpen(b);
          if (!b) {
            const sorted = [...liveBoaters].sort((a, c) => (a.id < c.id ? 1 : -1));
            const latest = sorted[0];
            if (latest) setDraft((d) => ({ ...d, boaterId: latest.id }));
          }
        }}
      />

      <WizardShell
        eyebrow={`Assign slip ${slip.number} · ${slip.dock}`}
        title={STEP_TITLES[stepIdx]}
        subtitle={STEP_SUBTITLES[stepIdx]}
        steps={STEPS}
        currentIdx={stepIdx}
        onStepClick={(idx) => idx < stepIdx && setStepIdx(idx)}
        rightRail={rightRail}
      >
        {/* Step 0 — Holder */}
        {stepIdx === 0 && (
          <div className="space-y-4">
            <FieldLabel
              label="Existing holder"
              hint="Search by name or code. If they're new, create one below."
            >
              <Combobox
                value={draft.boaterId}
                onChange={(v) => setDraft((d) => ({ ...d, boaterId: v }))}
                options={boaters.map((b) => ({
                  value: b.id,
                  label: b.display_name,
                  hint: b.code ? `· ${b.code}` : undefined,
                }))}
                placeholder="Pick a holder…"
                searchPlaceholder="Search by name, code…"
                onCreateNew={() => setNewHolderOpen(true)}
                createNewLabel="Create new holder"
              />
            </FieldLabel>

            {selectedBoater && (
              <div className="rounded-[10px] border border-hairline bg-surface-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[14px] font-medium text-fg">
                      {selectedBoater.display_name}
                    </div>
                    <div className="text-[12px] text-fg-subtle">
                      {selectedBoater.primary_contact.email ??
                        selectedBoater.primary_contact.phone ??
                        "—"}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Badge tone="info" size="sm">
                        {selectedBoater.billing_cadence}
                      </Badge>
                      {selectedBoater.code && (
                        <Badge tone="neutral" size="sm">
                          {selectedBoater.code}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, boaterId: "" }))}
                    className="text-[11px] text-fg-subtle hover:text-fg"
                    aria-label="Clear holder"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
            )}

            <FieldLabel
              label="Vessel (optional)"
              hint="Pick a vessel on file for this holder, or skip and attach later."
            >
              <Combobox
                value={draft.vesselId}
                onChange={(v) => setDraft((d) => ({ ...d, vesselId: v }))}
                options={vesselOptions.map((v) => ({
                  value: v.id,
                  label: v.name,
                  hint: v.year ? `· ${v.year}` : undefined,
                }))}
                placeholder={selectedBoater ? "No vessel" : "Pick a holder first"}
                searchPlaceholder="Search vessels…"
                disabled={!selectedBoater}
              />
            </FieldLabel>
          </div>
        )}

        {/* Step 1 — Rate */}
        {stepIdx === 1 && (
          <div className="space-y-4">
            {recommendedRates.length > 0 && (
              <div>
                <div className="mb-2 text-[11px] uppercase tracking-wide text-fg-tertiary">
                  Recommended for {slip.occupancyType}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {recommendedRates.map((r) => (
                    <RateCard
                      key={r.id}
                      name={r.name}
                      amount={r.amount}
                      cadence={r.cadence}
                      selected={draft.rateId === r.id}
                      onClick={() => setDraft((d) => ({ ...d, rateId: r.id }))}
                    />
                  ))}
                </div>
              </div>
            )}
            {otherRates.length > 0 && (
              <div>
                <div className="mb-2 text-[11px] uppercase tracking-wide text-fg-tertiary">
                  All other rates
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {otherRates.map((r) => (
                    <RateCard
                      key={r.id}
                      name={r.name}
                      amount={r.amount}
                      cadence={r.cadence}
                      selected={draft.rateId === r.id}
                      onClick={() => setDraft((d) => ({ ...d, rateId: r.id }))}
                    />
                  ))}
                </div>
              </div>
            )}
            {rates.length === 0 && (
              <div className="rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 p-6 text-center text-[13px] text-fg-subtle">
                No rate cards configured yet. Add one in <strong>/slips/rates</strong> first.
              </div>
            )}
          </div>
        )}

        {/* Step 2 — Services */}
        {stepIdx === 2 && (
          <div className="space-y-3">
            <p className="text-[12px] text-fg-subtle">
              Optional add-ons billed alongside the slip. Skip if none apply — you can add them later from the holder's Financials tab.
            </p>
            {fees.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 p-6 text-center text-[13px] text-fg-subtle">
                No additional fees configured. Add to <strong>/slips/fees</strong>.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {fees.map((f) => {
                  const checked = draft.selectedFeeIds.includes(f.id);
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            selectedFeeIds: checked
                              ? d.selectedFeeIds.filter((x) => x !== f.id)
                              : [...d.selectedFeeIds, f.id],
                          }))
                        }
                        className={cn(
                          "flex w-full items-start justify-between gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors",
                          checked
                            ? "border-primary bg-primary-soft/40"
                            : "border-hairline bg-surface-1 hover:bg-surface-2"
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-fg">
                              {f.name}
                            </span>
                            <Badge tone="outline" size="sm">
                              {f.billing_mode}
                            </Badge>
                          </div>
                          {f.description && (
                            <p className="mt-0.5 text-[11px] text-fg-subtle">
                              {f.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="money-display text-[15px] text-fg">
                            {formatMoney(f.amount)}
                          </span>
                          <span
                            className={cn(
                              "flex size-5 items-center justify-center rounded-full border",
                              checked
                                ? "border-primary bg-primary text-on-primary"
                                : "border-hairline-strong"
                            )}
                          >
                            {checked && <Check className="size-3" />}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Step 3 — Contract */}
        {stepIdx === 3 && (
          <div className="space-y-4">
            <FieldLabel
              label="Contract template"
              hint="Picks the legal document used. Term + rate flow from your Rate selection in step 2."
            >
              <Combobox
                value={draft.templateId}
                onChange={(v) => setDraft((d) => ({ ...d, templateId: v }))}
                options={templates.map((t) => ({
                  value: t.id,
                  label: t.name,
                  hint: `· v${t.version}`,
                }))}
                placeholder="Pick a template…"
                searchPlaceholder="Search templates…"
              />
            </FieldLabel>

            <div className="grid gap-3 sm:grid-cols-2">
              <FieldLabel label="Effective start" required>
                <input
                  type="date"
                  value={draft.start}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, start: e.target.value }))
                  }
                  className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
                />
              </FieldLabel>
              <FieldLabel label="Effective end" required>
                <input
                  type="date"
                  value={draft.end}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, end: e.target.value }))
                  }
                  className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
                />
              </FieldLabel>
            </div>
            {draft.start && draft.end && draft.start > draft.end && (
              <p className="text-[12px] text-status-danger">
                End must be on or after start.
              </p>
            )}

            <FieldLabel
              label="Attachments (optional)"
              hint="PDFs, DOCX, signed copies, addenda. Stored with the contract."
            >
              <div className="space-y-2">
                <label className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 px-4 py-3 text-[12px] text-fg-subtle hover:bg-surface-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <span>+ Add attachment(s)</span>
                </label>
                {attachments.length > 0 && (
                  <ul className="space-y-1.5">
                    {attachments.map((a, idx) => (
                      <li
                        key={`${a.name}-${idx}`}
                        className="flex items-center justify-between gap-2 rounded-[8px] border border-hairline bg-surface-2 px-3 py-1.5 text-[12px]"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-fg">
                          {a.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeAttachment(idx)}
                          className="text-[11px] text-fg-subtle hover:text-status-danger"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </FieldLabel>
          </div>
        )}

        {/* Step 4 — Review */}
        {stepIdx === 4 && (
          <div className="space-y-4">
            <ReviewBlock
              label="Holder"
              value={
                selectedBoater
                  ? `${selectedBoater.display_name}${
                      selectedBoater.code ? ` · ${selectedBoater.code}` : ""
                    }`
                  : "—"
              }
              onEdit={() => setStepIdx(0)}
            />
            {draft.vesselId && (
              <ReviewBlock
                label="Vessel"
                value={
                  VESSELS.find((v) => v.id === draft.vesselId)?.name ?? "—"
                }
                onEdit={() => setStepIdx(0)}
              />
            )}
            <ReviewBlock
              label="Rate"
              value={
                selectedRate
                  ? `${selectedRate.name} · ${formatMoney(
                      selectedRate.amount
                    )}/${selectedRate.cadence}`
                  : "—"
              }
              onEdit={() => setStepIdx(1)}
            />
            {selectedFees.length > 0 && (
              <ReviewBlock
                label="Services"
                value={selectedFees.map((f) => `${f.name} (${formatMoney(f.amount)})`).join(", ")}
                onEdit={() => setStepIdx(2)}
              />
            )}
            <ReviewBlock
              label="Contract"
              value={
                selectedTemplate
                  ? `${selectedTemplate.name} · ${draft.start} → ${draft.end}`
                  : "—"
              }
              onEdit={() => setStepIdx(3)}
            />
            {attachments.length > 0 && (
              <ReviewBlock
                label="Attachments"
                value={attachments.map((a) => a.name).join(", ")}
                onEdit={() => setStepIdx(3)}
              />
            )}
          </div>
        )}

        <WizardFooter
          stepIndex={stepIdx}
          totalSteps={STEPS.length}
          stepLabel={STEPS[stepIdx].label}
          onBack={back}
          onContinue={stepIdx === STEPS.length - 1 ? submit : next}
          continueLabel={stepIdx === STEPS.length - 1 ? "Draft contract" : "Continue"}
          continueDisabled={!canContinue}
          busy={submitting}
          exitHref="/slips/roster"
          busyLabel="Drafting…"
        />
      </WizardShell>
    </>
  );
}

// ── Step copy ─────────────────────────────────────────────────────────

const STEP_TITLES = [
  "Who's holding the slip?",
  "What rate are they on?",
  "Add any extra services",
  "Pick the contract",
  "Review and draft",
];

const STEP_SUBTITLES = [
  "Search existing holders or create a new one. You can attach a vessel now or later.",
  "Pick from the configured Rate cards — term, cadence, and price flow through to the contract.",
  "Optional add-ons billed alongside the slip (pump-out, hoist, COI processing, etc.).",
  "Choose the legal document, set the effective dates, and upload signed copies if you have them.",
  "Confirm the details — clicking Draft creates a contract in draft status, ready to send for signature.",
];

// ── Small inline subcomponents ────────────────────────────────────────

function FieldLabel({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-fg-subtle">
          {label}
          {required && <span className="ml-1 text-status-danger">*</span>}
        </span>
      </div>
      {children}
      {hint && (
        <p className="mt-1 text-[11px] text-fg-tertiary">{hint}</p>
      )}
    </label>
  );
}

function RailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-fg-tertiary">{label}</dt>
      <dd className="text-fg">{value}</dd>
    </div>
  );
}

function RateCard({
  name,
  amount,
  cadence,
  selected,
  onClick,
}: {
  name: string;
  amount: number;
  cadence: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start justify-between gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
          : "border-hairline bg-surface-1 hover:border-hairline-strong hover:bg-surface-2"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-fg">{name}</div>
        <div className="mt-0.5 text-[11px] capitalize text-fg-tertiary">
          {cadence}
        </div>
      </div>
      <div className="text-right">
        <div className="money-display text-[18px] text-fg">
          {formatMoney(amount)}
        </div>
        <div className="text-[10px] text-fg-tertiary">/ {cadence}</div>
      </div>
    </button>
  );
}

function ReviewBlock({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[10px] border border-hairline bg-surface-1 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">
          {label}
        </div>
        <div className="mt-0.5 text-[13px] text-fg">{value}</div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="text-[12px] text-primary hover:underline"
      >
        Edit
      </button>
    </div>
  );
}
