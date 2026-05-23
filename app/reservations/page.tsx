import Link from "next/link";
import { CalendarCheck, CalendarMinus, CalendarRange, Sun, MoonStar } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { ReservationCard } from "@/components/reservations/reservation-card";
import {
  BOATERS,
  RESERVATIONS,
  getArrivalsForDate,
  getDeparturesForDate,
  getSlip,
  getUpcomingReservations,
} from "@/lib/mock-data";

export const metadata = { title: "Reservations — Marina Stee" };

export default function ReservationsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const arrivals = getArrivalsForDate(today);
  const departures = getDeparturesForDate(today);
  const upcoming = getUpcomingReservations(today, 7);

  const active = RESERVATIONS.filter((r) => r.status === "occupied").length;
  const transientToday = arrivals.filter((r) => r.type === "transient").length;

  return (
    <PageShell
      title="Reservations"
      description="Arrivals, departures, transient assignments. Manager's daily queue for who's coming and going."
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

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
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

      <section className="mt-6">
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

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[14px] font-medium text-fg">All reservations</h2>
          <Button variant="primary" size="sm">+ New reservation</Button>
        </div>
        <div className="rounded-[12px] border border-hairline bg-surface-1">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-[11px] uppercase tracking-wide text-fg-tertiary">
                  <Th>Number</Th>
                  <Th>Boater</Th>
                  <Th>Slip</Th>
                  <Th>Arrival</Th>
                  <Th>Departure</Th>
                  <Th>Type</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {RESERVATIONS
                  .slice()
                  .sort((a, b) => (a.arrival_date < b.arrival_date ? 1 : -1))
                  .map((r) => {
                    const boater = BOATERS.find((b) => b.id === r.boater_id);
                    const slip = getSlip(r.slip_id);
                    const typeTone = r.type === "transient" ? "info" : "primary";
                    const statusTone =
                      r.status === "occupied" ? "ok"
                      : r.status === "scheduled" ? "info"
                      : r.status === "completed" ? "neutral"
                      : "danger";
                    return (
                      <tr key={r.id} className="border-b border-hairline last:border-b-0 hover:bg-surface-2">
                        <Td className="font-mono text-[12px] font-medium text-fg">{r.number}{r.seq !== "1/1" ? ` ${r.seq}` : ""}</Td>
                        <Td>
                          {boater ? (
                            <Link href={`/boaters/${boater.id}`} className="text-primary hover:underline">
                              {boater.display_name}
                            </Link>
                          ) : (
                            <span className="text-fg-tertiary">—</span>
                          )}
                        </Td>
                        <Td className="text-fg-subtle">
                          {slip ? `${slip.dock} · ${slip.number}` : r.slip_id}
                        </Td>
                        <Td className="text-fg-subtle">{r.arrival_date}</Td>
                        <Td className="text-fg-subtle">{r.departure_date}</Td>
                        <Td>
                          <Badge tone={typeTone} size="sm">{r.type}</Badge>
                        </Td>
                        <Td>
                          <Badge tone={statusTone} size="sm">{r.status}</Badge>
                        </Td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
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
      <div className="text-[22px] font-semibold tracking-tight text-fg">{value}</div>
      <div className="mt-1 text-[11px] text-fg-tertiary">{sub}</div>
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

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left font-medium">{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={"px-3 py-2 align-middle " + (className ?? "")}>{children}</td>;
}
