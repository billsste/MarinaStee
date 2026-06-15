"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  Clock,
  ListTodo,
  Plus,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  BookingTypeChip,
  type BookingType,
} from "@/components/ui/booking-type-chip";
import { LocalTime } from "@/components/ui/local-time";
import { localIsoDate } from "@/lib/contracts";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { Button } from "@/components/ui/button";
import { TabButton, TabStrip } from "@/components/ui/tab-button";
import { ListFilterSelect } from "@/components/ui/list-filter-select";
import { ReservationsTable } from "@/components/reservations/reservations-table";
import { WaitlistView } from "@/components/reservations/waitlist-view";
import { NewBookingWizard } from "@/components/bookings/new-booking-wizard";
import {
  ClubBookingCalendar,
  NewBookingButton,
  Panel,
} from "@/components/members/rental-club-view";
import {
  confirmClubBooking,
  updateBoatRental,
  upsertClubBooking,
  useBoaters,
  useBoatRentals,
  useCleaningWoBySource,
  useClubBookings,
  useClubPlans,
  useClubSubscriptions,
  useRentalBoats,
  useReservations,
  useSlips,
} from "@/lib/client-store";
import { formatMoney } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import type {
  Boater,
  BoatRental,
  ClubBooking,
  RentalBoat,
  Reservation,
  Slip,
  WorkOrder,
} from "@/lib/types";

type SectionKey = "bookings" | "pending" | "calendar";

/*
 * /bookings — structurally mirrors /members exactly:
 *   - hand-rolled max-w[1400px] page wrapper (header + 2-col grid)
 *   - 200px sticky left rail with the section nav
 *   - right column = agent → sub-view (space-y-5)
 *
 * Two top-level sections:
 *   - bookings → unified kanban (status snapshot, pending requests,
 *                day strip, per-day arrivals/departures/on-site).
 *                Sub-tabs: kanban / list / waitlist.
 *   - calendar → date-driven monthly club booking calendar.
 */

const NAV_ITEMS: {
  key: SectionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}[] = [
  {
    key: "bookings",
    label: "Bookings",
    icon: ListTodo,
    description:
      "One queue for slip reservations, boat rentals, and club bookings. Holders + members live on /members.",
  },
  {
    key: "pending",
    label: "Pending requests",
    icon: AlertTriangle,
    description:
      "Booking requests waiting on staff confirmation. Drill in to see the full request, then approve or decline — approvals flow into the kanban and calendar automatically.",
  },
  {
    key: "calendar",
    label: "Club Calendar",
    icon: CalendarRange,
    description:
      "Monthly grid of confirmed + requested club bookings. Forward planning lives here; daily ops live on the Bookings tab.",
  },
];

const AGENT_PROMPTS: Record<
  SectionKey,
  { placeholder: string; suggestions: string[] }
> = {
  bookings: {
    placeholder:
      "Ask the agent — e.g. 'book A12 for Peterson Friday' or 'find an open pontoon Saturday'",
    suggestions: [
      "Book A12 for Peterson tomorrow night",
      "Find an open slip for a 28-footer",
      "Which pontoons are out Saturday?",
      "Who's arriving today?",
    ],
  },
  pending: {
    placeholder:
      "Ask the agent about pending requests — e.g. 'confirm O'Neill for Sunday' or 'who's been waiting longest?'",
    suggestions: [
      "Confirm O'Neill for Sunday",
      "Who's been waiting longest?",
      "Decline anything from past-due members",
      "Bulk-confirm all requests under 4 hours old",
    ],
  },
  calendar: {
    placeholder:
      "Ask the agent about the club calendar — e.g. 'who's booked Saturday?' or 'add Morales to the 14th'",
    suggestions: [
      "Who's booked this Saturday?",
      "Add Morales to the 14th",
      "Which days have open slots next week?",
      "Show me pending requests",
    ],
  },
};

export function BookingsClient() {
  const searchParams = useSearchParams();
  const initial: SectionKey =
    searchParams?.get("tab") === "calendar"
      ? "calendar"
      : searchParams?.get("tab") === "pending"
      ? "pending"
      : "bookings";
  const [section, setSection] = React.useState<SectionKey>(initial);
  const active = NAV_ITEMS.find((n) => n.key === section) ?? NAV_ITEMS[0];
  // Live pending-request count drives the sidebar badge — operator
  // sees the queue depth without leaving whatever tab they're on.
  // Counts across all booking sources (club requests, boat rentals
  // awaiting agreement/deposit, slip requests once the public API
  // is live).
  const allClubBookings = useClubBookings();
  const allBoatRentals = useBoatRentals();
  const allReservationsForCount = useReservations();
  const pendingCount = React.useMemo(
    () =>
      allClubBookings.filter((b) => b.status === "requested").length +
      allBoatRentals.filter((r) => r.status === "reserved").length +
      allReservationsForCount.filter(
        (r) => (r.status as string) === SLIP_PENDING_STATUS
      ).length,
    [allClubBookings, allBoatRentals, allReservationsForCount]
  );

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", section);
    window.history.replaceState(null, "", url.toString());
  }, [section]);

  return (
    // No section h1 — the AppShell breadcrumb ("Marina Stee / Bookings")
    // identifies the page. See CLAUDE.md §"List-page UX consistency"
    // rule #10 + #12 (rail with 3 items → TabStrip in content column).
    <div className="mx-auto w-full max-w-[1400px] px-5 pt-4 pb-32 space-y-5">
      <RentalsAsk
        placeholder={AGENT_PROMPTS[section].placeholder}
        suggestions={AGENT_PROMPTS[section].suggestions}
      />

      <TabStrip ariaLabel="Booking sections">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const showBadge = item.key === "pending" && pendingCount > 0;
          return (
            <TabButton
              key={item.key}
              active={section === item.key}
              onClick={() => setSection(item.key)}
              label={item.label}
              icon={<Icon className="size-3.5" />}
              count={showBadge ? pendingCount : undefined}
              countTone={showBadge ? "warn" : "neutral"}
            />
          );
        })}
      </TabStrip>

      {section === "bookings" && <UnifiedBookingsTab />}
      {section === "pending" && <PendingRequestsTab />}
      {section === "calendar" && <ClubCalendarTab />}
    </div>
  );
}

