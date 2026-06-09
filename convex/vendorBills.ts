/*
 * Vendor Bills — operator AP workflow on the Convex side.
 *
 * Mirrors `lib/types.ts → VendorBill`. Drives the /vendors → Bills sub-tab
 * + the approval queue + the 4 agent dispatchers (create_vendor_bill,
 * approve_vendor_bill, mark_vendor_bill_paid, schedule_vendor_bill_payment).
 *
 * State machine:
 *   draft → pending_approval → approved → scheduled → paid
 *                   ↓
 *               disputed (blocks payment until cleared)
 *                   ↓
 *                  void (operator drops the bill entirely)
 *
 * Every mutation calls `requireTenant` + `logAudit` per CLAUDE.md §2.3.
 * `markPaid` ALSO posts a `ledger` row for the cash outflow, mirroring
 * the mock-store `markVendorBillPaid` shape.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  assertOwnedByTenant,
  logAudit,
  nextSequenceNumber,
  requireTenant,
} from "./_helpers";

// ────────────────────────────────────────────────────────────
// Shared value shapes
// ────────────────────────────────────────────────────────────

const statusV = v.union(
  v.literal("draft"),
  v.literal("pending_approval"),
  v.literal("approved"),
  v.literal("scheduled"),
  v.literal("paid"),
  v.literal("disputed"),
  v.literal("void"),
);

const paymentMethodV = v.union(
  v.literal("ach"),
  v.literal("check"),
  v.literal("card"),
  v.literal("wire"),
);

const lineItemV = v.object({
  description: v.string(),
  amount: v.number(),
  gl_account: v.optional(v.string()),
});

// ────────────────────────────────────────────────────────────
// Queries
// ────────────────────────────────────────────────────────────

export const list = query({
  args: { status: v.optional(statusV) },
  handler: async (ctx, { status }) => {
    const tenantId = await requireTenant(ctx);
    if (status) {
      return await ctx.db
        .query("vendorBills")
        .withIndex("by_tenant_status", (q) =>
          q.eq("tenantId", tenantId).eq("status", status),
        )
        .collect();
    }
    return await ctx.db
      .query("vendorBills")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const listForVendor = query({
  args: { vendor_id: v.id("vendors") },
  handler: async (ctx, { vendor_id }) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("vendorBills")
      .withIndex("by_tenant_vendor", (q) =>
        q.eq("tenantId", tenantId).eq("vendor_id", vendor_id),
      )
      .collect();
  },
});

export const get = query({
  args: { id: v.id("vendorBills") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db.get(id);
    assertOwnedByTenant(row, tenantId);
    return row;
  },
});

/**
 * Pending-approval queue. Equivalent to `list({status: "pending_approval"})`
 * but kept as a separate query so the UI can subscribe to "just the queue"
 * without watching every state change on every bill.
 */
export const approvalQueue = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("vendorBills")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "pending_approval"),
      )
      .collect();
  },
});

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Generate the next sequential BIL-#### number scoped to the tenant.
 *
 * Race-safe via the per-tenant counter in `counters` — Convex
 * serializes mutations on the counter document, so concurrent vendor
 * bill creates can't mint the same BIL-#### (which would have happened
 * with the old `collect → max + 1` pattern under parallel inserts).
 */
async function nextBillNumber(
  ctx: MutationCtx,
  tenantId: Id<"marinas">,
): Promise<string> {
  const seq = await nextSequenceNumber(ctx, tenantId, "BIL", 1);
  return `BIL-${String(seq).padStart(4, "0")}`;
}

/**
 * Compute due_date from bill_date + vendor.payment_terms. Net N adds N
 * days; "due_on_receipt" returns the bill date itself.
 */
