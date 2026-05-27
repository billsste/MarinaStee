"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Sparkles, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardFooter } from "@/components/wizard/wizard-footer";
import type { WizardStep } from "@/components/wizard/wizard-progress";
import { NewBoaterSheet } from "@/components/boaters/new-boater-sheet";
import { AddVesselSheet } from "@/components/boaters/add-vessel-sheet";
import { BOATERS, CONTRACT_TEMPLATES, VESSELS, formatMoney } from "@/lib/mock-data";
import {
  addCommunication,
  mintContractSignatureToken,
  updateContract,
  useBoaters,
  useContractTemplates,
  useFees,
  useSlip,
  useVesselsForBoater,
} from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";
import type { Communication } from "@/lib/types";
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
};

const STORAGE_KEY_PREFIX = "marina_assign_slip_draft_";

const STEPS: WizardStep[] = [
  { id: "holder", label: "Holder" },
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

export function AssignSlipClient({ slip: ssrSlip }: { slip: SlipMeta }) {
  const router = useRouter();
  // Prefer the store's copy of the slip so edits made on the Roster's
  // "Edit slip" affordance flow into the wizard immediately. Fall back
  // to the SSR-passed seed values if the store hasn't surfaced the slip
  // (shouldn't happen, but defensive).
  const liveSlip = useSlip(ssrSlip.id);
  const slip: SlipMeta = liveSlip
    ? {
        id: liveSlip.id,
        number: liveSlip.number,
        dock: liveSlip.dock,
        loaInches: liveSlip.max_loa_inches,
        beamInches: liveSlip.max_beam_inches,
        hasPower: liveSlip.has_power,
        hasWater: liveSlip.has_water,
        occupancyType: ssrSlip.occupancyType,
        slipClass: liveSlip.slip_class,
        defaultAnnualRate: liveSlip.default_annual_rate,
        defaultMonthlyRate: liveSlip.default_monthly_rate,
        defaultSeasonalRate: liveSlip.default_seasonal_rate,
      }
    : ssrSlip;
  const liveBoaters = useBoaters();
  const boaters = liveBoaters.length > 0 ? liveBoaters : BOATERS;
  const fees = useFees();
  const templates = useContractTemplates();

  const [stepIdx, setStepIdx] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);
  const [newHolderOpen, setNewHolderOpen] = React.useState(false);
  const [newVesselOpen, setNewVesselOpen] = React.useState(false);

  const [draft, setDraft] = React.useState<DraftState>(() => {
    const firstTpl = templates[0] ?? CONTRACT_TEMPLATES[0];
    const today = new Date().toISOString().slice(0, 10);
    const months = firstTpl?.default_term_months ?? 12;
    const endDate = new Date(Date.now() + months * 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return {
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

      // AI draft pass — fill the template's merge tokens with concrete
      // context for this contract. Runs against /api/draft-contract,
      // which calls the Anthropic API if ANTHROPIC_API_KEY is set and
      // falls back to a deterministic local fill otherwise. Either way
      // the contract ends up with a `drafted_body_markdown` ready for
      // the holder to read on /onboard.
      if (result.ok && result.createdId && selectedTemplate?.body_markdown) {
        try {
          const vesselForDraft = vesselOptions.find(
            (v) => v.id === draft.vesselId
          );
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
          // Non-fatal: the contract is created, just lacks the AI body.
          // Staff can re-draft from the contract detail page.
          console.error("[wizard] draft-contract call failed", err);
        }
      }

      // Onboarding chain — mint the signature token, transition the
      // contract to "sent," and dispatch an outbound Communication to
      // the holder with their /onboard/[token] URL. This is what makes
      // the wizard's output an interconnected workflow rather than a
      // dead-end draft.
      if (result.ok && result.createdId && selectedBoater) {
        const token = mintContractSignatureToken(result.createdId);
        if (token) {
          const origin = typeof window !== "undefined" ? window.location.origin : "";
          const onboardUrl = `${origin}/onboard/${token}`;
          const channel = selectedBoater.communication_prefs.preferred_channel;
          const commType: Communication["type"] = channel;
          const recipient =
            commType === "email"
              ? (selectedBoater.primary_contact.email ?? "")
              : (selectedBoater.primary_contact.phone ?? "");
          addCommunication({
            id: `cm_onboard_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            boater_id: selectedBoater.id,
            type: commType,
            direction: "outbound",
            sender_label: "Marina Stee",
            sender_is_system: true,
            recipient,
            subject: `Welcome to your slip ${slip.number} — complete onboarding`,
            body_preview: `Sign your contract and add a payment method here: ${onboardUrl}`,
            full_body:
              `Hi ${selectedBoater.first_name},\n\n` +
              `Your slip ${slip.number} at ${slip.dock} is reserved. Please complete the ` +
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

      // Clear the draft cache once committed
      try {
        window.sessionStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
      // Land them on the holder's page so they see the onboarding rail
      // + the just-sent contract + comm. If we couldn't resolve a boater
      // for some reason, fall back to the contracts list.
      const dest = selectedBoater
        ? `/holders/${selectedBoater.id}`
        : "/slips/contracts";
      router.push(dest);
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
              hint={
                selectedBoater && vesselOptions.length === 0
                  ? "No vessels on file yet — add one now or skip and attach later."
                  : "Pick a vessel on file for this holder, or skip and attach later."
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
                  placeholder={selectedBoater ? "No vessel" : "Pick a holder first"}
                  searchPlaceholder="Search vessels…"
                  disabled={!selectedBoater}
                  onCreateNew={selectedBoater ? () => setNewVesselOpen(true) : undefined}
                  createNewLabel="Add a new vessel"
                />
              )}
            </FieldLabel>
          </div>
        )}

        {/* Step 1 — Pricing (slip-intrinsic, override allowed) */}
        {stepIdx === 1 && (
          <div className="space-y-4">
            <div className="rounded-[10px] border border-primary/30 bg-primary-soft/30 p-3">
              <div className="text-[11px] uppercase tracking-wide text-primary">
                Slip default
              </div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="text-[13px] font-medium capitalize text-fg">
                  {slip.slipClass.replace("_", " ")}
                </span>
                <span className="text-[12px] text-fg-subtle">
                  · {Math.round(slip.loaInches / 12)}'
                </span>
                <span className="ml-auto money-display text-[20px] text-fg">
                  {formatMoney(slip.defaultAnnualRate)}
                </span>
                <span className="text-[11px] text-fg-tertiary">/ year</span>
              </div>
              <p className="mt-1 text-[11px] text-fg-tertiary">
                Pre-filled from slip {slip.id}. Override below if this holder gets a special arrangement.
              </p>
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

            <FieldLabel
              label="Amount"
              hint={
                draft.amount !== slipDefaultForCadence(draft.cadence)
                  ? `Overrides slip default of ${formatMoney(slipDefaultForCadence(draft.cadence))} ${
                      draft.cadence === "annual" ? "/ year" : draft.cadence === "monthly" ? "/ month" : "/ season"
                    }.`
                  : `Matches slip default — leave as-is unless this holder has a special arrangement.`
              }
            >
              <div className="flex items-center gap-2">
                <span className="text-[16px] text-fg-subtle">$</span>
                <input
                  type="number"
                  min="0"
                  step="50"
                  value={draft.amount || ""}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, amount: Number(e.target.value) || 0 }))
                  }
                  className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[18px] tabular text-fg focus:border-hairline-strong focus:outline-none"
                />
                <span className="text-[12px] text-fg-tertiary whitespace-nowrap">
                  {draft.cadence === "annual"
                    ? "/ year"
                    : draft.cadence === "monthly"
                    ? "/ month"
                    : "/ season"}
                </span>
                {draft.amount !== slipDefaultForCadence(draft.cadence) && (
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({ ...d, amount: slipDefaultForCadence(d.cadence) }))
                    }
                    className="text-[11px] text-primary hover:underline whitespace-nowrap"
                  >
                    Reset to default
                  </button>
                )}
              </div>
            </FieldLabel>
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
  "How are they billed?",
  "Add any extra services",
  "Pick the contract",
  "Review and draft",
];

const STEP_SUBTITLES = [
  "Search existing holders or create a new one. You can attach a vessel now or later.",
  "The slip has its own default annual rate — pick the cadence and adjust the amount only if this holder has a special arrangement.",
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

function CadenceCard({
  label,
  amount,
  per,
  hint,
  selected,
  onClick,
}: {
  label: string;
  amount: number;
  per: string;
  hint?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1 rounded-[10px] border px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
          : "border-hairline bg-surface-1 hover:border-hairline-strong hover:bg-surface-2"
      )}
    >
      <div className="text-[12px] font-medium text-fg">{label}</div>
      <div className="money-display text-[18px] text-fg">{formatMoney(amount)}</div>
      <div className="text-[10px] text-fg-tertiary">
        {per}
        {hint && <span className="ml-1">· {hint}</span>}
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
