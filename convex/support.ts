/*
 * Marina Stee — Support module Convex functions.
 *
 * Per the carve-out in ../CLAUDE.md, support tickets stay in THIS
 * deployment (scoped by tenantId via requireTenant) and do NOT proxy
 * out to admin.stee-suite.com. One marina's queue is invisible to
 * another.
 *
 * Surfaces:
 *  - Boater portal:  listForBoater + createTicket + addMessage + cancelTicket
 *  - Operator queue: listForTenant + updateStatus + addMessage
 *
 * Every mutation calls requireTenant first and writes an audit row.
 * Cross-tenant access is rejected via assertOwnedByTenant on every
 * ticket-id-keyed mutation.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  assertOwnedByTenant,
  logAudit,
  requireTenant,
  requireTenantAndUser,
} from "./_helpers";

// ────────────────────────────────────────────────────────────
// Embedded value shapes (mirrored from schema.ts)
// ────────────────────────────────────────────────────────────

const ticketTypeV = v.union(
  v.literal("bug"),
  v.literal("question"),
  v.literal("feature_request"),
  v.literal("billing"),
  v.literal("other"),
);

const ticketPriorityV = v.union(
  v.literal("low"),
  v.literal("normal"),
  v.literal("high"),
  v.literal("urgent"),
);

const ticketStatusV = v.union(
  v.literal("open"),
  v.literal("in_progress"),
  v.literal("awaiting_boater"),
  v.literal("resolved"),
  v.literal("cancelled"),
);

const attachmentV = v.object({
  id: v.string(),
  name: v.string(),
  mime_type: v.string(),
  size_bytes: v.optional(v.number()),
  storage_id: v.string(),
  uploaded_at: v.string(),
});

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function makeMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Pick a fresh ST-### reference. Counts existing tickets for the
 * tenant and adds 1 — collisions are tolerable in the prototype since
 * the reference is display-only (real id is `_id`). When this scales
 * we can switch to a per-tenant counter row in `rateLimits` style.
 */
async function nextReferenceForTenant(
  ctx: { db: { query: typeof globalThis extends { unused: never } ? never : never } } | Parameters<typeof requireTenant>[0],
  tenantId: import("./_generated/dataModel").Id<"marinas">,
): Promise<string> {
  // Use the actual ctx db — TS-friendly cast below. We only need a
  // rough count for the reference suffix.
  const existing = await (ctx as Parameters<typeof requireTenant>[0]).db
    .query("supportTickets")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  const seq = existing.length + 1;
  return `ST-${String(seq).padStart(3, "0")}`;
}

// ────────────────────────────────────────────────────────────
// Queries
// ────────────────────────────────────────────────────────────

/**
 * All tickets for one boater. Tenant-scoped — the boater_id is paired
 * with tenantId on the index so a leaked id can't enumerate tickets
 * from another marina.
 */
export const listForBoater = query({
  args: { boaterId: v.id("boaters") },
  handler: async (ctx, { boaterId }) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("supportTickets")
      .withIndex("by_tenant_boater", (q) =>
        q.eq("tenantId", tenantId).eq("boater_id", boaterId),
      )
      .order("desc")
      .collect();
  },
});

/**
 * Operator queue — every ticket in the current marina, most recent
 * first. The operator UI groups + filters client-side.
 */
export const listForTenant = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("supportTickets")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .collect();
  },
});

/**
 * Fetch a single ticket. Used by the modal detail view. Cross-tenant
 * guarded so a URL-tampered id throws.
 */
export const getById = query({
  args: { id: v.id("supportTickets") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const ticket = await ctx.db.get(id);
    assertOwnedByTenant(ticket, tenantId);
    return ticket;
  },
});

// ────────────────────────────────────────────────────────────
// Mutations
// ────────────────────────────────────────────────────────────

/**
 * Boater files a new ticket from the portal.
 *
 * Required: subject + description. Recommended fields default to
 * "other" / "normal" when the boater leaves them blank. Silent
 * context metadata (URL, app version, UA) is captured by the client.
 */
