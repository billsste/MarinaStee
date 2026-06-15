"use client";

import * as React from "react";
import { AlertTriangle, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import { formatInches, getSlip } from "@/lib/mock-data";
import {
  useContractsForBoater,
  useInsuranceForBoater,
  usePicklistLabelMap,
  useReservationsForBoater,
  useVesselsForBoater,
  upsertVessel,
  deleteVessel,
} from "@/lib/client-store";
import { AddVesselSheet } from "./add-vessel-sheet";
import { InsuranceCard } from "@/components/insurance/insurance-card";
import { cn } from "@/lib/utils";
import type { Reservation, Vessel } from "@/lib/types";

/*
 * /members/[id] → Vessels & Slips tab.
 *
 * Tabular surface. Row-click opens the Configure dialog — same UX as
 * /services Roster and /services/rates. One affordance per row, not per
 * cell. All fields (name, year, make/model, LOA, active, color, beam,
 * VIN, registration, hull power, vessel_type) live in the dialog.
 *
 * Photos + co-owners + COI insurance live below the table where they
 * always did — same content, different chrome.
 */

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
    picklist: "vessel_type",
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
  const liveVessels = useVesselsForBoater(boaterId);
  const liveReservations = useReservationsForBoater(boaterId);
  const liveContracts = useContractsForBoater(boaterId);
  const liveCois = useInsuranceForBoater(boaterId);
  const vesselTypeLabels = usePicklistLabelMap("vessel_type");
  const allVessels = liveVessels.length > 0 ? liveVessels : vessels;
  const allRes = liveReservations.length > 0 ? liveReservations : reservations;

  const activeContract = liveContracts.find((c) => c.status === "active");
  const contractSlip = activeContract?.slip_id
    ? getSlip(activeContract.slip_id)
    : undefined;

  function vesselIssues(v: Vessel): string[] {
    const out: string[] = [];
    if (contractSlip && v.active) {
      if (v.loa_inches && v.loa_inches > contractSlip.max_loa_inches) {
        const overBy = v.loa_inches - contractSlip.max_loa_inches;
        out.push(
          `LOA exceeds slip ${contractSlip.id} max (${formatInches(v.loa_inches)} vs. ${formatInches(contractSlip.max_loa_inches)} — over by ${formatInches(overBy)})`
        );
      }
      if (v.beam_inches && v.beam_inches > contractSlip.max_beam_inches) {
        out.push(
          `Beam exceeds slip ${contractSlip.id} max (${formatInches(v.beam_inches)} vs. ${formatInches(contractSlip.max_beam_inches)})`
        );
      }
    }
    const vesselCois = liveCois
      .filter((c) => c.vessel_id === v.id)
      .sort((a, b) => (a.effective_end < b.effective_end ? 1 : -1));
    const activeCoi = vesselCois.find(
      (c) => !c.renewed_by_coi_id && new Date(c.effective_end).getTime() >= Date.now()
    );
    if (v.active && !activeCoi) {
      const lapsed = vesselCois[0];
      if (lapsed) {
        out.push(`No active COI — ${lapsed.carrier} expired ${lapsed.effective_end}`);
      } else {
        out.push(`No COI on file for this vessel`);
      }
    }
    return out;
  }

  const [addOpen, setAddOpen] = React.useState(false);
  const [editVessel, setEditVessel] = React.useState<Vessel | undefined>();
  const [editOpen, setEditOpen] = React.useState(false);

  function openConfigure(v: Vessel) {
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
    if (!window.confirm(`Remove vessel "${v.name}" from this boater?`)) return;
    deleteVessel(v.id);
  }

  if (allVessels.length === 0) {
    return (
      <>
        <EmptyState
          title="No vessels on file"
          body="Add a vessel to enable reservations, work orders, and pedestal billing."
          cta={
            <Button variant="secondary" size="md" onClick={() => setAddOpen(true)}>
              <Plus className="size-3.5" />
              Add vessel
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
        <p className="text-[12px] text-fg-tertiary">
          Click a row to edit. All vessel fields (specs, VIN, registration, hull power, active state) live in the edit dialog.
        </p>
        <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="size-3.5" />
          Add vessel
        </Button>
      </div>

      {/* Vessels table */}
      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div className="grid grid-cols-[15fr_72px_12fr_120px_84px_90px_120px_72px] gap-x-3 border-b border-hairline bg-surface-2 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
          <span>Name</span>
          <span>Year</span>
          <span>Make / Model</span>
          <span>Type</span>
          <span>LOA</span>
          <span>Active</span>
          <span>Status</span>
          <span></span>
        </div>
        <ul className="divide-y divide-hairline">
          {allVessels.map((v) => {
            const issues = vesselIssues(v);
            return (
              <li key={v.id} className="group relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDeleteVessel(v);
                  }}
                  className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-md p-1 text-fg-tertiary opacity-0 transition-opacity hover:bg-surface-3 hover:text-status-danger group-hover:opacity-100"
                  aria-label={`Remove ${v.name}`}
                  title="Remove vessel"
                >
                  <Trash2 className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => openConfigure(v)}
                  className="grid w-full cursor-pointer grid-cols-[15fr_72px_12fr_120px_84px_90px_120px_72px] items-center gap-x-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
                  title="Edit vessel"
                >
                  <span className="min-w-0 truncate text-[13px] font-medium text-fg">
                    {v.name}
                  </span>
                  <span className="text-[12px] tabular text-fg-subtle">
                    {v.year ?? "—"}
                  </span>
                  <span className="min-w-0 truncate text-[12px] text-fg-subtle">
                    {[v.make, v.model].filter(Boolean).join(" ") || "—"}
                  </span>
                  <span className="text-[12px] text-fg-subtle">
                    {v.vessel_type
                      ? vesselTypeLabels.get(v.vessel_type) ?? v.vessel_type
                      : "—"}
                  </span>
                  <span className="text-[12px] tabular text-fg-subtle">
                    {v.loa_inches ? formatInches(v.loa_inches) : "—"}
                  </span>
                  <span>
                    <Badge tone={v.active ? "ok" : "neutral"} size="sm">
                      {v.active ? "Active" : "Inactive"}
                    </Badge>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {issues.length === 0 ? (
                      <span className="text-[11px] text-status-ok">Clean</span>
                    ) : (
                      // Nested in the row button; using a span+role+keyboard
                      // would be ideal, but the alert is incidental — keep
                      // it inline as a styled hint. stopPropagation keeps
                      // the alert from also opening the edit dialog.
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          window.alert(issues.join("\n\n"));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            window.alert(issues.join("\n\n"));
                          }
                        }}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1 rounded-full border border-status-warn/30 bg-status-warn/10 px-1.5 py-0.5 text-[10px] font-medium text-status-warn hover:bg-status-warn/15"
                        )}
                        title={issues.join(" · ")}
                      >
                        {issues.some((i) => i.toLowerCase().includes("coi")) ? (
                          <ShieldAlert className="size-3" />
                        ) : (
                          <AlertTriangle className="size-3" />
                        )}
                        {issues.length} alert{issues.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                  <span />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* COI / insurance — surfaced inline beneath the table so staff
          can see coverage status without navigating away. */}
      <InsuranceCard boaterId={boaterId} uploadedBy="marina" />

      {/* Reservation history — already tabular */}
      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
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
        title={editVessel ? `Configure vessel — ${editVessel.name}` : "Configure vessel"}
        description="Color, beam, draft, hull VIN, registration, hull power, photos."
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
