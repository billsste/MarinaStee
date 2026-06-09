import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  assertOwnedByTenant,
  logAudit,
  nextSequenceNumber,
  requireTenant,
} from "./_helpers";

const contractStatusV = v.union(
  v.literal("draft"),
  v.literal("sent"),
  v.literal("signed"),
  v.literal("active"),
  v.literal("expired"),
  v.literal("terminated"),
);

const cadenceV = v.union(
  v.literal("annual"),
  v.literal("seasonal"),
  v.literal("monthly"),
  v.literal("transient"),
);

export const list = query({
  args: {
    status: v.optional(contractStatusV),
    boaterId: v.optional(v.id("boaters")),
  },
  handler: async (ctx, { status, boaterId }) => {
    const tenantId = await requireTenant(ctx);
    if (boaterId) {
      return await ctx.db
        .query("contracts")
        .withIndex("by_tenant_boater", (q) =>
          q.eq("tenantId", tenantId).eq("boater_id", boaterId),
        )
        .collect();
    }
    if (status) {
      return await ctx.db
        .query("contracts")
        .withIndex("by_tenant_status", (q) =>
          q.eq("tenantId", tenantId).eq("status", status),
        )
        .collect();
    }
    return await ctx.db
      .query("contracts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("contracts") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    assertOwnedByTenant(row, tenantId);
    return row;
  },
});

export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    // Public — no tenant check (the token IS the auth).
    // Used by the public /sign/[token] route.
    return await ctx.db
      .query("contracts")
      .withIndex("by_signature_token", (q) => q.eq("signature_token", token))
      .unique();
  },
});

export const expiringSoon = query({
  args: { daysWindow: v.optional(v.number()) },
  handler: async (ctx, { daysWindow }) => {
    const tenantId = await requireTenant(ctx);
    const window = daysWindow ?? 90;
    const now = Date.now();
    const cutoff = now + window * 86_400_000;
    const active = await ctx.db
      .query("contracts")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "active"),
      )
      .collect();
    return active
      .filter((c) => {
        const end = new Date(c.effective_end).getTime();
        return end >= now && end <= cutoff;
      })
      .sort((a, b) => a.effective_end.localeCompare(b.effective_end));
  },
});

/**
 * List contracts that are tied to a renewal sweep (either as source or
 * as the minted successor). Used by the sweep coordinator surface to
 * resolve display data (boater, slip, rate) inline without N round trips.
 */
export const listByRenewalSweep = query({
  args: { sweep_id: v.id("renewalSweeps") },
  handler: async (ctx, { sweep_id }) => {
    const tenantId = await requireTenant(ctx);
    const items = await ctx.db
      .query("renewalSweepItems")
      .withIndex("by_tenant_sweep", (q) =>
        q.eq("tenantId", tenantId).eq("sweep_id", sweep_id),
      )
      .collect();
    const ids = new Set<string>();
    for (const i of items) {
      ids.add(i.source_contract_id);
      if (i.renewal_contract_id) ids.add(i.renewal_contract_id);
    }
    const all = await ctx.db
      .query("contracts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    return all.filter((c) => ids.has(c._id));
  },
});

export const create = mutation({
  args: {
    boater_id: v.id("boaters"),
    template_id: v.id("contractTemplates"),
    vessel_id: v.optional(v.id("vessels")),
    slip_id: v.optional(v.id("slips")),
    effective_start: v.string(),
    effective_end: v.string(),
    annual_rate: v.optional(v.number()),
    billing_cadence: cadenceV,
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const existing = await ctx.db
      .query("contracts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const seq = await nextSequenceNumber(ctx, tenantId, "K", 3001);
    const number = `K-${String(seq).padStart(4, "0")}`;
    const id = await ctx.db.insert("contracts", {
      tenantId,
      number,
      boater_id: args.boater_id,
      template_id: args.template_id,
      template_version: 1,
      vessel_id: args.vessel_id,
      slip_id: args.slip_id,
      status: "draft",
      effective_start: args.effective_start,
      effective_end: args.effective_end,
      annual_rate: args.annual_rate,
      billing_cadence: args.billing_cadence,
    });
    await logAudit(ctx, {
      action_type: "contract.create",
      target_entity: "contracts",
      target_id: id,
      payload_delta: { number, boater_id: args.boater_id },
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("contracts"),
    patch: v.object({
      status: v.optional(contractStatusV),
      vessel_id: v.optional(v.id("vessels")),
      slip_id: v.optional(v.id("slips")),
      effective_start: v.optional(v.string()),
      effective_end: v.optional(v.string()),
      annual_rate: v.optional(v.number()),
      billing_cadence: v.optional(cadenceV),
      signed_by_name: v.optional(v.string()),
      drafted_body_markdown: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "contract.update",
      target_entity: "contracts",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});

export const terminate = mutation({
  args: { id: v.id("contracts") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, { status: "terminated" });
    // Free the slip if held
    if (before.slip_id) {
      const slip = await ctx.db.get(before.slip_id);
      if (slip && slip.current_contract_id === id) {
        await ctx.db.patch(before.slip_id, {
          current_holder_boater_id: undefined,
          current_contract_id: undefined,
          occupancy_status: "vacant",
        });
      }
    }
    await logAudit(ctx, {
      action_type: "contract.terminate",
      target_entity: "contracts",
      target_id: id,
    });
    return id;
  },
});
