"use client";

import * as React from "react";
import { LifeBuoy } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createSupportTicket,
} from "@/lib/client-store";
import type {
  Boater,
  SupportTicketPriority,
  SupportTicketType,
} from "@/lib/types";
import {
  PRIORITY_LABEL,
  TYPE_LABEL,
} from "@/components/support/support-ticket-badges";

/*
 * "New Ticket" tab on the boater portal.
 *
 * Required (global §5): subject + description.
 * Recommended: type, priority, page/area, steps to reproduce, attachments.
 *
 * Silent context capture (URL, app version, UA) per global §5: never
 * shown to the boater, sent on submit. Tone is "how can we help?" —
 * warmer than the operator-side wording.
 */

const TYPE_OPTIONS: SupportTicketType[] = [
  "bug",
  "question",
  "feature_request",
  "billing",
  "other",
];

const PRIORITY_OPTIONS: SupportTicketPriority[] = [
  "low",
  "normal",
  "high",
  "urgent",
];

interface Props {
  boater: Boater;
  /** Called after a successful create — used to flip the tab back to
   *  "My Tickets" so the boater sees their new entry. */
  onSubmitted?: (ticketId: string) => void;
}

export function SupportNewTicketForm({ boater, onSubmitted }: Props) {
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SupportTicketType>("question");
  const [priority, setPriority] = React.useState<SupportTicketPriority>("normal");
  const [pageOrArea, setPageOrArea] = React.useState("");
  const [steps, setSteps] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const valid = subject.trim().length > 0 && description.trim().length > 0;

  function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);

    // Silent context — captured once at submit, never shown to the
    // user. Mirrors the global §5 rule: "Capture contextual metadata
    // (user ID, app version, URL) silently in the background."
    const ctx = {
      submitted_from_url:
        typeof window !== "undefined" ? window.location.pathname : undefined,
      app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.2.0",
      user_agent:
        typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    };

    const ticket = createSupportTicket({
      boater_id: boater.id,
      subject,
      description,
      type,
      priority,
      page_or_area: pageOrArea.trim() || undefined,
      steps_to_reproduce: steps.trim() || undefined,
      context: ctx,
    });

    setSubmitting(false);

    if (!ticket) {
      setError("Couldn't submit — please fill in a subject and description.");
      return;
    }

    // Reset the form so a follow-up ticket starts clean.
    setSubject("");
    setDescription("");
    setType("question");
    setPriority("normal");
    setPageOrArea("");
    setSteps("");
    onSubmitted?.(ticket.id);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
        <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-wide text-primary">
          <LifeBuoy className="size-3.5" />
          New ticket
        </div>
        <h2 className="display-tight mt-1 text-[18px] font-semibold text-fg">
          How can we help, {boater.first_name}?
        </h2>
        <p className="mt-0.5 text-[12px] text-fg-subtle">
          Tell us what&rsquo;s going on — we read every ticket and reply as
          soon as we can.
        </p>
      </div>

      {/* Required fields */}
      <Section title="The basics" required>
        <Field label="Subject" required>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="What's the headline?"
            autoFocus
            className="w-full rounded-[8px] border border-hairline bg-surface-1 px-3 py-2 text-[13px] text-fg placeholder:text-fg-tertiary focus:border-primary focus:outline-none"
          />
        </Field>
        <Field label="Description" required>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell us what's happening — the more detail, the faster we can help."
            rows={5}
            className="w-full resize-y rounded-[8px] border border-hairline bg-surface-1 px-3 py-2 text-[13px] text-fg placeholder:text-fg-tertiary focus:border-primary focus:outline-none"
          />
        </Field>
      </Section>

      {/* Recommended fields */}
      <Section title="Helpful extras (optional)">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Type">
            <SelectChips
              options={TYPE_OPTIONS}
              labels={TYPE_LABEL}
              value={type}
              onChange={(v) => setType(v as SupportTicketType)}
            />
          </Field>
          <Field label="Priority">
            <SelectChips
              options={PRIORITY_OPTIONS}
              labels={PRIORITY_LABEL}
              value={priority}
              onChange={(v) => setPriority(v as SupportTicketPriority)}
            />
          </Field>
        </div>
        <Field label="Where did this happen?">
          <input
            type="text"
            value={pageOrArea}
            onChange={(e) => setPageOrArea(e.target.value)}
            placeholder="e.g. Portal → Services, or the agent chat"
            className="w-full rounded-[8px] border border-hairline bg-surface-1 px-3 py-2 text-[13px] text-fg placeholder:text-fg-tertiary focus:border-primary focus:outline-none"
          />
        </Field>
        <Field label="Steps to reproduce">
          <textarea
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            placeholder="Walk us through what you did — we'll try the same thing on our end."
            rows={3}
            className="w-full resize-y rounded-[8px] border border-hairline bg-surface-1 px-3 py-2 text-[13px] text-fg placeholder:text-fg-tertiary focus:border-primary focus:outline-none"
          />
        </Field>
        <Field
          label="Attachments"
          hint="File upload coming soon — for now, paste a link or describe the screenshot in the description."
        >
          <div className="rounded-[8px] border border-dashed border-hairline-strong bg-surface-2 px-3 py-4 text-center text-[11px] text-fg-tertiary">
            Drag-and-drop coming soon. Mention any file you&rsquo;d like to share
            in the description and we&rsquo;ll follow up by email.
          </div>
        </Field>
      </Section>

      {error && (
        <div className="rounded-[8px] border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-[12px] text-status-danger">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!valid || submitting}
          className={cn(
            "rounded-[10px] px-4 py-2 text-[13px] font-medium transition-colors",
            valid && !submitting
              ? "bg-primary text-on-primary hover:bg-primary-hover"
              : "cursor-not-allowed bg-surface-3 text-fg-tertiary",
          )}
        >
          {submitting ? "Sending…" : "Send to the marina"}
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  required,
  children,
}: {
  title: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-[13px] font-medium text-fg">{title}</h3>
        {required && (
          <span className="text-[10px] uppercase tracking-wide text-fg-tertiary">
            Required
          </span>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
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
    <div>
      <label className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
        {required && <span className="text-status-danger">*</span>}
      </label>
      {children}
      {hint && (
        <p className="mt-1 text-[11px] text-fg-tertiary">{hint}</p>
      )}
    </div>
  );
}

function SelectChips<T extends string>({
  options,
  labels,
  value,
  onChange,
}: {
  options: T[];
  labels: Record<T, string>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
              active
                ? "border-primary/40 bg-primary-soft text-primary"
                : "border-hairline bg-surface-1 text-fg-muted hover:border-hairline-strong hover:bg-surface-2",
            )}
          >
            {labels[opt]}
          </button>
        );
      })}
    </div>
  );
}
