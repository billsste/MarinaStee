"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { MultiCombobox } from "@/components/ui/multi-combobox";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardFooter } from "@/components/wizard/wizard-footer";
import type { WizardStep } from "@/components/wizard/wizard-progress";
import {
  CadenceCard,
  FieldLabel,
  ReviewBlock,
  ReviewList,
} from "@/components/wizard/wizard-fields";
import { useWizardDraft } from "@/components/wizard/use-wizard-draft";
import {
  addCommunication,
  mintContractSignatureToken,
  totalFromAttachedFees,
  updateContract,
  useBoaters,
  useContractTemplates,
  useContracts,
  useFeesForEntity,
  useReservations,
  useSlips,
} from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";
import { CONTRACT_TEMPLATES, formatMoney } from "@/lib/mock-data";
import type { AdditionalFee } from "@/lib/types";
import { formatPhoneInput, phoneDigitCount } from "@/lib/utils";
import type { Communication } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * New slip-holder wizard — the canonical 5-step path for adding a member
 * to a slip. Mirrors the reservation + slip-assignment wizards so the
 * chrome, right-rail rollup, agent affordance, and Review/Edit jumps
 * are identical across every "+ New X" surface.
 *
 * Steps:
 *   0. Identity         — name, email, phone, preferred channel, notes.
 *   1. Vessel           — primary vessel for this holder; skippable.
 *   2. Slip + Contract  — vacant-slip combobox + arrival/departure +
 *                          billing cadence cards + contract template.
 *   3. Services         — add-on fees attached to the contract draft.
 *   4. Review           — confirm and create. Chains create_boater →
 *                          create_vessel → create_contract via
 *                          executeAgentAction, then drafts the contract
 *                          body and dispatches a welcome onboarding
 *                          communication just like assign-slip does.
 *
 * Module name preserved (MemberSetupWizard) so existing imports keep
 * working. Mounted by every launcher that previously opened the
 * single-page NewBoaterSheet on the slip-holder path.
 */

const STORAGE_KEY = "marina_new_slip_holder_v1";

const STEPS: WizardStep[] = [
  { id: "identity", label: "Identity" },
  { id: "vessel", label: "Vessel" },
  { id: "slip", label: "Slip + contract" },
  { id: "services", label: "Services" },
  { id: "review", label: "Review" },
];

const STEP_TITLES = [
  "Who's the new slip holder?",
  "What boats do they own?",
  "Assign a slip + draft a contract",
  "Add any extra services",
  "Review and create",
];

const STEP_SUBTITLES = [
  "Capture the basics — name, contact info, and how they want to hear from you. You can fill in everything else later.",
  "Add any vessels they own. Skip if they haven't bought one yet — you can attach a vessel from their profile anytime.",
  "Pick a vacant slip, set arrival and departure, choose a billing cadence, and select a contract template. Skip the slip step if you'll finalize later.",
  "Optional add-ons billed alongside the slip — winterization, pump-out, electric, etc. Skip if none apply.",
  "Confirm the details. We'll create the holder, attach their vessel(s), and draft a contract if you picked a slip.",
];

type VesselDraft = {
  // Client-side row id — used as a React key while the row lives in the
  // wizard. Doesn't survive submit; the real vessel id is minted by
  // the agent action.
  rowId: string;
  name: string;
  year: string;
  make: string;
  model: string;
  vessel_type: "powerboat" | "sailboat" | "pontoon" | "houseboat" | "pwc" | "other";
  fuel_type: "gasoline" | "diesel" | "electric" | "none";
  loa_ft: string;
  beam_ft: string;
  draft_ft: string;
  hull_vin: string;
  registration: string;
};

type CadenceKind = "annual" | "seasonal" | "monthly" | "transient";

type DraftState = {
  // Identity (Step 0)
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  preferredChannel: "email" | "sms" | "voice";
  notes: string;
  // Vessels (Step 1)
  vessels: VesselDraft[];
  // Slip + contract (Step 2)
  slipId: string;
  arrival: string;
  departure: string;
  cadence: CadenceKind;
  templateId: string;
  // Services (Step 3) — unified service fees attached to the contract
  // draft. Only the contract path uses this; transient (no contract)
  // just keeps it empty. See lib/client-store.ts → feesForEntity.
  selectedFeeIds: string[];
};

