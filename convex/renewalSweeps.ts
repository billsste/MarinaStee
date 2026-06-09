/*
 * Marina Stee — Annual Renewal Sweep Coordinator.
 *
 * A "renewal sweep" is the operator-managed workflow for the fall renewal
 * cycle. Distinct from `bulk_renew_contracts` (one-click fan-out) — a
 * sweep is a long-lived coordinated workflow:
 *
 *   1. Operator picks the expiry window (e.g. Dec 1 - Mar 31).
 *   2. System auto-selects active contracts whose effective_end lands in
 *      the window; operator deselects / adjusts priorities + per-item
 *      rate adjustments.
 *   3. Operator sets a default rate adjustment %.
 *   4. Operator hits Launch — sweep flips to in_progress, draft successor
 *      contracts are minted for each item, renewal_link_token is minted.
 *      Items stay in "pending" until the operator (or the agent) fires
 *      individual or bulk "send renewal link" actions.
 *   5. Each per-item Send → item.status = "renewal_sent" + comm dispatched.
 *   6. Boater accept (existing /onboard/[token] flow + mark_signed) →
 *      recordAcceptance flips item.status = "accepted".
 *   7. Boater explicit decline → recordDecline flips item to "declined".
 *   8. Cancel (closeSweep) → flips remaining pending items to "withdrawn".
 *
 * Acceptance % is a derived metric — the coordinator surface computes
 * it client-side from the items list.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  assertOwnedByTenant,
  logAudit,
  nextSequenceNumber,
  requireTenant,
} from "./_helpers";

// ────────────────────────────────────────────────────────────
// Shared value shapes
// ────────────────────────────────────────────────────────────

const sweepStatusV = v.union(
  v.literal("draft"),
  v.literal("in_progress"),
  v.literal("closed"),
);

const itemStatusV = v.union(
  v.literal("pending"),
  v.literal("renewal_sent"),
  v.literal("accepted"),
  v.literal("declined"),
  v.literal("no_response"),
  v.literal("withdrawn"),
);

const priorityV = v.union(
  v.literal("high"),
  v.literal("normal"),
  v.literal("low"),
);

// ────────────────────────────────────────────────────────────
// Queries
// ────────────────────────────────────────────────────────────

export const list = query({
  args: { status: v.optional(sweepStatusV) },
  handler: async (ctx, { status }) => {
    const tenantId = await requireTenant(ctx);
    if (status) {
      return await ctx.db
        .query("renewalSweeps")
        .withIndex("by_tenant_status", (q) =>
          q.eq("tenantId", tenantId).eq("status", status),
        )
        .collect();
    }
    return await ctx.db
      .query("renewalSweeps")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("renewalSweeps") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    assertOwnedByTenant(row, tenantId);
    const items = await ctx.db
      .query("renewalSweepItems")
      .withIndex("by_tenant_sweep", (q) =>
        q.eq("tenantId", tenantId).eq("sweep_id", id),
      )
      .collect();
    return { sweep: row, items };
  },
});

export const getActive = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    const inProgress = await ctx.db
      .query("renewalSweeps")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "in_progress"),
      )
      .collect();
    return inProgress[0] ?? null;
  },
});

/**
 * Back-ref query: list sweep items whose source_contract_id or
 * renewal_contract_id matches a contract id. Used by the contract detail
 * page to surface "Part of Winter 2026 sweep" + acceptance state.
 */
export const listByContract = query({
  args: { contract_id: v.id("contracts") },
  handler: async (ctx, { contract_id }) => {
    const tenantId = await requireTenant(ctx);
    const bySource = await ctx.db
      .query("renewalSweepItems")
      .withIndex("by_tenant_source_contract", (q) =>
        q.eq("tenantId", tenantId).eq("source_contract_id", contract_id),
      )
      .collect();
    const byRenewal = await ctx.db
      .query("renewalSweepItems")
      .withIndex("by_tenant_renewal_contract", (q) =>
        q.eq("tenantId", tenantId).eq("renewal_contract_id", contract_id),
      )
      .collect();
    // Dedup — a contract can be referenced from both directions in
    // weird edge cases; keep one row per item id.
    const seen = new Set<string>();
    return [...bySource, ...byRenewal].filter((r) => {
      if (seen.has(r._id)) return false;
      seen.add(r._id);
      return true;
    });
  },
});

