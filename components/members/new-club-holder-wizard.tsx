"use client";

import * as React from "react";
import { Combobox } from "@/components/ui/combobox";
import { MultiCombobox } from "@/components/ui/multi-combobox";
import { Field, Select, TextInput } from "@/components/create-sheet";
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
  nextClubSubscriptionId,
  upsertClubSubscription,
  useBoaters,
  useClubSubscriptions,
  useContracts,
  useFeesForEntity,
  useClubPlans,
  useRates,
} from "@/lib/client-store";
import { SIGNED_OR_SENT_CONTRACT_STATUSES } from "@/lib/contracts";
import { formatMoney } from "@/lib/mock-data";
import type {
  ClubSubscription,
  CommunicationChannel,
} from "@/lib/types";
import { cn, formatPhoneInput, phoneDigitCount } from "@/lib/utils";

/*
 * New Boat Club Holder wizard — the canonical 5-step path for adding a
 * member to the Rental Club. Mirrors the slip-holder + reservation +
 * contract wizards so chrome, right-rail rollup, agent affordance, and
 * Review/Edit jump-backs are identical across every "+ New X" surface.
 *
 * Steps:
 *   0. Holder        — pick an existing non-slip-holder boater OR
 *                       inline-create a new one via NewBoaterSheet.
 *   1. Base plan     — single-select Rate row (Rental Club, monthly).
 *                       Snapshots monthly_fee + join_fee + days_per_month.
 *   2. Add-ons & fees — multi-select from Rental Club rates (any cadence)
 *                       + AdditionalFees scoped to club_subscription.
 *                       Grouped/sorted by cadence with inline suffix.
 *   3. Billing & channels — member_since (today by default),
 *                       next_billing_date (+1 month by default), and
 *                       optional booking/billing channel overrides.
 *   4. Review        — confirm and create. Calls upsertClubSubscription.
 */

const STORAGE_KEY = "marina_new_club_holder_v1";

const STEPS: WizardStep[] = [
  { id: "holder", label: "Holder" },
  { id: "plan", label: "Base plan" },
  { id: "addons", label: "Add-ons" },
  { id: "billing", label: "Billing" },
  { id: "review", label: "Review" },
];

const STEP_TITLES = [
  "Who's joining the club?",
  "Which plan do they want?",
  "Stack any add-ons or fees",
  "Set billing dates and channels",
  "Review and create",
];

const STEP_SUBTITLES = [
  "Capture the basics — name, email, phone, and how they want to hear from you. Already a slip holder? Use the link below to pick from your slip holders instead.",
  "The base plan snapshots their monthly fee, join fee, and day allotment. They're grandfathered into whatever you pick — catalog changes won't re-rate them.",
  "Tier upgrades, locker rentals, guest passes, setup fees. Mix one-time, monthly, and annual freely. Skip if none apply.",
  "Anchor the billing cycle and decide which channel they prefer for booking confirmations and billing receipts.",
  "Confirm the details. We'll create the membership and snapshot the plan amounts.",
];

type DraftState = {
  // Step 0 — either (a) the operator typed a brand new person into the
  // inline form (default path), or (b) they toggled the footer link and
  // picked an existing slip holder. boaterId is set on submit either
  // by the inline create call or by direct picker selection.
  boaterId: string;
  newFirst: string;
  newLast: string;
  newEmail: string;
  newPhone: string;
  newChannel: CommunicationChannel;
  // Step 1
  planRateId: string;
  // Step 2
  addonRateIds: string[];
  // Step 3
  memberSince: string;
  nextBillingDate: string;
  bookingChannel: "" | CommunicationChannel;
  billingChannel: "" | CommunicationChannel;
  notes: string;
};

// Cadence ordering + suffixes — match the unified pattern used by the
// Edit Membership dialog so the picker reads consistently.
const CADENCE_ORDER = new Map<string, number>([
  ["one_time", 0],
  ["monthly", 1],
  ["weekly", 2],
  ["daily", 3],
  ["seasonal", 4],
  ["annual", 5],
]);

const CADENCE_SUFFIX: Record<string, string> = {
  one_time: "one-time",
  monthly: "/mo",
  weekly: "/wk",
  daily: "/day",
  seasonal: "/season",
  annual: "/yr",
};

