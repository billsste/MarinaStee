/*
 * POST /api/webhooks/postmark — Postmark delivery / open / click /
 * bounce / spam-complaint receiver.
 *
 * Postmark POSTs a JSON envelope with a `RecordType` discriminator:
 *
 *   RecordType: "Delivery"        — accepted by destination
 *   RecordType: "Bounce"          — hard or transient bounce
 *   RecordType: "Open"            — pixel fired (email-only)
 *   RecordType: "Click"           — tracked link clicked
 *   RecordType: "SpamComplaint"   — recipient marked as spam
 *   RecordType: "SubscriptionChange" — recipient opted in/out
 *
 * Auth: Postmark's webhook surface uses a "Basic Auth via custom
 * header" pattern — when you register the URL in their dashboard you
 * can set a token Postmark echoes back as `X-Postmark-Webhook-Token`
 * on every request. We compare against POSTMARK_WEBHOOK_SECRET via
 * `verifyPostmarkSignature`.
 *
 * Matching: every outbound send threads `Metadata.marina_message_id`
 * (set in lib/adapters/postmark.ts) — that's the Convex
 * communications._id, so the receiver pulls it off the envelope and
 * uses it as the join key. No DB index needed; Convex `ctx.db.get`
 * resolves the row directly.
 *
 * Failure modes — ALL return 200 so Postmark doesn't retry-storm us:
 *   - missing secret in env → no-op 200 (dev/demo)
 *   - bad signature        → no-op 200 + log warn
 *   - malformed payload    → no-op 200
 *   - row not found        → no-op 200 (likely a deleted comm)
 *
 * The route is intentionally tolerant — operators see delivery health
 * in the audit log + on the comm row's `last_webhook_event` field.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchAction } from "convex/nextjs";
import { anyApi } from "convex/server";
import { verifyPostmarkSignature } from "@/lib/webhook-verify";

// `anyApi` is the untyped function-reference proxy — same pattern the
// rest of the app uses for Convex calls so we don't need to wait for
// `npx convex dev` to write _generated/api.d.ts to typecheck. Once
// the codegen lands a follow-up can swap to the typed `api` import.

export const runtime = "nodejs";

// Postmark sends one event per POST. We only pull the fields we
// actually use — the full envelope has 30+ fields per record type.
interface PostmarkEvent {
  RecordType?: string;
  MessageID?: string;
  Metadata?: { marina_message_id?: string } & Record<string, string>;
  // Bounce-specific
  Type?: string;
  Description?: string;
  Details?: string;
  // Timestamps — names differ by RecordType
  DeliveredAt?: string;
  BouncedAt?: string;
  ReceivedAt?: string;
}

export async function POST(req: NextRequest) {
  // Signature first — drop on the floor if missing or wrong.
  if (!verifyPostmarkSignature(req.headers)) {
    // 200 not 401 — Postmark interprets non-2xx as "retry" and will
    // hammer the endpoint for 24h. The mock/demo path (no secret
    // configured) also lands here.
    //
    // MISCONFIG SIGNAL: when POSTMARK_WEBHOOK_SECRET is unset in
    // production, EVERY legit webhook is silently dropped — operators
    // see no delivery receipts and have no signal that something is
    // wrong. Log a hard error so it's visible in the deploy logs /
    // monitoring stack; we still return 200 to avoid Postmark retry.
    if (!process.env.POSTMARK_WEBHOOK_SECRET) {
      console.error(
        "[postmark-webhook] POSTMARK_WEBHOOK_SECRET is not set — " +
          "every inbound webhook is being ignored. Set it in env to " +
          "ingest delivery receipts + bounces.",
      );
    } else {
      // Secret IS configured but the request didn't match — log a
      // distinct warning so operators can tell "unconfigured" from
      // "actual signature mismatch".
      console.warn(
        "[postmark-webhook] signature mismatch — refusing to ingest event",
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
    // Postmark always echoes Metadata back when we set it on send —
    // a missing one means either an event for a comm we didn't send
    // (shared inbox?) or a misconfigured Metadata key.
    return NextResponse.json({ ok: true, ignored: "no_metadata" });
  }

  const recordType = event.RecordType ?? "Unknown";
  const occurredAt =
    event.DeliveredAt ??
    event.BouncedAt ??
    event.ReceivedAt ??
    new Date().toISOString();

  // Map Postmark RecordType → our `ingestWebhookEvent` discriminator.
  // Anything we don't model lands as "other" so the operator still
  // sees the event in the audit log without us inventing a column.
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
      // Treat spam complaints as bounces — the address is dead from
      // a deliverability standpoint either way.
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
    });
  } catch (err) {
    // Convex offline / row missing / id malformed — log + 200 so
    // Postmark doesn't pile up retries. The operator's "delivery
    // health" view will show the row stuck at queued/delivered
    // depending on what got through.
    console.warn(
      "[postmark-webhook] ingest failed:",
      err instanceof Error ? err.message : err,
    );
  }

  return NextResponse.json({ ok: true });
}
