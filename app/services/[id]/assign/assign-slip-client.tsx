"use client";

import * as React from "react";
import { Check, Pencil, Plus, Sparkles, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { MultiCombobox } from "@/components/ui/multi-combobox";
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
import { BOATERS, CONTRACT_TEMPLATES, VESSELS, formatMoney } from "@/lib/mock-data";
import {
  addCommunication,
  mintContractSignatureToken,
  updateContract,
  upsertSlip,
  useActiveDocks,
  useBoaters,
  useContractTemplates,
  useDocks,
  useFeesForEntity,
  useRates,
  useSlip,
  useVesselsForBoater,
} from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";
import type { Communication, Slip, SlipClass } from "@/lib/types";
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
  // Slip-intrinsic pricing — fills the Pricing step automatically.
  slipClass: "covered" | "uncovered" | "t_head" | "buoy" | "dry_storage";
  defaultAnnualRate: number;
  defaultMonthlyRate?: number;
  defaultSeasonalRate?: number;
  amperage?: number;
};

const STORAGE_KEY_PREFIX = "marina_assign_slip_draft_";

const STEPS: WizardStep[] = [
  { id: "holder", label: "Member" },
  { id: "rate", label: "Pricing" },
  { id: "services", label: "Services" },
  { id: "contract", label: "Contract" },
  { id: "review", label: "Review" },
];

type CadenceKind = "annual" | "monthly" | "seasonal";

type DraftState = {
  boaterId: string;
  // Pricing: cadence + per-period amount, both default from the slip.
  // Legacy `rateId` is kept on the draft for back-compat with stored
  // sessionStorage drafts but no longer wired into the UI.
  cadence: CadenceKind;
  amount: number;
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

/*
 * Modal-mode slip-actions surface. ONE modal hosts two flows under
 * the same chrome — the operator can swap between them without a
 * context switch:
 *
 *   mode="assign" (default) — the 5-step assign-holder wizard
 *   mode="edit"             — the single-form slip metadata editor
 *
 * Swap controls: the assign footer carries an "Edit slip info instead"
 * link that flips to mode="edit"; the edit footer carries a "Back to
 * assign holder" link that flips back. Closing the modal exits either
 * mode entirely.
 *
 * The legacy page route at /services/[id]/assign is preserved as a
 * redirect to /services (any old bookmark lands on the slips list,
 * then one click opens the modal).
 */
export function AssignHolderWizard({
  slipId,
  open,
  onOpenChange,
  onContractDrafted,
  prefillNewMember,
}: {
  slipId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /**
   * Called when the wizard creates a contract AND the AI draft pass
   * returns. Parent components mount a ContractPreviewSheet against
   * this id so the operator can review, edit, and send the contract
   * before it goes to the boater. Optional — when omitted, the
   * wizard falls back to the legacy behavior (close immediately, no
   * preview).
   */
  onContractDrafted?: (contractId: string) => void;
  /**
   * Pre-fill the "Add a new member" sub-sheet on first open. Used by
   * the convert-waitlist-applicant flow so the operator doesn't re-type
   * contact info that's already on the waitlist entry. When set, the
   * wizard auto-opens the new-member sub-sheet with the prefill applied.
   */
  prefillNewMember?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    preferred_channel?: "email" | "sms" | "voice";
  };
}) {
  // Resolve live from the store. The modal only renders when a slip
  // resolves — protects against stale slipIds (deleted slip, rename).
  const liveSlip = useSlip(slipId);
  if (!open || !liveSlip) return null;
  const slip: SlipMeta = {
    id: liveSlip.id,
    number: liveSlip.number,
    dock: liveSlip.dock,
    loaInches: liveSlip.max_loa_inches,
    beamInches: liveSlip.max_beam_inches,
    hasPower: liveSlip.has_power,
    hasWater: liveSlip.has_water,
    occupancyType: "Standard",
    slipClass: liveSlip.slip_class,
    defaultAnnualRate: liveSlip.default_annual_rate,
    defaultMonthlyRate: liveSlip.default_monthly_rate,
    defaultSeasonalRate: liveSlip.default_seasonal_rate,
    amperage: liveSlip.amperage,
  };
  return (
    <AssignHolderWizardInner
      slip={slip}
      liveSlip={liveSlip}
      onClose={() => onOpenChange(false)}
      onContractDrafted={onContractDrafted}
      prefillNewMember={prefillNewMember}
    />
  );
}

// Back-compat shim — older imports use AssignSlipClient. Routes that
// still call this (the legacy page route) get a no-op render now that
// the page is a redirect. New callers should use AssignHolderWizard.
export function AssignSlipClient(_props: { slip: SlipMeta }) {
  return null;
}

