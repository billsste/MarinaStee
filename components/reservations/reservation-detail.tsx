"use client";

/*
 * Reservation detail surface. The "+ id" page didn't exist before
 * the connection-layer audit — ReservationCard (used on /reservations
 * + the boater Overview timeline) shows boater/vessel/slip without
 * deep links. This component closes the gap by surfacing the full
 * inline connection layer:
 *
 *   boater · vessel · slip
 *   contract (if any) · linked work orders · linked ledger entries
 *   linked comms · insurance state for the vessel
 *
 * Mirrors the LinkedEntitiesRail pattern from /work-orders/[id].
 */

import * as React from "react";
import Link from "next/link";
import {
  Anchor,
  CalendarRange,
  FileText,
  MessageSquare,
  Receipt,
  Sailboat,
  ShieldCheck,
  ShieldOff,
  User as UserIcon,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LocalTime } from "@/components/ui/local-time";
import { PageShell } from "@/components/page-shell";
import { AttachedFeesList } from "@/components/financials/attached-fees-list";
import {
  useContracts,
  useLedgerForBoater,
  useReservations,
  useStore,
} from "@/lib/client-store";
import {
  BOATERS,
  SLIPS,
  VESSELS,
  WORK_ORDERS,
  formatMoney,
} from "@/lib/mock-data";

export function ReservationDetail({ reservationId }: { reservationId: string }) {
  const reservations = useReservations();
  const reservation = reservations.find((r) => r.id === reservationId);

  if (!reservation) {
    return (
      <PageShell title="Reservation not found">
        <div className="rounded-[12px] border border-hairline bg-surface-1 px-4 py-10 text-center">
          <p className="text-[13px] text-fg-subtle">
            No reservation matches {reservationId}.
          </p>
          <Link
            href="/reservations"
            className="mt-3 inline-block text-[12px] text-primary hover:underline"
          >
            ← Back to reservations
          </Link>
        </div>
      </PageShell>
    );
  }

  return <Body reservation={reservation} />;
}

