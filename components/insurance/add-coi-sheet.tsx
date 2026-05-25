"use client";

import * as React from "react";
import { Upload } from "lucide-react";
import { CreateSheet, Field, NumberInput, Select, TextInput } from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { BOATERS, getVesselsForBoater } from "@/lib/mock-data";
import {
  addInsuranceCertificate,
  nextCoiId,
  useBoaters,
  useVesselsForBoater,
} from "@/lib/client-store";

/*
 * Add a Certificate of Insurance for a vessel. Either staff (marina-side) or
 * boater (portal-side) can submit. We capture the metadata + a fake PDF URL.
 * In production this would proxy to S3-compatible storage with virus scan.
 */
export function AddCoiSheet({
  open,
  onOpenChange,
  defaultBoaterId,
  defaultVesselId,
  uploadedBy = "marina",
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  defaultBoaterId?: string;
  defaultVesselId?: string;
  uploadedBy?: "marina" | "boater";
}) {
  const liveBoaters = useBoaters();
  const boaters = liveBoaters.length > 0 ? liveBoaters : BOATERS;

  const [boaterId, setBoaterId] = React.useState(defaultBoaterId ?? "");
  const liveVessels = useVesselsForBoater(boaterId);
  const vessels = boaterId
    ? liveVessels.length > 0
      ? liveVessels
      : getVesselsForBoater(boaterId)
    : [];

  const [vesselId, setVesselId] = React.useState(defaultVesselId ?? "");
  const [carrier, setCarrier] = React.useState("");
  const [policyNumber, setPolicyNumber] = React.useState("");
  const [liabilityLimit, setLiabilityLimit] = React.useState("500000");
  const [hullValue, setHullValue] = React.useState("");
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");
  const [fileName, setFileName] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setBoaterId(defaultBoaterId ?? "");
      setVesselId(defaultVesselId ?? "");
      setCarrier("");
      setPolicyNumber("");
      setLiabilityLimit("500000");
      setHullValue("");
      const today = new Date().toISOString().slice(0, 10);
      setStart(today);
      const oneYear = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
      setEnd(oneYear);
      setFileName("");
    }
  }, [open, defaultBoaterId, defaultVesselId]);

  // When boater changes, auto-pick first vessel (unless user already chose one)
  React.useEffect(() => {
    if (boaterId && vessels.length > 0 && !vessels.find((v) => v.id === vesselId)) {
      setVesselId(vessels[0].id);
    }
  }, [boaterId, vessels, vesselId]);

  const canSubmit =
    boaterId.length > 0 &&
    vesselId.length > 0 &&
    carrier.trim().length > 0 &&
    policyNumber.trim().length > 0 &&
    start.length > 0 &&
    end.length > 0 &&
    start <= end;

  function submit() {
    if (!canSubmit) return;
    addInsuranceCertificate({
      id: nextCoiId(),
      vessel_id: vesselId,
      boater_id: boaterId,
      carrier: carrier.trim(),
      policy_number: policyNumber.trim(),
      liability_limit: Number(liabilityLimit),
      hull_value: hullValue ? Number(hullValue) : undefined,
      effective_start: start,
      effective_end: end,
      pdf_url: fileName ? `/mock/${fileName}` : undefined,
      uploaded_at: new Date().toISOString(),
      uploaded_by: uploadedBy,
    });
    onOpenChange(false);
  }

  return (
    <CreateSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add Certificate of Insurance"
      description="Upload a COI for a vessel. Marina Stee will alert you 60 days before it expires."
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            Add certificate
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Boater" required>
            <Select value={boaterId} onChange={setBoaterId} disabled={Boolean(defaultBoaterId)}>
              <option value="">Pick a boater…</option>
              {boaters.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.display_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Vessel" required>
            <Select value={vesselId} onChange={setVesselId} disabled={vessels.length === 0}>
              {vessels.length === 0 ? (
                <option value="">No vessels — register one first</option>
              ) : (
                vessels.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))
              )}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Carrier" required>
            <TextInput
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="BoatU.S. Insurance"
            />
          </Field>
          <Field label="Policy number" required>
            <TextInput
              value={policyNumber}
              onChange={(e) => setPolicyNumber(e.target.value)}
              placeholder="BU-447821"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Liability limit ($)" required>
            <NumberInput
              step="50000"
              value={liabilityLimit}
              onChange={(e) => setLiabilityLimit(e.target.value)}
              placeholder="500000"
            />
          </Field>
          <Field label="Hull value ($)" hint="Optional — for hull coverage policies.">
            <NumberInput
              step="1000"
              value={hullValue}
              onChange={(e) => setHullValue(e.target.value)}
              placeholder="28000"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Effective start" required>
            <TextInput type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Effective end" required>
            <TextInput type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>

        <Field label="PDF" hint="Mock upload — production attaches to S3 with virus scan first.">
          <label className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 px-4 py-3 text-[12px] text-fg-subtle hover:bg-surface-3">
            <Upload className="size-3.5" />
            {fileName || "Click to choose a file (demo only)"}
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setFileName(f.name);
              }}
            />
          </label>
        </Field>

        {start && end && start > end && (
          <p className="text-[12px] text-status-danger">End must be on or after start.</p>
        )}
      </div>
    </CreateSheet>
  );
}
