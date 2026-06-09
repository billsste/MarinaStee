/*
 * Marina Stee — PDF extraction via Claude Vision.
 *
 * Three callers today:
 *   - COI ingest:     /portal/[token]/coi-upload → /api/pdf-extract?kind=coi
 *                     → operator review → markCoiUploaded mutation.
 *   - Vendor bill:    /vendors → New Bill Wizard PDF dropzone →
 *                     /api/pdf-extract?kind=bill → prefill wizard.
 *   - Contract:       agent rail → extract_contract_terms agent action →
 *                     /api/pdf-extract?kind=contract → operator review.
 *
 * Implementation notes
 * --------------------
 *  - Anthropic supports PDFs as a first-class `document` content block
 *    (vision-equivalent for multi-page documents). We pass base64 bytes
 *    + `media_type: "application/pdf"`. No external OCR pipeline needed
 *    for text-bearing PDFs; image-only PDFs are best-effort (Claude does
 *    visual reasoning, but multi-page scans may run long → caller times
 *    out gracefully).
 *  - Each kind has a typed extraction shape with per-field confidence
 *    (0..1) so downstream UI can flag "looks wrong, eyeball this row"
 *    without blocking the operator entirely.
 *  - Tool-use with `tool_choice: { type: "tool", name }` forces a
 *    structured JSON return, exactly mirroring the pattern in
 *    /api/extract/route.ts (already shipping for non-PDF docs).
 *  - Graceful degradation: if ANTHROPIC_API_KEY is unset OR the API
 *    call throws, the function returns a `stub: true` result with
 *    sentinel values + a flag so callers can show a "PDF extraction
 *    unavailable — fill manually" banner and keep moving. NEVER throws
 *    out of these wrappers — the caller's UX shouldn't break because
 *    a network blip or quota cap fired.
 *  - PII tokenization is intentionally NOT applied here. COI/bill/
 *    contract PDFs contain the boater + vendor's actual names, dates,
 *    and amounts — there's no PII to swap for handles before sending to
 *    Anthropic (the boater hasn't pre-existed in our handle universe;
 *    the vendor is a third-party). Anthropic's 30-day log retention
 *    accepts that risk for document extraction the same way the
 *    existing /api/extract endpoint does. Operators see the extracted
 *    fields and confirm before they touch our persistence layer.
 */

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-5";

// ────────────────────────────────────────────────────────────
// Shared types
// ────────────────────────────────────────────────────────────

export type PdfExtractKind = "coi" | "bill" | "contract";

/** Per-field confidence map. Keys are the extraction-shape field names. */
export type ConfidenceMap = Record<string, number>;

interface BaseResult {
  /** When true, ANTHROPIC_API_KEY was unset OR the call failed and these
   *  are sentinel/empty values. UI shows a fallback banner. */
  stub: boolean;
  /** When the call errored mid-flight (vs. simply having no API key),
   *  this carries the underlying error message for operator audit. */
  error?: string;
}

export interface CoiExtraction extends BaseResult {
  carrier?: string;
  policyNumber?: string;
  effective_start?: string;     // YYYY-MM-DD
  effective_end?: string;       // YYYY-MM-DD
  liability_limit?: number;
  vessel_name?: string;
  hull_value?: number;
  confidence: { per_field: ConfidenceMap };
}

export interface BillLineItem {
  description: string;
  amount: number;
}

export interface BillExtraction extends BaseResult {
  vendor_invoice_number?: string;
  vendor_name_hint?: string;
  bill_date?: string;           // YYYY-MM-DD
  due_date?: string;            // YYYY-MM-DD
  amount?: number;
  tax_amount?: number;
  line_items?: BillLineItem[];
  confidence: { per_field: ConfidenceMap };
}

export type ContractBillingCadence =
  | "annual"
  | "seasonal"
  | "monthly"
  | "transient";

export interface ContractExtraction extends BaseResult {
  effective_start?: string;     // YYYY-MM-DD
  effective_end?: string;       // YYYY-MM-DD
  annual_rate?: number;
  billing_cadence?: ContractBillingCadence;
  signing_party_name?: string;
  signing_party_email?: string;
  confidence: { per_field: ConfidenceMap };
}

