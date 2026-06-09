/*
 * Outbound communication router.
 *
 * Server-side helper that dispatches an email or SMS through whichever
 * provider is configured (Postmark for email, Twilio for SMS). When no
 * provider is configured — the prototype's default — it returns a fake
 * "delivered" result so the in-store comm log + UI stay functional.
 *
 * Two-phase delivery rule:
 *   1. Caller (lib/agent-actions.ts or any other mutation) builds the
 *      Communication row first and stores it locally with status "queued".
 *   2. Caller invokes deliverOutbound() with the same row's fields.
 *   3. deliverOutbound() returns { status, provider_id, error } — caller
 *      flips the local row's status field based on the result.
 *
 * The split exists so the UI sees a row instantly even when the provider
 * call is slow or fails — never a phantom send without a paper trail.
 *
 * This file is server-only (process.env access). Importing it from a
 * client component is a no-op fallback path.
 */

export interface OutboundEmail {
  to: string;
  from?: string;        // when omitted, uses MarinaProfile outbound_email_from_name
  subject: string;
  body: string;         // plain text; HTML wrapping can come later
}

export interface OutboundSms {
  to: string;
  from?: string;        // Twilio sender id; from MarinaProfile when omitted
  body: string;
}

export interface OutboundResult {
  status: "delivered" | "queued" | "failed";
  provider_id?: string; // postmark MessageID / twilio Sid
  provider?: "postmark" | "twilio" | "stub";
  error?: string;
}

// ──────────────────────────────────────────────────────────────
// Email
// ──────────────────────────────────────────────────────────────

const POSTMARK_API = "https://api.postmarkapp.com/email";

export async function sendEmail(msg: OutboundEmail): Promise<OutboundResult> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) {
    return stubDelivery();
  }
  const fromAddress =
    msg.from ?? process.env.POSTMARK_FROM_ADDRESS ?? "no-reply@marinastee.com";
  try {
    const res = await fetch(POSTMARK_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Postmark-Server-Token": token,
      },
      body: JSON.stringify({
        From: fromAddress,
        To: msg.to,
        Subject: msg.subject,
        TextBody: msg.body,
        MessageStream: process.env.POSTMARK_MESSAGE_STREAM ?? "outbound",
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        status: "failed",
        provider: "postmark",
        error: `Postmark ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as { MessageID?: string };
    return {
      status: "delivered",
      provider: "postmark",
      provider_id: data.MessageID,
    };
  } catch (err) {
    return {
      status: "failed",
      provider: "postmark",
      error: err instanceof Error ? err.message : "unknown postmark error",
    };
  }
}

// ──────────────────────────────────────────────────────────────
// SMS
// ──────────────────────────────────────────────────────────────

export async function sendSms(msg: OutboundSms): Promise<OutboundResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber =
    msg.from ?? process.env.TWILIO_FROM_NUMBER ?? "";
  if (!sid || !tok || !fromNumber) {
    return stubDelivery();
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const body = new URLSearchParams({
    To: msg.to,
    From: fromNumber,
    Body: msg.body,
  });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"),
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        status: "failed",
        provider: "twilio",
        error: `Twilio ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as { sid?: string };
    return {
      status: "delivered",
      provider: "twilio",
      provider_id: data.sid,
    };
  } catch (err) {
    return {
      status: "failed",
      provider: "twilio",
      error: err instanceof Error ? err.message : "unknown twilio error",
    };
  }
}

// ──────────────────────────────────────────────────────────────
// Fallback — no provider configured
//
// Returns "delivered" so the prototype's comm log keeps flowing. The
// difference vs a real send: provider === "stub" + no provider_id,
// which the UI can surface as a small "no delivery" indicator if it
// wants to.
// ──────────────────────────────────────────────────────────────

function stubDelivery(): OutboundResult {
  return { status: "delivered", provider: "stub" };
}

// ──────────────────────────────────────────────────────────────
// Convenience — dispatches based on channel + builds an audit-safe
// preview of the result.
// ──────────────────────────────────────────────────────────────

export async function dispatchOutbound(opts: {
  channel: "email" | "sms";
  to: string;
  subject?: string;
  body: string;
  from?: string;
}): Promise<OutboundResult> {
  if (opts.channel === "email") {
    return await sendEmail({
      to: opts.to,
      from: opts.from,
      subject: opts.subject ?? "(no subject)",
      body: opts.body,
    });
  }
  return await sendSms({ to: opts.to, from: opts.from, body: opts.body });
}
