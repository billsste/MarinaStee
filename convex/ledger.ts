import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  assertOwnedByTenant,
  logAudit,
  nextSequenceNumber,
  requireTenant,
} from "./_helpers";

const ledgerTypeV = v.union(
  v.literal("invoice"),
  v.literal("payment"),
  v.literal("refund"),
  v.literal("credit"),
  v.literal("adjustment"),
);

const ledgerStatusV = v.union(
  v.literal("open"),
  v.literal("paid"),
  v.literal("void"),
  v.literal("partial"),
);

const paymentMethodV = v.union(
  v.literal("card"),
  v.literal("cash"),
  v.literal("check"),
  v.literal("ach"),
  v.literal("charge_to_account"),
);

export const list = query({
  args: {
    boaterId: v.optional(v.id("boaters")),
    status: v.optional(ledgerStatusV),
  },
  handler: async (ctx, { boaterId, status }) => {
    const tenantId = await requireTenant(ctx);
    if (boaterId && status) {
      return await ctx.db
        .query("ledgerEntries")
        .withIndex("by_tenant_boater_status", (q) =>
          q
            .eq("tenantId", tenantId)
            .eq("boater_id", boaterId)
            .eq("status", status),
        )
        .collect();
    }
    if (status) {
      return await ctx.db
        .query("ledgerEntries")
        .withIndex("by_tenant_status", (q) =>
          q.eq("tenantId", tenantId).eq("status", status),
        )
        .collect();
    }
    return await ctx.db
      .query("ledgerEntries")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("ledgerEntries") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    assertOwnedByTenant(row, tenantId);
    return row;
  },
});

/**
 * Open A/R aggregation — used by query_open_balances tool + the
 * dashboard KPI strip. Returns ranked boaters with non-zero balances.
 */
export const openBalancesByBoater = query({
  args: { minAmount: v.optional(v.number()) },
  handler: async (ctx, { minAmount }) => {
    const tenantId = await requireTenant(ctx);
    const invoices = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "open"),
      )
      .collect();
    const byBoater = new Map<string, number>();
    for (const inv of invoices) {
      if (inv.type !== "invoice") continue;
      byBoater.set(
        inv.boater_id,
        (byBoater.get(inv.boater_id) ?? 0) + inv.open_balance,
      );
    }
    const min = minAmount ?? 0;
    const rows: Array<{ boater_id: string; open: number }> = [];
    for (const [boaterId, open] of byBoater) {
      if (open >= min && open > 0) rows.push({ boater_id: boaterId, open });
    }
    rows.sort((a, b) => b.open - a.open);
    return rows;
  },
});

export const recordPayment = mutation({
  args: {
    boater_id: v.id("boaters"),
    amount: v.number(),
    method: paymentMethodV,
    notes: v.optional(v.string()),
    applied_to_invoice_ids: v.optional(v.array(v.id("ledgerEntries"))),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const boater = await ctx.db.get(args.boater_id);
    assertOwnedByTenant(boater, tenantId);
    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const seq = await nextSequenceNumber(ctx, tenantId, "PMT", 1001);
    const number = `PMT-${String(seq).padStart(4, "0")}`;
    const id = await ctx.db.insert("ledgerEntries", {
      tenantId,
      boater_id: args.boater_id,
      type: "payment",
      number,
      date: now.slice(0, 10),
      amount: args.amount,
      open_balance: 0,
      method: args.method,
      status: "paid",
      applied_to_invoice_ids: args.applied_to_invoice_ids,
      refund_notes: args.notes,
    });
    // Apply against open invoices (oldest first) if no explicit targets
    let remaining = args.amount;
    const targets = args.applied_to_invoice_ids ?? [];
    if (targets.length === 0) {
      const openInvoices = await ctx.db
        .query("ledgerEntries")
        .withIndex("by_tenant_boater_status", (q) =>
          q
            .eq("tenantId", tenantId)
            .eq("boater_id", args.boater_id)
            .eq("status", "open"),
        )
        .collect();
      const sorted = openInvoices
        .filter((e) => e.type === "invoice")
        .sort((a, b) => a.date.localeCompare(b.date));
      for (const inv of sorted) {
        if (remaining <= 0) break;
        const apply = Math.min(remaining, inv.open_balance);
        const newOpen = inv.open_balance - apply;
        await ctx.db.patch(inv._id, {
          open_balance: newOpen,
          status: newOpen <= 0 ? "paid" : "partial",
        });
        remaining -= apply;
      }
    }
    await logAudit(ctx, {
      action_type: "payment.record",
      target_entity: "ledgerEntries",
      target_id: id,
      payload_delta: { amount: args.amount, method: args.method },
    });
    return id;
  },
});

export const chargeToAccount = mutation({
  args: {
    boater_id: v.id("boaters"),
    location_id: v.id("posLocations"),
    line: v.object({ name: v.string(), price: v.number(), sku: v.string() }),
  },
  handler: async (ctx, { boater_id, location_id, line }) => {
    const tenantId = await requireTenant(ctx);
    const boater = await ctx.db.get(boater_id);
    assertOwnedByTenant(boater, tenantId);
    const location = await ctx.db.get(location_id);
    assertOwnedByTenant(location, tenantId);
    const subtotal = line.price;
    const tax = Math.round(subtotal * location.default_tax_rate * 100) / 100;
    const total = subtotal + tax;
    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const seq = await nextSequenceNumber(ctx, tenantId, "INV", 2001);
    const number = `INV-${String(seq).padStart(4, "0")}`;
    const invoiceId = await ctx.db.insert("ledgerEntries", {
      tenantId,
      boater_id,
      type: "invoice",
      number,
      date: now.slice(0, 10),
      amount: total,
      open_balance: total,
      status: "open",
      line_items: [{ description: line.name, amount: subtotal }],
    });
    await logAudit(ctx, {
      action_type: "ledger.charge_to_account",
      target_entity: "ledgerEntries",
      target_id: invoiceId,
      payload_delta: { boater_id, amount: total, item: line.name },
    });
    return invoiceId;
  },
});