// ────────────────────────────────────────────────────────────
// Tool schemas — forced tool_choice for structured return
// ────────────────────────────────────────────────────────────

const COI_TOOL: Anthropic.Messages.Tool = {
  name: "extract_coi",
  description:
    "Extract fields from a Certificate of Insurance (COI). Return ONLY the structured JSON via this tool.",
  input_schema: {
    type: "object",
    properties: {
      carrier: { type: "string", description: "Insurance carrier name." },
      policyNumber: { type: "string" },
      effective_start: { type: "string", description: "YYYY-MM-DD" },
      effective_end: { type: "string", description: "YYYY-MM-DD" },
      liability_limit: {
        type: "number",
        description: "Per-occurrence liability in USD.",
      },
      vessel_name: { type: "string" },
      hull_value: { type: "number" },
      per_field_confidence: {
        type: "object",
        description:
          "Per-field confidence scores (0-1). Keys are the field names above.",
      },
    },
    required: [],
  },
};

const BILL_TOOL: Anthropic.Messages.Tool = {
  name: "extract_bill",
  description:
    "Extract fields from a vendor bill / invoice PDF. Return ONLY the structured JSON via this tool.",
  input_schema: {
    type: "object",
    properties: {
      vendor_invoice_number: { type: "string" },
      vendor_name_hint: {
        type: "string",
        description:
          "The vendor's name as printed on the invoice — caller fuzzy-matches against the live vendor list.",
      },
      bill_date: { type: "string", description: "YYYY-MM-DD" },
      due_date: { type: "string", description: "YYYY-MM-DD" },
      amount: { type: "number", description: "Grand total including tax." },
      tax_amount: { type: "number" },
      line_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            amount: { type: "number" },
          },
          required: ["description", "amount"],
        },
      },
      per_field_confidence: {
        type: "object",
        description: "Per-field confidence scores (0-1).",
      },
    },
    required: [],
  },
};

const CONTRACT_TOOL: Anthropic.Messages.Tool = {
  name: "extract_contract_terms",
  description:
    "Extract the key business terms from a contract PDF (slip lease, service agreement, etc). Return ONLY the structured JSON via this tool.",
  input_schema: {
    type: "object",
    properties: {
      effective_start: { type: "string", description: "YYYY-MM-DD" },
      effective_end: { type: "string", description: "YYYY-MM-DD" },
      annual_rate: {
        type: "number",
        description: "Annualized contract value in USD.",
      },
      billing_cadence: {
        type: "string",
        enum: ["annual", "seasonal", "monthly", "transient"],
      },
      signing_party_name: {
        type: "string",
        description: "The counter-party name (boater / customer side).",
      },
      signing_party_email: { type: "string" },
      per_field_confidence: {
        type: "object",
        description: "Per-field confidence scores (0-1).",
      },
    },
    required: [],
  },
};

// ────────────────────────────────────────────────────────────
// Prompts
// ────────────────────────────────────────────────────────────

const COI_PROMPT = `You are extracting a Certificate of Insurance for a marina's records.
The marina needs: carrier, policy number, effective start + end dates, per-occurrence liability limit, vessel name + hull value (if shown).

Rules:
- Dates MUST be ISO YYYY-MM-DD. If only month/year is shown, leave the field blank rather than guess.
- liability_limit is the per-occurrence dollar figure, not the aggregate. If both are shown, take per-occurrence.
- per_field_confidence: emit a 0-1 score for EACH field you populated. Use lower scores when the field was implied / handwritten / partially obscured.

Call the extract_coi tool with the fields. Do not include any prose outside the tool call.`;

