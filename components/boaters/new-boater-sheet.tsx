"use client";

import * as React from "react";
import { CreateSheet, Field, Select, TextInput, Textarea } from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { executeAgentAction } from "@/lib/agent-actions";
import { formatPhoneInput, phoneDigitCount } from "@/lib/utils";

/*
 * Code generation: holders get a system-assigned shorthand at create time
 * derived from billing cadence. Annual / seasonal / monthly get a slot
 * suffix that gets superseded when a slip is assigned via the contract
 * flow (e.g. "DSM A29" once attached to slip A29 on Damsite). Transients
 * get a stable "TRN-####" stamp. Either way, staff doesn't type it.
 */
function generateHolderCode(cadence: "annual" | "seasonal" | "monthly" | "transient"): string {
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  if (cadence === "transient") return `TRN-${stamp}`;
  if (cadence === "monthly") return `M-${stamp}`;
  if (cadence === "seasonal") return `S-${stamp}`;
  return `A-${stamp}`;
}

export function NewBoaterSheet({
  open,
  onOpenChange,
  onCreated,
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
}) {
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [preferredChannel, setPreferredChannel] = React.useState<"email" | "sms" | "voice">("email");
  const [billingCadence, setBillingCadence] = React.useState<"annual" | "seasonal" | "monthly" | "transient">("transient");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setPreferredChannel("email");
      setBillingCadence("transient");
      setNotes("");
    }
  }, [open]);

  // Simple email shape check — full RFC-grade isn't worth the overhead at
  // the demo layer. Real backend validation will be authoritative.
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
      // Auto-generated code — gets superseded by slip-encoded code when a
      // slip is attached via the contract flow.
      code: generateHolderCode(billingCadence),
      preferred_channel: preferredChannel,
      billing_cadence: billingCadence,
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
      title="New holder"
      description="Add a new slip holder, seasonal, or transient account. Vessels and slips can be attached after. A code is auto-generated and replaced with the slip ID when a slip is assigned."
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            Create holder
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

        <div className="grid grid-cols-2 gap-3">
          <Field label="Preferred channel">
            <Select value={preferredChannel} onChange={(v) => setPreferredChannel(v as typeof preferredChannel)}>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="voice">Voice</option>
            </Select>
          </Field>
          <Field label="Billing cadence">
            <Select value={billingCadence} onChange={(v) => setBillingCadence(v as typeof billingCadence)}>
              <option value="transient">Transient (per-stay)</option>
              <option value="monthly">Monthly</option>
              <option value="seasonal">Seasonal</option>
              <option value="annual">Annual</option>
            </Select>
          </Field>
        </div>

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