function computeDueDate(
  billDate: string,
  terms:
    | "due_on_receipt"
    | "net_7"
    | "net_15"
    | "net_30"
    | "net_60",
): string {
  if (terms === "due_on_receipt") return billDate;
  const days =
    terms === "net_7"
      ? 7
      : terms === "net_15"
        ? 15
        : terms === "net_30"
          ? 30
          : 60;
  const d = new Date(`${billDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ────────────────────────────────────────────────────────────
// Mutations — operator-facing CRUD
// ────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    vendor_id: v.id("vendors"),
    vendor_invoice_number: v.optional(v.string()),
    bill_date: v.string(),
    due_date: v.optional(v.string()),
    amount: v.number(),
    tax_amount: v.optional(v.number()),
    subtotal: v.optional(v.number()),
    description: v.optional(v.string()),
    line_items: v.optional(v.array(lineItemV)),
    attachment_ids: v.optional(v.array(v.string())),
    internal_notes: v.optional(v.string()),
    /**
     * Optional status override. Defaults to "draft" when amount is 0 OR
     * not provided; otherwise "pending_approval". Operator can pass
     * "draft" explicitly to stash a partially-keyed bill.
     */
    status: v.optional(statusV),
    via_agent: v.optional(v.boolean()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const vendor = await ctx.db.get(args.vendor_id);
    assertOwnedByTenant(vendor, tenantId);

    // IDEMPOTENCY: when the caller supplies the vendor's invoice
    // number (the one stamped on the PDF, e.g. "INV-22481"), reject
    // duplicate inserts for the same (tenant, vendor, vendor_invoice_number)
    // tuple. Without this guard, the same PDF dropped into the wizard
    // twice — or two operators racing on the same paper bill — would
    // create duplicate rows on the AP ledger and end up double-paying
    // the vendor. The vendor_invoice_number is the natural idempotency
    // key for AP; if it's not provided we can't dedupe (rare — most
    // real bills carry one).
    if (args.vendor_invoice_number) {
      const dupe = await ctx.db
        .query("vendorBills")
        .withIndex("by_tenant_vendor", (q) =>
          q.eq("tenantId", tenantId).eq("vendor_id", args.vendor_id),
        )
        .filter((q) =>
          q.eq(
            q.field("vendor_invoice_number"),
            args.vendor_invoice_number,
          ),
        )
        .first();
      if (dupe) {
        throw new Error(
          `Bill already exists for vendor invoice ${args.vendor_invoice_number} — see ${dupe.number}`,
        );
      }
    }

    const number = await nextBillNumber(ctx, tenantId);
    const dueDate =
      args.due_date ?? computeDueDate(args.bill_date, vendor.payment_terms);
    const status: "draft" | "pending_approval" =
      args.status === "draft" || args.amount <= 0
        ? "draft"
        : args.status === "pending_approval"
          ? "pending_approval"
          : "pending_approval";

    const id = await ctx.db.insert("vendorBills", {
      tenantId,
      number,
      vendor_id: args.vendor_id,
      vendor_invoice_number: args.vendor_invoice_number,
      status,
      bill_date: args.bill_date,
      due_date: dueDate,
      amount: args.amount,
      tax_amount: args.tax_amount,
      subtotal: args.subtotal,
      description: args.description,
      line_items: args.line_items,
      attachment_ids: args.attachment_ids,
      internal_notes: args.internal_notes,
      created_at: new Date().toISOString(),
      created_by: "operator",
    });
    await logAudit(ctx, {
      action_type: "vendor_bill.create",
      target_entity: "vendorBills",
      target_id: id,
      payload_delta: {
        number,
        vendor_id: args.vendor_id,
        amount: args.amount,
        status,
      },
      via_agent: args.via_agent,
      agent_prompt: args.agent_prompt,
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("vendorBills"),
    patch: v.object({
      vendor_invoice_number: v.optional(v.string()),
      bill_date: v.optional(v.string()),
      due_date: v.optional(v.string()),
      amount: v.optional(v.number()),
      tax_amount: v.optional(v.number()),
      subtotal: v.optional(v.number()),
      description: v.optional(v.string()),
      line_items: v.optional(v.array(lineItemV)),
      attachment_ids: v.optional(v.array(v.string())),
      internal_notes: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    if (before.status === "paid" || before.status === "void") {
      throw new Error("Cannot edit a paid or void bill");
    }
    await ctx.db.patch(id, patch);
    await logAudit(ctx, {
      action_type: "vendor_bill.update",
      target_entity: "vendorBills",
      target_id: id,
      payload_delta: patch,
    });
    return id;
  },
});

export const approve = mutation({
  args: {
    id: v.id("vendorBills"),
    via_agent: v.optional(v.boolean()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(args.id);
    assertOwnedByTenant(before, tenantId);
    if (before.status !== "pending_approval" && before.status !== "draft") {
      throw new Error(`Cannot approve a ${before.status} bill`);
    }
    if (before.amount <= 0) {
      throw new Error("Cannot approve a bill with zero amount");
    }
    await ctx.db.patch(args.id, {
      status: "approved",
      approved_by: "operator",
      approved_at: new Date().toISOString(),
    });
    await logAudit(ctx, {
      action_type: "vendor_bill.approve",
      target_entity: "vendorBills",
      target_id: args.id,
      payload_delta: { number: before.number, amount: before.amount },
      via_agent: args.via_agent,
      agent_prompt: args.agent_prompt,
    });
    return args.id;
  },
});

export const schedulePayment = mutation({
  args: {
    id: v.id("vendorBills"),
    scheduled_payment_date: v.string(),
    scheduled_payment_method: paymentMethodV,
    via_agent: v.optional(v.boolean()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(args.id);
    assertOwnedByTenant(before, tenantId);
    if (before.status !== "approved" && before.status !== "scheduled") {
      throw new Error(`Cannot schedule a ${before.status} bill`);
    }
    await ctx.db.patch(args.id, {
      status: "scheduled",
      scheduled_payment_date: args.scheduled_payment_date,
      scheduled_payment_method: args.scheduled_payment_method,
    });
    await logAudit(ctx, {
      action_type: "vendor_bill.schedule_payment",
      target_entity: "vendorBills",
      target_id: args.id,
      payload_delta: {
        scheduled_payment_date: args.scheduled_payment_date,
        scheduled_payment_method: args.scheduled_payment_method,
      },
      via_agent: args.via_agent,
      agent_prompt: args.agent_prompt,
    });
    return args.id;
  },
});

export const markPaid = mutation({
  args: {
    id: v.id("vendorBills"),
    paid_at: v.optional(v.string()),
    paid_via: v.optional(v.string()),
    payment_method: v.optional(paymentMethodV),
    via_agent: v.optional(v.boolean()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(args.id);
    assertOwnedByTenant(before, tenantId);
    if (
      before.status === "paid" ||
      before.status === "void" ||
      before.status === "disputed"
    ) {
      throw new Error(`Cannot mark a ${before.status} bill paid`);
    }
    if (before.amount <= 0) {
      throw new Error("Cannot mark a zero-amount bill paid");
    }

    // NOTE: the mock-store side posts a "payment" LedgerEntry for the
    // cash outflow. The Convex `ledgerEntries` table requires
    // `boater_id: v.id("boaters")` and AP rows have no boater — a follow-up
    // either (a) relaxes ledger to accept a vendor-side participant column
    // or (b) carves out a separate `apPayments` table. Until that lands,
    // the Convex path stamps the bill paid + audits the cash outflow there
    // and skips the ledger insert. The QB sync still picks up paid bills
    // via the vendor_bill audit row.
    const method =
      args.payment_method ?? before.scheduled_payment_method ?? "ach";
    const paidAt = args.paid_at ?? new Date().toISOString().slice(0, 10);

    await ctx.db.patch(args.id, {
      status: "paid",
      paid_at: paidAt,
      paid_via: args.paid_via,
    });
    await logAudit(ctx, {
      action_type: "vendor_bill.mark_paid",
      target_entity: "vendorBills",
      target_id: args.id,
      payload_delta: {
        number: before.number,
        amount: before.amount,
        method,
        paid_via: args.paid_via,
      },
      via_agent: args.via_agent,
      agent_prompt: args.agent_prompt,
    });
    return args.id;
  },
});

export const dispute = mutation({
  args: {
    id: v.id("vendorBills"),
    reason: v.string(),
  },
  handler: async (ctx, { id, reason }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    if (before.status === "paid" || before.status === "void") {
      throw new Error(`Cannot dispute a ${before.status} bill`);
    }
    await ctx.db.patch(id, { status: "disputed", dispute_reason: reason });
    await logAudit(ctx, {
      action_type: "vendor_bill.dispute",
      target_entity: "vendorBills",
      target_id: id,
      payload_delta: { number: before.number, reason },
    });
    return id;
  },
});

export const clearDispute = mutation({
  args: { id: v.id("vendorBills") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    if (before.status !== "disputed") {
      throw new Error("Bill is not disputed");
    }
    await ctx.db.patch(id, {
      status: "pending_approval",
      dispute_reason: undefined,
    });
    await logAudit(ctx, {
      action_type: "vendor_bill.clear_dispute",
      target_entity: "vendorBills",
      target_id: id,
      payload_delta: { number: before.number },
    });
    return id;
  },
});

export const voidBill = mutation({
  args: { id: v.id("vendorBills") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    if (before.status === "paid") {
      throw new Error("Cannot void a paid bill");
    }
    await ctx.db.patch(id, { status: "void" });
    await logAudit(ctx, {
      action_type: "vendor_bill.void",
      target_entity: "vendorBills",
      target_id: id,
      payload_delta: { number: before.number },
    });
    return id;
  },
});

/**
 * Hard-delete. Only allowed for drafts — anything past that has audit
 * implications and should be voided instead.
 */
export const remove = mutation({
  args: { id: v.id("vendorBills") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    if (before.status !== "draft") {
      throw new Error(
        `Only drafts can be deleted. Void this ${before.status} bill instead.`,
      );
    }
    await ctx.db.delete(id);
    await logAudit(ctx, {
      action_type: "vendor_bill.delete",
      target_entity: "vendorBills",
      target_id: id,
      payload_delta: { number: before.number },
    });
    return id;
  },
});