function emptyVessel(): VesselDraft {
  return {
    rowId: `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: "",
    year: "",
    make: "",
    model: "",
    vessel_type: "powerboat",
    fuel_type: "gasoline",
    loa_ft: "",
    beam_ft: "",
    draft_ft: "",
    hull_vin: "",
    registration: "",
  };
}

function generateHolderCode(): string {
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  return `MB-${stamp}`;
}

function ftToInches(v: string): number | undefined {
  const n = Number(v);
  return n > 0 ? Math.round(n * 12) : undefined;
}

export function MemberSetupWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
}) {
  const liveBoaters = useBoaters();
  const slips = useSlips();
  const templates = useContractTemplates();
  const reservations = useReservations();
  const contracts = useContracts();

  // Touch liveBoaters so the wizard re-renders if new boaters arrive in
  // the store while it's open (e.g., another tab created one). Not used
  // in render logic but keeps subscription parity with sibling wizards.
  void liveBoaters;

  const [submitting, setSubmitting] = React.useState(false);

  // sessionStorage-backed wizard state. Mirrors the slip-assignment and
  // reservation wizards exactly so resume behavior is consistent.
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
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        preferredChannel: "email" as const,
        notes: "",
        vessels: [],
        slipId: "",
        arrival: today,
        departure: endDate,
        cadence: "annual" as CadenceKind,
        templateId: firstTpl?.id ?? "",
        selectedFeeIds: [],
      },
    };
  });

  const stepIdx = persisted.step;
  const draft = persisted.draft;
  // setStepIdx / setDraft short-circuit when the inner value is
  // identity-equal — without this, every call allocates a new
  // `persisted` ref and triggers a re-render even on no-op updates.
  // Effects that call setDraft(d => d) on every catalog re-render
  // would otherwise infinite-loop.
  const setStepIdx = React.useCallback(
    (next: number | ((prev: number) => number)) => {
      setPersisted((p) => {
        const nextStep =
          typeof next === "function"
            ? (next as (n: number) => number)(p.step)
            : next;
        return nextStep === p.step ? p : { ...p, step: nextStep };
      });
    },
    [setPersisted]
  );
  const setDraft = React.useCallback(
    (next: DraftState | ((prev: DraftState) => DraftState)) => {
      setPersisted((p) => {
        const nextDraft =
          typeof next === "function"
            ? (next as (d: DraftState) => DraftState)(p.draft)
            : next;
        return nextDraft === p.draft ? p : { ...p, draft: nextDraft };
      });
    },
    [setPersisted]
  );

  // ── Derived ──────────────────────────────────────────────────────────
  // Slip vacancy filter — a slip counts as vacant when there is NO active
  // contract on it (draft / sent / partially_signed / executed / active)
  // AND no occupied reservation. Matches the same heuristic the roster
  // and boater-list pages use to decide which slips have a current holder.
  const slipsWithCurrentHolder = React.useMemo(() => {
    const occupied = new Set<string>();
    for (const c of contracts) {
      if (!c.slip_id) continue;
      if (
        c.status === "draft" ||
        c.status === "sent" ||
        c.status === "partially_signed" ||
        c.status === "executed" ||
        c.status === "active"
      ) {
        occupied.add(c.slip_id);
      }
    }
    for (const r of reservations) {
      if (r.status === "occupied" || r.status === "scheduled") {
        occupied.add(r.slip_id);
      }
    }
    return occupied;
  }, [contracts, reservations]);

  const vacantSlips = React.useMemo(
    () => slips.filter((s) => !slipsWithCurrentHolder.has(s.id)),
    [slips, slipsWithCurrentHolder]
  );

  const selectedSlip = slips.find((s) => s.id === draft.slipId);
  const selectedTemplate = templates.find((t) => t.id === draft.templateId);

  // Slip-intrinsic defaults — pre-fill the cadence amount.
  function defaultRateForCadence(c: CadenceKind): number {
    if (!selectedSlip) return 0;
    if (c === "annual") return selectedSlip.default_annual_rate;
    if (c === "monthly")
      return (
        selectedSlip.default_monthly_rate ??
        Math.round(selectedSlip.default_annual_rate / 12)
      );
    if (c === "seasonal")
      return (
        selectedSlip.default_seasonal_rate ??
        Math.round(selectedSlip.default_annual_rate * 0.6)
      );
    // transient = nightly directional
    const monthly =
      selectedSlip.default_monthly_rate ??
      Math.round(selectedSlip.default_annual_rate / 12);
    return Math.max(1, Math.round(monthly / 30));
  }

  // Annual rate for the contract record (consumers think in $/year).
  const annualRate = React.useMemo(() => {
    if (!selectedSlip) return undefined;
    const amount = defaultRateForCadence(draft.cadence);
    if (draft.cadence === "annual") return amount;
    if (draft.cadence === "monthly") return amount * 12;
    if (draft.cadence === "seasonal") return amount * 2; // 6mo × 2 ≈ annual proxy
    return amount * 30 * 12; // transient nightly → annual proxy
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlip, draft.cadence]);

  // ── Service fees ─────────────────────────────────────────────────────
  // Booking-entity scoping: a transient cadence here is dispatched as a
  // walk-in stay (reservation surface), every other cadence drafts a
  // slip contract. The picker reads from the right pool so each wizard
  // only ever shows applicable fees.
  const feeEntity: "contract" | "reservation" =
    draft.cadence === "transient" ? "reservation" : "contract";
  const applicableFees = useFeesForEntity(feeEntity);
  const feesByCadence = React.useMemo(() => {
    const oneTime: AdditionalFee[] = [];
    const monthly: AdditionalFee[] = [];
    const annual: AdditionalFee[] = [];
    for (const f of applicableFees) {
      const c = f.cadence ?? "one_time";
      if (c === "monthly") monthly.push(f);
      else if (c === "annual") annual.push(f);
      else oneTime.push(f);
    }
    return { oneTime, monthly, annual };
  }, [applicableFees]);

  // Drop any selectedFeeIds that no longer apply when the cadence
  // toggles between contract and reservation pools — keeps stale
  // contract-only fees from following the operator over to transient.
  React.useEffect(() => {
    const allowed = new Set(applicableFees.map((f) => f.id));
    setDraft((d) => {
      if (d.selectedFeeIds.length === 0) return d;
      const filtered = d.selectedFeeIds.filter((id) => allowed.has(id));
      return filtered.length === d.selectedFeeIds.length
        ? d
        : { ...d, selectedFeeIds: filtered };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeEntity]);

  // Term length in whole months. Drives prorating of monthly/annual
  // fees in the roll-up — a 6-month seasonal contract prorates an
  // annual fee to half, a 3-month transient stay prorates to a quarter.
  const termMonths = React.useMemo(() => {
    if (!draft.arrival || !draft.departure) return 1;
    const a = new Date(draft.arrival);
    const b = new Date(draft.departure);
    if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return 1;
    const diffMs = b.getTime() - a.getTime();
    if (diffMs <= 0) return 1;
    return Math.max(1, Math.round(diffMs / (30 * 86_400_000)));
  }, [draft.arrival, draft.departure]);

  // Roll-up across one-time / monthly / annual buckets. Re-runs when
  // the selected fee set or the term changes — matches the inline
  // "$X one-time + $Y/month" pattern used by every other wizard.
  const feeRollup = React.useMemo(
    () => totalFromAttachedFees(draft.selectedFeeIds, termMonths),
    [draft.selectedFeeIds, termMonths]
  );

  // ── Validation gates ────────────────────────────────────────────────
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim());
  const phoneIsComplete = phoneDigitCount(draft.phone) === 10;
  const canStep0 =
    draft.firstName.trim().length > 0 &&
    draft.lastName.trim().length > 0 &&
    emailLooksValid &&
    phoneIsComplete;

  // Each draft vessel must have a name to be valid. Empty vessel list is
  // also valid — the step is optional.
  const vesselsAllValid = draft.vessels.every((v) => v.name.trim().length > 0);
  const canStep1 = vesselsAllValid;

  // Slip step is optional. If a slip is picked, dates and template must
  // all be set; otherwise anything goes.
  const slipStepStarted = draft.slipId.length > 0;
  const canStep2 = slipStepStarted
    ? draft.arrival.length > 0 &&
      draft.departure.length > 0 &&
      draft.arrival <= draft.departure &&
      draft.templateId.length > 0
    : true;

  // Services step is always optional — the operator can skip it whether
  // or not a slip was picked.
  const canStep3 = true;
  const canStep4 = canStep0 && canStep1 && canStep2 && canStep3;
  const canContinue = [canStep0, canStep1, canStep2, canStep3, canStep4][
    stepIdx
  ];

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

  function addVesselRow() {
    setDraft((d) => ({ ...d, vessels: [...d.vessels, emptyVessel()] }));
  }
  function removeVesselRow(rowId: string) {
    setDraft((d) => ({
      ...d,
      vessels: d.vessels.filter((v) => v.rowId !== rowId),
    }));
  }
  function patchVesselRow(rowId: string, patch: Partial<VesselDraft>) {
    setDraft((d) => ({
      ...d,
      vessels: d.vessels.map((v) =>
        v.rowId === rowId ? { ...v, ...patch } : v
      ),
    }));
  }

  async function submit() {
    if (!canStep4) return;
    setSubmitting(true);
    try {
      // 1. Create the boater first — every downstream action needs the id.
      const boaterResult = executeAgentAction({
        kind: "create_boater",
        label: "",
        first_name: draft.firstName.trim(),
        last_name: draft.lastName.trim(),
        email: draft.email.trim(),
        phone: draft.phone.trim(),
        code: generateHolderCode(),
        preferred_channel: draft.preferredChannel,
        // billing_cadence on the boater is a soft hint; the contract's
        // cadence is the source of truth. If the operator picked a slip,
        // mirror that here; otherwise default to transient as a neutral
        // placeholder (same as NewBoaterSheet).
        billing_cadence: slipStepStarted ? draft.cadence : "transient",
        notes: draft.notes.trim() || undefined,
      });

      if (!boaterResult.ok || !boaterResult.createdId) {
        return;
      }
      const boaterId = boaterResult.createdId;

      // 2. Chain vessel creates — one executeAgentAction per row. Track
      //    the first vessel id so the optional contract gets attached to
      //    a real boat when possible.
      let firstVesselId: string | undefined;
      for (const v of draft.vessels) {
        const vesselResult = executeAgentAction({
          kind: "create_vessel",
          label: "",
          boater_id: boaterId,
          name: v.name.trim(),
          year: v.year ? Number(v.year) : undefined,
          make: v.make.trim() || undefined,
          model: v.model.trim() || undefined,
          vessel_type: v.vessel_type,
          fuel_type: v.fuel_type,
          loa_inches: ftToInches(v.loa_ft),
          beam_inches: ftToInches(v.beam_ft),
          draft_inches: ftToInches(v.draft_ft),
          hull_vin: v.hull_vin.trim() || undefined,
          registration: v.registration.trim() || undefined,
        });
        if (vesselResult.ok && vesselResult.createdId && !firstVesselId) {
          firstVesselId = vesselResult.createdId;
        }
      }

      // 3. If a slip was picked, draft a contract — mirrors the same
      //    onboarding chain the slip-assignment wizard uses (contract →
      //    AI draft body → signature token → outbound comm).
      if (slipStepStarted && draft.slipId) {
        // Only forward fees that actually apply to the current entity
        // pool — if the operator toggled cadence after selecting, the
        // useEffect filter already pruned stale ids, but we re-filter
        // here as belt-and-suspenders before persisting.
        const allowedFeeIds = new Set(applicableFees.map((f) => f.id));
        const feeIdsForContract = draft.selectedFeeIds.filter((id) =>
          allowedFeeIds.has(id)
        );
        const contractResult = executeAgentAction({
          kind: "create_contract",
          label: "",
          boater_id: boaterId,
          template_id: draft.templateId,
          vessel_id: firstVesselId,
          slip_id: draft.slipId,
          effective_start: draft.arrival,
          effective_end: draft.departure,
          annual_rate: annualRate,
          billing_cadence: draft.cadence,
          attached_fee_ids:
            feeIdsForContract.length > 0 ? feeIdsForContract : undefined,
        });

        // AI draft pass — fill the template's merge tokens with concrete
        // context. Same shape as assign-slip-client.tsx.
        if (
          contractResult.ok &&
          contractResult.createdId &&
          selectedTemplate?.body_markdown &&
          selectedSlip
        ) {
          try {
            const draftRes = await fetch("/api/draft-contract", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                template_name: selectedTemplate.name,
                template_body: selectedTemplate.body_markdown,
                context: {
                  boater: {
                    display_name: `${draft.lastName}, ${draft.firstName}`,
                    legal_name: `${draft.firstName} ${draft.lastName}`.trim(),
                    primary_contact: {
                      email: draft.email,
                      phone: draft.phone,
                    },
                  },
                  slip: {
                    number: selectedSlip.number,
                    dock: selectedSlip.dock,
                    slipClass: selectedSlip.slip_class,
                    loa_feet: Math.round(selectedSlip.max_loa_inches / 12),
                  },
                  vessel: draft.vessels[0]
                    ? {
                        name: draft.vessels[0].name,
                        year: draft.vessels[0].year,
                        make: draft.vessels[0].make,
                        model: draft.vessels[0].model,
                      }
                    : null,
                  contract: {
                    effective_start: draft.arrival,
                    effective_end: draft.departure,
                    annual_rate: annualRate,
                    billing_cadence: draft.cadence,
                    services: [],
                  },
                },
              }),
            });
            if (draftRes.ok) {
              const json = (await draftRes.json()) as {
                drafted_body_markdown?: string;
              };
              if (json.drafted_body_markdown) {
                // Stamp updated_at fresh inside the handler — don't pass
                // it through from earlier in the chain.
                updateContract(contractResult.createdId, {
                  drafted_body_markdown: json.drafted_body_markdown,
                  drafted_at: new Date().toISOString(),
                });
              }
            }
          } catch (err) {
            // Non-fatal — staff can re-draft from the contract detail page.
            console.error("[new-slip-holder] draft-contract call failed", err);
          }
        }

        // Mint signature token + dispatch outbound onboarding comm. Mirrors
        // the slip-assign wizard so a new holder with a slip gets the same
        // "complete onboarding" link as a holder added via the slip flow.
        if (
          contractResult.ok &&
          contractResult.createdId &&
          selectedSlip
        ) {
          const token = mintContractSignatureToken(contractResult.createdId);
          if (token) {
            const origin =
              typeof window !== "undefined" ? window.location.origin : "";
            const onboardUrl = `${origin}/onboard/${token}`;
            const channel = draft.preferredChannel;
            const commType: Communication["type"] = channel;
            const recipient =
              commType === "email" ? draft.email : draft.phone;
            // sent_at minted fresh here in the handler.
            const sentAt = new Date().toISOString();
            addCommunication({
              id: `cm_onboard_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              boater_id: boaterId,
              type: commType,
              direction: "outbound",
              sender_label: "Marina Stee",
              sender_is_system: true,
              recipient,
              subject: `Welcome to your slip ${selectedSlip.number} — complete onboarding`,
              body_preview: `Sign your contract and add a payment method here: ${onboardUrl}`,
              full_body:
                `Hi ${draft.firstName},\n\n` +
                `Your slip ${selectedSlip.number} at ${selectedSlip.dock} is reserved. ` +
                `Please complete the following to activate your contract:\n\n` +
                `  1. Review and sign your agreement\n` +
                `  2. Add a payment method\n\n` +
                `It takes about 2 minutes: ${onboardUrl}\n\n` +
                `Reply to this message if you have any questions.`,
              sent_at: sentAt,
              status: "delivered",
              related_entity: {
                type: "contract",
                id: contractResult.createdId,
              },
            });
          }
        }
      }

      clearPersisted();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  const fullName = [draft.firstName.trim(), draft.lastName.trim()]
    .filter(Boolean)
    .join(" ");

  // ── Render ───────────────────────────────────────────────────────────
  if (!open) return null;

  return (
    <WizardShell
      eyebrow="New slip holder"
      title={STEP_TITLES[stepIdx]}
      subtitle={STEP_SUBTITLES[stepIdx]}
      steps={STEPS}
      currentIdx={stepIdx}
      onStepClick={(idx) => setStepIdx(idx)}
      stepsClickAny={true}
      rightRail={undefined}
      chrome="modal"
      onExit={close}
    >
      {/* Step 0 — Identity & contact */}
      {stepIdx === 0 && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="First name" required>
              <input
                type="text"
                value={draft.firstName}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, firstName: e.target.value }))
                }
                placeholder="Sarah"
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
              />
            </FieldLabel>
            <FieldLabel label="Last name" required>
              <input
                type="text"
                value={draft.lastName}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, lastName: e.target.value }))
                }
                placeholder="Reyes"
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
              />
            </FieldLabel>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="Email" required>
              <input
                type="email"
                value={draft.email}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, email: e.target.value }))
                }
                placeholder="sarah@example.com"
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
              />
            </FieldLabel>
            <FieldLabel label="Phone" required>
              <input
                type="tel"
                inputMode="tel"
                value={draft.phone}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    phone: formatPhoneInput(e.target.value),
                  }))
                }
                placeholder="(555) 555-0123"
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
              />
            </FieldLabel>
          </div>

          <FieldLabel
            label="Preferred channel"
            hint="How they prefer to receive outbound messages — receipts, reminders, renewals."
          >
            <div className="grid gap-2 sm:grid-cols-3">
              {(["email", "sms", "voice"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() =>
                    setDraft((d) => ({ ...d, preferredChannel: c }))
                  }
                  className={cn(
                    "rounded-[10px] border px-3 py-2 text-center text-[12px] font-medium capitalize transition-colors",
                    draft.preferredChannel === c
                      ? "border-primary bg-primary-soft/40 text-primary"
                      : "border-hairline bg-surface-1 text-fg-subtle hover:bg-surface-2"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </FieldLabel>

          <FieldLabel
            label="Notes"
            hint="Anything staff should know — referral source, special handling, allergies."
          >
            <textarea
              rows={3}
              value={draft.notes}
              onChange={(e) =>
                setDraft((d) => ({ ...d, notes: e.target.value }))
              }
              placeholder="Referred by Tim Chen. Likes early-morning slip time."
              className="block w-full resize-y rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[14px] leading-5 text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
            />
          </FieldLabel>
        </div>
      )}

      {/* Step 1 — Vessel(s) */}
      {stepIdx === 1 && (
        <div className="space-y-4">
          {draft.vessels.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 p-6 text-center">
              <p className="text-[13px] text-fg-subtle">
                No vessels yet. Add one now — or skip and attach later from
                their profile.
              </p>
              <Button
                variant="primary"
                size="sm"
                onClick={addVesselRow}
                className="mt-3"
              >
                <Plus className="size-3.5" />
                Add a vessel
              </Button>
            </div>
          ) : (
            <>
              <ul className="space-y-3">
                {draft.vessels.map((v, idx) => (
                  <li
                    key={v.rowId}
                    className="rounded-[12px] border border-hairline bg-surface-1 p-4"
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
                        Vessel {idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeVesselRow(v.rowId)}
                        aria-label="Remove vessel"
                        className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] text-fg-tertiary hover:bg-surface-2 hover:text-status-danger"
                      >
                        <Trash2 className="size-3.5" />
                        Remove
                      </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <FieldLabel label="Name" required>
                        <input
                          type="text"
                          value={v.name}
                          onChange={(e) =>
                            patchVesselRow(v.rowId, { name: e.target.value })
                          }
                          placeholder="Reel Time"
                          className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
                        />
                      </FieldLabel>
                      <FieldLabel label="Year">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={v.year}
                          onChange={(e) =>
                            patchVesselRow(v.rowId, { year: e.target.value })
                          }
                          placeholder="2018"
                          className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
                        />
                      </FieldLabel>
                      <FieldLabel label="Make">
                        <input
                          type="text"
                          value={v.make}
                          onChange={(e) =>
                            patchVesselRow(v.rowId, { make: e.target.value })
                          }
                          placeholder="Bayliner"
                          className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
                        />
                      </FieldLabel>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <FieldLabel label="Model">
                        <input
                          type="text"
                          value={v.model}
                          onChange={(e) =>
                            patchVesselRow(v.rowId, { model: e.target.value })
                          }
                          placeholder="VR5"
                          className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
                        />
                      </FieldLabel>
                      <FieldLabel label="Type">
                        <select
                          value={v.vessel_type}
                          onChange={(e) =>
                            patchVesselRow(v.rowId, {
                              vessel_type: e.target
                                .value as VesselDraft["vessel_type"],
                            })
                          }
                          className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
                        >
                          <option value="powerboat">Powerboat</option>
                          <option value="sailboat">Sailboat</option>
                          <option value="pontoon">Pontoon</option>
                          <option value="houseboat">Houseboat</option>
                          <option value="pwc">PWC / Jet Ski</option>
                          <option value="other">Other</option>
                        </select>
                      </FieldLabel>
                      <FieldLabel label="Fuel">
                        <select
                          value={v.fuel_type}
                          onChange={(e) =>
                            patchVesselRow(v.rowId, {
                              fuel_type: e.target
                                .value as VesselDraft["fuel_type"],
                            })
                          }
                          className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
                        >
                          <option value="gasoline">Gasoline</option>
                          <option value="diesel">Diesel</option>
                          <option value="electric">Electric</option>
                          <option value="none">None</option>
                        </select>
                      </FieldLabel>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <FieldLabel label="LOA (ft)" hint="Length overall.">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={v.loa_ft}
                          onChange={(e) =>
                            patchVesselRow(v.rowId, {
                              loa_ft: e.target.value,
                            })
                          }
                          placeholder="28"
                          className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
                        />
                      </FieldLabel>
                      <FieldLabel label="Beam (ft)">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={v.beam_ft}
                          onChange={(e) =>
                            patchVesselRow(v.rowId, {
                              beam_ft: e.target.value,
                            })
                          }
                          placeholder="9"
                          className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
                        />
                      </FieldLabel>
                      <FieldLabel label="Draft (ft)">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={v.draft_ft}
                          onChange={(e) =>
                            patchVesselRow(v.rowId, {
                              draft_ft: e.target.value,
                            })
                          }
                          placeholder="3"
                          className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
                        />
                      </FieldLabel>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <FieldLabel label="Hull VIN">
                        <input
                          type="text"
                          value={v.hull_vin}
                          onChange={(e) =>
                            patchVesselRow(v.rowId, {
                              hull_vin: e.target.value,
                            })
                          }
                          placeholder="USA-SER-1234567"
                          className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
                        />
                      </FieldLabel>
                      <FieldLabel label="Registration">
                        <input
                          type="text"
                          value={v.registration}
                          onChange={(e) =>
                            patchVesselRow(v.rowId, {
                              registration: e.target.value,
                            })
                          }
                          placeholder="MI 1234 AB"
                          className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
                        />
                      </FieldLabel>
                    </div>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={addVesselRow}
                className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-primary/40 bg-primary-soft/30 px-3 text-[13px] font-medium text-primary hover:bg-primary-soft/50"
              >
                <Plus className="size-3.5" />
                Add another vessel
              </button>
            </>
          )}

          <p className="text-[11px] text-fg-tertiary">
            Vessels are optional — you can add them later from the
            holder&rsquo;s profile.
          </p>
        </div>
      )}

      {/* Step 2 — Slip + contract */}
      {stepIdx === 2 && (
        <div className="space-y-4">
          <FieldLabel
            label="Vacant slip"
            hint="Showing slips with no active contract or scheduled stay. Skip if you'll finalize the contract later."
          >
            <Combobox
              value={draft.slipId}
              onChange={(v) => setDraft((d) => ({ ...d, slipId: v }))}
              options={vacantSlips.map((s) => ({
                value: s.id,
                label: `${s.number} · ${s.dock}`,
                hint: `· ${s.slip_class.replace("_", " ")}`,
              }))}
              placeholder="No slip — skip this step"
              searchPlaceholder="Search by slip # or dock…"
            />
          </FieldLabel>

          {slipStepStarted && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldLabel label="Arrival" required>
                  <input
                    type="date"
                    value={draft.arrival}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, arrival: e.target.value }))
                    }
                    className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
                  />
                </FieldLabel>
                <FieldLabel label="Departure" required>
                  <input
                    type="date"
                    value={draft.departure}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, departure: e.target.value }))
                    }
                    className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
                  />
                </FieldLabel>
              </div>
              {draft.arrival &&
                draft.departure &&
                draft.arrival > draft.departure && (
                  <p className="text-[12px] text-status-danger">
                    Departure must be on or after arrival.
                  </p>
                )}

              <FieldLabel label="Billing cadence">
                <div className="grid gap-2 sm:grid-cols-4">
                  <CadenceCard
                    label="Annual"
                    amount={defaultRateForCadence("annual")}
                    per="/ year"
                    selected={draft.cadence === "annual"}
                    onClick={() =>
                      setDraft((d) => ({ ...d, cadence: "annual" }))
                    }
                  />
                  <CadenceCard
                    label="Seasonal"
                    amount={defaultRateForCadence("seasonal")}
                    per="/ season"
                    hint="6-month block"
                    selected={draft.cadence === "seasonal"}
                    onClick={() =>
                      setDraft((d) => ({ ...d, cadence: "seasonal" }))
                    }
                  />
                  <CadenceCard
                    label="Monthly"
                    amount={defaultRateForCadence("monthly")}
                    per="/ month"
                    selected={draft.cadence === "monthly"}
                    onClick={() =>
                      setDraft((d) => ({ ...d, cadence: "monthly" }))
                    }
                  />
                  <CadenceCard
                    label="Transient"
                    amount={defaultRateForCadence("transient")}
                    per="/ night"
                    hint="Walk-in"
                    selected={draft.cadence === "transient"}
                    onClick={() =>
                      setDraft((d) => ({ ...d, cadence: "transient" }))
                    }
                  />
                </div>
              </FieldLabel>

              <FieldLabel
                label="Contract template"
                hint="Picks the legal document used for the slip contract."
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
            </>
          )}

          {!slipStepStarted && (
            <div className="rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 p-4 text-[12px] text-fg-subtle">
              No slip picked — the holder will be created without a contract.
              You can assign a slip from their profile or from Services
              &rarr; Roster anytime.
            </div>
          )}
        </div>
      )}

      {/* Step 3 — Services (add-on fees) */}
      {stepIdx === 3 && (
        <div className="space-y-4">
          {!slipStepStarted ? (
            <div className="rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 p-6 text-center text-[13px] text-fg-subtle">
              No slip picked yet — add-on services attach to the contract.
              <br />
              Go back and pick a slip if you want to include any, or
              continue to skip.
            </div>
          ) : applicableFees.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 p-6 text-center text-[13px] text-fg-subtle">
              No applicable services configured. Add them under{" "}
              <strong>Services &rarr; Fees</strong>, or continue to skip.
            </div>
          ) : (
            <FieldLabel
              label="Add-on services (optional)"
              hint={
                draft.cadence === "transient"
                  ? "Charges tacked onto this walk-in stay — pump-out, etc."
                  : "Billed alongside the slip — winterization, pump-out, electric add-on, etc."
              }
            >
              <MultiCombobox
                value={draft.selectedFeeIds}
                onChange={(next) =>
                  setDraft((d) => ({ ...d, selectedFeeIds: next }))
                }
                options={[
                  ...feesByCadence.oneTime.map((f) => ({
                    value: f.id,
                    label: f.name,
                    sub: f.description || "One-time",
                    trailing: formatMoney(f.amount),
                  })),
                  ...feesByCadence.monthly.map((f) => ({
                    value: f.id,
                    label: f.name,
                    sub: f.description || "Monthly",
                    trailing: `${formatMoney(f.amount)} / mo`,
                  })),
                  ...feesByCadence.annual.map((f) => ({
                    value: f.id,
                    label: f.name,
                    sub: f.description || "Annual",
                    trailing: `${formatMoney(f.amount)} / yr`,
                  })),
                ]}
                placeholder="Pick add-on services…"
                searchPlaceholder="Search services…"
              />
            </FieldLabel>
          )}
        </div>
      )}

      {/* Step 4 — Review */}
      {stepIdx === 4 && (
        <div className="space-y-3">
          <ReviewList>
          <ReviewBlock
            label="Identity"
            value={`${fullName} · ${draft.email}${
              draft.phone ? ` · ${draft.phone}` : ""
            }`}
            onEdit={() => setStepIdx(0)}
          />
          <ReviewBlock
            label="Preferred channel"
            value={draft.preferredChannel}
            capitalize
            onEdit={() => setStepIdx(0)}
          />
          {draft.notes.trim().length > 0 && (
            <ReviewBlock
              label="Notes"
              value={draft.notes.trim()}
              onEdit={() => setStepIdx(0)}
            />
          )}
          <ReviewBlock
            label={`Vessels${
              draft.vessels.length > 0 ? ` (${draft.vessels.length})` : ""
            }`}
            value={
              draft.vessels.length === 0
                ? "None — attach later"
                : draft.vessels
                    .map(
                      (v) =>
                        `${v.name}${
                          v.year || v.make
                            ? ` (${[v.year, v.make, v.model]
                                .filter(Boolean)
                                .join(" ")})`
                            : ""
                        }`
                    )
                    .join(", ")
            }
            onEdit={() => setStepIdx(1)}
          />
          <ReviewBlock
            label="Slip + contract"
            value={
              !slipStepStarted || !selectedSlip
                ? "None — finalize later"
                : `${selectedSlip.number} · ${selectedSlip.dock} · ${
                    draft.cadence
                  } · ${draft.arrival} → ${draft.departure}${
                    selectedTemplate ? ` · ${selectedTemplate.name}` : ""
                  }`
            }
            onEdit={() => setStepIdx(2)}
          />
          {slipStepStarted && draft.selectedFeeIds.length > 0 && (
            <ReviewBlock
              label="Add-on services"
              value={(() => {
                const parts: string[] = [];
                if (feeRollup.oneTime > 0) {
                  parts.push(`${formatMoney(feeRollup.oneTime)} one-time`);
                }
                if (feeRollup.monthly > 0) {
                  parts.push(
                    `${formatMoney(feeRollup.monthly)} over ${termMonths}mo`
                  );
                }
                if (feeRollup.annual > 0) {
                  parts.push(
                    `${formatMoney(feeRollup.annual)} annual (prorated)`
                  );
                }
                const names = applicableFees
                  .filter((f) => draft.selectedFeeIds.includes(f.id))
                  .map((f) => f.name)
                  .join(", ");
                return `${names} · ${parts.join(" + ")}`;
              })()}
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
        continueLabel={
          stepIdx === STEPS.length - 1 ? "Create slip holder" : "Continue"
        }
        continueDisabled={!canContinue}
        busy={submitting}
        onExit={close}
        busyLabel="Creating…"
      />
    </WizardShell>
  );
}
