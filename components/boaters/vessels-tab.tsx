"use client";

import * as React from "react";
import { EmptyState } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatInches, getSlip } from "@/lib/mock-data";
import { useReservationsForBoater, useVesselsForBoater } from "@/lib/client-store";
import { AddVesselSheet } from "./add-vessel-sheet";
import { InsuranceCard } from "@/components/insurance/insurance-card";
import type { Reservation, Vessel } from "@/lib/types";

export function VesselsTab({
  vessels,
  reservations,
  boaterId,
}: {
  vessels: Vessel[];
  reservations: Reservation[];
  boaterId: string;
}) {
  // Subscribe to live state so newly-added vessels appear immediately.
  // Fall back to server-rendered props on first paint.
  const liveVessels = useVesselsForBoater(boaterId);
  const liveReservations = useReservationsForBoater(boaterId);
  const allVessels = liveVessels.length > 0 ? liveVessels : vessels;
  const allRes = liveReservations.length > 0 ? liveReservations : reservations;
  const [addOpen, setAddOpen] = React.useState(false);

  if (allVessels.length === 0) {
    return (
      <>
        <EmptyState
          title="No vessels on file"
          body="Add a vessel to enable reservations, work orders, and pedestal billing."
          cta={
            <Button variant="primary" size="md" onClick={() => setAddOpen(true)}>
              + Add vessel
            </Button>
          }
        />
        <AddVesselSheet open={addOpen} onOpenChange={setAddOpen} defaultBoaterId={boaterId} />
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-fg-subtle">
          {allVessels.length} vessel{allVessels.length === 1 ? "" : "s"} on file.
        </p>
        <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
          + Add vessel
        </Button>
      </div>

      {allVessels.map((v) => (
        <div key={v.id} className="rounded-[12px] border border-hairline bg-surface-1 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[16px] font-medium text-fg">{v.name}</h3>
              <div className="text-[12px] text-fg-subtle">
                {[v.year, v.make, v.model, v.color].filter(Boolean).join(" ")}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {v.active && <Badge tone="ok">Active</Badge>}
              {v.vessel_type && <Badge tone="neutral">{v.vessel_type}</Badge>}
              {v.fuel_type && <Badge tone="outline">{v.fuel_type}</Badge>}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <Stat label="LOA" value={formatInches(v.loa_inches)} />
            <Stat label="Beam" value={formatInches(v.beam_inches)} />
            <Stat label="Draft" value={formatInches(v.draft_inches)} />
            <Stat label="Height" value={formatInches(v.height_inches)} />
            <Stat label="Power" value={v.power_hp ? `${v.power_hp} hp` : "—"} />
            <Stat label="VIN" value={v.hull_vin ?? "—"} />
            <Stat label="Registration" value={v.registration ?? "—"} />
            <Stat label="Co-owners" value={v.co_owner_ids.length > 0 ? `${v.co_owner_ids.length}` : "—"} />
          </div>
        </div>
      ))}

      <InsuranceCard boaterId={boaterId} uploadedBy="marina" />

      <div className="rounded-[12px] border border-hairline bg-surface-1">
        <div className="border-b border-hairline px-4 py-2.5">
          <h3 className="text-[13px] font-medium text-fg">Reservation history</h3>
        </div>
        {allRes.length === 0 ? (
          <div className="px-4 py-6 text-[13px] text-fg-subtle">No reservations yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-[11px] uppercase tracking-wide text-fg-tertiary">
                  <Th>Number</Th>
                  <Th>Seq</Th>
                  <Th>Slip</Th>
                  <Th>Arr</Th>
                  <Th>Dep</Th>
                  <Th>Status</Th>
                  <Th>Type</Th>
                </tr>
              </thead>
              <tbody>
                {allRes.map((r) => {
                  const s = getSlip(r.slip_id);
                  return (
                    <tr key={r.id} className="border-b border-hairline last:border-b-0">
                      <Td className="font-medium text-primary">{r.number}</Td>
                      <Td>{r.seq}</Td>
                      <Td>{s ? `${s.dock} · ${s.number}` : r.slip_id}</Td>
                      <Td>{r.arrival_date}</Td>
                      <Td>{r.departure_date}</Td>
                      <Td>
                        <Badge tone={r.status === "occupied" ? "ok" : "neutral"} size="sm">
                          {r.status}
                        </Badge>
                      </Td>
                      <Td className="capitalize">{r.type}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AddVesselSheet open={addOpen} onOpenChange={setAddOpen} defaultBoaterId={boaterId} />
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2 text-left font-medium">{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={"px-4 py-2 text-fg " + (className ?? "")}>{children}</td>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">{label}</div>
      <div className="text-[12px] text-fg">{value}</div>
    </div>
  );
}
