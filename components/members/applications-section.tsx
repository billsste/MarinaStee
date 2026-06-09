"use client";

import * as React from "react";
import {
  AlertCircle,
  Calendar,
  Check,
  Inbox,
  Mail,
  Phone,
  Sailboat,
  Ship,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  approveApplication,
  declineApplication,
  markApplicationUnderReview,
  routeApplicationToWaitlist,
  useApplications,
} from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { Application, ApplicationStatus } from "@/lib/types";

/*
 * Operator queue for /members → Applications.
 *
 * Layout: dense table with applicant + vessel + slip preference + age.
 * Click a row to open a details drawer with all fields + the three
 * action buttons (Approve / Decline / Route-to-waitlist).
 *
 * Status filter chips sit above the list — pending + under_review by
 * default; operators can toggle to see approved/declined/waitlisted
 * history. Approval mints a Boater + Vessel via the client-store
 * mutation (which also drafts the welcome comm). Decline + route
 * each draft an outbound comm too.
 */

const STATUS_TONE: Record<
  ApplicationStatus,
  "info" | "ok" | "warn" | "danger" | "neutral"
> = {
  pending: "info",
  under_review: "info",
  approved: "ok",
  waitlisted: "warn",
  declined: "danger",
};

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  pending: "Pending",
  under_review: "Under review",
  approved: "Approved",
  waitlisted: "Waitlisted",
  declined: "Declined",
};

type FilterKey = "active" | "all" | ApplicationStatus;

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "pending", label: "Pending" },
  { key: "under_review", label: "Under review" },
  { key: "approved", label: "Approved" },
  { key: "declined", label: "Declined" },
  { key: "waitlisted", label: "Waitlisted" },
  { key: "all", label: "All" },
];

