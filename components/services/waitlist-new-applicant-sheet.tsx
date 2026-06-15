"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addWaitlistEntry } from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { SlipClass, WaitlistEntry } from "@/lib/types";

/*
 * Operator-side waitlist intake.
 *
 * Companion to the public /apply form — same fields, but invoked from
 * the waitlist toolbar when a marina staffer is talking to a prospect
 * directly (phone, in-person, email). Operator-added entries skip the
 * Applications queue (which exists for public submissions that need
 * vetting) and land directly on the waitlist queue. Source defaults
 * to "manual" so reporting can split operator-entered vs public-apply
 * inbound later.
 *
 * Renders as a side-sheet (right of the waitlist content). Slides in
 * from the right; backdrop dims the table behind. Submit on Enter
 * from any required field; Esc closes without saving.
 */

const SLIP_CLASS_OPTIONS: { value: SlipClass; label: string }[] = [
  { value: "covered", label: "Covered" },
  { value: "uncovered", label: "Uncovered" },
  { value: "t_head", label: "T-head" },
  { value: "buoy", label: "Buoy / Mooring" },
  { value: "dry_storage", label: "Dry storage" },
];

const CADENCE_OPTIONS: { value: WaitlistEntry["reservation_type"]; label: string }[] = [
  { value: "annual", label: "Annual" },
  { value: "seasonal", label: "Seasonal" },
  { value: "monthly", label: "Monthly" },
  { value: "transient", label: "Transient" },
];

type Form = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  vessel_loa_feet: string;
  vessel_beam_feet: string;
  preferred_classes: SlipClass[];
  preferred_dock: string;
  cadence: WaitlistEntry["reservation_type"];
  preferred_arrival: string;
  notes: string;
};

const EMPTY: Form = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  vessel_loa_feet: "",
  vessel_beam_feet: "",
  preferred_classes: [],
  preferred_dock: "",
  cadence: "annual",
  preferred_arrival: "",
  notes: "",
};