const BILL_PROMPT = `You are extracting a vendor bill / invoice for a marina's accounts-payable workflow.

Rules:
- Dates MUST be ISO YYYY-MM-DD. If due_date is implied by terms ("Net 30"), compute it from the bill date.
- amount is the grand total INCLUDING tax. tax_amount is the tax row alone.
- vendor_name_hint should be the vendor's name as printed; the operator fuzzy-matches against existing vendors after extraction.
- Split shipping / freight / tax into separate line items so the operator can GL-classify them independently.
- per_field_confidence: emit a 0-1 score for EACH populated field.

Call the extract_bill tool. Do not include any prose outside the tool call.`;

const CONTRACT_PROMPT = `You are extracting the business terms from a contract PDF (slip lease, winterization agreement, or service contract) for a marina.

Rules:
- Dates MUST be ISO YYYY-MM-DD.
- annual_rate is the annualized USD amount. If the contract is monthly @ $X, multiply by 12.
- billing_cadence: pick the enum value that matches the payment schedule (annual, seasonal, monthly, transient).
- signing_party_name + email refer to the COUNTER-PARTY (the boater / customer), not the marina.
- per_field_confidence: emit a 0-1 score for EACH populated field.

Call the extract_contract_terms tool. Do not include any prose outside the tool call.`;

// ────────────────────────────────────────────────────────────
// Public extractors
// ────────────────────────────────────────────────────────────

export async function extractCoiFromPdf(
  pdfBytes: ArrayBuffer | Uint8Array,
): Promise<CoiExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return stubCoi();
  try {
    const raw = await callAnthropicPdfTool(
      apiKey,
      pdfBytes,
      COI_TOOL,
      COI_PROMPT,
    );
    return shapeCoi(raw);
  } catch (err) {
    return { ...stubCoi(), error: errMessage(err) };
  }
}

export async function extractBillFromPdf(
  pdfBytes: ArrayBuffer | Uint8Array,
): Promise<BillExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return stubBill();
  try {
    const raw = await callAnthropicPdfTool(
      apiKey,
      pdfBytes,
      BILL_TOOL,
      BILL_PROMPT,
    );
    return shapeBill(raw);
  } catch (err) {
    return { ...stubBill(), error: errMessage(err) };
  }
}

export async function extractContractTermsFromPdf(
  pdfBytes: ArrayBuffer | Uint8Array,
): Promise<ContractExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return stubContract();
  try {
    const raw = await callAnthropicPdfTool(
      apiKey,
      pdfBytes,
      CONTRACT_TOOL,
      CONTRACT_PROMPT,
    );
    return shapeContract(raw);
  } catch (err) {
    return { ...stubContract(), error: errMessage(err) };
  }
}

// ────────────────────────────────────────────────────────────
// Anthropic call (shared)
// ────────────────────────────────────────────────────────────

async function callAnthropicPdfTool(
  apiKey: string,
  pdfBytes: ArrayBuffer | Uint8Array,
  tool: Anthropic.Messages.Tool,
  promptText: string,
): Promise<Record<string, unknown>> {
  const client = new Anthropic({ apiKey });
  const base64 = bytesToBase64(pdfBytes);

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64,
            },
          },
          { type: "text", text: promptText },
        ],
      },
    ],
  });

  const block = message.content.find((c) => c.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Model did not return a tool_use block");
  }
  return block.input as Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────
// Shape coercion — Anthropic returns raw JSON; we narrow into typed
// extraction shapes here so downstream code doesn't have to handle
// stringly-typed dates / partial numbers.
// ────────────────────────────────────────────────────────────

function shapeCoi(raw: Record<string, unknown>): CoiExtraction {
  return {
    stub: false,
    carrier: asString(raw.carrier),
    policyNumber: asString(raw.policyNumber),
    effective_start: asString(raw.effective_start),
    effective_end: asString(raw.effective_end),
    liability_limit: asNumber(raw.liability_limit),
    vessel_name: asString(raw.vessel_name),
    hull_value: asNumber(raw.hull_value),
    confidence: { per_field: asConfidenceMap(raw.per_field_confidence) },
  };
}

