/*
 * Marina Stee — Postmark inbound webhook payload parser.
 *
 * Postmark's inbound webhook (https://postmarkapp.com/developer/webhooks/inbound-webhook)
 * POSTs a normalized JSON envelope describing a single received email.
 * The shape we care about for the AP-bill ingest path:
 *
 *   {
 *     "MessageID":     "abcd-...",       // stable id, our idempotency key
 *     "From":          "vendor@x.com",
 *     "FromName":      "Acme Vendor",
 *     "FromFull":      { "Email": "...", "Name": "..." },
 *     "To":            "bills@marina.marinastee.com",
 *     "Subject":       "Invoice #INV-22481",
 *     "TextBody":      "...",
 *     "HtmlBody":      "...",
 *     "Date":          "RFC 2822 string",
 *     "Attachments": [
 *       {
 *         "Name":          "INV-22481.pdf",
 *         "ContentType":   "application/pdf",
 *         "Content":       "<base64>",
 *         "ContentLength": 12345,
 *         "ContentID":     ""        // CID for inline imgs; empty for stand-alone attachments
 *       }
 *     ]
 *   }
 *
 * This module is intentionally pure: it takes the raw `unknown` payload
 * from `req.json()` and returns a typed, narrowed shape. NO network
 * calls, NO Convex writes, NO logging beyond what the route does.
 *
 * Why a dedicated helper:
 *   - The route file should be a thin orchestrator (verify sig → parse →
 *     fetchMutation → respond). Field-by-field unwrapping doesn't belong
 *     in the route.
 *   - Unit-testable. The route is harder to test because it reaches into
 *     Convex; this helper is pure transformation.
 *   - Reusable. If we add a /api/inbound/twilio path or a second
 *     Postmark surface (e.g. portal+ → support tickets) the same
 *     parsing primitives apply with a different field map.
 *
 * Defensive posture: every field is optional in the parsed result.
 * Postmark sometimes omits things (FromName missing, ContentLength
 * unreliable). We never throw — bad payloads return what we could
 * extract and the caller decides whether enough fields are present to
 * proceed.
 */

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

/** Parsed attachment — only PDFs end up actionable for the AP path. */
export interface ParsedInboundAttachment {
  name: string;
  content_type: string;
  /** Base64-encoded body — caller decodes when it actually needs bytes. */
  content_base64: string;
  size_bytes?: number;
}

/** Narrowed Postmark inbound envelope, post-parse. */
export interface ParsedInboundEmail {
  /** Postmark's per-email unique id — our idempotency key. */
  message_id?: string;
  /** Bare email of the sender (e.g. "carlos@pinonpetro.example"). */
  from?: string;
  /** Display name if Postmark surfaced one (e.g. "Carlos Reyes"). */
  from_name?: string;
  /** The bills+<tenant>@marinastee.app address the marina configured. */
  to?: string;
  subject?: string;
  text_body?: string;
  html_body?: string;
  /** RFC 2822 date from Postmark, when present. */
  date?: string;
  attachments: ParsedInboundAttachment[];
}

// ────────────────────────────────────────────────────────────
// Parser
// ────────────────────────────────────────────────────────────

/**
 * Parse a Postmark inbound webhook payload (JSON-decoded from the
 * request body) into a typed envelope. Never throws; returns whatever
 * fields we could extract.
 */
export function parsePostmarkInbound(raw: unknown): ParsedInboundEmail {
  if (!raw || typeof raw !== "object") {
    return { attachments: [] };
  }
  const o = raw as Record<string, unknown>;

  return {
    message_id: asString(o.MessageID),
    from: asString(o.From) ?? asString(extractFromFullEmail(o.FromFull)),
    from_name:
      asString(o.FromName) ?? asString(extractFromFullName(o.FromFull)),
    to: asString(o.To),
    subject: asString(o.Subject),
    text_body: asString(o.TextBody),
    html_body: asString(o.HtmlBody),
    date: asString(o.Date),
    attachments: parseAttachments(o.Attachments),
  };
}

/**
 * Return only the PDF attachments. The AP path doesn't act on image or
 * text-only attachments — if no PDF is present, the caller logs the
 * email but doesn't draft a bill.
 *
 * The match is case-insensitive on `application/pdf` and ALSO accepts
 * `.pdf` extension as a fallback for vendors whose mail clients send a
 * generic `application/octet-stream` content-type.
 */
export function filterPdfAttachments(
  attachments: ParsedInboundAttachment[],
): ParsedInboundAttachment[] {
  return attachments.filter((a) => isPdfAttachment(a));
}

function isPdfAttachment(a: ParsedInboundAttachment): boolean {
  if (a.content_type.toLowerCase() === "application/pdf") return true;
  if (a.name.toLowerCase().endsWith(".pdf")) return true;
  return false;
}

// ────────────────────────────────────────────────────────────
// Base64 -> bytes helper
// ────────────────────────────────────────────────────────────

/**
 * Decode the `content_base64` body of an attachment into raw bytes.
 * Node 22 has Buffer + base64 built in — no extra dep. Throws on
 * invalid input so the route can surface "corrupt attachment".
 */
export function decodeAttachmentBytes(
  attachment: ParsedInboundAttachment,
): Uint8Array {
  const buf = Buffer.from(attachment.content_base64, "base64");
  return new Uint8Array(buf);
}

// ────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────

function parseAttachments(raw: unknown): ParsedInboundAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedInboundAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const name = asString(a.Name);
    const content = asString(a.Content);
    if (!name || !content) continue;
    out.push({
      name,
      content_type: asString(a.ContentType) ?? "application/octet-stream",
      content_base64: content,
      size_bytes: asNumber(a.ContentLength),
    });
  }
  return out;
}

function extractFromFullEmail(v: unknown): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  return asString((v as Record<string, unknown>).Email);
}

function extractFromFullName(v: unknown): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  return asString((v as Record<string, unknown>).Name);
}

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// ────────────────────────────────────────────────────────────
// Vendor matching by sender domain
// ────────────────────────────────────────────────────────────

/**
 * Extract the domain portion of an email address ("carlos@pinonpetro.example"
 * → "pinonpetro.example"). Lowercased, undefined when input isn't a
 * well-formed email.
 */
export function emailDomain(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return undefined;
  return email.slice(at + 1).toLowerCase();
}
