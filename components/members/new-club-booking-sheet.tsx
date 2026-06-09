"use client";

import * as React from "react";
import { Calendar, Check, CheckCircle2, Sailboat, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/mock-data";
import {
  effectivePlanFor,
  nextClubBookingId,
  totalFromAttachedFees,
  upsertClubBooking,
  useBoatRentals,
  useClubBookings,
  useFeesForEntity,
  useRentalBoats,
} from "@/lib/client-store";
import type {
  Boater,
  ClubBooking,
  ClubSubscription,
  RentalBoat,
} from "@/lib/types";

/*
 * NewClubBookingSheet — availability + quota-aware booking flow.
 *
 * Flow:
 *   1. Member is pre-selected (passed in) OR pickable from a list of
 *      active subscriptions.
 *   2. Pick a date — defaults to next available open day.
 *   3. Fleet availability cards render — a boat is "available" on the
 *      chosen date when no club booking and no boat rental already
 *      occupies it.
 *   4. Pick one available boat → confirm.
 *
 * Quota guard — if the member has already used their plan's monthly
 * allotment, the Confirm button shows "over quota" + requires double-
 * confirm. Operator override is allowed (sometimes the marina wants
 * to comp a day).
 */

export function NewClubBookingSheet({
  open,
  onClose,
  subscriptions,
  boaters,
  defaultSubscriptionId,
}: {
  open: boolean;
  onClose: () => void;
  subscriptions: ClubSubscription[];
  boaters: Boater[];
  defaultSubscriptionId?: string;
}) {
  const allBookings = useClubBookings();
  const allRentals = useBoatRentals();
  const fleet = useRentalBoats();
  const clubFleet = fleet.filter((f) => f.available_for_club !== false);

  // For a single-day club booking, only one-time fees apply. Monthly /
  // annual cadences belong on the parent ClubSubscription, not this
  // per-booking record.
  const clubFees = useFeesForEntity("club_subscription");
  const oneTimeClubFees = clubFees.filter(
    (f) => (f.cadence ?? "one_time") === "one_time",
  );

  // Active subscriptions only — past_due included so operator can still
  // book (often used as a friendly "let them book, send a reminder later").
  const eligibleSubs = subscriptions.filter(
    (s) => s.status === "active" || s.status === "past_due"
  );

  const [subId, setSubId] = React.useState(
    defaultSubscriptionId ?? eligibleSubs[0]?.id ?? ""
  );
  const [date, setDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [selectedBoatId, setSelectedBoatId] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState("");
  const [overrideQuota, setOverrideQuota] = React.useState(false);
  const [selectedFeeIds, setSelectedFeeIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!open) return;
    // Reset on open — but keep defaults
    setSubId(defaultSubscriptionId ?? eligibleSubs[0]?.id ?? "");
    setDate(new Date().toISOString().slice(0, 10));
    setSelectedBoatId(null);
    setNotes("");
    setOverrideQuota(false);
    setSelectedFeeIds([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultSubscriptionId]);

  const sub = eligibleSubs.find((s) => s.id === subId);
  const plan = sub ? effectivePlanFor(sub) : null;
  const boater = sub ? boaters.find((b) => b.id === sub.boater_id) : null;

  // ── Quota math — how many bookings has this member used this month? ──
  const usedThisMonth = React.useMemo(() => {
    if (!sub) return 0;
    const month = date.slice(0, 7);
    return allBookings.filter(
      (b) =>
        b.subscription_id === sub.id &&
        b.status !== "cancelled" &&
        b.date.slice(0, 7) === month
    ).length;
  }, [sub, allBookings, date]);

  const monthlyAllotment = plan?.days_per_month ?? null;
  const remaining =
    monthlyAllotment != null ? Math.max(0, monthlyAllotment - usedThisMonth) : null;
  const overQuota = remaining !== null && remaining <= 0;

  // ── Fleet availability for the chosen date ──
  // A boat is "booked" on this date if any club booking (non-cancelled)
  // claims it, OR any boat rental overlaps the date.
  const availability = React.useMemo(() => {
    const map = new Map<string, { booked: boolean; bookedBy: string }>();
    for (const b of clubFleet) {
      const conflictClub = allBookings.find(
        (cb) =>
          cb.rental_boat_id === b.id &&
          cb.date === date &&
          cb.status !== "cancelled"
      );
      const conflictRental = allRentals.find(
        (r) =>
          r.boat_id === b.id &&
          r.status !== "cancelled" &&
          r.status !== "closed" &&
          (r.start_at?.slice(0, 10) ?? "") <= date &&
          (r.end_at?.slice(0, 10) ?? date) >= date
      );
      if (conflictClub) {
        const conflictMember = boaters.find((bo) => bo.id === conflictClub.boater_id);
        map.set(b.id, {
          booked: true,
          bookedBy: `Club · ${conflictMember?.display_name ?? "Member"}`,
        });
      } else if (conflictRental) {
        map.set(b.id, { booked: true, bookedBy: "Paid rental" });
      } else {
        map.set(b.id, { booked: false, bookedBy: "" });
      }
    }
    return map;
  }, [clubFleet, allBookings, allRentals, date, boaters]);

  const availableCount = Array.from(availability.values()).filter((v) => !v.booked).length;

  // ── Submit ──
  const canSave = Boolean(
    subId && date && selectedBoatId && (!overQuota || overrideQuota)
  );

  // Roll up selected one-time fees for display + persistence.
  const feeRollup = totalFromAttachedFees(selectedFeeIds, 1);
  const selectedFees = oneTimeClubFees.filter((f) =>
    selectedFeeIds.includes(f.id),
  );

  function save() {
    if (!canSave || !sub || !selectedBoatId) return;
    upsertClubBooking({
      id: nextClubBookingId(),
      subscription_id: sub.id,
      boater_id: sub.boater_id,
      rental_boat_id: selectedBoatId,
      date,
      status: "confirmed",
      notes: notes.trim() || undefined,
      attached_fee_ids:
        selectedFeeIds.length > 0 ? selectedFeeIds : undefined,
      created_at: new Date().toISOString(),
    });
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[16px] border border-hairline bg-surface-1 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <div>
            <h3 className="text-[15px] font-semibold text-fg">New club booking</h3>
            <p className="mt-0.5 text-[11px] text-fg-tertiary">
              Pick a date, see what's available, lock it in.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1 text-fg-tertiary hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Member picker (skip when defaultSubscriptionId is provided) */}
          {!defaultSubscriptionId && (
            <Field label="Member">
              <select
                value={subId}
                onChange={(e) => setSubId(e.target.value)}
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-2 text-[13px] text-fg focus:border-primary focus:outline-none"
              >
                {eligibleSubs.map((s) => {
                  const b = boaters.find((x) => x.id === s.boater_id);
                  const p = effectivePlanFor(s);
                  return (
                    <option key={s.id} value={s.id}>
                      {b?.display_name ?? s.boater_id} · {p?.plan_tier ?? "—"}
                    </option>
                  );
                })}
              </select>
            </Field>
          )}

          {/* Member summary + quota */}
          {sub && boater && plan && (
            <div className="rounded-[10px] border border-hairline bg-surface-2 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-fg">
                    {boater.display_name}
                  </div>
                  <div className="text-[11px] text-fg-tertiary">
                    {plan.plan_tier} plan · {monthlyAllotment ?? "unlimited"} days/month
                  </div>
                </div>
                <QuotaBadge
                  used={usedThisMonth}
                  total={monthlyAllotment}
                  remaining={remaining}
                />
              </div>
            </div>
          )}

          {/* Date picker */}
          <Field label="Date">
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 py-2 pl-8 pr-2.5 text-[13px] text-fg focus:border-primary focus:outline-none"
              />
            </div>
            <p className="mt-1 text-[11px] text-fg-tertiary">
              {availableCount} of {clubFleet.length} boats available {date === new Date().toISOString().slice(0, 10) ? "today" : `on ${prettyDate(date)}`}.
            </p>
          </Field>

          {/* Fleet availability */}
          <Field label="Pick a boat">
            {clubFleet.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-hairline-strong px-3 py-6 text-center text-[12px] text-fg-tertiary">
                No boats are flagged for club use. Add one from /boat-rentals.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {clubFleet.map((b) => (
                  <BoatTile
                    key={b.id}
                    boat={b}
                    avail={availability.get(b.id)!}
                    selected={selectedBoatId === b.id}
                    onClick={() => {
                      if (!availability.get(b.id)?.booked) {
                        setSelectedBoatId(b.id);
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </Field>

          {/* Notes */}
          <Field label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. Prefers the bow seats"
              className="block w-full resize-none rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>

          {/* Add-on fees — one-time only (single-day booking). Monthly /
              annual cadences live on the parent subscription. */}
          {oneTimeClubFees.length > 0 && (
            <Field label="Add-on fees (optional)">
              <ul className="space-y-1.5">
                {oneTimeClubFees.map((f) => {
                  const checked = selectedFeeIds.includes(f.id);
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedFeeIds((ids) =>
                            checked
                              ? ids.filter((x) => x !== f.id)
                              : [...ids, f.id],
                          )
                        }
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-[10px] border px-3 py-2 text-left transition-colors",
                          checked
                            ? "border-primary bg-primary-soft/40"
                            : "border-hairline bg-surface-1 hover:bg-surface-2",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-fg">
                            {f.name}
                          </div>
                          {f.description && (
                            <div className="text-[11px] text-fg-tertiary">
                              {f.description}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="money-display text-[13px] text-fg">
                            {formatMoney(f.amount)}
                          </span>
                          <span
                            className={cn(
                              "flex size-4 items-center justify-center rounded-full border",
                              checked
                                ? "border-primary bg-primary text-on-primary"
                                : "border-hairline-strong",
                            )}
                          >
                            {checked && <Check className="size-2.5" />}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {selectedFees.length > 0 && (
                <p className="mt-1.5 text-[11px] text-fg-subtle">
                  {formatMoney(feeRollup.oneTime)} one-time added to this
                  booking.
                </p>
              )}
            </Field>
          )}

          {/* Over-quota warning */}
          {overQuota && (
            <label className="flex items-start gap-2 rounded-[10px] border border-status-warn/40 bg-status-warn/5 px-3 py-2 text-[12px] text-status-warn">
              <input
                type="checkbox"
                checked={overrideQuota}
                onChange={(e) => setOverrideQuota(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold">Over monthly quota.</span>{" "}
                {boater?.first_name ?? "This member"} has already used {usedThisMonth} of {monthlyAllotment}{" "}
                days this month. Override and book anyway? (You can comp the extra day.)
              </span>
            </label>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-hairline px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] px-3 py-1.5 text-[13px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-medium transition-colors",
              canSave
                ? "bg-primary text-on-primary hover:bg-primary-hover"
                : "cursor-not-allowed bg-surface-3 text-fg-tertiary"
            )}
          >
            <CheckCircle2 className="size-3.5" />
            Confirm booking
          </button>
        </div>
      </div>
    </div>
  );
}

function BoatTile({
  boat,
  avail,
  selected,
  onClick,
}: {
  boat: RentalBoat;
  avail: { booked: boolean; bookedBy: string };
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={avail.booked}
      className={cn(
        "flex items-center gap-3 rounded-[10px] border p-3 text-left transition-colors",
        avail.booked
          ? "cursor-not-allowed border-hairline bg-surface-2/50 opacity-60"
          : selected
          ? "border-primary bg-primary-soft/40 ring-1 ring-primary"
          : "border-hairline bg-surface-1 hover:border-hairline-strong hover:bg-surface-2"
      )}
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          avail.booked
            ? "bg-surface-3 text-fg-tertiary"
            : selected
            ? "bg-primary text-on-primary"
            : "bg-surface-3 text-fg-subtle"
        )}
      >
        <Sailboat className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-fg">{boat.name}</div>
        <div className="truncate text-[11px] text-fg-tertiary">
          {avail.booked ? (
            <span className="inline-flex items-center gap-1">
              <AlertTriangle className="size-3" />
              {avail.bookedBy}
            </span>
          ) : (
            <>
              {boat.type} · seats {boat.capacity}
            </>
          )}
        </div>
      </div>
      {!avail.booked && selected && (
        <CheckCircle2 className="size-4 shrink-0 text-primary" />
      )}
    </button>
  );
}

function QuotaBadge({
  used,
  total,
  remaining,
}: {
  used: number;
  total: number | null | undefined;
  remaining: number | null;
}) {
  if (total == null) {
    return (
      <span className="rounded-full bg-status-ok/15 px-2 py-0.5 text-[10px] font-medium text-status-ok">
        Unlimited
      </span>
    );
  }
  const tone = remaining! <= 0 ? "danger" : remaining! <= 1 ? "warn" : "ok";
  const bg =
    tone === "danger"
      ? "bg-status-danger/15 text-status-danger"
      : tone === "warn"
      ? "bg-status-warn/15 text-status-warn"
      : "bg-status-ok/15 text-status-ok";
  return (
    <span className={"rounded-full px-2 py-0.5 text-[10px] font-medium " + bg}>
      {used} / {total} used
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function prettyDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Re-export for external use
export type { ClubBooking };
