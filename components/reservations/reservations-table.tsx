"use client";

import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BOATERS, getSlip } from "@/lib/mock-data";
import { useReservations } from "@/lib/client-store";
import { NewReservationSheet } from "./new-reservation-sheet";

/*
 * "All reservations" table at the bottom of /reservations. Reads live from
 * the client store so newly-created reservations appear immediately. The
 * top arrivals/departures/upcoming panels still render server-side from the
 * static mock — fine for date-windowed queries since brand-new entries
 * default to today's arrival when created via the sheet, and re-render
 * here without a page reload.
 */
export function ReservationsTable() {
  const reservations = useReservations();
  const [newOpen, setNewOpen] = React.useState(false);

  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[14px] font-medium text-fg">All reservations</h2>
        <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}>
          + New reservation
        </Button>
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
              {reservations
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
                      <Td className="font-mono text-[12px] font-medium text-fg">
                        {r.number}{r.seq !== "1/1" ? ` ${r.seq}` : ""}
                      </Td>
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

      <NewReservationSheet open={newOpen} onOpenChange={setNewOpen} />
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left font-medium">{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={"px-3 py-2 align-middle " + (className ?? "")}>{children}</td>;
}
