/*
 * Audit log reader. The append-side lives in convex/_helpers.ts → logAudit.
 *
 * Consumers:
 *  - components/settings/audit-log-view.tsx  → the operator-facing
 *    Audit Log Explorer (filter sidebar + virtualized rows + row drawer).
 *  - components/dashboard/agent-brief.tsx    → "agent activity since
 *    your last visit" rail on the dashboard.
 *
 * Queries here are read-only. Every one calls `requireTenant` first so a
 * tenant can never observe another tenant's rows — the index is keyed on
 * `tenantId` so the scope is enforced at the query layer as well.
 *
 * Provenance flags (`via_bulk`, `via_closeout`) are encoded in the
 * `action_type` itself rather than as schema columns: bulk writes use
 * `*_via_bulk` (see convex/bulkRenewals.ts, convex/bulkBilling.ts,
 * convex/bulkComms.ts) and WO closeout chain writes are
 * `work_order.closeout.*` (see convex/_closeout.ts). The explorer reads
 * those substrings to drive the provenance filters + chip colors.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireTenant } from "./_helpers";

// ────────────────────────────────────────────────────────────
// list — legacy entry point. Preserved for components/dashboard/agent-brief
// and any caller that just wants the most-recent N rows without filters.
// ────────────────────────────────────────────────────────────

export const list = query({
  args: {
    actorUserId: v.optional(v.string()),
    actionType: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { actorUserId, actionType, limit }) => {
    const tenantId = await requireTenant(ctx);
    let q;
    if (actorUserId) {
      q = ctx.db
        .query("auditLog")
        .withIndex("by_tenant_actor", (idx) =>
          idx.eq("tenantId", tenantId).eq("actor_user_id", actorUserId),
        );
    } else if (actionType) {
      q = ctx.db
        .query("auditLog")
        .withIndex("by_tenant_action", (idx) =>
          idx.eq("tenantId", tenantId).eq("action_type", actionType),
        );
    } else {
      q = ctx.db
        .query("auditLog")
        .withIndex("by_tenant_created_at", (idx) =>
          idx.eq("tenantId", tenantId),
        );
    }
    return await q.order("desc").take(limit ?? 200);
  },
});

export const recentAgentActions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const tenantId = await requireTenant(ctx);
    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_tenant_created_at", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(500);
    return rows.filter((r) => r.via_agent).slice(0, limit ?? 50);
  },
});

// ────────────────────────────────────────────────────────────
// search — explorer surface. Multi-axis filter + free-text + cursor
// pagination. Returns { rows, hasMore, nextCursor }.
//
// Pagination model: cursor is the `created_at` ISO of the oldest row in
// the previous page. Convex's by_tenant_created_at index is sorted desc
// so we take an extra row to detect hasMore, then trim. This is fine for
// audit-log scale (a busy marina writes ~thousands/day, not millions).
//
// Free-text search: substring (case-insensitive) across action_type,
// target_entity, target_id, actor_label, agent_prompt, and the raw
// payload_delta JSON. No FTS index — this prototype reads the recent
// window (default 500 rows) and filters in-memory. Once a marina starts
// pushing past ~50k rows/month, swap to a Convex search index on
// action_type + agent_prompt (Phase 8 work).
// ────────────────────────────────────────────────────────────

export const search = query({
  args: {
    // Free-text query — case-insensitive substring across action_type,
    // target_id, target_entity, actor_label, agent_prompt, payload_delta.
    text: v.optional(v.string()),
    // Filter facets — undefined means "any". For check-list facets
    // (entities, provenance) callers pass arrays; an empty array means
    // "no row matches" (UI convention) so we treat it as "any" instead.
    actorUserId: v.optional(v.string()),
    entities: v.optional(v.array(v.string())),
    actionTypeContains: v.optional(v.string()),
    fromIso: v.optional(v.string()),
    toIso: v.optional(v.string()),
    viaAgent: v.optional(v.boolean()),
    viaBulk: v.optional(v.boolean()),
    viaCloseout: v.optional(v.boolean()),
    // Pagination
    cursor: v.optional(v.string()), // created_at of last row from previous page
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const pageSize = Math.min(args.pageSize ?? 50, 200);

    // Read a generous window (5× page size, capped) so client-side
    // filters survive multiple consecutive pages of misses. For the
    // prototype's data scale (~hundreds of rows in seeds) this is fine;
    // when tenants start crossing 10k+ rows we'll cut over to a Convex
    // search index keyed on action_type + agent_prompt.
    const windowSize = Math.min(Math.max(pageSize * 5, 200), 1000);

    let q;
    if (args.actorUserId) {
      q = ctx.db
        .query("auditLog")
        .withIndex("by_tenant_actor", (idx) =>
          idx
            .eq("tenantId", tenantId)
            .eq("actor_user_id", args.actorUserId as string),
        );
    } else {
      q = ctx.db
        .query("auditLog")
        .withIndex("by_tenant_created_at", (idx) =>
          idx.eq("tenantId", tenantId),
        );
    }

    const raw = await q.order("desc").take(windowSize);

    // Apply in-memory filters. Sequencing: cheapest first so we short-
    // circuit before the text scan.
    const lc = args.text?.trim().toLowerCase();
    const entitySet =
      args.entities && args.entities.length > 0
        ? new Set(args.entities)
        : null;

    const filtered = raw.filter((r) => {
      // Date range
      if (args.fromIso && r.created_at < args.fromIso) return false;
      if (args.toIso && r.created_at > args.toIso) return false;
      // Cursor — skip rows we've already returned
      if (args.cursor && r.created_at >= args.cursor) return false;
      // Entity facet
      if (entitySet && !entitySet.has(r.target_entity)) return false;
      // Action type substring
      if (
        args.actionTypeContains &&
        !r.action_type
          .toLowerCase()
          .includes(args.actionTypeContains.toLowerCase())
      ) {
        return false;
      }
      // Provenance — via_agent is a real column; via_bulk + via_closeout
      // are encoded in action_type strings (see file header).
      if (args.viaAgent === true && !r.via_agent) return false;
      if (args.viaAgent === false && r.via_agent) return false;
      if (args.viaBulk === true && !r.action_type.includes("_via_bulk"))
        return false;
      if (args.viaBulk === false && r.action_type.includes("_via_bulk"))
        return false;
      if (
        args.viaCloseout === true &&
        !r.action_type.includes(".closeout.")
      )
        return false;
      if (
        args.viaCloseout === false &&
        r.action_type.includes(".closeout.")
      )
        return false;
      // Free-text — last because it's the most expensive
      if (lc) {
        const hay = [
          r.action_type,
          r.target_entity,
          r.target_id ?? "",
          r.actor_label,
          r.agent_prompt ?? "",
          r.payload_delta ?? "",
        ]
          .join("\n")
          .toLowerCase();
        if (!hay.includes(lc)) return false;
      }
      return true;
    });

    const page = filtered.slice(0, pageSize);
    const hasMore = filtered.length > pageSize || raw.length === windowSize;
    const nextCursor =
      page.length > 0 ? page[page.length - 1].created_at : undefined;

    return { rows: page, hasMore, nextCursor };
  },
});

// ────────────────────────────────────────────────────────────
// getById — single row for drawer detail. Tenant-scoped via the index
// fetch; if a caller asks for a row in a different tenant we throw.
// ────────────────────────────────────────────────────────────

export const getById = query({
  args: { id: v.id("auditLog") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    if (!row) return null;
    if (row.tenantId !== tenantId) {
      // Cross-tenant access — return null rather than throw so the
      // drawer can render "not found" instead of crashing the page.
      return null;
    }
    return row;
  },
});

// ────────────────────────────────────────────────────────────
// listByTarget — every audit row for one entity, chronological.
// Drives the "previous + next entry for the same target" related-
// context block in the drawer. Capped at 500 rows since this is a
// drawer-side context view, not the primary log surface.
// ────────────────────────────────────────────────────────────

export const listByTarget = query({
  args: {
    targetEntity: v.string(),
    targetId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { targetEntity, targetId, limit }) => {
    const tenantId = await requireTenant(ctx);
    // No (tenant, target_entity, target_id) index — small enough to scan
    // the by_tenant_created_at window. Capped at 1000 so a chatty target
    // can't degrade the drawer's open latency.
    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_tenant_created_at", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(1000);
    return rows
      .filter(
        (r) =>
          r.target_entity === targetEntity && r.target_id === targetId,
      )
      .slice(0, limit ?? 100);
  },
});