function shapeBill(raw: Record<string, unknown>): BillExtraction {
  const rawLines = Array.isArray(raw.line_items)
    ? (raw.line_items as unknown[])
    : [];
  const line_items: BillLineItem[] = rawLines
    .map((l): BillLineItem | undefined => {
      if (!l || typeof l !== "object") return undefined;
      const o = l as Record<string, unknown>;
      const description = asString(o.description);
      const amount = asNumber(o.amount);
      if (!description || amount === undefined) return undefined;
      return { description, amount };
    })
    .filter((l): l is BillLineItem => !!l);

  return {
    stub: false,
    vendor_invoice_number: asString(raw.vendor_invoice_number),
    vendor_name_hint: asString(raw.vendor_name_hint),
    bill_date: asString(raw.bill_date),
    due_date: asString(raw.due_date),
    amount: asNumber(raw.amount),
    tax_amount: asNumber(raw.tax_amount),
    line_items: line_items.length > 0 ? line_items : undefined,
    confidence: { per_field: asConfidenceMap(raw.per_field_confidence) },
  };
}

function shapeContract(raw: Record<string, unknown>): ContractExtraction {
  const cadence = asString(raw.billing_cadence);
  const validCadence: ContractBillingCadence | undefined =
    cadence === "annual" ||
    cadence === "seasonal" ||
    cadence === "monthly" ||
    cadence === "transient"
      ? cadence
      : undefined;
  return {
    stub: false,
    effective_start: asString(raw.effective_start),
    effective_end: asString(raw.effective_end),
    annual_rate: asNumber(raw.annual_rate),
    billing_cadence: validCadence,
    signing_party_name: asString(raw.signing_party_name),
    signing_party_email: asString(raw.signing_party_email),
    confidence: { per_field: asConfidenceMap(raw.per_field_confidence) },
  };
}

// ────────────────────────────────────────────────────────────
// Stub returns when ANTHROPIC_API_KEY is unset
// ────────────────────────────────────────────────────────────

const STUB_SENTINEL = "[Stub: parse manually]";

// SECURITY/CORRECTNESS: numeric fields in stubs return `undefined` (not 0).
// A zero would silently pass downstream validators like `if (bill.amount
// > 0) save()` — the operator would unknowingly commit a $0 bill from a
// failed extraction. Forcing undefined makes any unchecked access crash
// loudly so the caller is required to gate on `stub: true` first.
// String fields use STUB_SENTINEL because text comparisons fail-noisy
// already (no template can render "[Stub: parse manually]" without
// being obviously wrong).

function stubCoi(): CoiExtraction {
  return {
    stub: true,
    carrier: STUB_SENTINEL,
    policyNumber: STUB_SENTINEL,
    effective_start: undefined,
    effective_end: undefined,
    liability_limit: undefined,
    vessel_name: STUB_SENTINEL,
    hull_value: undefined,
    confidence: { per_field: {} },
  };
}

function stubBill(): BillExtraction {
  return {
    stub: true,
    vendor_invoice_number: STUB_SENTINEL,
    vendor_name_hint: STUB_SENTINEL,
    bill_date: undefined,
    due_date: undefined,
    amount: undefined,
    tax_amount: undefined,
    line_items: undefined,
    confidence: { per_field: {} },
  };
}

function stubContract(): ContractExtraction {
  return {
    stub: true,
    effective_start: undefined,
    effective_end: undefined,
    annual_rate: undefined,
    billing_cadence: undefined,
    signing_party_name: STUB_SENTINEL,
    signing_party_email: undefined,
    confidence: { per_field: {} },
  };
}

// ────────────────────────────────────────────────────────────
// Small helpers
// ────────────────────────────────────────────────────────────

function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const buf =
    bytes instanceof Uint8Array
      ? Buffer.from(bytes)
      : Buffer.from(new Uint8Array(bytes));
  return buf.toString("base64");
}

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,\s]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asConfidenceMap(v: unknown): ConfidenceMap {
  if (!v || typeof v !== "object") return {};
  const out: ConfidenceMap = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = asNumber(raw);
    if (n !== undefined && n >= 0 && n <= 1) out[k] = n;
  }
  return out;
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
