/*
 * Marina Stee — Inbound emails (AP-bill ingest provenance).
 *
 * Drives the email path of the AP-bill ingest pipeline:
 *
 *   Postmark → /api/inbound/postmark/[tenantId] → inboundEmails.ingest
 *
 * Why this mutation is public (no requireTenant)
 * -----------------------------------------------
 * Postmark's POST is unauthenticated from our Clerk POV — there's no
 * operator session attached to the request. The webhook route still
 * verifies the Postmark signature + asserts the tenantId from the URL
 * matches a real marina; we then pass `tenantId` through to this
 * mutation explicitly (same pattern as `applications.submit`). All
 * writes here SET tenantId from the validated arg, never from session
 * context, so cross-tenant pollution is impossible.
 *
 * Why the bill insert lives here (not in vendorBills.create)
 * -----------------------------------------------------------
 * `vendorBills.create` is gated by `requireTenant` — it expects a
 * logged-in operator JWT. Webhooks have no operator. Rather than
 * carve out an unauthenticated entry point on vendorBills (which would
 * widen the AP attack surface), the ingest mutation owns its own
 * insert path and mirrors the same shape (sequence number, due-date
 * compute, duplicate-invoice guard). Audit-wise the inboundEmail row
 * IS the audit anchor for the ingest event; the resulting VendorBill
 * carries `created_by: "inbound_email"` so the approval queue UI can
 * surface provenance.
 *
 * Idempotency
 * -----------
 * Postmark retries non-2xx responses for ~24 hours. Every retry shares
 * the same `MessageID`. The route file MUST call `findByMessageId`
 * before this mutation; if a row exists with the same key, the route
 * responds 200 immediately without re-running the pipeline. As a
 * second line of defense, `ingest` itself rejects duplicates here too.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireTenant } from "./_helpers";

// ────────────────────────────────────────────────────────────
// Shared value shapes
// ────────────────────────────────────────────────────────────

const statusV = v.union(
  v.literal("ingested"),
  v.literal("matched_vendor"),
  v.literal("created_draft"),
  v.literal("failed"),
);

const lineItemV = v.object({
  description: v.string(),
  amount: v.number(),
  gl_account: v.optional(v.string()),
});

// ────────────────────────────────────────────────────────────
// Queries
// ────────────────────────────────────────────────────────────

/**
 * Tenant-scoped feed for the operator UI. Returns the most recent
 * inbound emails (newest first) so the /vendors → Inbound tab can show
 * "what landed in the AP inbox today". Bound the result to keep the
 * UI snappy — operators rarely care about anything past the last week.
 */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    // This query runs under the operator's Clerk session (the operator
    // looking at the feed), not the webhook context — so `requireTenant`
    // is safe here. The unauthenticated webhook path uses the
    // `findByMessageId` query + `ingest` mutation, both of which take
    // tenantId explicitly.
    const tenantId = await requireTenant(ctx);
    const rows = await ctx.db
      .query("inboundEmails")
      .withIndex("by_tenant_received_at", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(limit ?? 50);
    return rows;
  },
});

/**
 * Idempotency lookup — used by the webhook route BEFORE invoking
 * `ingest` so retries short-circuit without re-running Anthropic PDF
 * extraction. Returns null when no row exists.
 *
 * No tenant scoping here on purpose: the Postmark MessageID is
 * globally-unique within Postmark's namespace, and the route is the
 * one that established the tenant association on first ingest. Lookup
 * is by the natural key.
 */
