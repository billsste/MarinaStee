/*
 * Twilio adapter — thin fetch-based wrapper around the Twilio REST API.
 *
 * Why no SDK: same reasoning as Postmark (lib/adapters/postmark.ts) —
 * the `twilio` npm package is heavy and tied to Node-only HTTP libs.
 * We only need POST /Accounts/<sid>/Messages.json with a basic-auth
 * header, so `fetch` works on Edge + Node uniformly.
 *
 * Env vars expected:
 *   TWILIO_ACCOUNT_SID    // canonical
 *   TWILIO_AUTH_TOKEN     // canonical
 *   TWILIO_FROM_NUMBER    // sender number in E.164 (+15555551234)
 *
 * Idempotency: Twilio doesn't expose an idempotency header on
 * /Messages.json, but every send is identified by the assigned `sid`
 * which the caller persists back to the comm row. To minimize the
 * blast radius of a retry, we pass the caller's `messageId` as a
 * `StatusCallback` query param so the eventual webhook can correlate.
 *
 * See lib/notification-dispatch.ts → dispatchCommunication.
 */

export interface TwilioSendArgs {
  /** Recipient phone in E.164 format (+15555551234). */
  to: string;
  /** From number override — defaults to TWILIO_FROM_NUMBER. */
  from?: string;
  /** Plain-text SMS body. Twilio segments at 160 chars; our preview cap. */
  body: string;
  /** Stable communications row id used for webhook correlation. */
  messageId: string;
  /** Per-tenant config override. Falls through to env. */
  config?: TwilioConfig;
}

export interface TwilioConfig {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  /**
   * Optional public URL Twilio POSTs delivery receipts to. We don't
   * have a receiver wired yet; leaving the field surfaced so the
   * webhook-ingestion follow-up wave doesn't need to touch this
   * adapter again.
   */
  statusCallbackUrl?: string;
}

export interface TwilioResult {
  providerMessageId?: string;
  status: "delivered" | "failed";
  error?: string;
}

const TWILIO_BASE = "https://api.twilio.com/2010-04-01";

/**
 * Resolve the effective Twilio config. All three of (sid, token, from)
 * must be present for a send to be possible — Twilio rejects auth
 * before it'd reject a missing from-number, but we want to surface a
 * single coherent "no_provider_configured" rather than a 401 error
 * masquerading as misconfiguration.
 */
export function resolveTwilioConfig(
  override?: TwilioConfig,
): Required<Pick<TwilioConfig, "accountSid" | "authToken" | "fromNumber">> & {
  statusCallbackUrl?: string;
} | null {
  const accountSid = override?.accountSid ?? process.env.TWILIO_ACCOUNT_SID;
  const authToken = override?.authToken ?? process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = override?.fromNumber ?? process.env.TWILIO_FROM_NUMBER;
  const statusCallbackUrl =
    override?.statusCallbackUrl ?? process.env.TWILIO_STATUS_CALLBACK_URL;
  if (!accountSid || !authToken || !fromNumber) return null;
  return { accountSid, authToken, fromNumber, statusCallbackUrl };
}

export async function sendViaTwilio(
  args: TwilioSendArgs,
): Promise<TwilioResult> {
  const cfg = resolveTwilioConfig(args.config);
  if (!cfg) {
    return {
      status: "failed",
      error: "no_provider_configured",
    };
  }

  const url = `${TWILIO_BASE}/Accounts/${cfg.accountSid}/Messages.json`;
  const params = new URLSearchParams({
    To: args.to,
    From: args.from ?? cfg.fromNumber,
    Body: args.body,
  });
  if (cfg.statusCallbackUrl) {
    // Append the marina message id so the eventual webhook ingest can
    // match a Twilio delivery receipt back to the comm row without a
    // table join. Encoded in the URL since Twilio replays the callback
    // URL verbatim.
    const sep = cfg.statusCallbackUrl.includes("?") ? "&" : "?";
    params.set(
      "StatusCallback",
      `${cfg.statusCallbackUrl}${sep}mid=${encodeURIComponent(args.messageId)}`,
    );
  }

  try {
    // `btoa` is universal (Node 22+, Edge, browser). `Buffer` is Node-
    // only and would crash this adapter on the Edge runtime.
    const auth = btoa(`${cfg.accountSid}:${cfg.authToken}`);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      // Hard 15s cap — without this the action sits open until Convex's
      // wall-clock limit kills it, leaving the comm row in `queued` with
      // no error_reason for the operator to debug.
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        status: "failed",
        error: `twilio_${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as { sid?: string };
    return {
      status: "delivered",
      providerMessageId: data.sid,
    };
  } catch (err) {
    // AbortError surfaces as DOMException with name "TimeoutError" /
    // "AbortError" depending on runtime. Stamp a stable error_reason
    // either way so dashboards can surface a recognizable code.
    if (
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError")
    ) {
      return {
        status: "failed",
        error: "twilio_timeout",
      };
    }
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "twilio_unknown_error",
    };
  }
}
