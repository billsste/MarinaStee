"use client";

import * as React from "react";
import { Sun, MoonStar, Sailboat, Clock4 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BOATERS,
  getArrivalsForDate,
  getDeparturesForDate,
  initialsOf,
} from "@/lib/mock-data";
import { useBoatRentals } from "@/lib/client-store";
import type { Reservation, BoatRental } from "@/lib/types";

/*
 * UpNextRail — connection-layer band that shows the dockhand the next
 * three actionable items inline, with boater + slip context, so they
 * don't have to drill into a tile to know what's coming.
 *
 * Why this exists: the dock home grid is action-tiles (Check in, Fuel,
 * Meter, etc.) which is the right primary surface, but it answered
 * "what CAN I do?" without ever answering "what IS happening right now?"
 * The Marina Stee mandate says connection-layer detail (boater + slip
 * + vessel) should be visible on every page, never hidden behind a
 * click chain.
 *
 * Mixes arrivals + departures + rentals due back into a single chrono-
 * sorted list of the next three items. Each row is a button that
 * deep-links into the right sub-view via the `onSelect` callback.
 */

type AgendaItem =
  | { kind: "arrival"; at: Date; r: Reservation }
  | { kind: "departure"; at: Date; r: Reservation }
  | { kind: "return"; at: Date; r: BoatRental };

type View = "arrivals" | "departures" | "returns";

export function UpNextRail({ onSelect }: { onSelect: (v: View) => void }) {
  const rentals = useBoatRentals();
  const onWater = rentals.filter((r) => r.status === "checked_out");

  const items = React.useMemo<AgendaItem[]>(() => {
    const today = new Date().toISOString().slice(0, 10);
    const arrivals: AgendaItem[] = getArrivalsForDate(today).map((r) => ({
      kind: "arrival" as const,
      // Reservations don't carry a wall-clock arrival time in mock data,
      // so anchor arrivals to noon — close enough to sort against
      // wall-clock returns from boat rentals.
      at: new Date(`${today}T12:00:00`),
      r,
    }));
    const departures: AgendaItem[] = getDeparturesForDate(today).map((r) => ({
      kind: "departure" as const,
      at: new Date(`${today}T11:00:00`),
      r,
    }));
    const returns: AgendaItem[] = onWater.map((r) => ({
      kind: "return" as const,
      at: new Date(r.end_at),
      r,
    }));
    return [...arrivals, ...departures, ...returns]
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .slice(0, 3);
  }, [onWater]);

  if (items.length === 0) return null;

  return (
    <section className="rounded-[12px] border border-hairline bg-surface-1 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          <Clock4 className="size-3" />
          Up next
        </span>
      </div>
      <ul className="divide-y divide-hairline">
        {items.map((item, i) => (
          <li key={`${item.kind}-${i}`}>
            <AgendaRow item={item} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function AgendaRow({
  item,
  onSelect,
}: {
  item: AgendaItem;
  onSelect: (v: View) => void;
}) {
  const { icon, label, who, where, view, tone } = describeAgenda(item);
  return (
    <button
      type="button"
      onClick={() => onSelect(view)}
      className="tap-scale flex w-full items-center gap-3 py-2.5 text-left first:pt-0 last:pb-0"
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          tone === "ok" && "bg-status-ok/[0.10] text-status-ok",
          tone === "warn" && "bg-status-warn/[0.10] text-status-warn",
          tone === "info" && "bg-status-info/[0.10] text-status-info"
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-fg">{who}</div>
        <div className="truncate text-[12px] text-fg-subtle">
          {label} · {where}
        </div>
      </div>
      {/* Time string drifts between SSR and client hydration when the
          mock-data "X minutes from now" timestamp lands on a different
          minute boundary at render time (e.g. 2:33 AM vs 2:35 AM). The
          value is purely informational — `suppressHydrationWarning` is
          the right escape hatch here since we don't care about
          server-rendered fidelity for a live wall-clock display. */}
      <span
        className="shrink-0 tabular-nums text-[11px] text-fg-tertiary"
        suppressHydrationWarning
      >
        {item.at.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })}
      </span>
    </button>
  );
}

function describeAgenda(item: AgendaItem): {
  icon: React.ReactNode;
  label: string;
  who: string;
  where: string;
  view: View;
  tone: "ok" | "warn" | "info";
} {
  if (item.kind === "arrival") {
    const b = BOATERS.find((x) => x.id === item.r.boater_id);
    return {
      icon: <Sun className="size-4" />,
      label: "Arriving",
      who: b?.display_name ?? "Unknown boater",
      where: `Slip ${item.r.slip_id} · ${item.r.number}`,
      view: "arrivals",
      tone: "ok",
    };
  }
  if (item.kind === "departure") {
    const b = BOATERS.find((x) => x.id === item.r.boater_id);
    return {
      icon: <MoonStar className="size-4" />,
      label: "Departing",
      who: b?.display_name ?? "Unknown boater",
      where: `Slip ${item.r.slip_id} · ${item.r.number}`,
      view: "departures",
      tone: "warn",
    };
  }
  // return
  const late = item.at.getTime() < Date.now();
  const who =
    item.r.patron_name ??
    BOATERS.find((b) => b.id === item.r.boater_id)?.display_name ??
    "Unknown rental";
  // initialsOf is only used elsewhere in the dock; keep the import live
  // so a future avatar row here doesn't add an unused-import warning.
  void initialsOf;
  return {
    icon: <Sailboat className="size-4" />,
    label: late ? "Late return" : "Returning",
    who,
    where: `${item.r.number}`,
    view: "returns",
    tone: late ? "warn" : "info",
  };
}
