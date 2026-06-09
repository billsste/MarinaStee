/*
 * POST /api/inbound/postmark/[tenantId]
 *
 * Per-tenant Postmark INBOUND-email webhook receiver — feeds the
 * AP-bill ingest pipeline.
 *
 * The workflow it powers
 * ----------------------
 *   1. Marina staff forwards a vendor invoice email (with a PDF
 *      attached) to `bills@<their-marina>.marinastee.com`.
 *   2. Postmark's inbound server receives it and POSTs a JSON envelope
 *      to this URL: https://app.marinastee.com/api/inbound/postmark/{tenantId}.
 *   3. We verify the Postmark signature, parse the payload, extract
 *      the PDF via `extractBillFromPdf`, then call
 *      `inboundEmails.ingest` which fuzzy-matches a vendor and drafts
 *      a `VendorBill` in `pending_approval`.
 *   4. The draft surfaces in the existing approval queue at /vendors
 *      → Bills (AP). Operator approves with a click.
 *
 * Per-tenant URL (same rationale as the outbound delivery webhook):
 *   `bills@marina_a.marinastee.com` and `bills@marina_b.marinastee.com`
 *   map to distinct Postmark inbound servers. If we registered one
 *   shared URL, tenant A's Postmark account could forge envelopes
 *   targeting tenant B (the signature would verify against the shared
 *   workspace secret). Per-tenant URLs scope the trust boundary: the
 *   `tenantId` from the URL is the authoritative scope, never the
 *   payload.
 *
 * Signature verification
 * ----------------------
 *   `POSTMARK_INBOUND_SECRET` (env var) is the static token configured
 *   in the Postmark inbound-server settings. Each marina would
 *   eventually have its own inbound server; for the prototype a single
 *   workspace-level secret covers every tenant URL. When the marina-
 *   profile UI ships tenant-scoped Postmark config (already scaffolded
 *   in `convex/schema.ts → marinas.postmark_api_key`), this lookup
 *   moves to a per-tenant resolver.
 *
 * Idempotency
 * -----------
 *   Postmark retries non-2xx for ~24 hours. The natural idempotency
 *   key is `MessageID` — same across retries. We hit
 *   `inboundEmails.findByMessageId` BEFORE running PDF extraction
 *   (which costs a Claude call) and short-circuit on hit. The Convex
 *   mutation has a second guard so two retries arriving in parallel
 *   can't both create rows.
 *
 * Graceful degradation
 * --------------------
 *   - Missing signature secret → return 200 with `ignored: "unverified"`.
 *     Same pattern as the outbound route — Postmark stops retrying on
 *     2xx, which is what we want during a misconfigured dev/demo
 *     window.
 *   - PDF extraction failure → still record the inbound email row with
 *     status="failed" so the operator sees "yes we got the email, no we
 *     couldn't act on it". Operator can hand-process from the AP inbox.
 *   - Vendor not matched → status="failed", error_reason="vendor_not_matched".
 *     Today's flow: operator manually creates the vendor + drops the PDF.
 *     Future: auto-create a vendor draft + link it to this email.
 *
 * Deferred (call-outs for the spec)
 * ---------------------------------
 *   - Multi-attachment emails: we process the first PDF only.
 *     Multiple invoices in one email is unusual; when it arises the
 *     follow-up either splits into N inbound rows or queues a
 *     "multiple PDFs detected" review row.
 *   - Image-only PDF OCR: `extractBillFromPdf` calls Claude vision
 *     which handles scans well, but pre-Claude tesseract pass would
 *     reduce token cost. Tracked under "PII boundary asymmetry" in
 *     CLAUDE.md → Backend architecture.
 *   - Vendor auto-create when not matched: out of scope; spec defers.
 *   - Two-way email reply for clarification ("we couldn't parse — can
 *     you re-send as a PDF?"): deferred. Today the failed inboundEmail
 *     row surfaces in the feed and the operator follows up manually.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { anyApi } from "convex/server";
import { verifyPostmarkInboundSignature } from "@/lib/webhook-verify";
import {
  decodeAttachmentBytes,
  filterPdfAttachments,
  parsePostmarkInbound,
} from "@/lib/inbound-email-parse";
import { extractBillFromPdf, type BillExtraction } from "@/lib/pdf-extract";

export const runtime = "nodejs";
// Allow up to 60s — Claude vision on a multi-page PDF can run long.
// Outbound delivery receipts don't need this; inbound parse does.
export const maxDuration = 60;

const MAX_PDF_BYTES = 20 * 1024 * 1024; // mirror /api/pdf-extract

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const { tenantId } = await params;
  if (!tenantId || tenantId.length < 5 || tenantId.length > 64) {
    return NextResponse.json({ ok: true, ignored: "bad_tenant_id" });
  }

  if (!verifyPostmarkInboundSignature(req.headers)) {
    if (!process.env.POSTMARK_INBOUND_SECRET) {
      console.error(
        "[postmark-inbound] POSTMARK_INBOUND_SECRET is not set — every " +
          "inbound webhook is being ignored. Set it in env to ingest " +
          "vendor invoices via email.",
      );
    } else {
      console.warn(
        `[postmark-inbound/${tenantId}] signature mismatch — refusing to ingest event`,
      );
    }
    return NextResponse.json({ ok: true, ignored: "unverified" });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: true, ignored: "invalid_json" });
  }

  const parsed = parsePostmarkInbound(raw);

  if (!parsed.message_id) {
    // No MessageID = no idempotency anchor. Postmark always sets this,
    // so an envelope without it is almost certainly malformed or a
    // probe. Drop silently.
    return NextResponse.json({ ok: true, ignored: "no_message_id" });
  }
  if (!parsed.from) {
    return NextResponse.json({ ok: true, ignored: "no_from_address" });
  }

  // ── Idempotency check ────────────────────────────────────────
  // Hit BEFORE running PDF extraction so retries don't burn Claude
  // tokens. The mutation has its own second guard.
  try {
    const existing = await fetchQuery(anyApi.inboundEmails.findByMessageId, {
      postmark_message_id: parsed.message_id,
    });
    if (existing) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        inbound_email_id: (existing as { _id?: string })._id ?? null,
      });
    }
  } catch (err) {
    // Convex offline (dev path) — log and proceed. The mutation will
    // still no-op on a real dup.
    console.warn(
      `[postmark-inbound/${tenantId}] idempotency lookup failed:`,
      err instanceof Error ? err.message : err,
    );
  }

  // ── No PDF attached → log + 200 ──────────────────────────────
  const pdfAttachments = filterPdfAttachments(parsed.attachments);
  if (pdfAttachments.length === 0) {
    console.warn(
      `[postmark-inbound/${tenantId}] no PDF attachment on email from ${parsed.from} (msg=${parsed.message_id}). ` +
        "Logging row, no draft created.",
    );
    const result = await safeFetchMutation(tenantId, {
      tenantId,
      postmark_message_id: parsed.message_id,
      from_email: parsed.from,
      from_name: parsed.from_name,
      subject: parsed.subject,
      text_body: parsed.text_body,
      html_body: parsed.html_body,
      no_pdf_attached: true,
    });
    return NextResponse.json({ ok: true, ...summarize(result) });
  }

  // ── Decode + size-check the first PDF ─────────────────────────
  // Multi-PDF emails: we act on the first only (spec call-out).
  const firstPdf = pdfAttachments[0];
  let bytes: Uint8Array;
  try {
    bytes = decodeAttachmentBytes(firstPdf);
  } catch (err) {
    console.warn(
      `[postmark-inbound/${tenantId}] attachment decode failed:`,
      err instanceof Error ? err.message : err,
    );
    const result = await safeFetchMutation(tenantId, {
      tenantId,
      postmark_message_id: parsed.message_id,
      from_email: parsed.from,
      from_name: parsed.from_name,
      subject: parsed.subject,
      text_body: parsed.text_body,
      html_body: parsed.html_body,
      extracted: {
        stub: true,
        error: "attachment_decode_failed",
      },
    });
    return NextResponse.json({ ok: true, ...summarize(result) });
  }

  if (bytes.length > MAX_PDF_BYTES) {
    // Don't even try to send 20MB+ to Claude. Log + record failure.
    const result = await safeFetchMutation(tenantId, {
      tenantId,
      postmark_message_id: parsed.message_id,
      from_email: parsed.from,
      from_name: parsed.from_name,
      subject: parsed.subject,
      text_body: parsed.text_body,
      html_body: parsed.html_body,
      extracted: {
        stub: true,
        error: "pdf_too_large",
      },
    });
    return NextResponse.json({ ok: true, ...summarize(result) });
  }

  // ── Magic-byte sanity check ──────────────────────────────────
  // Real PDFs start with `%PDF-`. Mirrors /api/pdf-extract — keeps
  // garbage out of the Claude call.
  if (
    bytes.length < 5 ||
    bytes[0] !== 0x25 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x44 ||
    bytes[3] !== 0x46 ||
    bytes[4] !== 0x2d
  ) {
    const result = await safeFetchMutation(tenantId, {
      tenantId,
      postmark_message_id: parsed.message_id,
      from_email: parsed.from,
      from_name: parsed.from_name,
      subject: parsed.subject,
      text_body: parsed.text_body,
      html_body: parsed.html_body,
      extracted: { stub: true, error: "not_a_pdf" },
    });
    return NextResponse.json({ ok: true, ...summarize(result) });
  }

  // ── PDF extraction ───────────────────────────────────────────
  // Calls directly into lib/pdf-extract (rather than POSTing to the
  // sibling HTTP route) to avoid a self-call hop and let us reuse the
  // function-level rate-limit / auth gates on /api/pdf-extract for
  // OPERATOR usage only.
  let extraction: BillExtraction;
  try {
    extraction = await extractBillFromPdf(bytes);
  } catch (err) {
    // extractBillFromPdf wraps internal errors itself; this catch is
    // belt + suspenders.
    console.warn(
      `[postmark-inbound/${tenantId}] PDF extract threw:`,
      err instanceof Error ? err.message : err,
    );
    extraction = {
      stub: true,
      error: err instanceof Error ? err.message : "extract_threw",
      confidence: { per_field: {} },
    };
  }

  // ── Dispatch to the Convex mutation ──────────────────────────
  const result = await safeFetchMutation(tenantId, {
    tenantId,
    postmark_message_id: parsed.message_id,
    from_email: parsed.from,
    from_name: parsed.from_name,
    subject: parsed.subject,
    text_body: parsed.text_body,
    html_body: parsed.html_body,
    extracted: {
      stub: extraction.stub,
      error: extraction.error,
      vendor_invoice_number: extraction.vendor_invoice_number,
      vendor_name_hint: extraction.vendor_name_hint,
      bill_date: extraction.bill_date,
      due_date: extraction.due_date,
      amount: extraction.amount,
      tax_amount: extraction.tax_amount,
      line_items: extraction.line_items,
    },
  });

  return NextResponse.json({ ok: true, ...summarize(result) });
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

interface IngestResult {
  inbound_email_id?: string;
  status?: string;
  vendor_bill_id?: string | null;
  bill_number?: string | null;
  duplicate?: boolean;
}

/**
 * Best-effort wrapper around `fetchMutation`. When Convex is offline
 * (the dev path with no NEXT_PUBLIC_CONVEX_URL configured), the call
 * throws — we swallow it so the route still returns 200 to Postmark.
 * In prod the call succeeds and the response carries the bill id.
 */
async function safeFetchMutation(
  tenantId: string,
  args: Record<string, unknown>,
): Promise<IngestResult | null> {
  try {
    const result = (await fetchMutation(
      anyApi.inboundEmails.ingest,
      args,
    )) as IngestResult;
    return result;
  } catch (err) {
    console.warn(
      `[postmark-inbound/${tenantId}] ingest mutation failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Trim the ingest mutation's return shape into the webhook response.
 * Postmark doesn't read the body — this is for human debugging in the
 * Postmark "Activity" tab.
 */
function summarize(result: IngestResult | null) {
  if (!result) {
    return { status: "ingest_failed" };
  }
  return {
    status: result.status,
    inbound_email_id: result.inbound_email_id ?? null,
    bill_id: result.vendor_bill_id ?? null,
    bill_number: result.bill_number ?? null,
    duplicate: result.duplicate ?? false,
  };
}
