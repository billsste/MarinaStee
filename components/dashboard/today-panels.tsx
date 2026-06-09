"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  CalendarMinus,
  CheckCircle2,
  Clock,
  Sailboat,
} from "lucide-react";
import {
  useBoatRentals,
  useReservations,
} from "@/lib/client-store";

/*
 * Dashboard — "Today" row.
 *
 * Three panels covering the operational rhythm of the day: who's
 * arriving / leaving, who's picking up or returning a rental, and
 * how many boats are on the water right now. Anything that demands
 * action (urgent WOs, club requests, past-due money) has been pulled
 * into <NeedsAttention /> above this — this row is *state*, not
 * urgency.
 */
export function TodayPanels() {
  const reservations = useReservations();
  const rentals = useBoatRentals();

  const today = new Date().toISOString().slice(0, 10);

  const arrivals = reservations.filter(
    (r) => r.arrival_date === today && r.status !== "cancelled"
  );
  const departures = reservations.filter(
    (r) => r.departure_date === today && r.status !== "cancelled"
  );

  const pickupsToday = rentals.filter(
    (r) =>
      (r.status === "reserved" || r.status === "confirmed") &&
      r.start_at?.slice(0, 10) === today
  );
  const returnsToday = rentals.filter(
    (r) => r.status === "checked_out" && r.end_at?.slice(0, 10) === today
  );

  const boatsOut = rentals.filter((r) => r.status === "checked_out").length;

  return (
    <>
      <div className="mt-6 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        Today
      </div>
      <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Panel
          title="Arrivals & departures"
          icon={<CalendarCheck className="size-3.5" />}
          href="/reservations"
        >
          <StatRow
            icon={<CalendarCheck className="size-3.5 text-status-info" />}
            label="Arriving"
            count={arrivals.length}
            empty="No arrivals today"
          />
          <StatRow
            icon={<CalendarMinus className="size-3.5 text-status-warn" />}
            label="Departing"
            count={departures.length}
            empty="No departures today"
          />
        </Panel>

        <Panel
          title="Pickups & returns"
          icon={<Sailboat className="size-3.5" />}
          href="/boat-rentals"
        >
          <StatRow
            icon={<Clock className="size-3.5 text-status-info" />}
            label="Pickups"
            count={pickupsToday.length}
            empty="No pickups today"
          />
          <StatRow
            icon={<CheckCircle2 className="size-3.5 text-status-ok" />}
            label="Returns"
            count={returnsToday.length}
            empty="No returns today"
          />
        </Panel>

        <Panel
          title="Boats out"
          icon={<Sailboat className="size-3.5" />}
          href="/boat-rentals"
        >
          <StatRow
            icon={<Sailboat className="size-3.5 text-status-info" />}
            label="On the water"
            count={boatsOut}
            empty="All boats in"
          />
        </Panel>
      </div>
    </>
  );
}

function Panel({
  title,
  icon,
  href,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-[12px] border border-hairline bg-surface-1 p-3 transition-colors hover:border-hairline-strong hover:bg-surface-2"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-fg">
          <span className="text-fg-subtle">{icon}</span>
          {title}
        </div>
        <ArrowRight className="size-3.5 text-fg-tertiary transition-colors group-hover:text-fg-subtle" />
      </div>
      <div className="space-y-1.5">{children}</div>
    </Link>
  );
}

function StatRow({
  icon,
  label,
  count,
  empty,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  empty: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-[8px] border border-hairline bg-surface-2/60 px-2.5 py-1.5">
      <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-[11px] text-fg-subtle">
        {icon}
        <span className="truncate">{count > 0 ? label : empty}</span>
      </span>
      <span className="shrink-0 text-[15px] font-semibold tabular-nums text-fg">
        {count}
      </span>
    </div>
  );
}
