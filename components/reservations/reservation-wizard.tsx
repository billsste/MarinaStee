"use client";

import * as React from "react";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardFooter } from "@/components/wizard/wizard-footer";
import type { WizardStep } from "@/components/wizard/wizard-progress";
import {
  FieldLabel,
  RailRow,
  ReviewBlock,
  ReviewList,
} from "@/components/wizard/wizard-fields";
import { useWizardDraft } from "@/components/wizard/use-wizard-draft";
import { NewBoaterSheet } from "@/components/boaters/new-boater-sheet";
import { AddVesselSheet } from "@/components/boaters/add-vessel-sheet";
import { BOATERS, VESSELS, formatMoney } from "@/lib/mock-data";
import {
  totalFromAttachedFees,
  useBoaters,
  useContractsForBoater,
  useFeesForEntity,
  useReservations,
  useSlips,
  useVesselsForBoater,
} from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";
import type { AdditionalFee, ReservationType, Slip } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * Multi-step reservation wizard — modeled on the slip-assignment wizard
 * (app/services/[id]/assign/assign-slip-client.tsx). Renders inside a
 * full-screen modal overlay so it can be opened from anywhere (Bookings,
 * Boater identity bar, agent action).
 *
 * Steps:
 *   0. Holder        — pick existing (combobox) or create new (sheet).
 *                      Annual/seasonal/monthly holders see their assigned
 *                      slip surfaced as a one-click pre-fill for step 1.
 *   1. Slip + dates  — vacancy-aware slip combobox + arrival/departure
 *                      + reservation type.
 *   2. Vessel        — pick existing or create via AddVesselSheet
 *                      (optional — can attach later).
 *   3. Services      — read-only rate display + multi-select add-on fees.
 *   4. Review        — confirm + Create reservation.
 */

const STORAGE_KEY = "marina_reservation_wizard_draft_v1";

const STEPS: WizardStep[] = [
  { id: "holder", label: "Holder" },
  { id: "slip", label: "Slip + dates" },
  { id: "vessel", label: "Vessel" },
  { id: "services", label: "Services" },
  { id: "review", label: "Review" },
];

const STEP_TITLES = [
  "Who's the reservation for?",
  "Pick a slip and dates",
  "What vessel will be on the slip?",
  "Add any extra services",
  "Review and create",
];

const STEP_SUBTITLES = [
  "Search existing members or create a new one. Annual / seasonal holders surface their assigned slip below.",
  "Pick an open slip and set arrival / departure. We filter slips that conflict with another reservation in this window.",
  "Pick a vessel on file for this member, or skip and attach later.",
  "Optional add-ons billed alongside the reservation — pump-out, hoist, electric, etc.",
  "Confirm the details — clicking Create books the slip and writes a scheduled reservation.",
];

type DraftState = {
  boaterId: string;
  slipId: string;
  vesselId: string;
  type: ReservationType;
  arrival: string;
  departure: string;
  selectedFeeIds: string[];
};

type ResWindow = { slipId: string; arrival: string; departure: string };

function rangesOverlap(a: ResWindow, b: ResWindow): boolean {
  // Inclusive overlap on ISO date strings (YYYY-MM-DD compares lexically).
  return a.arrival <= b.departure && b.arrival <= a.departure;
}