export const createTicket = mutation({
  args: {
    boater_id: v.id("boaters"),
    subject: v.string(),
    description: v.string(),
    type: v.optional(ticketTypeV),
    priority: v.optional(ticketPriorityV),
    page_or_area: v.optional(v.string()),
    steps_to_reproduce: v.optional(v.string()),
    attachments: v.optional(v.array(attachmentV)),
    context: v.optional(
      v.object({
        submitted_from_url: v.optional(v.string()),
        app_version: v.optional(v.string()),
        user_agent: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { tenantId, userLabel } = await requireTenantAndUser(ctx);

    // Confirm the boater belongs to this marina before tying a ticket
    // to them — prevents URL-tampered boater_id from creating tickets
    // under another tenant's customers.
    const boater = await ctx.db.get(args.boater_id);
    assertOwnedByTenant(boater, tenantId);

    const reference = await nextReferenceForTenant(ctx, tenantId);
    const created_at = nowIso();

    const id = await ctx.db.insert("supportTickets", {
      tenantId,
      reference,
      boater_id: args.boater_id,
      subject: args.subject.trim(),
      description: args.description.trim(),
      type: args.type ?? "other",
      priority: args.priority ?? "normal",
      page_or_area: args.page_or_area,
      steps_to_reproduce: args.steps_to_reproduce,
      attachments: args.attachments ?? [],
      messages: [
        {
          id: makeMessageId(),
          author_kind: "system",
          author_label: "Marina Stee",
          body: `Ticket ${reference} received. The marina will reply here as soon as they can.`,
          created_at,
        },
      ],
      status: "open",
      context: args.context ?? {},
      created_at,
      updated_at: created_at,
    });

    await logAudit(ctx, {
      action_type: "support_ticket.create",
      target_entity: "supportTickets",
      target_id: id,
      payload_delta: {
        reference,
        subject: args.subject,
        type: args.type ?? "other",
        priority: args.priority ?? "normal",
        actor: userLabel,
      },
    });

    return id;
  },
});

/**
 * Append a message to a ticket's conversation thread. Called by the
 * boater portal (author_kind="boater") and the operator queue
 * (author_kind="staff"). System messages (status changes, automated
 * acknowledgements) use author_kind="system".
 *
 * Posting a reply automatically nudges status:
 *  - boater message on a resolved ticket reopens it (status -> open)
 *  - staff message on an open ticket moves to in_progress (if not already)
 */
export const addMessage = mutation({
  args: {
    ticketId: v.id("supportTickets"),
    body: v.string(),
    author_kind: v.union(
      v.literal("boater"),
      v.literal("staff"),
      v.literal("system"),
    ),
    author_label: v.optional(v.string()),
    attachment_ids: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { tenantId, userLabel } = await requireTenantAndUser(ctx);
    const ticket = await ctx.db.get(args.ticketId);
    assertOwnedByTenant(ticket, tenantId);

    const trimmed = args.body.trim();
    if (!trimmed) {
      throw new Error("Message body is empty");
    }

    const created_at = nowIso();
    const message = {
      id: makeMessageId(),
      author_kind: args.author_kind,
      author_label:
        args.author_label ??
        (args.author_kind === "system" ? "Marina Stee" : userLabel),
      body: trimmed,
      created_at,
      attachment_ids: args.attachment_ids,
    };

    // Auto status-nudge so the queue stays sane without staff having
    // to remember to flip it.
    let nextStatus = ticket.status;
    if (args.author_kind === "boater" && ticket.status === "resolved") {
      nextStatus = "open";
    } else if (args.author_kind === "staff" && ticket.status === "open") {
      nextStatus = "in_progress";
    } else if (
      args.author_kind === "staff" &&
      ticket.status === "in_progress"
    ) {
      nextStatus = "awaiting_boater";
    } else if (
      args.author_kind === "boater" &&
      ticket.status === "awaiting_boater"
    ) {
      nextStatus = "in_progress";
    }

    await ctx.db.patch(args.ticketId, {
      messages: [...ticket.messages, message],
      status: nextStatus,
      updated_at: created_at,
    });

    await logAudit(ctx, {
      action_type: "support_ticket.message",
      target_entity: "supportTickets",
      target_id: args.ticketId,
      payload_delta: {
        author_kind: args.author_kind,
        status_before: ticket.status,
        status_after: nextStatus,
      },
    });

    return message.id;
  },
});

/**
 * Operator-side status flip. Used by the staff queue (open -> in_progress,
 * in_progress -> resolved, etc). Boaters cancel via `cancelTicket` which
 * is purposefully separate so we can carry retention copy + a system
 * message in one shot.
 */
export const updateStatus = mutation({
  args: {
    ticketId: v.id("supportTickets"),
    status: ticketStatusV,
  },
  handler: async (ctx, { ticketId, status }) => {
    const tenantId = await requireTenant(ctx);
    const ticket = await ctx.db.get(ticketId);
    assertOwnedByTenant(ticket, tenantId);

    const patch: {
      status: typeof status;
      updated_at: string;
      closed_at?: string;
    } = {
      status,
      updated_at: nowIso(),
    };
    if (status === "resolved" || status === "cancelled") {
      patch.closed_at = nowIso();
    }

    await ctx.db.patch(ticketId, patch);
    await logAudit(ctx, {
      action_type: "support_ticket.status",
      target_entity: "supportTickets",
      target_id: ticketId,
      payload_delta: { from: ticket.status, to: status },
    });
    return ticketId;
  },
});

/**
 * Boater cancels their own ticket. Per global §5: cancel, not delete —
 * the row sticks around with status=cancelled so the conversation
 * history is preserved.
 */
export const cancelTicket = mutation({
  args: {
    ticketId: v.id("supportTickets"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { ticketId, reason }) => {
    const { tenantId, userLabel } = await requireTenantAndUser(ctx);
    const ticket = await ctx.db.get(ticketId);
    assertOwnedByTenant(ticket, tenantId);

    if (ticket.status === "cancelled") {
      // Idempotent — repeated cancels are a no-op.
      return ticketId;
    }

    const closed_at = nowIso();
    const systemMessage = {
      id: makeMessageId(),
      author_kind: "system" as const,
      author_label: "Marina Stee",
      body: reason
        ? `Ticket cancelled by ${userLabel}. Reason: ${reason}`
        : `Ticket cancelled by ${userLabel}.`,
      created_at: closed_at,
    };

    await ctx.db.patch(ticketId, {
      status: "cancelled",
      messages: [...ticket.messages, systemMessage],
      updated_at: closed_at,
      closed_at,
    });

    await logAudit(ctx, {
      action_type: "support_ticket.cancel",
      target_entity: "supportTickets",
      target_id: ticketId,
      payload_delta: { reason, status_before: ticket.status },
    });

    return ticketId;
  },
});
