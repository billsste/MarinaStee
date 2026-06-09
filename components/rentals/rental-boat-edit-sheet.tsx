"use client";

import * as React from "react";
import { Combobox } from "@/components/ui/combobox";
import { MultiCombobox } from "@/components/ui/multi-combobox";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardFooter } from "@/components/wizard/wizard-footer";
import type { WizardStep } from "@/components/wizard/wizard-progress";
import { FieldLabel } from "@/components/wizard/wizard-fields";
import { PhotoDropField } from "@/components/rentals/rental-boat-wizard";
import {
  upsertRentalBoat,
  useFeesForEntity,
} from "@/lib/client-store";
import { formatMoney } from "@/lib/mock-data";
import type {
  RentalBoat,
  RentalBoatStatus,
  RentalBoatType,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * Multi-step edit modal for a RentalBoat — mirrors the same
 * WizardShell-based UX the slip assignment wizard uses, so editing
 * feels consistent across the tool.
 *
 * Steps:
 *   0. Identity     — name, type, notes, photo
 *   1. Capacity     — passengers, fuel, Use (Boat Club / Rental Boat),
 *                     status (Available / Maintenance)
 *   2. Rates        — catalog multi-select + refundable deposit
 *
 * Explicitly excludes:
 *   - home_dock (managed elsewhere)
 *   - free-text rate fields (catalog-only platform-wide)
 *
 * On Save (final step's Continue): commits via upsertRentalBoat and
 * closes the modal. The slips/fleet table re-renders against the live
 * store snapshot.
 */

const STEPS: WizardStep[] = [
  { id: "identity", label: "Identity" },
  { id: "capacity", label: "Capacity" },
  { id: "rates", label: "Rates" },
];

const STEP_TITLES = [
  "Identity & photo",
  "Capacity & operations",
  "Rates & deposit",
];

const STEP_SUBTITLES = [
  "Name, type, operator notes, and a photo for the rentals page.",
  "Passenger cap, fuel tank, club/transient assignment, and operational status.",
  "Attach catalog rates and set the refundable deposit hold.",
];

const BOAT_TYPE_OPTIONS: { value: RentalBoatType; label: string }[] = [
  { value: "pontoon", label: "Pontoon" },
  { value: "wakeboat", label: "Wakeboat" },
  { value: "fishing_skiff", label: "Fishing Skiff" },
  { value: "jet_ski", label: "Jet Ski" },
  { value: "kayak", label: "Kayak" },
  { value: "paddleboard", label: "Paddleboard" },
];

const STATUS_TOGGLE_OPTIONS: {
  value: RentalBoatStatus;
  label: string;
  hint: string;
}[] = [
  { value: "available", label: "Available", hint: "Bookable today" },
  {
    value: "maintenance",
    label: "Maintenance",
    hint: "Hidden from booking until cleared",
  },
];

type DraftState = {
  name: string;
  type: RentalBoatType;
  notes: string;
  photo_url: string;
  capacity: number;
  fuel_capacity_gal: number;
  available_for_club: boolean;
  status: RentalBoatStatus;
  // Rates come exclusively from the service-fee catalog now —
  // free-text rate fields were removed platform-wide.
  attached_fee_ids: string[];
  deposit_amount: number;
};

function deriveInitialDraft(boat: RentalBoat): DraftState {
  return {
    name: boat.name ?? "",
    type: boat.type,
    notes: boat.notes ?? "",
    photo_url: boat.photo_url ?? "",
    capacity: boat.capacity ?? 0,
    fuel_capacity_gal: boat.fuel_capacity_gal ?? 0,
    available_for_club: boat.available_for_club === true,
    status: boat.status,
    attached_fee_ids: Array.isArray(boat.attached_fee_ids)
      ? [...boat.attached_fee_ids]
      : [],
    deposit_amount: boat.deposit_amount ?? 0,
  };
}

function MoneyInput({
  value,
  onChange,
  placeholder,
}: {
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex h-10 items-center rounded-[8px] border border-hairline bg-surface-2 px-3 focus-within:border-hairline-strong">
      <span className="text-[13px] text-fg-tertiary">$</span>
      <input
        type="text"
        inputMode="decimal"
        value={value === 0 ? "" : String(value)}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.]/g, "");
          const parsed = raw === "" ? 0 : Number(raw);
          onChange(Number.isFinite(parsed) ? parsed : 0);
        }}
        placeholder={placeholder}
        className="ml-1 h-full w-full bg-transparent text-[14px] tabular-nums text-fg outline-none placeholder:text-fg-tertiary"
      />
    </div>
  );
}

