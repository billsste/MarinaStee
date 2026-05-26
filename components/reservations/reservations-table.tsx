"use client";

import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BOATERS, getSlip, SLIPS } from "@/lib/mock-data";
import {
  deleteReservation,
  upsertReservation,
  useReservations,
} from "@/lib/client-store";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import { NewReservationSheet } from "./new-reservation-sheet";
import type { Reservation } from "@/lib/types";

/*
 * "All reservations" table at the bottom of /reservations. Row click opens
 * RecordEditDialog seeded with the row. + New reservation still uses the
 * existing sheet so the create-flow path matches the agent's
 * create_reservation tool exactly.
 */

const RESERVATION_FIELDS: FieldSpec<Reservation>[] = [
  { key: "number", label: "Number", kind: "text", required: true, placeholder: "R-1234" },
  {
    key: "boater_id",
    label: "Holder",
    kind: "select",
    required: true,
    options: BOATERS.map((b) => ({ value: b.id, label: b.display_name })),
  },
  {
    key: "slip_id",
    label: "Slip",
    kind: "select",
    required: true,
    col: 2,
    options: SLIPS.map((s) => ({ value: s.id, label: `${s.dock} · ${s.number}` })),
  },
  {
    key: "type",
    label: "Type",
    kind: "select",
    required: true,
    col: 2,
    options: ["annual", "seasonal", "monthly", "transient", "recurring"].map((t) => ({ value: t, label: t })),
  },
  { key: "arrival_date", label: "Arrival", kind: "date", required: true, col: 2 },
  { key: "departure_date", label: "Departure", kind: "date", required: true, col: 2 },
  {
    key: "status",
    label: "Status",
    kind: "select",
    required: true,
    options: ["scheduled", "occupied", "completed", "cancelled"].map((s) => ({ value: s, label: s })),
  },
];

export function ReservationsTable() {
  const reservations = useReservations();
  const [newOpen, setNewOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Reservation | undefined>();
  const [editOpen, setEditOpen] = React.useState(false);

  function openEdit(r: Reservation) {
    setEditing(r);
    setEditOpen(true);
  }

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
                <Th>Holder</Th>
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
                    <tr
                      key={r.id}
                      onClick={() => openEdit(r)}
                      className="cursor-pointer border-b border-hairline last:border-b-0 transition-colors hover:bg-surface-2"
                    >
                      <Td className="font-mono text-[12px] font-medium text-fg">
                        {r.number}{r.seq !== "1/1" ? ` ${r.seq}` : ""}
                      </Td>
                      <Td>
                        {boater ? (
                          <Link
                            href={`/holders/${boater.id}`}
                            className="text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
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
      <RecordEditDialog<Reservation>
        open={editOpen}
        onOpenChange={setEditOpen}
        title={editing ? `Edit reservation — ${editing.number}` : "Reservation"}
        description="Changing dates / status updates the calendar, today's queue, and the holder's history immediately."
        record={editing}
        fields={RESERVATION_FIELDS}
        onSave={(values) => upsertReservation(values as Reservation)}
        onDelete={editing ? (r) => deleteReservation(r.id) : undefined}
        entity="reservation"
      />
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left font-medium">{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={"px-3 py-2 align-middle " + (className ?? "")}>{children}</td>;
}
