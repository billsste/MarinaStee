"use client";

import * as React from "react";
import { Anchor, Sailboat, Sparkles, Ticket } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { MultiCombobox } from "@/components/ui/multi-combobox";
import { Field, TextInput } from "@/components/create-sheet";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardFooter } from "@/components/wizard/wizard-footer";
import type { WizardStep } from "@/components/wizard/wizard-progress";
import {
  FieldLabel,
  ReviewBlock,
} from "@/components/wizard/wizard-fields";
import { useWizardDraft } from "@/components/wizard/use-wizard-draft";
import { executeAgentAction } from "@/lib/agent-actions";
import {
  addBoatRental,
  addCommunication,
  effectivePlanFor,
  mintBookingPickupToken,
  nextBoatRentalId,
  nextBoatRentalNumber,
  nextClubBookingId,
  upsertClubBooking,
  useBoaters,
  useBoatRentals,
  useClubBookings,
  useClubSubscriptions,
  useFeesForEntity,
  useRentalBoats,
  useReservations,
  useSlips,
} from "@/lib/client-store";
import { formatMoney } from "@/lib/mock-data";
import type {
  BoatRental,
  BoatRentalRateKind,
  Communication,
  ReservationType,
} from "@/lib/types";
import { cn, formatPhoneInput } from "@/lib/utils";

/*
 * NewBookingWizard — a single modal that lets the operator create a
 * slip reservation, a boat rental, or a club booking. The type toggle
 * lives on step 0; subsequent steps branch on it. Everything lives in
 * one popup — there is no /boat-rentals/book redirect anymore.
 *
 * Steps (5):
 *   0. Type        — three big cards. Picking one sets draft.type and
 *                    auto-advances.
 *   1. Who         — boater / walk-in / subscription picker, branched
 *                    by type.
 *   2. What+When   — resource + dates, branched by type.
 *   3. Pricing     — type-specific pricing surface.
 *   4. Review      — summary + Create booking.
 *
 * Submit branches:
 *   - slip   → executeAgentAction({ kind: "create_reservation", ... })
 *   - rental → addBoatRental + mintBookingPickupToken + addCommunication
 *              (mirrors components/.../book-rental-client.tsx exactly so
 *              the pickup chain still fires; agent-action variant is
 *              available for chat-driven flows but the in-app wizard
 *              keeps the richer side-effect chain.)
 *   - club   → upsertClubBooking (mirrors new-club-booking-sheet.tsx)
 */

type BookingType = "slip" | "rental" | "club";

const STORAGE_KEY = "new-booking-wizard:v1";

const STEPS: WizardStep[] = [
  { id: "type", label: "Type" },
  { id: "who", label: "Who" },
  { id: "what", label: "What + when" },
  { id: "pricing", label: "Pricing" },
  { id: "review", label: "Review" },
];

const STEP_TITLES = [
  "What kind of booking is this?",
  "Who's it for?",
  "What and when?",
  "Pricing",
  "Review and create",
];

const STEP_SUBTITLES = [
  "Pick the bucket — slip reservation, boat rental, or club booking. The rest of the wizard branches from here.",
  "Most types want an existing record. Walk-in is the default for one-off rentals.",
  "Pick the resource and the window. We filter the list to what's actually available for the dates you picked.",
  "Snapshot of what will be billed. You can edit anything later from the booking detail page.",
  "Confirm the details — clicking Create books it and fires any pickup / confirmation messages.",
];

type CustomerKind = "holder" | "walk_in";

