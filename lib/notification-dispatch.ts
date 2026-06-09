/*
 * Notification dispatch — turn a drafted `communications` row into a
 * real outbound send through the configured provider.
 *
 * Lifecycle (matches lib/outbound.ts but with status-bookkeeping baked
 * in instead of left to the caller):
 *
 *   1. Caller (Convex mutation, agent action handler, /api/comms/send)
 *      inserts the comm row with status="queued".
 *   2. Caller invokes `dispatchCommunication({ comm, ... })`.
 *   3. We pick the adapter by `comm.type` ("email" → Postmark,
 *      "sms" → Twilio, "voice" → no-op for now).
 *   4. On success, the supplied `markDelivered` callback stamps the
 *      provider message id + delivered_at.
 *   5. On failure, the supplied `markFailed` callback stamps
 *      error_at + error_reason.
 *
 * Graceful degradation: when env vars / tenant config aren't set, the
 * adapter returns `error: "no_provider_configured"` and we record the
 * failure on the row WITHOUT throwing — the prototype/demo flow keeps
 * working, the timeline just shows a "not delivered" badge instead of
 * a green checkmark.
 *
 * Idempotency: every send threads `comm.id` through as the provider
 * messageId — Postmark uses it as the Metadata.idempotency_key, Twilio
 * stitches it onto the StatusCallback URL. A retry with the same
 * comm.id is a no-op at the provider layer.
 *
 * The callbacks shape (markDelivered / markFailed) is what lets this
 * file be runtime-agnostic — Convex calls it from a scheduled action
 * (passing in mutation callers), the mock path calls it inline (passing
 * client-store updaters), and a unit test would pass spies. Same shape
 * in all three.
 */

import { sendViaPostmark, type PostmarkConfig } from "./adapters/postmark";
import { sendViaTwilio, type TwilioConfig } from "./adapters/twilio";

// ────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────

/**
 * Narrowed shape of a `communications` row — only the fields the
 * dispatcher needs. Accepts both the mock `Communication` shape and
 * the Convex row shape since we read by structural typing rather than
 * importing either source-of-truth type (avoids a circular dep with
 * convex/_generated/api).
 */
export interface DispatchableCommunication {
  /** Stable identifier used as the provider idempotency key. */
  id: string;
  /** Channel — picks the adapter. */
  type: "email" | "sms" | "voice";
  /** Resolved recipient address — email or E.164 phone. */
  recipient: string;
  /** Email subject, if applicable. */
  subject?: string;
  /**
   * Outbound body. The mock row stores this in `body_preview` (capped at
   * 200 chars); the Convex row has both `body_preview` + the full
   * `body_full`. Callers should pass the full body when they have it
   * and fall back to the preview otherwise.
   */
  body: string;
}

/**
 * Per-tenant provider configuration. Reads from the Convex `marinas`
 * row (eventually — today, the dispatcher falls back to env vars).
 * Keeping the shape explicit means moving from "env-only" to "per-tenant
 * from DB" is a one-call-site change.
 */
export interface TenantNotificationConfig {
  postmark?: PostmarkConfig;
  twilio?: TwilioConfig;
}

export interface DispatchResult {
  /** Provider's identifier for the send (Postmark MessageID / Twilio sid). */
  providerMessageId?: string;
  /** "delivered" when the provider accepted the send; "failed" otherwise. */
  status: "delivered" | "failed";
  /**
   * Short machine-readable reason on failure. Standard values:
   *   - "no_provider_configured"  — env / tenant config missing
   *   - "unsupported_channel"     — voice (not yet wired)
   *   - "missing_recipient"       — comm row had recipient="—"
   *   - Anything else originates from the provider (HTTP status etc.)
   */
  error?: string;
}

