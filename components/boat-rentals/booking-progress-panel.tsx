"use client";

import * as React from "react";
import {
  Check,
  Copy,
  Send,
  ExternalLink,
  Eye,
  CreditCard,
  Signature,
  Anchor as DockIcon,
  Sailboat,
  Link as LinkIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  addCommunication,
  mintBookingPickupToken,
} from "@/lib/client-store";
import type { BoatRental, Boater, Communication, RentalBoat } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * Live rail for an in-flight boat rental booking. Mirrors
 * OnboardingProgressPanel.
 *
 * Steps (6 — wider than the contract chain because rentals have
 * a check-out + return loop on top of the sign+deposit flow):
 *   1. Invite sent
 *   2. Customer opened link
 *   3. Agreement signed
 *   4. Deposit on file
 *   5. Checked out (dockhand handed over keys)
 *   6. Returned (boat back at the dock)
 *
 * Hides itself when status === "closed" — the booking is settled and
 * the rail isn't doing anything useful.
 */
export function BookingProgressPanel({
  booking,
  boat,
  boater,
}: {
  booking: BoatRental;
  boat: RentalBoat;
  boater: Boater | null;
}) {
  const [copied, setCopied] = React.useState(false);
  const [resentAt, setResentAt] = React.useState<string | null>(null);

  const ck = booking.checkin;
  const steps: {
    key: keyof BoatRental["checkin"];
    label: string;
    icon: React.ReactNode;
    ts?: string;
  }[] = [
    { key: "link_sent_at", label: "Invite sent", icon: <Send className="size-3" />, ts: ck.link_sent_at },
    { key: "link_viewed_at", label: "Customer opened link", icon: <Eye className="size-3" />, ts: ck.link_viewed_at },
    { key: "agreement_signed_at", label: "Agreement signed", icon: <Signature className="size-3" />, ts: ck.agreement_signed_at },
    { key: "deposit_authorized_at", label: "Deposit on file", icon: <CreditCard className="size-3" />, ts: ck.deposit_authorized_at },
    { key: "checked_out_at", label: "Checked out", icon: <Sailboat className="size-3" />, ts: ck.checked_out_at },
    { key: "returned_at", label: "Returned", icon: <DockIcon className="size-3" />, ts: ck.returned_at },
  ];
  const completed = steps.filter((s) => !!s.ts).length;
  const pct = Math.round((completed / steps.length) * 100);

  // Headline — what's the staffer waiting on?
  let waitingOn: { label: string; tone: "info" | "warn" | "ok" | "neutral" } = {
    label: "Awaiting customer",
    tone: "info",
  };
  if (!ck.link_viewed_at && ck.link_sent_at) waitingOn = { label: "Awaiting customer", tone: "info" };
  if (ck.link_viewed_at && !ck.agreement_signed_at) waitingOn = { label: "Reading agreement", tone: "info" };
  if (ck.agreement_signed_at && !ck.deposit_authorized_at) waitingOn = { label: "Awaiting deposit", tone: "warn" };
  if (ck.deposit_authorized_at && !ck.checked_out_at) waitingOn = { label: "Ready for pickup", tone: "ok" };
  if (ck.checked_out_at && !ck.returned_at) waitingOn = { label: "On the water", tone: "info" };
  if (ck.returned_at && booking.status !== "closed") waitingOn = { label: "Finalizing charges", tone: "warn" };
  if (booking.status === "closed") waitingOn = { label: "Closed", tone: "ok" };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const token = booking.pickup_token ?? "";
  const pickupUrl = token ? `${origin}/pickup/${token}` : "";

  async function copyLink() {
    if (!pickupUrl) return;
    try {
      await navigator.clipboard.writeText(pickupUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  function resend() {
    const t = mintBookingPickupToken(booking.id);
    if (!t) return;
    const url = `${origin}/pickup/${t}`;

    let commType: Communication["type"] = "email";
    let recipient = "";
    let displayFirst = "";
    if (boater) {
      commType = boater.communication_prefs.preferred_channel;
      recipient =
        commType === "email"
          ? (boater.primary_contact.email ?? "")
          : (boater.primary_contact.phone ?? "");
      displayFirst = boater.first_name;
    } else if (booking.patron_email) {
      commType = "email";
      recipient = booking.patron_email;
      displayFirst = (booking.patron_name ?? "").split(/\s+/)[0] ?? "there";
    } else if (booking.patron_phone) {
      commType = "sms";
      recipient = booking.patron_phone;
      displayFirst = (booking.patron_name ?? "").split(/\s+/)[0] ?? "there";
    }

    addCommunication({
      id: `cm_pickup_resend_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      boater_id: boater?.id ?? `walk_in:${booking.id}`,
      type: commType,
      direction: "outbound",
      sender_label: "Marina Stee",
      sender_is_system: true,
      recipient,
      subject: `Reminder: complete pickup for ${booking.number}`,
      body_preview: `Sign + add a card here: ${url}`,
      full_body:
        `Hi ${displayFirst},\n\n` +
        `Friendly nudge — finish your pickup steps for the ${boat.name} so we're ready when you arrive: ${url}\n\n` +
        `Marina Stee`,
      sent_at: new Date().toISOString(),
      status: "delivered",
      related_entity: { type: "work_order", id: booking.id },
    });
    setResentAt(new Date().toISOString());
    setTimeout(() => setResentAt(null), 2000);
  }

  if (booking.status === "closed") return null;

  return (
    <div className="rounded-[12px] border border-primary/30 bg-primary-soft/30">
      <div className="flex items-center justify-between border-b border-primary/20 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-medium text-fg">Booking in flight</h3>
          <Badge tone={waitingOn.tone} size="sm">
            {waitingOn.label}
          </Badge>
        </div>
        <span className="text-[11px] tabular text-fg-subtle">
          {completed} of {steps.length}
        </span>
      </div>

      <div className="space-y-3 p-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        <ul className="space-y-1.5">
          {steps.map((s) => {
            const done = !!s.ts;
            return (
              <li key={s.key} className="flex items-center gap-2.5 text-[12px]">
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border",
                    done
                      ? "border-status-ok bg-status-ok/10 text-status-ok"
                      : "border-hairline bg-surface-2 text-fg-tertiary"
                  )}
                >
                  {done ? <Check className="size-3" /> : s.icon}
                </span>
                <span className={cn("flex-1", done ? "text-fg" : "text-fg-subtle")}>
                  {s.label}
                </span>
                {done && s.ts && (
                  <span className="text-[10px] tabular text-fg-tertiary">
                    {new Date(s.ts).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {/* Action row */}
        {pickupUrl && booking.status !== "returned" && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              {copied ? (
                <>
                  <Check className="size-3 text-status-ok" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="size-3" />
                  Copy link
                </>
              )}
            </button>
            <button
              type="button"
              onClick={resend}
              className="inline-flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              {resentAt ? (
                <>
                  <Check className="size-3 text-status-ok" />
                  Sent
                </>
              ) : (
                <>
                  <Send className="size-3" />
                  Resend
                </>
              )}
            </button>
            <a
              href={pickupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              <ExternalLink className="size-3" />
              Open as customer
            </a>
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-fg-tertiary">
              <LinkIcon className="size-3" />
              <span className="hidden truncate sm:inline">
                {pickupUrl.replace(/^https?:\/\//, "")}
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