type DraftState = {
  // Step 0
  type: BookingType | "";
  // Step 1 — slip
  slipBoaterId: string;
  // Step 1 — rental
  rentalCustomerKind: CustomerKind;
  rentalBoaterId: string;
  rentalWalkInName: string;
  rentalWalkInPhone: string;
  rentalWalkInEmail: string;
  // Step 1 — club
  subscriptionId: string;
  // Step 2 — slip
  slipId: string;
  slipArrival: string;        // YYYY-MM-DD
  slipDeparture: string;      // YYYY-MM-DD
  slipReservationType: ReservationType;
  // Step 2 — rental
  rentalBoatId: string;
  rentalStartAt: string;      // datetime-local "YYYY-MM-DDTHH:mm"
  rentalEndAt: string;
  // Step 2 — club
  clubRentalBoatId: string;
  clubDate: string;           // YYYY-MM-DD
  // Step 3 — slip
  slipNotes: string;
  // Step 3 — rental
  rentalRateKind: BoatRentalRateKind;
  // Step 3 — club
  clubAttachedFeeIds: string[];
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function tomorrowIso(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}
function toLocalInput(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
function parseLocalInput(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function formatLocalTime(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function NewBookingWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
}) {
  // ── Live data ────────────────────────────────────────────────────────
  const boaters = useBoaters();
  const slips = useSlips();
  const reservations = useReservations();
  const rentalBoats = useRentalBoats();
  const boatRentals = useBoatRentals();
  const subscriptions = useClubSubscriptions();
  const clubBookings = useClubBookings();
  const clubFees = useFeesForEntity("club_subscription");
  const oneTimeClubFees = React.useMemo(
    () => clubFees.filter((f) => (f.cadence ?? "one_time") === "one_time"),
    [clubFees]
  );

  const [submitting, setSubmitting] = React.useState(false);

  // ── Persisted draft ──────────────────────────────────────────────────
  const [persisted, setPersisted, clearPersisted] = useWizardDraft<{
    step: number;
    draft: DraftState;
  }>(STORAGE_KEY, () => {
    const now = new Date();
    now.setHours(10, 0, 0, 0);
    const startLocal = toLocalInput(now);
    const endLocal = toLocalInput(new Date(now.getTime() + 4 * 3_600_000));
    return {
      step: 0,
      draft: {
        type: "",
        slipBoaterId: "",
        rentalCustomerKind: "walk_in",
        rentalBoaterId: "",
        rentalWalkInName: "",
        rentalWalkInPhone: "",
        rentalWalkInEmail: "",
        subscriptionId: "",
        slipId: "",
        slipArrival: todayIso(),
        slipDeparture: tomorrowIso(),
        slipReservationType: "transient",
        rentalBoatId: "",
        rentalStartAt: startLocal,
        rentalEndAt: endLocal,
        clubRentalBoatId: "",
        clubDate: todayIso(),
        slipNotes: "",
        rentalRateKind: "hourly",
        clubAttachedFeeIds: [],
      },
    };
  });

  const stepIdx = persisted.step;
  const draft = persisted.draft;

  // setStepIdx / setDraft short-circuit on no-op updates so any effect
  // that calls setDraft from a derived render doesn't infinite-loop.
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

  // ── Derived: slip vacancy filter ─────────────────────────────────────
  const availableSlips = React.useMemo(() => {
    if (draft.type !== "slip") return slips;
    const arrival = draft.slipArrival;
    const departure = draft.slipDeparture;
    if (!arrival || !departure) return slips;
    return slips.filter((s) => {
      if (s.id === draft.slipId) return true;
      const overlap = reservations.some(
        (r) =>
          r.slip_id === s.id &&
          r.status !== "cancelled" &&
          // inclusive overlap on ISO YYYY-MM-DD strings (lexical compare)
          r.arrival_date <= departure &&
          arrival <= r.departure_date
      );
      return !overlap;
    });
  }, [slips, reservations, draft.type, draft.slipArrival, draft.slipDeparture, draft.slipId]);

  // ── Derived: rental fleet (active, not in maintenance/off-season) ───
  const rentalFleet = React.useMemo(
    () =>
      rentalBoats.filter(
        (b) => b.active && b.status !== "maintenance" && b.status !== "off_season"
      ),
    [rentalBoats]
  );

  // ── Derived: club fleet — filter to available_for_club AND not double-booked
  const clubFleet = React.useMemo(() => {
    const date = draft.clubDate;
    return rentalBoats.filter((b) => {
      if (b.available_for_club === false) return false;
      // Conflict — another non-cancelled club booking, or an overlapping
      // boat rental, on the chosen date.
      const conflictClub = clubBookings.some(
        (cb) =>
          cb.rental_boat_id === b.id &&
          cb.date === date &&
          cb.status !== "cancelled"
      );
      if (conflictClub) return b.id === draft.clubRentalBoatId; // keep selection visible
      const conflictRental = boatRentals.some(
        (r) =>
          r.boat_id === b.id &&
          r.status !== "cancelled" &&
          r.status !== "closed" &&
          (r.start_at?.slice(0, 10) ?? "") <= date &&
          (r.end_at?.slice(0, 10) ?? date) >= date
      );
      if (conflictRental) return b.id === draft.clubRentalBoatId;
      return true;
    });
  }, [rentalBoats, clubBookings, boatRentals, draft.clubDate, draft.clubRentalBoatId]);

  // ── Derived: active/paused subscriptions only ───────────────────────
  const eligibleSubs = React.useMemo(
    () => subscriptions.filter((s) => s.status === "active" || s.status === "paused"),
    [subscriptions]
  );

  // ── Derived: selected entities ──────────────────────────────────────
  const selectedSlipBoater = boaters.find((b) => b.id === draft.slipBoaterId);
  const selectedRentalBoater = boaters.find((b) => b.id === draft.rentalBoaterId);
  const selectedSlip = slips.find((s) => s.id === draft.slipId);
  const selectedRentalBoat = rentalFleet.find((b) => b.id === draft.rentalBoatId);
  const selectedClubBoat = rentalBoats.find((b) => b.id === draft.clubRentalBoatId);
  const selectedSub = eligibleSubs.find((s) => s.id === draft.subscriptionId);
  const selectedSubPlan = selectedSub ? effectivePlanFor(selectedSub) : null;
  const selectedSubBoater = selectedSub
    ? boaters.find((b) => b.id === selectedSub.boater_id)
    : undefined;

  // Rental: duration + base price by rate kind
  const rentalStartDate = parseLocalInput(draft.rentalStartAt);
  const rentalEndDate = parseLocalInput(draft.rentalEndAt);
  const rentalDurationHours =
    rentalStartDate && rentalEndDate
      ? Math.max(
          1,
          Math.round((rentalEndDate.getTime() - rentalStartDate.getTime()) / 3_600_000)
        )
      : 0;
  const rentalBaseAmount = React.useMemo(() => {
    if (!selectedRentalBoat) return 0;
    if (draft.rentalRateKind === "full_day") return selectedRentalBoat.full_day_rate ?? 0;
    if (draft.rentalRateKind === "half_day") return selectedRentalBoat.half_day_rate ?? 0;
    return (selectedRentalBoat.hourly_rate ?? 0) * rentalDurationHours;
  }, [selectedRentalBoat, draft.rentalRateKind, rentalDurationHours]);

  // Slip pricing — read-only snapshot of monthly rate (fallback to annual/12)
  const slipMonthlyRate = React.useMemo(() => {
    if (!selectedSlip) return 0;
    return (
      selectedSlip.default_monthly_rate ??
      Math.round(selectedSlip.default_annual_rate / 12)
    );
  }, [selectedSlip]);

  // ── Validation gates ────────────────────────────────────────────────
  const canStep0 = draft.type !== "";
  const canStep1 = (() => {
    if (draft.type === "slip") return draft.slipBoaterId.length > 0;
    if (draft.type === "rental") {
      if (draft.rentalCustomerKind === "holder") return draft.rentalBoaterId.length > 0;
      return (
        draft.rentalWalkInName.trim().length > 0 &&
        (draft.rentalWalkInEmail.trim().length > 0 ||
          draft.rentalWalkInPhone.trim().length > 0)
      );
    }
    if (draft.type === "club") return draft.subscriptionId.length > 0;
    return false;
  })();
  const canStep2 = (() => {
    if (draft.type === "slip") {
      return (
        draft.slipId.length > 0 &&
        draft.slipArrival.length > 0 &&
        draft.slipDeparture.length > 0 &&
        draft.slipArrival <= draft.slipDeparture
      );
    }
    if (draft.type === "rental") {
      return (
        draft.rentalBoatId.length > 0 &&
        !!rentalStartDate &&
        !!rentalEndDate &&
        rentalEndDate > rentalStartDate
      );
    }
    if (draft.type === "club") {
      return draft.clubRentalBoatId.length > 0 && draft.clubDate.length > 0;
    }
    return false;
  })();
  const canStep3 = (() => {
    if (draft.type === "rental") return rentalBaseAmount > 0;
    return true; // slip + club don't require step-3 inputs
  })();
  const canStep4 = canStep0 && canStep1 && canStep2 && canStep3;
  const canContinue = [canStep0, canStep1, canStep2, canStep3, canStep4][stepIdx];

  // ── Actions ──────────────────────────────────────────────────────────
  function pickType(t: BookingType) {
    // Set type + auto-advance to Who.
    setDraft((d) => (d.type === t ? d : { ...d, type: t }));
    setStepIdx(1);
  }
  function next() {
    if (stepIdx < STEPS.length - 1) setStepIdx((i) => i + 1);
  }
  function back() {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  }
  function close() {
    clearPersisted();
    onOpenChange(false);
  }

  function submitSlip(): boolean {
    executeAgentAction({
      kind: "create_reservation",
      label: "",
      boater_id: draft.slipBoaterId,
      slip_id: draft.slipId,
      arrival_date: draft.slipArrival,
      departure_date: draft.slipDeparture,
      type: draft.slipReservationType,
    });
    return true;
  }

  function submitRental(): boolean {
    if (!selectedRentalBoat || !rentalStartDate || !rentalEndDate) return false;
    const id = nextBoatRentalId();
    const number = nextBoatRentalNumber();
    const now = new Date().toISOString();
    const booking: BoatRental = {
      id,
      number,
      boat_id: selectedRentalBoat.id,
      boater_id:
        draft.rentalCustomerKind === "holder" ? draft.rentalBoaterId : undefined,
      patron_name:
        draft.rentalCustomerKind === "walk_in"
          ? draft.rentalWalkInName.trim()
          : undefined,
      patron_email:
        draft.rentalCustomerKind === "walk_in" && draft.rentalWalkInEmail
          ? draft.rentalWalkInEmail.trim()
          : undefined,
      patron_phone:
        draft.rentalCustomerKind === "walk_in" && draft.rentalWalkInPhone
          ? draft.rentalWalkInPhone.trim()
          : undefined,
      start_at: rentalStartDate.toISOString(),
      end_at: rentalEndDate.toISOString(),
      rate_kind: draft.rentalRateKind,
      base_amount: rentalBaseAmount,
      deposit_hold: selectedRentalBoat.deposit_amount,
      status: "reserved",
      checkin: {},
      created_at: now,
      updated_at: now,
    };
    addBoatRental(booking);

    // Mint pickup token + dispatch the pickup comm — mirrors the existing
    // /boat-rentals/book chain so the wizard parity is preserved.
    const token = mintBookingPickupToken(id);
    if (token) {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const pickupUrl = `${origin}/pickup/${token}`;

      let commType: Communication["type"] = "email";
      let recipient = "";
      let displayFirst = "";
      if (selectedRentalBoater) {
        commType = selectedRentalBoater.communication_prefs.preferred_channel;
        recipient =
          commType === "email"
            ? selectedRentalBoater.primary_contact.email ?? ""
            : selectedRentalBoater.primary_contact.phone ?? "";
        displayFirst = selectedRentalBoater.first_name;
      } else {
        if (draft.rentalWalkInEmail) {
          commType = "email";
          recipient = draft.rentalWalkInEmail.trim();
        } else if (draft.rentalWalkInPhone) {
          commType = "sms";
          recipient = draft.rentalWalkInPhone.trim();
        }
        displayFirst =
          draft.rentalWalkInName.trim().split(/\s+/)[0] ?? "there";
      }

      addCommunication({
        id: `cm_pickup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        boater_id: selectedRentalBoater
          ? selectedRentalBoater.id
          : `walk_in:${id}`,
        type: commType,
        direction: "outbound",
        sender_label: "Marina Stee",
        sender_is_system: true,
        recipient,
        subject: `Your ${selectedRentalBoat.name} rental — complete pickup`,
        body_preview: `Sign the rental agreement + put a card on file: ${pickupUrl}`,
        full_body:
          `Hi ${displayFirst},\n\n` +
          `Your ${selectedRentalBoat.name} rental is booked for ` +
          `${formatLocalTime(rentalStartDate)} → ${formatLocalTime(rentalEndDate)}. ` +
          `Please take 90 seconds to:\n\n` +
          `  1. Sign the rental agreement + damage waiver\n` +
          `  2. Add a card for your $${selectedRentalBoat.deposit_amount} refundable deposit hold\n\n` +
          `${pickupUrl}\n\n` +
          `Marina Stee`,
        sent_at: now,
        status: "delivered",
        related_entity: { type: "work_order", id },
      });
    }
    return true;
  }

  function submitClub(): boolean {
    if (!selectedSub) return false;
    upsertClubBooking({
      id: nextClubBookingId(),
      subscription_id: selectedSub.id,
      boater_id: selectedSub.boater_id,
      rental_boat_id: draft.clubRentalBoatId,
      date: draft.clubDate,
      status: "confirmed",
      attached_fee_ids:
        draft.clubAttachedFeeIds.length > 0
          ? draft.clubAttachedFeeIds
          : undefined,
      created_at: new Date().toISOString(),
    });
    return true;
  }

  function submit() {
    if (!canStep4) return;
    setSubmitting(true);
    try {
      // Each per-type submitter returns false when its guard fails
      // (e.g. the subscription was cancelled or the boat hit
      // maintenance between Review render and Create click). Gate
      // clearPersisted + close on success so we never silently swallow
      // a no-op and lose the operator's in-flight draft.
      let ok = false;
      if (draft.type === "slip") ok = submitSlip();
      else if (draft.type === "rental") ok = submitRental();
      else if (draft.type === "club") ok = submitClub();
      if (!ok) {
        window.alert(
          "Could not create this booking — the underlying record (subscription, boat, or slot) may have changed since you opened the wizard. Reload the page and try again.",
        );
        return;
      }
      clearPersisted();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  // ── Step 0 — Type picker ─────────────────────────────────────────────
  const typeCards: {
    key: BookingType;
    title: string;
    blurb: string;
    icon: React.ReactNode;
  }[] = [
    {
      key: "slip",
      title: "Slip reservation",
      blurb: "Transient / monthly / seasonal stay at a dock slip.",
      icon: <Anchor className="size-5" />,
    },
    {
      key: "rental",
      title: "Boat rental",
      blurb: "Walk-in or member renting from the fleet.",
      icon: <Sailboat className="size-5" />,
    },
    {
      key: "club",
      title: "Club booking",
      blurb: "Existing Rental Club member redeeming a day.",
      icon: <Ticket className="size-5" />,
    },
  ];

  return (
    <WizardShell
      eyebrow="New booking"
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
      {/* Step 0 — Type */}
      {stepIdx === 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {typeCards.map((c) => {
            const selected = draft.type === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => pickType(c.key)}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-[12px] border px-4 py-4 text-left transition-colors",
                  selected
                    ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
                    : "border-hairline bg-surface-1 hover:border-hairline-strong hover:bg-surface-2"
                )}
              >
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full",
                    selected
                      ? "bg-primary text-on-primary"
                      : "bg-surface-3 text-fg-subtle"
                  )}
                >
                  {c.icon}
                </span>
                <span className="text-[14px] font-semibold text-fg">
                  {c.title}
                </span>
                <span className="text-[12px] text-fg-subtle">{c.blurb}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Step 1 — Who (branched) */}
      {stepIdx === 1 && draft.type === "slip" && (
        <div className="space-y-4">
          <FieldLabel
            label="Holder"
            hint="Search by name or code. Reservations always attach to a known boater."
            required
          >
            <Combobox
              value={draft.slipBoaterId}
              onChange={(v) => setDraft((d) => ({ ...d, slipBoaterId: v }))}
              options={boaters.map((b) => ({
                value: b.id,
                label: b.display_name,
                hint: b.code ? `· ${b.code}` : undefined,
              }))}
              placeholder="Pick a holder…"
              searchPlaceholder="Search by name, code…"
            />
          </FieldLabel>
          {selectedSlipBoater && (
            <div className="rounded-[10px] border border-hairline bg-surface-2 p-4">
              <div className="text-[13px] font-medium text-fg">
                {selectedSlipBoater.display_name}
              </div>
              <div className="mt-1 text-[12px] text-fg-subtle">
                {selectedSlipBoater.primary_contact?.email || "no email"} ·{" "}
                {selectedSlipBoater.primary_contact?.phone || "no phone"}
              </div>
            </div>
          )}
        </div>
      )}

      {stepIdx === 1 && draft.type === "rental" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <ToggleCard
              active={draft.rentalCustomerKind === "walk_in"}
              onClick={() =>
                setDraft((d) => ({ ...d, rentalCustomerKind: "walk_in" }))
              }
              title="Walk-in customer"
              blurb="One-off rental — captures name + contact."
            />
            <ToggleCard
              active={draft.rentalCustomerKind === "holder"}
              onClick={() =>
                setDraft((d) => ({ ...d, rentalCustomerKind: "holder" }))
              }
              title="Existing member"
              blurb="Charge against their account on file."
            />
          </div>

          {draft.rentalCustomerKind === "holder" ? (
            <FieldLabel
              label="Member"
              hint="The rental will charge against the member's house account."
              required
            >
              <Combobox
                value={draft.rentalBoaterId}
                onChange={(v) => setDraft((d) => ({ ...d, rentalBoaterId: v }))}
                options={boaters.map((b) => ({
                  value: b.id,
                  label: b.display_name,
                  hint: b.code ? `· ${b.code}` : undefined,
                }))}
                placeholder="Pick a member…"
                searchPlaceholder="Search by name, code…"
              />
            </FieldLabel>
          ) : (
            <div className="space-y-3">
              <Field label="Customer name" required>
                <TextInput
                  value={draft.rentalWalkInName}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      rentalWalkInName: e.target.value,
                    }))
                  }
                  placeholder="Full name on ID"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone">
                  <TextInput
                    type="tel"
                    inputMode="tel"
                    value={draft.rentalWalkInPhone}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        rentalWalkInPhone: formatPhoneInput(e.target.value),
                      }))
                    }
                    placeholder="(231) 555-0123"
                  />
                </Field>
                <Field label="Email">
                  <TextInput
                    type="email"
                    value={draft.rentalWalkInEmail}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        rentalWalkInEmail: e.target.value,
                      }))
                    }
                    placeholder="customer@example.com"
                  />
                </Field>
              </div>
              <p className="text-[11px] text-fg-tertiary">
                At least one of email or phone is required — we use it to
                send the pickup link.
              </p>
            </div>
          )}
        </div>
      )}

      {stepIdx === 1 && draft.type === "club" && (
        <div className="space-y-4">
          {eligibleSubs.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 p-6 text-center text-[13px] text-fg-subtle">
              No active or paused club memberships yet. Add one from{" "}
              <strong>Members &rarr; Rental Club</strong>.
            </div>
          ) : (
            <FieldLabel
              label="Member"
              hint="Only active and paused memberships can book."
              required
            >
              <Combobox
                value={draft.subscriptionId}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, subscriptionId: v }))
                }
                options={eligibleSubs.map((s) => {
                  const plan = effectivePlanFor(s);
                  const member = boaters.find((b) => b.id === s.boater_id);
                  return {
                    value: s.id,
                    label: member?.display_name ?? s.boater_id,
                    hint: plan?.plan_tier
                      ? `· ${plan.plan_tier}`
                      : plan?.plan_name
                        ? `· ${plan.plan_name}`
                        : undefined,
                  };
                })}
                placeholder="Pick a member…"
                searchPlaceholder="Search by name…"
              />
            </FieldLabel>
          )}

          {selectedSub && selectedSubBoater && selectedSubPlan && (
            <div className="rounded-[10px] border border-hairline bg-surface-2 p-4">
              <div className="text-[13px] font-medium text-fg">
                {selectedSubBoater.display_name}
              </div>
              <div className="mt-1 text-[12px] text-fg-subtle">
                {selectedSubPlan.plan_tier ?? "Plan"} ·{" "}
                {selectedSubPlan.days_per_month != null
                  ? `${selectedSubPlan.days_per_month} days/mo`
                  : "unlimited"}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2 — What + when (branched) */}
      {stepIdx === 2 && draft.type === "slip" && (
        <div className="space-y-4">
          <FieldLabel
            label="Slip"
            hint={
              draft.slipArrival && draft.slipDeparture
                ? `Showing slips with no conflict between ${draft.slipArrival} and ${draft.slipDeparture}.`
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
                value={draft.slipArrival}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, slipArrival: e.target.value }))
                }
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
              />
            </FieldLabel>
            <FieldLabel label="Departure" required>
              <input
                type="date"
                value={draft.slipDeparture}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, slipDeparture: e.target.value }))
                }
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
              />
            </FieldLabel>
          </div>
          {draft.slipArrival &&
            draft.slipDeparture &&
            draft.slipArrival > draft.slipDeparture && (
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
                    setDraft((d) => ({ ...d, slipReservationType: t }))
                  }
                  className={cn(
                    "rounded-[10px] border px-3 py-2 text-center text-[12px] font-medium capitalize transition-colors",
                    draft.slipReservationType === t
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

      {stepIdx === 2 && draft.type === "rental" && (
        <div className="space-y-4">
          <FieldLabel
            label="Boat"
            hint="Maintenance + off-season boats are hidden."
            required
          >
            <Combobox
              value={draft.rentalBoatId}
              onChange={(v) => {
                const nextBoat = rentalFleet.find((b) => b.id === v);
                const nextRateKind: BoatRentalRateKind = nextBoat?.hourly_rate
                  ? "hourly"
                  : nextBoat?.half_day_rate
                    ? "half_day"
                    : "full_day";
                setDraft((d) => ({
                  ...d,
                  rentalBoatId: v,
                  rentalRateKind: nextRateKind,
                }));
              }}
              options={rentalFleet.map((b) => ({
                value: b.id,
                label: b.name,
                hint: `· ${b.type.replace("_", " ")} · seats ${b.capacity}`,
              }))}
              placeholder="Pick a boat…"
              searchPlaceholder="Search boats…"
            />
          </FieldLabel>

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="Pickup" required>
              <input
                type="datetime-local"
                value={draft.rentalStartAt}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, rentalStartAt: e.target.value }))
                }
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
              />
            </FieldLabel>
            <FieldLabel label="Return" required>
              <input
                type="datetime-local"
                value={draft.rentalEndAt}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, rentalEndAt: e.target.value }))
                }
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
              />
            </FieldLabel>
          </div>
          {rentalStartDate && rentalEndDate && rentalEndDate <= rentalStartDate && (
            <p className="text-[12px] text-status-danger">
              Return must be after pickup.
            </p>
          )}
          {selectedRentalBoat && rentalDurationHours > 0 && (
            <p className="text-[11px] text-fg-tertiary">
              {rentalDurationHours}h block on {selectedRentalBoat.name}.
            </p>
          )}
        </div>
      )}

      {stepIdx === 2 && draft.type === "club" && (
        <div className="space-y-4">
          <FieldLabel label="Date" required>
            <input
              type="date"
              value={draft.clubDate}
              onChange={(e) =>
                setDraft((d) => ({ ...d, clubDate: e.target.value }))
              }
              min={todayIso()}
              className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
            />
          </FieldLabel>

          <FieldLabel
            label="Boat"
            hint="Filtered to club-eligible boats with no conflicting booking on the chosen date."
            required
          >
            {clubFleet.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 p-6 text-center text-[13px] text-fg-subtle">
                No club-eligible boats are free on {draft.clubDate}. Try another date.
              </div>
            ) : (
              <Combobox
                value={draft.clubRentalBoatId}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, clubRentalBoatId: v }))
                }
                options={clubFleet.map((b) => ({
                  value: b.id,
                  label: b.name,
                  hint: `· ${b.type.replace("_", " ")} · seats ${b.capacity}`,
                }))}
                placeholder="Pick a boat…"
                searchPlaceholder="Search boats…"
              />
            )}
          </FieldLabel>
        </div>
      )}

      {/* Step 3 — Pricing (branched) */}
      {stepIdx === 3 && draft.type === "slip" && (
        <div className="space-y-4">
          {selectedSlip ? (
            <div className="rounded-[10px] border border-hairline bg-surface-2 px-4 py-3">
              <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
                Default monthly rate
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-fg">
                  {selectedSlip.number} · {selectedSlip.dock}
                </span>
                <span className="money-display text-[22px] text-fg">
                  {formatMoney(slipMonthlyRate)}
                  <span className="ml-1 text-[12px] font-normal text-fg-tertiary">
                    / month
                  </span>
                </span>
              </div>
              <p className="mt-1 text-[11px] text-fg-tertiary">
                Snapshot of the slip&rsquo;s catalog rate. Final amount depends
                on reservation type and posts at check-in.
              </p>
            </div>
          ) : (
            <p className="text-[12px] text-fg-tertiary">
              Pick a slip on the previous step to preview the rate.
            </p>
          )}

          <FieldLabel
            label="Notes"
            hint="Internal context — special arrangements, comp notes, anything staff should see on the reservation."
          >
            <textarea
              rows={3}
              value={draft.slipNotes}
              onChange={(e) =>
                setDraft((d) => ({ ...d, slipNotes: e.target.value }))
              }
              placeholder="e.g. Pier-side, easy walkway access requested."
              className="block w-full resize-y rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[14px] leading-5 text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
            />
          </FieldLabel>
        </div>
      )}

      {stepIdx === 3 && draft.type === "rental" && selectedRentalBoat && (
        <div className="space-y-4">
          <FieldLabel
            label="Rate"
            hint="Picking a rate changes the base amount. Hourly is multiplied by your time window."
            required
          >
            <div className="grid gap-2 sm:grid-cols-3">
              {selectedRentalBoat.hourly_rate != null && (
                <RateCard
                  label="Hourly"
                  amount={selectedRentalBoat.hourly_rate}
                  per="/ hr"
                  total={`${formatMoney(
                    selectedRentalBoat.hourly_rate * Math.max(1, rentalDurationHours)
                  )} · ${Math.max(1, rentalDurationHours)}h`}
                  selected={draft.rentalRateKind === "hourly"}
                  onClick={() =>
                    setDraft((d) => ({ ...d, rentalRateKind: "hourly" }))
                  }
                />
              )}
              {selectedRentalBoat.half_day_rate != null && (
                <RateCard
                  label="Half day"
                  amount={selectedRentalBoat.half_day_rate}
                  per="flat"
                  total="4-hour block"
                  selected={draft.rentalRateKind === "half_day"}
                  onClick={() =>
                    setDraft((d) => ({ ...d, rentalRateKind: "half_day" }))
                  }
                />
              )}
              {selectedRentalBoat.full_day_rate != null && (
                <RateCard
                  label="Full day"
                  amount={selectedRentalBoat.full_day_rate}
                  per="flat"
                  total="8-hour block"
                  selected={draft.rentalRateKind === "full_day"}
                  onClick={() =>
                    setDraft((d) => ({ ...d, rentalRateKind: "full_day" }))
                  }
                />
              )}
            </div>
          </FieldLabel>

          <div className="rounded-[10px] border border-hairline bg-surface-2 px-4 py-3 text-[12px]">
            <div className="flex items-baseline justify-between">
              <span className="text-fg-subtle">Base rental</span>
              <span className="money-display text-[16px] text-fg">
                {formatMoney(rentalBaseAmount)}
              </span>
            </div>
            <div className="flex items-baseline justify-between text-fg-tertiary">
              <span>Refundable deposit hold</span>
              <span className="tabular">
                {formatMoney(selectedRentalBoat.deposit_amount)}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-fg-tertiary">
              Deposit is authorized at pickup and released on return. Fuel,
              damage, and late fees draw against the deposit first.
            </p>
          </div>
        </div>
      )}

      {stepIdx === 3 && draft.type === "club" && (
        <div className="space-y-4">
          <div className="rounded-[10px] border border-hairline bg-surface-2 px-4 py-3 text-[12px]">
            <div className="flex items-center gap-2">
              <Ticket className="size-4 text-primary" />
              <span className="font-medium text-fg">
                Counts toward day allotment
              </span>
            </div>
            <p className="mt-1 text-[11px] text-fg-tertiary">
              Club bookings burn one day from the member&rsquo;s monthly
              allotment. Members on unlimited plans aren&rsquo;t metered.
            </p>
          </div>

          {oneTimeClubFees.length > 0 ? (
            <FieldLabel
              label="Add-on fees (optional)"
              hint="One-time fees attached just to this booking. Monthly / annual cadences belong on the parent membership."
            >
              <MultiCombobox
                value={draft.clubAttachedFeeIds}
                onChange={(next) =>
                  setDraft((d) => ({ ...d, clubAttachedFeeIds: next }))
                }
                options={oneTimeClubFees.map((f) => ({
                  value: f.id,
                  label: f.name,
                  sub: f.description ?? undefined,
                  trailing: formatMoney(f.amount),
                }))}
                placeholder="Pick add-on fees…"
                searchPlaceholder="Search fees…"
              />
            </FieldLabel>
          ) : (
            <p className="text-[12px] text-fg-tertiary">
              No one-time club fees configured. Add some in{" "}
              <strong>Services &rarr; Fees</strong> (scope: club_subscription)
              to surface them here.
            </p>
          )}
        </div>
      )}

      {/* Step 4 — Review */}
      {stepIdx === 4 && (
        <div className="space-y-3">
          <ReviewBlock
            label="Type"
            value={
              draft.type === "slip"
                ? "Slip reservation"
                : draft.type === "rental"
                  ? "Boat rental"
                  : draft.type === "club"
                    ? "Club booking"
                    : "—"
            }
            onEdit={() => setStepIdx(0)}
          />

          {draft.type === "slip" && (
            <>
              <ReviewBlock
                label="Holder"
                value={
                  selectedSlipBoater
                    ? `${selectedSlipBoater.display_name}${
                        selectedSlipBoater.code
                          ? ` · ${selectedSlipBoater.code}`
                          : ""
                      }`
                    : "—"
                }
                onEdit={() => setStepIdx(1)}
              />
              <ReviewBlock
                label="Slip"
                value={
                  selectedSlip
                    ? `${selectedSlip.number} · ${selectedSlip.dock} (${selectedSlip.slip_class.replace("_", " ")})`
                    : "—"
                }
                onEdit={() => setStepIdx(2)}
              />
              <ReviewBlock
                label="Dates"
                value={`${draft.slipArrival} → ${draft.slipDeparture}`}
                onEdit={() => setStepIdx(2)}
              />
              <ReviewBlock
                label="Reservation type"
                value={draft.slipReservationType}
                capitalize
                onEdit={() => setStepIdx(2)}
              />
              {selectedSlip && (
                <ReviewBlock
                  label="Monthly rate snapshot"
                  value={`${formatMoney(slipMonthlyRate)} / month (directional — final at check-in)`}
                  onEdit={() => setStepIdx(3)}
                />
              )}
              {draft.slipNotes.trim().length > 0 && (
                <ReviewBlock
                  label="Notes"
                  value={draft.slipNotes.trim()}
                  onEdit={() => setStepIdx(3)}
                />
              )}
            </>
          )}

          {draft.type === "rental" && (
            <>
              <ReviewBlock
                label="Customer"
                value={
                  draft.rentalCustomerKind === "holder"
                    ? selectedRentalBoater?.display_name ?? "—"
                    : draft.rentalWalkInName || "—"
                }
                onEdit={() => setStepIdx(1)}
              />
              <ReviewBlock
                label="Contact"
                value={
                  draft.rentalCustomerKind === "holder"
                    ? selectedRentalBoater?.primary_contact?.email ??
                      selectedRentalBoater?.primary_contact?.phone ??
                      "—"
                    : draft.rentalWalkInEmail ||
                      draft.rentalWalkInPhone ||
                      "—"
                }
                onEdit={() => setStepIdx(1)}
              />
              <ReviewBlock
                label="Boat"
                value={
                  selectedRentalBoat
                    ? `${selectedRentalBoat.name} · ${selectedRentalBoat.type.replace(
                        "_",
                        " "
                      )} · seats ${selectedRentalBoat.capacity}`
                    : "—"
                }
                onEdit={() => setStepIdx(2)}
              />
              <ReviewBlock
                label="Window"
                value={
                  rentalStartDate && rentalEndDate
                    ? `${formatLocalTime(rentalStartDate)} → ${formatLocalTime(
                        rentalEndDate
                      )} · ${rentalDurationHours}h`
                    : "—"
                }
                onEdit={() => setStepIdx(2)}
              />
              <ReviewBlock
                label="Rate"
                value={`${formatMoney(rentalBaseAmount)} (${
                  draft.rentalRateKind === "hourly"
                    ? "hourly"
                    : draft.rentalRateKind === "half_day"
                      ? "half-day"
                      : "full-day"
                })${
                  selectedRentalBoat
                    ? ` · ${formatMoney(selectedRentalBoat.deposit_amount)} deposit hold`
                    : ""
                }`}
                onEdit={() => setStepIdx(3)}
              />
            </>
          )}

          {draft.type === "club" && (
            <>
              <ReviewBlock
                label="Member"
                value={
                  selectedSubBoater
                    ? `${selectedSubBoater.display_name}${
                        selectedSubPlan?.plan_tier
                          ? ` · ${selectedSubPlan.plan_tier}`
                          : ""
                      }`
                    : "—"
                }
                onEdit={() => setStepIdx(1)}
              />
              <ReviewBlock
                label="Date"
                value={draft.clubDate}
                onEdit={() => setStepIdx(2)}
              />
              <ReviewBlock
                label="Boat"
                value={
                  selectedClubBoat
                    ? `${selectedClubBoat.name} · ${selectedClubBoat.type.replace(
                        "_",
                        " "
                      )} · seats ${selectedClubBoat.capacity}`
                    : "—"
                }
                onEdit={() => setStepIdx(2)}
              />
              {draft.clubAttachedFeeIds.length > 0 && (
                <ReviewBlock
                  label={`Add-on fees (${draft.clubAttachedFeeIds.length})`}
                  value={oneTimeClubFees
                    .filter((f) => draft.clubAttachedFeeIds.includes(f.id))
                    .map((f) => `${f.name} (${formatMoney(f.amount)})`)
                    .join(", ")}
                  onEdit={() => setStepIdx(3)}
                />
              )}
            </>
          )}

          <div className="mt-3 rounded-[10px] border border-primary/30 bg-primary-soft/30 p-3 text-[12px]">
            <div className="flex items-center gap-1.5 text-primary">
              <Sparkles className="size-3.5" />
              <span className="font-medium">On submit:</span>
            </div>
            <div className="ml-5 mt-1 text-fg-subtle">
              {draft.type === "slip" &&
                "Creates a scheduled reservation against the slip."}
              {draft.type === "rental" &&
                "Mints a pickup token and sends the signing + deposit link to the customer."}
              {draft.type === "club" &&
                "Confirms the day on the boat and decrements the member's monthly allotment."}
            </div>
          </div>
        </div>
      )}

      <WizardFooter
        stepIndex={stepIdx}
        totalSteps={STEPS.length}
        stepLabel={STEPS[stepIdx].label}
        onBack={back}
        onContinue={stepIdx === STEPS.length - 1 ? submit : next}
        continueLabel={
          stepIdx === STEPS.length - 1 ? "Create booking" : "Continue"
        }
        continueDisabled={!canContinue}
        busy={submitting}
        onExit={close}
        busyLabel="Creating…"
      />
    </WizardShell>
  );
}

// ── Inline subcomponents ─────────────────────────────────────────────────

function ToggleCard({
  active,
  onClick,
  title,
  blurb,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  blurb: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 flex-col items-start rounded-[10px] border px-3 py-2.5 text-left transition-colors",
        active
          ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
          : "border-hairline bg-surface-1 hover:border-hairline-strong hover:bg-surface-2"
      )}
    >
      <span className="text-[13px] font-medium text-fg">{title}</span>
      <span className="mt-0.5 text-[11px] text-fg-subtle">{blurb}</span>
    </button>
  );
}

function RateCard({
  label,
  amount,
  per,
  total,
  selected,
  onClick,
}: {
  label: string;
  amount: number;
  per: string;
  total: string;
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
      <div className="money-display text-[18px] text-fg">
        {formatMoney(amount)}
        <span className="ml-1 text-[10px] font-normal text-fg-tertiary">
          {per}
        </span>
      </div>
      <div className="text-[10px] text-fg-tertiary">{total}</div>
    </button>
  );
}
