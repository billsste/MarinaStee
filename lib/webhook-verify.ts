/*
 * Webhook signature verification — Postmark + Twilio.
 *
 * Both providers POST events to URLs we register with them. Without
 * verification an attacker who learns the URL could forge "delivered"
 * receipts (poisoning delivery telemetry) or "bounced" events (silently
 * suppressing a recipient address). Each provider has its own scheme:
 *
 *   Postmark — assigns a static secret token PER webhook URL. The
 *     server echoes it back in an `X-Postmark-Webhook-Token` header on
 *     every request. We compare against POSTMARK_WEBHOOK_SECRET with a
 *     constant-time check. Postmark also surfaces this in their docs
 *     as "Basic Auth via custom header".
 *
 *   Twilio — signs every request with HMAC-SHA1 over the request URL
 *     concatenated with the sorted form params, signed using the
 *     account's AUTH TOKEN. Header: `X-Twilio-Signature`. We rebuild
 *     the signature locally and constant-time compare.
 *
 * Graceful degradation: when secrets aren't configured (dev/demo), the
 * verify functions return `false`. The route handlers respond 200 with
 * a no-op body in that case so the prototype doesn't break — but we
 * NEVER write to the DB without a verified signature.
 *
 * No external crypto package — Node 22 ships `node:crypto` which has
 * both `createHmac` (for Twilio) and `timingSafeEqual` (for Postmark).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

// ────────────────────────────────────────────────────────────
// Postmark
// ────────────────────────────────────────────────────────────

/**
 * Verify a Postmark webhook by comparing the token in the request
 * header against POSTMARK_WEBHOOK_SECRET. Postmark POSTs the token on
 * every request because they let YOU pick the value when you register
 * the webhook URL in their dashboard.
 *
 * Returns false when:
 *   - POSTMARK_WEBHOOK_SECRET is unset (no provider configured yet)
 *   - The header is missing
 *   - The header doesn't match the secret
 *
 * The route handler treats `false` as "drop on the floor, return 200"
 * — never throw, never 401, so Postmark doesn't retry-storm us when
 * we're misconfigured.
 */
export function verifyPostmarkSignature(headers: Headers): boolean {
  const expected = process.env.POSTMARK_WEBHOOK_SECRET;
  if (!expected) return false;

  const provided =
    headers.get("x-postmark-webhook-token") ??
    headers.get("X-Postmark-Webhook-Token");
  if (!provided) return false;

  return constantTimeEqualString(provided, expected);
}

/**
 * Verify a Postmark INBOUND email webhook. Same scheme as the outbound
 * delivery receipts (Postmark only has one token mechanism), but keyed
 * off a distinct env var — `POSTMARK_INBOUND_SECRET` — so an operator
 * can rotate the inbound webhook independently of delivery-receipt
 * webhooks (or shut down one without the other).
 *
 * Why a separate function rather than passing the secret in?
 *   - Symmetry with `verifyPostmarkSignature` — every Next.js route in
 *     the codebase calls one of these two and `process.env.X` lookup is
 *     the only difference.
 *   - The two URLs land in different Postmark dashboards (one
 *     "Servers → Webhooks" page per stream); rotating one shouldn't
 *     accidentally desync the other.
 *
 * Returns false when:
 *   - POSTMARK_INBOUND_SECRET is unset (no inbound server configured)
 *   - Header is missing
 *   - Token doesn't match
 *
 * The route handler treats `false` as "drop on the floor, return 200"
 * so Postmark doesn't retry-storm us when we're misconfigured. NEVER
 * write to the DB without a verified signature.
 */
export function verifyPostmarkInboundSignature(headers: Headers): boolean {
  const expected = process.env.POSTMARK_INBOUND_SECRET;
  if (!expected) return false;

  const provided =
    headers.get("x-postmark-webhook-token") ??
    headers.get("X-Postmark-Webhook-Token");
  if (!provided) return false;

  return constantTimeEqualString(provided, expected);
}

// ────────────────────────────────────────────────────────────
// Twilio
// ────────────────────────────────────────────────────────────

/**
 * Verify a Twilio status-callback per their docs:
 *
 *   1. Take the full request URL (including the query string).
 *   2. Append every form param sorted by name (key + value, no
 *      separator) to that URL string.
 *   3. HMAC-SHA1 the resulting string using the account auth token as
 *      the key.
 *   4. Base64-encode the digest and compare to X-Twilio-Signature.
 *
 * `authToken` is passed in by the caller — typically read from
 * `TWILIO_AUTH_TOKEN` env or (when per-tenant config lands) from the
 * marina row. When no token is supplied (or POSTMARK_WEBHOOK_SECRET-
 * style "no provider configured" path), return false.
 *
 * `url` MUST be the exact URL Twilio POSTed to — including https://
 * scheme and any query string we appended via StatusCallback (e.g.
 * `?mid=jhxxxxxx`). Off-by-one on the URL kills the HMAC match. The
 * caller pulls this from `req.url` after running it through any proxy
 * URL normalizer (forwarded-host, etc.).
 */
export function verifyTwilioSignature(
  url: string,
  params: URLSearchParams,
  headers: Headers,
  authToken: string | undefined,
): boolean {
  if (!authToken) return false;

  const provided =
    headers.get("x-twilio-signature") ?? headers.get("X-Twilio-Signature");
  if (!provided) return false;

  // Per Twilio docs: append each param as key + value (no separator)
  // in alphabetical key order. Encode/decode-stable because the form
  // came in URL-decoded via URLSearchParams.
  const keys = Array.from(params.keys()).sort();
  let payload = url;
  for (const k of keys) {
    const v = params.get(k) ?? "";
    payload += k + v;
  }

  const expected = createHmac("sha1", authToken)
    .update(payload, "utf8")
    .digest("base64");

  return constantTimeEqualString(provided, expected);
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Constant-time string comparison. Both sides are first encoded to
 * UTF-8 bytes; if the lengths differ we still run a dummy compare so
 * the timing signal doesn't leak length. timingSafeEqual throws on
 * mismatched byte lengths — we catch + return false.
 */
function constantTimeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Still run a comparison against a same-length zero buffer so an
    // attacker can't distinguish "wrong length" from "wrong bytes" by
    // measuring response time.
    const dummy = Buffer.alloc(aBuf.length);
    try {
      timingSafeEqual(aBuf, dummy);
    } catch {
      /* ignore */
    }
    return false;
  }
  try {
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}
