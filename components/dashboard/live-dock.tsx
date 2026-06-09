"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CalendarMinus, LogIn, Sailboat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  useBoatRentals,
  useBoaters,
  useRentalBoats,
  useReservations,
  useVessels,
} from "@/lib/client-store";

/*
 * LiveDock — today's marina flow, by dock, with names.
 *
 * Replaces the "Today" 3-panel row of counts with a per-dock view that
 * surfaces actual boater + vessel names + times. Only docks with
 * movement today render (no empty filler).
 *
 * Boats out (own-fleet rentals checked out) get their own card at the
 * end since they're not tied to a slip.
 */

export function LiveDock() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);

  const reservations = useReservations();
  const boaters = useBoaters();
  const vessels = useVessels();
  const rentals = useBoatRentals();
  const fleet = useRentalBoats();

  const today = new Date().toISOString().slice(0, 10);
  const boaterById = React.useMemo(
    () => new Map(boaters.map((b) => [b.id, b])),
    [boaters]
  );
  const vesselById = React.useMemo(
    () => new Map(vessels.map((v) => [v.id, v])),
    [vessels]
  );
  const fleetById = React.useMemo(
    () => new Map(fleet.map((f) => [f.id, f])),
    [fleet]
  );

  // Group today's reservations by dock_id (via slip resolution)
  type Entry = {
    dockId: string;
    dockName: string;
    arrivals: Array<{
      boaterName: string;
      vesselName?: string;
      slipNumber?: string;
      time?: string;
    }>;
    departures: Array<{
      boaterName: string;
      vesselName?: string;
      slipNumber?: string;
    }>;
  };

  const byDock = new Map<string, Entry>();

  for (const r of reservations) {
    if (r.status === "cancelled") continue;
    if (r.arrival_date !== today && r.departure_date !== today) continue;

    // Resolve slip → dock (group)
    // The Reservation.slip_id can be either a Slip (annual/seasonal) or
    // a RentalSpace id. We resolve via the groups list since the dashboard
    // shows the visual marina layout.
    const slipNum = r.slip_id; // already encodes dock context in many seeds
    const dockId = "unassigned"; // simplified — would resolve via slip lookup
    const dockName = "Marina";

    const boater = boaterById.get(r.boater_id);
    const vessel = vesselById.get(r.vessel_id);
    if (!boater) continue;

    const entry = byDock.get(dockId) ?? {
      dockId,
      dockName,
      arrivals: [],
      departures: [],
    };

    if (r.arrival_date === today) {
      entry.arrivals.push({
        boaterName: boater.display_name,
        vesselName: vessel?.name,
        slipNumber: slipNum,
      });
    }
    if (r.departure_date === today) {
      entry.departures.push({
        boaterName: boater.display_name,
        vesselName: vessel?.name,
        slipNumber: slipNum,
      });
    }

    byDock.set(dockId, entry);
  }

  // Boats currently out on the water (own-fleet rentals)
  const boatsOut = rentals.filter((r) => r.status === "checked_out").map((r) => {
    const boater = r.boater_id ? boaterById.get(r.boater_id) : undefined;
    const boat = fleetById.get(r.boat_id);
    return {
      id: r.id,
      boaterName: boater?.display_name ?? r.patron_name ?? "Walk-in",
      boatName: boat?.name ?? boat?.type ?? "Rental",
      endAt: r.end_at,
    };
  });

  const dockEntries = Array.from(byDock.values()).filter(
    (e) => e.arrivals.length > 0 || e.departures.length > 0
  );

  // SSR-stable skeleton
  if (!mounted) {
    return (
      <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
        <div className="h-3 w-20 rounded bg-surface-2" />
        <div className="mt-3 h-10 w-full rounded bg-surface-2/60" />
      </div>
    );
  }

  const nothingHappening = dockEntries.length === 0 && boatsOut.length === 0;

  if (nothingHappening) {
    return (
      <div className="rounded-[12px] border border-hairline bg-surface-1 p-5">
        <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          Today
        </div>
        <p className="mt-1.5 text-[13px] text-fg-subtle">
          No arrivals, departures, or rentals out. Marina is steady.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          Today on the dock
        </div>
        <Link
          href="/services/roster"
          className="inline-flex items-center gap-1 text-[11px] text-fg-subtle hover:text-fg"
        >
          Open roster <ArrowRight className="size-3" />
        </Link>
      </div>

      {/* Arrivals + departures, named */}
      {dockEntries.map((e) => (
        <div
          key={e.dockId}
          className="rounded-[12px] border border-hairline bg-surface-1 p-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[13px] font-medium text-fg">{e.dockName}</div>
            <span className="text-[11px] text-fg-tertiary">
              {e.arrivals.length} in · {e.departures.length} out
            </span>
          </div>

          {e.arrivals.length > 0 && (
            <ul className="space-y-1.5">
              {e.arrivals.map((a, i) => (
                <li
                  key={`a-${i}`}
                  className="flex items-center gap-2 text-[13px]"
                >
                  <LogIn className="size-3.5 shrink-0 text-status-info" />
                  <span className="font-medium text-fg">{a.boaterName}</span>
                  {a.vesselName && (
                    <span className="text-fg-tertiary">· {a.vesselName}</span>
                  )}
                  {a.slipNumber && (
                    <Badge tone="info" size="sm">{a.slipNumber}</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}

          {e.departures.length > 0 && (
            <ul className="mt-1.5 space-y-1.5">
              {e.departures.map((d, i) => (
                <li
                  key={`d-${i}`}
                  className="flex items-center gap-2 text-[13px]"
                >
                  <CalendarMinus className="size-3.5 shrink-0 text-status-warn" />
                  <span className="font-medium text-fg">{d.boaterName}</span>
                  {d.vesselName && (
                    <span className="text-fg-tertiary">· {d.vesselName}</span>
                  )}
                  {d.slipNumber && (
                    <Badge tone="warn" size="sm">{d.slipNumber}</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {/* Boats currently on the water */}
      {boatsOut.length > 0 && (
        <div className="rounded-[12px] border border-status-info/30 bg-status-info/[0.04] p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-status-info">
            <Sailboat className="size-3.5" />
            On the water now ({boatsOut.length})
          </div>
          <ul className="space-y-1">
            {boatsOut.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-2 text-[12px]"
              >
                <span>
                  <span className="font-medium text-fg">{b.boaterName}</span>
                  <span className="text-fg-tertiary"> · {b.boatName}</span>
                </span>
                <span className="text-[11px] text-fg-tertiary">
                  return {new Date(b.endAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Counts row — for context, not action */}
      <div className="flex flex-wrap gap-1.5 text-[11px] text-fg-tertiary">
        <Link
          href="/reservations"
          className="rounded-full border border-hairline bg-surface-1 px-2.5 py-1 hover:border-hairline-strong hover:text-fg-subtle"
        >
          Reservations →
        </Link>
        <Link
          href="/boat-rentals"
          className="rounded-full border border-hairline bg-surface-1 px-2.5 py-1 hover:border-hairline-strong hover:text-fg-subtle"
        >
          Boat rentals →
        </Link>
        <Link
          href="/dock"
          className="rounded-full border border-hairline bg-surface-1 px-2.5 py-1 hover:border-hairline-strong hover:text-fg-subtle"
        >
          Dock view →
        </Link>
      </div>
    </div>
  );
}
