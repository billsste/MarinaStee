"use client";

import * as React from "react";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Phone,
  X,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { logWaitlistCall, useSlips } from "@/lib/client-store";
import { resolveSlipType } from "@/lib/slip-type-helpers";
import type { Slip, WaitlistEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * Log Call modal — replaces the parallel offer cascade with the actual
 * marina workflow: staff call the applicant, log what happened, move on.
 *
 * Three outcomes per call:
 *   - Accepted    → operator picks a slip (filtered to ones that match
 *                   the applicant's class + size preferences); the call
 *                   is logged with the chosen slip and the parent screen
 *                   can route to the slip-onboarding wizard if desired
 *                   (kept loose so this modal stays a "log" surface
 *                   rather than a wizard).
 *   - Declined    → operator picks: archive (with reason) or stay on
 *                   the list (decline_stay just refreshes last_contact_at
 *                   and increments decline_count).
 *   - The "notes" field captures the human context ("wants to wait
 *     until 2027", "spouse is the decision-maker, call back next week").
 */

type Outcome = "accept" | "decline_archive" | "decline_stay";

export function WaitlistLogCallModal({
  entry,
  open,
  onOpenChange,
  onAccepted,
}: {
  entry: WaitlistEntry | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Fired after a successful "accept" log so the parent can route to
   *  the slip-onboarding wizard pre-filled with applicant + slip. */
  onAccepted?: (args: { entryId: string; slipId: string }) => void;
}) {
  if (!open || !entry) return null;
  return (
    <WaitlistLogCallModalInner
      key={entry.id}
      entry={entry}
      onClose={() => onOpenChange(false)}
      onAccepted={onAccepted}
    />
  );
}

function WaitlistLogCallModalInner({
  entry,
  onClose,
  onAccepted,
}: {
  entry: WaitlistEntry;
  onClose: () => void;
  onAccepted?: (args: { entryId: string; slipId: string }) => void;
}) {
  const allSlips = useSlips();
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [notes, setNotes] = React.useState("");
  const [acceptedSlipId, setAcceptedSlipId] = React.useState<string>("");
  const [archiveReason, setArchiveReason] = React.useState<
    "non_responder" | "too_many_declines" | "withdrew" | "aged_out"
  >("withdrew");

  // Filter slips to ones that plausibly match the applicant's prefs.
  // Class match + size fit are the hard filters; dock preference is a
  // soft hint surfaced as a "preferred" badge.
  const matchingSlips = React.useMemo(() => {
    const wantedClasses = entry.preferred_classes ?? [];
    const loa = entry.loa_inches ?? 0;
    return allSlips
      .filter((s) => {
        if (wantedClasses.length > 0 && !wantedClasses.includes(s.slip_class))
          return false;
        if (loa > 0 && s.max_loa_inches < loa) return false;
        return true;
      })
      .sort((a, b) => {
        // Preferred dock first.
        const aPref = entry.preferred_dock === a.dock ? 0 : 1;
        const bPref = entry.preferred_dock === b.dock ? 0 : 1;
        if (aPref !== bPref) return aPref - bPref;
        return a.id.localeCompare(b.id);
      });
  }, [allSlips, entry]);

  function submit() {
    if (!outcome) return;
    const opts: Parameters<typeof logWaitlistCall>[2] = {
      notes,
    };
    if (outcome === "accept") {
      if (!acceptedSlipId) return; // gated
      opts.accepted_slip_id = acceptedSlipId;
    }
    if (outcome === "decline_archive") {
      opts.archive_reason = archiveReason;
    }
    const ok = logWaitlistCall(entry.id, outcome, opts);
    if (!ok) return;
    if (outcome === "accept" && onAccepted) {
      onAccepted({ entryId: entry.id, slipId: acceptedSlipId });
    }
    onClose();
  }

  const canSubmit =
    outcome === "decline_stay" ||
    outcome === "decline_archive" ||
    (outcome === "accept" && !!acceptedSlipId);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Log a call"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[14px] bg-surface-1 shadow-2xl">
        {/* Header */}
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-wide text-primary">
              <Phone className="size-3.5" />
              Log a call
            </div>
            <h2 className="display-tight mt-1 text-[18px] font-semibold text-fg">
              {displayName(entry)}
            </h2>
            <div className="mt-1 text-[12px] text-fg-subtle">
              {applicantSummary(entry)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-full text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-surface-2 px-5 py-4">
          {/* Outcome picker */}
          <div className="mb-4">
            <FieldLabel>Outcome</FieldLabel>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <OutcomeButton
                active={outcome === "accept"}
                onClick={() => setOutcome("accept")}
                tone="ok"
                icon={<CheckCircle2 className="size-4" />}
                label="Accepted"
                hint="Pick a slip → moves to slip onboarding"
              />
              <OutcomeButton
                active={outcome === "decline_stay"}
                onClick={() => setOutcome("decline_stay")}
                tone="info"
                icon={<CalendarClock className="size-4" />}
                label="Decline · stay on list"
                hint="Not ready yet; refresh contact"
              />
              <OutcomeButton
                active={outcome === "decline_archive"}
                onClick={() => setOutcome("decline_archive")}
                tone="danger"
                icon={<XCircle className="size-4" />}
                label="Decline · archive"
                hint="Withdrawing, archive entry"
              />
            </div>
          </div>

          {/* Outcome-specific extras */}
          {outcome === "accept" && (
            <div className="mb-4 rounded-[10px] border border-hairline bg-surface-1 p-3">
              <FieldLabel>Pick the slip they accepted</FieldLabel>
              {matchingSlips.length === 0 ? (
                <p className="text-[12.5px] text-fg-tertiary">
                  No slips match their preferences right now. You can still
                  log this outcome — the slip-onboarding wizard will let you
                  pick from the full inventory.
                </p>
              ) : (
                <div className="grid max-h-[200px] grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                  {matchingSlips.slice(0, 30).map((slip) => (
                    <button
                      key={slip.id}
                      type="button"
                      onClick={() => setAcceptedSlipId(slip.id)}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-[8px] border px-2.5 py-1.5 text-left text-[12.5px] transition-colors",
                        slip.id === acceptedSlipId
                          ? "border-primary/40 bg-primary-soft text-fg"
                          : "border-hairline bg-surface-1 text-fg-subtle hover:bg-surface-2",
                      )}
                    >
                      <span>
                        <span className="font-medium text-fg">{slip.id}</span>
                        <span className="ml-1.5 text-fg-tertiary tabular">
                          {Math.round(slip.max_loa_inches / 12)} ft ·{" "}
                          {slipTypeLabel(slip)}
                        </span>
                      </span>
                      {entry.preferred_dock === slip.dock && (
                        <Badge tone="info" size="sm">
                          Pref dock
                        </Badge>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {outcome === "decline_archive" && (
            <div className="mb-4 rounded-[10px] border border-hairline bg-surface-1 p-3">
              <FieldLabel>Archive reason</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { value: "withdrew", label: "Withdrew" },
                    { value: "non_responder", label: "Non-responder" },
                    { value: "too_many_declines", label: "Too many declines" },
                    { value: "aged_out", label: "Aged out" },
                  ] as const
                ).map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setArchiveReason(r.value)}
                    className={cn(
                      "rounded-[8px] border px-2.5 py-1 text-[12px] font-medium transition-colors",
                      archiveReason === r.value
                        ? "border-status-danger/40 bg-status-danger/10 text-status-danger"
                        : "border-hairline bg-surface-1 text-fg-subtle hover:bg-surface-2",
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Notes — always available */}
          <div>
            <FieldLabel>Call notes (optional)</FieldLabel>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                outcome === "accept"
                  ? "Pre-onboarding context, target start date, etc."
                  : outcome === "decline_stay"
                    ? "What did they say? ('Call back in spring', 'Spouse needs to weigh in', …)"
                    : outcome === "decline_archive"
                      ? "Reason in their own words"
                      : "What did the conversation cover?"
              }
              className="min-h-[80px] w-full resize-y rounded-[8px] border border-hairline bg-surface-1 p-2.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-2 border-t border-hairline bg-surface-1 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={!canSubmit}
          >
            {outcome === "accept" ? (
              <>
                Log call & route to onboarding <ArrowRight className="size-3.5" />
              </>
            ) : (
              <>
                Log call <ArrowRight className="size-3.5" />
              </>
            )}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function OutcomeButton({
  active,
  onClick,
  tone,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  tone: "ok" | "info" | "danger";
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  const toneCls =
    tone === "ok"
      ? "border-status-ok/30 bg-status-ok/10 text-status-ok"
      : tone === "info"
        ? "border-status-info/30 bg-status-info/10 text-status-info"
        : "border-status-danger/30 bg-status-danger/10 text-status-danger";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1 rounded-[10px] border p-3 text-left transition-colors",
        active
          ? toneCls
          : "border-hairline bg-surface-1 text-fg-subtle hover:bg-surface-2 hover:text-fg",
      )}
    >
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium">
        {icon}
        {label}
      </div>
      <div className="text-[11px] text-fg-tertiary">{hint}</div>
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[10.5px] font-medium uppercase tracking-wide text-fg-tertiary">
      {children}
    </label>
  );
}

function displayName(entry: WaitlistEntry): string {
  return entry.guest_name ?? "Applicant";
}

function applicantSummary(entry: WaitlistEntry): string {
  const parts: string[] = [];
  if (entry.loa_inches != null) {
    parts.push(`${Math.round(entry.loa_inches / 12)} ft`);
  }
  if (entry.preferred_dock) {
    parts.push(`prefers ${entry.preferred_dock}`);
  }
  if (entry.reservation_type) {
    parts.push(entry.reservation_type);
  }
  return parts.join(" · ") || "No preferences on file";
}

function slipTypeLabel(slip: Slip): string {
  const t = resolveSlipType(slip);
  return t?.short_label ?? slip.slip_class.replace("_", " ");
}
