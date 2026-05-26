"use client";

import * as React from "react";
import { CreateSheet, Field, TextInput, Select, Textarea } from "@/components/create-sheet";
import { Combobox } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import {
  BOATERS,
  RENTAL_SPACES,
  USERS,
  VESSELS,
} from "@/lib/mock-data";
import { executeAgentAction } from "@/lib/agent-actions";
import { usePicklistValues } from "@/lib/client-store";

export function NewWorkOrderSheet({
  open,
  onOpenChange,
  defaultBoaterId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  defaultBoaterId?: string;
}) {
  const [subject, setSubject] = React.useState("");
  const [boaterId, setBoaterId] = React.useState(defaultBoaterId ?? "");
  // Activity type values come from the tenant picklist (super-user
  // managed). The TS union below is still authoritative for the agent
  // tool schema — adding a brand-new picklist code path-as-data here
  // would be Phase 2 (custom fields).
  const activityTypeOptions = usePicklistValues("activity_type");
  const [activityType, setActivityType] = React.useState<
    "winterization" | "bottom_paint" | "service" | "inspection" | "haul_out" | "pump_out" | "task" | "other"
  >("service");
  const [priority, setPriority] = React.useState<"low" | "normal" | "high" | "urgent">(
    "normal"
  );
  const [vesselId, setVesselId] = React.useState("");
  const [slipId, setSlipId] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState("");
  const [description, setDescription] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setSubject("");
      setBoaterId(defaultBoaterId ?? "");
      setActivityType("service");
      setPriority("normal");
      setVesselId("");
      setSlipId("");
      setStartDate("");
      setEndDate("");
      setDueDate("");
      setAssigneeId("");
      setDescription("");
    }
  }, [open, defaultBoaterId]);

  const boater = BOATERS.find((b) => b.id === boaterId);
  const vesselOptions = boater
    ? VESSELS.filter((v) => v.boater_id === boater.id || v.co_owner_ids.includes(boater.id))
    : VESSELS;
  const staff = USERS.filter((u) => u.role !== "system");

  const canSubmit = subject.trim().length > 0 && boaterId.length > 0;

  function submit() {
    if (!canSubmit) return;
    executeAgentAction({
      kind: "create_work_order",
      label: "",
      boater_id: boaterId,
      subject: subject.trim(),
      description: description.trim() || undefined,
      activity_type: activityType,
      priority,
      vessel_id: vesselId || undefined,
      slip_id: slipId || undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      due_date: dueDate || undefined,
      assignee_user_id: assigneeId || undefined,
    });
    onOpenChange(false);
  }

  return (
    <CreateSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New work order"
      description="Schedule a service job. Marina Stee will tie it to the holder, vessel, and slip you pick."
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            Create work order
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Subject" required>
          <TextInput
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Winterize 1989 Bayliner"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Holder" required>
            <Combobox
              value={boaterId}
              onChange={setBoaterId}
              options={BOATERS.map((b) => ({
                value: b.id,
                label: b.display_name,
                hint: b.code ? `· ${b.code}` : undefined,
              }))}
              placeholder="Pick a holder…"
              searchPlaceholder="Search by name, code…"
            />
          </Field>
          <Field label="Activity type">
            <Select
              value={activityType}
              onChange={(v) => setActivityType(v as typeof activityType)}
            >
              {/* Managed in Settings → Customization. */}
              {activityTypeOptions.map((o) => (
                <option key={o.id} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Vessel" hint={boater ? `Filtered to ${boater.first_name}'s vessels` : undefined}>
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
              {RENTAL_SPACES.slice(0, 30).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority">
            <Select value={priority} onChange={(v) => setPriority(v as typeof priority)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </Field>
          <Field label="Assign to">
            <Select value={assigneeId} onChange={setAssigneeId}>
              <option value="">Unassigned</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.role}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Start">
            <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="End">
            <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Field label="Due">
            <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        <Field label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What needs to happen, any context the technician needs…"
          />
        </Field>
      </div>
    </CreateSheet>
  );
}
