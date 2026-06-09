import { NextRequest, NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";
import { anyApi } from "convex/server";
import {
  extractBillFromPdf,
  extractCoiFromPdf,
  extractContractTermsFromPdf,
  type BillExtraction,
  type CoiExtraction,
  type ContractExtraction,
  type PdfExtractKind,
} from "@/lib/pdf-extract";

/*
 * POST /api/pdf-extract
 *
 * Accepts a multipart/form-data body with:
 *   - file: the PDF (any document-shaped binary)
 *   - kind: one of "coi" | "bill" | "contract"
 *   - storage_id (optional): the Convex `_storage` id when the caller
 *     already persisted the PDF. Echoed back in the response so the
 *     agent action that drove this can carry the reference forward.
 *
 * Returns the typed extraction result for the requested kind, with an
 * additional `kind` discriminator field so the client can narrow.
 *
 * Auth: short-circuit acceptable in the mock-data era. Today we honor:
 *   - any Bearer token equal to MARINA_STEE_DEV_TOKEN (set in .env)
 *     when configured; useful for /api/agent-style server-to-server
 *     calls during prototyping.
 *   - or any caller when no DEV_TOKEN + no Clerk is configured (the
 *     prototype operator-facing surfaces aren't gated).
 *
 * When Clerk lands (Phase 5+), this route will defer to the same
 * `auth()` helper as the rest of /api and enforce org membership.
 *
 * Multi-page PDFs: Anthropic's `document` source block streams the
 * full PDF; pages > ~20 may exceed the per-request token budget. For
 * now we let the upstream call surface the error and respond with a
 * stub-flagged result so the operator UI degrades gracefully.
 */

export const runtime = "nodejs";
// Document extraction takes more than the default 10s on the
// Anthropic side for multi-page PDFs — bump the per-route limit.
export const maxDuration = 60;

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20MB safety ceiling

interface ExtractResponseBase {
  kind: PdfExtractKind;
  storage_id?: string;
}
type PdfExtractApiResponse =
  | (ExtractResponseBase & { kind: "coi"; result: CoiExtraction })
  | (ExtractResponseBase & { kind: "bill"; result: BillExtraction })
  | (ExtractResponseBase & { kind: "contract"; result: ContractExtraction });

export async function POST(req: NextRequest) {
  const authError = checkAuth(req);
  if (authError) return authError;

  // SECURITY: pre-buffer content-length check so a malicious caller can't
  // force the server to hold a 500MB payload in memory before any size
  // check. The actual file.size check still runs below — this is a fast
  // rejection on the header.
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_PDF_BYTES * 1.1 /* allow some form-encoding overhead */) {
    return NextResponse.json(
      { error: `Request body exceeds ${MAX_PDF_BYTES} byte ceiling` },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data body." },
      { status: 400 },
    );
  }

  const kindRaw = form.get("kind");
  if (typeof kindRaw !== "string" || !isExtractKind(kindRaw)) {
    return NextResponse.json(
      { error: "kind must be one of: coi, bill, contract" },
      { status: 400 },
    );
  }
  const kind: PdfExtractKind = kindRaw;

  const file = form.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json(
      { error: "file (PDF) is required" },
      { status: 400 },
    );
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: `PDF exceeds ${MAX_PDF_BYTES} byte ceiling` },
      { status: 413 },
    );
  }

  const storageIdRaw = form.get("storage_id");
  const storage_id =
    typeof storageIdRaw === "string" && storageIdRaw.length > 0
      ? storageIdRaw
      : undefined;

  // RATE LIMIT + AUDIT: when the caller passes a tenant_id, bump the
  // per-tenant pdf_extract bucket (capped at 100/day) and write an
  // audit row. Reject with 429 when the cap is hit. tenant_id is
  // optional in the prototype — operator dev surfaces fire without
  // a tenant context — but production callers (vendor bill wizard +
  // holder COI upload) should pass it. When Clerk org session is
  // wired, this becomes mandatory + sourced from the JWT.
  const tenantIdRaw = form.get("tenant_id");
  const tenantId =
    typeof tenantIdRaw === "string" && tenantIdRaw.length > 0
      ? tenantIdRaw
      : undefined;

  if (tenantId) {
    try {
      const limitResult = (await fetchMutation(
        anyApi.rateLimit.checkAndIncrementForTenant,
        { tenantId, bucket: "pdf_extract.requests" },
      )) as { allowed: boolean; counter: number; cap: number } | null;
      if (limitResult && !limitResult.allowed) {
        return NextResponse.json(
          {
            error:
              "PDF extraction rate limit reached for this marina (resets daily).",
            counter: limitResult.counter,
            cap: limitResult.cap,
          },
          { status: 429 },
        );
      }
    } catch (err) {
      // Convex offline or marina id invalid — log + proceed in dev.
      // In prod (no Clerk session, no tenant id) the auth gate already
      // refused earlier.
      console.warn(
        "[pdf-extract] rate-limit check failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // SECURITY: validate the magic bytes — a real PDF starts with `%PDF-`.
  // Without this check, an attacker can POST random binary masquerading
  // as a PDF and burn an Anthropic call before Claude rejects it.
  if (
    bytes.length < 5 ||
    bytes[0] !== 0x25 || // %
    bytes[1] !== 0x50 || // P
    bytes[2] !== 0x44 || // D
    bytes[3] !== 0x46 || // F
    bytes[4] !== 0x2d    // -
  ) {
    return NextResponse.json(
      { error: "file is not a valid PDF (missing %PDF- header)" },
      { status: 400 },
    );
  }

  // Dispatch to the per-kind extractor. Each is responsible for its own
  // graceful-degradation behavior — they NEVER throw out; on failure they
  // return a stub result with `stub: true` and an `error` field.
  let body: PdfExtractApiResponse;
  if (kind === "coi") {
    body = { kind, storage_id, result: await extractCoiFromPdf(bytes) };
  } else if (kind === "bill") {
    body = { kind, storage_id, result: await extractBillFromPdf(bytes) };
  } else {
    body = {
      kind,
      storage_id,
      result: await extractContractTermsFromPdf(bytes),
    };
  }
  return NextResponse.json(body);
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function isExtractKind(s: string): s is PdfExtractKind {
  return s === "coi" || s === "bill" || s === "contract";
}

/**
 * Auth gate. Returns a 401 NextResponse when the request should be
 * rejected, or null when the request may proceed.
 *
 * SECURITY behavior matrix:
 *   - In **development** (NODE_ENV !== "production"):
 *     - MARINA_STEE_DEV_TOKEN unset → accept all (so the demo flow
 *       works without env setup).
 *     - MARINA_STEE_DEV_TOKEN set   → require `Authorization: Bearer <token>`.
 *   - In **production**:
 *     - DEFAULT DENY. Without a configured DEV_TOKEN OR a Clerk session,
 *       the route refuses. This prevents an attacker from burning the
 *       platform's Anthropic budget via an unauthenticated POST when
 *       the env var was forgotten.
 *
 * Future (Clerk integration): this gate will defer to the same `auth()`
 * helper as the rest of /api and enforce org membership.
 */
function checkAuth(req: NextRequest): NextResponse | null {
  const devToken = process.env.MARINA_STEE_DEV_TOKEN;
  const isProd = process.env.NODE_ENV === "production";
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);

  if (devToken && m && m[1] === devToken) return null;

  // In dev, no token configured = open for the demo flow. In prod, no
  // configured token = refuse (fail closed).
  if (!devToken && !isProd) return null;

  return NextResponse.json(
    { error: "Unauthorized — provide a valid Bearer token." },
    { status: 401 },
  );
}