function NumericInput({
  value,
  onChange,
  placeholder,
}: {
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value === 0 ? "" : String(value)}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d]/g, "");
        const parsed = raw === "" ? 0 : Number(raw);
        onChange(Number.isFinite(parsed) ? parsed : 0);
      }}
      placeholder={placeholder}
      className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] tabular-nums text-fg focus:border-hairline-strong focus:outline-none placeholder:text-fg-tertiary"
    />
  );
}

export function RentalBoatEditSheet({
  boat,
  onClose,
}: {
  boat: RentalBoat;
  onClose: () => void;
}) {
  const rentalBoatFees = useFeesForEntity("rental_boat");

  // Build the initial draft once per `boat.id` change — re-deriving on
  // every render would discard inflight edits.
  const [draft, setDraft] = React.useState<DraftState>(() =>
    deriveInitialDraft(boat),
  );
  React.useEffect(() => {
    setDraft(deriveInitialDraft(boat));
  }, [boat.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [stepIdx, setStepIdx] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);

  // ── Per-step validation gates ───────────────────────────────────
  // Step 2 needs at least one attached rate AND a deposit-flagged rate
  // (the refundable hold) — both source from the same catalog
  // multi-select; no separate free-text deposit field anymore.
  const pickedDepositFee = rentalBoatFees.find(
    (f) => f.is_deposit && draft.attached_fee_ids.includes(f.id),
  );
  const canStep0 = draft.name.trim().length > 0;
  const canStep1 = draft.capacity > 0;
  const canStep2 =
    draft.attached_fee_ids.length > 0 && Boolean(pickedDepositFee);
  const canContinue = [canStep0, canStep1, canStep2][stepIdx];

  // Status toggle only surfaces "available" / "maintenance". If the
  // boat is currently rented/off_season we hold that on the draft so
  // saving doesn't clobber it. A read-only banner explains the choice
  // to the operator.
  const statusOutsideToggle =
    draft.status !== "available" && draft.status !== "maintenance";

  function next() {
    if (stepIdx < STEPS.length - 1) setStepIdx((i) => i + 1);
  }
  function back() {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  }

  // ── Save (called from Continue on final step) ───────────────────
  function handleSave() {
    if (!canStep2) return;
    setSubmitting(true);
    try {
      const trimmedPhoto = draft.photo_url.trim();
      // Deposit amount derives from the picked deposit-flagged rate
      // (validated in canStep2). The legacy boat.deposit_amount field
      // stays for backward compat with downstream rental flows.
      const depositAmount = pickedDepositFee?.amount ?? 0;
      upsertRentalBoat({
        ...boat,
        name: draft.name.trim(),
        type: draft.type,
        notes: draft.notes.trim() || undefined,
        photo_url: trimmedPhoto ? trimmedPhoto : undefined,
        capacity: draft.capacity,
        fuel_capacity_gal:
          draft.fuel_capacity_gal > 0 ? draft.fuel_capacity_gal : undefined,
        available_for_club: draft.available_for_club,
        status: draft.status,
        // Catalog-only rate persistence. Free-text rate fields were
        // removed platform-wide — always wipe hourly_rate /
        // half_day_rate / full_day_rate on save so legacy data on
        // older boats clears the first time they're edited.
        attached_fee_ids:
          draft.attached_fee_ids.length > 0
            ? draft.attached_fee_ids
            : undefined,
        hourly_rate: undefined,
        half_day_rate: undefined,
        full_day_rate: undefined,
        deposit_amount: depositAmount,
        updated_at: new Date().toISOString(),
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <WizardShell
      chrome="modal"
      onExit={onClose}
      eyebrow={`Edit rental boat · ${boat.name}`}
      title={STEP_TITLES[stepIdx]}
      subtitle={STEP_SUBTITLES[stepIdx]}
      steps={STEPS}
      currentIdx={stepIdx}
      // Edit mode: data is already valid (the record exists), so the
      // operator can jump to any step. Forward + backward navigation
      // both allowed via the stepper.
      onStepClick={setStepIdx}
      stepsClickAny
    >
      {/* Step 0 — Identity & photo */}
      {stepIdx === 0 && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="Boat name" required>
              <input
                type="text"
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
                placeholder="Pontoon 3 — Sunrunner"
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
              />
            </FieldLabel>
            <FieldLabel label="Type" required>
              <Combobox
                value={draft.type}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, type: v as RentalBoatType }))
                }
                options={BOAT_TYPE_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
                placeholder="Pick a type…"
                searchPlaceholder="Search types…"
              />
            </FieldLabel>
          </div>

          <FieldLabel label="Notes">
            <textarea
              value={draft.notes}
              onChange={(e) =>
                setDraft((d) => ({ ...d, notes: e.target.value }))
              }
              placeholder="Engine make/model, bimini top, towables, etc."
              rows={3}
              className="w-full resize-y rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[14px] text-fg focus:border-hairline-strong focus:outline-none placeholder:text-fg-tertiary"
            />
          </FieldLabel>

          <FieldLabel label="Photo">
            <PhotoDropField
              value={draft.photo_url}
              boatName={draft.name}
              onChange={(next) =>
                setDraft((d) => ({ ...d, photo_url: next }))
              }
            />
          </FieldLabel>
        </div>
      )}

      {/* Step 1 — Capacity & operations */}
      {stepIdx === 1 && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="Passenger capacity" required>
              <NumericInput
                value={draft.capacity}
                onChange={(n) =>
                  setDraft((d) => ({ ...d, capacity: n }))
                }
                placeholder="10"
              />
            </FieldLabel>
            <FieldLabel label="Fuel capacity (gal)">
              <NumericInput
                value={draft.fuel_capacity_gal}
                onChange={(n) =>
                  setDraft((d) => ({ ...d, fuel_capacity_gal: n }))
                }
                placeholder="Leave blank for kayaks / paddleboards"
              />
            </FieldLabel>
          </div>

          <FieldLabel label="Use">
            <div className="grid gap-2 sm:grid-cols-2">
              <UseToggle
                label="Boat Club"
                hint="Bookable by club members + walk-ups"
                selected={draft.available_for_club}
                onClick={() =>
                  setDraft((d) => ({ ...d, available_for_club: true }))
                }
              />
              <UseToggle
                label="Rental Boat"
                hint="Walk-up rentals only — hidden from club"
                selected={!draft.available_for_club}
                onClick={() =>
                  setDraft((d) => ({ ...d, available_for_club: false }))
                }
              />
            </div>
          </FieldLabel>

          <FieldLabel label="Status">
            <div className="grid gap-2 sm:grid-cols-2">
              {STATUS_TOGGLE_OPTIONS.map((opt) => (
                <UseToggle
                  key={opt.value}
                  label={opt.label}
                  hint={opt.hint}
                  selected={draft.status === opt.value}
                  onClick={() =>
                    setDraft((d) => ({ ...d, status: opt.value }))
                  }
                />
              ))}
            </div>
            {statusOutsideToggle && (
              <p className="mt-1.5 text-[11px] text-fg-tertiary">
                Currently {String(draft.status).replace("_", " ")} — pick
                Available / Maintenance to change it. Otherwise the existing
                status is preserved.
              </p>
            )}
          </FieldLabel>
        </div>
      )}

      {/* Step 2 — Rates (includes the refundable deposit hold) */}
      {stepIdx === 2 && (
        <div className="space-y-3">
          <FieldLabel
            label="Service rates"
            required
            hint="Pick from the catalog. At least one deposit-flagged rate (refundable hold) is required."
          >
            {rentalBoatFees.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 p-4 text-center text-[12px] text-fg-subtle">
                No rental-boat rates configured. Add some in{" "}
                <strong>Services → Fees</strong>.
              </div>
            ) : (
              <MultiCombobox
                value={draft.attached_fee_ids}
                onChange={(next) =>
                  setDraft((d) => ({ ...d, attached_fee_ids: next }))
                }
                options={rentalBoatFees.map((f) => ({
                  value: f.id,
                  label: f.name,
                  sub: f.is_deposit ? "Deposit hold" : f.description ?? undefined,
                  trailing: formatMoney(f.amount),
                }))}
                placeholder="Click to pick rates · type to filter"
                searchPlaceholder="Search rates…"
                emptyText="No rates match."
              />
            )}
          </FieldLabel>
          {!canStep2 && draft.attached_fee_ids.length > 0 && !pickedDepositFee && (
            <p className="text-[11px] text-status-warn">
              Attach a refundable deposit rate from the catalog to continue.
            </p>
          )}
        </div>
      )}

      <WizardFooter
        stepIndex={stepIdx}
        totalSteps={STEPS.length}
        stepLabel={STEPS[stepIdx].label}
        onBack={back}
        onContinue={stepIdx === STEPS.length - 1 ? handleSave : next}
        continueLabel={stepIdx === STEPS.length - 1 ? "Save changes" : "Continue"}
        continueDisabled={!canContinue}
        busy={submitting}
        onExit={onClose}
        busyLabel="Saving…"
      />
    </WizardShell>
  );
}

// ─── UseToggle — shared card-toggle for binary picks ───────────────
function UseToggle({
  label,
  hint,
  selected,
  onClick,
}: {
  label: string;
  hint: string;
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
      <div className="text-[13px] font-medium text-fg">{label}</div>
      <div className="text-[11px] text-fg-tertiary">{hint}</div>
    </button>
  );
}
