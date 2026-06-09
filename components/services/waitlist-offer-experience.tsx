"use client";

import * as React from "react";
import Link from "next/link";
import { Anchor, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  acceptWaitlistOffer,
  declineWaitlistOffer,
  getWaitlistByOfferToken,
} from "@/lib/client-store";
import type { SlipClass, WaitlistEntry } from "@/lib/types";

/*
 * Public landing page client.
 *
 * Boater clicks the link in the auto-offer comm → lands here. Three
 * surfaces:
 *
 *   1. Offer pending → primary "Accept" + ghost "Decline" + countdown
 *   2. Offer post-action (accepted / declined) → confirmation card
 *   3. Offer expired / not found → explainer + back-to-waitlist note
 *
 * SSR delivers ssrEntry from the static WAITLIST seed; the client
 * re-resolves once mounted to catch the in-session firing path (a
 * just-minted offer lives in client-store, not in the seed).
 */

type Outcome = "accepted" | "declined" | null;

export function WaitlistOfferExperience({
  token,
  ssrEntry,
  firstName,
  slipLabel,
  slipMaxLoaInches,
  slipClass,
}: {
  token: string;
  ssrEntry: WaitlistEntry | null;
  firstName?: string;
  slipLabel?: string;
  slipMaxLoaInches?: number;
  slipClass?: SlipClass;
}) {
  const [entry, setEntry] = React.useState<WaitlistEntry | null>(ssrEntry);
  const [outcome, setOutcome] = React.useState<Outcome>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    // Re-resolve once mounted — an in-session fired offer only lives
    // in client-store and won't be in the SSR seed.
    const live = getWaitlistByOfferToken(token);
    if (live) setEntry(live);
  }, [token]);

  // BUG FIX: countdown chip used to freeze because `remaining` was a
  // useMemo([entry]) that only recomputed when the entry prop changed.
  // A boater sitting on the page would see "2h 14m left" stay frozen,
  // and the "expired" guard wouldn't fire on the render that crossed
  // the boundary. Add a 30s tick so both `expired` and `remaining`
  // re-evaluate live.
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!entry?.offer_expires_at) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [entry?.offer_expires_at]);

  const expired = React.useMemo(() => {
    if (!entry?.offer_expires_at) return false;
    return new Date(entry.offer_expires_at).getTime() < Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, tick]);

  const remaining = React.useMemo(() => {
    if (!entry?.offer_expires_at) return null;
    const ms = new Date(entry.offer_expires_at).getTime() - Date.now();
    if (ms <= 0) return "expired";
    const hrs = Math.floor(ms / 3_600_000);
    if (hrs >= 24) return `${Math.floor(hrs / 24)} day${Math.floor(hrs / 24) === 1 ? "" : "s"} ${hrs % 24}h left`;
    const mins = Math.floor((ms % 3_600_000) / 60_000);
    return `${hrs}h ${mins}m left`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, tick]);

  function handleAccept() {
    setSubmitting(true);
    setError(null);
    const result = acceptWaitlistOffer(token);
    setSubmitting(false);
    if (!result) {
      setError(
        "This offer can't be accepted right now — it may have expired or already been responded to.",
      );
      return;
    }
    setOutcome("accepted");
  }

  function handleDecline() {
    setSubmitting(true);
    setError(null);
    const result = declineWaitlistOffer(token, { auto_advance: true });
    setSubmitting(false);
    if (!result) {
      setError(
        "This offer can't be declined right now — it may have expired or already been responded to.",
      );
      return;
    }
    setOutcome("declined");
  }

  return (
    <main className="min-h-screen bg-surface-base px-4 pt-12 pb-16">
      <div className="mx-auto w-full max-w-[520px]">
        <div className="mb-6 flex items-center gap-2 text-fg-tertiary">
          <Anchor className="size-4" />
          <span className="text-[12px] font-medium uppercase tracking-wider">
            Marina Stee
          </span>
        </div>

        {!entry && <NotFound />}

        {entry && expired && outcome === null && (
          <ExpiredCard slipLabel={slipLabel} />
        )}

        {entry && !expired && outcome === null && entry.offer_status === "pending" && (
          <PendingCard
            firstName={firstName ?? entry.guest_name?.split(",")[1]?.trim() ?? "there"}
            slipLabel={slipLabel ?? entry.offered_slip_id ?? "—"}
            slipMaxLoaInches={slipMaxLoaInches}
            slipClass={slipClass}
            remaining={remaining ?? ""}
            submitting={submitting}
            error={error}
            onAccept={handleAccept}
            onDecline={handleDecline}
          />
        )}

        {entry && entry.offer_status === "accepted" && outcome !== "declined" && (
          <ConfirmationCard
            kind="accepted"
            firstName={firstName ?? entry.guest_name?.split(",")[1]?.trim() ?? "there"}
            slipLabel={slipLabel ?? entry.offered_slip_id ?? "—"}
          />
        )}
        {entry && entry.offer_status === "declined" && outcome !== "accepted" && (
          <ConfirmationCard
            kind="declined"
            firstName={firstName ?? entry.guest_name?.split(",")[1]?.trim() ?? "there"}
            slipLabel={slipLabel ?? entry.offered_slip_id ?? "—"}
          />
        )}
      </div>
    </main>
  );
}

