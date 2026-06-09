/*
 * Vendors — AP-side counterparts to boaters.
 *
 * Mirrors `lib/types.ts → Vendor`. List + basic CRUD for the /vendors
 * page's vendor roster section. Bills (lib/types.ts → Bill) move to
 * Convex in a follow-up — vendors land first because they have no
 * forward references on other tables besides Bill.
 *
 * Every function gates on `requireTenant` and every mutation writes a
 * `logAudit` row per CLAUDE.md §2.3.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

const paymentTermsV = v.union(
  v.literal("due_on_receipt"),
  v.literal("net_7"),
  v.literal("net_15"),
  v.literal("net_30"),
  v.literal("net_60"),
);

export const list = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, { activeOnly }) => {
    const tenantId = await requireTenant(ctx);
    if (activeOnly) {
      return await ctx.db
        .query("vendors")
        .withIndex("by_tenant_active", (q) =>
          q.eq("tenantId", tenantId).eq("active", true),
        )
        .collect();
    }
    return await ctx.db
      .query("vendors")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("vendors") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    assertOwnedByTenant(row, tenantId);
    return row;
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    display_name: v.optional(v.string()),
    contact_name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address_line1: v.optional(v.string()),
    address_line2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    postal_code: v.optional(v.string()),
    country: v.optional(v.string()),
    payment_terms: v.optional(paymentTermsV),
    default_gl_account: v.optional(v.string()),
    tax_id_last4: v.optional(v.string()),
    issue_1099: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const id = await ctx.db.insert("vendors", {
      tenantId,
      name: args.name,
      display_name: args.display_name,
      contact_name: args.contact_name,
      email: args.email,
      phone: args.phone,
      address_line1: args.address_line1,
      address_line2: args.address_line2,
      city: args.city,
      state: args.state,
      postal_code: args.postal_code,
      country: args.country,
      payment_terms: args.payment_terms ?? "net_30",
      default_gl_account: args.default_gl_account,
      tax_id_last4: args.tax_id_last4,
      issue_1099: args.issue_1099 ?? false,
      notes: args.notes,
      active: args.active ?? true,
    });
    await logAudit(ctx, {
      action_type: "vendor.create",
      target_entity: "vendors",
      target_id: id,
      payload_delta: { name: args.name, payment_terms: args.payment_terms },
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("vendors"),
    patch: v.object({
      name: v.optional(v.string()),
      display_name: v.optional(v.string()),
      contact_name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      address_line1: v.optional(v.string()),
      address_line2: v.optional(v.string()),
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      postal_code: v.optional(v.string()),
      country: v.optional(v.string()),
      payment_terms: v.optional(paymentTermsV),
      default_gl_account: v.optional(v.string()),
      tax_id_last4: v.optional(v.string()),
      issue_1099: v.optional(v.boolean()),
      notes: v.optional(v.string()),
      active: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "vendor.update",
      target_entity: "vendors",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});

/**
 * Soft-archive — flips `active=false`. Historical bills keep their
 * `vendor_id` reference so AP reporting still resolves the row.
 * Mirror of `pos.archiveLocation`. Prefer this over `remove`.
 */
export const archive = mutation({
  args: { id: v.id("vendors") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, { active: false });
    await logAudit(ctx, {
      action_type: "vendor.archive",
      target_entity: "vendors",
      target_id: id,
    });
    return id;
  },
});

/**
 * Hard-delete a vendor. Matches mock-store `deleteVendor` — the
 * /vendors page's edit sheet has an explicit "Delete vendor"
 * affordance that the operator confirms. Bills stay; only the vendor
 * record is removed (the bill's `vendor_id` is a string, not an
 * enforced foreign key, so reporting falls back to the audit row's
 * payload_delta for the display name).
 */
export const remove = mutation({
  args: { id: v.id("vendors") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.delete(id);
    await logAudit(ctx, {
      action_type: "vendor.delete",
      target_entity: "vendors",
      target_id: id,
      payload_delta: {
        name: before.name,
        display_name: before.display_name,
      },
    });
    return id;
  },
});