const CADENCE_GROUP_LABEL: Record<string, string> = {
  one_time: "One-time",
  monthly: "Monthly",
  annual: "Annual",
  weekly: "Weekly",
  daily: "Daily",
  seasonal: "Seasonal",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusOneMonthIso(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export function NewClubHolderWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
}) {
  const boaters = useBoaters();
  const contracts = useContracts();
  const subscriptions = useClubSubscriptions();
  const clubPlans = useClubPlans();
  const allRates = useRates();
  const clubSubFees = useFeesForEntity("club_subscription");

  const [submitting, setSubmitting] = React.useState(false);
  // Step 0 has two modes. Default = inline new-person form. Toggling
  // the footer link flips to a slip-holder picker (no other boater
  // populations show — picking a non-slip-holder boater isn't a real
  // use case, and existing club members are filtered out either way).
  const [usePicker, setUsePicker] = React.useState(false);

  // sessionStorage-backed wizard state.
  const [persisted, setPersisted, clearPersisted] = useWizardDraft<{
    step: number;
    draft: DraftState;
  }>(STORAGE_KEY, () => ({
    step: 0,
    draft: {
      boaterId: "",
      newFirst: "",
      newLast: "",
      newEmail: "",
      newPhone: "",
      newChannel: "email",
      planRateId: "",
      addonRateIds: [],
      memberSince: todayIso(),
      nextBillingDate: plusOneMonthIso(),
      bookingChannel: "",
      billingChannel: "",
      notes: "",
    },
  }));

  const stepIdx = persisted.step;
  const draft = persisted.draft;
  // setStepIdx / setDraft short-circuit when the inner value is
  // identity-equal — without this, every call allocates a new
  // `persisted` ref and triggers a re-render even on no-op updates.
  // The pruning effect below calls setDraft on every addonRows render,
  // so a no-op MUST stay no-op or we infinite-loop.
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

  // ── Holder candidate pool ────────────────────────────────────────────
  // Filter ONLY existing club members — a slip holder joining the club
  // is a legit cross-sell path, and we don't want the operator creating
  // a duplicate boater record for someone we already have on file. The
  // only "double enrollment" we actively prevent is the same boater
  // having two club subscriptions at once.
  const existingMemberIds = React.useMemo(() => {
    const set = new Set<string>();
    for (const s of subscriptions) {
      if (
        s.status === "active" ||
        s.status === "paused" ||
        s.status === "past_due"
      ) {
        set.add(s.boater_id);
      }
    }
    return set;
  }, [subscriptions]);
  // Slip-holder lookup for the "· slip B-12" hint in the dropdown,
  // so the operator can tell at a glance who's already a dock customer.
  // Uses the narrower SIGNED_OR_SENT set (no `draft`) — a draft contract
  // isn't real enough to gate cross-sell. Behavior preserved verbatim
  // from the inlined set this replaced.
  const slipHolderIds = React.useMemo(() => {
    const set = new Set<string>();
    for (const c of contracts) {
      if (SIGNED_OR_SENT_CONTRACT_STATUSES.has(c.status)) set.add(c.boater_id);
    }
    return set;
  }, [contracts]);
  // Slip-holder-only candidate pool. This wizard CREATES a brand new
  // club member by default — the picker is only there for the
  // cross-sell case where a slip holder is now also joining the club
  // and we don't want a duplicate boater record. Existing club members
  // never appear (can't double-enroll).
  const candidateBoaters = React.useMemo(
    () =>
      boaters.filter(
        (b) => slipHolderIds.has(b.id) && !existingMemberIds.has(b.id)
      ),
    [boaters, slipHolderIds, existingMemberIds]
  );

  const selectedBoater = boaters.find((b) => b.id === draft.boaterId);

  // ── Plan options ────────────────────────────────────────────────────
  const planOptions = React.useMemo(
    () =>
      clubPlans.map((p) => ({
        value: p.id,
        label: `${p.name} — ${formatMoney(p.amount)}/mo`,
        hint: p.days_per_month
          ? `· ${p.days_per_month} days/mo`
          : undefined,
      })),
    [clubPlans]
  );
  const selectedPlan = clubPlans.find((p) => p.id === draft.planRateId);
  // Setup fee for the selected tier — now its own catalog Rate row
  // (cadence: one_time, plan_tier matching the parent plan). The
  // wizard surfaces this amount in the right-rail, review block,
  // and the signup snapshot.
  const selectedSetupRate = React.useMemo(
    () =>
      selectedPlan?.plan_tier
        ? allRates.find(
            (r) =>
              r.occupancy_type === "Rental Club" &&
              r.cadence === "one_time" &&
              r.plan_tier === selectedPlan.plan_tier
          )
        : undefined,
    [allRates, selectedPlan]
  );

  // ── Add-on options — unified Rate (Rental Club, any cadence) +
  // AdditionalFee (scoped to club_subscription), sorted by cadence then
  // label. Same structure used by the Edit Membership dialog.
  type AddonRow = {
    id: string;
    name: string;
    description?: string;
    amount: number;
    cadence: string;
    sortKey: number;
  };
  const addonRows = React.useMemo<AddonRow[]>(() => {
    const rateRows: AddonRow[] = allRates
      .filter((r) => r.occupancy_type === "Rental Club")
      .map((r) => ({
        id: r.id,
        name: r.name,
        amount: r.amount,
        cadence: r.cadence,
        sortKey: CADENCE_ORDER.get(r.cadence) ?? 99,
      }));
    const feeRows: AddonRow[] = clubSubFees.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      amount: f.amount,
      cadence: f.cadence ?? "one_time",
      sortKey: CADENCE_ORDER.get(f.cadence ?? "one_time") ?? 99,
    }));
    return [...rateRows, ...feeRows].sort(
      (a, b) => a.sortKey - b.sortKey || a.name.localeCompare(b.name)
    );
  }, [allRates, clubSubFees]);

  // If the operator toggles base plan after picking it as an add-on (or
  // an add-on row disappears from the catalog), prune the selection.
  React.useEffect(() => {
    const allowed = new Set(addonRows.map((r) => r.id));
    setDraft((d) => {
      if (d.addonRateIds.length === 0) return d;
      const filtered = d.addonRateIds.filter(
        (id) => allowed.has(id) && id !== d.planRateId
      );
      return filtered.length === d.addonRateIds.length
        ? d
        : { ...d, addonRateIds: filtered };
    });
  }, [addonRows, setDraft]);

  // ── Add-on roll-up for the right rail ───────────────────────────────
  const addonRollup = React.useMemo(() => {
    let oneTime = 0;
    let monthly = 0;
    let annual = 0;
    for (const id of draft.addonRateIds) {
      const row = addonRows.find((r) => r.id === id);
      if (!row) continue;
      if (row.cadence === "monthly") monthly += row.amount;
      else if (row.cadence === "annual") annual += row.amount;
      else oneTime += row.amount;
    }
    return { oneTime, monthly, annual };
  }, [draft.addonRateIds, addonRows]);

  // ── Validation gates ────────────────────────────────────────────────
  // canStep0: picker mode = boater chosen; form mode = required fields valid.
  const newPersonEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    draft.newEmail.trim()
  );
  const newPersonPhoneValid = phoneDigitCount(draft.newPhone) === 10;
  const newPersonFormValid =
    draft.newFirst.trim().length > 0 &&
    draft.newLast.trim().length > 0 &&
    newPersonEmailValid &&
    newPersonPhoneValid;
  const canStep0 = usePicker
    ? draft.boaterId.length > 0
    : draft.boaterId.length > 0 || newPersonFormValid;
  const canStep1 = draft.planRateId.length > 0;
  const canStep2 = true; // add-ons are always optional
  const canStep3 =
    draft.memberSince.length > 0 && draft.nextBillingDate.length > 0;
  const canStep4 = canStep0 && canStep1 && canStep2 && canStep3;
  const canContinue = [canStep0, canStep1, canStep2, canStep3, canStep4][
    stepIdx
  ];

  // ── Actions ─────────────────────────────────────────────────────────
  function generateHolderCode(): string {
    const stamp = Date.now().toString(36).slice(-4).toUpperCase();
    return `MB-${stamp}`;
  }
  function next() {
    // Step 0 — if the operator filled the inline form (no picker
    // boater chosen), create the boater on the fly so subsequent
    // steps have a real boaterId to attach the membership to.
    if (stepIdx === 0 && !draft.boaterId && newPersonFormValid) {
      const result = executeAgentAction({
        kind: "create_boater",
        label: "",
        first_name: draft.newFirst.trim(),
        last_name: draft.newLast.trim(),
        email: draft.newEmail.trim(),
        phone: draft.newPhone.trim(),
        code: generateHolderCode(),
        preferred_channel: draft.newChannel,
        billing_cadence: "transient",
      });
      if (!result.ok || !result.createdId) return;
      setDraft((d) => ({ ...d, boaterId: result.createdId! }));
    }
    if (stepIdx < STEPS.length - 1) setStepIdx((i) => i + 1);
  }
  function back() {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  }
  function close() {
    onOpenChange(false);
  }

  function submit() {
    if (!canStep4 || !selectedPlan) return;
    setSubmitting(true);
    try {
      const subId = nextClubSubscriptionId();
      const sub: ClubSubscription = {
        id: subId,
        boater_id: draft.boaterId,
        plan_rate_id: draft.planRateId,
        additional_rate_ids:
          draft.addonRateIds.length > 0 ? draft.addonRateIds : undefined,
        // Snapshot anchor — grandfathers the member into the catalog
        // values at signup. Mirrors the upsert path in rental-club-view.
        joined_at_monthly_fee: selectedPlan.amount,
        joined_at_join_fee: selectedSetupRate?.amount,
        joined_at_days_per_month: selectedPlan.days_per_month,
        status: "active",
        member_since: draft.memberSince,
        next_billing_date: draft.nextBillingDate,
        booking_channel: draft.bookingChannel || undefined,
        billing_channel: draft.billingChannel || undefined,
        notes: draft.notes.trim() || undefined,
      };
      upsertClubSubscription(sub);
      // created_at isn't on ClubSubscription's shape — the store stamps
      // its own internal record. We deliberately mint a fresh Date here
      // in the handler so any later timestamping needs (audit log) read
      // a per-submit timestamp, not a stale prop value.
      void new Date();
      clearPersisted();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────
  if (!open) return null;

  const reviewAddonSummary = (() => {
    if (draft.addonRateIds.length === 0) return "None";
    const names = addonRows
      .filter((r) => draft.addonRateIds.includes(r.id))
      .map(
        (r) =>
          `${r.name} (${formatMoney(r.amount)}${
            CADENCE_SUFFIX[r.cadence] ? " " + CADENCE_SUFFIX[r.cadence] : ""
          })`
      )
      .join(", ");
    return names;
  })();

  return (
    <>
      <WizardShell
        eyebrow="New club holder"
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
        {/* Step 0 — Holder. Defaults to an inline new-person form so
            adding a brand new club member is one keystroke away.
            Footer toggle flips to a slip-holder picker for the
            cross-sell case (existing slip customer joining the club —
            don't create a duplicate boater record). */}
        {stepIdx === 0 && !usePicker && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" required>
                <TextInput
                  value={draft.newFirst}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, newFirst: e.target.value }))
                  }
                  placeholder="Sarah"
                />
              </Field>
              <Field label="Last name" required>
                <TextInput
                  value={draft.newLast}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, newLast: e.target.value }))
                  }
                  placeholder="Reyes"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email" required>
                <TextInput
                  type="email"
                  value={draft.newEmail}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, newEmail: e.target.value }))
                  }
                  placeholder="sarah@example.com"
                />
              </Field>
              <Field label="Phone" required>
                <TextInput
                  type="tel"
                  inputMode="tel"
                  value={draft.newPhone}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      newPhone: formatPhoneInput(e.target.value),
                    }))
                  }
                  placeholder="(555) 555-0123"
                />
              </Field>
            </div>
            <Field label="Preferred channel">
              <Select
                value={draft.newChannel}
                onChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    newChannel: v as CommunicationChannel,
                  }))
                }
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="voice">Voice</option>
              </Select>
            </Field>

            <div className="border-t border-hairline pt-3 text-center text-[12px] text-fg-subtle">
              Already a slip holder?{" "}
              <button
                type="button"
                onClick={() => setUsePicker(true)}
                className="font-medium text-primary hover:underline"
              >
                Pick from your slip holders
              </button>
            </div>
          </div>
        )}

        {stepIdx === 0 && usePicker && (
          <div className="space-y-4">
            <FieldLabel
              label="Slip holder"
              required
              hint="Only current slip holders are listed. Picking one here avoids creating a duplicate boater record."
            >
              <Combobox
                value={draft.boaterId}
                onChange={(v) => setDraft((d) => ({ ...d, boaterId: v }))}
                options={candidateBoaters.map((b) => ({
                  value: b.id,
                  label: b.display_name,
                  hint: b.code ? `· ${b.code}` : undefined,
                }))}
                placeholder="Search slip holders…"
                searchPlaceholder="Search by name or code…"
              />
            </FieldLabel>

            {selectedBoater && (
              <div className="rounded-[10px] border border-hairline bg-surface-2 p-4">
                <div className="text-[13px] font-medium text-fg">
                  {selectedBoater.display_name}
                  <span className="ml-2 rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    Slip holder
                  </span>
                </div>
                <div className="mt-1 text-[12px] text-fg-subtle">
                  {selectedBoater.primary_contact?.email || "no email"} ·{" "}
                  {selectedBoater.primary_contact?.phone || "no phone"}
                </div>
              </div>
            )}

            <div className="border-t border-hairline pt-3 text-center text-[12px] text-fg-subtle">
              Not a slip holder?{" "}
              <button
                type="button"
                onClick={() => {
                  setUsePicker(false);
                  setDraft((d) => ({ ...d, boaterId: "" }));
                }}
                className="font-medium text-primary hover:underline"
              >
                Add a new person instead
              </button>
            </div>
          </div>
        )}

        {/* Step 1 — Base plan */}
        {stepIdx === 1 && (
          <div className="space-y-4">
            {clubPlans.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 p-6 text-center text-[13px] text-fg-subtle">
                No club plans configured yet. Add one in{" "}
                <strong>Services &rarr; Rental Club</strong> first.
              </div>
            ) : (
              <FieldLabel
                label="Plan"
                required
                hint="Snapshots the member's monthly fee, join fee, and day allotment. Future catalog edits don't re-rate grandfathered members."
              >
                <Combobox
                  value={draft.planRateId}
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, planRateId: v }))
                  }
                  options={planOptions}
                  placeholder="Pick a plan…"
                  searchPlaceholder="Search plans…"
                />
              </FieldLabel>
            )}

            {selectedPlan && (
              <div className="rounded-[10px] border border-hairline bg-surface-2 p-4">
                <div className="text-[13px] font-medium text-fg">
                  {selectedPlan.name}
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-3 text-[12px]">
                  <div>
                    <dt className="text-fg-tertiary">Monthly</dt>
                    <dd className="money-display mt-0.5 text-[15px] text-fg">
                      {formatMoney(selectedPlan.amount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-tertiary">Allotment</dt>
                    <dd className="money-display mt-0.5 text-[15px] text-fg">
                      {selectedPlan.days_per_month ?? "—"}
                      <span className="ml-1 text-[11px] font-normal text-fg-tertiary">
                        days/mo
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-tertiary">Setup fee</dt>
                    <dd className="money-display mt-0.5 text-[15px] text-fg">
                      {selectedSetupRate && selectedSetupRate.amount > 0
                        ? formatMoney(selectedSetupRate.amount)
                        : "—"}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        )}

        {/* Step 2 — Add-ons & fees */}
        {stepIdx === 2 && (
          <div className="space-y-4">
            {addonRows.filter((r) => r.id !== draft.planRateId).length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 p-6 text-center text-[13px] text-fg-subtle">
                No add-ons available. Configure Rental Club rates or club
                subscription fees in{" "}
                <strong>Services &rarr; Rental Club</strong> and{" "}
                <strong>Services &rarr; Fees</strong>, or continue to skip.
              </div>
            ) : (
              <FieldLabel
                label="Service rates & fees (optional)"
                hint="Mix one-time, monthly, and annual freely. Skip anything you want to waive — you can attach more later from the membership page."
              >
                <MultiCombobox
                  value={draft.addonRateIds}
                  onChange={(next) =>
                    setDraft((d) => ({ ...d, addonRateIds: next }))
                  }
                  options={addonRows
                    .filter((r) => r.id !== draft.planRateId)
                    .map((r) => ({
                      value: r.id,
                      label: r.name,
                      sub: CADENCE_GROUP_LABEL[r.cadence] ?? r.cadence,
                      trailing: `${formatMoney(r.amount)}${
                        CADENCE_SUFFIX[r.cadence]
                          ? " " + CADENCE_SUFFIX[r.cadence]
                          : ""
                      }`,
                    }))}
                  placeholder="Pick add-ons & fees…"
                  searchPlaceholder="Search add-ons…"
                />
              </FieldLabel>
            )}
          </div>
        )}

        {/* Step 3 — Billing & channels */}
        {stepIdx === 3 && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldLabel
                label="Member since"
                required
                hint="Anchor date for the membership. Defaults to today."
              >
                <input
                  type="date"
                  value={draft.memberSince}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      memberSince: e.target.value,
                    }))
                  }
                  className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
                />
              </FieldLabel>
              <FieldLabel
                label="Next billing"
                required
                hint="When the next monthly fee posts. Defaults to one month from today."
              >
                <input
                  type="date"
                  value={draft.nextBillingDate}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      nextBillingDate: e.target.value,
                    }))
                  }
                  className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
                />
              </FieldLabel>
            </div>

            <FieldLabel
              label="Booking confirmations via"
              hint="Where the member wants arrival reminders + booking confirmations. Leave default to use their primary preferred channel."
            >
              <div className="grid gap-2 sm:grid-cols-4">
                {(
                  [
                    { value: "", label: "Default" },
                    { value: "email", label: "Email" },
                    { value: "sms", label: "SMS" },
                    { value: "voice", label: "Voice" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value || "default"}
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        bookingChannel: opt.value,
                      }))
                    }
                    className={cn(
                      "rounded-[10px] border px-3 py-2 text-center text-[12px] font-medium transition-colors",
                      draft.bookingChannel === opt.value
                        ? "border-primary bg-primary-soft/40 text-primary"
                        : "border-hairline bg-surface-1 text-fg-subtle hover:bg-surface-2"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </FieldLabel>

            <FieldLabel
              label="Billing receipts via"
              hint="Many members prefer email for paper trail even if they get booking comms by SMS."
            >
              <div className="grid gap-2 sm:grid-cols-4">
                {(
                  [
                    { value: "", label: "Default" },
                    { value: "email", label: "Email" },
                    { value: "sms", label: "SMS" },
                    { value: "voice", label: "Voice" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value || "default"}
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        billingChannel: opt.value,
                      }))
                    }
                    className={cn(
                      "rounded-[10px] border px-3 py-2 text-center text-[12px] font-medium transition-colors",
                      draft.billingChannel === opt.value
                        ? "border-primary bg-primary-soft/40 text-primary"
                        : "border-hairline bg-surface-1 text-fg-subtle hover:bg-surface-2"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </FieldLabel>

            <FieldLabel
              label="Notes"
              hint="Anything staff should know — referral source, seasonal availability, special handling."
            >
              <textarea
                rows={3}
                value={draft.notes}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, notes: e.target.value }))
                }
                placeholder="Referred by Tim Chen. Weekends only."
                className="block w-full resize-y rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[14px] leading-5 text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
              />
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
                      selectedBoater.primary_contact?.email
                        ? ` · ${selectedBoater.primary_contact.email}`
                        : ""
                    }`
                  : "—"
              }
              onEdit={() => setStepIdx(0)}
            />
            <ReviewBlock
              label="Base plan"
              value={
                selectedPlan
                  ? `${selectedPlan.name} · ${formatMoney(
                      selectedPlan.amount
                    )}/mo${
                      selectedPlan.days_per_month != null
                        ? ` · ${selectedPlan.days_per_month} days/mo`
                        : ""
                    }${
                      selectedSetupRate && selectedSetupRate.amount > 0
                        ? ` · ${formatMoney(selectedSetupRate.amount)} setup`
                        : ""
                    }`
                  : "—"
              }
              onEdit={() => setStepIdx(1)}
            />
            <ReviewBlock
              label={`Add-ons${
                draft.addonRateIds.length > 0
                  ? ` (${draft.addonRateIds.length})`
                  : ""
              }`}
              value={reviewAddonSummary}
              onEdit={() => setStepIdx(2)}
            />
            <ReviewBlock
              label="Member since"
              value={draft.memberSince}
              onEdit={() => setStepIdx(3)}
            />
            <ReviewBlock
              label="Next billing"
              value={draft.nextBillingDate}
              onEdit={() => setStepIdx(3)}
            />
            <ReviewBlock
              label="Booking channel"
              value={draft.bookingChannel || "Default — fall through"}
              capitalize={draft.bookingChannel !== ""}
              onEdit={() => setStepIdx(3)}
            />
            <ReviewBlock
              label="Billing channel"
              value={draft.billingChannel || "Default — fall through"}
              capitalize={draft.billingChannel !== ""}
              onEdit={() => setStepIdx(3)}
            />
            {draft.notes.trim().length > 0 && (
              <ReviewBlock
                label="Notes"
                value={draft.notes.trim()}
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
          continueLabel={
            stepIdx === STEPS.length - 1 ? "Create membership" : "Continue"
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
