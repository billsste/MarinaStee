"use client";

import * as React from "react";
import Link from "next/link";
import {
  Sailboat,
  Waves,
  Clock,
  CheckCircle2,
  CircleDot,
  Fuel,
  Sparkles,
  Plus,
  ArrowRight,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney, rentalDurationLabel } from "@/lib/mock-data";
import { useBoatRentals, useRentalBoats } from "@/lib/client-store";
import type { BoatRental, BoatRentalStatus, RentalBoat } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * Boat Rentals landing surface.
 *
 * Live data flows from client-store hooks so any booking minted in
 * the wizard or auto-promoted via /pickup/[token] reflects here
 * without a reload.
 */
export function BoatRentalsView() {
  const fleet = useRentalBoats();
  const bookings = useBoatRentals();

  // ── Today's window — anything starting OR ending today
  const todayStart = startOfDay();
  const todayEnd = endOfDay();
  const isToday = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= todayStart.getTime() && t <= todayEnd.getTime();
  };

  const pickupsToday = bookings
    .filter((b) => isToday(b.start_at) && (b.status === "reserved" || b.status === "confirmed"))
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  const returnsToday = bookings
    .filter((b) => isToday(b.end_at) && b.status === "checked_out")
    .sort((a, b) => a.end_at.localeCompare(b.end_at));

  const onTheWater = bookings.filter((b) => b.status === "checked_out");
  const awaitingFinalCharges = bookings.filter((b) => b.status === "returned");

  // ── KPIs
  const fleetActive = fleet.filter((f) => f.active).length;
  const utilizationPct = fleetActive > 0 ? Math.round((onTheWater.length / fleetActive) * 100) : 0;
  const weekStart = new Date(Date.now() - 7 * 86_400_000);
  const revenueThisWeek = bookings
    .filter((b) => b.status === "closed" && new Date(b.updated_at) >= weekStart)
    .reduce((s, b) => s + (b.final_total ?? b.base_amount), 0);

  const recentBookings = [...bookings]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 8);

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={<Waves className="size-4" />}
          label="On the water now"
          value={String(onTheWater.length)}
          sub={`${utilizationPct}% fleet utilization`}
          tone={onTheWater.length > 0 ? "info" : "neutral"}
        />
        <Kpi
          icon={<Sailboat className="size-4" />}
          label="Pickups today"
          value={String(pickupsToday.length)}
          sub={pickupsToday.length > 0 ? `Next at ${formatTimeShort(pickupsToday[0].start_at)}` : "Nothing scheduled"}
          tone={pickupsToday.length > 0 ? "ok" : "neutral"}
        />
        <Kpi
          icon={<Clock className="size-4" />}
          label="Returns today"
          value={String(returnsToday.length)}
          sub={awaitingFinalCharges.length > 0 ? `${awaitingFinalCharges.length} awaiting charges` : "All settled"}
          tone={awaitingFinalCharges.length > 0 ? "warn" : "neutral"}
        />
        <Kpi
          icon={<CheckCircle2 className="size-4" />}
          label="Revenue (7d)"
          value={formatMoney(revenueThisWeek)}
          sub={`${bookings.filter((b) => b.status === "closed" && new Date(b.updated_at) >= weekStart).length} bookings closed`}
          tone="neutral"
        />
      </div>

      {/* Primary CTA bar — agent-first, with point-and-click fallback */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-primary/30 bg-primary-soft/30 px-4 py-3">
        <div className="flex items-center gap-2 text-[13px]">
          <Sparkles className="size-4 text-primary" />
          <span className="text-fg">
            Try: <span className="text-fg-subtle">"Book Pontoon 1 for the Whitfields, Saturday 2pm to 8pm"</span>
          </span>
        </div>
        <Link href="/boat-rentals/book">
          <Button variant="primary" size="sm">
            <Plus className="size-3.5" />
            New booking
          </Button>
        </Link>
      </div>

      {/* Today: pickups + returns + awaiting */}
      {(pickupsToday.length > 0 || returnsToday.length > 0 || awaitingFinalCharges.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <TodayPanel
            title="Pickups today"
            empty="No pickups scheduled."
            bookings={pickupsToday}
            fleet={fleet}
            kind="pickup"
          />
          <TodayPanel
            title="Returns today"
            empty="No returns scheduled."
            bookings={returnsToday}
            fleet={fleet}
            kind="return"
          />
          <TodayPanel
            title="Awaiting final charges"
            empty="All settled."
            bookings={awaitingFinalCharges}
            fleet={fleet}
            kind="awaiting"
          />
        </div>
      )}

      {/* Fleet grid */}
      <section>
        <header className="mb-2 flex items-end justify-between">
          <div>
            <h2 className="text-[15px] font-medium text-fg">Fleet</h2>
            <p className="text-[12px] text-fg-subtle">
              {fleet.filter((f) => f.status === "available").length} available · {onTheWater.length} on the water · {fleet.filter((f) => f.status === "maintenance").length} in maintenance
            </p>
          </div>
        </header>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {fleet
            .filter((b) => b.active)
            .map((boat) => {
              const activeBooking = bookings.find(
                (r) =>
                  r.boat_id === boat.id &&
                  (r.status === "reserved" || r.status === "confirmed" || r.status === "checked_out")
              );
              return <BoatCard key={boat.id} boat={boat} activeBooking={activeBooking} />;
            })}
        </div>
      </section>

      {/* Recent bookings */}
      <section className="rounded-[12px] border border-hairline bg-surface-1">
        <header className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
          <h2 className="text-[13px] font-medium text-fg">Recent bookings</h2>
          <span className="text-[11px] text-fg-tertiary">{bookings.length} total</span>
        </header>
        {recentBookings.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-fg-subtle">
            No bookings yet. Create the first one →
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {recentBookings.map((b) => {
              const boat = fleet.find((f) => f.id === b.boat_id);
              return <BookingRow key={b.id} booking={b} boat={boat} />;
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────

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
  sub?: string;
  tone: "ok" | "warn" | "danger" | "info" | "neutral";
}) {
  const tint =
    tone === "ok"
      ? "text-status-ok"
      : tone === "warn"
      ? "text-status-warn"
      : tone === "danger"
      ? "text-status-danger"
      : tone === "info"
      ? "text-status-info"
      : "text-fg-subtle";
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <div className={cn("inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide", tint)}>
        {icon}
        {label}
      </div>
      <div className="money-display mt-1 text-[26px] text-fg">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-fg-tertiary">{sub}</div>}
    </div>
  );
}

function TodayPanel({
  title,
  empty,
  bookings,
  fleet,
  kind,
}: {
  title: string;
  empty: string;
  bookings: BoatRental[];
  fleet: RentalBoat[];
  kind: "pickup" | "return" | "awaiting";
}) {
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <header className="border-b border-hairline px-4 py-2.5">
        <h3 className="text-[13px] font-medium text-fg">{title}</h3>
      </header>
      {bookings.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-fg-subtle">{empty}</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {bookings.map((b) => {
            const boat = fleet.find((f) => f.id === b.boat_id);
            const t = kind === "return" ? b.end_at : b.start_at;
            return (
              <li key={b.id}>
                <Link
                  href={`/boat-rentals/${b.id}`}
                  className="block cursor-pointer px-4 py-2.5 transition-colors hover:bg-surface-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-fg">
                        {customerLabel(b)}
                      </div>
                      <div className="text-[11px] text-fg-tertiary">
                        {boat?.name ?? "—"} · {rentalDurationLabel(b)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tabular text-[13px] text-fg">{formatTimeShort(t)}</div>
                      <StatusBadge status={b.status} />
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function BoatCard({
  boat,
  activeBooking,
}: {
  boat: RentalBoat;
  activeBooking?: BoatRental;
}) {
  const statusTone =
    boat.status === "available"
      ? "ok"
      : boat.status === "rented"
      ? "info"
      : boat.status === "maintenance"
      ? "warn"
      : "neutral";
  return (
    <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1 transition-colors hover:border-hairline-strong">
      <div className="flex items-center gap-2 border-b border-hairline bg-surface-2 px-3 py-2">
        <Sailboat className="size-3.5 text-fg-subtle" />
        <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">
          {boat.name}
        </div>
        <Badge tone={statusTone} size="sm">
          {boat.status === "rented" ? "on water" : boat.status}
        </Badge>
      </div>
      <div className="p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] capitalize text-fg-tertiary">
            {boat.type.replace("_", " ")} · {boat.capacity} pax
          </span>
          {boat.hour_meter_reading != null && (
            <span className="text-[11px] tabular text-fg-tertiary">
              {boat.hour_meter_reading} hrs
            </span>
          )}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="money-display text-[18px] text-fg">
            {formatMoney(boat.hourly_rate ?? boat.full_day_rate ?? 0)}
          </span>
          <span className="text-[11px] text-fg-tertiary">
            / {boat.hourly_rate ? "hr" : "day"}
          </span>
        </div>
        {boat.current_fuel_pct != null && (
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-fg-tertiary">
            <Fuel className="size-3" />
            <span className="tabular">{boat.current_fuel_pct}% fuel</span>
            <div className="ml-1 h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div
                className={cn(
                  "h-full rounded-full",
                  boat.current_fuel_pct > 50
                    ? "bg-status-ok"
                    : boat.current_fuel_pct > 25
                    ? "bg-status-warn"
                    : "bg-status-danger"
                )}
                style={{ width: `${boat.current_fuel_pct}%` }}
              />
            </div>
          </div>
        )}
        {activeBooking ? (
          <div className="mt-2 rounded-[8px] border border-status-info/30 bg-status-info/[0.05] px-2 py-1.5 text-[11px]">
            <div className="flex items-center gap-1 text-status-info">
              <CircleDot className="size-3" />
              <span className="font-medium">{customerLabel(activeBooking)}</span>
            </div>
            <div className="text-fg-tertiary">
              {formatTimeShort(activeBooking.start_at)} → {formatTimeShort(activeBooking.end_at)}
            </div>
          </div>
        ) : boat.status === "maintenance" ? (
          <div className="mt-2 rounded-[8px] border border-status-warn/30 bg-status-warn/[0.05] px-2 py-1.5 text-[11px] text-status-warn">
            <div className="flex items-center gap-1">
              <Wrench className="size-3" />
              <span>In maintenance</span>
            </div>
            {boat.notes && <div className="text-fg-tertiary">{boat.notes}</div>}
          </div>
        ) : (
          <Link
            href={`/boat-rentals/book?boatId=${boat.id}`}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Book this boat
            <ArrowRight className="size-3" />
          </Link>
        )}
      </div>
    </div>
  );
}

function BookingRow({
  booking,
  boat,
}: {
  booking: BoatRental;
  boat?: RentalBoat;
}) {
  return (
    <li>
      <Link
        href={`/boat-rentals/${booking.id}`}
        className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] font-medium text-primary">
              {booking.number}
            </span>
            <span className="text-[13px] text-fg">{customerLabel(booking)}</span>
          </div>
          <div className="text-[11px] text-fg-tertiary">
            {boat?.name ?? "—"} · {formatTimeShort(booking.start_at)} → {formatTimeShort(booking.end_at)} · {rentalDurationLabel(booking)}
          </div>
        </div>
        <div className="text-right">
          <div className="tabular text-[13px] text-fg">
            {formatMoney(booking.final_total ?? booking.base_amount)}
          </div>
          <StatusBadge status={booking.status} />
        </div>
      </Link>
    </li>
  );
}

function StatusBadge({ status }: { status: BoatRentalStatus }) {
  const map: Record<BoatRentalStatus, { tone: "ok" | "warn" | "danger" | "info" | "neutral"; label: string }> = {
    reserved: { tone: "neutral", label: "reserved" },
    confirmed: { tone: "info", label: "confirmed" },
    checked_out: { tone: "info", label: "on water" },
    returned: { tone: "warn", label: "returned" },
    closed: { tone: "ok", label: "closed" },
    cancelled: { tone: "danger", label: "cancelled" },
    no_show: { tone: "danger", label: "no show" },
  };
  const { tone, label } = map[status];
  return (
    <Badge tone={tone} size="sm">
      {label}
    </Badge>
  );
}

// ── Helpers ────────────────────────────────────────────────────

function customerLabel(b: BoatRental): string {
  if (b.boater_id) {
    // Annual holder rental — show their id-ish nicety. Could resolve via
    // store but for the landing card we just show patron_name fallback.
    return b.patron_name ?? `Holder ${b.boater_id.replace(/^b_/, "")}`;
  }
  return b.patron_name ?? "Walk-in customer";
}

function formatTimeShort(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function startOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfDay() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
