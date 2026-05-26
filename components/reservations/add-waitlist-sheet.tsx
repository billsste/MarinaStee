"use client";

import * as React from "react";
import { CreateSheet, Field, NumberInput, Select, TextInput, Textarea } from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { BOATERS } from "@/lib/mock-data";
import {
  addWaitlistEntry,
  nextWaitlistId,
  useBoaters,
} from "@/lib/client-store";

/*
 * Add an entry to the waitlist. Either an existing boater or a prospect
 * (guest_name / guest_email / guest_phone). Toggle at top of form.
 */
export function AddWaitlistSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
}) {
  const liveBoaters = useBoaters();
  const boaters = liveBoaters.length > 0 ? liveBoaters : BOATERS;

  const [kind, setKind] = React.useState<"existing" | "prospect">("prospect");
  const [boaterId, setBoaterId] = React.useState("");
  const [guestName, setGuestName] = React.useState("");
  const [guestEmail, setGuestEmail] = React.useState("");
  const [guestPhone, setGuestPhone] = React.useState("");
  const [reservationType, setReservationType] = React.useState<
    "transient" | "monthly" | "seasonal" | "annual"
  >("transient");
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");
  const [loaFt, setLoaFt] = React.useState("");
  const [preferredDock, setPreferredDock] = React.useState("");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setKind("prospect");
      setBoaterId("");
      setGuestName("");
      setGuestEmail("");
      setGuestPhone("");
      setReservationType("transient");
      setStart("");
      setEnd("");
      setLoaFt("");
      setPreferredDock("");
      setNotes("");
    }
  }, [open]);

  const canSubmit =
    kind === "existing" ? boaterId.length > 0 : guestName.trim().length > 0;

  function submit() {
    if (!canSubmit) return;
    addWaitlistEntry({
      id: nextWaitlistId(),
      boater_id: kind === "existing" ? boaterId : undefined,
      guest_name: kind === "prospect" ? guestName.trim() : undefined,
      guest_email: kind === "prospect" ? guestEmail.trim() || undefined : undefined,
      guest_phone: kind === "prospect" ? guestPhone.trim() || undefined : undefined,
      preferred_arrival: start || undefined,
      preferred_departure: end || undefined,
      loa_inches: loaFt ? Math.round(Number(loaFt) * 12) : undefined,
      preferred_dock: preferredDock.trim() || undefined,
      reservation_type: reservationType,
      notes: notes.trim() || undefined,
      status: "pending",
      created_at: new Date().toISOString(),
    });
    onOpenChange(false);
  }

  return (
    <CreateSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add to waitlist"
      description="Capture someone who wants a slip when capacity opens."
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            Add to waitlist
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Existing vs Prospect toggle */}
        <div className="flex rounded-[10px] border border-hairline bg-surface-2 p-1 text-[12px]">
          {(["prospect", "existing"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={
                "flex-1 rounded-[6px] px-3 py-1.5 font-medium capitalize transition-colors " +
                (kind === k ? "bg-surface-1 text-fg shadow-sm" : "text-fg-subtle hover:text-fg")
              }
            >
              {k === "prospect" ? "New prospect" : "Existing holder"}
            </button>
          ))}
        </div>

        {kind === "existing" ? (
          <Field label="Holder" required>
            <Combobox
              value={boaterId}
              onChange={setBoaterId}
              options={boaters.map((b) => ({
                value: b.id,
                label: b.display_name,
                hint: b.code ? `· ${b.code}` : undefined,
              }))}
              placeholder="Pick a holder…"
              searchPlaceholder="Search by name…"
            />
          </Field>
        ) : (
          <>
            <Field label="Name" required>
              <TextInput
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Smith, Pat"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email">
                <TextInput
                  type="email"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                  placeholder="pat@example.com"
                />
              </Field>
              <Field label="Phone">
                <TextInput
                  type="tel"
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                  placeholder="(555) 555-0123"
                />
              </Field>
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Reservation type">
            <Select value={reservationType} onChange={(v) => setReservationType(v as typeof reservationType)}>
              <option value="transient">Transient (1-30 days)</option>
              <option value="monthly">Monthly</option>
              <option value="seasonal">Seasonal</option>
              <option value="annual">Annual</option>
            </Select>
          </Field>
          <Field label="LOA (ft)" hint="Vessel length overall.">
            <NumberInput step="0.5" value={loaFt} onChange={(e) => setLoaFt(e.target.value)} placeholder="32" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Preferred arrival">
            <TextInput type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Preferred departure">
            <TextInput type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>

        <Field label="Preferred dock">
          <TextInput
            value={preferredDock}
            onChange={(e) => setPreferredDock(e.target.value)}
            placeholder="Damsite A Dock"
          />
        </Field>

        <Field label="Notes">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What are they looking for? Special needs? Referral source?"
          />
        </Field>
      </div>
    </CreateSheet>
  );
}