export interface DispatchOptions {
  comm: DispatchableCommunication;
  /**
   * Per-tenant provider config. When omitted, the adapters fall
   * through to env vars — which is what the prototype/demo wants.
   */
  tenantConfig?: TenantNotificationConfig;
  /**
   * Callback to record a successful send back on the comm row. The
   * dispatcher doesn't write directly so it can run in any runtime —
   * Convex scheduled action, mock client-store, /api/comms/send.
   *
   * Called with the provider's stable id (or undefined if the provider
   * didn't return one — Postmark always does, Twilio always does, but
   * a stub send won't).
   */
  markDelivered?: (args: {
    commId: string;
    providerMessageId?: string;
  }) => Promise<void> | void;
  /**
   * Callback to record a failed send back on the comm row.
   *
   * `errorReason` is the short machine-readable code from DispatchResult.
   */
  markFailed?: (args: {
    commId: string;
    errorReason: string;
  }) => Promise<void> | void;
}

// ────────────────────────────────────────────────────────────
// Dispatcher
// ────────────────────────────────────────────────────────────

/**
 * Send one communication. Always resolves — never throws — so callers
 * can fire-and-forget without try/catch. The returned result is
 * informational; the bookkeeping callbacks are the source of truth.
 */
export async function dispatchCommunication(
  opts: DispatchOptions,
): Promise<DispatchResult> {
  const { comm, tenantConfig, markDelivered, markFailed } = opts;

  // Guard 1: voice channel isn't wired yet. Treat as a graceful no-op
  // — record a failed dispatch with a clear reason but don't break the
  // caller (which already wrote the row).
  if (comm.type === "voice") {
    const result: DispatchResult = {
      status: "failed",
      error: "unsupported_channel",
    };
    await stamp(result, comm.id, markDelivered, markFailed);
    return result;
  }

  // Guard 2: missing recipient. Happens when the boater row has no
  // primary email / phone. Same graceful-failure treatment.
  if (!comm.recipient || comm.recipient === "—" || comm.recipient.trim() === "") {
    const result: DispatchResult = {
      status: "failed",
      error: "missing_recipient",
    };
    await stamp(result, comm.id, markDelivered, markFailed);
    return result;
  }

  // Route to the appropriate adapter.
  let result: DispatchResult;
  if (comm.type === "email") {
    const r = await sendViaPostmark({
      to: comm.recipient,
      subject: comm.subject ?? "(no subject)",
      body: comm.body,
      messageId: comm.id,
      config: tenantConfig?.postmark,
    });
    result = {
      status: r.status,
      providerMessageId: r.providerMessageId,
      error: r.error,
    };
  } else {
    // sms
    const r = await sendViaTwilio({
      to: comm.recipient,
      body: comm.body,
      messageId: comm.id,
      config: tenantConfig?.twilio,
    });
    result = {
      status: r.status,
      providerMessageId: r.providerMessageId,
      error: r.error,
    };
  }

  // Soft-warn when running without provider config so a misconfigured
  // local env is obvious in dev. Production swallows the log — Convex
  // pipes server console to its dashboard, and the comm row's
  // error_reason field is the audit trail.
  if (result.status === "failed" && result.error === "no_provider_configured") {
    console.warn(
      `[notification-dispatch] no provider configured for ${comm.type}; ` +
        `comm ${comm.id} stamped error_reason=no_provider_configured`,
    );
  }

  await stamp(result, comm.id, markDelivered, markFailed);
  return result;
}

/**
 * Apply the result to the comm row via the supplied callbacks. Pulled
 * out so every early-return path (voice, missing recipient, failure)
 * exits through the same bookkeeping codepath.
 */
async function stamp(
  result: DispatchResult,
  commId: string,
  markDelivered?: DispatchOptions["markDelivered"],
  markFailed?: DispatchOptions["markFailed"],
): Promise<void> {
  try {
    if (result.status === "delivered") {
      await markDelivered?.({
        commId,
        providerMessageId: result.providerMessageId,
      });
    } else {
      await markFailed?.({
        commId,
        errorReason: result.error ?? "unknown_error",
      });
    }
  } catch (err) {
    // Bookkeeping callback itself threw — log and continue. The row
    // stays in its prior state (whatever the caller set on insert)
    // rather than corrupting the dispatch result.
    console.warn(
      `[notification-dispatch] mark callback failed for ${commId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
