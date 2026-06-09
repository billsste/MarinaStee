/*
 * POST /api/webhooks/twilio — Twilio SMS status callback receiver.
 *
 * Twilio POSTs form-urlencoded status callbacks with a `MessageStatus`
 * field that transitions through: queued → sent → delivered, or
 * → failed / undelivered. Every callback also carries `MessageSid`
 * (provider id) and any custom query params we appended on the
 * StatusCallback URL — we append `?mid=<commId>` in
 * lib/adapters/twilio.ts so the receiver can match without a join
 * table.
 *
 * Auth: Twilio signs every request with HMAC-SHA1 of the request URL
 * + sorted form params, signed with the account auth token. The
 * signature is in the `X-Twilio-Signature` header. We rebuild it
 * locally via `verifyTwilioSignature` and constant-time compare.
 *
 * Twilio rotates auth tokens by account, NOT by webhook URL — so
 * unlike Postmark there's no per-URL secret. We sign-verify with the
 * SAME auth token the marina uses to SEND (env var
 * `TWILIO_AUTH_TOKEN`, or per-tenant override if we can identify the
 * tenant before verification). For the prototype we use the env-var
 * token; a follow-up that supports per-tenant numbers needs to
 * resolve the tenant FIRST (via the `mid` lookup) and then verify.
 *
 * Failure modes — ALL return 200 to suppress Twilio retry-storms:
 *   - missing token in env → no-op 200 (dev/demo)
 *   - bad signature        → no-op 200 + log warn
 *   - missing mid          → no-op 200
 *   - row not found        → no-op 200
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchAction } from "convex/nextjs";
import { anyApi } from "convex/server";
import { verifyTwilioSignature } from "@/lib/webhook-verify";

// `anyApi` is the untyped function-reference proxy — same pattern the
// rest of the app uses for Convex calls so we don't need to wait for
// `npx convex dev` to write _generated/api.d.ts to typecheck. Once
// the codegen lands a follow-up can swap to the typed `api` import.

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Twilio POSTs application/x-www-form-urlencoded — read the raw
  // body, parse into URLSearchParams, and use that for both signature
  // verification AND payload extraction. Re-parsing twice would risk
  // diverging interpretations (encoding edge cases).
  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);

  // The verification URL must be the EXACT URL Twilio POSTed to,
  // including https:// scheme + any query string. Next.js exposes
  // this via `req.url`, but behind Cloudflare/Nginx the request may
  // arrive as http://; honor `x-forwarded-proto` when present.
  const url = resolveRequestUrl(req);

  // Per-tenant auth tokens are honored only when we can resolve the
  // tenant BEFORE verification — which we can't, since the lookup
  // key (`mid`) is inside the verified payload. Use the env-var
  // token. Marinas that bring their own Twilio account either share
  // the auth token with the env (deploy-time secret rotation) or
  // accept that the receiver still verifies against the platform
  // token. Long-term: register a per-marina webhook URL so the URL
  // itself identifies the tenant.
  const authToken =
    process.env.TWILIO_WEBHOOK_SECRET ?? process.env.TWILIO_AUTH_TOKEN;

  if (!verifyTwilioSignature(url, params, req.headers, authToken)) {
    return NextResponse.json({ ok: true, ignored: "unverified" });
  }

  // `mid` is the Convex communications._id we threaded onto the
  // StatusCallback URL. Without it we don't know which row to stamp.
  const commId = params.get("mid");
  if (!commId) {
    return NextResponse.json({ ok: true, ignored: "no_mid" });
  }

  const messageStatus = params.get("MessageStatus") ?? "unknown";
  const messageSid = params.get("MessageSid") ?? undefined;
  const errorCode = params.get("ErrorCode") ?? undefined;
  const errorMessage = params.get("ErrorMessage") ?? undefined;

  // Map Twilio MessageStatus → our discriminator. Twilio's terminal
  // states are: delivered (success), failed/undelivered (terminal
  // failure). Everything else is an intermediate state we record as
  // "other" so the timeline shows the progression without us
  // pretending the send succeeded.
  let kind:
    | "delivered"
    | "bounced"
    | "opened"
    | "clicked"
    | "failed"
    | "other";
  switch (messageStatus) {
    case "delivered":
      kind = "delivered";
      break;
    case "undelivered":
      // Treat undelivered as a bounce-equivalent — the carrier
      // refused the recipient. Operators should prune the number.
      kind = "bounced";
      break;
    case "failed":
      kind = "failed";
      break;
    case "queued":
    case "sending":
    case "sent":
    case "receiving":
    case "received":
    case "accepted":
    case "scheduled":
    case "read":
    default:
      kind = "other";
      break;
  }

  const reason = errorCode
    ? `twilio_${errorCode}${errorMessage ? `: ${errorMessage}` : ""}`
    : errorMessage;

  try {
    await fetchAction(anyApi.communications.ingestWebhookEvent, {
      commId,
      kind,
      eventLabel: `MessageStatus.${messageStatus}`,
      occurredAt: new Date().toISOString(),
      reason,
      providerMessageId: messageSid,
    });
  } catch (err) {
    console.warn(
      "[twilio-webhook] ingest failed:",
      err instanceof Error ? err.message : err,
    );
  }

  return NextResponse.json({ ok: true });
}

/**
 * Reconstruct the URL Twilio originally POSTed to.
 *
 * SECURITY: prefer `PUBLIC_BASE_URL` env (the operator-configured
 * canonical origin) over attacker-controlled `X-Forwarded-*` headers.
 * Twilio's signature is computed over the public URL Twilio knows
 * about — that's the StatusCallback URL configured in our Twilio
 * console, NOT whatever an attacker can put in a forwarded header.
 *
 * Without this gate, an attacker can spoof a request:
 *   POST /api/webhooks/twilio
 *   X-Forwarded-Host: attacker.example
 *   X-Twilio-Signature: <HMAC over `https://attacker.example/...`>
 *
 * Reconstructing from forwarded headers would build the exact URL the
 * attacker signed, so verification passes. Trusting `PUBLIC_BASE_URL`
 * forces verification against our REAL public origin — the attacker
 * would have to know the auth token to forge a valid signature, which
 * defeats the same-secret-for-send-and-verify problem.
 *
 * Falls back to forwarded headers only when `PUBLIC_BASE_URL` is unset
 * (prototype / dev). Documented in .env.example.
 */
function resolveRequestUrl(req: NextRequest): string {
  const publicBase = process.env.PUBLIC_BASE_URL;
  const path = req.nextUrl.pathname + req.nextUrl.search;
  if (publicBase) {
    return `${publicBase.replace(/\/$/, "")}${path}`;
  }
  // Dev / prototype fallback. NOT safe for production — set
  // PUBLIC_BASE_URL when going live.
  const proto =
    req.headers.get("x-forwarded-proto") ??
    new URL(req.url).protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    return `${proto}://${host}${path}`;
  }
  return req.url;
}
