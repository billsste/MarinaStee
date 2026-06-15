"use client";

import * as React from "react";
import { Check, Sparkles } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardFooter } from "@/components/wizard/wizard-footer";
import type { WizardStep } from "@/components/wizard/wizard-progress";
import {
  CadenceCard,
  FieldLabel,
  RailRow,
  ReviewBlock,
  ReviewList,
} from "@/components/wizard/wizard-fields";
import { useWizardDraft } from "@/components/wizard/use-wizard-draft";
import { NewBoaterSheet } from "@/components/boaters/new-boater-sheet";
import { AddVesselSheet } from "@/components/boaters/add-vessel-sheet";
import {
  BOATERS,
  CONTRACT_TEMPLATES,
  VESSELS,
  formatMoney,
} from "@/lib/mock-data";
import {
  addCommunication,
  mintContractSignatureToken,
  totalFromAttachedFees,
  updateContract,
  useBoaters,
  useContractTemplates,
  useFeesForEntity,
  useSlips,
  useVesselsForBoater,
} from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";
import type { AdditionalFee, BillingCadence, Communication } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Cadence display order for the grouped fee picker + right-rail rollup. */
const FEE_CADENCE_ORDER: Array<"one_time" | "monthly" | "annual"> = [
  "one_time",
  "monthly",
  "annual",
];

const FEE_CADENCE_HEADER: Record<"one_time" | "monthly" | "annual", string> = {
  one_time: "One-time fees",
  monthly: "Monthly recurring",
  annual: "Annual",
};

const FEE_CADENCE_SUFFIX: Record<"one_time" | "monthly" | "annual", string> = {
  one_time: "once",
  monthly: "/ month",
  annual: "/ year",
};

/** Month-count between two ISO date strings (rounded up, min 1). */
function termMonthsBetween(startISO: string, endISO: string): number {
  if (!startISO || !endISO) return 1;
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
  const ms = end.getTime() - start.getTime();
  if (ms <= 0) return 1;
  // Average month length — matches the slip-default seeding used elsewhere
  // in the wizard (30-day months). Round up so a 13-month term doesn't
  // get truncated to 12.
  const months = Math.ceil(ms / (30 * 86_400_000));
  return Math.max(1, months);
}

/*
 * Slip-contract wizard — modal-mode multi-step flow that drafts a slip
 * contract and chains the signature/onboarding dispatch in one go.
 *
 * Modeled on the slip-assignment gold standard
 * (app/services/[id]/assign/assign-slip-client.tsx). Reuses the shared
 * wizard primitives:
 *   - WizardShell (chrome="modal" + onExit)
 *   - WizardFooter (onExit)
 *   - FieldLabel / RailRow / ReviewBlock / CadenceCard
 *   - useWizardDraft (sessionStorage resume)
 *
 * Steps:
 *   0. Holder & vessel   — pick boater (create inline) + vessel
 *   1. Slip & term       — pick slip + cadence + effective dates
 *   2. Template & fees   — pick ContractTemplate + multi-select add-on fees
 *   3. Review & send     — confirm, then draft contract + dispatch signature
 *                          token + outbound onboarding Communication.
 */

const STORAGE_KEY = "marina_contract_wizard_draft_v1";

const STEPS: WizardStep[] = [
  { id: "holder", label: "Holder & vessel" },
  { id: "slip", label: "Slip & term" },
  { id: "template", label: "Template & fees" },
  { id: "review", label: "Review & send" },
];

const STEP_TITLES = [
  "Who's the contract for?",
  "Which slip and what term?",
  "Pick the template and add any services",
  "Review and draft the contract",
];

const STEP_SUBTITLES = [
  "Search existing members or create a new one. Attach a vessel now or skip and add it later.",
  "Pick an open slip, choose the billing cadence, and set effective dates. Defaults flow from the slip.",
  "Pick the legal document. Toggle any add-on services billed alongside the slip (winterization, pump-out, etc.).",
  "Confirm the details — Draft creates the contract in draft status, mints a signature link, and sends an onboarding message to the holder.",
];

type CadenceKind = "annual" | "monthly" | "seasonal";

type DraftState = {
  boaterId: string;
  vesselId: string;
  slipId: string;
  cadence: CadenceKind;
  amount: number;
  templateId: string;
  selectedFeeIds: string[];
  start: string;
  end: string;
};

