"use client";

import * as React from "react";
import { ImageIcon, Sparkles, Upload, X } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardFooter } from "@/components/wizard/wizard-footer";
import type { WizardStep } from "@/components/wizard/wizard-progress";
import {
  FieldLabel,
  RailRow,
  ReviewBlock,
} from "@/components/wizard/wizard-fields";
import { useWizardDraft } from "@/components/wizard/use-wizard-draft";
import {
  upsertRentalBoat,
  useFeesForEntity,
  useRentalBoats,
} from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";
import { formatMoney } from "@/lib/mock-data";
import type { RentalBoat, RentalBoatStatus, RentalBoatType } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * Rental boat fleet wizard — modal, multi-step. Modeled on the slip-
 * assignment wizard's structure (WizardShell + sessionStorage draft +
 * gated step-by-step + right-rail rollup + agent affordance).
 *
 * Launched from:
 *   - /boat-rentals (fleet grid header "+ New boat")
 *   - /services/rental-club Fleet section "+ New boat"
 *
 * Steps:
 *   0. Identity & photos — name, type, dropped-in photo, notes
 *   1. Capacity & safety — passengers, fuel cap (optional), club rotation
 *   2. Rates & availability — hourly/half/full rates (≥1 required),
 *                             deposit, status
 *
 * Save path: executeAgentAction({ kind: "create_rental_boat", ... }) so
 * the boat shows up in the audit log + agent timeline. photo_url (a
 * data URL from the in-step drop zone) and an explicit non-default
 * status are layered on with a follow-up upsertRentalBoat once the
 * createdId returns, since the agent action shape doesn't yet carry
 * either field.
 */

// Bumped to v3 when free-text rate fields (rate_mode + hourly_rate +
// half_day_rate + full_day_rate) were removed platform-wide. Any v2
// drafts in sessionStorage are abandoned (clean break).
const STORAGE_KEY = "marina_rental_boat_wizard_draft_v3";

const STEPS: WizardStep[] = [
  { id: "identity", label: "Identity" },
  { id: "capacity", label: "Capacity" },
  { id: "rates", label: "Rates" },
];

const STEP_TITLES = [
  "What boat are you adding?",
  "How many passengers fit?",
  "Set rates and availability",
];

const STEP_SUBTITLES = [
  "Name it, pick a type, and tell us where it lives on the dock. A photo helps the rentals page look good.",
  "Capacity caps every booking. If it's motorized, add the fuel tank size and decide whether the club can book it.",
  "At least one rate is required. Deposit holds the renter's card at pickup; status flags the boat in/out of the fleet.",
];

const BOAT_TYPE_OPTIONS: { value: RentalBoatType; label: string }[] = [
  { value: "pontoon", label: "Pontoon" },
  { value: "wakeboat", label: "Wakeboat" },
  { value: "fishing_skiff", label: "Fishing Skiff" },
  { value: "jet_ski", label: "Jet Ski" },
  { value: "kayak", label: "Kayak" },
  { value: "paddleboard", label: "Paddleboard" },
];

const STATUS_OPTIONS: {
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
  // Step 0
  name: string;
  type: RentalBoatType;
  photo_url: string;
  notes: string;
  // Step 1
  capacity: number;
  fuel_capacity_gal: number; // 0 = not applicable
  available_for_club: boolean;
  // Step 2 — pricing. Catalog-attached only. Free-text rates were
  // removed platform-wide; every rate the boat charges is an
  // AdditionalFee row attached via the catalog (applies_to_entities
  // includes "rental_boat"). Operators manage the rate catalog in
  // Services → Fees; this wizard just attaches what applies.
  attached_fee_ids: string[];
  deposit_amount: number;
  status: RentalBoatStatus;
};

const INITIAL_DRAFT: DraftState = {
  name: "",
  type: "pontoon",
  photo_url: "",
  notes: "",
  capacity: 0,
  fuel_capacity_gal: 0,
  available_for_club: true,
  attached_fee_ids: [],
  deposit_amount: 0,
  status: "available",
};

