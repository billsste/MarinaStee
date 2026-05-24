"use client";

import * as React from "react";
import { CreateSheet, Field, NumberInput, Select, TextInput } from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { BOATERS, CONTRACT_TEMPLATES, RENTAL_SPACES, VESSELS } from "@/lib/mock-data";
import { useBoaters } from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";

export function NewContractSheet({
  open,
  onOpenChange,
  defaultBoaterId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  defaultBoaterId?: string;
}) {
  const liveBoaters = useBoaters();
  const boaters = liveBoaters.length > 0 ? liveBoaters : BOATERS;

  const [boaterId, setBoaterId] = React.useState(defaultBoaterId ?? "");
  const [templateId, setTemplateId] = React.useState<string>(
    CONTRACT_TEMPLATES[0]?.id ?? ""
  );
  const [vesselId, setVesselId] = React.useState("");
  const [slipId, setSlipId] = React.useState("");
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");
  const [annualRate, setAnnualRate] = React.useState("");
  const [cadence, setCadence] = React.useState<"annual" | "seasonal" | "monthly" | "transient">("monthly");

  React.useEffect(() => {
    if (open) {
      setBoaterId(defaultBoaterId ?? "");
      const firstTpl = CONTRACT_TEMPLATES[0];
      setTemplateId(firstTpl?.id ?? "");
      setVesselId("");
      setSlipId("");
      const today = new Date().toISOString().slice(0, 10);
      setStart(today);
      const monthsAhead = firstTpl?.default_term_months ?? 12;
      const endDate = new Date(Date.now() + monthsAhead * 30 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      setEnd(endDate);
      setAnnualRate(firstTpl?.default_annual_rate?.toString() ?? "");
      setCadence(firstTpl?.default_billing_cadence ?? "monthly");
    }
  }, [open, defaultBoaterId]);

  // When template changes, reset rate + cadence + suggested end date
  React.useEffect(() => {
    const tpl = CONTRACT_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    setCadence(tpl.default_billing_cadence);
    if (tpl.default_annual_rate) {
      setAnnualRate(tpl.default_annual_rate.toString());
    }
    if (start) {
      const endDate = new Date(
        new Date(start).getTime() + tpl.default_term_months * 30 * 86_400_000
      )
        .toISOString()
        .slice(0, 10);
      setEnd(endDate);
    }
  }, [templateId, start]);

  const boater = boaters.find((b) => b.id === boaterId);
  const vesselOptions = boater
    ? VESSELS.filter((v) => v.boater_id === boater.id || v.co_owner_ids.includes(boater.id))
    : VESSELS;

  const canSubmit =
    boaterId.length > 0 &&
    templateId.length > 0 &&
    start.length > 0 &&
    end.length > 0 &&
    start <= end;

  function submit() {
    if (!canSubmit) return;
    executeAgentAction({
      kind: "create_contract",
      label: "",
      boater_id: boaterId,
      template_id: templateId,
      vessel_id: vesselId || undefined,
      slip_id: slipId || undefined,
      effective_start: start,
      effective_end: end,
      annual_rate: annualRate ? Number(annualRate) : undefined,
      billing_cadence: cadence,
    });
    onOpenChange(false);
  }

  return (
    <CreateSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New contract"
      description="Pick a template, set the term, and Marina Stee drafts the agreement. Send for signature from the boater's Contracts list after."
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            Draft contract
          </Button>
        </>
      }
    >
      <div className="space-y-3">
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

        <Field label="Template" required>
          <Select value={templateId} onChange={setTemplateId}>
            {CONTRACT_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · v{t.version}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
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
          <Field label="Slip">
            <Select value={slipId} onChange={setSlipId}>
              <option value="">No slip</option>
              {RENTAL_SPACES.slice(0, 40).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number} · {s.occupancy_type}
                </option>
              ))}
            </Select>
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

        <div className="grid grid-cols-2 gap-3">
          <Field label="Annual rate ($)">
            <NumberInput
              step="1"
              value={annualRate}
              onChange={(e) => setAnnualRate(e.target.value)}
              placeholder="3900"
            />
          </Field>
          <Field label="Billing cadence">
            <Select value={cadence} onChange={(v) => setCadence(v as typeof cadence)}>
              <option value="monthly">Monthly</option>
              <option value="seasonal">Seasonal (lump)</option>
              <option value="annual">Annual (lump)</option>
              <option value="transient">Transient (per-stay)</option>
            </Select>
          </Field>
        </div>

        {start && end && start > end && (
          <p className="text-[12px] text-status-danger">End must be on or after start.</p>
        )}
      </div>
    </CreateSheet>
  );
}
