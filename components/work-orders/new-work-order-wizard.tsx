"use client";

import * as React from "react";
import { ChevronDown, Plus, Sparkles, Trash2 } from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { Field, TextInput, Select, Textarea } from "@/components/create-sheet";
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
  useBoatRentals,
  useBoaters,
  useClubBookings,
  useContractsForBoater,
  usePicklistValues,
  useRentalBoats,
  useReservationsForBoater,
  useSlips,
  useVesselsForBoater,
} from "@/lib/client-store";
import { DEFAULT_CLEANING_CHECKLIST, USERS } from "@/lib/mock-data";
import type {
  BoatRental,
  ClubBooking,
  RecurringSchedule,
  RentalBoat,
  WorkOrderActivityType,
  WorkOrderChecklistItem,
  WorkOrderClass,
  WorkOrderPriority,
} from "@/lib/types";
import { cn, formatPhoneInput, phoneDigitCount } from "@/lib/utils";

/*
 * NewWorkOrderWizard — same submit shape as the old NewWorkOrderSheet
 * (executeAgentAction({ kind: "create_work_order", ... })) split across
 * six steps so the operator never has to scan a 12-field form, and the
 * Slip picker no longer drowns the holder's actual assignment in 30
 * marina slips.
 *
 * Class drives the entire downstream UX:
 *   - Service  → existing flow (holder OR walk-in) → holder's vessels → assigned slip.
 *   - Cleaning → tied to a Club booking OR a paid BoatRental. The "customer"
 *                is whoever booked the rental fleet boat. Vessel is the fleet
 *                boat, auto-derived from the source. Slip is N/A.
 *                Checklist editor + recurrence block (weekly fleet cleaning)
 *                live here.
 *
 * Steps:
 *   0. Class    — Service / Cleaning segmented.
 *   1. Customer — Conditional on class.
 *                   Service → Combobox (holder) + walk-in toggle.
 *                   Cleaning → source picker (Club booking / Paid rental)
 *                              + Combobox over the chosen source's records.
 *   2. Job      — Activity (picklist) + Subject (auto-fill) + Priority.
 *   3. Scope    — Conditional on class.
 *                   Service → vessel + slip (narrowed) + description + attachments.
 *                   Cleaning → vessel auto-derived (read-only card) + description
 *                              + attachments + checklist + recurrence.
 *   4. Schedule — start/end/due + assignee + estimate + internal notes.
 *   5. Review   — ReviewBlock summary + Create work order.
 */

type CleaningSourceKind = "club_booking" | "paid_rental";

type DraftState = {
  // Step 0 — Class. Drives every conditional below.
  workClass: WorkOrderClass;

  // Step 1a — Service customer kind discriminator. Existing holders are
  // looked up via boaterId; walk-ins capture name + contact inline and
  // a new Boater is minted on submit so WorkOrder.boater_id (required
  // by the schema) is satisfied without forcing the operator to
  // onboard the walk-in through a separate flow first.
  customerKind: "holder" | "walk_in";
  boaterId: string;
  walkInFirstName: string;
  walkInLastName: string;
  walkInEmail: string;
  walkInPhone: string;
  walkInPreferredChannel: "email" | "sms" | "voice";

  // Step 1b — Cleaning source. Every cleaning WO is tied to either a
  // ClubBooking or a paid BoatRental — never to a slip holder, never a
  // walk-in. The boater + vessel are derived from the picked source.
  cleaningSourceKind: CleaningSourceKind;
  cleaningSourceId: string;

  // Step 2 — Job
  activityType: WorkOrderActivityType;
  subject: string;
  subjectDirty: boolean; // user has manually typed → stop auto-filling
  priority: WorkOrderPriority;

  // Step 3 — Scope
  vesselId: string;
  slipId: string;
  /** When true, the slip picker shows the full marina inventory instead
   *  of just the holder's assigned slips. Toggled by the "Use a different
   *  slip" link. Service-only — cleaning hides the slip section. */
  slipUseAll: boolean;
  description: string;
  /** Loose list of file-name placeholders — wired through to
   *  WorkOrder.attachment_ids on submit. A real upload pipeline lives
   *  on the WO detail page later; this captures intent on create. */
  attachmentNames: string[];
  /** Cleaning-only — editable list seeded from DEFAULT_CLEANING_CHECKLIST.
   *  Rendered only when workClass === "cleaning". */
  checklist: WorkOrderChecklistItem[];
  /** Cleaning-only — fleet cleaning programs commonly run weekly /
   *  monthly, so the recurrence block lives here now. */
  isRecurring: boolean;
  recurringSchedule: RecurringSchedule;

  // Step 4 — Schedule & Estimate
  startDate: string;
  endDate: string;
  dueDate: string;
  assigneeId: string;
  /** Decimal hours — drives load forecasting. Stored as string for input
   *  parity, parsed at submit. */
  estimatedHours: string;
  /** Dollars (not cents) — matches QuoteLineItem.total + the WorkOrder
   *  type field. Stored as string for input parity, parsed at submit. */
  estimatedTotal: string;
  internalNotes: string;
};

// v4 — collapsed Job + Scope + Schedule into one "Details" step and
// dropped the redundant Subject field (auto-derived from activity +
// vessel at submit). v3 drafts won't hydrate cleanly into the new
// stepIdx mapping (Review moved from 5 → 3) so the key bump
// intentionally orphans them.
const STORAGE_KEY = "new-work-order-wizard:v4";

// stepIdx ↔ rail entry
//   0 = class       (Service vs Cleaning) — skipped from profile launch
//   1 = customer    (Holder/Walk-in OR cleaning source) — skipped from profile launch (service)
//   2 = details     (activity + priority + vessel + slip + description + photos + optional schedule)
//   3 = review
const STEPS: WizardStep[] = [
  { id: "class", label: "Class" },
  { id: "customer", label: "Customer" },
  { id: "details", label: "Details" },
  { id: "review", label: "Review" },
];

const STEP_TITLES = [
  "What kind of work order?",
  "Who's the work order for?",
  "What's the work?",
  "Review and create",
];

const STEP_SUBTITLES = [
  "Service covers everything tied to a holder's own boat. Cleaning covers fleet-boat turnover after a club booking or a paid rental.",
  "", // overridden inline based on class
  "Pick the activity, vessel, slip, and what needs to happen. Schedule + assignee + estimate are tucked in an optional section at the bottom.",
  "Confirm and we'll create the work order.",
];

// Human-readable label for the work class — used in the segmented
// control and the Review block.
function workClassLabel(c: WorkOrderClass): string {
  switch (c) {
    case "service":
      return "Service";
    case "cleaning":
      return "Cleaning";
  }
}

function recurringScheduleLabel(s: RecurringSchedule): string {
  switch (s) {
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
    case "quarterly":
      return "Quarterly";
    case "bi_yearly":
      return "Every 6 months";
    case "yearly":
      return "Yearly";
  }
}

// Human-readable activity label, used to auto-fill the subject.
function activityLabel(t: WorkOrderActivityType): string {
  switch (t) {
    case "winterization":
      return "Winterization";
    case "bottom_paint":
      return "Bottom paint";
    case "service":
      return "Service";
    case "inspection":
      return "Inspection";
    case "haul_out":
      return "Haul out";
    case "pump_out":
      return "Pump out";
    case "task":
      return "Task";
    case "other":
      return "Other";
  }
}

function suggestedSubject(
  activity: WorkOrderActivityType,
  vesselName: string | undefined,
): string {
  const head = activityLabel(activity);
  if (vesselName && vesselName.trim().length > 0) {
    return `${head} — ${vesselName.trim()}`;
  }
  return head;
}

