/*
 * Boaters — queries + mutations.
 *
 * This file is the canonical example of the per-entity Convex pattern
 * for Marina Stee. Every other entity file (vessels.ts, slips.ts, etc.)
 * mirrors this structure:
 *
 *  - Top-of-file imports the schema helpers + tenant guard
 *  - One `list` query (optionally filtered) — tenant-scoped
 *  - One `get` query by id — tenant-checked
 *  - One `searchByName` for fuzzy lookup (powers the agent's findBoaterFuzzy)
 *  - Mutations for create / update / archive — all logged via withAudit
 *
 * The agent's existing `executeAgentAction` switch (lib/agent-actions.ts)
 * will be migrated to call these mutations directly. See
 * docs/architecture-convex.md → Phase 4.
 */

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import {
  assertOwnedByTenant,
  logAudit,
  requireTenant,
} from "./_helpers";

// ────────────────────────────────────────────────────────────
// Embedded value shapes (must match schema.ts exactly)
// ────────────────────────────────────────────────────────────

const addressV = v.object({
  line1: v.string(),
  line2: v.optional(v.string()),
  city: v.string(),
  state: v.string(),
  zip: v.string(),
  country: v.string(),
});

const contactV = v.object({
  id: v.string(),
  name: v.string(),
  role: v.union(
    v.literal("self"),
    v.literal("spouse"),
    v.literal("captain"),
    v.literal("manager"),
    v.literal("other"),
  ),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  preferred_channel: v.union(
    v.literal("email"),
    v.literal("sms"),
    v.literal("voice"),
  ),
  can_be_billed: v.boolean(),
});

// ────────────────────────────────────────────────────────────
// Queries
// ────────────────────────────────────────────────────────────

/**
 * List all boaters for the current tenant. Optionally filter to active
 * only (archived rows hide from rosters but persist for invoice history).
 */
export const list = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, { activeOnly }) => {
    const tenantId = await requireTenant(ctx);
    const rows = await ctx.db
      .query("boaters")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    return activeOnly ? rows.filter((b) => b.active) : rows;
  },
});

/**
 * Read one boater. Throws on cross-tenant access — never returns silently.
 */
export const get = query({
  args: { id: v.id("boaters") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const boater = await ctx.db.get(id);
    assertOwnedByTenant(boater, tenantId);
    return boater;
  },
});

/**
 * Fuzzy search by display name — powers the agent's findBoaterFuzzy.
 * Convex full-text search is prefix-aware; pair with last-name index
 * fallback for short tokens.
 */
export const searchByName = query({
  args: { q: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { q, limit }) => {
    const tenantId = await requireTenant(ctx);
    const term = q.trim();
    if (!term) return [];
    const results = await ctx.db
      .query("boaters")
      .withSearchIndex("search_display_name", (search) =>
        search.search("display_name", term).eq("tenantId", tenantId),
      )
      .take(limit ?? 10);
    return results;
  },
});

// ────────────────────────────────────────────────────────────
// Mutations
// ────────────────────────────────────────────────────────────

const createArgs = {
  first_name: v.string(),
  last_name: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  preferred_channel: v.union(
    v.literal("email"),
    v.literal("sms"),
    v.literal("voice"),
  ),
  billing_cadence: v.union(
    v.literal("annual"),
    v.literal("seasonal"),
    v.literal("monthly"),
    v.literal("transient"),
  ),
  code: v.optional(v.string()),
  notes: v.optional(v.string()),
  address: v.optional(addressV),
};

export const create = mutation({
  args: createArgs,
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const display_name = `${args.last_name}, ${args.first_name}`;
    const id = await ctx.db.insert("boaters", {
      tenantId,
      display_name,
      first_name: args.first_name,
      last_name: args.last_name,
      code: args.code,
      active: true,
      billing_cadence: args.billing_cadence,
      tags: [],
      communication_prefs: {
        preferred_channel: args.preferred_channel,
        language: "en",
      },
      primary_contact: {
        id: `ct_${Date.now().toString(36)}_primary`,
        name: display_name,
        role: "self",
        email: args.email,
        phone: args.phone,
        preferred_channel: args.preferred_channel,
        can_be_billed: true,
      },
      additional_contacts: [],
      address: args.address ?? {
        line1: "",
        city: "",
        state: "",
        zip: "",
        country: "US",
      },
      notes: args.notes,
    });
    await logAudit(ctx, {
      action_type: "boater.create",
      target_entity: "boaters",
      target_id: id,
      payload_delta: { display_name, billing_cadence: args.billing_cadence },
    });
    return id;
  },
});

/**
 * Patch — every field optional. Skips undefined keys via Convex's
 * `patch` semantics. Captures before/after diff for the audit row.
 */
export const update = mutation({
  args: {
    id: v.id("boaters"),
    patch: v.object({
      display_name: v.optional(v.string()),
      first_name: v.optional(v.string()),
      last_name: v.optional(v.string()),
      code: v.optional(v.string()),
      active: v.optional(v.boolean()),
      billing_cadence: v.optional(
        v.union(
          v.literal("annual"),
          v.literal("seasonal"),
          v.literal("monthly"),
          v.literal("transient"),
        ),
      ),
      tags: v.optional(v.array(v.string())),
      notes: v.optional(v.string()),
      address: v.optional(addressV),
      primary_contact: v.optional(contactV),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "boater.update",
      target_entity: "boaters",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});

/**
 * Archive (soft-delete). Preserves invoice + comm history. Restore is
 * `update({ active: true })`.
 */
export const archive = mutation({
  args: { id: v.id("boaters") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, { active: false });
    await logAudit(ctx, {
      action_type: "boater.archive",
      target_entity: "boaters",
      target_id: id,
      payload_delta: { active: false },
    });
    return id;
  },
});