export function ReservationWizard({
  open,
  onOpenChange,
  defaultBoaterId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  /** Pre-fill the holder — e.g. when launched from a boater identity bar. */
  defaultBoaterId?: string;
}) {
  const liveBoaters = useBoaters();
  const boaters = liveBoaters.length > 0 ? liveBoaters : BOATERS;
  const slips = useSlips();
  const reservationFees = useFeesForEntity("reservation");
  const reservations = useReservations();

  const [submitting, setSubmitting] = React.useState(false);
  const [newHolderOpen, setNewHolderOpen] = React.useState(false);
  const [newVesselOpen, setNewVesselOpen] = React.useState(false);

  // sessionStorage-backed wizard state. Hook hydrates on mount from
  // sessionStorage; if nothing's there we use the initial blanks. The
  // reset-on-open effect below normalizes when the wizard is reopened
  // for a fresh booking.
  const [persisted, setPersisted, clearPersisted] = useWizardDraft<{
    step: number;
    draft: DraftState;
  }>(STORAGE_KEY, () => {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    return {
      step: 0,
      draft: {
        boaterId: defaultBoaterId ?? "",
        slipId: "",
        vesselId: "",
        type: "transient" as ReservationType,
        arrival: today,
        departure: tomorrow,
        selectedFeeIds: [],
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
          typeof next === "function" ? (next as (n: number) => number)(p.step) : next,
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

  // Reset on open. If defaultBoaterId is set, force-override the holder
  // so the launch context wins (e.g. opening from a specific boater
  // page). If no draft is present in storage, seed a fresh one.
  React.useEffect(() => {
    if (!open) return;
    if (defaultBoaterId) {
      setDraft((d) => ({ ...d, boaterId: defaultBoaterId }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultBoaterId]);

  // ── Derived ──────────────────────────────────────────────────────────
  const selectedBoater = boaters.find((b) => b.id === draft.boaterId);
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

  // Surface the holder's existing annual / seasonal / monthly slip
  // assignment as a one-click pre-fill on step 1. We pull the most
  // recent active contract; the wizard then assumes that slip is the
  // default. Pure transient holders skip this and pick freely.
  const boaterContracts = useContractsForBoater(draft.boaterId);
  const suggestedSlip: Slip | undefined = React.useMemo(() => {
    if (!selectedBoater) return undefined;
    const active = boaterContracts
      .filter(
        (c) =>
          (c.status === "active" || c.status === "sent" || c.status === "draft") &&
          (c.billing_cadence === "annual" ||
            c.billing_cadence === "seasonal" ||
            c.billing_cadence === "monthly") &&
          c.slip_id
      )
      .sort((a, b) =>
        (a.effective_start ?? "") < (b.effective_start ?? "") ? 1 : -1
      );
    const slipId = active[0]?.slip_id;
    if (!slipId) return undefined;
    return slips.find((s) => s.id === slipId);
  }, [selectedBoater, boaterContracts, slips]);

  // Vacancy-aware slip list: filter to slips that have no overlapping
  // non-cancelled reservation in the requested date window. The current
  // draft slip stays in the list even if it conflicts, so the operator
  // can see why it was picked. The suggested slip is always allowed (we
  // want the operator to be able to one-click pre-fill it).
  const availableSlips = React.useMemo(() => {
    if (!draft.arrival || !draft.departure) return slips;
    const window = {
      slipId: "",
      arrival: draft.arrival,
      departure: draft.departure,
    };
    return slips.filter((s) => {
      if (s.id === draft.slipId) return true;
      if (s.id === suggestedSlip?.id) return true;
      const conflict = reservations.some(
        (r) =>
          r.slip_id === s.id &&
          r.status !== "cancelled" &&
          rangesOverlap(window, {
            slipId: s.id,
            arrival: r.arrival_date,
            departure: r.departure_date,
          })
      );
      return !conflict;
    });
  }, [slips, reservations, draft.arrival, draft.departure, draft.slipId, suggestedSlip]);

  const selectedSlip = slips.find((s) => s.id === draft.slipId);
  const selectedFees = reservationFees.filter((f) =>
    draft.selectedFeeIds.includes(f.id),
  );
  const selectedVessel = vesselOptions.find((v) => v.id === draft.vesselId);

  // Group catalog fees by cadence for section headers. One-time first
  // (most common for transient stays), then monthly, then annual.
  const feesByCadence = React.useMemo(() => {
    const groups: Record<"one_time" | "monthly" | "annual", AdditionalFee[]> = {
      one_time: [],
      monthly: [],
      annual: [],
    };
    for (const f of reservationFees) {
      const cadence = f.cadence ?? "one_time";
      groups[cadence].push(f);
    }
    return groups;
  }, [reservationFees]);

  // ── Pricing display (read-only) ───────────────────────────────────────
  // Reservation has no amount field — pricing is computed at check-in.
  // For the wizard we surface a directional total based on the slip's
  // default rate × nights so the operator sees a ballpark.
  const nights = React.useMemo(() => {
    if (!draft.arrival || !draft.departure) return 0;
    const a = new Date(draft.arrival);
    const d = new Date(draft.departure);
    return Math.max(0, Math.round((d.getTime() - a.getTime()) / 86_400_000));
  }, [draft.arrival, draft.departure]);

  function rateForSlipAndType(slip: Slip | undefined, type: ReservationType): {
    amount: number;
    label: string;
    per: string;
  } {
    if (!slip) return { amount: 0, label: "", per: "" };
    if (type === "annual") {
      return {
        amount: slip.default_annual_rate,
        label: "Annual rate",
        per: "/ year",
      };
    }
    if (type === "seasonal") {
      return {
        amount:
          slip.default_seasonal_rate ?? Math.round(slip.default_annual_rate * 0.6),
        label: "Seasonal rate",
        per: "/ season",
      };
    }
    if (type === "monthly") {
      return {
        amount:
          slip.default_monthly_rate ?? Math.round(slip.default_annual_rate / 12),
        label: "Monthly rate",
        per: "/ month",
      };
    }
    // transient / recurring — nightly directional from monthly/30
    const monthly =
      slip.default_monthly_rate ?? Math.round(slip.default_annual_rate / 12);
    const nightly = Math.max(1, Math.round(monthly / 30));
    return { amount: nightly, label: "Nightly rate", per: "/ night" };
  }

  const rate = rateForSlipAndType(selectedSlip, draft.type);
  const stayCharge =
    draft.type === "transient" || draft.type === "recurring"
      ? rate.amount * Math.max(nights, 1)
      : rate.amount;

  // Stay length in months drives proration for monthly/annual fees on
  // longer reservations. For transient stays under ~14 nights we treat
  // the attached fees as one-time only — monthly/annual cadence is
  // suppressed in the UI (and the roll-up math zeroes out when termMonths
  // is < 1). Anything longer uses ceil(days / 30) so a 45-night stay
  // bills 2 months of any monthly add-on.
  const isShortTransient =
    (draft.type === "transient" || draft.type === "recurring") && nights < 14;
  const termMonths = isShortTransient
    ? 0 // suppress monthly/annual proration entirely
    : draft.type === "transient" || draft.type === "recurring"
      ? Math.max(1, Math.ceil(nights / 30))
      : draft.type === "monthly"
        ? 1
        : draft.type === "annual"
          ? 12
          : draft.type === "seasonal"
            ? 6
            : 1;

  const feeRollup = totalFromAttachedFees(draft.selectedFeeIds, termMonths);
  const estimatedTotal = stayCharge + feeRollup.total;

  // ── Validation gates ────────────────────────────────────────────────
  const canStep0 = draft.boaterId.length > 0;
  const canStep1 =
    draft.slipId.length > 0 &&
    draft.arrival.length > 0 &&
    draft.departure.length > 0 &&
    draft.arrival <= draft.departure;
  const canStep2 = true; // vessel is optional
  const canStep3 = true; // services are optional
  const canStep4 = canStep0 && canStep1;

  const canContinue = [canStep0, canStep1, canStep2, canStep3, canStep4][stepIdx];

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
    if (!canStep4) return;
    setSubmitting(true);
    try {
      // Filter selected fees against the short-transient suppression
      // rule — UI hides monthly/annual chips in that case, but the
      // draft array could still carry stale ids from before the type
      // flipped. Persist only what's actually applicable.
      const persistedFeeIds = draft.selectedFeeIds.filter((id) => {
        const fee = reservationFees.find((f) => f.id === id);
        if (!fee) return false;
        if (
          isShortTransient &&
          (fee.cadence ?? "one_time") !== "one_time"
        ) {
          return false;
        }
        return true;
      });
      executeAgentAction({
        kind: "create_reservation",
        label: "",
        boater_id: draft.boaterId,
        slip_id: draft.slipId,
        vessel_id: draft.vesselId || undefined,
        arrival_date: draft.arrival,
        departure_date: draft.departure,
        type: draft.type,
        attached_fee_ids: persistedFeeIds.length > 0 ? persistedFeeIds : undefined,
      });
      // Clear the draft cache once committed
      clearPersisted();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Right-rail summary — updates as the operator advances ────────────
  const rightRail = (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
          Reservation
        </div>
        <div className="mt-1 text-[20px] font-semibold capitalize text-fg">
          {draft.type === "transient" ? "Transient stay" : draft.type}
        </div>
        {nights > 0 && (
          <div className="text-[12px] text-fg-subtle">
            {nights} night{nights === 1 ? "" : "s"}
          </div>
        )}
      </div>
      <dl className="space-y-1.5 border-t border-hairline pt-3 text-[12px]">
        <RailRow
          label="Holder"
          value={selectedBoater?.display_name ?? "—"}
        />
        <RailRow
          label="Slip"
          value={
            selectedSlip
              ? `${selectedSlip.number} · ${selectedSlip.dock}`
              : "—"
          }
        />
        <RailRow label="Arrival" value={draft.arrival || "—"} />
        <RailRow label="Departure" value={draft.departure || "—"} />
        <RailRow label="Vessel" value={selectedVessel?.name ?? "—"} />
      </dl>

      {selectedSlip && rate.amount > 0 && (
        <div className="border-t border-hairline pt-3">
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-fg-tertiary">
            {rate.label}
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] text-fg-subtle">{rate.per}</span>
            <span className="money-display tabular text-fg">
              {formatMoney(rate.amount)}
            </span>
          </div>
          {selectedFees.length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-hairline pt-2 text-[12px]">
              {selectedFees.map((f) => {
                const cadence = f.cadence ?? "one_time";
                const suffix =
                  cadence === "monthly"
                    ? "/mo"
                    : cadence === "annual"
                      ? "/yr"
                      : "";
                return (
                  <li
                    key={f.id}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-fg-subtle">
                      {f.name}
                    </span>
                    <span className="money-display tabular text-fg">
                      +{formatMoney(f.amount)}
                      {suffix && (
                        <span className="ml-0.5 text-[10px] text-fg-tertiary">
                          {suffix}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {/* Inline cadence roll-up — "$1,275 one-time + $74/month" */}
          {selectedFees.length > 0 && (
            <div className="mt-2 border-t border-hairline pt-2 text-[11px] text-fg-subtle">
              {[
                feeRollup.oneTime > 0
                  ? `${formatMoney(feeRollup.oneTime)} one-time`
                  : null,
                feeRollup.monthly > 0
                  ? `${formatMoney(feeRollup.monthly / Math.max(1, termMonths))}/mo`
                  : null,
                feeRollup.annual > 0
                  ? `${formatMoney((feeRollup.annual / Math.max(1, termMonths)) * 12)}/yr`
                  : null,
              ]
                .filter(Boolean)
                .join(" + ") || "No services added"}
            </div>
          )}
          <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-hairline pt-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
              Est. total
            </span>
            <span className="money-display text-[14px] font-medium text-fg">
              {formatMoney(estimatedTotal)}
            </span>
          </div>
          <p className="mt-1 text-[10px] text-fg-tertiary">
            Directional only — final charge posts at check-in.
            {isShortTransient && selectedFees.length > 0 && (
              <>
                {" "}Monthly / annual fees are skipped for short transient stays.
              </>
            )}
          </p>
        </div>
      )}

      <div className="rounded-[10px] border border-primary/30 bg-primary-soft/40 p-3">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-primary">
          <Sparkles className="size-3.5" />
          Ask the agent
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-subtle">
          Try: &ldquo;Book a transient slip for Peterson, arriving Friday, two nights&rdquo;
          — the agent fills the whole wizard.
        </p>
      </div>
    </div>
  );

  // ── Render — fixed-inset overlay so the wizard floats over the page ──
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
        eyebrow="New reservation"
        title={STEP_TITLES[stepIdx]}
        subtitle={STEP_SUBTITLES[stepIdx]}
        steps={STEPS}
        currentIdx={stepIdx}
        onStepClick={(idx) => idx < stepIdx && setStepIdx(idx)}
        rightRail={rightRail}
        chrome="modal"
        onExit={close}
      >
            {/* Step 0 — Holder */}
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

                {/* Assigned slip pre-fill — one-click forward to step 1. */}
                {selectedBoater && suggestedSlip && (
                  <div className="rounded-[10px] border border-primary/30 bg-primary-soft/30 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] uppercase tracking-wide text-primary">
                          Assigned slip on file
                        </div>
                        <div className="mt-0.5 text-[13px] font-medium text-fg">
                          {suggestedSlip.number} · {suggestedSlip.dock}
                        </div>
                        <p className="mt-0.5 text-[11px] text-fg-subtle">
                          {selectedBoater.first_name} holds an active contract on this slip.
                          Use it as the default for this reservation.
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setDraft((d) => ({ ...d, slipId: suggestedSlip.id }));
                          setStepIdx(1);
                        }}
                      >
                        Use this slip
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 1 — Slip + dates */}
            {stepIdx === 1 && (
              <div className="space-y-4">
                <FieldLabel
                  label="Slip"
                  hint={
                    draft.arrival && draft.departure
                      ? `Showing slips with no conflict between ${draft.arrival} and ${draft.departure}.`
                      : "Pick a slip from the marina."
                  }
                  required
                >
                  <Combobox
                    value={draft.slipId}
                    onChange={(v) => setDraft((d) => ({ ...d, slipId: v }))}
                    options={availableSlips.map((s) => ({
                      value: s.id,
                      label: `${s.number} · ${s.dock}`,
                      hint: `· ${s.slip_class.replace("_", " ")}`,
                    }))}
                    placeholder="Pick a slip…"
                    searchPlaceholder="Search by slip # or dock…"
                  />
                </FieldLabel>

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
                {draft.arrival && draft.departure && draft.arrival > draft.departure && (
                  <p className="text-[12px] text-status-danger">
                    Departure must be on or after arrival.
                  </p>
                )}

                <FieldLabel
                  label="Reservation type"
                  hint="Transient = nightly walk-in. Annual / seasonal / monthly usually flow from a contract."
                >
                  <div className="grid gap-2 sm:grid-cols-5">
                    {(
                      [
                        "transient",
                        "monthly",
                        "seasonal",
                        "annual",
                        "recurring",
                      ] as ReservationType[]
                    ).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() =>
                          setDraft((d) => ({ ...d, type: t }))
                        }
                        className={cn(
                          "rounded-[10px] border px-3 py-2 text-center text-[12px] font-medium capitalize transition-colors",
                          draft.type === t
                            ? "border-primary bg-primary-soft/40 text-primary"
                            : "border-hairline bg-surface-1 text-fg-subtle hover:bg-surface-2"
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </FieldLabel>
              </div>
            )}

            {/* Step 2 — Vessel */}
            {stepIdx === 2 && (
              <div className="space-y-4">
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
                      placeholder={selectedBoater ? "No vessel" : "Pick a member first"}
                      searchPlaceholder="Search vessels…"
                      disabled={!selectedBoater}
                      onCreateNew={
                        selectedBoater ? () => setNewVesselOpen(true) : undefined
                      }
                      createNewLabel="Add a new vessel"
                    />
                  )}
                </FieldLabel>
                <p className="text-[11px] text-fg-tertiary">
                  Skip this step if the boater hasn&rsquo;t arrived yet — you can attach
                  the vessel from the reservation detail page later.
                </p>
              </div>
            )}

            {/* Step 3 — Services (rate display + add-on fees) */}
            {stepIdx === 3 && (
              <div className="space-y-4">
                {/* Slip rate — read-only, sourced from Services → Rates */}
                {selectedSlip && rate.amount > 0 && (
                  <div className="rounded-[10px] border border-hairline bg-surface-2 px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[12px] text-fg-subtle">{rate.label}</span>
                      <span className="money-display text-[22px] text-fg">
                        {formatMoney(rate.amount)}
                        <span className="ml-1 text-[12px] font-normal text-fg-tertiary">
                          {rate.per}
                        </span>
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-fg-tertiary">
                      From Services &rarr; Rates. Update the rate there to change it for
                      all new reservations on this slip class.
                    </p>
                  </div>
                )}

                <FieldLabel
                  label="Additional services"
                  hint={
                    isShortTransient
                      ? "One-time fees only — monthly / annual add-ons skipped for short transient stays."
                      : "Optional — billed alongside the stay. Grouped by billing cadence."
                  }
                >
                  {reservationFees.length === 0 ? (
                    <div className="rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 p-6 text-center text-[13px] text-fg-subtle">
                      No additional fees configured for reservations. Add some in{" "}
                      <strong>Services &rarr; Fees</strong>.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {(
                        [
                          { key: "one_time", title: "One-time", suffix: "" },
                          { key: "monthly", title: "Monthly", suffix: "/mo" },
                          { key: "annual", title: "Annual", suffix: "/yr" },
                        ] as const
                      ).map((group) => {
                        const groupFees = feesByCadence[group.key];
                        if (groupFees.length === 0) return null;
                        // Hide monthly + annual sections entirely on short
                        // transient stays — keeps the UI honest about what
                        // will actually post.
                        if (isShortTransient && group.key !== "one_time") {
                          return null;
                        }
                        return (
                          <div key={group.key}>
                            <div className="mb-1.5 flex items-baseline justify-between">
                              <h4 className="text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
                                {group.title}
                              </h4>
                              <span className="text-[10px] text-fg-tertiary">
                                {groupFees.length} option
                                {groupFees.length === 1 ? "" : "s"}
                              </span>
                            </div>
                            <ul className="space-y-1.5">
                              {groupFees.map((f) => {
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
                                                (x) => x !== f.id,
                                              )
                                            : [...d.selectedFeeIds, f.id],
                                        }))
                                      }
                                      className={cn(
                                        "flex w-full items-start justify-between gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors",
                                        checked
                                          ? "border-primary bg-primary-soft/40"
                                          : "border-hairline bg-surface-1 hover:bg-surface-2",
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
                                          {group.suffix && (
                                            <span className="ml-0.5 text-[10px] font-normal text-fg-tertiary">
                                              {group.suffix}
                                            </span>
                                          )}
                                        </span>
                                        <span
                                          className={cn(
                                            "flex size-5 items-center justify-center rounded-full border",
                                            checked
                                              ? "border-primary bg-primary text-on-primary"
                                              : "border-hairline-strong",
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

                {/* Inline cadence roll-up under the chips */}
                {selectedFees.length > 0 && (
                  <div className="rounded-[10px] border border-hairline bg-surface-2 px-4 py-3 text-[12px] text-fg-subtle">
                    <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
                      Service charges
                    </div>
                    <div className="mt-1 text-[13px] text-fg">
                      {[
                        feeRollup.oneTime > 0
                          ? `${formatMoney(feeRollup.oneTime)} one-time`
                          : null,
                        feeRollup.monthly > 0
                          ? `${formatMoney(feeRollup.monthly / Math.max(1, termMonths))}/month`
                          : null,
                        feeRollup.annual > 0
                          ? `${formatMoney((feeRollup.annual / Math.max(1, termMonths)) * 12)}/year`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" + ")}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 4 — Review */}
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
                <ReviewBlock
                  label="Slip"
                  value={
                    selectedSlip
                      ? `${selectedSlip.number} · ${selectedSlip.dock} (${selectedSlip.slip_class.replace("_", " ")})`
                      : "—"
                  }
                  onEdit={() => setStepIdx(1)}
                />
                <ReviewBlock
                  label="Dates"
                  value={`${draft.arrival} → ${draft.departure}${
                    nights > 0 ? ` · ${nights} night${nights === 1 ? "" : "s"}` : ""
                  }`}
                  onEdit={() => setStepIdx(1)}
                />
                <ReviewBlock
                  label="Type"
                  value={draft.type}
                  capitalize
                  onEdit={() => setStepIdx(1)}
                />
                {draft.vesselId && (
                  <ReviewBlock
                    label="Vessel"
                    value={selectedVessel?.name ?? "—"}
                    onEdit={() => setStepIdx(2)}
                  />
                )}
                {selectedFees.length > 0 && (
                  <ReviewBlock
                    label="Services"
                    value={selectedFees
                      .map((f) => {
                        const cadence = f.cadence ?? "one_time";
                        const suffix =
                          cadence === "monthly"
                            ? "/mo"
                            : cadence === "annual"
                              ? "/yr"
                              : "";
                        return `${f.name} (${formatMoney(f.amount)}${suffix})`;
                      })
                      .join(", ")}
                    onEdit={() => setStepIdx(3)}
                  />
                )}
                {selectedSlip && rate.amount > 0 && (
                  <ReviewBlock
                    label="Estimated total"
                    value={`${formatMoney(estimatedTotal)} (directional — final at check-in)`}
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
                stepIdx === STEPS.length - 1 ? "Create reservation" : "Continue"
              }
              continueDisabled={!canContinue}
              busy={submitting}
              onExit={close}
              busyLabel="Creating…"
            />
      </WizardShell>
    </>
  );
}

