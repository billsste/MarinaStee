"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Flag,
  PartyPopper,
  Sparkles,
  Trophy,
  Wrench,
  X,
} from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BOATERS, getSlip } from "@/lib/mock-data";
import {
  toggleEventRsvp,
  useMarinaEvents,
  usePicklistLabel,
  useReservations,
} from "@/lib/client-store";
import { cn } from "@/lib/utils";
import { AddEventSheet } from "@/components/events/add-event-sheet";
import type { MarinaEvent, MarinaEventType, Reservation, ReservationType } from "@/lib/types";

/*
 * Month-grid calendar for reservations. Each cell shows reservations active
 * on that day (i.e. arrival <= day <= departure), color-coded by type.
 * Click a day → drawer with full arrivals / departures / occupied for that
 * day. Live from the client store so new reservations appear immediately.
 *
 * Type tones:
 *   annual / seasonal — primary  (long-term residents)
 *   monthly           — info     (mid-term)
 *   transient         — ok       (short-stay, dock-walker)
 *   recurring         — warn     (repeating series)
 */

const TYPE_TONE: Record<ReservationType, string> = {
  annual: "bg-primary/20 border-primary/40 text-primary",
  seasonal: "bg-primary/15 border-primary/30 text-primary",
  monthly: "bg-status-info/20 border-status-info/40 text-status-info",
  transient: "bg-status-ok/20 border-status-ok/40 text-status-ok",
  recurring: "bg-status-warn/20 border-status-warn/40 text-status-warn",
};

// Marina events use a distinct purple swatch so they never visually conflict
// with reservation bars on the same day. All events share the tone — the icon
// communicates type.
const EVENT_TONE = "bg-[#c084fc]/20 border-[#c084fc]/50 text-[#7c3aed] dark:text-[#c084fc]";

const EVENT_ICON: Record<MarinaEventType, React.ComponentType<{ className?: string }>> = {
  social: PartyPopper,
  tournament: Trophy,
  regatta: Flag,
  fireworks: Sparkles,
  season: Flag,
  maintenance: Wrench,
  other: Sparkles,
};