// ────────────────────────────────────────────────────────────
// Mutations
// ────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    name: v.string(),
    window_start: v.string(),
    window_end: v.string(),
    default_rate_adjustment_pct: v.number(),
    notes: v.optional(v.string()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const now = new Date().toISOString();
    const id = await ctx.db.insert("renewalSweeps", {
      tenantId,
      name: args.name,
      window_start: args.window_start,
      window_end: args.window_end,
      default_rate_adjustment_pct: args.default_rate_adjustment_pct,
      status: "draft",
      notes: args.notes,
      created_at: now,
    });
    await logAudit(ctx, {
      action_type: "renewal_sweep.create",
      target_entity: "renewalSweeps",
      target_id: id,
      payload_delta: {
        name: args.name,
        window_start: args.window_start,
        window_end: args.window_end,
      },
      via_agent: !!args.agent_prompt,
      agent_prompt: args.agent_prompt,
    });
    return id;
  },
});

export const addContract = mutation({
  args: {
    sweep_id: v.id("renewalSweeps"),
    source_contract_id: v.id("contracts"),
    priority: v.optional(priorityV),
    rate_adjustment_pct: v.optional(v.number()),
    internal_notes: v.optional(v.string()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const sweep = await ctx.db.get(args.sweep_id);
    assertOwnedByTenant(sweep, tenantId);
    if (sweep.status === "closed") {
      throw new Error("Cannot add items to a closed sweep");
    }
    const source = await ctx.db.get(args.source_contract_id);
    assertOwnedByTenant(source, tenantId);

    // Idempotency — if the contract is already in this sweep, return
    // the existing item id rather than minting a duplicate.
    const existing = await ctx.db
      .query("renewalSweepItems")
      .withIndex("by_tenant_sweep", (q) =>
        q.eq("tenantId", tenantId).eq("sweep_id", args.sweep_id),
      )
      .collect();
    const dup = existing.find(
      (i) => i.source_contract_id === args.source_contract_id,
    );
    if (dup) return dup._id;

    const id = await ctx.db.insert("renewalSweepItems", {
      tenantId,
      sweep_id: args.sweep_id,
      source_contract_id: args.source_contract_id,
      boater_id: source.boater_id,
      priority: args.priority ?? "normal",
      rate_adjustment_pct: args.rate_adjustment_pct,
      status: "pending",
      internal_notes: args.internal_notes,
    });
    await logAudit(ctx, {
      action_type: "renewal_sweep.add_contract",
      target_entity: "renewalSweepItems",
      target_id: id,
      payload_delta: {
        sweep_id: args.sweep_id,
        source_contract_id: args.source_contract_id,
      },
      via_agent: !!args.agent_prompt,
      agent_prompt: args.agent_prompt,
    });
    return id;
  },
});

export const removeContract = mutation({
  args: {
    item_id: v.id("renewalSweepItems"),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { item_id, agent_prompt }) => {
    const tenantId = await requireTenant(ctx);
    const item = await ctx.db.get(item_id);
    assertOwnedByTenant(item, tenantId);
    await ctx.db.delete(item_id);
    await logAudit(ctx, {
      action_type: "renewal_sweep.remove_contract",
      target_entity: "renewalSweepItems",
      target_id: item_id,
      payload_delta: { sweep_id: item.sweep_id },
      via_agent: !!agent_prompt,
      agent_prompt,
    });
    return item_id;
  },
});

export const setPriority = mutation({
  args: {
    item_id: v.id("renewalSweepItems"),
    priority: priorityV,
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { item_id, priority, agent_prompt }) => {
    const tenantId = await requireTenant(ctx);
    const item = await ctx.db.get(item_id);
    assertOwnedByTenant(item, tenantId);
    await ctx.db.patch(item_id, { priority });
    await logAudit(ctx, {
      action_type: "renewal_sweep.set_priority",
      target_entity: "renewalSweepItems",
      target_id: item_id,
      payload_delta: { priority, prev_priority: item.priority },
      via_agent: !!agent_prompt,
      agent_prompt,
    });
    return item_id;
  },
});

export const setRateAdjustment = mutation({
  args: {
    item_id: v.id("renewalSweepItems"),
    rate_adjustment_pct: v.optional(v.number()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { item_id, rate_adjustment_pct, agent_prompt }) => {
    const tenantId = await requireTenant(ctx);
    const item = await ctx.db.get(item_id);
    assertOwnedByTenant(item, tenantId);
    await ctx.db.patch(item_id, { rate_adjustment_pct });
    await logAudit(ctx, {
      action_type: "renewal_sweep.set_rate_adjustment",
      target_entity: "renewalSweepItems",
      target_id: item_id,
      payload_delta: {
        rate_adjustment_pct,
        prev: item.rate_adjustment_pct,
      },
      via_agent: !!agent_prompt,
      agent_prompt,
    });
    return item_id;
  },
});

/**
 * Launch a sweep: flip status to in_progress + mint a draft successor
 * contract per pending item + stamp renewal_link_token on each item.
 *
 * The actual "send renewal link" comm fires on a per-item basis after
 * launch — this mutation only prepares the artifacts so the operator
 * can fan them out at their pace.
 */
export const launch = mutation({
  args: {
    id: v.id("renewalSweeps"),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { id, agent_prompt }) => {
    const tenantId = await requireTenant(ctx);
    const sweep = await ctx.db.get(id);
    assertOwnedByTenant(sweep, tenantId);
    if (sweep.status !== "draft") {
      throw new Error(`Cannot launch sweep — already ${sweep.status}`);
    }

    const items = await ctx.db
      .query("renewalSweepItems")
      .withIndex("by_tenant_sweep", (q) =>
        q.eq("tenantId", tenantId).eq("sweep_id", id),
      )
      .collect();

    const now = new Date().toISOString();
    const defaultPct = sweep.default_rate_adjustment_pct;
    let drafted = 0;

    for (const item of items) {
      if (item.status !== "pending") continue;
      const source = await ctx.db.get(item.source_contract_id);
      if (!source || source.tenantId !== tenantId) continue;

      const pct = item.rate_adjustment_pct ?? defaultPct;
      const newStart = addDays(source.effective_end, 1);
      const newEnd = addYears(newStart, 1);
      const newRate = source.annual_rate
        ? Math.round(source.annual_rate * (1 + pct / 100))
        : undefined;

      const seq = await nextSequenceNumber(ctx, tenantId, "K", 3001);
      const number = `K-${String(seq).padStart(4, "0")}`;
      const token = mintToken();

      const draftId = await ctx.db.insert("contracts", {
        tenantId,
        number,
        boater_id: source.boater_id,
        template_id: source.template_id,
        template_version: source.template_version,
        vessel_id: source.vessel_id,
        slip_id: source.slip_id,
        status: "draft",
        effective_start: newStart,
        effective_end: newEnd,
        annual_rate: newRate,
        billing_cadence: source.billing_cadence,
        signature_token: token,
      });

      await ctx.db.patch(item._id, {
        renewal_contract_id: draftId,
        renewal_link_token: token,
      });

      await logAudit(ctx, {
        action_type: "contract.create_via_renewal_sweep",
        target_entity: "contracts",
        target_id: draftId,
        payload_delta: {
          sweep_id: id,
          source_contract_id: item.source_contract_id,
          new_rate: newRate,
        },
        via_agent: !!agent_prompt,
        agent_prompt,
      });
      drafted += 1;
    }

    await ctx.db.patch(id, {
      status: "in_progress",
      launched_at: now,
    });

    await logAudit(ctx, {
      action_type: "renewal_sweep.launch",
      target_entity: "renewalSweeps",
      target_id: id,
      payload_delta: { drafted, total_items: items.length },
      via_agent: !!agent_prompt,
      agent_prompt,
    });

    return { sweep_id: id, drafted };
  },
});

/**
 * Stamp an item as "renewal_sent" — operator fired the renewal link.
 * The dispatch of the actual comm happens in the page layer (calls into
 * communications.send), this mutation just records the lifecycle bit.
 */
export const markItemSent = mutation({
  args: {
    item_id: v.id("renewalSweepItems"),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { item_id, agent_prompt }) => {
    const tenantId = await requireTenant(ctx);
    const item = await ctx.db.get(item_id);
    assertOwnedByTenant(item, tenantId);
    if (item.status !== "pending" && item.status !== "renewal_sent") {
      throw new Error(`Cannot send — item is ${item.status}`);
    }
    const now = new Date().toISOString();
    await ctx.db.patch(item_id, { status: "renewal_sent", sent_at: now });
    await logAudit(ctx, {
      action_type: "renewal_sweep.send_item",
      target_entity: "renewalSweepItems",
      target_id: item_id,
      payload_delta: { sweep_id: item.sweep_id },
      via_agent: !!agent_prompt,
      agent_prompt,
    });
    return item_id;
  },
});

export const recordAcceptance = mutation({
  args: {
    renewal_contract_id: v.id("contracts"),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { renewal_contract_id, agent_prompt }) => {
    const tenantId = await requireTenant(ctx);
    // Find the item whose renewal_contract_id matches.
    const matches = await ctx.db
      .query("renewalSweepItems")
      .withIndex("by_tenant_renewal_contract", (q) =>
        q
          .eq("tenantId", tenantId)
          .eq("renewal_contract_id", renewal_contract_id),
      )
      .collect();
    const item = matches[0];
    if (!item) {
      // Not part of any sweep — caller can safely ignore.
      return null;
    }
    const now = new Date().toISOString();
    await ctx.db.patch(item._id, {
      status: "accepted",
      responded_at: now,
    });
    await logAudit(ctx, {
      action_type: "renewal_sweep.record_acceptance",
      target_entity: "renewalSweepItems",
      target_id: item._id,
      payload_delta: {
        sweep_id: item.sweep_id,
        renewal_contract_id,
      },
      via_agent: !!agent_prompt,
      agent_prompt,
    });
    return item._id;
  },
});

export const recordDecline = mutation({
  args: {
    item_id: v.id("renewalSweepItems"),
    decline_notes: v.optional(v.string()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { item_id, decline_notes, agent_prompt }) => {
    const tenantId = await requireTenant(ctx);
    const item = await ctx.db.get(item_id);
    assertOwnedByTenant(item, tenantId);
    const now = new Date().toISOString();
    await ctx.db.patch(item_id, {
      status: "declined",
      responded_at: now,
      internal_notes: decline_notes ?? item.internal_notes,
    });
    await logAudit(ctx, {
      action_type: "renewal_sweep.record_decline",
      target_entity: "renewalSweepItems",
      target_id: item_id,
      payload_delta: { sweep_id: item.sweep_id },
      via_agent: !!agent_prompt,
      agent_prompt,
    });
    return item_id;
  },
});

/**
 * Cancel / close a sweep. Any remaining pending or renewal_sent items
 * flip to "withdrawn" (operator) / "no_response" (closed-at-end-of-window).
 *
 * Pass `markRemainingAs` to control the behavior; defaults to "withdrawn".
 */
export const cancel = mutation({
  args: {
    id: v.id("renewalSweeps"),
    markRemainingAs: v.optional(
      v.union(v.literal("withdrawn"), v.literal("no_response")),
    ),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { id, markRemainingAs, agent_prompt }) => {
    const tenantId = await requireTenant(ctx);
    const sweep = await ctx.db.get(id);
    assertOwnedByTenant(sweep, tenantId);
    if (sweep.status === "closed") return id;

    const items = await ctx.db
      .query("renewalSweepItems")
      .withIndex("by_tenant_sweep", (q) =>
        q.eq("tenantId", tenantId).eq("sweep_id", id),
      )
      .collect();

    const terminal = markRemainingAs ?? "withdrawn";
    const now = new Date().toISOString();
    let flipped = 0;
    for (const item of items) {
      if (
        item.status === "accepted" ||
        item.status === "declined" ||
        item.status === "withdrawn" ||
        item.status === "no_response"
      ) {
        continue;
      }
      await ctx.db.patch(item._id, {
        status: terminal,
        responded_at: now,
      });
      flipped += 1;
    }

    await ctx.db.patch(id, { status: "closed", closed_at: now });

    await logAudit(ctx, {
      action_type: "renewal_sweep.cancel",
      target_entity: "renewalSweeps",
      target_id: id,
      payload_delta: { items_flipped: flipped, terminal_status: terminal },
      via_agent: !!agent_prompt,
      agent_prompt,
    });
    return id;
  },
});

// ────────────────────────────────────────────────────────────
// Helpers — date math + token mint, duplicated from
// convex/bulkRenewals.ts since both modules are leaf nodes that
// need the same pure helpers. Keep in sync with that module.
// ────────────────────────────────────────────────────────────

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function addYears(iso: string, years: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function mintToken(): string {
  return `rsw_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
}