function AssignHolderWizardInner({
  slip,
  liveSlip,
  onClose,
  onContractDrafted,
  prefillNewMember,
}: {
  slip: SlipMeta;
  liveSlip: Slip;
  onClose: () => void;
  onContractDrafted?: (contractId: string) => void;
  prefillNewMember?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    preferred_channel?: "email" | "sms" | "voice";
  };
}) {
  const liveBoaters = useBoaters();
  const boaters = liveBoaters.length > 0 ? liveBoaters : BOATERS;
  // Scope the Services step's fee list to ones the operator can
  // attach to a slip CONTRACT — fees flagged for rental_boat or
  // club_subscription drop out so the picker isn't cluttered with
  // Pontoon-hourly rates and similar inapplicable rows.
  const fees = useFeesForEntity("contract");
  const templates = useContractTemplates();

  // Mode swap — same modal hosts both flows. "assign" = the 5-step
  // wizard; "edit" = a single-form slip editor. Toggling between
  // them preserves the operator's modal context (no close+open).
  const [mode, setMode] = React.useState<"assign" | "edit">("assign");

  const [submitting, setSubmitting] = React.useState(false);
  // When the parent passes prefillNewMember (convert-waitlist flow),
  // open the new-holder sub-sheet so the operator lands on the
  // pre-filled form instead of an empty member picker.
  //
  // We initialize from the prop AND watch it via useEffect because
  // `useState(initialValue)` only evaluates `initialValue` on the
  // first render. If the parent mounts the wizard with
  // prefillNewMember=undefined and sets it asynchronously later
  // (current waitlist flow doesn't, but future callers might), the
  // initial-state path silently misses. Belt + suspenders.
  const [newHolderOpen, setNewHolderOpen] = React.useState(!!prefillNewMember);
  const prefillFiredRef = React.useRef(!!prefillNewMember);
  React.useEffect(() => {
    if (prefillNewMember && !prefillFiredRef.current) {
      prefillFiredRef.current = true;
      setNewHolderOpen(true);
    }
  }, [prefillNewMember]);
  const [newVesselOpen, setNewVesselOpen] = React.useState(false);

  // sessionStorage-backed wizard state. We persist `step` alongside the
  // draft so a resume lands the operator on the step they left.
  const storageKey = `${STORAGE_KEY_PREFIX}${slip.id}`;
  const [persisted, setPersisted, clearPersisted] = useWizardDraft<{
    step: number;
    draft: DraftState;
  }>(storageKey, () => {
    const firstTpl = templates[0] ?? CONTRACT_TEMPLATES[0];
    const today = new Date().toISOString().slice(0, 10);
    const months = firstTpl?.default_term_months ?? 12;
    const endDate = new Date(Date.now() + months * 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return {
      step: 0,
      draft: {
        boaterId: "",
        cadence: "annual" as CadenceKind,
        amount: slip.defaultAnnualRate,
        rateId: "",
        selectedFeeIds: [],
        templateId: firstTpl?.id ?? "",
        vesselId: "",
        start: today,
        end: endDate,
        attachmentNames: [],
      },
    };
  });

  const stepIdx = persisted.step;
  const draft = persisted.draft;
  const setStepIdx = React.useCallback(
    (next: number | ((prev: number) => number)) => {
      setPersisted((p) => ({
        ...p,
        step: typeof next === "function" ? (next as (n: number) => number)(p.step) : next,
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

  // Attachments live outside the draft state because File data doesn't
  // serialize to sessionStorage. Re-uploading on resume is fine.
  const [attachments, setAttachments] = React.useState<LocalAttachment[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // ── Derived ──────────────────────────────────────────────────────────
  const selectedBoater = boaters.find((b) => b.id === draft.boaterId);
  const selectedTemplate = templates.find((t) => t.id === draft.templateId);
  const selectedFees = fees.filter((f) => draft.selectedFeeIds.includes(f.id));
  // Live vessels for this holder — freshly-created vessels in this session
  // surface immediately. Falls back to the static seed if the store hasn't
  // ingested yet.
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

  // Boat-too-big warning. Chenoa: "Home screen … alerts if a boat is too
  // big to be in a slip." Compares the picked vessel's LOA/beam to the
  // slip's max LOA/beam. We surface as a soft warning (not a block) —
  // staff sometimes assigns oversize vessels intentionally (overhang
  // arrangements, end-of-pier slips).
  const pickedVessel = vesselOptions.find((v) => v.id === draft.vesselId);
  const vesselTooBig =
    pickedVessel != null &&
    ((pickedVessel.loa_inches != null &&
      pickedVessel.loa_inches > slip.loaInches) ||
      (pickedVessel.beam_inches != null &&
        slip.beamInches > 0 &&
        pickedVessel.beam_inches > slip.beamInches));

  // Slip-intrinsic defaults — pre-fill the cadence amount.
  const slipDefaultForCadence = (c: CadenceKind): number => {
    if (c === "annual") return slip.defaultAnnualRate;
    if (c === "monthly") return slip.defaultMonthlyRate ?? Math.round(slip.defaultAnnualRate / 12);
    return slip.defaultSeasonalRate ?? Math.round(slip.defaultAnnualRate * 0.6);
  };
  // Annual rate for the contract record (consumers think in $/year).
  const annualRate =
    draft.cadence === "annual"
      ? draft.amount
      : draft.cadence === "monthly"
      ? draft.amount * 12
      : draft.amount * 2; // seasonal = 6mo, so 2× ≈ annual proxy
  const cadence = draft.cadence;

  // ── Validation gates ────────────────────────────────────────────────
  const canStep0 = draft.boaterId.length > 0;
  // Pricing step: any positive amount is valid. Default flows from slip.
  const canStep1 = draft.amount > 0;
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
    if (!canStep4) return;
    setSubmitting(true);
    try {
      const result = executeAgentAction({
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

      // AI draft pass — now AWAITED. Earlier this fired fire-and-forget
      // AND immediately dispatched the onboarding comm to the boater,
      // so the operator never saw what Claude generated before it
      // landed in front of the customer. Per Steven's feedback we now:
      //   1. Wait for the drafted body to come back
      //   2. Open the Contract Preview sheet
      //   3. Let the operator edit / ask the agent / send when ready
      // The communication dispatch is moved into the preview sheet's
      // "Send to customer" handler.
      if (result.ok && result.createdId && selectedTemplate?.body_markdown) {
        const contractId = result.createdId;
        const vesselForDraft = vesselOptions.find(
          (v) => v.id === draft.vesselId
        );
        const draftPayload = {
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
            slip: {
              number: slip.number,
              dock: slip.dock,
              slipClass: slip.slipClass,
              loa_feet: Math.round(slip.loaInches / 12),
            },
            vessel: vesselForDraft
              ? {
                  name: vesselForDraft.name,
                  year: vesselForDraft.year ?? "",
                  make: vesselForDraft.make ?? "",
                  model: vesselForDraft.model ?? "",
                }
              : null,
            contract: {
              effective_start: draft.start,
              effective_end: draft.end,
              annual_rate: annualRate,
              billing_cadence: cadence,
              services: selectedFees.map((f) => ({
                name: f.name,
                amount: f.amount,
              })),
            },
          },
        };
        try {
          const draftRes = await fetch("/api/draft-contract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(draftPayload),
          });
          if (draftRes.ok) {
            const json = (await draftRes.json()) as {
              drafted_body_markdown?: string;
            };
            if (json.drafted_body_markdown) {
              updateContract(contractId, {
                drafted_body_markdown: json.drafted_body_markdown,
                drafted_at: new Date().toISOString(),
              });
            }
          }
        } catch (err) {
          // Non-fatal: contract still exists, just no drafted body
          // yet. Operator can re-draft from the contract detail page.
          console.error("[wizard] draft-contract call failed", err);
        }
        // Notify the parent so it can open the Contract Preview
        // sheet right after the wizard closes. Operator reviews +
        // edits + sends from there. When `onContractDrafted` isn't
        // wired (legacy callers), this is a no-op and the operator
        // can still find the draft on the contract detail page.
        onContractDrafted?.(contractId);
      }

      // Clear the draft cache once committed; close the wizard modal.
      // The Contract Preview sheet (mounted on the parent) opens via
      // the lastDraftedContractId state we just set.
      clearPersisted();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  // ── Right-rail context: the slip itself (always visible) ─────────────
  const servicesTotal = selectedFees.reduce((acc, f) => acc + f.amount, 0);
  // Year-one total: contract rate (annual / monthly×12 / one season)
  // plus the selected add-ons. Quick-and-dirty: we sum all selected fees
  // regardless of billing_mode — staff want a directional total, not a
  // perfectly normalized cadence math.
  const contractAnnualized =
    draft.cadence === "monthly" ? draft.amount * 12 : draft.amount;
  const yearOneTotal = contractAnnualized + servicesTotal;

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
        <RailRow label="Class" value={slip.slipClass.replace("_", " ")} />
        {slip.loaInches > 0 && (
          <RailRow label="Max LOA" value={`${Math.round(slip.loaInches / 12)}'`} />
        )}
        {slip.beamInches > 0 && (
          <RailRow label="Max Beam" value={`${Math.round(slip.beamInches / 12)}'`} />
        )}
        <RailRow label="Power" value={slip.hasPower ? "Yes" : "No"} />
        {slip.amperage != null && (
          <RailRow label="Amperage" value={`${slip.amperage}A`} />
        )}
        <RailRow label="Water" value={slip.hasWater ? "Yes" : "No"} />
        {slip.defaultAnnualRate > 0 && (
          <RailRow
            label="Annual rate"
            value={`${formatMoney(slip.defaultAnnualRate)}`}
          />
        )}
      </dl>

      {/* Services rollup — appears the moment a fee is checked in Step 2 */}
      {selectedFees.length > 0 && (
        <div className="border-t border-hairline pt-3">
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-fg-tertiary">
            Services ({selectedFees.length})
          </div>
          <ul className="space-y-1 text-[12px]">
            {selectedFees.map((f) => (
              <li key={f.id} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-fg-subtle">
                  {f.name}
                </span>
                <span className="money-display tabular text-fg">
                  +{formatMoney(f.amount)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-hairline pt-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
              Year one
            </span>
            <span className="money-display text-[14px] font-medium text-fg">
              {formatMoney(yearOneTotal)}
            </span>
          </div>
        </div>
      )}
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
        onOpenChange={setNewHolderOpen}
        prefill={prefillNewMember}
        onCreated={(boaterId) => {
          // Auto-select the newly-created holder so staff doesn't have
          // to re-open the dropdown and find them. The sheet closes
          // itself after submit; we just pin the id in the wizard draft.
          setDraft((d) => ({ ...d, boaterId }));
        }}
      />

      <AddVesselSheet
        open={newVesselOpen}
        onOpenChange={setNewVesselOpen}
        defaultBoaterId={draft.boaterId}
        onCreated={(vesselId) => {
          // Auto-attach the freshly-created vessel to the wizard draft
          // so staff doesn't have to re-open the dropdown to find it.
          setDraft((d) => ({ ...d, vesselId }));
        }}
      />

      <WizardShell
        chrome="modal"
        onExit={onClose}
        eyebrow={
          mode === "edit"
            ? `Edit slip ${slip.number} · ${slip.dock}`
            : `Assign slip ${slip.number} · ${slip.dock}`
        }
        title={
          mode === "edit"
            ? "Edit slip defaults"
            : STEP_TITLES[stepIdx]
        }
        subtitle={
          mode === "edit"
            ? "Pre-fills new contracts on this slip. Existing contracts keep their signed rates."
            : STEP_SUBTITLES[stepIdx]
        }
        steps={mode === "assign" ? STEPS : undefined}
        currentIdx={mode === "assign" ? stepIdx : undefined}
        onStepClick={
          mode === "assign"
            ? (idx) => idx < stepIdx && setStepIdx(idx)
            : undefined
        }
        // Rail removed in both modes — modal is now single-column
        // and content-driven. Slip context lives in the eyebrow.
        rightRail={undefined}
        headerAction={
          mode === "assign" ? (
            <button
              type="button"
              onClick={() => setMode("edit")}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-hairline bg-surface-1 px-2.5 py-1.5 text-[12px] text-fg-subtle transition-colors hover:border-hairline-strong hover:bg-surface-2 hover:text-fg"
            >
              <Pencil className="size-3.5" />
              Edit slip info
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMode("assign")}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-hairline bg-surface-1 px-2.5 py-1.5 text-[12px] text-fg-subtle transition-colors hover:border-hairline-strong hover:bg-surface-2 hover:text-fg"
            >
              ← Back to assign holder
            </button>
          )
        }
      >
        {mode === "edit" && (
          <SlipEditForm
            slip={liveSlip}
            onSaved={() => setMode("assign")}
          />
        )}
        {mode === "assign" && (
          <>
        {/* Step 0 — Holder */}
        {stepIdx === 0 && (
          <div className="space-y-4">
            {/* Unified "find or create" combobox. Operators told us
                the old "Existing member" label + invisible "create one
                below" hint was confusing — there's no separate Create
                button; the +Create option is inside the dropdown
                itself. New shape: one field, one mental model. Type
                to filter; if no existing match, hit "+ Create new
                member" at the bottom of the list. */}
            <FieldLabel
              label="Member"
              hint="Type a name, code, or email to find an existing member, or add a new one."
            >
              <Combobox
                value={draft.boaterId}
                onChange={(v) => setDraft((d) => ({ ...d, boaterId: v }))}
                options={boaters.map((b) => ({
                  value: b.id,
                  label: b.display_name,
                  hint: b.code ? `· ${b.code}` : undefined,
                }))}
                placeholder="Search by name, code, or email…"
                searchPlaceholder="Type a name, code, or email…"
                onCreateNew={() => setNewHolderOpen(true)}
                createNewLabel="+ Create new member"
              />
              {/* Visible "add new" affordance — duplicates the
                  Combobox's footer option, but operators told us the
                  in-dropdown footer was too easy to miss. Styled as
                  an inline text button (left-aligned, link-toned)
                  rather than a full-width dashed CTA so it doesn't
                  compete with the search input above. */}
              {!draft.boaterId && (
                <button
                  type="button"
                  onClick={() => setNewHolderOpen(true)}
                  className="mt-1.5 inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[12px] font-medium text-primary transition-colors hover:bg-primary-soft/30"
                >
                  <Plus className="size-3.5" />
                  Add a new member
                </button>
              )}
            </FieldLabel>


            <FieldLabel
              label="Vessel (optional)"
              hint={
                !selectedBoater
                  ? "Pick a member above first — then their vessels appear here."
                  : selectedBoater && vesselOptions.length === 0
                    ? "No vessels on file yet. Add one now or skip and attach later."
                    : "Pick a vessel on file, or use “+ Add a new vessel” at the bottom of the list."
              }
            >
              {selectedBoater && vesselOptions.length === 0 ? (
                // Skip the empty dropdown indirection — surface the
                // create CTA directly so staff doesn't have to click
                // into a list with one item.
                <button
                  type="button"
                  onClick={() => setNewVesselOpen(true)}
                  className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-primary/40 bg-primary-soft/30 px-3 text-[13px] font-medium text-primary hover:bg-primary-soft/50"
                >
                  <Plus className="size-3.5" />
                  Add a new vessel
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
                  placeholder={selectedBoater ? "Pick a vessel — or create new" : "Pick a member first"}
                  searchPlaceholder="Search vessels…"
                  disabled={!selectedBoater}
                  onCreateNew={selectedBoater ? () => setNewVesselOpen(true) : undefined}
                  createNewLabel="+ Add a new vessel"
                />
              )}
            </FieldLabel>

            {vesselTooBig && pickedVessel && (
              <div className="rounded-[10px] border border-status-warn/30 bg-status-warn/10 px-3 py-2.5 text-[12px] text-status-warn">
                <span className="font-medium">Heads-up:</span>{" "}
                {pickedVessel.name} ({pickedVessel.loa_inches != null
                  ? `${Math.round(pickedVessel.loa_inches / 12)}' LOA`
                  : "no LOA on file"}
                {pickedVessel.beam_inches != null
                  ? ` · ${Math.round(pickedVessel.beam_inches / 12)}' beam`
                  : ""}
                ) exceeds slip {slip.number}{" "}
                {slip.loaInches > 0
                  ? `(${Math.round(slip.loaInches / 12)}' LOA`
                  : ""}
                {slip.beamInches > 0
                  ? ` · ${Math.round(slip.beamInches / 12)}' beam)`
                  : slip.loaInches > 0
                    ? ")"
                    : ""}
                . You can still assign — overhang/end-of-pier arrangements
                stay valid — but confirm the fit before continuing.
              </div>
            )}
          </div>
        )}

        {/* Step 1 — Pricing (slip-intrinsic, override allowed)
            Collapsed from 3 stacked blocks to 2: slip context strip + cadence
            picker. The original layout had a top "Slip default" callout AND
            a bottom "Annual rate" callout — both stated the same $3,350 the
            selected cadence card already shows. One-line strip preserves
            the slip-class + LOA anchor without competing with the picker. */}
        {stepIdx === 1 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-hairline pb-3 text-[12px] text-fg-subtle">
              <span className="font-medium capitalize text-fg">
                {slip.slipClass.replace("_", " ")}
              </span>
              <span>·</span>
              <span>{Math.round(slip.loaInches / 12)}'</span>
              <span className="ml-auto text-[11px] text-fg-tertiary">
                Rates pulled from Services → Rates · slip {slip.id}
              </span>
            </div>

            <FieldLabel label="Billing cadence">
              <div className="grid gap-2 sm:grid-cols-3">
                <CadenceCard
                  label="Annual"
                  amount={slip.defaultAnnualRate}
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
                  label="Monthly"
                  amount={slipDefaultForCadence("monthly")}
                  per="/ month"
                  hint="Annual / 12 + 8%"
                  selected={draft.cadence === "monthly"}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      cadence: "monthly",
                      amount: slipDefaultForCadence("monthly"),
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
              </div>
            </FieldLabel>
          </div>
        )}

        {/* Step 2 — Services
            Refactored from a static wall of fee cards (6+ visible at all
            times) to a typeahead Combobox + a compact added-list below.
            Same Combobox component used by Member + Contract template
            pickers so the wizard's interaction vocabulary stays uniform.
            Skip the step if none apply — subtitle already says so. */}
        {stepIdx === 2 && (
          <div className="space-y-4">
            {fees.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 p-6 text-center text-[13px] text-fg-subtle">
                No additional fees configured. Add on the Fees tab of <strong>/services/rates</strong>.
              </div>
            ) : (
              <>
                <FieldLabel
                  label="Add a fee"
                  hint="Search by name. Picked fees bill alongside the slip."
                >
                  <Combobox
                    // Combobox value stays empty — selecting a fee adds it
                    // to selectedFeeIds and the picker clears for the next add.
                    value=""
                    onChange={(feeId) => {
                      if (!feeId) return;
                      setDraft((d) =>
                        d.selectedFeeIds.includes(feeId)
                          ? d
                          : { ...d, selectedFeeIds: [...d.selectedFeeIds, feeId] }
                      );
                    }}
                    options={fees
                      .filter((f) => !draft.selectedFeeIds.includes(f.id))
                      .map((f) => ({
                        value: f.id,
                        label: f.name,
                        hint: `· ${formatMoney(f.amount)}`,
                      }))}
                    placeholder="Search fees…"
                    searchPlaceholder="Type a fee name…"
                  />
                </FieldLabel>

                {draft.selectedFeeIds.length > 0 && (
                  <FieldLabel
                    label={`Added (${draft.selectedFeeIds.length})`}
                  >
                    <ul className="space-y-1.5">
                      {draft.selectedFeeIds.map((id) => {
                        const fee = fees.find((f) => f.id === id);
                        if (!fee) return null;
                        return (
                          <li
                            key={id}
                            className="flex items-center justify-between gap-3 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2"
                          >
                            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
                              {fee.name}
                            </span>
                            <span className="money-display text-[14px] text-fg">
                              {formatMoney(fee.amount)}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setDraft((d) => ({
                                  ...d,
                                  selectedFeeIds: d.selectedFeeIds.filter(
                                    (x) => x !== id
                                  ),
                                }))
                              }
                              className="rounded-md p-1 text-fg-tertiary transition-colors hover:bg-surface-3 hover:text-status-danger"
                              aria-label={`Remove ${fee.name}`}
                            >
                              <X className="size-3.5" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </FieldLabel>
                )}
              </>
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

            <FieldLabel label="Attachments (optional)">
              <div className="space-y-2">
                {/* Slim inline-button affordance — replaces the
                    full-width dashed dropzone that bloated this step
                    relative to the others. Hint copy collapses into
                    the placeholder text next to the button. */}
                <div className="flex items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[12px] font-medium text-fg-subtle transition-colors hover:bg-surface-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <Plus className="size-3" />
                    Add file
                  </label>
                  {attachments.length === 0 && (
                    <span className="text-[11px] text-fg-tertiary">
                      PDFs, DOCX, signed copies, addenda
                    </span>
                  )}
                </div>
                {attachments.length > 0 && (
                  <ul className="space-y-1">
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
                          className="rounded-md p-1 text-fg-tertiary transition-colors hover:bg-surface-3 hover:text-status-danger"
                          aria-label={`Remove ${a.name}`}
                        >
                          <X className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </FieldLabel>
          </div>
        )}

        {/* Step 4 — Review
            Flat dl-style rows inside ONE bordered container — beats the
            previous N-cards-stacked layout that ballooned this step to
            ~380px tall while the other steps sat at ~280px. Each row is
            ~36px; 5-6 rows = ~200px. Edit jump-back lives at the right
            end of each row. Kept inline (not via ReviewBlock) so the
            shared component used by other wizards isn't disrupted. */}
        {stepIdx === 4 && (
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
                  value={
                    // Check live (store-backed) vessels first so freshly-
                    // created ones resolve immediately; fall back to seed.
                    vesselOptions.find((v) => v.id === draft.vesselId)?.name ??
                    VESSELS.find((v) => v.id === draft.vesselId)?.name ??
                    "—"
                  }
                  onEdit={() => setStepIdx(0)}
                />
              )}
              <ReviewBlock
                label="Pricing"
                value={`${formatMoney(draft.amount)} / ${
                  draft.cadence === "annual" ? "year" : draft.cadence === "monthly" ? "month" : "season"
                }${
                  draft.amount !== slipDefaultForCadence(draft.cadence)
                    ? ` (override — slip default ${formatMoney(slipDefaultForCadence(draft.cadence))})`
                    : ` · slip default (${slip.slipClass.replace("_", " ")})`
                }`}
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
            </ReviewList>
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
          onExit={onClose}
          busyLabel="Drafting…"
        />
        </>
        )}
      </WizardShell>
    </>
  );
}

// ── Step copy ─────────────────────────────────────────────────────────

const STEP_TITLES = [
  "Who's holding the slip?",
  "How are they billed?",
  "Add any extra services",
  "Pick the contract",
  "Review and draft",
];

const STEP_SUBTITLES = [
  "Search existing members or create a new one. You can attach a vessel now or later.",
  "Pick the billing cadence — annual, monthly, or seasonal. The rate is pulled from Services → Rates and applied as-is.",
  "Optional add-ons billed alongside the slip (pump-out, hoist, COI processing, etc.).",
  "Choose the legal document, set the effective dates, and upload signed copies if you have them.",
  "Confirm the details — clicking Draft creates a contract in draft status, ready to send for signature.",
];

// ── Slip edit form ────────────────────────────────────────────────────
//
// Single-form slip metadata editor — lives inside the same modal as
// the assign-holder wizard, hosted by the same WizardShell with
// steps={undefined} so the progress bar hides.
//
// Field structure cleanup vs the old RecordEditDialog version:
//   - Dock is now a Combobox of existing docks (was free text)
//   - Slip class stays a select with friendly labels
//   - Rates use the catalog-attach toggle pattern (mirrors rental boats):
//     default mode pulls from the Rate catalog filtered to standard
//     occupancy rows; "Custom amount" reveals the three legacy fields
//   - Number / Max LOA / Max Beam use the wizard's NumericInput
//   - Power / Water render as the canonical 2-card toggle (like the
//     wizard's Use toggle) instead of bare checkboxes

const SLIP_CLASS_OPTIONS: { value: SlipClass; label: string }[] = [
  { value: "covered", label: "Covered" },
  { value: "uncovered", label: "Uncovered" },
  { value: "t_head", label: "T-Head" },
  { value: "buoy", label: "Buoy" },
  { value: "dry_storage", label: "Dry storage" },
];

const SLIP_EDIT_CADENCES: { key: "annual" | "monthly" | "seasonal"; label: string; suffix: string }[] = [
  { key: "annual", label: "Annual rate ($/yr)", suffix: "/yr" },
  { key: "monthly", label: "Monthly rate ($/mo)", suffix: "/mo" },
  { key: "seasonal", label: "Seasonal rate ($/season)", suffix: "/season" },
];

function SlipEditForm({
  slip,
  onSaved,
}: {
  slip: Slip;
  onSaved: () => void;
}) {
  const activeDocks = useActiveDocks();
  const allDocks = useDocks();
  const allRates = useRates();

  // Local draft — initialized from the live slip, only persisted on Save.
  const [number, setNumber] = React.useState(slip.number);
  const [dockId, setDockId] = React.useState(slip.dock_id);
  const [slipClass, setSlipClass] = React.useState<SlipClass>(slip.slip_class);
  const [invoiceCategory, setInvoiceCategory] = React.useState(slip.invoice_category);
  const [maxLoa, setMaxLoa] = React.useState(slip.max_loa_inches);
  const [maxBeam, setMaxBeam] = React.useState(slip.max_beam_inches);
  const [hasPower, setHasPower] = React.useState(slip.has_power);
  const [hasWater, setHasWater] = React.useState(slip.has_water);

  // Catalog rates applicable to this slip — Standard occupancy rates
  // across annual / monthly / seasonal cadences. Operator picks one
  // per cadence; the picked amount fills the corresponding default.
  // Free-text rates were removed platform-wide — every rate on the
  // tool now sources from the centralized service-fee catalog.
  const slipRateOptions = React.useMemo(() => {
    return allRates
      .filter(
        (r) =>
          r.occupancy_type === "Standard" &&
          (r.cadence === "annual" || r.cadence === "monthly" || r.cadence === "seasonal")
      )
      .sort((a, b) => a.amount - b.amount);
  }, [allRates]);
  // Hydrate the multi-select from the slip's existing rates by
  // matching catalog rows whose amount equals the slip's default for
  // that cadence. Best-effort: if no match is found nothing is
  // pre-checked and the operator picks fresh.
  const initialPickedIds = React.useMemo(() => {
    const ids: string[] = [];
    const matchByCadenceAndAmount = (
      cadence: "annual" | "monthly" | "seasonal",
      target: number | undefined
    ) => {
      if (!target) return;
      const hit = allRates.find(
        (r) =>
          r.occupancy_type === "Standard" &&
          r.cadence === cadence &&
          r.amount === target
      );
      if (hit) ids.push(hit.id);
    };
    matchByCadenceAndAmount("annual", slip.default_annual_rate);
    matchByCadenceAndAmount("monthly", slip.default_monthly_rate);
    matchByCadenceAndAmount("seasonal", slip.default_seasonal_rate);
    return ids;
  }, [
    slip.default_annual_rate,
    slip.default_monthly_rate,
    slip.default_seasonal_rate,
    allRates,
  ]);
  const [pickedRateIds, setPickedRateIds] = React.useState<string[]>(initialPickedIds);

  const dockOptions = React.useMemo(
    () =>
      activeDocks.map((d) => ({
        value: d.id,
        label: d.name,
        hint: d.short_name && d.short_name !== d.name ? `· ${d.short_name}` : undefined,
      })),
    [activeDocks]
  );

  // Save validation — name + dock + class are mandatory; everything
  // else can be blank. Stays disabled when invalid; visible hint below.
  const canSave =
    number.trim().length > 0 &&
    dockId.length > 0 &&
    slipClass.length > 0;

  function handleSave() {
    if (!canSave) return;
    const matchedDock = allDocks.find((d) => d.id === dockId);
    const dockName = matchedDock?.name ?? slip.dock;
    // Rates source from the catalog as a single multi-select. The
    // slip persists THREE legacy cadence-specific fields for back-
    // compat with the assign-slip wizard's prefill (which reads
    // default_annual_rate etc.). Derive them by taking the FIRST
    // picked rate per cadence. If the operator picks no rate for a
    // cadence, the legacy field clears for that cadence (cleaner
    // than retaining stale values from a prior edit).
    const pickedRates = pickedRateIds
      .map((id) => slipRateOptions.find((r) => r.id === id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    const resolvedAnnual = pickedRates.find((r) => r.cadence === "annual")?.amount ?? 0;
    const resolvedMonthly = pickedRates.find((r) => r.cadence === "monthly")?.amount;
    const resolvedSeasonal = pickedRates.find((r) => r.cadence === "seasonal")?.amount;
    upsertSlip({
      ...slip,
      number: number.trim(),
      dock_id: dockId,
      dock: dockName,
      slip_class: slipClass,
      invoice_category: invoiceCategory.trim(),
      max_loa_inches: Number(maxLoa) || 0,
      max_beam_inches: Number(maxBeam) || 0,
      has_power: hasPower,
      has_water: hasWater,
      default_annual_rate: Number(resolvedAnnual) || 0,
      default_monthly_rate: resolvedMonthly,
      default_seasonal_rate: resolvedSeasonal,
    });
    onSaved();
  }

  return (
    <div className="space-y-4">
      {/* Identity row — number + dock + class + invoice category */}
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldLabel label="Slip number" required>
          <input
            type="text"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="A01"
            className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
          />
        </FieldLabel>
        <FieldLabel label="Dock" required>
          <Combobox
            value={dockId}
            onChange={setDockId}
            options={dockOptions}
            placeholder="Pick a dock…"
            searchPlaceholder="Search docks…"
          />
        </FieldLabel>
        <FieldLabel label="Class" required>
          <Combobox
            value={slipClass}
            onChange={(v) => setSlipClass(v as SlipClass)}
            options={SLIP_CLASS_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
            placeholder="Pick a class…"
            searchPlaceholder="Search classes…"
          />
        </FieldLabel>
        <FieldLabel label="Invoice category">
          <input
            type="text"
            value={invoiceCategory}
            onChange={(e) => setInvoiceCategory(e.target.value)}
            placeholder="Marina Slip Fees"
            className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
          />
        </FieldLabel>
      </div>

      {/* Dimensions */}
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldLabel label="Max LOA (inches)">
          <input
            type="text"
            inputMode="numeric"
            value={maxLoa === 0 ? "" : String(maxLoa)}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d]/g, "");
              setMaxLoa(raw === "" ? 0 : Number(raw));
            }}
            placeholder="336"
            className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] tabular-nums text-fg focus:border-hairline-strong focus:outline-none"
          />
        </FieldLabel>
        <FieldLabel label="Max Beam (inches)">
          <input
            type="text"
            inputMode="numeric"
            value={maxBeam === 0 ? "" : String(maxBeam)}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d]/g, "");
              setMaxBeam(raw === "" ? 0 : Number(raw));
            }}
            placeholder="144"
            className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] tabular-nums text-fg focus:border-hairline-strong focus:outline-none"
          />
        </FieldLabel>
      </div>

      {/* Utilities + Service rates — side-by-side row. Utilities is
          just a couple of pill toggles, so pairing it with the rates
          picker on the same row absorbs the leftover horizontal
          space instead of stranding utilities alone. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldLabel label="Utilities">
          <div className="flex flex-wrap gap-2">
            <UtilityToggle label="Power" enabled={hasPower} onChange={setHasPower} />
            <UtilityToggle label="Water" enabled={hasWater} onChange={setHasWater} />
          </div>
        </FieldLabel>

        <FieldLabel label="Service rates">
          {slipRateOptions.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 p-4 text-center text-[12px] text-fg-subtle">
              No slip rates configured. Add some in{" "}
              <strong>Services → Rates</strong>.
            </div>
          ) : (
            <MultiCombobox
              value={pickedRateIds}
              onChange={setPickedRateIds}
              options={slipRateOptions.map((r) => {
                const cadenceMeta = SLIP_EDIT_CADENCES.find(
                  (c) => c.key === r.cadence
                );
                return {
                  value: r.id,
                  label: r.name,
                  sub: r.cadence,
                  trailing: `${formatMoney(r.amount)}${cadenceMeta?.suffix ?? ""}`,
                };
              })}
              placeholder="Click to pick rates · type to filter"
              searchPlaceholder="Search rates by name or cadence…"
              emptyText="No rates match."
            />
          )}
        </FieldLabel>
      </div>

      {/* Edit footer — Save changes only. The "Back to assign
          holder" affordance lives in the header now (top-right of
          the modal), so this footer is just the primary commit. */}
      <div className="flex items-center justify-end gap-4 border-t border-hairline pt-4">
        <Button
          variant="primary"
          size="md"
          onClick={handleSave}
          disabled={!canSave}
        >
          Save changes
        </Button>
      </div>
      {!canSave && (
        <p className="text-right text-[11px] text-status-danger">
          Number, dock, and class are required.
        </p>
      )}
    </div>
  );
}

function UtilityToggle({
  label,
  enabled,
  onChange,
}: {
  label: string;
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  // Compact inline pill — single button that toggles between
  // available/not-available. Replaces the prior 2-card-per-utility
  // pattern that was eating vertical space for a binary choice.
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] transition-colors",
        enabled
          ? "border-primary bg-primary-soft/40 text-fg"
          : "border-hairline bg-surface-1 text-fg-subtle hover:bg-surface-2"
      )}
    >
      <span
        className={cn(
          "inline-block size-2 rounded-full",
          enabled ? "bg-primary" : "bg-fg-tertiary/40"
        )}
        aria-hidden
      />
      <span className="font-medium">{label}</span>
      <span className="text-fg-tertiary">
        {enabled ? "Available" : "Not available"}
      </span>
    </button>
  );
}

