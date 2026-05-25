"use client";

import * as React from "react";
import { CreateSheet, Field, Select, TextInput, Textarea } from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { getVesselsForBoater } from "@/lib/mock-data";
import { useVesselsForBoater } from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";

/*
 * Boater-side service request form. Creates a Work Order with status "open"
 * tagged "[Requested by boater via portal]" so the admin can quickly tell
 * which jobs were self-served vs. dock-walked or phone-called in.
 */
export function PortalRequestServiceSheet({
  open,
  onOpenChange,
  boaterId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  boaterId: string;
}) {
  const liveVessels = useVesselsForBoater(boaterId);
  const vessels = liveVessels.length > 0 ? liveVessels : getVesselsForBoater(boaterId);

  const [vesselId, setVesselId] = React.useState(vessels[0]?.id ?? "");
  const [activityType, setActivityType] = React.useState<
    "winterization" | "haul_out" | "bottom_paint" | "inspection" | "service" | "other"
  >("service");
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [preferredDate, setPreferredDate] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setVesselId(vessels[0]?.id ?? "");
      setActivityType("service");
      setSubject("");
      setDescription("");
      setPreferredDate("");
    }
  }, [open, vessels]);

  const canSubmit = subject.trim().length > 0;

  function submit() {
    if (!canSubmit) return;
    const portalNote = `[Requested by boater via portal${
      preferredDate ? ` · preferred date ${preferredDate}` : ""
    }]`;
    executeAgentAction({
      kind: "create_work_order",
      label: "",
      boater_id: boaterId,
      vessel_id: vesselId || undefined,
      subject: subject.trim(),
      description: [portalNote, description.trim()].filter(Boolean).join("\n\n"),
      activity_type: activityType,
      priority: "normal",
    });
    onOpenChange(false);
  }

  return (
    <CreateSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Request a service"
      description="Tell us what you need and we'll send back a quote. Most jobs are scheduled within 2-3 business days."
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            Submit request
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vessel" required>
            <Select value={vesselId} onChange={setVesselId}>
              {vessels.length === 0 ? (
                <option value="">No vessels on file</option>
              ) : (
                vessels.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))
              )}
            </Select>
          </Field>
          <Field label="Service type" required>
            <Select value={activityType} onChange={(v) => setActivityType(v as typeof activityType)}>
              <option value="service">Service / Repair</option>
              <option value="winterization">Winterization</option>
              <option value="haul_out">Haul-out</option>
              <option value="bottom_paint">Bottom paint</option>
              <option value="inspection">Inspection</option>
              <option value="other">Other</option>
            </Select>
          </Field>
        </div>

        <Field label="What's the job?" required>
          <TextInput
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Bottom paint refresh, engine winterization, prop inspection…"
          />
        </Field>

        <Field label="Details" hint="Photos can come later via the message thread.">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Anything we should know — symptoms, scheduling constraints, parts you've already ordered, etc."
            rows={4}
          />
        </Field>

        <Field label="Preferred date" hint="Optional. We'll do our best to honor it.">
          <TextInput type="date" value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} />
        </Field>
      </div>
    </CreateSheet>
  );
}