function PendingCard({
  firstName,
  slipLabel,
  slipMaxLoaInches,
  slipClass,
  remaining,
  submitting,
  error,
  onAccept,
  onDecline,
}: {
  firstName: string;
  slipLabel: string;
  slipMaxLoaInches?: number;
  slipClass?: string;
  remaining: string;
  submitting: boolean;
  error: string | null;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="rounded-[16px] border border-hairline bg-surface-1 p-6 shadow-sm">
      <h1 className="text-[22px] font-semibold tracking-tight text-fg">
        Hi {firstName} — a slip just opened up.
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">
        You're at the top of the waitlist for a slip that matches what you
        asked for. Accept and we'll start your contract; decline and you stay
        on the queue for the next opening.
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-3 rounded-[12px] border border-hairline bg-surface-2 p-4 text-[13px]">
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-fg-tertiary">
            Slip
          </dt>
          <dd className="mt-0.5 font-medium text-fg">{slipLabel}</dd>
        </div>
        {slipMaxLoaInches && (
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-fg-tertiary">
              Max LOA
            </dt>
            <dd className="mt-0.5 font-medium text-fg">
              {Math.round(slipMaxLoaInches / 12)}'
            </dd>
          </div>
        )}
        {slipClass && (
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-fg-tertiary">
              Class
            </dt>
            <dd className="mt-0.5 font-medium text-fg">{slipClass}</dd>
          </div>
        )}
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-fg-tertiary">
            Window
          </dt>
          <dd className="mt-0.5 inline-flex items-center gap-1 font-medium text-status-warn">
            <Clock className="size-3" />
            {remaining}
          </dd>
        </div>
      </dl>

      {error && (
        <div className="mt-4 rounded-[8px] border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-[12px] text-status-danger">
          {error}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Button
          variant="primary"
          size="lg"
          className="flex-1"
          onClick={onAccept}
          disabled={submitting}
        >
          <CheckCircle2 className="size-4" />
          Accept — start contract
        </Button>
        <Button
          variant="secondary"
          size="lg"
          className="flex-1"
          onClick={onDecline}
          disabled={submitting}
        >
          <XCircle className="size-4" />
          Decline — stay on waitlist
        </Button>
      </div>

      <p className="mt-4 text-center text-[11px] text-fg-tertiary">
        Questions? Reply to the email or text we sent — a real person will
        answer.
      </p>
    </div>
  );
}

function ConfirmationCard({
  kind,
  firstName,
  slipLabel,
}: {
  kind: "accepted" | "declined";
  firstName: string;
  slipLabel: string;
}) {
  if (kind === "accepted") {
    return (
      <div className="rounded-[16px] border border-status-ok/30 bg-status-ok/[0.05] p-6">
        <div className="mb-3 inline-flex size-10 items-center justify-center rounded-full bg-status-ok/15 text-status-ok">
          <CheckCircle2 className="size-5" />
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight text-fg">
          You're in, {firstName}.
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">
          Slip <span className="font-medium text-fg">{slipLabel}</span> is
          yours. Your contract is drafting now — we'll text/email you a link
          to review and sign within the next few minutes. Two steps from
          there: sign + add a card on file.
        </p>
        <p className="mt-4 text-[12px] text-fg-tertiary">
          Tip: keep this tab open — we'll redirect to the onboarding page
          once the signature link is ready.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-[16px] border border-hairline bg-surface-1 p-6">
      <div className="mb-3 inline-flex size-10 items-center justify-center rounded-full bg-surface-2 text-fg-muted">
        <XCircle className="size-5" />
      </div>
      <h1 className="text-[22px] font-semibold tracking-tight text-fg">
        Got it, {firstName}.
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">
        We've passed on slip <span className="font-medium text-fg">{slipLabel}</span>{" "}
        and rolled the offer to the next person in line. You'll stay on the
        waitlist for future openings — we'll reach out the next time
        something matches.
      </p>
    </div>
  );
}

function ExpiredCard({ slipLabel }: { slipLabel?: string }) {
  return (
    <div className="rounded-[16px] border border-hairline bg-surface-1 p-6">
      <div className="mb-3 inline-flex size-10 items-center justify-center rounded-full bg-surface-2 text-fg-muted">
        <Clock className="size-5" />
      </div>
      <h1 className="text-[22px] font-semibold tracking-tight text-fg">
        This offer has expired.
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">
        {slipLabel
          ? `Slip ${slipLabel} was offered to you, but the 48-hour window has closed.`
          : "The 48-hour window for this offer has closed."}{" "}
        We've rolled the offer to the next person on the waitlist. You're
        still on the queue — we'll reach out next time something matches.
      </p>
    </div>
  );
}

function NotFound() {
  return (
    <div className="rounded-[16px] border border-hairline bg-surface-1 p-6">
      <h1 className="text-[22px] font-semibold tracking-tight text-fg">
        We can't find that offer.
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">
        The link may have expired or been replaced by a newer offer. If you
        think this is a mistake, reply to the email or text we sent and
        we'll sort it out.
      </p>
      <p className="mt-4 text-[12px] text-fg-tertiary">
        <Link href="/" className="text-primary hover:underline">
          ← Back to Marina Stee
        </Link>
      </p>
    </div>
  );
}
