/*
 * Postmark adapter — thin fetch-based wrapper around the Postmark REST API.
 *
 * Why no SDK: the official `postmark` npm package pulls Node-only deps
 * (request, lodash variants) that bloat the serverless bundle. The REST
 * surface we need is small (one POST per email), and `fetch` is in every
 * runtime — Node, Edge, browser. So we hit it directly.
 *
 * Env vars expected (read at call time, not module load — so a missing
 * key only surfaces as a soft error per-dispatch, not a hard import-time
 * crash):
 *
 *   POSTMARK_API_KEY            // alias for POSTMARK_SERVER_TOKEN (legacy)
 *   POSTMARK_SERVER_TOKEN       // canonical name
 *   POSTMARK_FROM_ADDRESS       // default from address (optional override per-send)
 *   POSTMARK_MESSAGE_STREAM     // optional, defaults to "outbound"
 *
 * Idempotency: Postmark deduplicates on a custom `Metadata.idempotency_key`
 * header within a 5-minute window. We thread the caller's `messageId` (a
 * stable derivative of the comm row's _id) through so a retry doesn't
 * double-send.
 *
 * See lib/notification-dispatch.ts → dispatchCommunication for the call
 * site. This file is the only place that knows how to talk to Postmark.
 */

export interface PostmarkSendArgs {
  /** Recipient email address. */
  to: string;
  /** From address — overrides POSTMARK_FROM_ADDRESS when supplied. */
  from?: string;
  /** Subject line. Required by Postmark. */
  subject: string;
  /** Plain-text body. HTML rendering is a follow-up wave. */
  body: string;
  /**
   * Stable identifier for this send — used as the Postmark
   * idempotency key so retries don't double-send. Derived from the
   * Communication row's `_id` by the caller.
   */
  messageId: string;
  /**
   * Per-tenant overrides supplied by `tenantConfig` so each marina can
   * use its own Postmark account. Falls back to env when omitted.
   */
  config?: PostmarkConfig;
}

export interface PostmarkConfig {
  apiKey?: string;
  fromAddress?: string;
  messageStream?: string;
}

export interface PostmarkResult {
  providerMessageId?: string;
  status: "delivered" | "failed";
  error?: string;
}

const POSTMARK_ENDPOINT = "https://api.postmarkapp.com/email";

/**
 * Resolve the effective config — tenant override wins over env. Returns
 * `undefined` when neither side has a key, which is the cue to short-
 * circuit to "no_provider_configured" in the dispatcher.
 */
export function resolvePostmarkConfig(
  override?: PostmarkConfig,
): Required<Pick<PostmarkConfig, "apiKey" | "fromAddress" | "messageStream">> | null {
  // POSTMARK_API_KEY is the name the spec calls out; we also honor the
  // older POSTMARK_SERVER_TOKEN that's already in .env.example so we
  // don't break setups that pre-date the rename.
  const apiKey =
    override?.apiKey ??
    process.env.POSTMARK_API_KEY ??
    process.env.POSTMARK_SERVER_TOKEN;
  const fromAddress =
    override?.fromAddress ??
    process.env.POSTMARK_FROM_ADDRESS ??
    "no-reply@marinastee.com";
  const messageStream =
    override?.messageStream ??
    process.env.POSTMARK_MESSAGE_STREAM ??
    "outbound";

  if (!apiKey) return null;
  return { apiKey, fromAddress, messageStream };
}

/**
 * Send one email through Postmark. Returns a result object with
 * `status: "failed"` on any non-2xx response (or thrown fetch error)
 * rather than throwing — the dispatcher writes the failure back to the
 * comm row and the outer caller never has to wrap in try/catch.
 */
export async function sendViaPostmark(
  args: PostmarkSendArgs,
): Promise<PostmarkResult> {
  const cfg = resolvePostmarkConfig(args.config);
  if (!cfg) {
    return {
      status: "failed",
      error: "no_provider_configured",
    };
  }

  try {
    const res = await fetch(POSTMARK_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": cfg.apiKey,
      },
      body: JSON.stringify({
        From: args.from ?? cfg.fromAddress,
        To: args.to,
        Subject: args.subject,
        TextBody: args.body,
        MessageStream: cfg.messageStream,
        // Postmark surfaces metadata back on bounces + opens; tagging
        // the row with our messageId is what lets future webhook
        // ingestion link the receipt to the originating communications
        // row without a separate join table.
        Metadata: {
          marina_message_id: args.messageId,
        },
      }),
      // Hard 15s cap — without this the action sits open until Convex's
      // wall-clock limit kills it, leaving the comm row in `queued` with
      // no error_reason for the operator to debug.
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        status: "failed",
        error: `postmark_${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as { MessageID?: string };
    return {
      status: "delivered",
      providerMessageId: data.MessageID,
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
        error: "postmark_timeout",
      };
    }
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "postmark_unknown_error",
    };
  }
}
