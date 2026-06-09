/*
 * POST /api/webhooks/postmark/[tenantId]
 *
 * Per-tenant Postmark webhook receiver — the PRODUCTION pattern.
 *
 * Why per-tenant URLs:
 *   Postmark webhooks identify the comm row via `Metadata.marina_message_id`
 *   = the Convex `communications._id`. If the workspace-wide URL
 *   `/api/webhooks/postmark` is shared across tenants, an attacker who
 *   controls tenant A's Postmark account can send a forged event with
 *   tenant B's commId in the Metadata. The receiver verifies the
 *   workspace-level signature (which A has — they configured it for
 *   their own webhook) and then stamps tenant B's row.
 *
 *   Per-tenant URLs close this. Each marina configures its Postmark
 *   webhook to:
 *       https://app.marinastee.com/api/webhooks/postmark/{their_tenant_id}
 *   and the handler asserts the comm row's `tenantId` matches the URL
 *   path before patching.
 *
 * Signature: still verified via `verifyPostmarkSignature`. If the
 * marina has set a tenant-scoped `postmark_webhook_secret` we use
 * that; otherwise fall back to the workspace env var.
 *
 * Cross-tenant defense lives in `convex/communications.ts → ingestWebhookEvent`
 * via the `expectedTenantId` arg.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchAction } from "convex/nextjs";
import { anyApi } from "convex/server";
import { verifyPostmarkSignature } from "@/lib/webhook-verify";

export const runtime = "nodejs";

interface PostmarkEvent {
  RecordType?: string;
  MessageID?: string;
  Metadata?: { marina_message_id?: string } & Record<string, string>;
  Type?: string;
  Description?: string;
  Details?: string;
  DeliveredAt?: string;
  BouncedAt?: string;
  ReceivedAt?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const { tenantId } = await params;
  if (!tenantId || tenantId.length < 5 || tenantId.length > 64) {
    return NextResponse.json({ ok: true, ignored: "bad_tenant_id" });
  }

  if (!verifyPostmarkSignature(req.headers)) {
    if (!process.env.POSTMARK_WEBHOOK_SECRET) {
      console.error(
        "[postmark-webhook/tenant] POSTMARK_WEBHOOK_SECRET is not set — " +
          "every inbound webhook is being ignored. Set it in env to " +
          "ingest delivery receipts + bounces.",
      );
    } else {
      console.warn(
        `[postmark-webhook/${tenantId}] signature mismatch — refusing to ingest event`,
      );
    }
    return NextResponse.json({ ok: true, ignored: "unverified" });
  }

  let event: PostmarkEvent;
  try {
    event = (await req.json()) as PostmarkEvent;
  } catch {
    return NextResponse.json({ ok: true, ignored: "invalid_json" });
  }

  const commId = event.Metadata?.marina_message_id;
  if (!commId) {
    return NextResponse.json({ ok: true, ignored: "no_metadata" });
  }

  const recordType = event.RecordType ?? "Unknown";
  const occurredAt =
    event.DeliveredAt ??
    event.BouncedAt ??
    event.ReceivedAt ??
    new Date().toISOString();

  let kind:
    | "delivered"
    | "bounced"
    | "opened"
    | "clicked"
    | "failed"
    | "other";
  switch (recordType) {
    case "Delivery":
      kind = "delivered";
      break;
    case "Bounce":
      kind = "bounced";
      break;
    case "Open":
      kind = "opened";
      break;
    case "Click":
      kind = "clicked";
      break;
    case "SpamComplaint":
      kind = "bounced";
      break;
    default:
      kind = "other";
      break;
  }

  const reason = event.Description ?? event.Details ?? event.Type;

  try {
    await fetchAction(anyApi.communications.ingestWebhookEvent, {
      commId,
      kind,
      eventLabel: recordType,
      occurredAt,
      reason,
      providerMessageId: event.MessageID,
      // SECURITY: assert the comm row belongs to THIS tenant. The
      // action cross-checks `row.tenantId === expectedTenantId` and
      // returns null on mismatch (with a console.warn).
      expectedTenantId: tenantId,
    });
  } catch (err) {
    console.warn(
      `[postmark-webhook/${tenantId}] ingest failed:`,
      err instanceof Error ? err.message : err,
    );
  }

  return NextResponse.json({ ok: true });
}
