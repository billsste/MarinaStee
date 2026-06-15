"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { CreateSheet, Field, NumberInput, Select, TextInput } from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { BOATERS } from "@/lib/mock-data";
import { useBoaters } from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";

/*
 * Add-vessel dialog — operator-side.
 *
 * Two-tier disclosure:
 *   Visible:  Boater, Vessel name, Type, LOA, Beam
 *   Expander: Year, Make, Model, Fuel, Draft, Hull VIN, Registration
 *
 * Why the split: a marina operator adding a vessel under time pressure
 * (boater walked up at the dock, phone-in, last-minute reservation) has
 * the first 5 from a quick conversation. The other 7 typically come off
 * the COI / registration card / insurance binder, which is paperwork
 * that arrives separately. Hiding them behind an expander preserves the
 * data when the operator has it without blocking the quick path.
 *
 * The COI upload flow auto-populates Year/Make/Model/Hull VIN/Registration
 * via OCR when an insurance doc lands later — those fields aren't lost
 * if skipped at create time.
 */
export function AddVesselSheet({
  open,
  onOpenChange,
  defaultBoaterId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  defaultBoaterId?: string;
  /** Called with the new vessel id after successful submit. */
  onCreated?: (vesselId: string) => void;
}) {
  // Use live boaters (so a freshly-created boater is selectable immediately).
  // Fall back to static when the store hasn't seeded yet.
  const liveBoaters = useBoaters();
  const boaters = liveBoaters.length > 0 ? liveBoaters : BOATERS;

  const [boaterId, setBoaterId] = React.useState(defaultBoaterId ?? "");
  const [name, setName] = React.useState("");
  const [year, setYear] = React.useState<string>("");
  const [make, setMake] = React.useState("");
  const [model, setModel] = React.useState("");
  const [vesselType, setVesselType] = React.useState<
    "powerboat" | "sailboat" | "pontoon" | "houseboat" | "pwc" | "other"
  >("powerboat");
  const [fuelType, setFuelType] = React.useState<"gasoline" | "diesel" | "electric" | "none">("gasoline");
  const [loaFt, setLoaFt] = React.useState<string>("");
  const [beamFt, setBeamFt] = React.useState<string>("");
  const [draftFt, setDraftFt] = React.useState<string>("");
  const [hullVin, setHullVin] = React.useState("");
  const [registration, setRegistration] = React.useState("");
  const [showMore, setShowMore] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setBoaterId(defaultBoaterId ?? "");
      setName("");
      setYear("");
      setMake("");
      setModel("");
      setVesselType("powerboat");
      setFuelType("gasoline");
      setLoaFt("");
      setBeamFt("");
      setDraftFt("");
      setHullVin("");
      setRegistration("");
      setShowMore(false);
    }
  }, [open, defaultBoaterId]);

  // LOA is now required — it drives slip-fit matching + billing tier and
  // is the single most common field a downstream feature needs. Boater
  // + name are tenancy/identity gates; LOA is the operational gate.
  const canSubmit =
    boaterId.length > 0 && name.trim().length > 0 && loaFt.trim().length > 0;

  function submit() {
    if (!canSubmit) return;
    const ftToIn = (v: string) => {
      const n = Number(v);
      return n > 0 ? Math.round(n * 12) : undefined;
    };
    const result = executeAgentAction({
      kind: "create_vessel",
      label: "",
      boater_id: boaterId,
      name: name.trim(),
      year: year ? Number(year) : undefined,
      make: make.trim() || undefined,
      model: model.trim() || undefined,
      vessel_type: vesselType,
      fuel_type: fuelType,
      loa_inches: ftToIn(loaFt),
      beam_inches: ftToIn(beamFt),
      draft_inches: ftToIn(draftFt),
      hull_vin: hullVin.trim() || undefined,
      registration: registration.trim() || undefined,
    });
    if (result.ok && result.createdId && onCreated) {
      onCreated(result.createdId);
    }
    onOpenChange(false);
  }

  return (
    <CreateSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add vessel"
      description="Register a boat under a boater. Enables reservations, work orders, and pedestal billing."
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            Add vessel
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Boater — full width. The tenancy anchor for the vessel. */}
        <Field label="Boater" required>
          <Select value={boaterId} onChange={setBoaterId}>
            <option value="">Pick a boater…</option>
            {boaters.map((b) => (
              <option key={b.id} value={b.id}>
                {b.display_name} {b.code ? `· ${b.code}` : ""}
              </option>
            ))}
          </Select>
        </Field>

        {/* Essentials — 2-col grid. Vessel name + Type on row 1,
            LOA + Beam on row 2. Aligned grid feels less cramped than
            the previous 3-col layout that mixed wide and narrow fields. */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vessel name" required>
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Reel Time"
            />
          </Field>
          <Field label="Type">
            <Select value={vesselType} onChange={(v) => setVesselType(v as typeof vesselType)}>
              <option value="powerboat">Powerboat</option>
              <option value="sailboat">Sailboat</option>
              <option value="pontoon">Pontoon</option>
              <option value="houseboat">Houseboat</option>
              <option value="pwc">PWC / Jet Ski</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="LOA (ft)" required hint="Length overall — drives slip fit.">
            <NumberInput
              step="0.1"
              value={loaFt}
              onChange={(e) => setLoaFt(e.target.value)}
              placeholder="28"
            />
          </Field>
          <Field label="Beam (ft)">
            <NumberInput
              step="0.1"
              value={beamFt}
              onChange={(e) => setBeamFt(e.target.value)}
              placeholder="9"
            />
          </Field>
        </div>

        {/* Expander — Year/Make/Model + Fuel/Draft + Hull VIN/Registration.
            Year/Make/Model come off the registration card; Hull VIN +
            Registration come off the COI. Operators with paperwork in
            hand expand; quick-add ops skip. */}
        <div className="border-t border-hairline pt-3">
          <button
            type="button"
            onClick={() => setShowMore((s) => !s)}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-fg-subtle transition-colors hover:text-fg"
          >
            {showMore ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
            {showMore ? "Hide additional details" : "Add more details"}
          </button>

          {showMore && (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Year">
                  <NumberInput
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    placeholder="2018"
                  />
                </Field>
                <Field label="Make">
                  <TextInput
                    value={make}
                    onChange={(e) => setMake(e.target.value)}
                    placeholder="Sea Ray"
                  />
                </Field>
                <Field label="Model">
                  <TextInput
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="SLX 280"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Fuel">
                  <Select value={fuelType} onChange={(v) => setFuelType(v as typeof fuelType)}>
                    <option value="gasoline">Gasoline</option>
                    <option value="diesel">Diesel</option>
                    <option value="electric">Electric</option>
                    <option value="none">None</option>
                  </Select>
                </Field>
                <Field label="Draft (ft)">
                  <NumberInput
                    step="0.1"
                    value={draftFt}
                    onChange={(e) => setDraftFt(e.target.value)}
                    placeholder="3"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Hull VIN" hint="Auto-fills from a COI upload.">
                  <TextInput
                    value={hullVin}
                    onChange={(e) => setHullVin(e.target.value)}
                    placeholder="USA-SER-1234567"
                  />
                </Field>
                <Field label="Registration" hint="Auto-fills from a COI upload.">
                  <TextInput
                    value={registration}
                    onChange={(e) => setRegistration(e.target.value)}
                    placeholder="MI 1234 AB"
                  />
                </Field>
              </div>
            </div>
          )}
        </div>
      </div>
    </CreateSheet>
  );
}
