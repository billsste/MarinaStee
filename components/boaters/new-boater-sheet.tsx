"use client";

import * as React from "react";
import { CreateSheet, Field, Select, TextInput, Textarea } from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { executeAgentAction } from "@/lib/agent-actions";
import { formatPhoneInput, phoneDigitCount } from "@/lib/utils";

/*
 * New member / boater sheet.
 *
 * Captures identity only — name, email, phone, preferred comms channel,
 * notes. Billing cadence and slip assignment are determined later when
 * the operator creates a reservation or contract, not here.
 *
 * A short code is auto-generated from a timestamp stamp. It gets
 * superseded by the slip-encoded code when a slip is assigned via the
 * contract flow (e.g. "DSM A29").
 */
function generateHolderCode(): string {
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  return `MB-${stamp}`;
}

export function NewBoaterSheet({
  open,
  onOpenChange,
  onCreated,
  prefill,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  /**
   * Called with the newly-created boater id after successful submit.
   * Use this in flows that need to auto-select the new holder (e.g.,
   * the slip-assignment wizard) — sorting the boaters list by id to
   * find "the latest" is unreliable because runtime ids don't sort
   * lexicographically after the seeded ones.
   */
  onCreated?: (boaterId: string) => void;
  /**
   * Pre-fill the form on open. Used by the convert-waitlist-applicant
   * flow so the operator doesn't have to re-type contact info they
   * already collected on the waitlist entry. Empty/undefined fields
   * fall back to the blank reset.
   */
  prefill?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    preferred_channel?: "email" | "sms" | "voice";
    notes?: string;
  };
}) {
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [preferredChannel, setPreferredChannel] = React.useState<"email" | "sms" | "voice">("email");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setFirstName(prefill?.first_name ?? "");
      setLastName(prefill?.last_name ?? "");
      setEmail(prefill?.email ?? "");
      // Normalize the prefilled phone the same way user-typed values get
      // normalized — guard against raw E.164 / digits-only seeds.
      setPhone(prefill?.phone ? formatPhoneInput(prefill.phone) : "");
      setPreferredChannel(prefill?.preferred_channel ?? "email");
      setNotes(prefill?.notes ?? "");
    }
    // prefill is an object literal that may change identity between
    // renders; we intentionally re-run on open OR identity change so
    // a fresh prefill swap (different applicant) re-populates.
  }, [open, prefill]);

  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const phoneIsComplete = phoneDigitCount(phone) === 10;
  const canSubmit =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    emailLooksValid &&
    phoneIsComplete;

  function submit() {
    if (!canSubmit) return;
    const result = executeAgentAction({
      kind: "create_boater",
      label: "",
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      code: generateHolderCode(),
      preferred_channel: preferredChannel,
      // billing_cadence is set on the reservation or contract, not on the
      // boater — default to "transient" as a neutral placeholder.
      billing_cadence: "transient",
      notes: notes.trim() || undefined,
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
      title="New member"
      description="Add a member's contact info. Slip assignment, billing cadence, and vessel details are attached when you create their reservation or contract."
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            Create member
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" required>
            <TextInput value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="David" />
          </Field>
          <Field label="Last name" required>
            <TextInput value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Emmons" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Email" required>
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="david@example.com" />
          </Field>
          <Field label="Phone" required>
            <TextInput
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              placeholder="(555) 555-0123"
            />
          </Field>
        </div>

        <Field label="Preferred channel">
          <Select value={preferredChannel} onChange={(v) => setPreferredChannel(v as typeof preferredChannel)}>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="voice">Voice</option>
          </Select>
        </Field>

        <Field label="Notes">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything staff should know — referral source, special handling, allergies, etc."
          />
        </Field>
      </div>
    </CreateSheet>
  );
}