export function WaitlistNewApplicantSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [form, setForm] = React.useState<Form>(EMPTY);
  // Reset every time the sheet opens so previous values don't bleed in.
  React.useEffect(() => {
    if (open) setForm(EMPTY);
  }, [open]);

  function close() {
    onOpenChange(false);
  }

  const canSubmit =
    form.first_name.trim().length > 0 &&
    form.last_name.trim().length > 0 &&
    (form.email.trim().length > 0 || form.phone.trim().length > 0) &&
    form.vessel_loa_feet.trim().length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const loaInches = Math.round(Number(form.vessel_loa_feet) * 12) || undefined;
    const beamInches = form.vessel_beam_feet.trim()
      ? Math.round(Number(form.vessel_beam_feet) * 12) || undefined
      : undefined;

    const entry: WaitlistEntry = {
      id: `wl_${Date.now().toString(36)}`,
      guest_name: `${form.last_name.trim()}, ${form.first_name.trim()}`,
      guest_email: form.email.trim() || undefined,
      guest_phone: form.phone.trim() || undefined,
      loa_inches: loaInches,
      beam_inches: beamInches,
      preferred_dock: form.preferred_dock.trim() || undefined,
      preferred_classes:
        form.preferred_classes.length > 0 ? form.preferred_classes : undefined,
      reservation_type: form.cadence,
      preferred_arrival: form.preferred_arrival || undefined,
      notes: form.notes.trim() || undefined,
      status: "pending",
      created_at: new Date().toISOString(),
    };
    addWaitlistEntry(entry);
    close();
  }

  function togglePreferredClass(c: SlipClass) {
    setForm((f) => ({
      ...f,
      preferred_classes: f.preferred_classes.includes(c)
        ? f.preferred_classes.filter((x) => x !== c)
        : [...f.preferred_classes, c],
    }));
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="New waitlist applicant"
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-fg/20 backdrop-blur-[2px]"
        onClick={close}
        aria-label="Close"
        tabIndex={-1}
      />

      {/* Panel */}
      <form
        onSubmit={handleSubmit}
        className="relative ml-auto flex h-full w-full max-w-[520px] flex-col bg-surface-1 shadow-xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div>
            <div className="text-[10.5px] font-medium uppercase tracking-wide text-fg-tertiary">
              Waitlist
            </div>
            <h2 className="display-tight mt-0.5 text-[18px] font-semibold text-fg">
              New applicant
            </h2>
            <p className="mt-1 text-[12px] text-fg-subtle">
              Operator-entered prospect — lands directly on the queue. Same
              fields the public /apply form collects.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-md p-1 text-fg-tertiary transition-colors hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Applicant */}
          <Section title="Applicant">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" required>
                <Input
                  value={form.first_name}
                  onChange={(v) => setForm({ ...form, first_name: v })}
                  autoFocus
                />
              </Field>
              <Field label="Last name" required>
                <Input
                  value={form.last_name}
                  onChange={(v) => setForm({ ...form, last_name: v })}
                />
              </Field>
              <Field
                label="Email"
                hint="Required if no phone"
              >
                <Input
                  type="email"
                  value={form.email}
                  onChange={(v) => setForm({ ...form, email: v })}
                />
              </Field>
              <Field label="Phone" hint="Required if no email">
                <Input
                  inputMode="tel"
                  value={form.phone}
                  onChange={(v) => setForm({ ...form, phone: v })}
                />
              </Field>
            </div>
          </Section>

          {/* Vessel */}
          <Section title="Vessel">
            <div className="grid grid-cols-2 gap-3">
              <Field label="LOA (feet)" required>
                <Input
                  inputMode="decimal"
                  value={form.vessel_loa_feet}
                  onChange={(v) =>
                    setForm({ ...form, vessel_loa_feet: v.replace(/[^\d.]/g, "") })
                  }
                  placeholder="32"
                />
              </Field>
              <Field label="Beam (feet)">
                <Input
                  inputMode="decimal"
                  value={form.vessel_beam_feet}
                  onChange={(v) =>
                    setForm({ ...form, vessel_beam_feet: v.replace(/[^\d.]/g, "") })
                  }
                  placeholder="10"
                />
              </Field>
            </div>
          </Section>

          {/* Slip preferences */}
          <Section title="Slip preferences">
            <Field label="Preferred classes" hint="Pick any that fit — applicant matches faster across multiple">
              <div className="flex flex-wrap gap-1.5">
                {SLIP_CLASS_OPTIONS.map((opt) => {
                  const active = form.preferred_classes.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => togglePreferredClass(opt.value)}
                      className={cn(
                        "rounded-[7px] border px-2.5 py-1 text-[12px] font-medium transition-colors",
                        active
                          ? "border-primary/40 bg-primary-soft text-primary"
                          : "border-hairline bg-surface-2 text-fg-subtle hover:bg-surface-3"
                      )}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Preferred dock">
                <Input
                  value={form.preferred_dock}
                  onChange={(v) => setForm({ ...form, preferred_dock: v })}
                  placeholder="Damsite A Dock"
                />
              </Field>
              <Field label="Cadence">
                <select
                  value={form.cadence}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      cadence: e.target.value as WaitlistEntry["reservation_type"],
                    })
                  }
                  className="w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-hairline-strong focus:outline-none"
                >
                  {CADENCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Desired start date">
                <Input
                  type="date"
                  value={form.preferred_arrival}
                  onChange={(v) => setForm({ ...form, preferred_arrival: v })}
                />
              </Field>
            </div>
          </Section>

          {/* Notes */}
          <Section title="Notes">
            <Field
              label="Internal notes"
              hint="What you learned from the conversation, special requests, etc."
            >
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                className="w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
              />
            </Field>
          </Section>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-hairline bg-surface-2 px-5 py-3">
          <span className="text-[11px] text-fg-tertiary">
            Lands on the queue immediately. You can call from there.
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={!canSubmit}>
              Add to waitlist
            </Button>
          </div>
        </footer>
      </form>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[10.5px] font-medium uppercase tracking-wide text-fg-tertiary">
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[12px] font-medium text-fg">
        {label}
        {required && <span className="ml-0.5 text-status-danger">*</span>}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-fg-tertiary">{hint}</span>}
    </label>
  );
}

function Input({
  value,
  onChange,
  type = "text",
  inputMode,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email";
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      inputMode={inputMode}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className="w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
    />
  );
}