function Body({
  reservation,
}: {
  reservation: import("@/lib/types").Reservation;
}) {
  const boater = BOATERS.find((b) => b.id === reservation.boater_id);
  const vessel = VESSELS.find((v) => v.id === reservation.vessel_id);
  const slip = SLIPS.find((s) => s.id === reservation.slip_id);
  const contracts = useContracts();
  const contract = reservation.contract_id
    ? contracts.find((c) => c.id === reservation.contract_id)
    : undefined;
  const { insurance, communications } = useStore();
  const ledger = useLedgerForBoater(reservation.boater_id);

  // Insurance for the booked vessel — drives the dock-gate panel.
  const vesselCoi = insurance
    .filter((c) => c.vessel_id === reservation.vessel_id)
    .sort((a, b) => b.effective_end.localeCompare(a.effective_end))[0];
  const coiActive =
    !!vesselCoi && new Date(vesselCoi.effective_end).getTime() >= Date.now();

  // Linked invoices — anything explicitly tagged with this reservation
  // (the FK lands once mutators stamp it; for now we also catch
  // legacy substring matches as a fallback).
  const linkedInvoices = ledger.filter(
    (l) =>
      l.linked_reservation_id === reservation.id ||
      (l.linked_reservation_id == null &&
        (l.line_items ?? []).some((li) =>
          li.description
            .toLowerCase()
            .includes(reservation.number.toLowerCase())
        ))
  );

  // Work orders on this vessel during the stay window. Approximation
  // — production would join on a date range index. For the prototype
  // we just show all WOs touching the vessel and let the rail be
  // visually obvious about scope.
  const woForVessel = WORK_ORDERS.filter(
    (w) => w.vessel_id === reservation.vessel_id
  );

  // Communications scoped to the reservation via related_entity.
  const reservationComms = communications.filter(
    (c) =>
      c.boater_id === reservation.boater_id &&
      (c.related_entity?.type === "reservation"
        ? c.related_entity.id === reservation.id
        : false)
  );

  const friendlyArrival = <LocalTime iso={reservation.arrival_date} fmt="weekday" />;
  const friendlyDeparture = <LocalTime iso={reservation.departure_date} fmt="weekday" />;

  const tone =
    reservation.status === "occupied"
      ? "ok"
      : reservation.status === "scheduled"
      ? "warn"
      : reservation.status === "cancelled"
      ? "danger"
      : "neutral";

  return (
    <PageShell
      title={`Reservation ${reservation.number}`}
      backHref="/reservations"
      backLabel="All reservations"
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Identity / status rail */}
        <div className="space-y-4 lg:col-span-5">
          <Card>
            <CardHeader title="Status" />
            <div className="px-4 py-3">
              <div className="flex items-center gap-2">
                <Badge tone={tone} size="sm">
                  {reservation.status}
                </Badge>
                <Badge tone="outline" size="sm">
                  {reservation.type.replace("_", " ")}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
                <Field label="Arrival" value={friendlyArrival} />
                <Field label="Departure" value={friendlyDeparture} />
                <Field label="Sequence" value={reservation.seq} />
                <Field
                  label="Slip"
                  value={slip ? `${slip.dock} · ${slip.number}` : "—"}
                />
              </div>
            </div>
          </Card>

          {boater && (
            <Card>
              <CardHeader title="Member" />
              <Link
                href={`/members/${boater.id}`}
                className="block px-4 py-3 transition-colors hover:bg-surface-2"
              >
                <div className="flex items-center gap-2">
                  <UserIcon className="size-4 text-fg-subtle" />
                  <div className="flex-1">
                    <div className="text-[13px] font-medium text-fg">
                      {boater.display_name}
                    </div>
                    <div className="text-[11px] text-fg-tertiary">
                      {boater.code ?? "—"} · {boater.billing_cadence}
                    </div>
                  </div>
                </div>
              </Link>
            </Card>
          )}

          {vessel && (
            <Card>
              <CardHeader title="Vessel" />
              <Link
                href={`/members/${vessel.boater_id}?tab=vessels`}
                className="block px-4 py-3 transition-colors hover:bg-surface-2"
              >
                <div className="flex items-center gap-2">
                  <Sailboat className="size-4 text-fg-subtle" />
                  <div className="flex-1">
                    <div className="text-[13px] font-medium text-fg">
                      {vessel.name}
                    </div>
                    <div className="text-[11px] text-fg-tertiary">
                      {vessel.year ? `${vessel.year} ` : ""}
                      {vessel.make ?? ""} {vessel.model ?? ""}
                    </div>
                  </div>
                </div>
              </Link>
            </Card>
          )}

          <Card>
            <CardHeader title="Insurance" />
            <div className="px-4 py-3">
              {vesselCoi ? (
                <div className="flex items-center gap-2">
                  {coiActive ? (
                    <ShieldCheck className="size-4 text-status-ok" />
                  ) : (
                    <ShieldOff className="size-4 text-status-danger" />
                  )}
                  <div className="flex-1 text-[12px]">
                    <div className="font-medium text-fg">
                      {vesselCoi.carrier} · {vesselCoi.policy_number}
                    </div>
                    <div className="text-fg-tertiary">
                      Through {vesselCoi.effective_end}
                      {vesselCoi.liability_limit
                        ? ` · ${formatMoney(vesselCoi.liability_limit)} liability`
                        : ""}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-[12px] text-status-danger">
                  No COI on file for this vessel. Dock gate will block check-in.
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Connection rail */}
        <div className="space-y-4 lg:col-span-7">
          {slip && (
            <Card>
              <CardHeader title="Slip" />
              <Link
                href={`/services/roster`}
                className="block px-4 py-3 transition-colors hover:bg-surface-2"
              >
                <div className="flex items-center gap-2">
                  <Anchor className="size-4 text-fg-subtle" />
                  <div className="flex-1">
                    <div className="text-[13px] font-medium text-fg">
                      {slip.dock} · Slip {slip.number}
                    </div>
                    <div className="text-[11px] text-fg-tertiary">
                      {slip.slip_class} · {Math.round(slip.max_loa_inches / 12)}ft LOA
                      {slip.has_power ? " · power" : ""}
                      {slip.has_water ? " · water" : ""}
                    </div>
                  </div>
                </div>
              </Link>
            </Card>
          )}

          {contract && (
            <Card>
              <CardHeader title="Contract" />
              <Link
                href={`/services/contracts/${contract.id}`}
                className="block px-4 py-3 transition-colors hover:bg-surface-2"
              >
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-fg-subtle" />
                  <div className="flex-1">
                    <div className="text-[13px] font-medium text-fg">
                      {contract.number}
                    </div>
                    <div className="text-[11px] text-fg-tertiary">
                      {contract.status} · {contract.effective_start} → {contract.effective_end}
                    </div>
                  </div>
                </div>
              </Link>
            </Card>
          )}

          {(reservation.attached_fee_ids?.length ?? 0) > 0 && (
            <Card>
              <CardHeader title="Attached fees" />
              <div className="px-4 py-3">
                <AttachedFeesList
                  feeIds={reservation.attached_fee_ids ?? []}
                  termMonths={reservationTermMonths(
                    reservation.arrival_date,
                    reservation.departure_date,
                  )}
                />
              </div>
            </Card>
          )}

          {woForVessel.length > 0 && (
            <Card>
              <CardHeader title={`Work orders on this vessel (${woForVessel.length})`} />
              <ul className="divide-y divide-hairline">
                {woForVessel.slice(0, 5).map((w) => (
                  <li key={w.id}>
                    <Link
                      href={`/work-orders/${w.id}`}
                      className="flex items-center justify-between gap-2 px-4 py-2 text-[12px] transition-colors hover:bg-surface-2"
                    >
                      <div className="flex items-center gap-2">
                        <Wrench className="size-3.5 text-fg-subtle" />
                        <span className="font-mono text-fg">{w.number}</span>
                        <span className="truncate text-fg-subtle">
                          {w.subject}
                        </span>
                      </div>
                      <Badge tone="outline" size="sm">
                        {w.status.replace("_", " ")}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {linkedInvoices.length > 0 && (
            <Card>
              <CardHeader title={`Linked ledger (${linkedInvoices.length})`} />
              <ul className="divide-y divide-hairline">
                {linkedInvoices.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between gap-2 px-4 py-2 text-[12px]"
                  >
                    <div className="flex items-center gap-2">
                      <Receipt className="size-3.5 text-fg-subtle" />
                      <span className="font-mono text-fg">
                        {l.number ?? l.id.slice(-6)}
                      </span>
                      <Badge
                        tone={l.status === "paid" ? "ok" : "warn"}
                        size="sm"
                      >
                        {l.status}
                      </Badge>
                    </div>
                    <span className="money-display text-fg">
                      {formatMoney(l.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {reservationComms.length > 0 && (
            <Card>
              <CardHeader title={`Messages (${reservationComms.length})`} />
              <ul className="divide-y divide-hairline">
                {reservationComms.slice(0, 5).map((c) => (
                  <li key={c.id} className="px-4 py-2 text-[12px]">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="size-3.5 text-fg-subtle" />
                      <span className="truncate font-medium text-fg">
                        {c.subject ?? "(no subject)"}
                      </span>
                      <Badge tone="outline" size="sm">
                        {c.type}
                      </Badge>
                    </div>
                    {c.body_preview && (
                      <p className="mt-0.5 truncate text-fg-tertiary">
                        {c.body_preview}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </PageShell>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
      {children}
    </div>
  );
}

function CardHeader({ title }: { title: string }) {
  return (
    <div className="border-b border-hairline bg-surface-2 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
      <CalendarRange className="mr-1 inline-block size-3.5 align-text-bottom" />
      {title}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
        {label}
      </div>
      <div className="mt-0.5 text-fg">{value}</div>
    </div>
  );
}

// Reservation horizon -> term months for the fee roll-up. Round up so a
// partial month still prorates a monthly fee for the full month; floor
// at 1 because every reservation is "at least this booking".
function reservationTermMonths(arrival: string, departure: string): number {
  const a = new Date(arrival).getTime();
  const d = new Date(departure).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(d) || d <= a) return 1;
  const days = (d - a) / (1000 * 60 * 60 * 24);
  return Math.max(1, Math.ceil(days / 30));
}