export function ContractWizard({
  open,
  onOpenChange,
  defaultBoaterId,
  defaultSlipId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  /** Pre-fill the holder — e.g. when launched from a boater Financials tab. */
  defaultBoaterId?: string;
  /** Pre-fill the slip — e.g. when launched from a slip detail page. */
  defaultSlipId?: string;
}) {
  const liveBoaters = useBoaters();
  const boaters = liveBoaters.length > 0 ? liveBoaters : BOATERS;
  const slips = useSlips();
  const templates = useContractTemplates();
  // Contract-scoped fees only — Phase 1 unified service-fee model. The
  // reactive hook subscribes to the fee catalog so newly-added fees
  // surface in the picker without needing to re-open the wizard.
  const fees = useFeesForEntity("contract");

  const [submitting, setSubmitting] = React.useState(false);
  const [newHolderOpen, setNewHolderOpen] = React.useState(false);
  const [newVesselOpen, setNewVesselOpen] = React.useState(false);

  // sessionStorage-backed wizard state. Persist both step + draft so the
  // operator can resume where they left off.
  const [persisted, setPersisted, clearPersisted] = useWizardDraft<{
    step: number;
    draft: DraftState;
  }>(STORAGE_KEY, () => {
    const firstTpl = templates[0] ?? CONTRACT_TEMPLATES[0];
    const today = new Date().toISOString().slice(0, 10);
    const months = firstTpl?.default_term_months ?? 12;
    const endDate = new Date(Date.now() + months * 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return {
      step: 0,
      draft: {
        boaterId: defaultBoaterId ?? "",
        vesselId: "",
        slipId: defaultSlipId ?? "",
        cadence: "annual" as CadenceKind,
        amount: 0,
        templateId: firstTpl?.id ?? "",
        selectedFeeIds: [],
        start: today,
        end: endDate,
      },
    };
  });

  const stepIdx = persisted.step;
  const draft = persisted.draft;
  const setStepIdx = React.useCallback(
    (next: number | ((prev: number) => number)) => {
      setPersisted((p) => ({
        ...p,
        step:
          typeof next === "function"
            ? (next as (n: number) => number)(p.step)
            : next,
      }));
    },
    [setPersisted]
  );
  const setDraft = React.useCallback(
    (next: DraftState | ((prev: DraftState) => DraftState)) => {
      setPersisted((p) => ({
        ...p,
        draft:
          typeof next === "function"
            ? (next as (d: DraftState) => DraftState)(p.draft)
            : next,
      }));
    },
    [setPersisted]
  );

  // When opened with launch-context defaults (defaultBoaterId / defaultSlipId),
  // pin them on the current draft so the launch source always wins. Doesn't
  // clobber other fields — preserves resume behavior.
  React.useEffect(() => {
    if (!open) return;
    if (defaultBoaterId || defaultSlipId) {
      setDraft((d) => ({
        ...d,
        boaterId: defaultBoaterId ?? d.boaterId,
        slipId: defaultSlipId ?? d.slipId,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultBoaterId, defaultSlipId]);

  // ── Derived ──────────────────────────────────────────────────────────
  const selectedBoater = boaters.find((b) => b.id === draft.boaterId);
  const selectedSlip = slips.find((s) => s.id === draft.slipId);
  const selectedTemplate = templates.find((t) => t.id === draft.templateId);
  const selectedFees = fees.filter((f) => draft.selectedFeeIds.includes(f.id));
  // Live vessels — newly-created vessels in this session surface immediately.
  const liveVessels = useVesselsForBoater(draft.boaterId);
  const vesselOptions = selectedBoater
    ? liveVessels.length > 0
      ? liveVessels
      : VESSELS.filter(
          (v) =>
            v.boater_id === selectedBoater.id ||
            v.co_owner_ids.includes(selectedBoater.id)
        )
    : [];
  const selectedVessel = vesselOptions.find((v) => v.id === draft.vesselId);

  // Slip-intrinsic defaults for the chosen cadence.
  const slipDefaultForCadence = React.useCallback(
    (c: CadenceKind): number => {
      if (!selectedSlip) return 0;
      if (c === "annual") return selectedSlip.default_annual_rate;
      if (c === "monthly")
        return (
          selectedSlip.default_monthly_rate ??
          Math.round(selectedSlip.default_annual_rate / 12)
        );
      return (
        selectedSlip.default_seasonal_rate ??
        Math.round(selectedSlip.default_annual_rate * 0.6)
      );
    },
    [selectedSlip]
  );

  // When a slip is picked / changed, seed the amount from its default rate
  // for the current cadence. Doesn't override an existing non-zero amount
  // unless the slip changes (so the operator can fine-tune without losing
  // their input mid-flow).
  React.useEffect(() => {
    if (!selectedSlip) return;
    const def = slipDefaultForCadence(draft.cadence);
    if (def > 0 && draft.amount === 0) {
      setDraft((d) => ({ ...d, amount: def }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlip?.id, draft.cadence]);

  // Annual rate stored on the contract record (consumers think in $/year).
  const annualRate =
    draft.cadence === "annual"
      ? draft.amount
      : draft.cadence === "monthly"
      ? draft.amount * 12
      : draft.amount * 2; // seasonal ≈ 6mo, so 2× ≈ annual proxy
  const billingCadence: BillingCadence =
    draft.cadence === "annual"
      ? "annual"
      : draft.cadence === "monthly"
      ? "monthly"
      : "seasonal";

  // Term length in months, derived from the operator-picked dates. Drives
  // monthly/annual prorations on attached service fees so the right rail
  // matches what the holder will actually be billed across the full term.
  const termMonths = termMonthsBetween(draft.start, draft.end);

  // Group the catalog by cadence so the picker can render One-time /
  // Monthly / Annual sections. Fees without an explicit cadence default
  // to "one_time" per the schema contract.
  const feesByCadence = React.useMemo(() => {
    const groups: Record<"one_time" | "monthly" | "annual", AdditionalFee[]> = {
      one_time: [],
      monthly: [],
      annual: [],
    };
    for (const f of fees) {
      const c = f.cadence ?? "one_time";
      groups[c].push(f);
    }
    return groups;
  }, [fees]);

  // Cadence-bucketed rollup for the right rail. Uses the canonical helper
  // so the math matches Reservation + Club Subscription wizards.
  const feeTotals = React.useMemo(
    () => totalFromAttachedFees(draft.selectedFeeIds, termMonths),
    [draft.selectedFeeIds, termMonths]
  );

  // Year-one total = contract base (annualized) + service-fee total over
  // the operator's chosen term.
  const contractAnnualized =
    draft.cadence === "monthly" ? draft.amount * 12 : draft.amount;
  const yearOneTotal = contractAnnualized + feeTotals.total;

  // ── Validation gates ────────────────────────────────────────────────
  const canStep0 = draft.boaterId.length > 0;
  const canStep1 =
    draft.slipId.length > 0 &&
    draft.amount > 0 &&
    draft.start.length > 0 &&
    draft.end.length > 0 &&
    draft.start <= draft.end;
  const canStep2 = draft.templateId.length > 0;
  const canStep3 = canStep0 && canStep1 && canStep2;

  const canContinue = [canStep0, canStep1, canStep2, canStep3][stepIdx];

  // ── Actions ─────────────────────────────────────────────────────────
  function next() {
    if (stepIdx < STEPS.length - 1) setStepIdx((i) => i + 1);
  }
  function back() {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  }
  function close() {
    onOpenChange(false);
  }

  async function submit() {
    if (!canStep3) return;
    setSubmitting(true);
    try {
      const result = executeAgentAction({
        kind: "create_contract",
        label: "",
        boater_id: draft.boaterId,
        template_id: draft.templateId,
        vessel_id: draft.vesselId || undefined,
        slip_id: draft.slipId || undefined,
        effective_start: draft.start,
        effective_end: draft.end,
        annual_rate: annualRate,
        billing_cadence: billingCadence,
        attached_fee_ids: draft.selectedFeeIds,
      });

      // AI draft pass — pre-fill the template's merge tokens with concrete
      // context. Runs against /api/draft-contract; ANTHROPIC_API_KEY gates
      // the real model call vs. deterministic local fill.
      if (result.ok && result.createdId && selectedTemplate?.body_markdown) {
        try {
          const draftRes = await fetch("/api/draft-contract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              template_name: selectedTemplate.name,
              template_body: selectedTemplate.body_markdown,
              context: {
                boater: selectedBoater
                  ? {
                      display_name: selectedBoater.display_name,
                      code: selectedBoater.code ?? "",
                      legal_name: selectedBoater.display_name,
                      primary_contact: selectedBoater.primary_contact,
                      address: selectedBoater.address,
                    }
                  : null,
                slip: selectedSlip
                  ? {
                      number: selectedSlip.number,
                      dock: selectedSlip.dock,
                      slipClass: selectedSlip.slip_class,
                      loa_feet: Math.round(selectedSlip.max_loa_inches / 12),
                    }
                  : null,
                vessel: selectedVessel
                  ? {
                      name: selectedVessel.name,
                      year: selectedVessel.year ?? "",
                      make: selectedVessel.make ?? "",
                      model: selectedVessel.model ?? "",
                    }
                  : null,
                contract: {
                  effective_start: draft.start,
                  effective_end: draft.end,
                  annual_rate: annualRate,
                  billing_cadence: billingCadence,
                  services: selectedFees.map((f) => ({
                    name: f.name,
                    amount: f.amount,
                  })),
                },
              },
            }),
          });
          if (draftRes.ok) {
            const json = (await draftRes.json()) as {
              drafted_body_markdown?: string;
            };
            if (json.drafted_body_markdown) {
              updateContract(result.createdId, {
                drafted_body_markdown: json.drafted_body_markdown,
                drafted_at: new Date().toISOString(),
              });
            }
          }
        } catch (err) {
          // Non-fatal — the contract is created, just lacks the AI body.
          console.error("[contract-wizard] draft-contract call failed", err);
        }
      }

      // Onboarding chain — mint signature token + dispatch outbound
      // Communication with the /onboard/[token] URL. Same shape as
      // assign-slip-client.tsx so the holder lands on the same flow.
      if (result.ok && result.createdId && selectedBoater) {
        const token = mintContractSignatureToken(result.createdId);
        if (token) {
          const origin =
            typeof window !== "undefined" ? window.location.origin : "";
          const onboardUrl = `${origin}/onboard/${token}`;
          const channel = selectedBoater.communication_prefs.preferred_channel;
          const commType: Communication["type"] = channel;
          const recipient =
            commType === "email"
              ? selectedBoater.primary_contact.email ?? ""
              : selectedBoater.primary_contact.phone ?? "";
          const slipLabel = selectedSlip
            ? `slip ${selectedSlip.number}`
            : "your contract";
          const dockLabel = selectedSlip ? ` at ${selectedSlip.dock}` : "";
          addCommunication({
            id: `cm_onboard_${Date.now()}_${Math.random()
              .toString(36)
              .slice(2, 6)}`,
            boater_id: selectedBoater.id,
            type: commType,
            direction: "outbound",
            sender_label: "Marina Stee",
            sender_is_system: true,
            recipient,
            subject: selectedSlip
              ? `Welcome to your slip ${selectedSlip.number} — complete onboarding`
              : "Complete your contract onboarding",
            body_preview: `Sign your contract and add a payment method here: ${onboardUrl}`,
            full_body:
              `Hi ${selectedBoater.first_name},\n\n` +
              `Your ${slipLabel}${dockLabel} is reserved. Please complete the ` +
              `following to activate your contract:\n\n` +
              `  1. Review and sign your agreement\n` +
              `  2. Add a payment method\n\n` +
              `It takes about 2 minutes: ${onboardUrl}\n\n` +
              `Reply to this message if you have any questions.`,
            sent_at: new Date().toISOString(),
            status: "delivered",
            related_entity: { type: "contract", id: result.createdId },
          });
        }
      }

      clearPersisted();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Right rail — builds up as the operator advances ──────────────────
  const rightRail = (
    <div className="space-y-4">
      {/* Holder card */}
      {selectedBoater ? (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
            Holder
          </div>
          <div className="mt-1 text-[16px] font-semibold text-fg">
            {selectedBoater.display_name}
          </div>
          {selectedBoater.code && (
            <div className="text-[12px] text-fg-subtle">
              {selectedBoater.code}
            </div>
          )}
          {selectedBoater.primary_contact.email && (
            <div className="mt-0.5 truncate text-[11px] text-fg-tertiary">
              {selectedBoater.primary_contact.email}
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
            New contract
          </div>
          <div className="mt-1 text-[16px] font-semibold text-fg">
            Pick a holder…
          </div>
          <div className="text-[12px] text-fg-subtle">
            Step 1 of {STEPS.length}
          </div>
        </div>
      )}

      {/* Vessel card */}
      {selectedVessel && (
        <div className="border-t border-hairline pt-3">
          <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
            Vessel
          </div>
          <div className="mt-1 text-[13px] font-medium text-fg">
            {selectedVessel.name}
          </div>
          {(selectedVessel.year ||
            selectedVessel.make ||
            selectedVessel.model) && (
            <div className="text-[11px] text-fg-subtle">
              {[
                selectedVessel.year,
                selectedVessel.make,
                selectedVessel.model,
              ]
                .filter(Boolean)
                .join(" ")}
            </div>
          )}
        </div>
      )}

      {/* Slip card */}
      {selectedSlip && (
        <div className="border-t border-hairline pt-3">
          <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
            Slip
          </div>
          <div className="mt-1 text-[16px] font-semibold text-fg">
            {selectedSlip.number}
          </div>
          <div className="text-[12px] text-fg-subtle">{selectedSlip.dock}</div>
          <dl className="mt-2 space-y-1 text-[12px]">
            <RailRow
              label="Class"
              value={selectedSlip.slip_class.replace("_", " ")}
            />
            {selectedSlip.max_loa_inches > 0 && (
              <RailRow
                label="Max LOA"
                value={`${Math.round(selectedSlip.max_loa_inches / 12)}'`}
              />
            )}
          </dl>
        </div>
      )}

      {/* Pricing rollup */}
      {selectedSlip && draft.amount > 0 && (
        <div className="border-t border-hairline pt-3">
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-fg-tertiary">
            Pricing
          </div>
          <div className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="text-fg-subtle capitalize">
              {draft.cadence} rate
            </span>
            <span className="money-display tabular text-fg">
              {formatMoney(draft.amount)}
            </span>
          </div>
          {selectedFees.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-hairline pt-2 text-[12px]">
              {feeTotals.oneTime > 0 && (
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-fg-subtle">One-time</span>
                  <span className="money-display tabular text-fg">
                    {formatMoney(feeTotals.oneTime)}
                  </span>
                </div>
              )}
              {feeTotals.monthly > 0 && (
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-fg-subtle">
                    Monthly{" "}
                    <span className="text-fg-tertiary">
                      ({formatMoney(feeTotals.monthly / termMonths)} ×{" "}
                      {termMonths}
                      {termMonths === 1 ? " mo" : " mos"})
                    </span>
                  </span>
                  <span className="money-display tabular text-fg">
                    {formatMoney(feeTotals.monthly)}
                  </span>
                </div>
              )}
              {feeTotals.annual > 0 && (
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-fg-subtle">
                    Annual{" "}
                    <span className="text-fg-tertiary">
                      (prorated {termMonths}/12)
                    </span>
                  </span>
                  <span className="money-display tabular text-fg">
                    {formatMoney(feeTotals.annual)}
                  </span>
                </div>
              )}
            </div>
          )}
          <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-hairline pt-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
              Year one total
            </span>
            <span className="money-display text-[14px] font-medium text-fg">
              {formatMoney(yearOneTotal)}
            </span>
          </div>
        </div>
      )}

      {/* Agent affordance */}
      <div className="rounded-[10px] border border-primary/30 bg-primary-soft/40 p-3">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-primary">
          <Sparkles className="size-3.5" />
          Ask the agent
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-subtle">
          Try: &ldquo;Draft an annual slip contract for Peterson on B12 starting
          Mar 1&rdquo; — the agent fills the whole wizard.
        </p>
      </div>
    </div>
  );

  if (!open) return null;

  return (
    <>
      <NewBoaterSheet
        open={newHolderOpen}
        onOpenChange={setNewHolderOpen}
        onCreated={(boaterId) => {
          setDraft((d) => ({ ...d, boaterId }));
        }}
      />

      <AddVesselSheet
        open={newVesselOpen}
        onOpenChange={setNewVesselOpen}
        defaultBoaterId={draft.boaterId}
        onCreated={(vesselId) => {
          setDraft((d) => ({ ...d, vesselId }));
        }}
      />

      <WizardShell
        eyebrow="New slip contract"
        title={STEP_TITLES[stepIdx]}
        subtitle={STEP_SUBTITLES[stepIdx]}
        steps={STEPS}
        currentIdx={stepIdx}
        onStepClick={(idx) => idx < stepIdx && setStepIdx(idx)}
        rightRail={rightRail}
        chrome="modal"
        onExit={close}
      >
        {/* Step 0 — Holder & vessel */}
        {stepIdx === 0 && (
          <div className="space-y-4">
            <FieldLabel
              label="Holder"
              hint="Search by name or code. If they're new, create one below."
              required
            >
              <Combobox
                value={draft.boaterId}
                onChange={(v) => setDraft((d) => ({ ...d, boaterId: v }))}
                options={boaters.map((b) => ({
                  value: b.id,
                  label: b.display_name,
                  hint: b.code ? `· ${b.code}` : undefined,
                }))}
                placeholder="Pick a member…"
                searchPlaceholder="Search by name, code…"
                onCreateNew={() => setNewHolderOpen(true)}
                createNewLabel="Create new member"
              />
            </FieldLabel>

            <FieldLabel
              label="Vessel (optional)"
              hint={
                selectedBoater && vesselOptions.length === 0
                  ? "No vessels on file yet — add one now or skip and attach later."
                  : "Pick a vessel on file for this member, or skip and attach later."
              }
            >
              {selectedBoater && vesselOptions.length === 0 ? (
                <button
                  type="button"
                  onClick={() => setNewVesselOpen(true)}
                  className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-primary/40 bg-primary-soft/30 px-3 text-[13px] font-medium text-primary hover:bg-primary-soft/50"
                >
                  + Add a new vessel
                </button>
              ) : (
                <Combobox
                  value={draft.vesselId}
                  onChange={(v) => setDraft((d) => ({ ...d, vesselId: v }))}
                  options={vesselOptions.map((v) => ({
                    value: v.id,
                    label: v.name,
                    hint: v.year ? `· ${v.year}` : undefined,
                  }))}
                  placeholder={
                    selectedBoater ? "No vessel" : "Pick a member first"
                  }
                  searchPlaceholder="Search vessels…"
                  disabled={!selectedBoater}
                  onCreateNew={
                    selectedBoater ? () => setNewVesselOpen(true) : undefined
                  }
                  createNewLabel="Add a new vessel"
                />
              )}
            </FieldLabel>
          </div>
        )}

        {/* Step 1 — Slip & term */}
        {stepIdx === 1 && (
          <div className="space-y-4">
            <FieldLabel
              label="Slip"
              hint="Pick the slip this contract holds. Defaults flow from the slip's class + rate."
              required
            >
              <Combobox
                value={draft.slipId}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, slipId: v, amount: 0 }))
                }
                options={slips.map((s) => ({
                  value: s.id,
                  label: `${s.number} · ${s.dock}`,
                  hint: `· ${s.slip_class.replace("_", " ")}`,
                }))}
                placeholder="Pick a slip…"
                searchPlaceholder="Search by slip # or dock…"
              />
            </FieldLabel>

            {selectedSlip && (
              <FieldLabel label="Billing cadence">
                <div className="grid gap-2 sm:grid-cols-3">
                  <CadenceCard
                    label="Annual"
                    amount={slipDefaultForCadence("annual")}
                    per="/ year"
                    selected={draft.cadence === "annual"}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        cadence: "annual",
                        amount: slipDefaultForCadence("annual"),
                      }))
                    }
                  />
                  <CadenceCard
                    label="Seasonal"
                    amount={slipDefaultForCadence("seasonal")}
                    per="/ season"
                    hint="6-month block"
                    selected={draft.cadence === "seasonal"}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        cadence: "seasonal",
                        amount: slipDefaultForCadence("seasonal"),
                      }))
                    }
                  />
                  <CadenceCard
                    label="Monthly"
                    amount={slipDefaultForCadence("monthly")}
                    per="/ month"
                    hint="Annual / 12"
                    selected={draft.cadence === "monthly"}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        cadence: "monthly",
                        amount: slipDefaultForCadence("monthly"),
                      }))
                    }
                  />
                </div>
              </FieldLabel>
            )}

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
          </div>
        )}

        {/* Step 2 — Template & fees */}
        {stepIdx === 2 && (
          <div className="space-y-4">
            <FieldLabel
              label="Contract template"
              hint="Picks the legal document used. Term + rate flow from your slip selection."
              required
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

            <FieldLabel
              label="Additional services (optional)"
              hint="Add-ons billed alongside the slip — grouped by how they bill. Monthly and annual fees prorate across the contract term."
            >
              {fees.length === 0 ? (
                <div className="rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 p-6 text-center text-[13px] text-fg-subtle">
                  No contract-applicable fees configured. Add to{" "}
                  <strong>Services &rarr; Fees</strong>.
                </div>
              ) : (
                <div className="space-y-4">
                  {FEE_CADENCE_ORDER.map((cadence) => {
                    const group = feesByCadence[cadence];
                    if (group.length === 0) return null;
                    return (
                      <div key={cadence}>
                        <div className="mb-1.5 flex items-baseline justify-between">
                          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-fg-tertiary">
                            {FEE_CADENCE_HEADER[cadence]}
                          </h4>
                          <span className="text-[10px] text-fg-tertiary">
                            {cadence === "monthly"
                              ? "billed every month of the term"
                              : cadence === "annual"
                              ? "prorated across the term"
                              : "one charge at signing"}
                          </span>
                        </div>
                        <ul className="space-y-1.5">
                          {group.map((f) => {
                            const checked = draft.selectedFeeIds.includes(f.id);
                            return (
                              <li key={f.id}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraft((d) => ({
                                      ...d,
                                      selectedFeeIds: checked
                                        ? d.selectedFeeIds.filter(
                                            (x) => x !== f.id
                                          )
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
                                    <span className="text-[13px] font-medium text-fg">
                                      {f.name}
                                    </span>
                                    {f.description && (
                                      <p className="mt-0.5 text-[11px] text-fg-subtle">
                                        {f.description}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className="text-right">
                                      <div className="money-display text-[15px] text-fg">
                                        {formatMoney(f.amount)}
                                      </div>
                                      <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
                                        {FEE_CADENCE_SUFFIX[cadence]}
                                      </div>
                                    </div>
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
                      </div>
                    );
                  })}
                </div>
              )}
            </FieldLabel>
          </div>
        )}

        {/* Step 3 — Review & send */}
        {stepIdx === 3 && (
          <div className="space-y-3">
            <ReviewList>
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
                value={selectedVessel?.name ?? "—"}
                onEdit={() => setStepIdx(0)}
              />
            )}
            <ReviewBlock
              label="Slip"
              value={
                selectedSlip
                  ? `${selectedSlip.number} · ${selectedSlip.dock} (${selectedSlip.slip_class.replace(
                      "_",
                      " "
                    )})`
                  : "—"
              }
              onEdit={() => setStepIdx(1)}
            />
            <ReviewBlock
              label="Term"
              value={`${draft.start} → ${draft.end}`}
              onEdit={() => setStepIdx(1)}
            />
            <ReviewBlock
              label="Pricing"
              value={`${formatMoney(draft.amount)} / ${
                draft.cadence === "annual"
                  ? "year"
                  : draft.cadence === "monthly"
                  ? "month"
                  : "season"
              }`}
              onEdit={() => setStepIdx(1)}
            />
            <ReviewBlock
              label="Template"
              value={
                selectedTemplate
                  ? `${selectedTemplate.name} · v${selectedTemplate.version}`
                  : "—"
              }
              onEdit={() => setStepIdx(2)}
            />
            {selectedFees.length > 0 && (
              <ReviewBlock
                label="Services"
                value={selectedFees
                  .map((f) => {
                    const cad = f.cadence ?? "one_time";
                    return `${f.name} (${formatMoney(f.amount)} ${FEE_CADENCE_SUFFIX[cad]})`;
                  })
                  .join(", ")}
                onEdit={() => setStepIdx(2)}
              />
            )}
            <ReviewBlock
              label="Year-one total"
              value={
                selectedFees.length > 0
                  ? `${formatMoney(yearOneTotal)} = ${formatMoney(
                      contractAnnualized
                    )} contract + ${formatMoney(feeTotals.total)} services over ${termMonths} ${
                      termMonths === 1 ? "mo" : "mos"
                    }`
                  : `${formatMoney(yearOneTotal)} (contract base)`
              }
              onEdit={() => setStepIdx(2)}
            />
            </ReviewList>
          </div>
        )}

        <WizardFooter
          stepIndex={stepIdx}
          totalSteps={STEPS.length}
          stepLabel={STEPS[stepIdx].label}
          onBack={back}
          onContinue={stepIdx === STEPS.length - 1 ? submit : next}
          continueLabel={
            stepIdx === STEPS.length - 1
              ? "Draft contract & send for signature"
              : "Continue"
          }
          continueDisabled={!canContinue}
          busy={submitting}
          onExit={close}
          busyLabel="Drafting…"
        />
      </WizardShell>
    </>
  );
}