// ─── Unified Bookings tab ──────────────────────────────────────────────
//
// One kanban for every booking type: slip reservations, paid boat
// rentals (transient/walk-in), and rental-club bookings. Cards carry
// type chips so the operator can scan the stream and immediately know
// what each row is. Sub-tabs:
//
//   - kanban   → 14-day strip + per-day arrivals/departures/on-site.
//                Combined counts; cards flagged Slip / Boat rental / Club.
//   - list     → flat slip reservations table (unchanged).
//   - waitlist → slip waitlist (unchanged).
//
// "+ New booking" opens a type picker; choosing routes to the right
// existing wizard.

type BookingsSubTab = "kanban" | "list" | "waitlist";

function UnifiedBookingsTab() {
  const [sub, setSub] = React.useState<BookingsSubTab>("kanban");
  const [newOpen, setNewOpen] = React.useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <TabStrip ariaLabel="Bookings view">
          <TabButton
            active={sub === "kanban"}
            onClick={() => setSub("kanban")}
            label="Kanban"
            icon={<Clock className="size-3.5" />}
          />
          <TabButton
            active={sub === "list"}
            onClick={() => setSub("list")}
            label="List"
            icon={<ListTodo className="size-3.5" />}
          />
          <TabButton
            active={sub === "waitlist"}
            onClick={() => setSub("waitlist")}
            label="Waitlist"
            icon={<CalendarRange className="size-3.5" />}
          />
        </TabStrip>

        <Button variant="secondary" size="sm" onClick={() => setNewOpen(true)}>
          <Plus className="size-3.5" /> New booking
        </Button>
      </div>

      {sub === "kanban" && <UnifiedKanban />}
      {sub === "list" && <ReservationsTable />}
      {sub === "waitlist" && <WaitlistView />}

      <NewBookingWizard open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}

function prettyDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Cleaning-status chip tone + label collapse. Returned shape feeds
// directly into <Badge tone={...}>{label}</Badge>; null when no chip
// should render (no WO, or the WO is cancelled). `open` lands on warn
// because it signals an unassigned cleaning job — the operator still
// needs to act. `scheduled` / `in_progress` are info: handled, on the
// board. `completed` is ok. `blocked` escalates to danger.
type CleaningChip = {
  label: string;
  tone: "warn" | "info" | "ok" | "danger";
};

function cleaningChipFor(wo: WorkOrder | undefined): CleaningChip | null {
  if (!wo) return null;
  switch (wo.status) {
    case "open":
      return { label: "Cleaning open", tone: "warn" };
    case "scheduled":
      return { label: "Cleaning scheduled", tone: "info" };
    case "in_progress":
      return { label: "Cleaning in progress", tone: "info" };
    case "completed":
      return { label: "Cleaning done", tone: "ok" };
    case "blocked":
      return { label: "Cleaning blocked", tone: "danger" };
    case "cancelled":
      return null;
  }
}


// ─── Fleet Bookings tab ───────────────────────────────────────────────
//
// Boat rentals + club bookings share the same fleet. We reuse the
// existing BoatRentalsView (which already shows fleet-by-fleet status)
// and add a club-bookings strip linking out to the Rental Club calendar.

// ─── Fleet Bookings — day-strip ops timeline (mirrors Slip Reservations) ──
//
// Compact alternative to the photo-card grid. At 30+ boats the old card
// layout becomes a wall — this version is a 14-day strip + a thin fleet
// list. Per-boat rates / hours / fuel live on the boat detail page.

// Unified booking-activity shape — abstracts over slip reservations,
// paid boat rentals, and rental-club bookings so the kanban can render
// one stream of mixed cards.
type UnifiedActivity = {
  id: string;
  type: "slip" | "rental" | "club";
  customer: string;
  spaceLabel?: string; // slip number or boat name
  startDate: string; // YYYY-MM-DD — "arrival" / "pickup" / "check-in"
  endDate: string; // YYYY-MM-DD — "departure" / "return"
  startAt?: string; // optional ISO timestamp for time display
  endAt?: string;
  status: string;
};

type UnifiedTypeFilter = "all" | "slip" | "rental" | "club";

// localIsoDate now lives in lib/contracts.ts so every consumer (boater
// list, roster, contracts, reports, services page, bookings) computes
// today the same way. Imported above.

