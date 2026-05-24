"use client";

import * as React from "react";
import { CalendarRange, Sun, MoonStar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ReservationCard } from "@/components/reservations/reservation-card";
import { useReservations } from "@/lib/client-store";

/*
 * Today / upcoming panels. Reads live from store so new reservations show
 * up in the right bucket immediately. Replaces the static getArrivalsForDate
 * server-side calls so user-created entries are reflected.
 */
export function TodayView() {
  const reservations = useReservations();
  const today = new Date().toISOString().slice(0, 10);

  const arrivals = reservations.filter((r) => r.arrival_date === today);
  const departures = reservations.filter((r) => r.departure_date === today);

  const sevenDaysOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const upcoming = reservations
    .filter((r) => r.arrival_date > today && r.arrival_date <= sevenDaysOut)
    .sort((a, b) => (a.arrival_date < b.arrival_date ? -1 : 1));

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="Arrivals — today"
          icon={<Sun className="size-3.5 text-status-ok" />}
          count={arrivals.length}
        >
          {arrivals.length === 0 ? (
            <Empty text="No arrivals scheduled for today." />
          ) : (
            arrivals.map((r) => (
              <ReservationCard key={r.id} reservation={r} variant="arrival" />
            ))
          )}
        </Panel>

        <Panel
          title="Departures — today"
          icon={<MoonStar className="size-3.5 text-status-warn" />}
          count={departures.length}
        >
          {departures.length === 0 ? (
            <Empty text="No departures scheduled for today." />
          ) : (
            departures.map((r) => (
              <ReservationCard key={r.id} reservation={r} variant="departure" />
            ))
          )}
        </Panel>
      </section>

      <section>
        <Panel
          title="Upcoming — next 7 days"
          icon={<CalendarRange className="size-3.5 text-status-info" />}
          count={upcoming.length}
        >
          {upcoming.length === 0 ? (
            <Empty text="Nothing scheduled in the next 7 days." />
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {upcoming.map((r) => (
                <ReservationCard key={r.id} reservation={r} variant="upcoming" />
              ))}
            </div>
          )}
        </Panel>
      </section>
    </div>
  );
}

function Panel({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
          {icon}
          {title}
        </h3>
        {count !== undefined && (
          <Badge tone="neutral" size="sm">{count}</Badge>
        )}
      </div>
      <div className="space-y-2 p-3">{children}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-[8px] border border-dashed border-hairline px-3 py-6 text-center text-[12px] text-fg-tertiary">
      {text}
    </div>
  );
}

