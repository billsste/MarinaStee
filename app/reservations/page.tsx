import { CalendarCheck, CalendarMinus, CalendarRange } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { ReservationsTabs } from "@/components/reservations/reservations-tabs";
import {
  RESERVATIONS,
  getArrivalsForDate,
  getDeparturesForDate,
  getUpcomingReservations,
} from "@/lib/mock-data";

export const metadata = { title: "Reservations — Marina Stee" };

export default function ReservationsPage() {
  // KPI snapshot uses the static seed — runtime entries also appear inside the tabs.
  const today = new Date().toISOString().slice(0, 10);
  const arrivals = getArrivalsForDate(today);
  const departures = getDeparturesForDate(today);
  const upcoming = getUpcomingReservations(today, 7);
  const active = RESERVATIONS.filter((r) => r.status === "occupied").length;
  const transientToday = arrivals.filter((r) => r.type === "transient").length;

  return (
    <PageShell
      title="Reservations"
      description="Calendar, today's queue, and the full list. Manager's home for who's coming and going."
    >
      <RentalsAsk
        placeholder="Ask the agent — e.g. 'who's arriving today?' or 'find a vacant slip for a 28-footer Friday night'"
        suggestions={[
          "Who's arriving today?",
          "Find an open slip for a 28-footer Friday night",
          "Send arrival reminders to today's transients",
          "Block A12 for maintenance next week",
        ]}
      />

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-4">
        <Kpi
          icon={<CalendarCheck className="size-4" />}
          label="Arriving today"
          value={`${arrivals.length}`}
          sub={`${transientToday} transient`}
          tone={arrivals.length > 0 ? "info" : "neutral"}
        />
        <Kpi
          icon={<CalendarMinus className="size-4" />}
          label="Departing today"
          value={`${departures.length}`}
          sub="Free slips after check-out"
          tone={departures.length > 0 ? "warn" : "neutral"}
        />
        <Kpi
          icon={<CalendarRange className="size-4" />}
          label="Upcoming (7 days)"
          value={`${upcoming.length}`}
          sub="Scheduled arrivals"
          tone="neutral"
        />
        <Kpi
          icon={<CalendarRange className="size-4" />}
          label="Active reservations"
          value={`${active}`}
          sub="Currently occupied"
          tone="ok"
        />
      </div>

      <div className="mt-6">
        <ReservationsTabs />
      </div>
    </PageShell>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: "ok" | "warn" | "info" | "neutral";
}) {
  const dot =
    tone === "warn" ? "bg-status-warn"
    : tone === "info" ? "bg-status-info"
    : tone === "ok" ? "bg-status-ok"
    : "bg-fg-tertiary/40";
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <div className="mb-1.5 flex items-center justify-between text-fg-subtle">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium">{icon}{label}</span>
        <span className={"size-1.5 rounded-full " + dot} aria-hidden />
      </div>
      <div className="money-display text-[26px] text-fg">{value}</div>
      <div className="mt-1 text-[11px] text-fg-tertiary">{sub}</div>
    </div>
  );
}
