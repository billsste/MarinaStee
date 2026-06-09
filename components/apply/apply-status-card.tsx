"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  Hourglass,
  Mail,
  Sailboat,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Application, ApplicationStatus } from "@/lib/types";

/*
 * Boater-facing status card for /apply/[token]. Renders status-appropriate
 * framing + next-step CTA so the applicant always knows what's coming.
 *
 * Per spec:
 *   pending       → "received; review in ~2 business days"
 *   under_review  → "marina is reviewing"
 *   approved      → "welcome aboard; check your email"
 *   declined      → "we can't accommodate; {internal_review_notes or generic}"
 *   waitlisted    → "at capacity; we'll reach out when something opens"
 *
 * The card is intentionally one component (not five) so the visual
 * cadence stays identical and the boater isn't surprised by status
 * transitions on refresh.
 */

const STATUS_META: Record<
  ApplicationStatus,
  {
    label: string;
    tone: "info" | "warn" | "ok" | "danger" | "neutral";
    icon: React.ComponentType<{ className?: string }>;
    headline: string;
    body: (a: Application) => string;
    cta?: { label: string; href: string };
  }
> = {
  pending: {
    label: "Received",
    tone: "info",
    icon: Hourglass,
    headline: "We received your application.",
    body: () =>
      "The marina is reviewing your submission — typically within 2 business days. We'll email you the moment there's an update.",
  },
  under_review: {
    label: "Under review",
    tone: "info",
    icon: Clock,
    headline: "The marina is reviewing your application.",
    body: () =>
      "Someone on our team is looking at your details. We'll be in touch soon — usually same-day once we open a file.",
  },
  approved: {
    label: "Approved",
    tone: "ok",
    icon: CheckCircle2,
    headline: "Welcome aboard.",
    body: () =>
      "Your application was approved. Check your email — onboarding details and your contract are on their way.",
  },
  declined: {
    label: "Declined",
    tone: "danger",
    icon: XCircle,
    headline: "Unfortunately we can't accommodate at this time.",
    body: (a) =>
      a.internal_review_notes && a.internal_review_notes.trim()
        ? a.internal_review_notes
        : "Thank you for considering us. If your situation changes (vessel, dates, slip class), we'd love to hear from you again.",
  },
  waitlisted: {
    label: "Waitlisted",
    tone: "warn",
    icon: Sailboat,
    headline: "We're at capacity right now.",
    body: () =>
      "We've added you to the waitlist for your preferred slip class. We'll reach out the moment something opens up — no need to check back.",
  },
};

export function ApplyStatusCard({ application }: { application: Application }) {
  const meta = STATUS_META[application.status];
  const Icon = meta.icon;
  return (
    <div className="rounded-[16px] border border-hairline bg-surface-1 p-6 shadow-sm sm:p-8">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
            Application {application.number}
          </div>
          <h2 className="mt-1 text-[22px] font-semibold text-fg display-tight">
            {meta.headline}
          </h2>
        </div>
        <Badge tone={meta.tone}>
          <Icon className="size-3" />
          {meta.label}
        </Badge>
      </div>

      <p className="mt-3 text-[14px] leading-relaxed text-fg-muted">
        {meta.body(application)}
      </p>

      <dl className="mt-6 grid grid-cols-1 gap-3 rounded-[10px] border border-hairline bg-surface-2/40 p-4 sm:grid-cols-2">
        <Row label="Applicant" value={`${application.applicant_first_name} ${application.applicant_last_name}`} />
        <Row label="Vessel" value={application.vessel_name} />
        <Row
          label="Make / Model"
          value={`${application.vessel_make} ${application.vessel_model}`}
        />
        <Row
          label="LOA"
          value={`${(application.vessel_loa_inches / 12).toFixed(1)} ft`}
        />
        {application.preferred_slip_class ? (
          <Row label="Preferred slip" value={application.preferred_slip_class} />
        ) : null}
        {application.desired_start_date ? (
          <Row label="Start date" value={application.desired_start_date} />
        ) : null}
      </dl>

      {application.status === "approved" ? (
        <div className="mt-6 flex items-center gap-2 rounded-[10px] border border-status-ok/30 bg-status-ok/10 px-4 py-3 text-[13px] text-status-ok">
          <Mail className="size-3.5" />
          <span>
            We sent a welcome email to{" "}
            <strong className="font-semibold">{application.applicant_email}</strong>.
          </span>
        </div>
      ) : null}

      <div className="mt-6 text-[12px] text-fg-tertiary">
        Submitted {new Date(application.submitted_at).toLocaleString()} ·{" "}
        <Link className="text-primary hover:underline" href="/apply">
          Apply for another boat
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[13px]">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="text-right text-fg">{value}</dd>
    </div>
  );
}