export function ApplicationsSection() {
  const [filter, setFilter] = React.useState<FilterKey>("active");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const all = useApplications();

  const rows = React.useMemo(() => {
    const list = (() => {
      if (filter === "all") return all;
      if (filter === "active")
        return all.filter(
          (a) => a.status === "pending" || a.status === "under_review",
        );
      return all.filter((a) => a.status === filter);
    })();
    // Newest submitted first — operators want the most recent applications
    // on top regardless of status filter.
    return [...list].sort((a, b) =>
      a.submitted_at < b.submitted_at ? 1 : -1,
    );
  }, [all, filter]);

  const counts = React.useMemo(() => {
    const c: Record<string, number> = {
      active: 0,
      pending: 0,
      under_review: 0,
      approved: 0,
      declined: 0,
      waitlisted: 0,
      all: all.length,
    };
    for (const a of all) {
      c[a.status] = (c[a.status] ?? 0) + 1;
      if (a.status === "pending" || a.status === "under_review") c.active += 1;
    }
    return c;
  }, [all]);

  const openRow = rows.find((r) => r.id === openId) ?? null;

  return (
    <section className="rounded-[12px] border border-hairline bg-surface-1">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="flex items-center gap-2">
          <Inbox className="size-3.5 text-fg-subtle" />
          <h2 className="text-[14px] font-semibold text-fg">Applications</h2>
          <Badge tone="neutral">{counts.active} active</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {FILTER_TABS.map((tab) => {
            const isActive = filter === tab.key;
            const n = counts[tab.key] ?? 0;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={cn(
                  "rounded-[6px] px-2 py-1 text-[12px] transition-colors",
                  isActive
                    ? "bg-surface-3 font-medium text-fg"
                    : "text-fg-subtle hover:bg-surface-2 hover:text-fg",
                )}
              >
                {tab.label}
                {n > 0 ? (
                  <span className="ml-1 text-[11px] text-fg-tertiary">
                    {n}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-[13px] text-fg-tertiary">
          No applications match this filter.
        </div>
      ) : (
        <ul className="divide-y divide-hairline">
          {rows.map((app) => (
            <ApplicationRow
              key={app.id}
              application={app}
              onClick={() => setOpenId(app.id)}
            />
          ))}
        </ul>
      )}

      {openRow ? (
        <ApplicationDrawer
          application={openRow}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </section>
  );
}

function ApplicationRow({
  application,
  onClick,
}: {
  application: Application;
  onClick: () => void;
}) {
  const days = Math.floor(
    (Date.now() - new Date(application.submitted_at).getTime()) /
      (1000 * 60 * 60 * 24),
  );
  const loaFt = (application.vessel_loa_inches / 12).toFixed(1);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-surface-2"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-fg">
              {application.applicant_first_name} {application.applicant_last_name}
            </span>
            <span className="text-[11px] text-fg-tertiary">
              {application.number}
            </span>
            <Badge tone={STATUS_TONE[application.status]} size="sm">
              {STATUS_LABEL[application.status]}
            </Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-fg-subtle">
            <span className="inline-flex items-center gap-1">
              <Ship className="size-3" />
              {application.vessel_name} · {loaFt} ft
            </span>
            {application.preferred_slip_class ? (
              <span className="inline-flex items-center gap-1">
                <Sailboat className="size-3" />
                {application.preferred_slip_class}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Mail className="size-3" />
              {application.applicant_email}
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right text-[11px] text-fg-tertiary">
          {days <= 0 ? "today" : days === 1 ? "1d ago" : `${days}d ago`}
        </div>
      </button>
    </li>
  );
}

function ApplicationDrawer({
  application,
  onClose,
}: {
  application: Application;
  onClose: () => void;
}) {
  const [declineNotes, setDeclineNotes] = React.useState(
    application.internal_review_notes ?? "",
  );
  const [declineMode, setDeclineMode] = React.useState(false);
  const canDecide =
    application.status === "pending" || application.status === "under_review";
  const loaFt = (application.vessel_loa_inches / 12).toFixed(1);

  // First view of a pending row auto-marks under_review — same as the
  // waitlist "operator opened the entry" pattern.
  React.useEffect(() => {
    if (application.status === "pending") {
      markApplicationUnderReview(application.id, "Marina Stee Operator");
    }
    // Run-once per application open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [application.id]);

  const handleApprove = () => {
    approveApplication(application.id, { reviewer: "Marina Stee Operator" });
    onClose();
  };

  const handleDecline = () => {
    declineApplication(application.id, {
      internal_review_notes: declineNotes.trim() || undefined,
      reviewer: "Marina Stee Operator",
    });
    onClose();
  };

  const handleRoute = () => {
    routeApplicationToWaitlist(application.id, {
      reviewer: "Marina Stee Operator",
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 py-4 sm:items-center sm:px-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[14px] border border-hairline bg-surface-1 shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
              {application.number}
            </div>
            <h3 className="mt-0.5 text-[16px] font-semibold text-fg">
              {application.applicant_first_name} {application.applicant_last_name}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 flex items-center gap-2">
            <Badge tone={STATUS_TONE[application.status]}>
              {STATUS_LABEL[application.status]}
            </Badge>
            <span className="text-[11px] text-fg-tertiary">
              Submitted {new Date(application.submitted_at).toLocaleString()}
            </span>
          </div>

          <Section title="Applicant" icon={Users}>
            <KV label="Email" value={application.applicant_email} />
            <KV label="Phone" value={application.applicant_phone} />
            {application.applicant_address ? (
              <KV label="Address" value={application.applicant_address} />
            ) : null}
          </Section>

          <Section title="Vessel" icon={Ship}>
            <KV label="Name" value={application.vessel_name} />
            <KV
              label="Make / Model"
              value={`${application.vessel_make} ${application.vessel_model}${application.vessel_year ? ` · ${application.vessel_year}` : ""}`}
            />
            <KV label="LOA" value={`${loaFt} ft`} />
            {application.vessel_beam_inches ? (
              <KV
                label="Beam"
                value={`${(application.vessel_beam_inches / 12).toFixed(1)} ft`}
              />
            ) : null}
            {application.vessel_draft_inches ? (
              <KV
                label="Draft"
                value={`${(application.vessel_draft_inches / 12).toFixed(1)} ft`}
              />
            ) : null}
          </Section>

          <Section title="Slip preferences" icon={Sailboat}>
            <KV
              label="Class"
              value={application.preferred_slip_class ?? "No preference"}
            />
            {application.preferred_dock ? (
              <KV label="Dock" value={application.preferred_dock} />
            ) : null}
            {application.desired_start_date ? (
              <KV label="Start date" value={application.desired_start_date} />
            ) : null}
          </Section>

          {application.notes ? (
            <Section title="Applicant note" icon={Mail}>
              <p className="text-[13px] leading-relaxed text-fg-muted">
                {application.notes}
              </p>
            </Section>
          ) : null}

          {application.internal_review_notes ? (
            <Section title="Internal review notes" icon={AlertCircle}>
              <p className="text-[13px] leading-relaxed text-fg-muted">
                {application.internal_review_notes}
              </p>
            </Section>
          ) : null}

          {(application.result_boater_id || application.result_waitlist_entry_id) && (
            <Section title="Outcome" icon={Check}>
              {application.result_boater_id ? (
                <KV label="Boater" value={application.result_boater_id} />
              ) : null}
              {application.result_waitlist_entry_id ? (
                <KV
                  label="Waitlist entry"
                  value={application.result_waitlist_entry_id}
                />
              ) : null}
              {application.reviewed_by ? (
                <KV label="Reviewed by" value={application.reviewed_by} />
              ) : null}
              {application.reviewed_at ? (
                <KV
                  label="Reviewed at"
                  value={new Date(application.reviewed_at).toLocaleString()}
                />
              ) : null}
            </Section>
          )}
        </div>

        {canDecide ? (
          <footer className="space-y-2 border-t border-hairline bg-surface-2/40 px-5 py-4">
            {declineMode ? (
              <div className="space-y-2">
                <label className="block text-[11px] font-medium text-fg-muted">
                  Decline reason (visible to the applicant)
                </label>
                <textarea
                  value={declineNotes}
                  onChange={(e) => setDeclineNotes(e.target.value)}
                  rows={2}
                  placeholder="Beam exceeds our uncovered slip max…"
                  className="w-full rounded-[8px] border border-hairline bg-surface-1 px-3 py-2 text-[13px] text-fg outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  autoFocus
                />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeclineMode(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={handleDecline}
                  >
                    Confirm decline
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeclineMode(true)}
                >
                  <X className="size-3.5" />
                  Decline
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleRoute}
                >
                  <Calendar className="size-3.5" />
                  Route to waitlist
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleApprove}
                >
                  <Check className="size-3.5" />
                  Approve
                </Button>
              </div>
            )}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        <Icon className="size-3" />
        {title}
      </div>
      <div className="space-y-1.5 rounded-[8px] border border-hairline bg-surface-2/40 p-3">
        {children}
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[13px]">
      <span className="text-fg-subtle">{label}</span>
      <span className="text-right text-fg">{value}</span>
    </div>
  );
}

// Silence unused-imports — Phone + Inbox are reserved for the next pass
// (per-row click-to-call + per-row inbox count badges).
void Phone;
