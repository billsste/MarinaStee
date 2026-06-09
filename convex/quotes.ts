import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  assertOwnedByTenant,
  logAudit,
  nextSequenceNumber,
  requireTenant,
} from "./_helpers";

const quoteStatusV = v.union(
  v.literal("draft"),
  v.literal("sent"),
  v.literal("signed"),
  v.literal("declined"),
  v.literal("expired"),
);

const lineItemV = v.object({
  id: v.string(),
  kind: v.union(
    v.literal("part"),
    v.literal("labor"),
    v.literal("fee"),
    v.literal("discount"),
  ),
  description: v.string(),
  qty: v.number(),
  unit_price: v.number(),
  total: v.number(),
  taxable: v.boolean(),
});

export const forWorkOrder = query({
  args: { workOrderId: v.id("workOrders") },
  handler: async (ctx, { workOrderId }) => {
    await requireTenant(ctx);
    return await ctx.db
      .query("quotes")
      .withIndex("by_work_order", (q) => q.eq("work_order_id", workOrderId))
      .unique();
  },
});

export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    // Public — used by /sign/[token]
    return await ctx.db
      .query("quotes")
      .withIndex("by_signature_token", (q) => q.eq("signature_token", token))
      .unique();
  },
});

export const createDraft = mutation({
  args: {
    work_order_id: v.id("workOrders"),
    line_items: v.array(lineItemV),
    tax_rate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const wo = await ctx.db.get(args.work_order_id);
    assertOwnedByTenant(wo, tenantId);
    const subtotal = args.line_items.reduce((s, l) => s + l.total, 0);
    const tax = Math.round(subtotal * (args.tax_rate ?? 0) * 100) / 100;
    const total = subtotal + tax;
    const existing = await ctx.db
      .query("quotes")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const seq = await nextSequenceNumber(ctx, tenantId, "Q", 1001);
    const number = `Q-${String(seq).padStart(4, "0")}`;
    const id = await ctx.db.insert("quotes", {
      tenantId,
      number,
      work_order_id: args.work_order_id,
      line_items: args.line_items,
      subtotal,
      tax,
      total,
      status: "draft",
    });
    // Link the work order back
    await ctx.db.patch(args.work_order_id, { quote_id: id });
    await logAudit(ctx, {
      action_type: "quote.create",
      target_entity: "quotes",
      target_id: id,
      payload_delta: { number, total },
    });
    return id;
  },
});

export const updateLines = mutation({
  args: {
    id: v.id("quotes"),
    line_items: v.array(lineItemV),
    tax_rate: v.optional(v.number()),
  },
  handler: async (ctx, { id, line_items, tax_rate }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    if (before.status !== "draft") {
      throw new Error("Only draft quotes can be edited");
    }
    const subtotal = line_items.reduce((s, l) => s + l.total, 0);
    const tax = Math.round(subtotal * (tax_rate ?? 0) * 100) / 100;
    await ctx.db.patch(id, {
      line_items,
      subtotal,
      tax,
      total: subtotal + tax,
    });
    await logAudit(ctx, {
      action_type: "quote.update",
      target_entity: "quotes",
      target_id: id,
      payload_delta: { line_count: line_items.length, total: subtotal + tax },
    });
    return id;
  },
});

export const sendForSignature = mutation({
  args: { id: v.id("quotes") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    const token = `q_${id}_${Date.now().toString(36)}`;
    await ctx.db.patch(id, {
      status: "sent",
      signature_token: token,
    });
    await logAudit(ctx, {
      action_type: "quote.send",
      target_entity: "quotes",
      target_id: id,
      payload_delta: { token },
    });
    return { id, token };
  },
});

void quoteStatusV;
