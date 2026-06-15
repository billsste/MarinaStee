"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilterSelect } from "@/components/ui/list-filter-select";
import { LocalTime } from "@/components/ui/local-time";
import { useClubBookingDrawer } from "@/components/members/club-booking-drawer";
import { NewClubBookingSheet } from "@/components/members/new-club-booking-sheet";
import { NewClubHolderWizard } from "@/components/members/new-club-holder-wizard";
import {
  cancelClubSubscription,
  checkAutoResumes,
  deleteClubSubscription,
  effectivePlanFor,
  getClubChurnRisks,
  nextClubSubscriptionId,
  pauseClubSubscription,
  resumeClubSubscription,
  runClubMonthlyBilling,
  sendClubReactivationComms,
  upsertClubSubscription,
  useBoaters,
  useCleaningWoBySource,
  useClubBookings,
  useClubPlans,
  useClubSubscriptions,
  useContracts,
  useFeesForEntity,
  useRates,
  useSetupRateForTier,
} from "@/lib/client-store";
import { SIGNED_OR_SENT_CONTRACT_STATUSES } from "@/lib/contracts";
import { formatMoney } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import type { Boater, ClubBooking, ClubSubscription } from "@/lib/types";

/*
 * Members → Rental Club module.
 *
 * Three sub-views surfaced as Panels stacked on one page:
 *   1. KPI strip — active members, monthly revenue, MRR, booking load
 *   2. Member table — subscription roster (click row → edit dialog)
 *   3. Booking calendar — month grid showing each member's scheduled days
 *
 * Bookings hook into the existing reservation flow only conceptually; the
 * club fleet uses RentalBoat ids that already exist in seed (rb_pontoon_1
 * etc.), so on-water dock staff see them in the same Boat Rentals
 * pipeline. The calendar here is the club-side scheduling tool.
 */

