import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

const statusV = v.union(
  v.literal("active"),
  v.literal("expiring_soon"),
  v.literal("expired"),
  v.literal("lapsed"),
);

export const list = query({
  args: { boaterId: v.optional(v.id("boaters")) },
  handler: async (ctx, { boaterId }) => {
    const tenantId = await requireTenant(ctx);
    if (boaterId) {
      return await ctx.db
        .query("insuranceCertificates")
        .withIndex("by_tenant_boater", (q) =>
          q.eq("tenantId", tenantId).eq("boater_id", boaterId),
        )
        .collect();
    }
    return await ctx.db
      .query("insuranceCertificates")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    // Public — for /coi-upload/[token]
    return await ctx.db
      .query("insuranceCertificates")
      .withIndex("by_upload_token", (q) => q.eq("upload_token", token))
      .unique();
  },
});

/**
 * Create a fresh COI row from operator input (Insurance page "Upload
 * COI" dialog). Mock-side mints `id` client-side via `upsertInsuranceCertificate`;
 * Convex assigns its own `_id`. `coverage_amount` here is the mock's
 * `liability_limit` (Convex stores a single coverage number — the mock
 * carries the historical split between liability + hull, but the
 * convex schema doesn't have a dedicated hull column yet so it lands
 * in coverage_amount as the controlling figure).
 *
 * Tenant gating + audit are mandatory (see CLAUDE.md §2.3).
 */
export const create = mutation({
  args: {
    boater_id: v.id("boaters"),
    carrier: v.string(),
    policy_number: v.string(),
    effective_start: v.string(),
    effective_end: v.string(),
    coverage_amount: v.optional(v.number()),
    status: v.optional(statusV),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const boater = await ctx.db.get(args.boater_id);
    assertOwnedByTenant(boater, tenantId);
    const id = await ctx.db.insert("insuranceCertificates", {
      tenantId,
      boater_id: args.boater_id,
      carrier: args.carrier,
      policy_number: args.policy_number,
      effective_start: args.effective_start,
      effective_end: args.effective_end,
      coverage_amount: args.coverage_amount,
      status: args.status ?? "active",
    });
    await logAudit(ctx, {
      action_type: "coi.create",
      target_entity: "insuranceCertificates",
      target_id: id,
      payload_delta: {
        carrier: args.carrier,
        policy_number: args.policy_number,
        effective_end: args.effective_end,
      },
    });
    return id;
  },
});

/**
 * Patch an existing COI. Used by the Insurance page when an operator
 * clicks a row to edit (e.g. corrects the effective dates after a
 * renewal). Same field set as `create`, all optional.
 */
export const update = mutation({
  args: {
    id: v.id("insuranceCertificates"),
    patch: v.object({
      carrier: v.optional(v.string()),
      policy_number: v.optional(v.string()),
      effective_start: v.optional(v.string()),
      effective_end: v.optional(v.string()),
      coverage_amount: v.optional(v.number()),
      status: v.optional(statusV),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "coi.update",
      target_entity: "insuranceCertificates",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});

/**
 * Hard-delete a COI row. Matches the mock-store
 * `deleteInsuranceCertificate` semantics — the Insurance page's edit
 * dialog has a Delete affordance on existing rows. History is
 * preserved in the audit log (carrier + policy number in the delta).
 */
export const remove = mutation({
  args: { id: v.id("insuranceCertificates") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.delete(id);
    await logAudit(ctx, {
      action_type: "coi.delete",
      target_entity: "insuranceCertificates",
      target_id: id,
      payload_delta: {
        carrier: before.carrier,
        policy_number: before.policy_number,
      },
    });
    return id;
  },
});

export const requestRenewal = mutation({
  args: { id: v.id("insuranceCertificates") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    const token = `coi_${id}_${Date.now().toString(36)}`;
    await ctx.db.patch(id, { upload_token: token });
    await logAudit(ctx, {
      action_type: "coi.request_renewal",
      target_entity: "insuranceCertificates",
      target_id: id,
      payload_delta: { token },
    });
    return { id, token };
  },
});

export const upload = mutation({
  args: {
    id: v.id("insuranceCertificates"),
    carrier: v.string(),
    policy_number: v.string(),
    effective_start: v.string(),
    effective_end: v.string(),
    document_storage_id: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { id, ...patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, { ...patch, status: "active" });
    await logAudit(ctx, {
      action_type: "coi.upload",
      target_entity: "insuranceCertificates",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});