function UnifiedKanban() {
  const allRentals = useBoatRentals();
  const allClub = useClubBookings();
  const allReservations = useReservations();
  const fleet = useRentalBoats();
  const slips = useSlips();
  const boaters = useBoaters();
  const subscriptions = useClubSubscriptions();
  // Cleaning back-reference index — keyed on the activity id
  // (ClubBooking id or BoatRental id). The chip lookup inside
  // UnifiedDayPanel is now a single Map.get instead of N filters across
  // the WO list per render.
  const cleaningWoBySource = useCleaningWoBySource();
  const today = React.useMemo(() => localIsoDate(), []);
  const [selectedDate, setSelectedDate] = React.useState(today);
  const [filter, setFilter] = React.useState<UnifiedTypeFilter>("all");

  // Lookups so cards can render the customer's actual name and the
  // space label (slip number / boat name) regardless of source.
  const boaterNameById = React.useMemo(
    () => new Map(boaters.map((b) => [b.id, b.display_name] as const)),
    [boaters]
  );
  const slipLabelById = React.useMemo(
    () => new Map<string, string>(slips.map((s) => [s.id, s.number])),
    [slips]
  );
  const boatNameById = React.useMemo(
    () => new Map(fleet.map((b) => [b.id, b.name] as const)),
    [fleet]
  );

  // Unified booking-activity stream. Every record across the three
  // sources (slip / rental / club) lands here with a normalized shape
  // so the day strip + per-day panels can render mixed cards. `type`
  // drives the chip on each card and the source filter chips above.
  const activity: UnifiedActivity[] = React.useMemo(() => {
    const out: UnifiedActivity[] = [];
    // Slip reservations — multi-day stays. startDate = arrival,
    // endDate = departure. Always counted as both an arrival on the
    // first day and a departure on the last day.
    for (const r of allReservations) {
      if (r.status === "cancelled") continue;
      out.push({
        id: r.id,
        type: "slip",
        customer:
          boaterNameById.get(r.boater_id) ?? r.boater_id ?? "Guest",
        spaceLabel: slipLabelById.get(r.slip_id) ?? r.slip_id,
        startDate: r.arrival_date,
        endDate: r.departure_date,
        status: r.status,
      });
    }
    // Paid boat rentals — typically same-day but can span dates.
    for (const r of allRentals) {
      if (r.status === "cancelled" || r.status === "no_show") continue;
      const startDate = r.start_at?.slice(0, 10) ?? today;
      const endDate = r.end_at?.slice(0, 10) ?? startDate;
      out.push({
        id: r.id,
        type: "rental",
        customer:
          (r.boater_id && boaterNameById.get(r.boater_id)) ??
          r.patron_name ??
          "Walk-in",
        spaceLabel: boatNameById.get(r.boat_id) ?? r.boat_id,
        startDate,
        endDate,
        startAt: r.start_at,
        endAt: r.end_at,
        status: r.status,
      });
    }
    // Club bookings — single-date member days.
    for (const b of allClub) {
      if (b.status === "cancelled") continue;
      out.push({
        id: b.id,
        type: "club",
        customer:
          boaterNameById.get(b.boater_id) ?? b.boater_id ?? "Member",
        spaceLabel: b.rental_boat_id
          ? boatNameById.get(b.rental_boat_id) ?? b.rental_boat_id
          : undefined,
        startDate: b.date,
        endDate: b.date,
        status: b.status,
      });
    }
    return out;
  }, [
    allReservations,
    allRentals,
    allClub,
    boaterNameById,
    slipLabelById,
    boatNameById,
    today,
  ]);

  const filtered = React.useMemo(
    () =>
      filter === "all" ? activity : activity.filter((a) => a.type === filter),
    [activity, filter]
  );

  // 14-day strip — dates as local YYYY-MM-DD so they line up with
  // `today` regardless of the operator's timezone offset.
  const days = React.useMemo(() => {
    const out: { date: string; label: string; weekday: string }[] = [];
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    for (let i = 0; i < 14; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push({
        date: localIsoDate(d),
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        weekday: d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase(),
      });
    }
    return out;
  }, []);

  // Per-day counts — arrivals (anything starting that day), departures
  // (anything ending), and "on site" (active = startDate <= day <=
  // endDate). Single pass over `filtered`: O(1) lookups for arrivals
  // and departures via the date Map, and a bounded inner loop for
  // onSite that walks only the days each activity actually overlaps.
  const dayStats = React.useMemo(() => {
    const m = new Map<
      string,
      { arrivals: number; departures: number; onSite: number }
    >();
    for (const d of days) m.set(d.date, { arrivals: 0, departures: 0, onSite: 0 });
    if (days.length === 0) return m;
    const firstDay = days[0].date;
    const lastDay = days[days.length - 1].date;
    for (const a of filtered) {
      const arr = m.get(a.startDate);
      if (arr) arr.arrivals++;
      const dep = m.get(a.endDate);
      if (dep) dep.departures++;
      // Skip if the activity doesn't overlap the 14-day window at all.
      if (a.endDate < firstDay || a.startDate > lastDay) continue;
      for (const d of days) {
        if (a.startDate <= d.date && a.endDate >= d.date) {
          m.get(d.date)!.onSite++;
        }
      }
    }
    return m;
  }, [days, filtered]);

  // Total marina capacity drives the per-day load bar — the strip
  // mixes slip + rental + club into `onSite`, so dividing by just the
  // rental fleet inflates load past 100% on slip-heavy days. Using
  // slips + rental boats gives a meaningful "marina fullness" signal.
  const fleetSize = Math.max(1, fleet.length);
  const totalCapacity = Math.max(1, fleet.length + slips.length);

  // Selected-day buckets, memoized so a day-cell click doesn't re-walk
  // every booking three times per render. Re-derives only when filtered
  // or selectedDate changes.
  const { arrivalsToday, departuresToday, onSiteNow } = React.useMemo(() => {
    const arrivals: UnifiedActivity[] = [];
    const departures: UnifiedActivity[] = [];
    const onSite: UnifiedActivity[] = [];
    for (const a of filtered) {
      if (a.startDate === selectedDate) arrivals.push(a);
      if (a.endDate === selectedDate) departures.push(a);
      if (a.startDate < selectedDate && a.endDate > selectedDate) onSite.push(a);
    }
    return { arrivalsToday: arrivals, departuresToday: departures, onSiteNow: onSite };
  }, [filtered, selectedDate]);

  // Today's fleet + slip + club snapshot — single pass over `activity`
  // computing the three "today" counters together, plus the small
  // standalone counts (maintenance / active club members).
  const { onWaterCount, slipsOccupiedToday, maintenanceCount, activeClubMembers } =
    React.useMemo(() => {
      let onWater = 0;
      let slipsOcc = 0;
      for (const a of activity) {
        if (a.startDate <= today && a.endDate >= today) {
          if (a.type === "rental" || a.type === "club") onWater++;
          else if (a.type === "slip") slipsOcc++;
        }
      }
      const maint = fleet.filter((b) => b.status === "maintenance").length;
      const club = subscriptions.filter(
        (s) => s.status === "active" || s.status === "past_due"
      ).length;
      return {
        onWaterCount: onWater,
        slipsOccupiedToday: slipsOcc,
        maintenanceCount: maint,
        activeClubMembers: club,
      };
    }, [activity, fleet, subscriptions, today]);
  const availableCount = Math.max(0, fleetSize - onWaterCount - maintenanceCount);
  const utilization = Math.round((onWaterCount / fleetSize) * 100);

  return (
    <div className="space-y-4">
      {/* Status snapshot — combined slip + fleet + club signal at a glance */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-hairline bg-surface-1 px-4 py-2.5 text-[12px]">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-status-warn" />
            <span className="font-medium text-fg">{slipsOccupiedToday}</span>
            <span className="text-fg-tertiary">slips occupied</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-status-info" />
            <span className="font-medium text-fg">{onWaterCount}</span>
            <span className="text-fg-tertiary">boats out</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-status-ok" />
            <span className="font-medium text-fg">{availableCount}</span>
            <span className="text-fg-tertiary">boats available</span>
          </span>
          {maintenanceCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-fg-tertiary/50" />
              <span className="font-medium text-fg">{maintenanceCount}</span>
              <span className="text-fg-tertiary">maintenance</span>
            </span>
          )}
          <span className="text-fg-tertiary">·</span>
          <span className="text-fg-tertiary">{utilization}% fleet in use</span>
          <span className="text-fg-tertiary">·</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="font-medium text-fg">{activeClubMembers}</span>
            <span className="text-fg-tertiary">active club members</span>
          </span>
        </div>
        <ListFilterSelect
          label="Type"
          value={filter}
          onChange={(v) => setFilter(v as UnifiedTypeFilter)}
          options={[
            { value: "all", label: "All types" },
            { value: "slip", label: "Slip" },
            { value: "rental", label: "Boat rental" },
            { value: "club", label: "Club" },
          ]}
        />
      </div>

      {/* Pending-request triage now lives on its own sidebar tab
          (drill-in detail + approve/decline). Use the sidebar count
          badge to jump there when something needs attention. */}

      {/* 14-day strip — arrivals/departures across all booking types */}
      <div className="overflow-x-auto rounded-[12px] border border-hairline bg-surface-1 p-2">
        <div className="flex min-w-max gap-1.5">
          {days.map((d) => {
            const stats = dayStats.get(d.date)!;
            const loadPct = Math.round((stats.onSite / totalCapacity) * 100);
            const isSelected = d.date === selectedDate;
            const isToday = d.date === today;
            const tone = loadPct >= 85 ? "danger" : loadPct >= 60 ? "warn" : "ok";
            const tonebg =
              tone === "danger"
                ? "bg-status-danger"
                : tone === "warn"
                ? "bg-status-warn"
                : "bg-status-ok";
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => setSelectedDate(d.date)}
                className={cn(
                  "flex min-w-[88px] flex-col items-stretch rounded-[10px] border px-2 py-2 text-left transition-all",
                  isSelected
                    ? "border-primary bg-primary-soft/40 shadow-sm"
                    : "border-hairline bg-surface-2 hover:border-hairline-strong"
                )}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "text-[10px] font-medium uppercase tracking-wide",
                      isToday ? "text-primary" : "text-fg-tertiary"
                    )}
                  >
                    {d.weekday}
                  </span>
                  {isToday && (
                    <span className="rounded-full bg-primary px-1 text-[9px] font-medium text-on-primary">
                      Today
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[13px] font-semibold text-fg">{d.label}</div>
                <div className="mt-2 flex items-center gap-2 text-[10px] text-fg-subtle">
                  <span>
                    <span className="font-semibold text-status-info">{stats.arrivals}</span> in
                  </span>
                  <span>
                    <span className="font-semibold text-status-warn">{stats.departures}</span> out
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className={cn("h-full transition-all", tonebg)}
                    style={{ width: `${Math.min(loadPct, 100)}%` }}
                  />
                </div>
                <div className="mt-0.5 text-[10px] text-fg-tertiary">
                  {stats.onSite} active
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected-day panels — unified across slip / rental / club */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <UnifiedDayPanel
          title="Arrivals"
          subtitle={prettyDate(selectedDate)}
          empty="No arrivals."
          items={arrivalsToday}
          variant="arrival"
          cleaningWoBySource={cleaningWoBySource}
        />
        <UnifiedDayPanel
          title="Departures"
          subtitle={prettyDate(selectedDate)}
          empty="No departures."
          items={departuresToday}
          variant="departure"
          cleaningWoBySource={cleaningWoBySource}
        />
        <UnifiedDayPanel
          title="On site"
          subtitle={`${onSiteNow.length} active mid-stay`}
          empty="Nothing active."
          items={onSiteNow.slice(0, 12)}
          variant="on_site"
          cleaningWoBySource={cleaningWoBySource}
        />
      </div>
    </div>
  );
}

// ─── Pending Requests tab ─────────────────────────────────────────────
//
// Master-detail surface for booking-request triage across EVERY booking
// type. Left column = unified queue with type filter pills + type chip
// on each row; right column = type-aware detail panel with the right
// context fields + Confirm / Decline routed to the per-type action.
//
// Sources today:
//   - club    → ClubBooking.status === "requested"
//   - rental  → BoatRental.status === "reserved" (booked but customer
//                hasn't completed the pickup agreement + deposit yet)
//   - slip    → Reservation.status === "requested" — no seed data yet
//                because slip reservations are operator-created today;
//                public-facing booking API will land them here.
//
// Confirming flips the right source's status to "confirmed" /
// "scheduled" — the booking then appears in the kanban + calendar
// through the same store hooks. Decline cancels.

// The literal we compare slip-reservation status against. Today the
// ReservationStatus union (lib/types.ts) does NOT include "requested";
// public-facing booking API submissions will add it. We keep the cast
// in one place so the day the union expands, removing this string
// surfaces every dependent call site as a type error — at which point
// the slip-side handlers in PendingDetail can drop their alert
// placeholders and route to real confirm/cancel mutations.
// TODO(public-booking-api): widen ReservationStatus + remove this cast.
const SLIP_PENDING_STATUS = "requested" as const;

// PendingRequest types reuse the shared 3-bucket BookingType union so
// the type chip primitive and the pending queue agree on the same
// slip/rental/club discriminator.
type PendingType = BookingType;

type PendingRequest =
  | { id: string; type: "club"; date: string; raw: ClubBooking }
  | { id: string; type: "rental"; date: string; raw: BoatRental }
  | { id: string; type: "slip"; date: string; raw: Reservation };

type PendingFilter = "all" | PendingType;

function PendingRequestsTab() {
  const allClub = useClubBookings();
  const allRentals = useBoatRentals();
  const allReservations = useReservations();
  const boaters = useBoaters();
  const subscriptions = useClubSubscriptions();
  const fleet = useRentalBoats();
  const plans = useClubPlans();
  const slips = useSlips();
  // Cleaning WO lookup — PendingDetail uses this to render the
  // "Cleaning · open/scheduled/done" chip in the request header when a
  // cleaning WO has already been spawned against this booking.
  const cleaningWoBySource = useCleaningWoBySource();
  const [filter, setFilter] = React.useState<PendingFilter>("all");

  // Single-pass aggregator — walks each source once, builds the sorted
  // pending list + per-type counts in one go (previously: 1 walk to
  // build + 3 more `.filter().length` walks for counts + 1 more for
  // filtered).
  const { pending, counts } = React.useMemo(() => {
    const out: PendingRequest[] = [];
    const c = { all: 0, slip: 0, rental: 0, club: 0 };
    for (const b of allClub) {
      if (b.status !== "requested") continue;
      out.push({ id: `club:${b.id}`, type: "club", date: b.date, raw: b });
      c.club++;
      c.all++;
    }
    for (const r of allRentals) {
      if (r.status !== "reserved") continue;
      out.push({
        id: `rental:${r.id}`,
        type: "rental",
        date: r.start_at.slice(0, 10),
        raw: r,
      });
      c.rental++;
      c.all++;
    }
    for (const r of allReservations) {
      // Slip reservations from the public booking API will land in a
      // "requested" status the ReservationStatus union doesn't ship
      // with yet — guard with a string-cast so the queue is ready the
      // moment the type union expands.
      if ((r.status as string) !== SLIP_PENDING_STATUS) continue;
      out.push({
        id: `slip:${r.id}`,
        type: "slip",
        date: r.arrival_date,
        raw: r,
      });
      c.slip++;
      c.all++;
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return { pending: out, counts: c };
  }, [allClub, allRentals, allReservations]);

  // Memoize filtered AND build an id→request map so the detail-panel
  // lookup is O(1) instead of `.find()` on every render.
  const { filtered, byId } = React.useMemo(() => {
    const f =
      filter === "all" ? pending : pending.filter((p) => p.type === filter);
    return { filtered: f, byId: new Map(f.map((p) => [p.id, p])) };
  }, [pending, filter]);

  // Lookup maps hoisted once per tab render — pass down to children
  // (list + detail) instead of rebuilding inside each. boaterById
  // returns the full Boater object (contact info etc.); the *NameById
  // variants are flat strings used by the list-row subline rendering.
  const boaterById = React.useMemo(
    () => new Map(boaters.map((b) => [b.id, b] as const)),
    [boaters]
  );
  const boaterNameById = React.useMemo(
    () => new Map(boaters.map((b) => [b.id, b.display_name] as const)),
    [boaters]
  );
  const slipLabelById = React.useMemo(
    () => new Map<string, string>(slips.map((s) => [s.id, s.number])),
    [slips]
  );
  const boatNameById = React.useMemo(
    () => new Map(fleet.map((b) => [b.id, b.name] as const)),
    [fleet]
  );
  const boatById = React.useMemo(
    () => new Map(fleet.map((b) => [b.id, b] as const)),
    [fleet]
  );
  const slipById = React.useMemo(
    () => new Map(slips.map((s) => [s.id, s] as const)),
    [slips]
  );

  // Selected-request id; auto-pick the first visible so the detail
  // panel is never empty on load. If the active request gets
  // confirmed / declined / filtered out, fall through to the next one.
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !byId.has(selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, byId, selectedId]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  // Pre-advance selection to the next visible request BEFORE a child
  // mutates the store. Without this the detail pane flashes "No
  // requests of this type" between the mutation and the effect that
  // catches up to the new filtered list.
  const advanceAfterMutation = React.useCallback(
    (mutatedId: string) => {
      const idx = filtered.findIndex((p) => p.id === mutatedId);
      if (idx === -1) return;
      const next = filtered[idx + 1] ?? filtered[idx - 1] ?? null;
      setSelectedId(next?.id ?? null);
    },
    [filtered]
  );

  if (pending.length === 0) {
    return (
      <div className="rounded-[12px] border border-hairline bg-surface-1 p-12 text-center">
        <CheckCircle2 className="mx-auto size-6 text-status-ok" />
        <div className="mt-2 text-[14px] font-medium text-fg">
          No pending requests
        </div>
        <p className="mx-auto mt-1 max-w-md text-[12px] text-fg-subtle">
          Every incoming slip reservation, boat rental, and club booking
          has been confirmed or declined. New requests from members and
          the public booking API will land here for triage.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Type filter — canonical ListFilterSelect with live counts */}
      <div className="flex flex-wrap items-center gap-2">
        <ListFilterSelect
          label="Type"
          value={filter}
          onChange={(v) => setFilter(v as PendingFilter)}
          options={[
            { value: "all", label: `All · ${counts.all}` },
            { value: "slip", label: `Slip · ${counts.slip}` },
            { value: "rental", label: `Boat rental · ${counts.rental}` },
            { value: "club", label: `Club · ${counts.club}` },
          ]}
        />
      </div>

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "minmax(280px, 360px) minmax(0, 1fr)" }}
      >
        <PendingList
          requests={filtered}
          boaterNameById={boaterNameById}
          slipLabelById={slipLabelById}
          boatNameById={boatNameById}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        {selected ? (
          <PendingDetail
            request={selected}
            boaterById={boaterById}
            boaterNameById={boaterNameById}
            boatById={boatById}
            slipById={slipById}
            subscriptions={subscriptions}
            plans={plans}
            allClubBookings={allClub}
            cleaningWoBySource={cleaningWoBySource}
            onAfterAction={advanceAfterMutation}
          />
        ) : (
          <div className="rounded-[12px] border border-hairline bg-surface-1 p-12 text-center text-[12px] text-fg-tertiary">
            No requests of this type. Try a different filter.
          </div>
        )}
      </div>
    </div>
  );
}

// Customer-name resolver — handles club/slip (boater_id) AND rental
// walk-ins (patron_name).
function customerForRequest(
  req: PendingRequest,
  boaterNameById: Map<string, string>
): string {
  if (req.type === "club") {
    return boaterNameById.get(req.raw.boater_id) ?? req.raw.boater_id;
  }
  if (req.type === "slip") {
    return boaterNameById.get(req.raw.boater_id) ?? req.raw.boater_id;
  }
  // rental
  if (req.raw.boater_id) {
    return boaterNameById.get(req.raw.boater_id) ?? req.raw.boater_id;
  }
  return req.raw.patron_name ?? "Walk-in";
}

function PendingList({
  requests,
  boaterNameById,
  slipLabelById,
  boatNameById,
  selectedId,
  onSelect,
}: {
  requests: PendingRequest[];
  boaterNameById: Map<string, string>;
  slipLabelById: Map<string, string>;
  boatNameById: Map<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  function subline(req: PendingRequest): string {
    const weekday = new Date(req.date).toLocaleDateString(undefined, {
      weekday: "long",
    });
    if (req.type === "club") {
      return req.raw.notes ? `${weekday} · "${req.raw.notes}"` : weekday;
    }
    if (req.type === "rental") {
      const boat = boatNameById.get(req.raw.boat_id) ?? req.raw.boat_id;
      return `${weekday} · ${boat}`;
    }
    // slip
    const slip = slipLabelById.get(req.raw.slip_id) ?? req.raw.slip_id;
    return `${weekday} · slip ${slip}`;
  }

  return (
    <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline bg-surface-2 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
        <span>Request queue</span>
        <span>{requests.length}</span>
      </div>
      <ul className="divide-y divide-hairline">
        {requests.map((req) => {
          const isActive = req.id === selectedId;
          return (
            <li key={req.id}>
              <button
                type="button"
                onClick={() => onSelect(req.id)}
                className={cn(
                  "flex w-full flex-col items-stretch gap-0.5 px-3 py-2 text-left transition-colors",
                  isActive ? "bg-primary-soft/40" : "hover:bg-surface-2"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <BookingTypeChip type={req.type} />
                    <span className="truncate text-[13px] font-medium text-fg">
                      {customerForRequest(req, boaterNameById)}
                    </span>
                  </div>
                  <LocalTime
                    iso={req.date}
                    fmt="short_date"
                    className="shrink-0 text-[11px] text-fg-tertiary tabular-nums"
                  />
                </div>
                <span className="truncate pl-[44px] text-[11px] text-fg-tertiary">
                  {subline(req)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PendingDetail({
  request,
  boaterById,
  boaterNameById,
  boatById,
  slipById,
  subscriptions,
  plans,
  allClubBookings,
  cleaningWoBySource,
  onAfterAction,
}: {
  request: PendingRequest;
  boaterById: Map<string, Boater>;
  boaterNameById: Map<string, string>;
  boatById: Map<string, RentalBoat>;
  slipById: Map<string, Slip>;
  subscriptions: ReturnType<typeof useClubSubscriptions>;
  plans: ReturnType<typeof useClubPlans>;
  allClubBookings: ClubBooking[];
  cleaningWoBySource: Map<string, WorkOrder>;
  // Parent advances the selection to the next visible request BEFORE
  // we mutate the store, so the detail pane never flashes "No requests
  // of this type" while React races to re-derive `filtered` + `selected`.
  onAfterAction: (mutatedId: string) => void;
}) {
  const customer = customerForRequest(request, boaterNameById);

  // Per-type confirm/decline handlers — each calls the right store
  // mutator so the booking flows into the kanban + calendar. Selection
  // advances BEFORE the mutation so the panel doesn't flicker through
  // the empty-state during the re-render.
  function handleConfirm() {
    onAfterAction(request.id);
    if (request.type === "club") {
      confirmClubBooking(request.raw.id);
    } else if (request.type === "rental") {
      updateBoatRental(request.raw.id, { status: "confirmed" });
    } else {
      // slip — would flip status to "scheduled". No-op today since
      // ReservationStatus doesn't include "requested" yet (see the
      // SLIP_PENDING_STATUS cast in PendingRequestsTab). When the
      // public booking API expands the union, remove the cast and
      // replace this alert with the real status update.
      window.alert(
        "Slip request approval will activate when the public booking API is wired."
      );
    }
  }
  function handleDecline() {
    if (!window.confirm(`Decline ${customer}'s request?`)) return;
    onAfterAction(request.id);
    if (request.type === "club") {
      upsertClubBooking({ ...request.raw, status: "cancelled" });
    } else if (request.type === "rental") {
      updateBoatRental(request.raw.id, { status: "cancelled" });
    } else {
      window.alert(
        "Slip request decline will activate when the public booking API is wired."
      );
    }
  }

  // Cleaning WO is keyed on the raw booking/rental/reservation id
  // (whatever spawned the cleaning job). The chip renders next to the
  // request-type chip so the operator knows a cleaning is already on
  // the board before they approve / decline.
  const cleaningChip = cleaningChipFor(cleaningWoBySource.get(request.raw.id));

  return (
    <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
      {/* Header — type chip + customer name + date(s) */}
      <div className="border-b border-hairline px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <BookingTypeChip type={request.type} />
          <span className="text-[11px] font-medium uppercase tracking-wide text-status-warn">
            Pending request
          </span>
          {cleaningChip && (
            <Badge tone={cleaningChip.tone} size="sm">
              {cleaningChip.label}
            </Badge>
          )}
        </div>
        <div className="mt-1 text-[20px] font-semibold text-fg">{customer}</div>
        <div className="mt-1 text-[13px] text-fg-subtle">
          {request.type === "slip" ? (
            <>
              <LocalTime iso={request.raw.arrival_date} fmt="weekday" />
              {" → "}
              <LocalTime iso={request.raw.departure_date} fmt="weekday" />
            </>
          ) : (
            <LocalTime iso={request.date} fmt="long_date" />
          )}
        </div>
      </div>

      {/* Body — type-aware detail fields */}
      <div className="space-y-4 px-5 py-4">
        {request.type === "club" && (
          <ClubDetailFields
            booking={request.raw}
            boaterById={boaterById}
            boatById={boatById}
            subscriptions={subscriptions}
            plans={plans}
            allClubBookings={allClubBookings}
          />
        )}
        {request.type === "rental" && (
          <RentalDetailFields
            rental={request.raw}
            boaterById={boaterById}
            boatById={boatById}
          />
        )}
        {request.type === "slip" && (
          <SlipDetailFields
            reservation={request.raw}
            boaterById={boaterById}
            slipById={slipById}
          />
        )}
      </div>

      {/* Action footer — same shape across all types */}
      <div className="flex items-center justify-end gap-2 border-t border-hairline bg-surface-2 px-5 py-3">
        <Button variant="secondary" size="sm" onClick={handleDecline}>
          <XCircle className="size-3.5" />
          Decline
        </Button>
        <Button variant="primary" size="sm" onClick={handleConfirm}>
          <CheckCircle2 className="size-3.5" />
          Confirm request
        </Button>
      </div>
    </div>
  );
}

function ClubDetailFields({
  booking,
  boaterById,
  boatById,
  subscriptions,
  plans,
  allClubBookings,
}: {
  booking: ClubBooking;
  boaterById: Map<string, Boater>;
  boatById: Map<string, RentalBoat>;
  subscriptions: ReturnType<typeof useClubSubscriptions>;
  plans: ReturnType<typeof useClubPlans>;
  allClubBookings: ClubBooking[];
}) {
  const boater = boaterById.get(booking.boater_id);
  const subscription = subscriptions.find(
    (s) => s.id === booking.subscription_id
  );
  const plan = plans.find((p) => p.id === subscription?.plan_rate_id);
  const boat = booking.rental_boat_id
    ? boatById.get(booking.rental_boat_id) ?? null
    : null;
  const monthKey = booking.date.slice(0, 7);
  const usedThisMonth = allClubBookings.filter(
    (b) =>
      b.subscription_id === booking.subscription_id &&
      (b.status === "confirmed" ||
        b.status === "checked_in" ||
        b.status === "completed") &&
      b.date.startsWith(monthKey)
  ).length;
  const allotment =
    subscription?.joined_at_days_per_month ?? plan?.days_per_month;
  const overAllotment = allotment != null && usedThisMonth >= allotment;

  return (
    <>
      <DetailRow label="Plan">
        <span className="capitalize">{plan?.plan_tier ?? "—"}</span>
        {plan?.amount != null && (
          <span className="ml-2 text-fg-tertiary">
            {formatMoney(plan.amount)}/mo
          </span>
        )}
      </DetailRow>
      <DetailRow label="Usage this month">
        <span className={overAllotment ? "text-status-warn" : "text-fg"}>
          {usedThisMonth}
          {allotment != null ? ` / ${allotment} days` : ""}
          {overAllotment && " · over allotment"}
        </span>
      </DetailRow>
      <DetailRow label="Boat requested">
        {boat ? (
          <span>{boat.name}</span>
        ) : (
          <span className="text-fg-tertiary">
            No specific boat — staff to assign
          </span>
        )}
      </DetailRow>
      <DetailRow label="Contact">
        <span className="text-fg-subtle">
          {boater?.primary_contact?.email || "no email"} ·{" "}
          {boater?.primary_contact?.phone || "no phone"}
        </span>
      </DetailRow>
      {booking.notes && (
        <DetailRow label="Member note">
          <span className="italic text-fg-subtle">
            &ldquo;{booking.notes}&rdquo;
          </span>
        </DetailRow>
      )}
    </>
  );
}

function RentalDetailFields({
  rental,
  boaterById,
  boatById,
}: {
  rental: BoatRental;
  boaterById: Map<string, Boater>;
  boatById: Map<string, RentalBoat>;
}) {
  const boater = rental.boater_id ? boaterById.get(rental.boater_id) : null;
  const boat = boatById.get(rental.boat_id);
  const start = new Date(rental.start_at);
  const end = new Date(rental.end_at);
  const hours = Math.max(
    0.5,
    Math.round(((end.getTime() - start.getTime()) / 3_600_000) * 10) / 10
  );
  const rateLabel =
    rental.rate_kind === "hourly"
      ? "Hourly"
      : rental.rate_kind === "half_day"
      ? "Half-day"
      : "Full-day";
  return (
    <>
      <DetailRow label="Boat">
        <span>{boat?.name ?? rental.boat_id}</span>
      </DetailRow>
      <DetailRow label="Pickup">
        <LocalTime iso={rental.start_at} fmt="datetime" />
      </DetailRow>
      <DetailRow label="Return">
        <LocalTime iso={rental.end_at} fmt="datetime" />
      </DetailRow>
      <DetailRow label="Duration">
        <span>
          {hours}h · {rateLabel}
        </span>
      </DetailRow>
      <DetailRow label="Base">
        <span className="tabular-nums">{formatMoney(rental.base_amount)}</span>
      </DetailRow>
      <DetailRow label="Deposit hold">
        <span className="tabular-nums">
          {formatMoney(rental.deposit_hold)}
        </span>
      </DetailRow>
      <DetailRow label="Customer">
        {boater ? (
          <span className="text-fg-subtle">
            {boater.display_name} ·{" "}
            {boater.primary_contact?.email || "no email"}
          </span>
        ) : (
          <span className="text-fg-subtle">
            {rental.patron_name ?? "Walk-in"} ·{" "}
            {rental.patron_email || rental.patron_phone || "no contact"}
          </span>
        )}
      </DetailRow>
    </>
  );
}

function SlipDetailFields({
  reservation,
  boaterById,
  slipById,
}: {
  reservation: Reservation;
  boaterById: Map<string, Boater>;
  slipById: Map<string, Slip>;
}) {
  const boater = boaterById.get(reservation.boater_id);
  const slip = slipById.get(reservation.slip_id);
  const arr = new Date(reservation.arrival_date);
  const dep = new Date(reservation.departure_date);
  const nights = Math.max(
    1,
    Math.round((dep.getTime() - arr.getTime()) / 86_400_000)
  );
  return (
    <>
      <DetailRow label="Slip">
        <span>{slip?.number ?? reservation.slip_id}</span>
      </DetailRow>
      <DetailRow label="Type">
        <span className="capitalize">{reservation.type}</span>
      </DetailRow>
      <DetailRow label="Length of stay">
        <span>
          {nights} night{nights === 1 ? "" : "s"}
        </span>
      </DetailRow>
      <DetailRow label="Contact">
        <span className="text-fg-subtle">
          {boater?.primary_contact?.email || "no email"} ·{" "}
          {boater?.primary_contact?.phone || "no phone"}
        </span>
      </DetailRow>
    </>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 text-[13px]">
      <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </div>
      <div className="text-fg">{children}</div>
    </div>
  );
}

// ─── Club Calendar tab ─────────────────────────────────────────────────
//
// Date-driven club surfaces in one place. Pending requests sit up top
// (operator's first decision is "confirm or decline"), Today's club is
// the dockside check-in surface, and the monthly grid lives at the
// bottom for forward planning. Kept separate from Fleet Bookings so
// the kanban day-strip there stays uncluttered.
function ClubCalendarTab() {
  const bookings = useClubBookings();
  const boaters = useBoaters();
  const subscriptions = useClubSubscriptions();

  // Pure month-grid view — pending requests + today's club moved to
  // the unified Bookings kanban so all triage + new-booking actions
  // live in one place. Calendar is just forward-planning here.
  return (
    <div className="space-y-4">
      <Panel
        title="Club booking calendar"
        action={
          <NewBookingButton subscriptions={subscriptions} boaters={boaters} />
        }
      >
        <ClubBookingCalendar
          bookings={bookings}
          subscriptions={subscriptions}
          boaters={boaters}
        />
      </Panel>
    </div>
  );
}

// Unified per-day panel — renders any UnifiedActivity (slip / rental
// / club) with a colored type chip so the operator can scan the
// stream and immediately know what each card is.
function UnifiedDayPanel({
  title,
  subtitle,
  empty,
  items,
  variant,
  cleaningWoBySource,
}: {
  title: string;
  subtitle: string;
  empty: string;
  items: UnifiedActivity[];
  variant: "arrival" | "departure" | "on_site";
  cleaningWoBySource: Map<string, WorkOrder>;
}) {
  const count = items.length;
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <div>
          <div className="text-[13px] font-medium text-fg">{title}</div>
          <div className="text-[10px] text-fg-tertiary">{subtitle}</div>
        </div>
        <Badge tone={count > 0 ? "info" : "neutral"} size="sm">
          {count}
        </Badge>
      </div>
      <div className="p-2">
        {count === 0 ? (
          <div className="px-3 py-4 text-center text-[12px] text-fg-tertiary">
            {empty}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {items.map((a) => {
              const cleaningChip = cleaningChipFor(
                cleaningWoBySource.get(a.id)
              );
              return (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-[8px] border border-hairline px-2.5 py-1.5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <BookingTypeChip type={a.type} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <div className="truncate text-[12px] font-medium text-fg">
                          {a.customer}
                        </div>
                        {cleaningChip && (
                          <Badge tone={cleaningChip.tone} size="sm">
                            {cleaningChip.label}
                          </Badge>
                        )}
                      </div>
                      {a.spaceLabel && (
                        <div className="truncate text-[11px] text-fg-tertiary">
                          {a.spaceLabel}
                        </div>
                      )}
                    </div>
                  </div>
                  {variant !== "arrival" && a.endAt && (
                    // LocalTime centralizes the SSR/client locale +
                    // timezone reconciliation so each render site
                    // doesn't have to remember suppressHydrationWarning.
                    <LocalTime
                      iso={a.endAt}
                      fmt="time"
                      className="shrink-0 text-[11px] text-fg-tertiary tabular-nums"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