export function CalendarView() {
  const reservations = useReservations();
  const events = useMarinaEvents();
  // Anchor month at today's month; users can navigate with prev/next.
  const [anchor, setAnchor] = React.useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = React.useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = React.useState<string | null>(null);
  const [showEvents, setShowEvents] = React.useState(true);
  const [addEventOpen, setAddEventOpen] = React.useState(false);

  const days = React.useMemo(() => buildMonthGrid(anchor), [anchor]);

  // Build a map: ISO date → reservations active on that day
  const byDate = React.useMemo(() => {
    const m = new Map<string, Reservation[]>();
    for (const r of reservations) {
      // Iterate from arrival to departure (inclusive)
      const start = new Date(r.arrival_date);
      const end = new Date(r.departure_date);
      const cursor = new Date(start);
      while (cursor <= end) {
        const key = cursor.toISOString().slice(0, 10);
        const list = m.get(key) ?? [];
        list.push(r);
        m.set(key, list);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return m;
  }, [reservations]);

  // Same pattern for events
  const eventsByDate = React.useMemo(() => {
    const m = new Map<string, MarinaEvent[]>();
    if (!showEvents) return m;
    for (const e of events) {
      const start = new Date(e.start_date);
      const end = new Date(e.end_date);
      const cursor = new Date(start);
      while (cursor <= end) {
        const key = cursor.toISOString().slice(0, 10);
        const list = m.get(key) ?? [];
        list.push(e);
        m.set(key, list);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return m;
  }, [events, showEvents]);

  const selectedEvent = selectedEventId
    ? events.find((e) => e.id === selectedEventId) ?? null
    : null;

  const monthLabel = anchor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-3">
      {/* Header: nav + legend */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAnchor((a) => new Date(a.getFullYear(), a.getMonth() - 1, 1))}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="display-tight min-w-[180px] text-center text-[16px] font-semibold text-fg">
            {monthLabel}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + 1, 1))}
            aria-label="Next month"
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const now = new Date();
              setAnchor(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
          >
            Today
          </Button>
          <label className="ml-2 inline-flex items-center gap-1.5 text-[12px] text-fg-subtle">
            <input
              type="checkbox"
              checked={showEvents}
              onChange={(e) => setShowEvents(e.target.checked)}
              className="size-3.5"
            />
            Show events
          </label>
          <Button variant="primary" size="sm" onClick={() => setAddEventOpen(true)}>
            <CalendarPlus className="size-3.5" />
            New event
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-tertiary">
          <span>Legend:</span>
          <LegendDot label="Annual / Seasonal" cls={TYPE_TONE.annual} />
          <LegendDot label="Monthly" cls={TYPE_TONE.monthly} />
          <LegendDot label="Transient" cls={TYPE_TONE.transient} />
          <LegendDot label="Recurring" cls={TYPE_TONE.recurring} />
          {showEvents && <LegendDot label="Event" cls={EVENT_TONE} />}
        </div>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-[12px] border border-hairline bg-hairline">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div
            key={d}
            className="bg-surface-2 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle"
          >
            {d}
          </div>
        ))}

        {days.map((day) => {
          const key = day.iso;
          const inMonth = day.inMonth;
          const dayRes = byDate.get(key) ?? [];
          const dayEvents = eventsByDate.get(key) ?? [];
          const isToday = key === todayKey;
          const isSelected = key === selectedDate;
          const totalItems = dayRes.length + dayEvents.length;
          // Show events first (they're rarer / more important), then reservations
          const visibleEvents = dayEvents.slice(0, 2);
          const remainingSlots = Math.max(0, 3 - visibleEvents.length);
          const visibleRes = dayRes.slice(0, remainingSlots);
          const hiddenCount = totalItems - visibleEvents.length - visibleRes.length;
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedDate(key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedDate(key);
                }
              }}
              className={cn(
                "flex min-h-[88px] cursor-pointer flex-col gap-1 bg-surface-1 px-1.5 py-1 text-left transition-colors hover:bg-surface-2 focus:outline-none focus:ring-1 focus:ring-primary",
                !inMonth && "bg-surface-2/60",
                isToday && "ring-1 ring-inset ring-primary/50",
                isSelected && "bg-primary-soft/40"
              )}
            >
              <span
                className={cn(
                  "text-[11px] font-medium",
                  inMonth ? "text-fg" : "text-fg-tertiary",
                  isToday && "text-primary"
                )}
              >
                {day.day}
              </span>
              <div className="flex flex-col gap-0.5">
                {visibleEvents.map((e) => {
                  const Icon = EVENT_ICON[e.event_type];
                  return (
                    <button
                      key={e.id + key}
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setSelectedEventId(e.id);
                      }}
                      className={cn(
                        "flex items-center gap-0.5 truncate rounded-[3px] border-l-2 px-1 py-px text-left text-[10px] font-medium hover:brightness-110",
                        EVENT_TONE
                      )}
                      title={e.title}
                    >
                      <Icon className="size-2.5 shrink-0" />
                      <span className="truncate">{e.title}</span>
                    </button>
                  );
                })}
                {visibleRes.map((r) => {
                  const isStart = r.arrival_date === key;
                  const isEnd = r.departure_date === key;
                  const boater = BOATERS.find((b) => b.id === r.boater_id);
                  return (
                    <div
                      key={r.id + key}
                      className={cn(
                        "truncate rounded-[3px] border-l-2 px-1 py-px text-[10px] font-medium",
                        TYPE_TONE[r.type],
                        isStart && "rounded-l-[6px]",
                        isEnd && "rounded-r-[6px]"
                      )}
                    >
                      {isStart && "→ "}
                      {boater?.last_name ?? r.boater_id.slice(-4)}
                      {isEnd && " ←"}
                    </div>
                  );
                })}
                {hiddenCount > 0 && (
                  <div className="text-[10px] text-fg-tertiary">+{hiddenCount} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-center text-[11px] text-fg-tertiary">
        Click a day to see arrivals, departures, and occupancy detail. Bars show the full stay span — a left arrow marks arrival, right arrow marks departure.
      </p>

      <DayDrawer
        date={selectedDate}
        reservations={selectedDate ? byDate.get(selectedDate) ?? [] : []}
        events={selectedDate ? eventsByDate.get(selectedDate) ?? [] : []}
        onClose={() => setSelectedDate(null)}
        onOpenEvent={(id) => {
          setSelectedDate(null);
          setSelectedEventId(id);
        }}
      />

      <EventDetailDialog
        event={selectedEvent}
        onClose={() => setSelectedEventId(null)}
      />

      <AddEventSheet
        open={addEventOpen}
        onOpenChange={setAddEventOpen}
        defaultDate={selectedDate ?? undefined}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function DayDrawer({
  date,
  reservations,
  events,
  onClose,
  onOpenEvent,
}: {
  date: string | null;
  reservations: Reservation[];
  events: MarinaEvent[];
  onClose: () => void;
  onOpenEvent: (id: string) => void;
}) {
  if (!date) return null;
  const friendly = new Date(date).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const arrivals = reservations.filter((r) => r.arrival_date === date);
  const departures = reservations.filter((r) => r.departure_date === date);
  const occupied = reservations.filter(
    (r) => r.arrival_date < date && r.departure_date > date
  );

  return (
    <DialogPrimitive.Root open={Boolean(date)} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed right-0 top-0 z-50 h-full w-full max-w-[440px] overflow-hidden border-l border-hairline bg-surface-1 shadow-2xl focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <header className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
            <div>
              <DialogPrimitive.Title className="display-tight text-[16px] font-semibold text-fg">
                {friendly}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-[12px] text-fg-subtle">
                {arrivals.length} arrival{arrivals.length === 1 ? "" : "s"} ·{" "}
                {departures.length} departure{departures.length === 1 ? "" : "s"} ·{" "}
                {occupied.length} mid-stay
                {events.length > 0 ? ` · ${events.length} event${events.length === 1 ? "" : "s"}` : ""}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="rounded-md p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>

          <div className="space-y-4 overflow-y-auto p-5" style={{ maxHeight: "calc(100vh - 80px)" }}>
            {events.length > 0 && (
              <div>
                <h3 className="mb-2 inline-flex items-center gap-2 text-[12px] font-medium uppercase tracking-wide text-fg-subtle">
                  Events
                  <Badge tone="primary" size="sm">{events.length}</Badge>
                </h3>
                <ul className="space-y-1.5">
                  {events.map((e) => {
                    const Icon = EVENT_ICON[e.event_type];
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => onOpenEvent(e.id)}
                          className={cn(
                            "flex w-full items-start gap-2 rounded-[8px] border px-3 py-2 text-left",
                            EVENT_TONE,
                            "hover:brightness-110"
                          )}
                        >
                          <Icon className="mt-0.5 size-3.5 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-[13px] font-medium">{e.title}</div>
                            <div className="text-[11px] opacity-80">
                              {e.start_time ? `${e.start_time}${e.end_time ? `–${e.end_time}` : ""}` : "All day"}
                              {e.location ? ` · ${e.location}` : ""}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <DaySection title="Arriving" tone="ok" items={arrivals} />
            <DaySection title="Departing" tone="warn" items={departures} />
            <DaySection title="Mid-stay" tone="neutral" items={occupied} />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// Event detail dialog — used by both the day-drawer event rows and the
// inline event bars in the calendar grid.
function EventDetailDialog({
  event,
  onClose,
}: {
  event: MarinaEvent | null;
  onClose: () => void;
}) {
  const eventTypeLabel = usePicklistLabel("event_type", event?.event_type);
  if (!event) return null;
  const Icon = EVENT_ICON[event.event_type];
  const sameDay = event.start_date === event.end_date;
  const dateLine = sameDay
    ? new Date(event.start_date).toLocaleDateString(undefined, {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
      })
    : `${event.start_date} → ${event.end_date}`;
  const timeLine = event.start_time
    ? `${event.start_time}${event.end_time ? ` – ${event.end_time}` : ""}`
    : "All day";
  const rsvps = event.rsvp_boater_ids
    .map((id) => BOATERS.find((b) => b.id === id))
    .filter(Boolean);

  return (
    <DialogPrimitive.Root open={Boolean(event)} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-[480px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[14px] border border-hairline bg-surface-1 shadow-2xl focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
          <header className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
            <div className="flex items-start gap-3">
              <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-[10px]", EVENT_TONE)}>
                <Icon className="size-4" />
              </div>
              <div>
                <DialogPrimitive.Title className="display-tight text-[18px] font-semibold text-fg">
                  {event.title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-0.5 text-[12px] text-fg-subtle">
                  {dateLine} · {timeLine}
                  {event.location ? ` · ${event.location}` : ""}
                </DialogPrimitive.Description>
              </div>
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="rounded-md p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>

          <div className="space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="outline" size="sm" className="capitalize">
                {eventTypeLabel !== "—" ? eventTypeLabel : event.event_type}
              </Badge>
              {event.public_to_boaters && <Badge tone="primary" size="sm">Visible to boaters</Badge>}
              {event.capacity && (
                <Badge
                  tone={rsvps.length >= event.capacity ? "danger" : "neutral"}
                  size="sm"
                >
                  {rsvps.length} / {event.capacity} RSVPs
                </Badge>
              )}
              {!event.capacity && rsvps.length > 0 && (
                <Badge tone="neutral" size="sm">{rsvps.length} RSVPs</Badge>
              )}
            </div>

            {event.description && (
              <p className="text-[13px] leading-5 text-fg">{event.description}</p>
            )}

            {rsvps.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
                  RSVPs
                </div>
                <ul className="space-y-1">
                  {rsvps.map((b) => (
                    <li key={b!.id} className="flex items-center justify-between text-[12px]">
                      <Link href={`/members/${b!.id}`} className="text-fg hover:text-primary">
                        {b!.display_name}
                      </Link>
                      <button
                        type="button"
                        onClick={() => toggleEventRsvp(event.id, b!.id)}
                        className="text-[11px] text-fg-tertiary hover:text-status-danger"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function DaySection({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "ok" | "warn" | "neutral";
  items: Reservation[];
}) {
  if (items.length === 0) {
    return (
      <div>
        <h3 className="mb-2 inline-flex items-center gap-2 text-[12px] font-medium uppercase tracking-wide text-fg-subtle">
          {title}
          <Badge tone="neutral" size="sm">0</Badge>
        </h3>
        <div className="rounded-[8px] border border-dashed border-hairline px-3 py-3 text-center text-[11px] text-fg-tertiary">
          None
        </div>
      </div>
    );
  }
  return (
    <div>
      <h3 className="mb-2 inline-flex items-center gap-2 text-[12px] font-medium uppercase tracking-wide text-fg-subtle">
        {title}
        <Badge tone={tone === "ok" ? "ok" : tone === "warn" ? "warn" : "neutral"} size="sm">
          {items.length}
        </Badge>
      </h3>
      <ul className="space-y-1.5">
        {items.map((r) => {
          const boater = BOATERS.find((b) => b.id === r.boater_id);
          const slip = getSlip(r.slip_id);
          return (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {boater ? (
                    <Link
                      href={`/members/${boater.id}`}
                      className="truncate text-[13px] font-medium text-fg hover:text-primary"
                    >
                      {boater.display_name}
                    </Link>
                  ) : (
                    <span className="text-fg-tertiary">—</span>
                  )}
                  <Badge tone="outline" size="sm">{r.type}</Badge>
                </div>
                <div className="mt-0.5 text-[11px] text-fg-tertiary">
                  {slip ? `${slip.dock} · ${slip.number}` : `slip ${r.slip_id}`}
                  {" · "}
                  {r.arrival_date} → {r.departure_date}
                </div>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-fg-tertiary">
                {r.number}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LegendDot({ label, cls }: { label: string; cls: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-block size-2.5 rounded-sm border", cls)} aria-hidden />
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Date math: build a 6x7 grid for the given month, padded with prev/next-month days.

type GridDay = { iso: string; day: number; inMonth: boolean };

function buildMonthGrid(anchor: Date): GridDay[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  // First day of grid = Sunday on or before the 1st of month
  const first = new Date(year, month, 1);
  const startOffset = first.getDay(); // 0 (Sun) .. 6 (Sat)
  const gridStart = new Date(year, month, 1 - startOffset);

  const out: GridDay[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    out.push({
      iso: d.toISOString().slice(0, 10),
      day: d.getDate(),
      inMonth: d.getMonth() === month,
    });
  }
  return out;
}
