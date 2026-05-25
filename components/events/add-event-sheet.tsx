"use client";

import * as React from "react";
import {
  CreateSheet,
  Field,
  NumberInput,
  Select,
  TextInput,
  Textarea,
} from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { addMarinaEvent, nextEventId } from "@/lib/client-store";
import type { MarinaEventType } from "@/lib/types";

/*
 * Create a marina-hosted event. Lives on the existing /reservations calendar
 * alongside reservations — no separate "Events" surface.
 */
export function AddEventSheet({
  open,
  onOpenChange,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  defaultDate?: string; // pre-fill start/end if user clicked a day
}) {
  const [title, setTitle] = React.useState("");
  const [eventType, setEventType] = React.useState<MarinaEventType>("social");
  const [description, setDescription] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [startTime, setStartTime] = React.useState("");
  const [endTime, setEndTime] = React.useState("");
  const [capacity, setCapacity] = React.useState("");
  const [publicToBoaters, setPublicToBoaters] = React.useState(true);

  React.useEffect(() => {
    if (open) {
      setTitle("");
      setEventType("social");
      setDescription("");
      setLocation("");
      const d = defaultDate ?? new Date().toISOString().slice(0, 10);
      setStartDate(d);
      setEndDate(d);
      setStartTime("");
      setEndTime("");
      setCapacity("");
      setPublicToBoaters(true);
    }
  }, [open, defaultDate]);

  const canSubmit =
    title.trim().length > 0 &&
    startDate.length > 0 &&
    endDate.length > 0 &&
    startDate <= endDate;

  function submit() {
    if (!canSubmit) return;
    addMarinaEvent({
      id: nextEventId(),
      title: title.trim(),
      description: description.trim() || undefined,
      event_type: eventType,
      start_date: startDate,
      end_date: endDate,
      start_time: startTime || undefined,
      end_time: endTime || undefined,
      location: location.trim() || undefined,
      capacity: capacity ? Number(capacity) : undefined,
      rsvp_boater_ids: [],
      public_to_boaters: publicToBoaters,
      created_at: new Date().toISOString(),
    });
    onOpenChange(false);
  }

  return (
    <CreateSheet
      open={open}
      onOpenChange={onOpenChange}
      title="New event"
      description="Marina-hosted event. Renders on the calendar alongside reservations."
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            Add event
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Title" required>
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Memorial Day raft-up"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={eventType} onChange={(v) => setEventType(v as MarinaEventType)}>
              <option value="social">Social / raft-up</option>
              <option value="tournament">Tournament</option>
              <option value="regatta">Regatta</option>
              <option value="fireworks">Fireworks</option>
              <option value="season">Season opening / closing</option>
              <option value="maintenance">Maintenance / closure</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Location">
            <TextInput
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Pavilion / Channel / A Dock"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date" required>
            <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="End date" required>
            <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Start time" hint="Leave blank for all-day.">
            <TextInput type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="End time">
            <TextInput type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Capacity" hint="Optional RSVP cap.">
            <NumberInput
              min="1"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="40"
            />
          </Field>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-[13px] text-fg">
              <input
                type="checkbox"
                checked={publicToBoaters}
                onChange={(e) => setPublicToBoaters(e.target.checked)}
                className="size-3.5"
              />
              Show on boater portal
            </label>
          </div>
        </div>

        <Field label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's the deal? Bring your own grill, kids welcome, registration where?"
            rows={4}
          />
        </Field>

        {startDate && endDate && startDate > endDate && (
          <p className="text-[12px] text-status-danger">End must be on or after start.</p>
        )}
      </div>
    </CreateSheet>
  );
}