// Statuses where the boat still needs cleaning. Cancelled / no_show
// drop because there's nothing to clean; completed/closed/returned all
// stay since post-use turnover is the prime cleaning trigger.
function isCleanableClubBooking(b: ClubBooking): boolean {
  return (
    b.status === "requested" ||
    b.status === "confirmed" ||
    b.status === "checked_in" ||
    b.status === "completed"
  );
}
function isCleanableBoatRental(r: BoatRental): boolean {
  return (
    r.status === "reserved" ||
    r.status === "confirmed" ||
    r.status === "checked_out" ||
    r.status === "returned" ||
    r.status === "closed"
  );
}

export function NewWorkOrderWizard({
  open,
  onOpenChange,
  defaultBoaterId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  defaultBoaterId?: string;
}) {
  // ── Live data ────────────────────────────────────────────────────────
  const boaters = useBoaters();
  const allSlips = useSlips();
  const activityTypeOptions = usePicklistValues("activity_type");
  const rentalBoats = useRentalBoats();
  const clubBookings = useClubBookings();
  const boatRentals = useBoatRentals();
  const staff = React.useMemo(
    () => USERS.filter((u) => u.role !== "system"),
    [],
  );

  const [submitting, setSubmitting] = React.useState(false);

  // ── Persisted draft ──────────────────────────────────────────────────
  const [persisted, setPersisted, clearPersisted] = useWizardDraft<{
    step: number;
    draft: DraftState;
  }>(STORAGE_KEY, () => ({
    step: 0,
    draft: {
      workClass: "service",
      customerKind: "holder",
      boaterId: defaultBoaterId ?? "",
      walkInFirstName: "",
      walkInLastName: "",
      walkInEmail: "",
      walkInPhone: "",
      walkInPreferredChannel: "email",
      cleaningSourceKind: "club_booking",
      cleaningSourceId: "",
      activityType: "service",
      subject: "",
      subjectDirty: false,
      priority: "normal",
      vesselId: "",
      slipId: "",
      slipUseAll: false,
      description: "",
      attachmentNames: [],
      // Seed an empty checklist; we hydrate the cleaning default the
      // moment the operator flips workClass to "cleaning" (effect below)
      // so switching back and forth doesn't lose their edits.
      checklist: [],
      isRecurring: false,
      recurringSchedule: "weekly",
      startDate: "",
      endDate: "",
      dueDate: "",
      assigneeId: "",
      estimatedHours: "",
      estimatedTotal: "",
      internalNotes: "",
    },
  }));

  const stepIdx = persisted.step;
  const draft = persisted.draft;

  // setStepIdx / setDraft short-circuit on no-op updates so any derived
  // setDraft call (e.g. the subject auto-fill effect) doesn't infinite-loop.
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
    [setPersisted],
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
    [setPersisted],
  );

  // If the wizard is opened with a defaultBoaterId and the draft is still
  // empty (fresh open, no persisted state), seed the boater in. Only
  // meaningful for the service branch; cleaning derives its boater from
  // the source pick.
  //
  // The Customer step itself is bypassed via next()/back() (see
  // skipCustomerStep), not via auto-advance on open — that way the Class
  // step still runs first and the operator picks Service vs Cleaning
  // before we decide whether to skip ahead.
  React.useEffect(() => {
    if (!open) return;
    if (defaultBoaterId && draft.boaterId === "" && !draft.subjectDirty) {
      setDraft((d) => ({ ...d, boaterId: defaultBoaterId }));
    }
    // ALSO recover from a stale persisted state: if a previous run got
    // saved on the Customer step (step 1) and the wizard is now being
    // re-opened from a customer profile, jump past it. Stops them
    // landing on the locked card with no way forward except Continue.
    if (defaultBoaterId && persisted.step === 1 && draft.workClass === "service") {
      setStepIdx(2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultBoaterId]);

  // ── Derived: lookups ─────────────────────────────────────────────────
  const selectedBoater = boaters.find((b) => b.id === draft.boaterId);

  // Service-only — these tolerate an empty boater id (return [] when no
  // match) so calling unconditionally keeps hook order stable.
  const boaterVessels = useVesselsForBoater(draft.boaterId);
  const boaterContracts = useContractsForBoater(draft.boaterId);
  const boaterReservations = useReservationsForBoater(draft.boaterId);

  // RentalBoat + ClubBooking + BoatRental indices for cleaning source.
  const rentalBoatById = React.useMemo(() => {
    const m = new Map<string, RentalBoat>();
    for (const b of rentalBoats) m.set(b.id, b);
    return m;
  }, [rentalBoats]);
  const boaterById = React.useMemo(() => {
    const m = new Map(boaters.map((b) => [b.id, b] as const));
    return m;
  }, [boaters]);

  const cleanableClubBookings = React.useMemo(
    () =>
      clubBookings
        .filter(isCleanableClubBooking)
        // Bookings without an assigned rental boat have nothing to clean
        // yet — filter them out so the picker never lands on a record
        // with no derivable vessel.
        .filter((b) => !!b.rental_boat_id),
    [clubBookings],
  );
  const cleanableBoatRentals = React.useMemo(
    () => boatRentals.filter(isCleanableBoatRental),
    [boatRentals],
  );

  // ── Cleaning source pick → derived boater + vessel ──────────────────
  const selectedClubBooking =
    draft.workClass === "cleaning" && draft.cleaningSourceKind === "club_booking"
      ? cleanableClubBookings.find((b) => b.id === draft.cleaningSourceId)
      : undefined;
  const selectedBoatRental =
    draft.workClass === "cleaning" && draft.cleaningSourceKind === "paid_rental"
      ? cleanableBoatRentals.find((r) => r.id === draft.cleaningSourceId)
      : undefined;

  // The rental fleet boat being cleaned — comes from either source.
  const cleaningRentalBoat: RentalBoat | undefined = React.useMemo(() => {
    if (selectedClubBooking?.rental_boat_id) {
      return rentalBoatById.get(selectedClubBooking.rental_boat_id);
    }
    if (selectedBoatRental?.boat_id) {
      return rentalBoatById.get(selectedBoatRental.boat_id);
    }
    return undefined;
  }, [selectedClubBooking, selectedBoatRental, rentalBoatById]);

  // Customer for the cleaning WO — the source's booker. For a club
  // booking we always have a boater_id. For a paid rental it may be a
  // walk-up patron (no boater_id); in that case we'll have to fall back
  // to a label-only display and let the operator know.
  const cleaningSourceBoater =
    selectedClubBooking?.boater_id != null
      ? boaterById.get(selectedClubBooking.boater_id)
      : selectedBoatRental?.boater_id
        ? boaterById.get(selectedBoatRental.boater_id)
        : undefined;
  const cleaningSourcePatronLabel =
    !cleaningSourceBoater && selectedBoatRental
      ? (selectedBoatRental.patron_name?.trim() || "Walk-up patron")
      : undefined;

  // Slips assigned to this holder right now — active/executed contracts
  // + scheduled/occupied reservations. De-duped against the global slip
  // inventory so we always render a real Slip record. Service-only.
  const assignedSlips = React.useMemo(() => {
    if (!selectedBoater) return [];
    const contractSlipIds = boaterContracts
      .filter(
        (c) =>
          (c.status === "active" || c.status === "executed") && c.slip_id,
      )
      .map((c) => c.slip_id!);
    const reservationSlipIds = boaterReservations
      .filter((r) => r.status === "scheduled" || r.status === "occupied")
      .map((r) => r.slip_id);
    const ids = new Set<string>([...contractSlipIds, ...reservationSlipIds]);
    return allSlips.filter((s) => ids.has(s.id));
  }, [selectedBoater, boaterContracts, boaterReservations, allSlips]);

  // If the holder has exactly one assigned slip and the draft hasn't been
  // touched yet (slipId === "" + slipUseAll === false), preselect it.
  React.useEffect(() => {
    if (draft.workClass !== "service") return;
    if (!selectedBoater) return;
    if (draft.slipUseAll) return;
    if (draft.slipId.length > 0) return;
    if (assignedSlips.length === 1) {
      setDraft((d) => ({ ...d, slipId: assignedSlips[0].id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draft.workClass,
    selectedBoater?.id,
    assignedSlips.length,
    draft.slipUseAll,
    draft.slipId,
  ]);

  // Slip options shown in the picker — narrowed by default, expand when
  // the operator toggles "Use a different slip" OR when the holder has
  // zero assigned slips (no narrowing possible).
  const slipOptions = React.useMemo(() => {
    if (!selectedBoater) return allSlips;
    if (draft.slipUseAll) return allSlips;
    if (assignedSlips.length === 0) return allSlips;
    return assignedSlips;
  }, [selectedBoater, draft.slipUseAll, assignedSlips, allSlips]);

  const selectedVessel = boaterVessels.find((v) => v.id === draft.vesselId);
  const selectedSlip = allSlips.find((s) => s.id === draft.slipId);
  const selectedAssignee = staff.find((u) => u.id === draft.assigneeId);
  const selectedActivityLabel =
    activityTypeOptions.find((o) => o.value === draft.activityType)?.label ??
    activityLabel(draft.activityType);

  // Vessel name used for subject auto-fill — comes from the holder's
  // vessel on service, from the derived rental boat on cleaning.
  const subjectVesselName =
    draft.workClass === "cleaning"
      ? cleaningRentalBoat?.name
      : selectedVessel?.name;

  // Subject auto-fill: when activity or vessel changes, regenerate the
  // suggested subject UNLESS the user has manually typed.
  React.useEffect(() => {
    if (draft.subjectDirty) return;
    const next = suggestedSubject(draft.activityType, subjectVesselName);
    if (next === draft.subject) return;
    setDraft((d) => ({ ...d, subject: next }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.activityType, subjectVesselName, draft.subjectDirty]);

  // When the operator flips workClass to cleaning AND the checklist is
  // still empty, hydrate from the canonical default. Doesn't clobber
  // edits — checklist.length > 0 means they've already customized.
  React.useEffect(() => {
    if (draft.workClass !== "cleaning") return;
    if (draft.checklist.length > 0) return;
    setDraft((d) => ({
      ...d,
      checklist: DEFAULT_CLEANING_CHECKLIST.map((c) => ({ ...c })),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.workClass]);

  // When the operator flips between service ↔ cleaning, the meaning of
  // vesselId / slipId changes. Wipe them so the new class doesn't
  // inherit a stale pick from the old one.
  React.useEffect(() => {
    setDraft((d) => ({
      ...d,
      vesselId: "",
      slipId: "",
      slipUseAll: false,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.workClass]);

  // ── Validation gates ────────────────────────────────────────────────
  const walkInEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    draft.walkInEmail.trim(),
  );
  const walkInPhoneValid = phoneDigitCount(draft.walkInPhone) === 10;
  const walkInFormValid =
    draft.walkInFirstName.trim().length > 0 &&
    draft.walkInLastName.trim().length > 0 &&
    (walkInEmailValid || walkInPhoneValid);

  const canStep0 = true; // class always has a default
  const canStep1 =
    draft.workClass === "cleaning"
      ? draft.cleaningSourceId.length > 0 &&
        // A cleaning WO needs a boater to satisfy the schema. If the
        // picked source is a walk-up patron rental (no boater_id), we
        // currently can't create the WO — guard rather than mint a
        // throwaway boater here. Most paid rentals come from holders or
        // club bookings, both of which carry a boater_id.
        !!cleaningSourceBoater &&
        !!cleaningRentalBoat
      : draft.customerKind === "holder"
        ? draft.boaterId.length > 0
        : walkInFormValid;
  // Details step gate — subject is auto-derived from activity+vessel
  // (the visible field was dropped in v4), so it's almost always set
  // by the time the operator hits Continue. The remaining real check
  // is the recurring-cleaning anchor: the create_work_order handler
  // only stamps `recurring_next_date` when start_date is set
  // (see agent-actions.ts), and a recurring WO without an anchor is
  // dead weight — the walker never picks it up.
  const canStep2 =
    draft.subject.trim().length > 0 &&
    (draft.isRecurring ? draft.startDate.trim().length > 0 : true);
  // Review step gate — all upstream gates must clear.
  const canStep3 = canStep0 && canStep1 && canStep2;
  const canContinue = [canStep0, canStep1, canStep2, canStep3][stepIdx];

  // ── Actions ──────────────────────────────────────────────────────────
  // When launched from a customer profile (defaultBoaterId set), the
  // Customer step has no choices (holder is locked, walk-in n/a) AND
  // the Class step is moot — Cleaning is for fleet boats only, so a
  // holder-profile launch is always a Service. Skip both in
  // navigation so the operator goes straight to Details.
  const skipClassStep = !!defaultBoaterId;
  const skipCustomerStep =
    !!defaultBoaterId && draft.workClass === "service";

  // Stepper rail hides any skipped slots — earlier revs only made
  // navigation jump, but the skipped step still appeared (filled-in)
  // in the rail. That confused operators who saw a step they never
  // visited marked as complete.
  const visibleSteps = React.useMemo(
    () =>
      STEPS.filter((s) => {
        if (skipClassStep && s.id === "class") return false;
        if (skipCustomerStep && s.id === "customer") return false;
        return true;
      }),
    [skipClassStep, skipCustomerStep],
  );

  // Translate between original stepIdx (canonical 0=class, 1=customer,
  // 2=details, 3=review) and the visible rail index. visibleCurrentIdx
  // is what we pass to the WizardProgress component.
  const visibleCurrentIdx = React.useMemo(() => {
    // Walk STEPS from 0..stepIdx and count how many are visible up
    // through (and including) the current step.
    let count = 0;
    for (let i = 0; i <= stepIdx; i++) {
      const step = STEPS[i];
      if (skipClassStep && step.id === "class") continue;
      if (skipCustomerStep && step.id === "customer") continue;
      count++;
    }
    // count is the 1-based visible position; convert to 0-based index.
    return Math.max(0, count - 1);
  }, [stepIdx, skipClassStep, skipCustomerStep]);

  // Rail clicks come back as visible indices; translate to original.
  function onStepClick(visibleIdx: number) {
    const target = visibleSteps[visibleIdx];
    if (!target) return;
    const originalIdx = STEPS.findIndex((s) => s.id === target.id);
    if (originalIdx >= 0) setStepIdx(originalIdx);
  }

  // next() / back() walk through STEPS but skip the hidden slots,
  // so a profile-launched Service flow goes details → review on Continue
  // (no dead-weight Class or Customer stop) and back through review →
  // details only.
  function isVisible(idx: number): boolean {
    const step = STEPS[idx];
    if (!step) return false;
    if (skipClassStep && step.id === "class") return false;
    if (skipCustomerStep && step.id === "customer") return false;
    return true;
  }
  function next() {
    for (let i = stepIdx + 1; i < STEPS.length; i++) {
      if (isVisible(i)) {
        setStepIdx(i);
        return;
      }
    }
  }
  function back() {
    for (let i = stepIdx - 1; i >= 0; i--) {
      if (isVisible(i)) {
        setStepIdx(i);
        return;
      }
    }
  }
  function close() {
    clearPersisted();
    onOpenChange(false);
  }

  // Walk-in customers get a short marketing-style code so staff can
  // identify them on the boater list before they're tagged with a slip.
  function generateWalkInCode(): string {
    const stamp = Date.now().toString(36).slice(-4).toUpperCase();
    return `WI-${stamp}`;
  }

  function submit() {
    if (!canStep3) return;
    setSubmitting(true);
    try {
      const isCleaning = draft.workClass === "cleaning";

      // ── Resolve boater + vessel + slip per class ──
      let boaterId = draft.boaterId;
      let vesselId: string | undefined = draft.vesselId || undefined;
      let slipId: string | undefined = draft.slipId || undefined;

      if (isCleaning) {
        // Cleaning derives boater + vessel from the source pick; slip
        // is always N/A. canStep1 already ensured these resolve.
        if (!cleaningSourceBoater || !cleaningRentalBoat) return;
        boaterId = cleaningSourceBoater.id;
        // The "vessel" for a cleaning WO is the RentalBoat being cleaned.
        // We point WorkOrder.vessel_id at the RentalBoat.id — same id
        // space as Vessel for the demo store, surfaces cleanly in the
        // WO detail rail because both types resolve through the same
        // join helpers downstream.
        vesselId = cleaningRentalBoat.id;
        slipId = undefined;
      } else {
        // Service — walk-ins mint a Boater first so WorkOrder.boater_id
        // (required by the schema) has something real to point at. Same
        // code path the rental flow uses for walk-ups.
        if (draft.customerKind === "walk_in") {
          const result = executeAgentAction({
            kind: "create_boater",
            label: "",
            first_name: draft.walkInFirstName.trim(),
            last_name: draft.walkInLastName.trim(),
            email: draft.walkInEmail.trim(),
            phone: draft.walkInPhone.trim(),
            code: generateWalkInCode(),
            preferred_channel: draft.walkInPreferredChannel,
            billing_cadence: "transient",
          });
          if (!result.ok || !result.createdId) {
            window.alert(
              "Could not create the walk-in customer. Please verify the name + a valid email or phone, then try again.",
            );
            return;
          }
          boaterId = result.createdId;
        }
      }

      // Parse the dollar-and-hours inputs to numbers — empty string
      // collapses to undefined so the WO record stays clean.
      const estTotalNum = draft.estimatedTotal.trim()
        ? Number(draft.estimatedTotal.replace(/[^0-9.]/g, ""))
        : undefined;
      const estHoursNum = draft.estimatedHours.trim()
        ? Number(draft.estimatedHours)
        : undefined;

      executeAgentAction({
        kind: "create_work_order",
        label: "",
        boater_id: boaterId,
        subject: draft.subject.trim(),
        description: draft.description.trim() || undefined,
        activity_type: draft.activityType,
        priority: draft.priority,
        vessel_id: vesselId,
        slip_id: slipId,
        start_date: draft.startDate || undefined,
        end_date: draft.endDate || undefined,
        due_date: draft.dueDate || undefined,
        assignee_user_id: draft.assigneeId || undefined,
        work_class: draft.workClass,
        estimated_total:
          estTotalNum !== undefined && Number.isFinite(estTotalNum)
            ? estTotalNum
            : undefined,
        estimated_hours:
          estHoursNum !== undefined && Number.isFinite(estHoursNum)
            ? estHoursNum
            : undefined,
        // Only forward checklist when the work class actually consumes
        // it — keeps service rows from carrying stale cleaning rows.
        checklist: isCleaning ? draft.checklist : undefined,
        // Recurrence is gated on cleaning now (fleet cleaning programs).
        is_recurring: isCleaning ? draft.isRecurring : undefined,
        recurring_schedule:
          isCleaning && draft.isRecurring
            ? draft.recurringSchedule
            : undefined,
        internal_notes: draft.internalNotes.trim() || undefined,
        attachment_ids:
          draft.attachmentNames.length > 0
            ? draft.attachmentNames
            : undefined,
        // Source back-reference — stashed into internal_notes by the
        // action handler so it's visible on the WO detail rail.
        cleaning_source_kind: isCleaning
          ? draft.cleaningSourceKind
          : undefined,
        cleaning_source_id: isCleaning ? draft.cleaningSourceId : undefined,
      });
      clearPersisted();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  // Step subtitle is mostly static but Customer + Details depend on
  // workClass for clearer copy.
  const stepSubtitle =
    stepIdx === 1
      ? draft.workClass === "cleaning"
        ? "Cleaning rides on a club booking or a paid rental. Pick the source — the customer and fleet boat fill in from there."
        : "Pick an existing holder or capture a walk-in customer. Either way everything downstream — vessels, slips, billing — ties back to this person."
      : stepIdx === 2
        ? draft.workClass === "cleaning"
          ? "Set the fleet boat, slip, checklist, and (optionally) turn on a recurring cleaning program. Schedule + assignee are in the expander below."
          : "Pick the activity, vessel, slip, and what needs to happen. Schedule + assignee + estimate are tucked in an optional section at the bottom."
        : STEP_SUBTITLES[stepIdx];

  // Cleaning source options for the Combobox — labels show customer +
  // date + fleet boat so the operator can disambiguate at a glance.
  const cleaningSourceOptions: { value: string; label: string; hint?: string }[] =
    draft.workClass === "cleaning"
      ? draft.cleaningSourceKind === "club_booking"
        ? cleanableClubBookings.map((b) => {
            const booker = b.boater_id ? boaterById.get(b.boater_id) : undefined;
            const boat = b.rental_boat_id
              ? rentalBoatById.get(b.rental_boat_id)
              : undefined;
            return {
              value: b.id,
              label: `${booker?.display_name ?? "Unknown member"} · ${b.date}`,
              hint: boat ? `· ${boat.name}` : undefined,
            };
          })
        : cleanableBoatRentals.map((r) => {
            const booker = r.boater_id ? boaterById.get(r.boater_id) : undefined;
            const boat = rentalBoatById.get(r.boat_id);
            // `||` not `??` — an empty-string patron_name on a partially
            // saved walk-up rental would otherwise pass through as ""
            // and render a blank Combobox label.
            const customer =
              booker?.display_name ||
              r.patron_name?.trim() ||
              "Walk-up patron";
            const day = r.start_at.slice(0, 10);
            return {
              value: r.id,
              label: `${customer} · ${day}`,
              hint: boat ? `· ${boat.name} · ${r.number}` : `· ${r.number}`,
            };
          })
      : [];

  return (
    <WizardShell
      eyebrow="New work order"
      title={STEP_TITLES[stepIdx]}
      subtitle={stepSubtitle}
      steps={visibleSteps}
      currentIdx={visibleCurrentIdx}
      onStepClick={onStepClick}
      stepsClickAny={true}
      rightRail={undefined}
      chrome="modal"
      onExit={close}
    >
      {/* Step 0 — Class */}
      {stepIdx === 0 && (
        <div className="space-y-4">
          <FieldLabel
            label="Work class"
            hint="Service covers holder + walk-in repair / inspection work. Cleaning covers turnover for fleet boats."
          >
            <div className="grid grid-cols-2 gap-1.5">
              {(["service", "cleaning"] as WorkOrderClass[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, workClass: c }))}
                  className={cn(
                    "rounded-[8px] border px-2 py-2 text-center text-[12px] font-medium transition-colors",
                    draft.workClass === c
                      ? "border-primary bg-primary-soft/40 text-primary"
                      : "border-hairline bg-surface-1 text-fg-subtle hover:bg-surface-2",
                  )}
                >
                  {workClassLabel(c)}
                </button>
              ))}
            </div>
          </FieldLabel>
          <p className="text-[12px] text-fg-subtle">
            {draft.workClass === "cleaning"
              ? "Cleaning is always tied to a club booking or a paid rental. The next step picks the source — the customer and fleet boat fill in automatically."
              : "Service work links to an existing holder or a walk-in customer, with the vessel and slip from their account."}
          </p>
        </div>
      )}

      {/* Step 1 — Customer (service: holder/walk-in; cleaning: source) */}
      {stepIdx === 1 && draft.workClass === "service" && (
        <div className="space-y-4">
          {defaultBoaterId && selectedBoater ? (
            // Launched from a customer profile — the holder is fixed.
            // No walk-in toggle, no picker. Just a read-only confirmation
            // card so the operator sees who the work order is being
            // attached to. This step also auto-advances on open (see
            // the defaultBoaterId effect above), so this view only shows
            // if the operator navigates back to it.
            <div className="rounded-[10px] border border-hairline bg-surface-2 p-4">
              <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">
                Work order for
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-3">
                <div className="text-[15px] font-semibold text-fg">
                  {selectedBoater.display_name}
                </div>
                {selectedBoater.code && (
                  <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">
                    {selectedBoater.code}
                  </div>
                )}
              </div>
              <div className="mt-1 text-[12.5px] text-fg-subtle">
                {selectedBoater.primary_contact?.email || "no email"} ·{" "}
                {selectedBoater.primary_contact?.phone || "no phone"}
              </div>
              <p className="mt-3 text-[11.5px] text-fg-tertiary">
                Launched from this holder&apos;s profile. To create a
                walk-in work order or pick a different holder, start from
                the Work Orders tab instead.
              </p>
            </div>
          ) : (
            <>
          {/* Customer-kind toggle. Holder is the default because most
              work orders are for existing customers, but walk-ins are
              a real path. Picking walk-in skips the picker and surfaces
              an inline name + contact form. The new Boater is minted
              on submit. */}
          <div className="inline-flex rounded-[10px] border border-hairline bg-surface-2 p-1">
            {(["holder", "walk_in"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    customerKind: k,
                    // Switching kind clears the OTHER mode's fields so
                    // we never accidentally submit a stale holder pick
                    // alongside walk-in form values.
                    boaterId: k === "holder" ? d.boaterId : "",
                    walkInFirstName: k === "walk_in" ? d.walkInFirstName : "",
                    walkInLastName: k === "walk_in" ? d.walkInLastName : "",
                    walkInEmail: k === "walk_in" ? d.walkInEmail : "",
                    walkInPhone: k === "walk_in" ? d.walkInPhone : "",
                    vesselId: "",
                    slipId: "",
                    slipUseAll: false,
                  }))
                }
                className={cn(
                  "rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors",
                  draft.customerKind === k
                    ? "bg-surface-1 text-fg shadow-sm"
                    : "text-fg-subtle hover:text-fg",
                )}
              >
                {k === "holder" ? "Existing holder" : "Walk-in"}
              </button>
            ))}
          </div>

          {draft.customerKind === "holder" && (
            <>
              <FieldLabel
                label="Holder"
                hint="Search by name or code. The downstream vessel + slip pickers narrow to this person."
                required
              >
                <Combobox
                  value={draft.boaterId}
                  onChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      boaterId: v,
                      // Holder change invalidates downstream picks.
                      vesselId: "",
                      slipId: "",
                      slipUseAll: false,
                    }))
                  }
                  options={boaters.map((b) => ({
                    value: b.id,
                    label: b.display_name,
                    hint: b.code ? `· ${b.code}` : undefined,
                  }))}
                  placeholder="Pick a holder…"
                  searchPlaceholder="Search by name, code…"
                />
              </FieldLabel>
              {selectedBoater && (
                <div className="rounded-[10px] border border-hairline bg-surface-2 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="text-[13px] font-medium text-fg">
                      {selectedBoater.display_name}
                    </div>
                    {selectedBoater.code && (
                      <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">
                        {selectedBoater.code}
                      </div>
                    )}
                  </div>
                  <div className="mt-1 text-[12px] text-fg-subtle">
                    {selectedBoater.primary_contact?.email || "no email"} ·{" "}
                    {selectedBoater.primary_contact?.phone || "no phone"}
                  </div>
                </div>
              )}
            </>
          )}

          {draft.customerKind === "walk_in" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name" required>
                  <TextInput
                    value={draft.walkInFirstName}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        walkInFirstName: e.target.value,
                      }))
                    }
                    placeholder="Sarah"
                  />
                </Field>
                <Field label="Last name" required>
                  <TextInput
                    value={draft.walkInLastName}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        walkInLastName: e.target.value,
                      }))
                    }
                    placeholder="Reyes"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Email">
                  <TextInput
                    type="email"
                    value={draft.walkInEmail}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        walkInEmail: e.target.value,
                      }))
                    }
                    placeholder="sarah@example.com"
                  />
                </Field>
                <Field label="Phone">
                  <TextInput
                    type="tel"
                    inputMode="tel"
                    value={draft.walkInPhone}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        walkInPhone: formatPhoneInput(e.target.value),
                      }))
                    }
                    placeholder="(555) 555-0123"
                  />
                </Field>
              </div>
              <p className="text-[11px] text-fg-tertiary">
                At least one contact channel (email or phone) is required so
                we can reach them about the work order.
              </p>
              <Field label="Preferred channel">
                <Select
                  value={draft.walkInPreferredChannel}
                  onChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      walkInPreferredChannel:
                        v as DraftState["walkInPreferredChannel"],
                    }))
                  }
                >
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="voice">Voice</option>
                </Select>
              </Field>
            </div>
          )}
            </>
          )}
        </div>
      )}

      {stepIdx === 1 && draft.workClass === "cleaning" && (
        <div className="space-y-4">
          {/* Source kind — Club booking vs. Paid rental. */}
          <FieldLabel
            label="Source"
            hint="Cleaning rides on either a club booking or a paid boat rental — pick the one this turnover is for."
            required
          >
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  ["club_booking", "Club booking"],
                  ["paid_rental", "Paid rental"],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      cleaningSourceKind: kind,
                      // Source kind change invalidates the picked id —
                      // ids are kind-specific.
                      cleaningSourceId: "",
                    }))
                  }
                  className={cn(
                    "rounded-[8px] border px-2 py-2 text-center text-[12px] font-medium transition-colors",
                    draft.cleaningSourceKind === kind
                      ? "border-primary bg-primary-soft/40 text-primary"
                      : "border-hairline bg-surface-1 text-fg-subtle hover:bg-surface-2",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </FieldLabel>

          <FieldLabel
            label={
              draft.cleaningSourceKind === "club_booking"
                ? "Club booking"
                : "Boat rental"
            }
            hint={
              draft.cleaningSourceKind === "club_booking"
                ? "Showing bookings still in play (requested → completed) with a fleet boat assigned."
                : "Showing rentals that haven't been cancelled or no-showed."
            }
            required
          >
            <Combobox
              value={draft.cleaningSourceId}
              onChange={(v) =>
                setDraft((d) => ({ ...d, cleaningSourceId: v }))
              }
              options={cleaningSourceOptions}
              placeholder={
                draft.cleaningSourceKind === "club_booking"
                  ? "Pick a club booking…"
                  : "Pick a rental…"
              }
              searchPlaceholder="Search by member, date, boat…"
            />
          </FieldLabel>

          {/* Source preview card — confirms the derivation in one glance. */}
          {(selectedClubBooking || selectedBoatRental) && (
            <div className="rounded-[10px] border border-hairline bg-surface-2 p-4 space-y-1">
              <div className="text-[13px] font-medium text-fg">
                {cleaningSourceBoater?.display_name ??
                  cleaningSourcePatronLabel ??
                  "Unknown customer"}
              </div>
              <div className="text-[12px] text-fg-subtle">
                {selectedClubBooking
                  ? `Club booking · ${selectedClubBooking.date}${
                      selectedClubBooking.start_time
                        ? ` · ${selectedClubBooking.start_time}${
                            selectedClubBooking.end_time
                              ? `–${selectedClubBooking.end_time}`
                              : ""
                          }`
                        : ""
                    }`
                  : selectedBoatRental
                    ? `Rental ${selectedBoatRental.number} · ${selectedBoatRental.start_at.slice(
                        0,
                        10,
                      )}`
                    : ""}
              </div>
              <div className="text-[12px] text-fg-subtle">
                Cleaning:{" "}
                <span className="font-medium text-fg">
                  {cleaningRentalBoat?.name ?? "—"}
                </span>
              </div>
              {!cleaningSourceBoater && selectedBoatRental && (
                <div className="mt-2 rounded-[8px] border border-status-warn/30 bg-status-warn/10 px-2 py-1.5 text-[11px] text-status-warn">
                  This rental is a walk-up patron — no boater on file yet.
                  Convert them to a boater from the rental detail page
                  before opening a cleaning WO.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Step 2 — Details (Job + Scope merged; Schedule lives below as a
          collapsible "Optional" expander). The Subject field was dropped
          in v4 — it auto-filled from activity+vessel anyway, so we
          derive it at submit and let operators rename from the WO
          detail page in the rare case they want something custom. */}
      {stepIdx === 2 && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="Activity type">
              {/* Combobox per CLAUDE.md §6.3 — activity_type has 8
                  options on the seeded marina (Winterization, Bottom
                  paint, Service/repair, Inspection, Haul-out, Pump-out,
                  Staff task, Other) so a search-as-you-type list is
                  required. */}
              <Combobox
                value={draft.activityType}
                onChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    activityType: v as WorkOrderActivityType,
                  }))
                }
                options={activityTypeOptions.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
                placeholder="Pick an activity…"
                searchPlaceholder="Search activities…"
              />
            </FieldLabel>
            <FieldLabel label="Priority">
              <div className="grid grid-cols-4 gap-1.5">
                {(
                  ["low", "normal", "high", "urgent"] as WorkOrderPriority[]
                ).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, priority: p }))}
                    className={cn(
                      "rounded-[8px] border px-2 py-1.5 text-center text-[12px] font-medium capitalize transition-colors",
                      draft.priority === p
                        ? "border-primary bg-primary-soft/40 text-primary"
                        : "border-hairline bg-surface-1 text-fg-subtle hover:bg-surface-2",
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </FieldLabel>
          </div>
        </div>
      )}

      {/* Scope fields — service variant. Renders in the same Details
          step as the activity+priority block above. */}
      {stepIdx === 2 && draft.workClass === "service" && (
        <div className="space-y-4">
          <Field
            label="Vessel"
            hint={
              draft.customerKind === "walk_in"
                ? "Walk-in customer — no vessels on file. Leave blank, or add a vessel from the work-order detail page after creating."
                : selectedBoater
                  ? `Filtered to ${selectedBoater.first_name}'s vessels.`
                  : undefined
            }
          >
            <Select
              value={draft.vesselId}
              onChange={(v) => setDraft((d) => ({ ...d, vesselId: v }))}
            >
              <option value="">No vessel</option>
              {boaterVessels.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>

          <FieldLabel
            label="Slip"
            hint={
              draft.customerKind === "walk_in"
                ? "Walk-in customer — pick any slip if the work is happening at a specific one, otherwise leave blank."
                : !selectedBoater
                  ? "Pick a holder first to narrow the slip list."
                  : draft.slipUseAll
                    ? "Showing all marina slips."
                    : assignedSlips.length === 0
                      ? "No slip on file for this holder — pick any from the marina."
                      : assignedSlips.length === 1
                        ? "Pre-filled from the holder's current slip assignment."
                        : `Showing the ${assignedSlips.length} slips currently assigned to this holder.`
            }
          >
            <Combobox
              value={draft.slipId}
              onChange={(v) => setDraft((d) => ({ ...d, slipId: v }))}
              options={[
                { value: "", label: "No slip", hint: undefined },
                ...slipOptions.map((s) => ({
                  value: s.id,
                  label: `${s.number} · ${s.dock}`,
                  hint: `· ${s.slip_class.replace("_", " ")}`,
                })),
              ]}
              placeholder="Pick a slip…"
              searchPlaceholder="Search by slip # or dock…"
            />
            {selectedBoater &&
              assignedSlips.length > 0 &&
              !draft.slipUseAll && (
                <button
                  type="button"
                  onClick={() =>
                    setDraft((d) => ({ ...d, slipUseAll: true, slipId: "" }))
                  }
                  className="mt-2 text-[12px] text-primary hover:underline"
                >
                  Use a different slip →
                </button>
              )}
            {selectedBoater &&
              assignedSlips.length > 0 &&
              draft.slipUseAll && (
                <button
                  type="button"
                  onClick={() =>
                    setDraft((d) => ({ ...d, slipUseAll: false, slipId: "" }))
                  }
                  className="mt-2 text-[12px] text-primary hover:underline"
                >
                  ← Back to {selectedBoater.first_name}&rsquo;s assigned slips
                </button>
              )}
          </FieldLabel>

          <Field
            label="Description"
            hint="Customer-facing scope — what the tech is doing. Internal-only notes go on the next step."
          >
            <Textarea
              value={draft.description}
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
              placeholder="What needs to happen, any context the technician needs…"
            />
          </Field>

          {/* Attachments — simple file picker that pushes filenames
              into draft.attachmentNames. The real upload pipeline
              lives on the WO detail page; this captures intent on
              create so the agent action carries the photo manifest. */}
          <FieldLabel
            label="Photos & files"
            hint="Optional. Snapshots of the issue, prior estimates, anything the tech should see before walking down the dock."
          >
            <div className="space-y-2">
              <label
                htmlFor="wo-attachments"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-hairline bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-fg-subtle transition-colors hover:bg-surface-1"
              >
                <Plus className="size-3.5" />
                Add files
              </label>
              <input
                id="wo-attachments"
                type="file"
                multiple
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (!files || files.length === 0) return;
                  const names = Array.from(files).map((f) => f.name);
                  setDraft((d) => ({
                    ...d,
                    attachmentNames: [...d.attachmentNames, ...names],
                  }));
                  // Reset the input so picking the same file twice
                  // (after a remove) still fires the change event.
                  e.target.value = "";
                }}
              />
              {draft.attachmentNames.length > 0 && (
                <ul className="space-y-1">
                  {draft.attachmentNames.map((name, idx) => (
                    <li
                      key={`${name}-${idx}`}
                      className="flex items-center justify-between rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[12px] text-fg-subtle"
                    >
                      <span className="truncate">{name}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            attachmentNames: d.attachmentNames.filter(
                              (_, i) => i !== idx,
                            ),
                          }))
                        }
                        className="ml-2 text-fg-tertiary hover:text-status-danger"
                        aria-label={`Remove ${name}`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </FieldLabel>
        </div>
      )}

      {/* Scope fields — cleaning variant. Same Details step. */}
      {stepIdx === 2 && draft.workClass === "cleaning" && (
        <div className="space-y-4">
          {/* Vessel — auto-derived from the source pick. Read-only card. */}
          <FieldLabel
            label="Cleaning"
            hint="The fleet boat to clean — set from the source booking / rental on the previous step."
          >
            <div className="rounded-[10px] border border-hairline bg-surface-2 p-3">
              {cleaningRentalBoat ? (
                <>
                  <div className="text-[13px] font-medium text-fg">
                    {cleaningRentalBoat.name}
                  </div>
                  <div className="mt-0.5 text-[12px] text-fg-subtle capitalize">
                    {cleaningRentalBoat.type.replace("_", " ")} ·{" "}
                    {cleaningRentalBoat.home_dock}
                  </div>
                </>
              ) : (
                <div className="text-[12px] text-fg-tertiary">
                  No fleet boat resolved — go back and pick a source.
                </div>
              )}
            </div>
          </FieldLabel>

          <Field
            label="Description"
            hint="Customer-facing scope — what the deckhand is doing. Internal-only notes go on the next step."
          >
            <Textarea
              value={draft.description}
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
              placeholder="Anything beyond the standard checklist — extra detailing, damage notes, owner requests…"
            />
          </Field>

          <FieldLabel
            label="Photos & files"
            hint="Optional. Before / after photos, damage shots, anything the supervisor should see."
          >
            <div className="space-y-2">
              <label
                htmlFor="wo-attachments"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-hairline bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-fg-subtle transition-colors hover:bg-surface-1"
              >
                <Plus className="size-3.5" />
                Add files
              </label>
              <input
                id="wo-attachments"
                type="file"
                multiple
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (!files || files.length === 0) return;
                  const names = Array.from(files).map((f) => f.name);
                  setDraft((d) => ({
                    ...d,
                    attachmentNames: [...d.attachmentNames, ...names],
                  }));
                  e.target.value = "";
                }}
              />
              {draft.attachmentNames.length > 0 && (
                <ul className="space-y-1">
                  {draft.attachmentNames.map((name, idx) => (
                    <li
                      key={`${name}-${idx}`}
                      className="flex items-center justify-between rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[12px] text-fg-subtle"
                    >
                      <span className="truncate">{name}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            attachmentNames: d.attachmentNames.filter(
                              (_, i) => i !== idx,
                            ),
                          }))
                        }
                        className="ml-2 text-fg-tertiary hover:text-status-danger"
                        aria-label={`Remove ${name}`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </FieldLabel>

          {/* Editable checklist seeded from DEFAULT_CLEANING_CHECKLIST. */}
          <FieldLabel
            label="Cleaning checklist"
            hint="The deckhand initials each row from the WO detail page once completed."
          >
            <div className="space-y-2">
              {draft.checklist.map((item, idx) => (
                <div key={item.id} className="flex items-center gap-2">
                  <TextInput
                    value={item.label}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        checklist: d.checklist.map((c, i) =>
                          i === idx ? { ...c, label: e.target.value } : c,
                        ),
                      }))
                    }
                    placeholder="Checklist item"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        checklist: d.checklist.filter((_, i) => i !== idx),
                      }))
                    }
                    className="rounded-[6px] border border-hairline bg-surface-1 p-1.5 text-fg-tertiary transition-colors hover:text-status-danger"
                    aria-label={`Remove ${item.label}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    checklist: [
                      ...d.checklist,
                      {
                        id: `cl_${Date.now().toString(36)}_${Math.random()
                          .toString(36)
                          .slice(2, 5)}`,
                        label: "",
                      },
                    ],
                  }))
                }
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-hairline bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-fg-subtle transition-colors hover:bg-surface-1"
              >
                <Plus className="size-3.5" />
                Add row
              </button>
            </div>
          </FieldLabel>

          {/* Recurrence — gated on cleaning. Weekly is the marina norm
              for an active fleet cleaning program; keep monthly /
              quarterly options for less-busy off-season rotations. */}
          <FieldLabel
            label="Recurring"
            hint="Spawn the next cleaning WO automatically when this cycle's start date hits. Anchors off the start date on the next step."
          >
            <div className="space-y-3">
              <div className="inline-flex rounded-[10px] border border-hairline bg-surface-2 p-1">
                {([false, true] as const).map((on) => (
                  <button
                    key={String(on)}
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({ ...d, isRecurring: on }))
                    }
                    className={cn(
                      "rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors",
                      draft.isRecurring === on
                        ? "bg-surface-1 text-fg shadow-sm"
                        : "text-fg-subtle hover:text-fg",
                    )}
                  >
                    {on ? "On" : "Off"}
                  </button>
                ))}
              </div>
              {draft.isRecurring && (
                <Field label="Schedule">
                  <Select
                    value={draft.recurringSchedule}
                    onChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        recurringSchedule: v as RecurringSchedule,
                      }))
                    }
                  >
                    {(
                      [
                        "weekly",
                        "monthly",
                        "quarterly",
                        "bi_yearly",
                        "yearly",
                      ] as RecurringSchedule[]
                    ).map((s) => (
                      <option key={s} value={s}>
                        {recurringScheduleLabel(s)}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
          </FieldLabel>
        </div>
      )}

      {/* Schedule, assignee, estimate, internal notes — all optional
          power-user fields. Lives inside the Details step as a
          collapsible expander so the default form is short. Most work
          orders are filed without any of these set; the operator who
          cares can open the panel and fill them in. Uses native
          <details> for accessibility (Tab + Enter toggles, screen
          readers announce expanded/collapsed). */}
      {stepIdx === 2 && (
        <details className="group rounded-[10px] border border-hairline bg-surface-2/30 transition-colors">
          <summary className="flex cursor-pointer items-center justify-between rounded-[10px] px-4 py-2.5 text-[13px] font-medium text-fg hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2 text-fg-subtle">
              <span>+ Schedule, assignee &amp; estimate</span>
              <span className="text-[11px] font-normal text-fg-tertiary">
                (optional)
              </span>
            </span>
            <ChevronDown className="size-4 text-fg-tertiary transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-4 border-t border-hairline px-4 pb-4 pt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Start">
              <TextInput
                type="date"
                value={draft.startDate}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, startDate: e.target.value }))
                }
              />
            </Field>
            <Field label="End">
              <TextInput
                type="date"
                value={draft.endDate}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, endDate: e.target.value }))
                }
              />
            </Field>
            <Field label="Due">
              <TextInput
                type="date"
                value={draft.dueDate}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, dueDate: e.target.value }))
                }
              />
            </Field>
          </div>

          <Field label="Assign to">
            <Select
              value={draft.assigneeId}
              onChange={(v) => setDraft((d) => ({ ...d, assigneeId: v }))}
            >
              <option value="">Unassigned</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.role}
                </option>
              ))}
            </Select>
          </Field>

          {/* Estimate pair — pre-Quote ballpark so the dispatcher can
              load-plan the week without waiting for the linked Quote
              to be drafted. Both optional. Per workspace numeric-input
              rule (CLAUDE.md §6.2) we use inputMode=decimal and
              parse on submit instead of type=number. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Est. labor hours" hint="Decimal — e.g. 2.5">
              <TextInput
                type="text"
                inputMode="decimal"
                value={draft.estimatedHours}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, estimatedHours: e.target.value }))
                }
                placeholder="0"
              />
            </Field>
            <Field label="Estimated total" hint="Pre-quote ballpark, in dollars.">
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[12px] text-fg-tertiary">
                  $
                </span>
                <TextInput
                  type="text"
                  inputMode="decimal"
                  value={draft.estimatedTotal}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      estimatedTotal: e.target.value,
                    }))
                  }
                  placeholder="0"
                  className="pl-6"
                />
              </div>
            </Field>
          </div>

          <Field
            label="Internal notes (staff only)"
            hint="Private to the marina team — never shown on a Quote or holder portal."
          >
            <Textarea
              value={draft.internalNotes}
              onChange={(e) =>
                setDraft((d) => ({ ...d, internalNotes: e.target.value }))
              }
              placeholder="Tech-only context: warranty status, prior failed parts, customer quirks…"
            />
          </Field>
          </div>
        </details>
      )}

      {/* Review (now at stepIdx 3 since Job + Scope + Schedule
          collapsed into Details at stepIdx 2). */}
      {stepIdx === 3 && (
        <div className="space-y-3">
          <ReviewBlock
            label="Work class"
            value={workClassLabel(draft.workClass)}
            onEdit={() => setStepIdx(0)}
          />
          {draft.workClass === "service" && (
            <ReviewBlock
              label={
                draft.customerKind === "walk_in" ? "Walk-in customer" : "Holder"
              }
              value={
                draft.customerKind === "walk_in"
                  ? `${draft.walkInFirstName.trim()} ${draft.walkInLastName.trim()} · ${
                      draft.walkInEmail.trim() ||
                      draft.walkInPhone.trim() ||
                      "no contact"
                    }`
                  : selectedBoater
                    ? `${selectedBoater.display_name}${
                        selectedBoater.code ? ` · ${selectedBoater.code}` : ""
                      }`
                    : "—"
              }
              onEdit={() => setStepIdx(1)}
            />
          )}
          {draft.workClass === "cleaning" && (
            <>
              <ReviewBlock
                label="Source"
                value={
                  selectedClubBooking
                    ? `Club booking · ${selectedClubBooking.date}${
                        cleaningSourceBoater
                          ? ` · ${cleaningSourceBoater.display_name}`
                          : ""
                      }`
                    : selectedBoatRental
                      ? `Rental ${selectedBoatRental.number} · ${
                          cleaningSourceBoater?.display_name ??
                          cleaningSourcePatronLabel ??
                          "—"
                        }`
                      : "—"
                }
                onEdit={() => setStepIdx(1)}
              />
              <ReviewBlock
                label="Fleet boat"
                value={cleaningRentalBoat?.name ?? "—"}
                onEdit={() => setStepIdx(1)}
              />
            </>
          )}
          <ReviewBlock
            label="Activity"
            value={selectedActivityLabel}
            onEdit={() => setStepIdx(2)}
            capitalize
          />
          <ReviewBlock
            label="Subject"
            value={draft.subject.trim() || "—"}
            onEdit={() => setStepIdx(2)}
          />
          <ReviewBlock
            label="Priority"
            value={draft.priority}
            capitalize
            onEdit={() => setStepIdx(2)}
          />
          {draft.workClass === "service" && (
            <>
              <ReviewBlock
                label="Vessel"
                value={selectedVessel ? selectedVessel.name : "—"}
                onEdit={() => setStepIdx(2)}
              />
              <ReviewBlock
                label="Slip"
                value={
                  selectedSlip
                    ? `${selectedSlip.number} · ${selectedSlip.dock} (${selectedSlip.slip_class.replace(
                        "_",
                        " ",
                      )})`
                    : "—"
                }
                onEdit={() => setStepIdx(2)}
              />
            </>
          )}
          {draft.description.trim().length > 0 && (
            <ReviewBlock
              label="Description"
              value={draft.description.trim()}
              onEdit={() => setStepIdx(2)}
            />
          )}
          {draft.attachmentNames.length > 0 && (
            <ReviewBlock
              label="Attachments"
              value={`${draft.attachmentNames.length} file${
                draft.attachmentNames.length === 1 ? "" : "s"
              } · ${draft.attachmentNames.join(", ")}`}
              onEdit={() => setStepIdx(2)}
            />
          )}
          {draft.workClass === "cleaning" && draft.checklist.length > 0 && (
            <ReviewBlock
              label="Checklist"
              value={`${draft.checklist.length} item${
                draft.checklist.length === 1 ? "" : "s"
              } — ${draft.checklist
                .map((c) => c.label)
                .filter(Boolean)
                .join(", ")}`}
              onEdit={() => setStepIdx(2)}
            />
          )}
          {draft.workClass === "cleaning" && draft.isRecurring && (
            <ReviewBlock
              label="Recurrence"
              value={`Every ${recurringScheduleLabel(
                draft.recurringSchedule,
              ).toLowerCase()}${
                draft.startDate ? ` · next after ${draft.startDate}` : ""
              }`}
              onEdit={() => setStepIdx(2)}
            />
          )}
          {(draft.startDate || draft.endDate || draft.dueDate) && (
            <ReviewBlock
              label="Dates"
              value={[
                draft.startDate && `start ${draft.startDate}`,
                draft.endDate && `end ${draft.endDate}`,
                draft.dueDate && `due ${draft.dueDate}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              onEdit={() => setStepIdx(2)}
            />
          )}
          <ReviewBlock
            label="Assignee"
            value={
              selectedAssignee
                ? `${selectedAssignee.name} · ${selectedAssignee.role}`
                : "Unassigned"
            }
            onEdit={() => setStepIdx(2)}
          />
          {(draft.estimatedHours.trim() || draft.estimatedTotal.trim()) && (
            <ReviewBlock
              label="Estimate"
              value={[
                draft.estimatedHours.trim() &&
                  `${draft.estimatedHours} hrs`,
                draft.estimatedTotal.trim() && `$${draft.estimatedTotal}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              onEdit={() => setStepIdx(2)}
            />
          )}
          {draft.internalNotes.trim().length > 0 && (
            <ReviewBlock
              label="Internal notes"
              value={draft.internalNotes.trim()}
              onEdit={() => setStepIdx(2)}
            />
          )}

          <div className="mt-3 rounded-[10px] border border-primary/30 bg-primary-soft/30 p-3 text-[12px]">
            <div className="flex items-center gap-1.5 text-primary">
              <Sparkles className="size-3.5" />
              <span className="font-medium">On submit:</span>
            </div>
            <div className="ml-5 mt-1 text-fg-subtle">
              {draft.workClass === "cleaning"
                ? `Creates a cleaning work order in the Open column, linked to ${
                    cleaningSourceBoater?.display_name ?? "the customer"
                  }${
                    cleaningRentalBoat
                      ? ` and ${cleaningRentalBoat.name}`
                      : ""
                  }.`
                : `Creates the work order in the Open column, linked to the holder${
                    selectedVessel ? ", vessel" : ""
                  }${selectedSlip ? ", and slip" : ""}.`}
            </div>
          </div>
        </div>
      )}

      <WizardFooter
        stepIndex={visibleCurrentIdx}
        totalSteps={visibleSteps.length}
        stepLabel={STEPS[stepIdx].label}
        onBack={back}
        onContinue={stepIdx === STEPS.length - 1 ? submit : next}
        continueLabel={
          stepIdx === STEPS.length - 1 ? "Create work order" : "Continue"
        }
        continueDisabled={!canContinue}
        busy={submitting}
        onExit={close}
        busyLabel="Creating…"
      />
    </WizardShell>
  );
}
