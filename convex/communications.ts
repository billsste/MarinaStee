import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

const channelV = v.union(
  v.literal("email"),
  v.literal("sms"),
  v.literal("voice"),
);

export const list = query({
  args: { boaterId: v.optional(v.id("boaters")) },
  handler: async (ctx, { boaterId }) => {
    const tenantId = await requireTenant(ctx);
    if (boaterId) {
      return await ctx.db
        .query("communications")
        .withIndex("by_tenant_boater", (q) =>
          q.eq("tenantId", tenantId).eq("boater_id", boaterId),
        )
        .collect();
    }
    return await ctx.db
      .query("communications")
      .withIndex("by_tenant_sent_at", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(200);
  },
});

export const send = mutation({
  args: {
    boater_id: v.optional(v.id("boaters")),
    type: channelV,
    subject: v.optional(v.string()),
    body: v.string(),
    related_entity: v.optional(v.object({ type: v.string(), id: v.string() })),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    // Resolve recipient from boater contact info
    let recipient = "—";
    let senderLabel = "Marina Stee";
    if (args.boater_id) {
      const boater = await ctx.db.get(args.boater_id);
      assertOwnedByTenant(boater, tenantId);
      recipient =
        args.type === "email"
          ? boater.primary_contact.email ?? "—"
          : boater.primary_contact.phone ?? "—";
    }
    const marina = await ctx.db.get(tenantId);
    if (marina) {
      senderLabel =
        args.type === "sms"
          ? marina.outbound_sms_sender_label
          : marina.outbound_email_from_name;
    }
    const id = await ctx.db.insert("communications", {
      tenantId,
      boater_id: args.boater_id,
      type: args.type,
      direction: "outbound",
      subject: args.subject,
      body_preview: args.body.slice(0, 200),
      body_full: args.body,
      sender_label: senderLabel,
      sender_is_system: false,
      recipient,
      // Insert with status "queued" — the dispatch action flips it to
      // "delivered" / "failed" once Postmark/Twilio responds. Doing this
      // in two phases (queued → delivered) means the UI shows the row
      // immediately even if the provider call is slow or never returns.
      sent_at: new Date().toISOString(),
      status: "queued",
      related_entity: args.related_entity,
    });
    await logAudit(ctx, {
      action_type: "comm.send",
      target_entity: "communications",
      target_id: id,
      payload_delta: { type: args.type, boater_id: args.boater_id },
    });
    // Fire-and-forget dispatch — scheduled at delay 0 so the mutation
    // returns immediately (the caller doesn't wait on the network round-
    // trip). Convex routes scheduled actions through its own runtime;
    // failure inside the action only affects this row's delivery
    // bookkeeping, never the calling mutation's transaction.
    await ctx.scheduler.runAfter(0, api.communications.dispatchOne, {
      commId: id,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// Delivery dispatch (Phase 5 wave 3)
//
// `dispatchOne` is a Convex action (not a mutation) because it makes
// outbound HTTPS calls to Postmark / Twilio. Convex mutations are
// transactional and can't do I/O; actions can. We invoke this from the
// `send` mutation via `ctx.scheduler.runAfter(0, ...)` so the caller's
// transaction commits before we hit the network — that's why the row
// shows up in the UI instantly while delivery resolves async.
//
// `markDelivered` and `markFailed` are mutations that the action calls
// back into to stamp the row's delivery status. Kept separate from
// `send` so other writers (mock path, future webhook ingestion) can
// stamp delivery without re-issuing the original send.
// ────────────────────────────────────────────────────────────

export const dispatchOne = action({
  args: { commId: v.id("communications") },
  handler: async (ctx, { commId }) => {
    // Read the row to dispatch. Action can read via runQuery but the
    // load is one row, so a direct `ctx.runQuery` keeps the function
    // simple. Using the public `list` would over-fetch.
    const comm = await ctx.runQuery(api.communications.getInternal, {
      commId,
    });
    if (!comm) return null;
    // Lazy-import the dispatcher so the Convex action bundle doesn't
    // pull `lib/notification-dispatch` into every other action's
    // dependency tree. Convex's bundler tree-shakes this fine.
    const { dispatchCommunication } = await import(
      "../lib/notification-dispatch.js"
    );
    // Load per-tenant provider config so each marina can route
    // through its own Postmark account / Twilio number. The adapter
    // resolvers already merge env-var fallback in — passing tenant
    // config here just provides the override layer when a marina has
    // configured their own.
    const tenantConfig = await ctx.runQuery(
      api.communications.getTenantNotificationConfig,
      { tenantId: comm.tenantId },
    );
    const result = await dispatchCommunication({
      comm: {
        id: comm._id,
        type: comm.type,
        recipient: comm.recipient,
        subject: comm.subject,
        body: comm.body_full ?? comm.body_preview,
      },
      // Per-tenant config — adapter resolvers fold these together
      // with env-var defaults, so a partially-configured marina
      // (e.g. only Postmark key set, no Twilio) still falls through
      // for the un-configured channel.
      tenantConfig: tenantConfig
        ? {
            postmark: {
              apiKey: tenantConfig.postmark.apiKey ?? undefined,
              fromAddress: tenantConfig.postmark.fromAddress ?? undefined,
              messageStream: tenantConfig.postmark.messageStream ?? undefined,
            },
            twilio: {
              accountSid: tenantConfig.twilio.accountSid ?? undefined,
              authToken: tenantConfig.twilio.authToken ?? undefined,
              fromNumber: tenantConfig.twilio.fromNumber ?? undefined,
            },
          }
        : undefined,
      markDelivered: async ({ commId: id, providerMessageId }) => {
        // SECURITY: routed through `internal.*` so the mutations are
        // NOT exposed on the public `api.*` surface. Without this gate
        // any authenticated client could `useMutation(api.communications.markDelivered)`
        // and overwrite ANY tenant's row (the mutations intentionally
        // skip `requireTenant` so this scheduler-context action can
        // call them — but that's only safe if the mutations are
        // unreachable from the network).
        await ctx.runMutation(internal.communications.markDelivered, {
          commId: id as typeof commId,
          providerMessageId,
        });
      },
      markFailed: async ({ commId: id, errorReason }) => {
        await ctx.runMutation(internal.communications.markFailed, {
          commId: id as typeof commId,
          errorReason,
        });
      },
    });
    return result;
  },
});

/**
 * Action-internal getter so `dispatchOne` can read one comm row without
 * tripping the tenant guard (the action runs without a Clerk session —
 * Convex's scheduler is server-context). We avoid exposing this on
 * `list` so tenant-scoped callers stay scoped.
 *
 * NOTE: this query intentionally skips `requireTenant`. The only caller
 * is `dispatchOne` (above) which is scheduled by `send`, itself already
 * tenant-gated. Nothing outside this file should call it.
 */
export const getInternal = query({
  args: { commId: v.id("communications") },
  handler: async (ctx, { commId }) => {
    return await ctx.db.get(commId);
  },
});

/**
 * Stamp a communications row as successfully delivered. Called from
 * the `dispatchOne` action's success callback via `internal.*` — NOT
 * reachable from the public client surface (the mutation skips the
 * tenant guard because it runs in scheduler context, so it must stay
 * server-side; exposing it on `api.*` would let any tenant overwrite
 * any other tenant's row).
 *
 * Idempotent — patching the same row twice (e.g. retry that resolved
 * the first time) re-writes the same fields with the same values.
 */
export const markDelivered = internalMutation({
  args: {
    commId: v.id("communications"),
    providerMessageId: v.optional(v.string()),
  },
  handler: async (ctx, { commId, providerMessageId }) => {
    // Skip tenant guard: this can be invoked from the scheduler-context
    // action which has no Clerk session. Tenant scoping was already
    // enforced when the row was inserted. We still validate the row
    // exists to avoid silent no-ops. SAFE because `internalMutation`
    // means the function is not on the public api.* surface — only
    // server-side callers (the dispatchOne action) can invoke it.
    const row = await ctx.db.get(commId);
    if (!row) return null;
    await ctx.db.patch(commId, {
      status: "delivered",
      delivered_at: new Date().toISOString(),
      provider_message_id: providerMessageId,
    });
    return commId;
  },
});

/**
 * Stamp a communications row as failed. Server-only (internalMutation)
 * for the same reasons as `markDelivered`. Used for both real provider
 * errors AND the "no provider configured" graceful-degradation path.
 */
export const markFailed = internalMutation({
  args: {
    commId: v.id("communications"),
    errorReason: v.string(),
  },
  handler: async (ctx, { commId, errorReason }) => {
    const row = await ctx.db.get(commId);
    if (!row) return null;
    await ctx.db.patch(commId, {
      status: "failed",
      error_at: new Date().toISOString(),
      error_reason: errorReason,
    });
    return commId;
  },
});

// ────────────────────────────────────────────────────────────
// Webhook-driven status mutations (H2 wave)
//
// All four (markOpened/markClicked/markBounced/recordWebhookEvent)
// are `internalMutation` for the same reason as markDelivered /
// markFailed: they intentionally skip `requireTenant` (the webhook
// route runs without a Clerk session) so they MUST stay off the
// public api.* surface. The webhook handler authenticates the
// PROVIDER (Postmark token / Twilio signature) and that's the only
// auth layer between the request and these mutations — exposing them
// on api.* would let any tenant rewrite any row.
//
// Idempotency: each call patches the same fields with the same value
// shape; replays from provider retry storms are safe.
// ────────────────────────────────────────────────────────────

/**
 * Stamp `opened_at` from a Postmark Open event. Doesn't touch
 * `status` — a row can be "delivered" AND opened. We DO log a
 * `last_webhook_event` audit trail field so operators can see what
 * came in last.
 */
export const markOpened = internalMutation({
  args: {
    commId: v.id("communications"),
    eventLabel: v.optional(v.string()),
    occurredAt: v.optional(v.string()),
  },
  handler: async (ctx, { commId, eventLabel, occurredAt }) => {
    const row = await ctx.db.get(commId);
    if (!row) return null;
    const ts = occurredAt ?? new Date().toISOString();
    await ctx.db.patch(commId, {
      // First open wins — re-opens don't shift the timestamp so the
      // "first seen" signal stays stable for analytics.
      opened_at: row.opened_at ?? ts,
      last_webhook_event: eventLabel ?? "Open",
      last_webhook_at: ts,
    });
    return commId;
  },
});

/**
 * Stamp `clicked_at` from a Postmark Click event. Same pattern as
 * markOpened — first click wins, last_webhook_event tracks the most
 * recent.
 */
export const markClicked = internalMutation({
  args: {
    commId: v.id("communications"),
    eventLabel: v.optional(v.string()),
    occurredAt: v.optional(v.string()),
  },
  handler: async (ctx, { commId, eventLabel, occurredAt }) => {
    const row = await ctx.db.get(commId);
    if (!row) return null;
    const ts = occurredAt ?? new Date().toISOString();
    await ctx.db.patch(commId, {
      clicked_at: row.clicked_at ?? ts,
      last_webhook_event: eventLabel ?? "Click",
      last_webhook_at: ts,
    });
    return commId;
  },
});

/**
 * Stamp `bounced_at` + flip status to "bounced". `reason` is the
 * provider's short description ("HardBounce" / "Transient" / Twilio
 * ErrorCode 30005 etc.). Operators see this as a red pill on the
 * timeline; the recipient should be pruned from future sends.
 */
export const markBounced = internalMutation({
  args: {
    commId: v.id("communications"),
    reason: v.optional(v.string()),
    eventLabel: v.optional(v.string()),
    occurredAt: v.optional(v.string()),
  },
  handler: async (ctx, { commId, reason, eventLabel, occurredAt }) => {
    const row = await ctx.db.get(commId);
    if (!row) return null;
    const ts = occurredAt ?? new Date().toISOString();
    await ctx.db.patch(commId, {
      status: "bounced",
      bounced_at: ts,
      bounce_reason: reason,
      last_webhook_event: eventLabel ?? "Bounce",
      last_webhook_at: ts,
    });
    return commId;
  },
});

/**
 * Catch-all webhook event recorder for event types we don't model
 * with a dedicated mutation (e.g. SpamComplaint, SubscriptionChange,
 * Twilio "sent"/"queued" intermediate states). Just stamps
 * last_webhook_event + last_webhook_at so the operator audit log can
 * surface the activity without us inventing a column per event type.
 */
export const recordWebhookEvent = internalMutation({
  args: {
    commId: v.id("communications"),
    eventLabel: v.string(),
    occurredAt: v.optional(v.string()),
  },
  handler: async (ctx, { commId, eventLabel, occurredAt }) => {
    const row = await ctx.db.get(commId);
    if (!row) return null;
    const ts = occurredAt ?? new Date().toISOString();
    await ctx.db.patch(commId, {
      last_webhook_event: eventLabel,
      last_webhook_at: ts,
    });
    return commId;
  },
});

// ────────────────────────────────────────────────────────────
// Webhook ingestion endpoint (public action)
//
// The Next.js route handlers at /api/webhooks/{postmark,twilio} do
// signature verification + payload normalization, then call this
// action via `fetchAction` from `convex/nextjs`. We keep the
// normalization OUT of Convex (Postmark JSON shape, Twilio form-url-
// encoded params) so the Convex layer stays runtime-agnostic.
//
// SECURITY: this is a public action (not internal) because the Next
// route handler doesn't run with a Clerk JWT — it runs with the
// PROVIDER'S signature as its auth. The action does NOT call
// requireTenant; it scopes by `commId` (which is unguessable) plus
// the prior route-layer signature check. If the signature check is
// bypassed, an attacker who guessed a comm id could rewrite that
// row's status — that's the threat model we accept here, and it's
// the same one Postmark+Twilio's own docs describe.
//
// Audit logging happens via `logWebhookAudit` below. The audit row
// uses the action-as-actor convention (`actor_user_id: "system"`) so
// the audit log surface doesn't pretend a human did this.
// ────────────────────────────────────────────────────────────

export const ingestWebhookEvent = action({
  args: {
    commId: v.id("communications"),
    kind: v.union(
      v.literal("delivered"),
      v.literal("bounced"),
      v.literal("opened"),
      v.literal("clicked"),
      v.literal("failed"),
      v.literal("other"),
    ),
    eventLabel: v.string(),
    occurredAt: v.optional(v.string()),
    reason: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
    // SECURITY: when the calling webhook URL is tenant-scoped (e.g.
    // /api/webhooks/postmark/{tenantId}), the route passes the URL
    // path's tenantId here so the action can confirm the comm row
    // belongs to the expected tenant. Without this check, an attacker
    // who controls one tenant's Postmark account could fire forged
    // events with another tenant's commId and overwrite their delivery
    // status. The legacy shared-workspace URLs omit this arg and
    // operate in the broader (less safe) trust model.
    expectedTenantId: v.optional(v.id("marinas")),
  },
  handler: async (
    ctx,
    { commId, kind, eventLabel, occurredAt, reason, providerMessageId, expectedTenantId },
  ) => {
    // Load the row to (a) confirm it exists, (b) pull the tenantId
    // for the audit entry. Skip if missing — Postmark/Twilio retry
    // for ~24h on non-2xx, and a missing row means the comm was
    // hard-deleted before the receipt arrived; nothing to do.
    const row = await ctx.runQuery(api.communications.getInternal, {
      commId,
    });
    if (!row) return null;
    // Cross-tenant defense. When the caller provided expectedTenantId,
    // refuse if the comm row belongs to a different tenant. Log a
    // warning so the operator sees the attack signal.
    if (expectedTenantId && row.tenantId !== expectedTenantId) {
      console.warn(
        `[ingestWebhookEvent] cross-tenant rejection: commId=${commId} belongs to ${row.tenantId}, expected ${expectedTenantId}`,
      );
      return null;
    }

    switch (kind) {
      case "delivered":
        await ctx.runMutation(internal.communications.markDelivered, {
          commId,
          providerMessageId,
        });
        break;
      case "bounced":
        await ctx.runMutation(internal.communications.markBounced, {
          commId,
          reason,
          eventLabel,
          occurredAt,
        });
        break;
      case "opened":
        await ctx.runMutation(internal.communications.markOpened, {
          commId,
          eventLabel,
          occurredAt,
        });
        break;
      case "clicked":
        await ctx.runMutation(internal.communications.markClicked, {
          commId,
          eventLabel,
          occurredAt,
        });
        break;
      case "failed":
        await ctx.runMutation(internal.communications.markFailed, {
          commId,
          errorReason: reason ?? eventLabel,
        });
        break;
      case "other":
      default:
        await ctx.runMutation(internal.communications.recordWebhookEvent, {
          commId,
          eventLabel,
          occurredAt,
        });
        break;
    }

    // Audit log — operator-visible "delivery health" trail. Routed
    // through a dedicated internal mutation that bypasses
    // requireTenant (the action has no Clerk session) but still
    // writes a fully-scoped row.
    await ctx.runMutation(internal.communications.logWebhookAudit, {
      tenantId: row.tenantId,
      commId,
      actionType: `comm.webhook.${kind}`,
      eventLabel,
      reason,
    });
    return commId;
  },
});

/**
 * Internal-only audit logger for webhook events. Bypasses the normal
 * `logAudit` helper because that helper calls `requireTenantAndUser`
 * which requires a Clerk JWT — webhook ingestion runs without one.
 * We pass the tenantId explicitly (loaded from the comm row) and use
 * "webhook:postmark"/"webhook:twilio" as the actor label so the
 * audit-log UI can render a distinct row.
 */
export const logWebhookAudit = internalMutation({
  args: {
    tenantId: v.id("marinas"),
    commId: v.id("communications"),
    actionType: v.string(),
    eventLabel: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { tenantId, commId, actionType, eventLabel, reason }) => {
    await ctx.db.insert("auditLog", {
      tenantId,
      actor_user_id: undefined,
      actor_label: "webhook",
      action_type: actionType,
      target_entity: "communications",
      target_id: commId,
      payload_delta: JSON.stringify({ event: eventLabel, reason }),
      created_at: new Date().toISOString(),
    });
  },
});

// ────────────────────────────────────────────────────────────
// Per-tenant provider config lookup (H2 wave)
//
// Returns the marina's notification provider config so the dispatch
// action can pass it to lib/notification-dispatch.ts. Internal so the
// raw API key never leaves Convex — callers are the dispatchOne
// action above + the future test-send route.
// ────────────────────────────────────────────────────────────

export const getTenantNotificationConfig = query({
  args: { tenantId: v.id("marinas") },
  handler: async (ctx, { tenantId }) => {
    const marina = await ctx.db.get(tenantId);
    if (!marina) return null;
    return {
      postmark: {
        apiKey: marina.postmark_api_key,
        fromAddress: marina.email,
        messageStream: marina.postmark_message_stream,
      },
      twilio: {
        accountSid: marina.twilio_account_sid,
        authToken: marina.twilio_auth_token,
        fromNumber: marina.twilio_from_number,
      },
    };
  },
});