// Module-level constants — pure data, no React deps. Hoisted out of
// the component so referential identity is stable across renders and
// callers don't need to thread them through useMemo deps arrays.
//
// The slip-holder predicate (executed/active/partially_signed/sent —
// drops `draft`) lives in lib/contracts.ts as
// SIGNED_OR_SENT_CONTRACT_STATUSES. Deliberately the NARROWER set, not
// the broader LIVE_CONTRACT_STATUSES — a draft-only contract isn't a
// real slip-holder yet, so those boaters should remain in the rental
// club candidate pool.
const CADENCE_ORDER: ReadonlyMap<string, number> = new Map([
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

const SUBSCRIPTION_FIELDS: FieldSpec<ClubSubscription>[] = [
  {
    key: "boater_id",
    label: "Member",
    kind: "select",
    required: true,
    col: 2,
    // populated at render time from live boaters list
    options: [],
  },
  {
    key: "plan_rate_id",
    label: "Base plan",
    kind: "select",
    required: true,
    col: 2,
    hint: "The primary tier — snapshots the member's grandfathered monthly fee. Managed in Services → Rental Club.",
    // populated at render time from live club plans (Rate catalog)
    options: [],
  },
  {
    // Multi-attach service rates + fees across cadences (one-time,
    // monthly, annual). Operators stack setup fees, tier upgrades,
    // locker rentals, etc. here. Snapshots aren't taken for these
    // (they re-rate with the catalog); only the base plan grandfathers.
    // Matches the catalog-attach pattern used by reservations + rental
    // boats. To "waive" a fee the operator simply doesn't attach it
    // (or removes it from an existing membership).
    key: "additional_rate_ids",
    label: "Service rates & fees",
    kind: "multiselect",
    col: 2,
    hint: "Mix one-time + monthly + annual rates and fees. Each shows its cadence inline. Skip anything you want to waive.",
    options: [],
  },
  {
    key: "status",
    label: "Status",
    kind: "select",
    col: 2,
    options: [
      { value: "active", label: "Active" },
      { value: "past_due", label: "Past due" },
      { value: "paused", label: "Paused" },
      { value: "cancelled", label: "Cancelled" },
    ],
  },
  { key: "member_since", label: "Member since", kind: "date", col: 2 },
  { key: "next_billing_date", label: "Next billing", kind: "date", col: 2 },
  // Channel overrides — when blank, fall back to the boater's primary
  // preferred_channel. Same options as the boater profile, plus blank.
  {
    key: "booking_channel",
    label: "Booking confirmations via",
    kind: "select",
    col: 2,
    hint: "Where the member wants arrival reminders + booking confirmations.",
    options: [
      { value: "", label: "— default —" },
      { value: "email", label: "Email" },
      { value: "sms", label: "SMS" },
      { value: "voice", label: "Voice" },
    ],
  },
  {
    key: "billing_channel",
    label: "Billing receipts via",
    kind: "select",
    col: 2,
    hint: "Where the member wants monthly receipts. Many prefer email for paper trail.",
    options: [
      { value: "", label: "— default —" },
      { value: "email", label: "Email" },
      { value: "sms", label: "SMS" },
      { value: "voice", label: "Voice" },
    ],
  },
  { key: "notes", label: "Notes", kind: "textarea" },
];

export function RentalClubView() {
  const subscriptions = useClubSubscriptions();
  const bookings = useClubBookings();
  const boaters = useBoaters();
  const contracts = useContracts();

  // Auto-resume sweep — runs once on mount. Flips any paused sub whose
  // resume_on date has passed back to active. Idempotent; safe to call
  // on every navigation to this surface. Replaces the cron the real
  // backend would have.
  React.useEffect(() => {
    checkAutoResumes();
  }, []);

  // Live-populate the member + plan dropdowns for the dialog.
  //
  // Slip-holder boaters are a different population from Rental Club
  // members and shouldn't surface here — operators kept seeing their
  // dock-side residents bleed into the club roster picker. A boater
  // counts as a slip holder when they have a Contract in a live status
  // (executed / active / partially_signed / sent). Terminated /
  // expired contracts free the boater back into the candidate pool.
  // Existing club members are always included regardless, so editing
  // an existing membership never loses its holder.
  const slipHolderIds = React.useMemo(() => {
    const set = new Set<string>();
    for (const c of contracts) {
      if (SIGNED_OR_SENT_CONTRACT_STATUSES.has(c.status)) set.add(c.boater_id);
    }
    return set;
  }, [contracts]);
  const existingMemberIds = React.useMemo(
    () => new Set(subscriptions.map((s) => s.boater_id)),
    [subscriptions]
  );
  const memberOptions = React.useMemo(
    () =>
      boaters
        .filter(
          (b) => existingMemberIds.has(b.id) || !slipHolderIds.has(b.id)
        )
        .map((b) => ({ value: b.id, label: b.display_name })),
    [boaters, slipHolderIds, existingMemberIds]
  );
  // Plans come from the Services catalog (Rate rows with
  // occupancy_type=Rental Club + cadence=monthly). Operators manage
  // them in Services → Rental Club. Single source of truth: no
  // manual fee entry on the membership form.
  const clubPlans = useClubPlans();
  const planOptions = React.useMemo(
    () =>
      clubPlans.map((p) => ({
        value: p.id,
        label: `${p.name} — ${formatMoney(p.amount)}/mo · ${p.days_per_month ?? "?"} days`,
      })),
    [clubPlans]
  );
  // Add-on rate options — pull from the FULL service catalog so an
  // operator can mix cadences on a single membership: a one-time
  // setup fee + a monthly tier upgrade + an annual locker rental,
  // etc. Without this breadth the only attachable extras were monthly
  // tier rates, which forced operators to type non-monthly fees into
  // notes or skip them entirely.
  //
  // Sources mixed:
  //   - Rate rows where occupancy_type === "Rental Club" (any cadence)
  //   - AdditionalFee rows with applies_to_entities including
  //     "club_subscription" (the unified catalog-attach surface)
  //
  // Each option carries its cadence inline in the label so the
  // operator never has to guess whether they just attached a one-time
  // charge vs a recurring one. Operators waive a fee by not attaching
  // it (or by removing it from an existing membership).
  const allRates = useRates();
  const clubSubFees = useFeesForEntity("club_subscription");
  const addonOptions = React.useMemo(() => {
    // Rental Club rates across every cadence (not just monthly tiers)
    const rateOpts = allRates
      .filter((r) => r.occupancy_type === "Rental Club")
      .map((r) => ({
        id: r.id,
        sortKey: CADENCE_ORDER.get(r.cadence) ?? 99,
        label: `${r.name} — ${formatMoney(r.amount)}${
          CADENCE_SUFFIX[r.cadence] ?? ""
        }`,
      }));
    // AdditionalFees scoped to club subscriptions — unified catalog
    // attach point so operators can stack things like locker rentals
    // or guest pass packages on top of the base plan.
    const feeOpts = clubSubFees.map((f) => ({
      id: f.id,
      sortKey: CADENCE_ORDER.get(f.cadence ?? "one_time") ?? 99,
      label: `${f.name} — ${formatMoney(f.amount)}${
        CADENCE_SUFFIX[f.cadence ?? "one_time"] ?? ""
      }`,
    }));
    return [...rateOpts, ...feeOpts]
      .sort((a, b) => a.sortKey - b.sortKey || a.label.localeCompare(b.label))
      .map(({ id, label }) => ({ value: id, label }));
  }, [allRates, clubSubFees]);
  const subFields = React.useMemo(() => {
    return SUBSCRIPTION_FIELDS.map((f) => {
      if (f.key === "boater_id") return { ...f, options: memberOptions };
      if (f.key === "plan_rate_id") return { ...f, options: planOptions };
      if (f.key === "additional_rate_ids")
        return { ...f, options: addonOptions };
      return f;
    });
  }, [memberOptions, planOptions, addonOptions]);

  // Subscription edit dialog state — the legacy RecordEditDialog is now
  // edit-only. New club memberships go through the canonical 5-step
  // NewClubHolderWizard (modal chrome, right-rail rollup, agent
  // affordance) launched separately below.
  const [subOpen, setSubOpen] = React.useState(false);
  const [editingSub, setEditingSub] = React.useState<ClubSubscription | undefined>();
  const [newClubWizardOpen, setNewClubWizardOpen] = React.useState(false);

  function openNewSub() {
    setNewClubWizardOpen(true);
  }
  function openEditSub(s: ClubSubscription) {
    setEditingSub(s);
    setSubOpen(true);
  }
  function handleSaveSub(values: ClubSubscription) {
    // New membership snapshots the plan's amounts at signup. Edits to
    // an existing membership leave the snapshot alone (members are
    // grandfathered into what they signed).
    const planRateId = values.plan_rate_id || clubPlans[0]?.id;
    if (!planRateId) {
      window.alert(
        "No club plans defined. Add one in Services → Rental Club first."
      );
      return;
    }
    const isNew = !editingSub?.id;
    const plan = clubPlans.find((p) => p.id === planRateId);
    // Sanitize add-on rates: drop the base plan if the operator
    // accidentally picked it as both base + add-on (double-count), and
    // dedupe. Empty array gets normalized to undefined so the field
    // doesn't pollute snapshots that don't need it.
    const rawAddons = Array.isArray(values.additional_rate_ids)
      ? values.additional_rate_ids
      : [];
    const cleanedAddons = Array.from(
      new Set(rawAddons.filter((id) => id && id !== planRateId))
    );
    upsertClubSubscription({
      ...values,
      id: values.id || editingSub?.id || nextClubSubscriptionId(),
      plan_rate_id: planRateId,
      additional_rate_ids: cleanedAddons.length > 0 ? cleanedAddons : undefined,
      // Snapshot on insert. On edit, preserve existing snapshot fields
      // so amounts don't silently re-rate after a plan-tier change.
      // Setup fee is read from its own catalog Rate (one_time, same
      // plan_tier as the parent monthly plan) — not from the plan
      // row itself. See getSetupRateForTier().
      joined_at_monthly_fee: isNew
        ? plan?.amount
        : values.joined_at_monthly_fee ?? editingSub?.joined_at_monthly_fee,
      joined_at_join_fee: isNew
        ? allRates.find(
            (r) =>
              r.occupancy_type === "Rental Club" &&
              r.cadence === "one_time" &&
              r.plan_tier === plan?.plan_tier
          )?.amount
        : values.joined_at_join_fee ?? editingSub?.joined_at_join_fee,
      joined_at_days_per_month: isNew
        ? plan?.days_per_month
        : values.joined_at_days_per_month ?? editingSub?.joined_at_days_per_month,
      status: values.status || "active",
      member_since:
        values.member_since || new Date().toISOString().slice(0, 10),
    });
  }
  // Soft-cancel — the canonical lifecycle action. Sets status=cancelled,
  // future bookings get cancelled too, but the record + billing history
  // stay intact for accounting. Mid-month cancellation automatically
  // posts a pro-rate refund.
  function handleCancelSub(s: ClubSubscription) {
    const name = boaterName(boaters, s.boater_id);
    if (
      !window.confirm(
        `Cancel ${name}'s club membership? Future bookings will be cancelled. Mid-month cancellation auto-issues a pro-rate refund for the unused portion.`
      )
    )
      return;
    const result = cancelClubSubscription(s.id);
    if (result.ok && result.refundAmount > 0) {
      window.alert(
        `Cancelled. ${formatMoney(result.refundAmount)} pro-rated refund posted to ${name}'s ledger.`
      );
    }
  }
  // Pause / Resume — for the "I'm traveling for a month" case. No
  // refund issued (member chose to pause), no billing while paused,
  // forward bookings cancelled. Resume flips back to active.
  function handlePauseResumeSub(s: ClubSubscription) {
    const name = boaterName(boaters, s.boater_id);
    if (s.status === "active") {
      if (
        !window.confirm(
          `Pause ${name}'s membership? Monthly billing stops and forward bookings will be cancelled. Resume anytime.`
        )
      )
        return;
      pauseClubSubscription(s.id);
    } else if (s.status === "paused") {
      if (!window.confirm(`Resume ${name}'s membership? Billing will restart on the next cycle.`)) return;
      resumeClubSubscription(s.id);
    }
  }

  // Hard delete — admin cleanup. Removes the record + all bookings
  // (including history). Only reachable from the edit dialog's Delete
  // button so it's not the default action.
  function handleDeleteSub(s: ClubSubscription) {
    const name = boaterName(boaters, s.boater_id);
    if (
      !window.confirm(
        `Delete ${name}'s club record entirely? This wipes all bookings + history. Use Cancel instead if you want to preserve the audit trail.`
      )
    )
      return;
    deleteClubSubscription(s.id);
  }

  // Membership KPIs only — booking-side KPIs (booked days, pending
  // requests) live on /bookings?tab=fleet now. Members stays focused on
  // roster health and retention.
  const stats = React.useMemo(() => {
    const active = subscriptions.filter((s) => s.status === "active");
    const pastDue = subscriptions.filter((s) => s.status === "past_due");
    const mrr = active.reduce(
      (sum, s) => sum + (effectivePlanFor(s)?.monthly_fee ?? 0),
      0
    );
    return { activeCount: active.length, pastDueCount: pastDue.length, mrr };
  }, [subscriptions]);

  // Roster toolbar state — search + plan + status filters. Mirrors the
  // canonical Services toolbar pattern (see Slips roster). Plan options
  // are derived from the live effective plans on subscriptions, falling
  // back to the canonical tiers so the dropdown is never empty.
  const [query, setQuery] = React.useState("");
  const [planFilter, setPlanFilter] = React.useState<string>("all");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");

  const planTierOptions = React.useMemo(() => {
    const tiers = new Set<string>();
    for (const s of subscriptions) {
      const tier = effectivePlanFor(s)?.plan_tier;
      if (tier) tiers.add(tier);
    }
    const fallback = ["basic", "plus", "premium"];
    const list = tiers.size > 0 ? Array.from(tiers) : fallback;
    // Stable ordering: basic → plus → premium → anything else alpha.
    const order = new Map(fallback.map((t, i) => [t, i] as const));
    return list.sort(
      (a, b) =>
        (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b)
    );
  }, [subscriptions]);

  const statusCounts = React.useMemo(() => {
    const c = { active: 0, past_due: 0, paused: 0, cancelled: 0 };
    for (const s of subscriptions) {
      if (s.status in c) c[s.status as keyof typeof c] += 1;
    }
    return c;
  }, [subscriptions]);

  const filteredSubscriptions = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return subscriptions.filter((s) => {
      if (planFilter !== "all") {
        if ((effectivePlanFor(s)?.plan_tier ?? "") !== planFilter) return false;
      }
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (q) {
        const name = boaterName(boaters, s.boater_id).toLowerCase();
        if (!name.includes(q)) return false;
      }
      return true;
    });
  }, [subscriptions, query, planFilter, statusFilter, boaters]);

  return (
    // Agent lives on the parent layout (members-client.tsx) — keeps
    // the agent → toolbar gap identical between /members → Slip
    // Holders and /members → Rental Club, and persists across the
    // sub-nav switch instead of re-mounting every time.
    <div className="space-y-5">
          {/* Single-row toolbar — search + plan + status, with the
              roster action cluster (Reactivate, Post billing, New) on
              the right. Mirrors the canonical Services toolbar pattern
              (see components/rentals/roster-view.tsx). */}
          <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-surface-1 p-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a member by name…"
                className="w-full rounded-[8px] border border-hairline bg-surface-2 py-1.5 pl-8 pr-3 text-[12px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
              />
            </div>

            <ListFilterSelect
              value={planFilter}
              onChange={(v) => setPlanFilter(v)}
              label="Plan"
              options={[
                { value: "all", label: "All plans" },
                ...planTierOptions.map((t) => ({
                  value: t,
                  label: t.charAt(0).toUpperCase() + t.slice(1),
                })),
              ]}
            />

            <ListFilterSelect
              value={statusFilter}
              onChange={(v) => setStatusFilter(v)}
              label="Status"
              options={[
                { value: "all", label: `All · ${subscriptions.length}` },
                { value: "active", label: `Active · ${statusCounts.active}` },
                { value: "past_due", label: `Past due · ${statusCounts.past_due}` },
                { value: "paused", label: `Paused · ${statusCounts.paused}` },
                { value: "cancelled", label: `Cancelled · ${statusCounts.cancelled}` },
              ]}
            />

            <div className="ml-auto flex items-center gap-2">
              <ReactivationButton subscriptions={subscriptions} />
              <PostClubBillingButton activeCount={stats.activeCount} mrr={stats.mrr} />
              <Button variant="secondary" size="sm" onClick={openNewSub}>
                <Plus className="size-3.5" />
                New club member
              </Button>
            </div>
          </div>

          {/* Roster table card */}
          <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
            {subscriptions.length === 0 ? (
              <div className="px-4 py-10 text-center text-[12px] text-fg-tertiary">
                No club memberships yet. Click{" "}
                <span className="font-medium text-fg-subtle">+ New club member</span> to add one.
              </div>
            ) : filteredSubscriptions.length === 0 ? (
              <ClubMemberTable
                subscriptions={[]}
                boaters={boaters}
                onEdit={openEditSub}
                onDelete={handleCancelSub}
                onPauseResume={handlePauseResumeSub}
                emptyMessage="No club members match these filters."
              />
            ) : (
              <ClubMemberTable
                subscriptions={filteredSubscriptions}
                boaters={boaters}
                onEdit={openEditSub}
                onDelete={handleCancelSub}
                onPauseResume={handlePauseResumeSub}
              />
            )}
          </div>

      {/* Retention — the only booking-adjacent surface that stays here
          because it's a membership-health signal, not an ops queue. */}
      <ChurnRiskPanel bookings={bookings} />

      <NewClubHolderWizard
        open={newClubWizardOpen}
        onOpenChange={setNewClubWizardOpen}
      />

      <RecordEditDialog<ClubSubscription>
        open={subOpen}
        onOpenChange={setSubOpen}
        title={
          editingSub
            ? `Edit membership — ${boaterName(boaters, editingSub.boater_id)}`
            : "New club membership"
        }
        description="Membership = one-time join fee + recurring monthly subscription. Edit any field; deletion cancels all future bookings."
        record={editingSub}
        fields={subFields}
        onSave={handleSaveSub}
        onDelete={editingSub ? handleDeleteSub : undefined}
        entity="club_subscription"
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers + sub-components
// ─────────────────────────────────────────────────────────────────────────────

function boaterName(boaters: Boater[], id: string): string {
  return boaters.find((b) => b.id === id)?.display_name ?? id;
}

const SUB_COLS = "minmax(0, 1.6fr) 110px 110px 110px minmax(0, 0.9fr) 36px";

function ClubMemberTable({
  subscriptions,
  boaters,
  onEdit,
  onDelete,
  onPauseResume,
  emptyMessage,
}: {
  subscriptions: ClubSubscription[];
  boaters: Boater[];
  onEdit: (s: ClubSubscription) => void;
  onDelete: (s: ClubSubscription) => void;
  onPauseResume: (s: ClubSubscription) => void;
  emptyMessage?: string;
}) {
  return (
    <div>
      <div
        className="grid gap-x-3 border-b border-hairline bg-surface-2 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
        style={{ gridTemplateColumns: SUB_COLS }}
      >
        <span>Member</span>
        <span>Plan</span>
        <span>Next billing</span>
        <span>Monthly</span>
        <span>Status</span>
        <span />
      </div>
      {subscriptions.length === 0 && emptyMessage ? (
        <div className="px-4 py-10 text-center text-[12px] text-fg-tertiary">
          {emptyMessage}
        </div>
      ) : (
        <ul className="divide-y divide-hairline">
          {subscriptions.map((s) => (
            <li key={s.id} className="group relative">
              {/* Pause / Resume — sits left of the Cancel trash, only
                  renders for active or paused subs. Cancelled subs can't
                  be paused. */}
              {(s.status === "active" || s.status === "paused") && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onPauseResume(s);
                  }}
                  className="absolute right-10 top-1/2 z-10 -translate-y-1/2 rounded-md p-1 text-fg-tertiary opacity-0 transition-opacity hover:bg-surface-3 hover:text-fg group-hover:opacity-100"
                  aria-label={
                    s.status === "active"
                      ? `Pause ${boaterName(boaters, s.boater_id)}'s membership`
                      : `Resume ${boaterName(boaters, s.boater_id)}'s membership`
                  }
                  title={s.status === "active" ? "Pause membership" : "Resume membership"}
                >
                  {s.status === "active" ? (
                    <Pause className="size-3.5" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete(s);
                }}
                className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-md p-1 text-fg-tertiary opacity-0 transition-opacity hover:bg-surface-3 hover:text-status-danger group-hover:opacity-100"
                aria-label={`Cancel ${boaterName(boaters, s.boater_id)}'s membership`}
                title="Cancel membership"
              >
                <Trash2 className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onEdit(s)}
                style={{ gridTemplateColumns: SUB_COLS }}
                className="grid w-full cursor-pointer items-center gap-x-3 px-3 py-2 text-left transition-colors hover:bg-surface-2"
                title="Edit membership"
              >
                <span className="min-w-0 truncate text-[13px] font-medium text-fg">
                  <Link
                    href={`/members/${s.boater_id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="hover:text-primary"
                  >
                    {boaterName(boaters, s.boater_id)}
                  </Link>
                </span>
                <span className="text-[12px] text-fg-subtle capitalize">
                  {effectivePlanFor(s)?.plan_tier ?? "—"}
                </span>
                <span className="text-[12px] text-fg-subtle">
                  {s.next_billing_date ?? "—"}
                </span>
                <span className="money-display text-[13px] text-fg">
                  {formatMoney(effectivePlanFor(s)?.monthly_fee ?? 0)}
                </span>
                <span>
                  <StatusBadge status={s.status} />
                </span>
                <span />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ClubSubscription["status"] }) {
  if (status === "active") return <Badge tone="ok" size="sm">Active</Badge>;
  if (status === "past_due") return <Badge tone="warn" size="sm">Past due</Badge>;
  if (status === "paused") return <Badge tone="neutral" size="sm">Paused</Badge>;
  return <Badge tone="danger" size="sm">Cancelled</Badge>;
}

// Stand-alone "New booking" button that opens a minimal dialog. Keeps
// the calendar Panel header free of stateful logic.
export function NewBookingButton({
  subscriptions,
  boaters,
}: {
  subscriptions: ClubSubscription[];
  boaters: Boater[];
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" />
        New booking
      </Button>
      <NewClubBookingSheet
        open={open}
        onClose={() => setOpen(false)}
        subscriptions={subscriptions}
        boaters={boaters}
      />
    </>
  );
}

// Calendar day-cells max out at 110px and stack up to three booking
// chips, so a labeled "Cleaning done" badge would push the layout. A
// 2px colored dot inside each chip carries the same signal: warn=open
// (needs assignment), info=scheduled / in-progress (on the board),
// ok=done, danger=blocked. cancelled cleanings render no dot.
function cleaningCalendarDotClass(
  status: import("@/lib/types").WorkOrderStatus | undefined
): string | null {
  if (!status) return null;
  switch (status) {
    case "open":
      return "bg-status-warn";
    case "scheduled":
    case "in_progress":
      return "bg-status-info";
    case "completed":
      return "bg-status-ok";
    case "blocked":
      return "bg-status-danger";
    case "cancelled":
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Booking calendar — month grid with member chips per day
// ─────────────────────────────────────────────────────────────────────────────

export function ClubBookingCalendar({
  bookings,
  subscriptions,
  boaters,
}: {
  bookings: ClubBooking[];
  subscriptions: ClubSubscription[];
  boaters: Boater[];
}) {
  // Drawer handle — chips open the booking detail instead of the
  // previous destructive confirm prompt. Cancellation is still
  // available via the drawer's actions row.
  const { openBooking } = useClubBookingDrawer();
  // Cleaning WO lookup keyed on booking id — a tiny colored dot on
  // each chip surfaces whether a cleaning is on the board (warn=open,
  // info=scheduled/in-progress, ok=done, danger=blocked) without
  // blowing out the 110px day cell with a labeled badge.
  const cleaningWoBySource = useCleaningWoBySource();
  // Default to current month (or May 2026 in the seed world). We let the
  // user page forward/back. State is the first-of-month Date.
  const [cursor, setCursor] = React.useState(() => {
    // Anchor on whatever month has the most bookings so the demo lands on
    // something populated, not on a random empty month.
    const counts = new Map<string, number>();
    for (const b of bookings) {
      const key = b.date.slice(0, 7);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) {
      const [y, m] = top[0].split("-");
      return new Date(Number(y), Number(m) - 1, 1);
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthLabel = cursor.toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  // Build the grid: 6 weeks × 7 days, padded with leading/trailing
  // out-of-month cells so days line up under the weekday headers.
  const firstDayOfMonth = new Date(year, month, 1);
  const firstWeekday = firstDayOfMonth.getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: { date: Date; inMonth: boolean }[] = [];
  // Leading
  const prevMonthDays = new Date(year, month, 0).getDate();
  for (let i = firstWeekday - 1; i >= 0; i--) {
    cells.push({
      date: new Date(year, month - 1, prevMonthDays - i),
      inMonth: false,
    });
  }
  // In-month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), inMonth: true });
  }
  // Trailing — fill to 42
  while (cells.length < 42) {
    const last = cells[cells.length - 1].date;
    cells.push({
      date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1),
      inMonth: false,
    });
  }

  const subById = new Map(subscriptions.map((s) => [s.id, s]));
  const boaterById = new Map(boaters.map((b) => [b.id, b]));

  function bookingsFor(d: Date): ClubBooking[] {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return bookings.filter((b) => b.date === key);
  }

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div>
      {/* Month nav */}
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2">
        <div className="text-[13px] font-medium text-fg">{monthLabel}</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCursor(new Date(year, month - 1, 1))}
            className="rounded-md p-1 text-fg-subtle hover:bg-surface-3 hover:text-fg"
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
            className="rounded-md px-2 py-1 text-[11px] text-fg-subtle hover:bg-surface-3 hover:text-fg"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setCursor(new Date(year, month + 1, 1))}
            className="rounded-md p-1 text-fg-subtle hover:bg-surface-3 hover:text-fg"
            aria-label="Next month"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-hairline bg-surface-2 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="text-center">
            {d}
          </div>
        ))}
      </div>

      {/* Cell grid */}
      <div className="grid grid-cols-7">
        {cells.map((cell, i) => {
          const iso = cell.date.toISOString().slice(0, 10);
          const dayBookings = bookingsFor(cell.date);
          const isToday = iso === todayIso;
          return (
            <div
              key={i}
              className={cn(
                "min-h-[110px] border-b border-r border-hairline p-1.5",
                !cell.inMonth && "bg-surface-2/40 text-fg-tertiary",
                i % 7 === 6 && "border-r-0"
              )}
            >
              <div
                className={cn(
                  "mb-1 flex items-center justify-between text-[11px]",
                  isToday && "font-semibold text-primary"
                )}
              >
                <span>{cell.date.getDate()}</span>
                {dayBookings.length > 0 && (
                  <span className="text-[10px] text-fg-tertiary">
                    {dayBookings.length}
                  </span>
                )}
              </div>
              <div className="space-y-0.5">
                {dayBookings.slice(0, 3).map((b) => {
                  const sub = subById.get(b.subscription_id);
                  const member = sub ? boaterById.get(sub.boater_id) : undefined;
                  const cleaningWo = cleaningWoBySource.get(b.id);
                  const cleaningDot = cleaningCalendarDotClass(
                    cleaningWo?.status
                  );
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => openBooking(b.id)}
                      className={cn(
                        "flex w-full items-center gap-1 rounded-[4px] px-1 py-0.5 text-left text-[10px] transition-colors",
                        b.status === "confirmed"
                          ? "bg-primary-soft text-primary hover:bg-primary-soft/80"
                          : b.status === "requested"
                          ? "bg-status-warn/15 text-status-warn hover:bg-status-warn/25"
                          : b.status === "completed"
                          ? "bg-surface-3 text-fg-subtle"
                          : "bg-status-danger/10 text-status-danger"
                      )}
                      title={`${member?.display_name ?? "?"} — ${b.status}${b.notes ? ` · ${b.notes}` : ""}${
                        cleaningWo ? ` · cleaning ${cleaningWo.status}` : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {member?.display_name.split(",")[0] ?? "?"}
                      </span>
                      {cleaningDot && (
                        <span
                          aria-label={`cleaning ${cleaningWo?.status}`}
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            cleaningDot
                          )}
                        />
                      )}
                    </button>
                  );
                })}
                {dayBookings.length > 3 && (
                  <div className="px-1 text-[10px] text-fg-tertiary">
                    +{dayBookings.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 border-t border-hairline px-4 py-2 text-[11px] text-fg-tertiary">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-primary" />
          Confirmed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-status-warn" />
          Requested
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-fg-tertiary/50" />
          Completed
        </span>
        <span className="ml-auto">Click a chip to cancel that booking.</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout primitives
// ─────────────────────────────────────────────────────────────────────────────

export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
      <header className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h2 className="text-[13px] font-medium text-fg">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Post club billing — one-tap monthly invoice batch
//
// Calls runClubMonthlyBilling() which posts a single-line invoice per
// active subscription (auto-charges default card on file). After the
// batch, surfaces a short confirmation toast inline.
// ─────────────────────────────────────────────────────────────────────────────

function PostClubBillingButton({
  activeCount,
  mrr,
}: {
  activeCount: number;
  mrr: number;
}) {
  const [confirmation, setConfirmation] = React.useState<{
    invoiceCount: number;
    chargedCount: number;
    totalPosted: number;
  } | null>(null);

  function run() {
    if (
      !window.confirm(
        `Post ${activeCount} monthly invoices totaling ${formatMoney(mrr)}? Members with a default card on file will be auto-charged.`
      )
    )
      return;
    const result = runClubMonthlyBilling();
    setConfirmation({
      invoiceCount: result.invoiceIds.length,
      chargedCount: result.chargedCount,
      totalPosted: result.totalPosted,
    });
    // Auto-clear after 6 seconds
    setTimeout(() => setConfirmation(null), 6000);
  }

  if (activeCount === 0) return null;

  return (
    <>
      <Button variant="secondary" size="sm" onClick={run}>
        Post monthly billing
      </Button>
      {confirmation && (
        <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-status-ok/10 px-2 py-0.5 text-[11px] text-status-ok">
          ✓ Posted {confirmation.invoiceCount} ·{" "}
          {confirmation.chargedCount} auto-charged
        </span>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Today's club — operational dockside view
//
// Confirmed bookings for today get a Check-in CTA that spins up a
// BoatRental in the existing rental pipeline. Already-checked-in
// bookings show a "Checked in" badge so staff sees the status at a
// glance without scrolling the calendar.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Reactivation campaign — send "come back" comms to cancelled members
//
// Calls sendClubReactivationComms() which fires once per ex-member
// within the 30-90 day window. Surfaces eligibility count up-front so
// the operator can decide whether it's worth running.
// ─────────────────────────────────────────────────────────────────────────────

function ReactivationButton({
  subscriptions,
}: {
  subscriptions: ClubSubscription[];
}) {
  const [confirmation, setConfirmation] = React.useState<{
    sentCount: number;
  } | null>(null);

  // Eligibility = cancelled, no prior reactivation, within window.
  const today = Date.now();
  const eligibleCount = subscriptions.filter((s) => {
    if (s.status !== "cancelled") return false;
    if (s.reactivation_sent_at) return false;
    const daysAgo = Math.floor(
      (today - new Date(s.member_since).getTime()) / 86_400_000
    );
    return daysAgo >= 30 && daysAgo <= 90;
  }).length;

  if (eligibleCount === 0 && !confirmation) return null;

  function run() {
    if (
      !window.confirm(
        `Send a 'come back' message to ${eligibleCount} cancelled member${
          eligibleCount === 1 ? "" : "s"
        } (30–90 days ago)?`
      )
    )
      return;
    const result = sendClubReactivationComms();
    setConfirmation({ sentCount: result.sentTo.length });
    setTimeout(() => setConfirmation(null), 6000);
  }

  return (
    <>
      {eligibleCount > 0 && (
        <Button variant="secondary" size="sm" onClick={run}>
          Reactivate {eligibleCount}
        </Button>
      )}
      {confirmation && (
        <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-status-ok/10 px-2 py-0.5 text-[11px] text-status-ok">
          ✓ Sent {confirmation.sentCount}
        </span>
      )}
    </>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Churn risk — members with consecutive 'sad' ratings
//
// Surface proactive outreach targets so staff can intervene before the
// member hits the cancel flow. Recomputes on every render via
// getClubChurnRisks() — cheap walk over subs + bookings.
// ─────────────────────────────────────────────────────────────────────────────

function ChurnRiskPanel({ bookings }: { bookings: ClubBooking[] }) {
  // bookings prop is just a re-render trigger — the helper reads from
  // the live store directly.
  void bookings;
  const risks = getClubChurnRisks();
  if (risks.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-[12px] border border-status-danger/30 bg-status-danger/5">
      <header className="flex items-center justify-between border-b border-status-danger/20 bg-status-danger/10 px-4 py-2.5">
        <h2 className="inline-flex items-center gap-1.5 text-[13px] font-medium text-fg">
          <span className="size-1.5 rounded-full bg-status-danger" />
          Members at risk
        </h2>
        <span className="text-[11px] font-medium text-status-danger">
          {risks.length} flagged
        </span>
      </header>
      <ul className="divide-y divide-status-danger/15">
        {risks.map((r) => (
          <li
            key={r.subscription.id}
            className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Link
                  href={`/members/${r.boater.id}`}
                  className="font-medium text-fg hover:text-primary"
                >
                  {r.boater.display_name}
                </Link>
                <Badge tone="danger" size="sm">
                  {r.sadStreak} sad ratings
                </Badge>
              </div>
              <div className="mt-0.5 text-[11px] text-fg-tertiary">
                {effectivePlanFor(r.subscription)?.plan_tier ?? "—"} plan · last sad day{" "}
                <LocalTime iso={r.lastSadDate} fmt="short_date" />
              </div>
            </div>
            <Link
              href={`/members/${r.boater.id}`}
              className="rounded-[6px] border border-hairline bg-surface-1 px-2.5 py-1 text-[11px] text-fg-subtle transition-colors hover:border-primary/40 hover:text-primary"
            >
              Reach out
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

