"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { EmptyState } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import { formatInches, getSlip } from "@/lib/mock-data";
import {
  useReservationsForBoater,
  useVesselsForBoater,
  upsertVessel,
  deleteVessel,
} from "@/lib/client-store";
import { AddVesselSheet } from "./add-vessel-sheet";
import { InsuranceCard } from "@/components/insurance/insurance-card";
import type { Reservation, Vessel } from "@/lib/types";

const VESSEL_FIELDS: FieldSpec<Vessel>[] = [
  { key: "name", label: "Name", kind: "text", required: true, col: 2 },
  { key: "color", label: "Color", kind: "text", col: 2 },
  { key: "year", label: "Year", kind: "number", col: 2 },
  { key: "make", label: "Make", kind: "text", col: 2 },
  { key: "model", label: "Model", kind: "text", col: 2 },
  {
    key: "vessel_type",
    label: "Type",
    kind: "select",
    col: 2,
    options: [
      { value: "powerboat", label: "Powerboat" },
      { value: "sailboat", label: "Sailboat" },
      { value: "jetski", label: "Jet ski" },
      { value: "houseboat", label: "Houseboat" },
      { value: "other", label: "Other" },
    ],
  },
  {
    key: "fuel_type",
    label: "Fuel",
    kind: "select",
    col: 2,
    options: [
      { value: "gasoline", label: "Gasoline" },
      { value: "diesel", label: "Diesel" },
      { value: "electric", label: "Electric" },
      { value: "none", label: "None" },
    ],
  },
  { key: "loa_inches", label: "LOA (inches)", kind: "number", col: 2 },
  { key: "beam_inches", label: "Beam (inches)", kind: "number", col: 2 },
  { key: "draft_inches", label: "Draft (inches)", kind: "number", col: 2 },
  { key: "height_inches", label: "Height (inches)", kind: "number", col: 2 },
  { key: "power_hp", label: "Power (hp)", kind: "number", col: 2 },
  { key: "hull_vin", label: "VIN / Hull", kind: "text", col: 2 },
  { key: "registration", label: "Registration", kind: "text", col: 2 },
  { key: "active", label: "Active", kind: "boolean" },
];

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
  const [editVessel, setEditVessel] = React.useState<Vessel | undefined>();
  const [editOpen, setEditOpen] = React.useState(false);

  function openEditVessel(v: Vessel) {
    setEditVessel(v);
    setEditOpen(true);
  }

  function handleSaveVessel(values: Vessel) {
    upsertVessel({
      ...values,
      year: values.year ? Number(values.year) : undefined,
      loa_inches: Number(values.loa_inches) || 0,
      beam_inches: Number(values.beam_inches) || 0,
      draft_inches: values.draft_inches ? Number(values.draft_inches) : undefined,
      height_inches: values.height_inches ? Number(values.height_inches) : undefined,
      power_hp: values.power_hp ? Number(values.power_hp) : undefined,
      active: values.active !== false,
    });
  }

  function handleDeleteVessel(v: Vessel) {
    deleteVessel(v.id);
  }

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

      {allVessels.map((v) => {
        const photos = v.photos ?? (v.photo_url ? [v.photo_url] : []);
        return (
          <div
            key={v.id}
            className="group cursor-pointer rounded-[12px] border border-hairline bg-surface-1 p-5 transition-colors hover:border-hairline-strong hover:bg-surface-2/30"
            onClick={() => openEditVessel(v)}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-1.5 text-[16px] font-medium text-fg">
                  {v.name}
                  <Pencil className="size-3.5 text-fg-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
                </h3>
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

            {photos.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {photos.map((url, i) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    key={url + i}
                    src={url}
                    alt={`${v.name} photo ${i + 1}`}
                    loading="lazy"
                    className="aspect-[4/3] w-full rounded-[8px] border border-hairline bg-surface-2 object-cover"
                  />
                ))}
                <button
                  type="button"
                  className="aspect-[4/3] w-full rounded-[8px] border border-dashed border-hairline-strong bg-surface-2 text-[11px] text-fg-tertiary hover:bg-surface-3 hover:text-fg-subtle"
                  title="Demo only — photo upload coming with backend"
                >
                  + Add photo
                </button>
              </div>
            )}

            {/* Specs — cap at 4 columns so they don't stretch across the
                full card. Empty values (—) are filtered out entirely so the
                grid doesn't get padded with dead cells. */}
            {(() => {
              const specs: Array<{ label: string; value: string }> = [
                { label: "LOA", value: formatInches(v.loa_inches) },
                { label: "Beam", value: formatInches(v.beam_inches) },
                { label: "Draft", value: formatInches(v.draft_inches) },
                { label: "Height", value: formatInches(v.height_inches) },
                v.power_hp ? { label: "Power", value: `${v.power_hp} hp` } : null,
                v.hull_vin ? { label: "VIN", value: v.hull_vin } : null,
                v.registration ? { label: "Registration", value: v.registration } : null,
                v.co_owner_ids.length > 0 ? { label: "Co-owners", value: String(v.co_owner_ids.length) } : null,
              ].filter((s): s is { label: string; value: string } => s !== null);
              if (specs.length === 0) return null;
              return (
                <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 md:grid-cols-4">
                  {specs.map((s) => (
                    <Stat key={s.label} label={s.label} value={s.value} />
                  ))}
                </div>
              );
            })()}
          </div>
        );
      })}

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

      <RecordEditDialog<Vessel>
        open={editOpen}
        onOpenChange={setEditOpen}
        title={editVessel ? `Edit vessel — ${editVessel.name}` : "Edit vessel"}
        description="Updates the vessel record. Photos and co-owners are managed separately."
        record={editVessel}
        fields={VESSEL_FIELDS}
        onSave={handleSaveVessel}
        onDelete={editVessel ? handleDeleteVessel : undefined}
        entity="vessel"
      />
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