function MoneyInput({
  value,
  onChange,
  placeholder,
}: {
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
}) {
  // Tabular numeric input — global rule §6.2 forbids native number spinners.
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

export function RentalBoatWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
}) {
  const rentalBoats = useRentalBoats();
  // Rental-boat catalog fees — the "service fees" side of the rates
  // toggle. Operators attach these instead of typing prices per boat.
  const rentalBoatFees = useFeesForEntity("rental_boat");

  const [submitting, setSubmitting] = React.useState(false);

  const [persisted, setPersisted, clearPersisted] = useWizardDraft<{
    step: number;
    draft: DraftState;
  }>(STORAGE_KEY, () => ({ step: 0, draft: INITIAL_DRAFT }));

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

  // ── Derived ──────────────────────────────────────────────────────────
  const typeLabel =
    BOAT_TYPE_OPTIONS.find((o) => o.value === draft.type)?.label ?? draft.type;
  // ── Validation gates ────────────────────────────────────────────────
  const canStep0 = draft.name.trim().length > 0;
  const canStep1 = draft.capacity > 0;
  // Step 2 gate — catalog-only since free-text rates were removed
  // platform-wide. At least one catalog fee must be attached, AND
  // a deposit-flagged catalog row must be among them (the marina's
  // safety net — now also catalog-sourced rather than free-text).
  const hasRatePricing = draft.attached_fee_ids.length > 0;
  const pickedDepositFee = rentalBoatFees.find(
    (f) => f.is_deposit && draft.attached_fee_ids.includes(f.id),
  );
  const canStep2 = hasRatePricing && Boolean(pickedDepositFee);
  const canContinue = [canStep0, canStep1, canStep2][stepIdx];

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

  function submit() {
    if (!canStep2) return;
    setSubmitting(true);
    try {
      // Deposit amount sources from the picked deposit-flagged catalog
      // rate. No standalone free-text input anymore — gated by canStep2
      // which requires a deposit fee to be attached.
      const derivedDepositAmount = pickedDepositFee?.amount ?? 0;
      const result = executeAgentAction({
        kind: "create_rental_boat",
        label: "",
        name: draft.name.trim(),
        type: draft.type,
        capacity: draft.capacity,
        deposit_amount: derivedDepositAmount,
        fuel_capacity_gal:
          draft.fuel_capacity_gal > 0 ? draft.fuel_capacity_gal : undefined,
        available_for_club: draft.available_for_club,
        notes: draft.notes.trim() || undefined,
      });

      // Layer on the fields create_rental_boat doesn't carry today —
      // photo_url, attached catalog fees, and a non-default status.
      // Free-text rate fields (hourly/half/full) were removed
      // platform-wide; rates come exclusively from the catalog via
      // attached_fee_ids.
      if (result.ok && result.createdId) {
        const trimmedPhoto = draft.photo_url.trim();
        const persistedFeeIds = draft.attached_fee_ids;
        const needsPatch =
          trimmedPhoto.length > 0 ||
          draft.status !== "available" ||
          persistedFeeIds.length > 0;
        if (needsPatch) {
          const existing = rentalBoats.find((b) => b.id === result.createdId);
          // The store update is synchronous, but `rentalBoats` snapshot in
          // this closure is stale (pre-create). Fall back to constructing
          // a fresh record from the draft when the snapshot misses.
          const base: RentalBoat = existing ?? {
            id: result.createdId,
            name: draft.name.trim(),
            type: draft.type,
            capacity: draft.capacity,
            deposit_amount: derivedDepositAmount,
            fuel_capacity_gal:
              draft.fuel_capacity_gal > 0
                ? draft.fuel_capacity_gal
                : undefined,
            home_dock: "",
            status: "available",
            active: true,
            available_for_club: draft.available_for_club,
            notes: draft.notes.trim() || undefined,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          upsertRentalBoat({
            ...base,
            photo_url: trimmedPhoto || base.photo_url,
            status: draft.status,
            attached_fee_ids:
              persistedFeeIds.length > 0 ? persistedFeeIds : undefined,
            updated_at: new Date().toISOString(),
          });
        }
      }

      clearPersisted();
      // Reset to a fresh draft for next launch.
      setPersisted({ step: 0, draft: INITIAL_DRAFT });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Right-rail rollup — builds up as steps fill ──────────────────────
  const rightRail = (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
          New boat
        </div>
        <div className="mt-1 text-[20px] font-semibold text-fg">
          {draft.name.trim() || "Untitled boat"}
        </div>
        <div className="text-[12px] capitalize text-fg-subtle">
          {typeLabel}
        </div>
      </div>

      {/* Photo preview — appears the moment a file is dropped */}
      {draft.photo_url.trim() && (
        <div className="overflow-hidden rounded-[10px] border border-hairline bg-surface-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={draft.photo_url.trim()}
            alt={draft.name || "Boat photo"}
            className="h-32 w-full object-cover"
            onError={(e) => {
              // Bad data URL — hide the preview rather than show a broken icon.
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}

      <dl className="space-y-1.5 border-t border-hairline pt-3 text-[12px]">
        {draft.capacity > 0 && (
          <RailRow
            label="Capacity"
            value={`${draft.capacity} passenger${draft.capacity === 1 ? "" : "s"}`}
          />
        )}
        {draft.fuel_capacity_gal > 0 && (
          <RailRow
            label="Fuel"
            value={`${draft.fuel_capacity_gal} gal`}
          />
        )}
        <RailRow
          label="Use"
          value={draft.available_for_club ? "Boat Club" : "Rental Boat"}
        />
      </dl>

      {/* Rates rollup — counts catalog rates attached + deposit hold
          (also catalog-sourced now, surfaced by the is_deposit flag). */}
      {draft.attached_fee_ids.length > 0 && (
        <div className="border-t border-hairline pt-3">
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-fg-tertiary">
            Rates
          </div>
          <ul className="space-y-1 text-[12px]">
            <li className="flex items-baseline justify-between gap-2">
              <span className="text-fg-subtle">Attached</span>
              <span className="tabular text-fg">
                {draft.attached_fee_ids.length}
                {" "}rate{draft.attached_fee_ids.length === 1 ? "" : "s"}
              </span>
            </li>
            {pickedDepositFee && (
              <li className="flex items-baseline justify-between gap-2 border-t border-hairline pt-1">
                <span className="text-fg-tertiary">Deposit hold</span>
                <span className="money-display tabular text-fg-subtle">
                  {formatMoney(pickedDepositFee.amount)}
                </span>
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="rounded-[10px] border border-primary/30 bg-primary-soft/40 p-3">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-primary">
          <Sparkles className="size-3.5" />
          Ask the agent
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-subtle">
          Try: &ldquo;Add a new pontoon — Yamaha 23ft, 10-seat, $250 half day&rdquo;
          — the agent fills the whole wizard.
        </p>
      </div>
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────
  if (!open) return null;

  return (
    <WizardShell
      eyebrow="New rental boat"
      title={STEP_TITLES[stepIdx]}
      subtitle={STEP_SUBTITLES[stepIdx]}
      steps={STEPS}
      currentIdx={stepIdx}
      onStepClick={(idx) => idx < stepIdx && setStepIdx(idx)}
      rightRail={rightRail}
      chrome="modal"
      onExit={close}
    >
      {/* Step 0 — Identity & photos */}
      {stepIdx === 0 && (
        <div className="space-y-4">
          <FieldLabel label="Boat name" required>
            <input
              type="text"
              value={draft.name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
              placeholder="Pontoon 3 — Sunrunner"
              autoFocus
              className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none placeholder:text-fg-tertiary"
            />
          </FieldLabel>

          <FieldLabel
            label="Type"
            required
            hint="Drives how the boat renders on the fleet grid and which club tier it slots into."
          >
            <Combobox
              value={draft.type}
              onChange={(v) =>
                setDraft((d) => ({ ...d, type: v as RentalBoatType }))
              }
              options={BOAT_TYPE_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
              placeholder="Pick a boat type…"
              searchPlaceholder="Search types…"
            />
          </FieldLabel>

          <FieldLabel
            label="Photo (optional)"
            hint="Drop or pick an image — stored locally on the boat record. JPG / PNG / WEBP up to ~2 MB."
          >
            <PhotoDropField
              value={draft.photo_url}
              boatName={draft.name}
              onChange={(next) =>
                setDraft((d) => ({ ...d, photo_url: next }))
              }
            />
          </FieldLabel>

          <FieldLabel
            label="Notes (optional)"
            hint="Engine make/model, bimini top, towables included, etc."
          >
            <textarea
              value={draft.notes}
              onChange={(e) =>
                setDraft((d) => ({ ...d, notes: e.target.value }))
              }
              rows={3}
              placeholder="Yamaha 150hp, bimini top, swim ladder, Bluetooth stereo…"
              className="min-h-[72px] w-full resize-y rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[14px] leading-relaxed text-fg focus:border-hairline-strong focus:outline-none placeholder:text-fg-tertiary"
            />
          </FieldLabel>
        </div>
      )}

      {/* Step 1 — Capacity & safety */}
      {stepIdx === 1 && (
        <div className="space-y-4">
          <FieldLabel
            label="Passenger capacity"
            required
            hint="Hard cap the rental flow enforces at booking time."
          >
            <NumericInput
              value={draft.capacity}
              onChange={(n) => setDraft((d) => ({ ...d, capacity: n }))}
              placeholder="10"
            />
          </FieldLabel>

          <FieldLabel
            label="Fuel capacity (gal)"
            hint="Leave blank for kayaks, paddleboards, and anything without an engine."
          >
            <NumericInput
              value={draft.fuel_capacity_gal}
              onChange={(n) =>
                setDraft((d) => ({ ...d, fuel_capacity_gal: n }))
              }
              placeholder="30"
            />
          </FieldLabel>

          <FieldLabel
            label="Use"
            hint="Boat Club boats count toward member day capacity. Rental Boats are walk-up only."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() =>
                  setDraft((d) => ({ ...d, available_for_club: true }))
                }
                className={cn(
                  "flex flex-col items-start gap-1 rounded-[10px] border px-3 py-2.5 text-left transition-colors",
                  draft.available_for_club
                    ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
                    : "border-hairline bg-surface-1 hover:border-hairline-strong hover:bg-surface-2"
                )}
              >
                <div className="text-[13px] font-medium text-fg">
                  Boat Club
                </div>
                <div className="text-[11px] text-fg-tertiary">
                  Bookable by club members + walk-ups
                </div>
              </button>
              <button
                type="button"
                onClick={() =>
                  setDraft((d) => ({ ...d, available_for_club: false }))
                }
                className={cn(
                  "flex flex-col items-start gap-1 rounded-[10px] border px-3 py-2.5 text-left transition-colors",
                  !draft.available_for_club
                    ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
                    : "border-hairline bg-surface-1 hover:border-hairline-strong hover:bg-surface-2"
                )}
              >
                <div className="text-[13px] font-medium text-fg">
                  Rental Boat
                </div>
                <div className="text-[11px] text-fg-tertiary">
                  Walk-up rentals only — hidden from club
                </div>
              </button>
            </div>
          </FieldLabel>
        </div>
      )}

      {/* Step 2 — Rates & availability */}
      {stepIdx === 2 && (
        <div className="space-y-4">
          <div className="rounded-[10px] border border-primary/30 bg-primary-soft/30 p-3">
            <div className="text-[11px] uppercase tracking-wide text-primary">
              Rates
            </div>
            <p className="mt-0.5 text-[11px] text-fg-tertiary">
              Sourced from the Services → Fees catalog — attach the
              rates this boat charges. Catalog is the single source of
              truth across the tool; free-text rates were removed.
            </p>
          </div>

          {rentalBoatFees.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 p-6 text-center text-[13px] text-fg-subtle">
              No rental-boat rates configured yet. Add some in{" "}
              <strong>Services &rarr; Fees</strong>, then come back here.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {rentalBoatFees.map((f) => {
                const checked = draft.attached_fee_ids.includes(f.id);
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          attached_fee_ids: checked
                            ? d.attached_fee_ids.filter((x) => x !== f.id)
                            : [...d.attached_fee_ids, f.id],
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
                      <span className="money-display whitespace-nowrap text-[15px] text-fg">
                        {formatMoney(f.amount)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {!hasRatePricing && (
            <p className="text-[12px] text-status-danger">
              Attach at least one catalog rate to continue.
            </p>
          )}
          {hasRatePricing && !pickedDepositFee && (
            <p className="text-[11px] text-status-warn">
              Attach a refundable deposit rate from the catalog to continue.
            </p>
          )}

          <FieldLabel label="Status">
            <div className="grid gap-2 sm:grid-cols-2">
              {STATUS_OPTIONS.map((opt) => {
                const selected = draft.status === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({ ...d, status: opt.value }))
                    }
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-[10px] border px-3 py-2.5 text-left transition-colors",
                      selected
                        ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
                        : "border-hairline bg-surface-1 hover:border-hairline-strong hover:bg-surface-2"
                    )}
                  >
                    <div className="text-[13px] font-medium text-fg">
                      {opt.label}
                    </div>
                    <div className="text-[11px] text-fg-tertiary">
                      {opt.hint}
                    </div>
                  </button>
                );
              })}
            </div>
          </FieldLabel>

          {/* Inline review — wizard is short enough that a dedicated review
              step adds friction. Edits jump back to the right step. */}
          <div className="space-y-2 border-t border-hairline pt-4">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-fg-tertiary">
              Review
            </div>
            <ReviewBlock
              label="Identity"
              value={`${draft.name.trim() || "—"} · ${typeLabel}`}
              onEdit={() => setStepIdx(0)}
            />
            <ReviewBlock
              label="Photo"
              value={draft.photo_url.trim() ? "Attached" : "None"}
              onEdit={() => setStepIdx(0)}
            />
            <ReviewBlock
              label="Capacity"
              value={
                draft.capacity > 0
                  ? `${draft.capacity} passenger${
                      draft.capacity === 1 ? "" : "s"
                    }${
                      draft.fuel_capacity_gal > 0
                        ? ` · ${draft.fuel_capacity_gal} gal fuel`
                        : ""
                    } · ${
                      draft.available_for_club ? "Boat Club" : "Rental Boat"
                    }`
                  : "—"
              }
              onEdit={() => setStepIdx(1)}
            />
            <ReviewBlock
              label="Rates"
              value={
                draft.attached_fee_ids.length > 0
                  ? `${draft.attached_fee_ids.length} catalog rate${
                      draft.attached_fee_ids.length === 1 ? "" : "s"
                    } attached`
                  : "—"
              }
              onEdit={() => setStepIdx(2)}
            />
            <ReviewBlock
              label="Deposit / status"
              value={`${
                pickedDepositFee
                  ? formatMoney(pickedDepositFee.amount)
                  : "—"
              } · ${draft.status}`}
              capitalize
              onEdit={() => setStepIdx(2)}
            />
          </div>
        </div>
      )}

      <WizardFooter
        stepIndex={stepIdx}
        totalSteps={STEPS.length}
        stepLabel={STEPS[stepIdx].label}
        onBack={back}
        onContinue={stepIdx === STEPS.length - 1 ? submit : next}
        continueLabel={stepIdx === STEPS.length - 1 ? "Add to fleet" : "Continue"}
        continueDisabled={!canContinue}
        busy={submitting}
        onExit={close}
        busyLabel="Adding…"
      />
    </WizardShell>
  );
}

// ─── PhotoDropField ─────────────────────────────────────────────────────
// Compact image-only drop zone for the wizard. Reads the file with
// FileReader → data URL and stores it directly in draft.photo_url. The
// in-memory data URL is what eventually lands on RentalBoat.photo_url
// when the wizard submits; this keeps the wizard self-contained and
// avoids depending on object storage that isn't wired yet.
//
// Why a local component (not the AI <DropZone>):
//   - AI drop-zone is document-extract-first (PDF → structured record)
//   - We want a plain image picker with preview + remove, not an
//     extraction pipeline
//   - Stays narrow to the wizard's contract: { value, onChange }
export function PhotoDropField({
  value,
  boatName,
  onChange,
}: {
  value: string;
  boatName: string;
  onChange: (next: string) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function handleFile(file: File | undefined | null) {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That isn't an image file — try a JPG, PNG, or WEBP.");
      return;
    }
    // ~2.5 MB cap; data URLs balloon in memory + sessionStorage drafts.
    const MAX = 2.5 * 1024 * 1024;
    if (file.size > MAX) {
      setError(
        `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — please pick one under 2.5 MB.`
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (result) onChange(result);
    };
    reader.onerror = () => setError("Couldn't read that file. Try again?");
    reader.readAsDataURL(file);
  }

  const hasPhoto = value.trim().length > 0;

  return (
    <div className="space-y-1.5">
      {hasPhoto ? (
        <div className="relative overflow-hidden rounded-[10px] border border-hairline bg-surface-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt={boatName.trim() || "Boat photo"}
            className="h-24 w-full object-cover"
          />
          <div className="absolute right-2 top-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-hairline bg-surface-1/90 px-2 text-[11px] text-fg-subtle backdrop-blur transition-colors hover:bg-surface-2"
            >
              <Upload className="size-3" /> Replace
            </button>
            <button
              type="button"
              onClick={() => onChange("")}
              className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-hairline bg-surface-1/90 px-2 text-[11px] text-fg-subtle backdrop-blur transition-colors hover:bg-surface-2"
              aria-label="Remove photo"
            >
              <X className="size-3" /> Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFile(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "flex h-16 w-full items-center justify-center gap-2 rounded-[10px] border border-dashed text-[12px] transition-colors",
            dragging
              ? "border-hairline-strong bg-surface-2 text-fg"
              : "border-hairline bg-surface-2/50 text-fg-subtle hover:border-hairline-strong hover:bg-surface-2"
          )}
        >
          <ImageIcon className="size-4 text-fg-tertiary" />
          <span className="font-medium">
            {dragging ? "Drop to attach" : "Drop a photo or click to pick"}
          </span>
          <span className="text-[11px] text-fg-tertiary">
            · JPG / PNG / WEBP · 2.5 MB
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          // Reset so re-picking the same file fires onChange again.
          e.target.value = "";
        }}
      />

      {error && (
        <p className="text-[11px] text-status-danger">{error}</p>
      )}
    </div>
  );
}