export const findByMessageId = query({
  args: { postmark_message_id: v.string() },
  handler: async (ctx, { postmark_message_id }) => {
    return await ctx.db
      .query("inboundEmails")
      .withIndex("by_postmark_message_id", (q) =>
        q.eq("postmark_message_id", postmark_message_id),
      )
      .first();
  },
});

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Mint the next BIL-#### number for this tenant. Mirrors the helper in
 * convex/vendorBills.ts (deliberately not imported so the ingest path
 * has no coupling to the operator mutation module's internals).
 */
async function nextBillNumber(
  ctx: MutationCtx,
  tenantId: Id<"marinas">,
): Promise<string> {
  const all = await ctx.db
    .query("vendorBills")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  const max = all.reduce((acc, b) => {
    const m = /^BIL-(\d+)$/.exec(b.number);
    if (!m) return acc;
    return Math.max(acc, Number(m[1]));
  }, 0);
  return `BIL-${String(max + 1).padStart(4, "0")}`;
}

/**
 * Net-N due-date compute (mirrors vendorBills.computeDueDate). When the
 * extractor couldn't read a bill_date, we fall back to "today".
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

/**
 * Fuzzy-match a vendor by either:
 *   1. exact-match on `vendor.email` (cheap + high-precision)
 *   2. `vendor.email` domain match (catches forwards from a different
 *      mailbox at the same vendor — "billing@" vs "carlos@")
 *   3. case-insensitive substring on `vendor_name_hint` (the printed
 *      name on the PDF) against vendor.name / vendor.display_name.
 *
 * Returns the first hit; nothing fancier needed at this scale (a typical
 * marina has dozens of vendors, not thousands). Skips inactive vendors.
 */
async function matchVendor(
  ctx: MutationCtx,
  tenantId: Id<"marinas">,
  fromEmail: string,
  vendorNameHint: string | undefined,
): Promise<{ _id: Id<"vendors">; payment_terms: string } | null> {
  const vendors = await ctx.db
    .query("vendors")
    .withIndex("by_tenant_active", (q) =>
      q.eq("tenantId", tenantId).eq("active", true),
    )
    .collect();

  if (vendors.length === 0) return null;

  const fromLower = fromEmail.toLowerCase();
  const atIdx = fromLower.lastIndexOf("@");
  const fromDomain = atIdx >= 0 ? fromLower.slice(atIdx + 1) : undefined;

  // 1. exact email
  const exactEmail = vendors.find(
    (v) => v.email && v.email.toLowerCase() === fromLower,
  );
  if (exactEmail) return exactEmail;

  // 2. email domain
  if (fromDomain) {
    const byDomain = vendors.find((v) => {
      if (!v.email) return false;
      const vAt = v.email.lastIndexOf("@");
      if (vAt < 0) return false;
      return v.email.slice(vAt + 1).toLowerCase() === fromDomain;
    });
    if (byDomain) return byDomain;
  }

  // 3. printed-name substring
  if (vendorNameHint) {
    const hintLower = vendorNameHint.toLowerCase();
    const byName = vendors.find((v) => {
      const name = (v.display_name ?? v.name).toLowerCase();
      // bi-directional substring: "Pinon Petroleum" matches a PDF that
      // just says "Pinon", AND a vendor seeded as "Pinon" matches a PDF
      // header that reads "Pinon Petroleum LLC".
      return name.includes(hintLower) || hintLower.includes(name);
    });
    if (byName) return byName;
  }

  return null;
}

// ────────────────────────────────────────────────────────────
// Mutations
// ────────────────────────────────────────────────────────────

/**
 * Public mutation — invoked from the Postmark webhook route after the
 * signature has been verified. Everything here is keyed off the
 * explicit `tenantId` arg; we never pull tenant from session context.
 *
 * Returns the inserted inboundEmail row id + the resulting status +
 * the drafted vendor_bill_id (if any). The route uses the bill id to
 * surface a "View bill →" link in the response (helpful for Postmark
 * console debugging).
 */
export const ingest = mutation({
  args: {
    tenantId: v.id("marinas"),
    postmark_message_id: v.string(),
    from_email: v.string(),
    from_name: v.optional(v.string()),
    subject: v.optional(v.string()),
    text_body: v.optional(v.string()),
    html_body: v.optional(v.string()),
    /**
     * The parsed bill from `/lib/pdf-extract.ts → extractBillFromPdf`.
     * When absent, the email had no PDF attachment OR extraction failed
     * — we still record the inbound row (status="ingested" or "failed")
     * so the operator can see "yes we got that email, no we didn't act
     * on it".
     */
    extracted: v.optional(
      v.object({
        stub: v.boolean(),
        error: v.optional(v.string()),
        vendor_invoice_number: v.optional(v.string()),
        vendor_name_hint: v.optional(v.string()),
        bill_date: v.optional(v.string()),
        due_date: v.optional(v.string()),
        amount: v.optional(v.number()),
        tax_amount: v.optional(v.number()),
        line_items: v.optional(v.array(lineItemV)),
      }),
    ),
    /** Set when the route already determined no PDF was attached. */
    no_pdf_attached: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Validate the tenant arg points at a real marina. Without this, an
    // attacker who learned the URL pattern could spam-write inbound
    // rows against a fake tenantId and grow the table.
    const marina = await ctx.db.get(args.tenantId);
    if (!marina) {
      throw new Error("Unknown marina");
    }

    // Idempotency — defense in depth. The route SHOULD have checked
    // `findByMessageId` and 200'd; this guards the race where two
    // Postmark retries arrive in parallel.
    const dupe = await ctx.db
      .query("inboundEmails")
      .withIndex("by_postmark_message_id", (q) =>
        q.eq("postmark_message_id", args.postmark_message_id),
      )
      .first();
    if (dupe) {
      return {
        inbound_email_id: dupe._id,
        status: dupe.status,
        vendor_bill_id: dupe.vendor_bill_id ?? null,
        bill_number: null,
        duplicate: true as const,
      };
    }

    const receivedAt = new Date().toISOString();

    // Branch 1 — no PDF attached. The email is logged for visibility
    // and the pipeline terminates at "ingested".
    if (args.no_pdf_attached || !args.extracted) {
      const id = await ctx.db.insert("inboundEmails", {
        tenantId: args.tenantId,
        postmark_message_id: args.postmark_message_id,
        from_email: args.from_email,
        from_name: args.from_name,
        subject: args.subject,
        received_at: receivedAt,
        status: "ingested",
        error_reason: args.no_pdf_attached ? "no_pdf_attachment" : undefined,
      });
      return {
        inbound_email_id: id,
        status: "ingested" as const,
        vendor_bill_id: null,
        bill_number: null,
        duplicate: false as const,
      };
    }

    // Branch 2 — extraction returned a stub OR errored. Record the
    // failure with the error code so the operator UI can show "we tried
    // but couldn't parse". The original email is still in the feed —
    // operator can drop the PDF into the wizard manually.
    if (args.extracted.stub) {
      const id = await ctx.db.insert("inboundEmails", {
        tenantId: args.tenantId,
        postmark_message_id: args.postmark_message_id,
        from_email: args.from_email,
        from_name: args.from_name,
        subject: args.subject,
        received_at: receivedAt,
        status: "failed",
        error_reason: args.extracted.error ?? "extraction_failed",
      });
      return {
        inbound_email_id: id,
        status: "failed" as const,
        vendor_bill_id: null,
        bill_number: null,
        duplicate: false as const,
      };
    }

    // Branch 3 — extraction succeeded. Try to match a vendor.
    const vendor = await matchVendor(
      ctx,
      args.tenantId,
      args.from_email,
      args.extracted.vendor_name_hint,
    );

    if (!vendor) {
      const id = await ctx.db.insert("inboundEmails", {
        tenantId: args.tenantId,
        postmark_message_id: args.postmark_message_id,
        from_email: args.from_email,
        from_name: args.from_name,
        subject: args.subject,
        received_at: receivedAt,
        status: "failed",
        error_reason: "vendor_not_matched",
      });
      return {
        inbound_email_id: id,
        status: "failed" as const,
        vendor_bill_id: null,
        bill_number: null,
        duplicate: false as const,
      };
    }

    // Vendor matched — try to draft the bill.
    const amount = args.extracted.amount;
    const billDate =
      args.extracted.bill_date ?? new Date().toISOString().slice(0, 10);
    const dueDate =
      args.extracted.due_date ??
      computeDueDate(
        billDate,
        vendor.payment_terms as
          | "due_on_receipt"
          | "net_7"
          | "net_15"
          | "net_30"
          | "net_60",
      );

    // Duplicate-invoice guard — matches the check in vendorBills.create.
    // If we've already booked this invoice for this vendor, the email
    // row records the match but flags the bill as a duplicate so the
    // operator can investigate.
    if (args.extracted.vendor_invoice_number) {
      const existingBill = await ctx.db
        .query("vendorBills")
        .withIndex("by_tenant_vendor", (q) =>
          q.eq("tenantId", args.tenantId).eq("vendor_id", vendor._id),
        )
        .filter((q) =>
          q.eq(
            q.field("vendor_invoice_number"),
            args.extracted!.vendor_invoice_number,
          ),
        )
        .first();
      if (existingBill) {
        const id = await ctx.db.insert("inboundEmails", {
          tenantId: args.tenantId,
          postmark_message_id: args.postmark_message_id,
          from_email: args.from_email,
          from_name: args.from_name,
          subject: args.subject,
          received_at: receivedAt,
          vendor_id: vendor._id,
          vendor_bill_id: existingBill._id,
          status: "failed",
          error_reason: "duplicate_invoice",
        });
        return {
          inbound_email_id: id,
          status: "failed" as const,
          vendor_bill_id: existingBill._id,
          bill_number: existingBill.number,
          duplicate: false as const,
        };
      }
    }

    // No amount + no usable structure → log as matched_vendor but no
    // draft. Operator can open the email, see the parsed fields, and
    // decide whether to retry or hand-key.
    if (typeof amount !== "number" || amount <= 0) {
      const id = await ctx.db.insert("inboundEmails", {
        tenantId: args.tenantId,
        postmark_message_id: args.postmark_message_id,
        from_email: args.from_email,
        from_name: args.from_name,
        subject: args.subject,
        received_at: receivedAt,
        vendor_id: vendor._id,
        status: "matched_vendor",
        error_reason: "no_amount_extracted",
      });
      return {
        inbound_email_id: id,
        status: "matched_vendor" as const,
        vendor_bill_id: null,
        bill_number: null,
        duplicate: false as const,
      };
    }

    // Happy path — draft the bill in pending_approval.
    const number = await nextBillNumber(ctx, args.tenantId);
    const internalNotes = buildInternalNotes({
      from_email: args.from_email,
      from_name: args.from_name,
      subject: args.subject,
      text_body: args.text_body,
      html_body: args.html_body,
    });

    const billId = await ctx.db.insert("vendorBills", {
      tenantId: args.tenantId,
      number,
      vendor_id: vendor._id,
      vendor_invoice_number: args.extracted.vendor_invoice_number,
      status: "pending_approval",
      bill_date: billDate,
      due_date: dueDate,
      amount,
      tax_amount: args.extracted.tax_amount,
      subtotal: args.extracted.tax_amount
        ? +(amount - args.extracted.tax_amount).toFixed(2)
        : undefined,
      description: args.subject ?? `Inbound email from ${args.from_email}`,
      line_items: args.extracted.line_items,
      internal_notes: internalNotes,
      created_at: receivedAt,
      // Provenance marker — distinguishes inbound-email drafts from
      // operator-initiated drafts in the AP approval queue + audit log.
      created_by: "inbound_email",
    });

    const id = await ctx.db.insert("inboundEmails", {
      tenantId: args.tenantId,
      postmark_message_id: args.postmark_message_id,
      from_email: args.from_email,
      from_name: args.from_name,
      subject: args.subject,
      received_at: receivedAt,
      vendor_id: vendor._id,
      vendor_bill_id: billId,
      status: "created_draft",
    });

    return {
      inbound_email_id: id,
      status: "created_draft" as const,
      vendor_bill_id: billId,
      bill_number: number,
      duplicate: false as const,
    };
  },
});

/**
 * Format the inboundEmail body + headers into a single string that
 * lands on `vendorBills.internal_notes`. Operators reading the approval
 * queue see the original email subject + body as context for the draft.
 * Keeps the format human-readable rather than JSON-encoded — the field
 * is rendered in a `<pre>` block on the bill detail modal.
 */
function buildInternalNotes(args: {
  from_email: string;
  from_name?: string;
  subject?: string;
  text_body?: string;
  html_body?: string;
}): string {
  const lines: string[] = [];
  lines.push(
    `[Inbound email] From: ${args.from_name ? `${args.from_name} <${args.from_email}>` : args.from_email}`,
  );
  if (args.subject) lines.push(`Subject: ${args.subject}`);
  lines.push("");
  if (args.text_body && args.text_body.trim().length > 0) {
    // Truncate to 2KB — vendor "no-reply" emails can include 20KB
    // marketing footers that bloat the notes field.
    lines.push(args.text_body.slice(0, 2048));
  } else if (args.html_body && args.html_body.trim().length > 0) {
    // Strip tags lightly — full HTML in internal_notes is unreadable.
    // Tokenize-safe stripping handles most invoice-email shapes.
    const stripped = args.html_body
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    lines.push(stripped.slice(0, 2048));
  }
  return lines.join("\n");
}
