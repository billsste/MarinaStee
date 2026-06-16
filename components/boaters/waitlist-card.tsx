"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  MessageSquare,
  Anchor as AnchorIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import {
  confirmWaitlistInterest,
  useWaitlist,
} from "@/lib/client-store";
import type { Boater, WaitlistEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * WaitlistCard — renders on the boater's Overview tab when this person
 * has one or more active waitlist entries.
 *
 * Replaces the prior pattern where the waitlist UX lived entirely in a
 * modal sheet (`WaitlistApplicantSheet`) launched from the queue list.
 * With the row-click unified to go to /members/[id], the operator
 * needs at-a-glance waitlist context plus the most-used quick actions
 * (mark interest confirmed, send template, fire offer, convert to
 * slip) right here on the profile.
 *
 * For deep editing — slip-picker, composer with template substitution,
 * tag editor, decline history — there's an "Open full editor" button
 * that launches the existing WaitlistApplicantSheet inline. That sheet
 * stays around for now as the comprehensive editor; this card is the
 * profile-friendly summary surface.
 */

export function WaitlistCard({
  boater,
}: {
  boater: Boater;
}) {
  // Subscribe to the live waitlist store so status/position update
  // when the operator hits Convert-to-slip and the entry status flips.
  const entries = useWaitlist();
  const router = useRouter();

  // A single boater can be on the waitlist multiple times (e.g. they
  // want a second slip). Show every active entry; collapse hidden ones
  // (archived / converted / declined) since the profile shouldn't
  // surface dead requests.
  const active = React.useMemo(
    () =>
      entries.filter(
        (e) =>
          e.boater_id === boater.id &&
          e.status !== "converted" &&
          e.status !== "declined" &&
          e.status !== "withdrawn" &&
          e.status !== "expired" &&
          !e.archived_at,
      ),
    [entries, boater.id],
  );

  if (active.length === 0) return null;

  return (
    <div className="space-y-3">
      {active.map((entry) => (
        <WaitlistEntryRow
          key={entry.id}
          entry={entry}
          totalActive={
            entries.filter(
              (e) =>
                e.status === "pending" &&
                !e.archived_at &&
                (e.tenant_id ?? boater.tenant_id) ===
                  (entry.tenant_id ?? boater.tenant_id),
            ).length
          }
          position={positionInQueue(entries, entry)}
          onJumpToQueue={() =>
            router.push(`/services/waitlist?focus=${entry.id}`)
          }
        />
      ))}
    </div>
  );
}

function WaitlistEntryRow({
  entry,
  totalActive,
  position,
  onJumpToQueue,
}: {
  entry: WaitlistEntry;
  totalActive: number;
  position: number;
  onJumpToQueue: () => void;
}) {
  const interestConfirmed = !!entry.interest_confirmed_at;
  const status = entry.offer_status ?? entry.status;

  return (
    <div
      className={cn(
        "rounded-[12px] border border-hairline bg-surface-1 p-4",
        // Subtle warning tint when the entry is going cold so it draws
        // the operator's eye even when other Overview cards are loud.
        isStale(entry) && "border-status-warn/30 bg-status-warn/5",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10.5px] font-medium uppercase tracking-wide text-fg-tertiary">
            Waitlist entry
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={status} />
            {position > 0 && (
              // suppressHydrationWarning: position + totalActive are
              // derived from the client store, which can legitimately
              // differ from the SSR seed (e.g. a "+ New applicant"
              // added this session). The number is informational, not
              // load-bearing — let React adopt the client value silently
              // instead of throwing a hydration mismatch. Tracks the
              // same root cause as the layout.tsx pre-hydration script
              // fix shipped alongside this.
              <Badge tone="neutral" size="sm">
                <span suppressHydrationWarning>
                  #{position} of {totalActive}
                </span>
              </Badge>
            )}
            {interestConfirmed && (
              <Badge tone="ok" size="sm">
                <CheckCircle2 className="size-3" /> Interest confirmed
              </Badge>
            )}
            {isStale(entry) && !interestConfirmed && (
              <Badge tone="warn" size="sm">
                Going stale
              </Badge>
            )}
            {(entry.tags ?? []).map((t) => (
              <Badge key={t} tone="outline" size="sm">
                {t}
              </Badge>
            ))}
          </div>
          <div className="mt-2 text-[12.5px] text-fg-subtle">
            Added <LocalTime iso={entry.created_at} fmt="short_datetime" />
            {entry.last_contact_at && (
              <>
                {" · "}Last contact{" "}
                <LocalTime
                  iso={entry.last_contact_at}
                  fmt="short_datetime"
                />
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onJumpToQueue}
          className="flex items-center gap-1 rounded-[6px] px-2 py-1 text-[12px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
          aria-label="Open this entry in the waitlist queue"
        >
          Open in queue <ChevronRight className="size-3.5" />
        </button>
      </header>

      {/* Slip preferences — compact KV row */}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-4">
        <Field label="Cadence" value={cadenceLabel(entry.reservation_type)} />
        <Field
          label="LOA"
          value={formatInches(entry.loa_inches) ?? "—"}
        />
        <Field
          label="Beam"
          value={formatInches(entry.beam_inches) ?? "—"}
        />
        <Field
          label="Preferred dock"
          value={entry.preferred_dock ?? "Any"}
        />
        {entry.preferred_arrival && (
          <Field
            label="Arrival"
            value={<LocalTime iso={entry.preferred_arrival} fmt="short_date" />}
          />
        )}
        {entry.preferred_departure && (
          <Field
            label="Departure"
            value={
              <LocalTime iso={entry.preferred_departure} fmt="short_date" />
            }
          />
        )}
        {entry.decline_count != null && entry.decline_count > 0 && (
          <Field
            label="Declines"
            value={`${entry.decline_count}`}
            danger={entry.decline_count >= 3}
          />
        )}
      </dl>

      {entry.notes && (
        <p className="mt-3 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[12.5px] text-fg-subtle">
          {entry.notes}
        </p>
      )}

      {/* Action row — most-used quick actions inline. Deeper work
          (composer with templates, slip picker, deep edit) happens via
          "Open in queue" on the existing applicant sheet. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!interestConfirmed && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => confirmWaitlistInterest(entry.id, "Confirmed from profile")}
          >
            <CheckCircle2 className="size-3.5" /> Mark interest confirmed
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={onJumpToQueue}>
          <MessageSquare className="size-3.5" /> Send template
        </Button>
        <Button size="sm" variant="secondary" onClick={onJumpToQueue}>
          <AnchorIcon className="size-3.5" /> Convert to slip holder
        </Button>
      </div>

      {entry.interest_confirmation_note && (
        <p className="mt-3 flex items-start gap-2 rounded-[8px] border border-status-ok/30 bg-status-ok/10 px-3 py-2 text-[12.5px] text-status-ok">
          <CalendarClock className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <span className="font-medium">Confirmation note:</span>{" "}
            {entry.interest_confirmation_note}
          </span>
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  danger,
}: {
  label: string;
  value: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] uppercase tracking-wide text-fg-tertiary">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 truncate text-[13px]",
          danger ? "font-semibold text-status-danger" : "text-fg",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return <Badge tone="info" size="sm">In queue</Badge>;
    case "offered":
      return <Badge tone="warn" size="sm">Offer out</Badge>;
    case "ACCEPTED":
    case "DECLINED":
    case "EXPIRED":
    case "WITHDRAWN":
    case "PENDING":
      // Cascade offer_status enum values — uppercase per type spec.
      return <Badge tone="neutral" size="sm">{status.toLowerCase()}</Badge>;
    default:
      return <Badge tone="neutral" size="sm">{status}</Badge>;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers — small, no need for separate module
// ─────────────────────────────────────────────────────────────────────

const STALE_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function isStale(entry: WaitlistEntry): boolean {
  const anchor = entry.last_contact_at ?? entry.created_at;
  const ts = new Date(anchor).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts > STALE_THRESHOLD_MS;
}

function formatInches(inches?: number): string | undefined {
  if (inches == null) return undefined;
  const feet = Math.round(inches / 12);
  return `${feet}'`;
}

function cadenceLabel(c: WaitlistEntry["reservation_type"]): string {
  switch (c) {
    case "annual":
      return "Annual";
    case "seasonal":
      return "Seasonal";
    case "monthly":
      return "Monthly";
    case "transient":
      return "Transient";
  }
}

/** Best-effort position calc — # of pending entries ahead in queue
 *  (older created_at, same tenant). Returns 0 when the entry isn't
 *  pending (already offered / converted / etc.). */
function positionInQueue(
  all: WaitlistEntry[],
  entry: WaitlistEntry,
): number {
  if (entry.status !== "pending") return 0;
  const peers = all.filter(
    (e) =>
      e.status === "pending" &&
      !e.archived_at &&
      (e.tenant_id ?? "") === (entry.tenant_id ?? ""),
  );
  // Position = 1-based rank, oldest first.
  const sorted = [...peers].sort((a, b) =>
    a.created_at < b.created_at ? -1 : 1,
  );
  const idx = sorted.findIndex((e) => e.id === entry.id);
  return idx < 0 ? 0 : idx + 1;
}
