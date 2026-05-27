"use client";

import * as React from "react";
import {
  Send,
  CheckCheck,
  ExternalLink,
  Copy,
  Check,
  RotateCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BOATERS } from "@/lib/mock-data";
import { addCommunication } from "@/lib/client-store";
import { formatPhone } from "@/lib/utils";
import type { Communication, Quote } from "@/lib/types";

function nextCommId() {
  return `cm_sig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/*
 * Signature panel for a work-order quote.
 *
 * "Send for signature" generates a token (if missing), flips the quote to
 * sent locally, copies the signing link to clipboard, and dispatches a
 * boater Communication so the timeline reflects the send.
 *
 * State is component-local — quotes aren't in the client store yet, so
 * the transition is visible in this session but doesn't persist across
 * reloads. Good enough for the prototype demo loop.
 */
export function SignaturePanel({ quote: initialQuote }: { quote: Quote }) {
  const [quote, setQuote] = React.useState<Quote>(initialQuote);
  const [copied, setCopied] = React.useState(false);

  const signingUrl = React.useMemo(() => {
    if (!quote.signature_token) return null;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/sign/${quote.signature_token}`;
  }, [quote.signature_token]);

  const boater = BOATERS.find((b) => b.id === quote.boater_id);

  function generateToken() {
    return `tok_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  }

  function copyLink() {
    if (!signingUrl) return;
    void navigator.clipboard?.writeText(signingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleSend() {
    const token = quote.signature_token ?? generateToken();
    const now = new Date().toISOString();
    const updated: Quote = {
      ...quote,
      status: "sent",
      signature_token: token,
      sent_at: now,
    };
    setQuote(updated);

    // Drop a comm event on the boater timeline so the send shows up in
    // their Comms tab + the dashboard activity feed.
    if (boater) {
      const channel = boater.communication_prefs.preferred_channel;
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const url = `${origin}/sign/${token}`;
      const commType: Communication["type"] = channel;
      const recipient =
        commType === "email"
          ? (boater.primary_contact.email ?? "")
          : (boater.primary_contact.phone ?? "");
      addCommunication({
        id: nextCommId(),
        boater_id: boater.id,
        type: commType,
        direction: "outbound",
        sender_label: "Marina Stee",
        sender_is_system: true,
        recipient,
        subject: `Quote ${quote.number} — please sign`,
        body_preview: `Sign here: ${url}`,
        sent_at: now,
        status: "delivered",
        related_entity: { type: "work_order", id: quote.work_order_id },
      });
    }

    // Auto-copy the link so staff can paste it into chat / email if needed.
    setTimeout(() => {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard.writeText(`${typeof window !== "undefined" ? window.location.origin : ""}/sign/${token}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    }, 0);
  }

  function handleResend() {
    if (!boater || !signingUrl) return;
    const now = new Date().toISOString();
    const channel = boater.communication_prefs.preferred_channel;
    const commType: Communication["type"] = channel;
    const recipient =
      commType === "email"
        ? (boater.primary_contact.email ?? "")
        : (boater.primary_contact.phone ?? "");
    addCommunication({
      id: nextCommId(),
      boater_id: boater.id,
      type: commType,
      direction: "outbound",
      sender_label: "Marina Stee",
      sender_is_system: true,
      recipient,
      subject: `Reminder: Quote ${quote.number} — please sign`,
      body_preview: `Reminder — sign here: ${signingUrl}`,
      sent_at: now,
      status: "delivered",
      related_entity: { type: "work_order", id: quote.work_order_id },
    });
    setQuote({ ...quote, sent_at: now });
  }

  // ── Signed ────────────────────────────────────────────────
  if (quote.signed_at) {
    return (
      <div className="rounded-[12px] border border-status-ok/30 bg-status-ok/[0.04] p-4">
        <div className="mb-2 flex items-center gap-2">
          <CheckCheck className="size-4 text-status-ok" />
          <h3 className="text-[13px] font-medium text-fg">Signed</h3>
          <Badge tone="ok" size="sm">Authorized</Badge>
        </div>
        <div className="space-y-1 text-[12px] text-fg-subtle">
          <div>
            <span className="text-fg-tertiary">Signer:</span>{" "}
            <span className="font-medium text-fg">{quote.signer_name ?? "—"}</span>
          </div>
          <div>
            <span className="text-fg-tertiary">Signed:</span>{" "}
            <span className="text-fg">{new Date(quote.signed_at).toLocaleString()}</span>
          </div>
          {quote.signature_token && (
            <div>
              <span className="text-fg-tertiary">Audit token:</span>{" "}
              <span className="font-mono text-[11px] text-fg">{quote.signature_token}</span>
            </div>
          )}
        </div>
        {quote.signature_data_url ? (
          <div className="mt-3 rounded-[8px] border border-hairline bg-surface-1 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={quote.signature_data_url} alt="Signature" className="max-h-24 object-contain" />
          </div>
        ) : (
          <div className="mt-3 rounded-[8px] border border-dashed border-hairline bg-surface-1 px-3 py-4 text-center text-[11px] italic text-fg-tertiary">
            Signature image stored at /signatures/{quote.signature_token}.png
          </div>
        )}
      </div>
    );
  }

  // ── Sent or viewed ────────────────────────────────────────
  if ((quote.status === "sent" || quote.status === "viewed") && signingUrl) {
    return (
      <div className="rounded-[12px] border border-status-info/30 bg-status-info/[0.05] p-4">
        <div className="mb-2 flex items-center gap-2">
          <Send className="size-4 text-status-info" />
          <h3 className="text-[13px] font-medium text-fg">Sent for signature</h3>
          <Badge tone="info" size="sm">{quote.status}</Badge>
        </div>
        <div className="space-y-1 text-[12px] text-fg-subtle">
          {quote.sent_at && (
            <div>
              <span className="text-fg-tertiary">Sent:</span>{" "}
              <span className="text-fg">{new Date(quote.sent_at).toLocaleString()}</span>
              {boater && (
                <>
                  {" "}<span className="text-fg-tertiary">to</span>{" "}
                  <span className="text-fg">
                    {boater.communication_prefs.preferred_channel === "email"
                      ? boater.primary_contact.email
                      : formatPhone(boater.primary_contact.phone)}
                  </span>
                </>
              )}
            </div>
          )}
          {quote.viewed_at && (
            <div>
              <span className="text-fg-tertiary">Viewed:</span>{" "}
              <span className="text-fg">{new Date(quote.viewed_at).toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Signing link surface — copy / open as boater */}
        <div className="mt-3 rounded-[8px] border border-hairline bg-surface-1 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">Signing link</div>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 truncate font-mono text-[11px] text-fg-subtle">
              {signingUrl}
            </code>
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-subtle hover:bg-surface-2"
              aria-label="Copy signing link"
            >
              {copied ? (
                <>
                  <Check className="size-3 text-status-ok" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="size-3" />
                  Copy
                </>
              )}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleResend}>
            <RotateCw className="size-3.5" />
            Resend
          </Button>
          <a
            href={signingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-hairline bg-surface-1 px-2.5 py-1 text-[12px] text-fg-subtle hover:bg-surface-2"
          >
            <ExternalLink className="size-3.5" />
            Open as boater
          </a>
        </div>
      </div>
    );
  }

  // ── Awaiting (draft, never sent) ──────────────────────────
  return (
    <div className="rounded-[12px] border border-dashed border-hairline-strong bg-surface-1 p-4 text-center">
      <h3 className="text-[13px] font-medium text-fg">Awaiting signature</h3>
      <p className="mt-1 text-[12px] text-fg-subtle">
        Send this quote to the boater to authorize the work and charges.
      </p>
      <Button variant="primary" size="sm" className="mt-3" onClick={handleSend}>
        <Send className="size-3.5" />
        Send for signature
      </Button>
    </div>
  );
}
