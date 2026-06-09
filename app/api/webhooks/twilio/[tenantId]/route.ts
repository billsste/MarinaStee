/*
 * POST /api/webhooks/twilio/[tenantId]
 *
 * Per-tenant Twilio webhook receiver — the PRODUCTION pattern.
 *
 * Same threat model as the per-tenant Postmark route: workspace-wide
 * URLs let a tenant with valid auth fire forged status callbacks with
 * another tenant's commId in the `mid` param. Per-tenant URLs let the
 * handler reject mismatched comm rows before patching.
 *
 * Per-tenant signature verification: when the marina has set their own
 * `twilio_auth_token` on the `marinas` row (via /settings/marina-profile
 * → Notification providers), we resolve it via Convex and verify with
 * THAT token. Falls back to the workspace `TWILIO_AUTH_TOKEN` when the
 * marina hasn't configured per-tenant creds.
 *
 * Cross-tenant defense lives in `convex/communications.ts → ingestWebhookEvent`
 * via the `expectedTenantId` arg.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchAction, fetchQuery } from "convex/nextjs";
import { anyApi } from "convex/server";
import { verifyTwilioSignature } from "@/lib/webhook-verify";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params: routeParams }: { params: Promise<{ tenantId: string }> },
) {
  const { tenantId } = await routeParams;
  if (!tenantId || tenantId.length < 5 || tenantId.length > 64) {
    return NextResponse.json({ ok: true, ignored: "bad_tenant_id" });
  }

  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);
  const url = resolveRequestUrl(req);

  // Resolve the per-tenant Twilio auth token. fetchQuery is read-only;
  // failures fall through to the workspace token. If neither is set we
  // can't verify — drop.
  let tenantAuthToken: string | undefined;
  try {
    const tenantConfig = (await fetchQuery(
      anyApi.communications.getTenantNotificationConfig,
      { tenantId },
    )) as { twilio?: { authToken?: string } } | null;
    tenantAuthToken = tenantConfig?.twilio?.authToken ?? undefined;
  } catch (err) {
    console.warn(
      `[twilio-webhook/${tenantId}] tenant config lookup failed:`,
      err instanceof Error ? err.message : err,
    );
  }
  const authToken =
    tenantAuthToken ??
    process.env.TWILIO_WEBHOOK_SECRET ??
    process.env.TWILIO_AUTH_TOKEN;

  if (!verifyTwilioSignature(url, params, req.headers, authToken)) {
    if (!authToken) {
      console.error(
        `[twilio-webhook/${tenantId}] no auth token resolved — every webhook is being dropped`,
      );
    } else {
      console.warn(
        `[twilio-webhook/${tenantId}] signature mismatch — refusing to ingest event`,
      );
    }
    return NextResponse.json({ ok: true, ignored: "unverified" });
  }

  const commId = params.get("mid");
  if (!commId) {
    return NextResponse.json({ ok: true, ignored: "no_mid" });
  }

  const messageStatus = params.get("MessageStatus") ?? "unknown";
  const messageSid = params.get("MessageSid") ?? undefined;
  const errorCode = params.get("ErrorCode") ?? undefined;
  const errorMessage = params.get("ErrorMessage") ?? undefined;

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
      expectedTenantId: tenantId,
    });
  } catch (err) {
    console.warn(
      `[twilio-webhook/${tenantId}] ingest failed:`,
      err instanceof Error ? err.message : err,
    );
  }

  return NextResponse.json({ ok: true });
}

function resolveRequestUrl(req: NextRequest): string {
  const publicBase = process.env.PUBLIC_BASE_URL;
  const path = req.nextUrl.pathname + req.nextUrl.search;
  if (publicBase) {
    return `${publicBase.replace(/\/$/, "")}${path}`;
  }
  const proto =
    req.headers.get("x-forwarded-proto") ??
    new URL(req.url).protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    return `${proto}://${host}${path}`;
  }
  return req.url;
}
