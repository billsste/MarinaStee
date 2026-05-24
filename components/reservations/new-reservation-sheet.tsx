"use client";

import * as React from "react";
import { CreateSheet, Field, TextInput, Select } from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import {
  BOATERS,
  RENTAL_SPACES,
  VESSELS,
} from "@/lib/mock-data";
import { executeAgentAction } from "@/lib/agent-actions";

export function NewReservationSheet({
  open,
  onOpenChange,
  defaultBoaterId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  defaultBoaterId?: string;
}) {
  const [boaterId, setBoaterId] = React.useState(defaultBoaterId ?? "");
  const [slipId, setSlipId] = React.useState("");
  const [vesselId, setVesselId] = React.useState("");
  const [type, setType] = React.useState<"annual" | "seasonal" | "monthly" | "transient" | "recurring">(
    "transient"
  );
  const [arrivalDate, setArrivalDate] = React.useState("");
  const [departureDate, setDepartureDate] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setBoaterId(defaultBoaterId ?? "");
      setSlipId("");
      setVesselId("");
      setType("transient");
      const today = new Date().toISOString().slice(0, 10);
      setArrivalDate(today);
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      setDepartureDate(tomorrow);
    }
  }, [open, defaultBoaterId]);

  const boater = BOATERS.find((b) => b.id === boaterId);
  const vesselOptions = boater
    ? VESSELS.filter((v) => v.boater_id === boater.id || v.co_owner_ids.includes(boater.id))
    : VESSELS;

  const canSubmit =
    boaterId.length > 0 &&
    slipId.length > 0 &&
    arrivalDate.length > 0 &&
    departureDate.length > 0 &&
    arrivalDate <= departureDate;

  function submit() {
    if (!canSubmit) return;
    executeAgentAction({
      kind: "create_reservation",
      label: "",
      boater_id: boaterId,
      slip_id: slipId,
      vessel_id: vesselId || undefined,
      arrival_date: arrivalDate,
      departure_date: departureDate,
      type,
    });
    onOpenChange(false);
  }

  return (
    <CreateSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New reservation"
      description="Block a slip for a boater. Annual / seasonal usually flow from a contract; transient is for short-stay arrivals."
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            Create reservation
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Boater" required>
          <Select value={boaterId} onChange={setBoaterId}>
            <option value="">Pick a boater…</option>
            {BOATERS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.display_name} {b.code ? `· ${b.code}` : ""}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Slip" required>
            <Select value={slipId} onChange={setSlipId}>
              <option value="">Pick a slip…</option>
              {RENTAL_SPACES.slice(0, 40).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number} · {s.occupancy_type}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Vessel">
            <Select value={vesselId} onChange={setVesselId}>
              <option value="">No vessel</option>
              {vesselOptions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Type">
          <Select value={type} onChange={(v) => setType(v as typeof type)}>
            <option value="transient">Transient (short stay)</option>
            <option value="monthly">Monthly</option>
            <option value="seasonal">Seasonal</option>
            <option value="annual">Annual</option>
            <option value="recurring">Recurring</option>
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Arrival" required>
            <TextInput type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} />
          </Field>
          <Field label="Departure" required>
            <TextInput type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} />
          </Field>
        </div>

        {arrivalDate && departureDate && arrivalDate > departureDate && (
          <p className="text-[12px] text-status-danger">Departure must be on or after arrival.</p>
        )}
      </div>
    </CreateSheet>
  );
}
