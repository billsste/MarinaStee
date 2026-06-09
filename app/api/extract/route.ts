import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type {
  ExtractionDraft,
  ExtractionModule,
  Vendor,
} from "@/lib/types";

/*
 * POST /api/extract
 *
 * Universal document-extraction endpoint. Accepts a single file as
 * base64 data URL plus a module hint; returns an ExtractionDraft
 * with the staged actions the model produced.
 *
 * The real path uses Anthropic vision with module-specific tool
 * schemas (forced tool_choice). When ANTHROPIC_API_KEY isn't set,
 * or extraction errors, we fall back to a deterministic mock keyed
 * off the file name + module so the prototype demos end-to-end.
 *
 * Multi-tenancy: the route is stateless w.r.t. tenant — the client
 * stamps tenant_id when persisting the draft via addExtractionDraft.
 * Per-tenant config (auto-approve thresholds, familiar-vendor rule)
 * is enforced client-side after the draft lands.
 */

export const runtime = "nodejs";

type ExtractRequest = {
  module: ExtractionModule;
  file: {
    name: string;
    mime: string;
    size_bytes: number;
    /** "data:<mime>;base64,..." */
    data_url: string;
  };
  /** Vendors the model can use for fuzzy match. Stays optional. */
  known_vendors?: Pick<Vendor, "id" | "name" | "display_name">[];
};

type ExtractResponse = {
  draft: ExtractionDraft;
};

export async function POST(req: NextRequest) {
  let body: ExtractRequest;
  try {
    body = (await req.json()) as ExtractRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.module || !body?.file?.data_url) {
    return NextResponse.json(
      { error: "module + file.data_url required" },
      { status: 400 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const draft: ExtractionDraft = apiKey
    ? await runVisionExtract(body, apiKey).catch((err) => {
        // If the real call blows up we still want a draft so the UI
        // path continues working. Mark it errored + return a mock so
        // the operator can see what the doc was at least.
        console.error("[extract] vision failed:", err);
        const mock = buildMockDraft(body);
        return {
          ...mock,
          status: "errored",
          error_message: err instanceof Error ? err.message : String(err),
        };
      })
    : buildMockDraft(body);

  const res: ExtractResponse = { draft };
  return NextResponse.json(res);
}

// ────────────────────────────────────────────────────────────
// Real Anthropic vision call
// ────────────────────────────────────────────────────────────

async function runVisionExtract(
  body: ExtractRequest,
  apiKey: string
): Promise<ExtractionDraft> {
  const client = new Anthropic({ apiKey });
  const tool = TOOL_BY_MODULE[body.module];

  const message = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [
      {
        role: "user",
        content: [
          {
            type: body.file.mime === "application/pdf" ? "document" : "image",
            source: {
              type: "base64",
              media_type: body.file.mime as
                | "image/png"
                | "image/jpeg"
                | "image/webp"
                | "image/gif"
                | "application/pdf",
              data: stripDataUrl(body.file.data_url),
            },
          } as Anthropic.Messages.ImageBlockParam | Anthropic.Messages.DocumentBlockParam,
          {
            type: "text",
            text: PROMPTS[body.module](body.known_vendors ?? []),
          },
        ],
      },
    ],
  });

  const block = message.content.find((c) => c.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("model did not return a tool_use block");
  }
  const input = block.input as Record<string, unknown>;
  return buildDraftFromExtraction(body, input);
}

function stripDataUrl(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

// ────────────────────────────────────────────────────────────
// Mock fallback — deterministic by file name + module
// ────────────────────────────────────────────────────────────

function buildMockDraft(body: ExtractRequest): ExtractionDraft {
  const seed = hashName(body.file.name);
  const mock = MOCK_EXTRACTIONS[body.module](seed);
  return buildDraftFromExtraction(body, mock);
}

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ────────────────────────────────────────────────────────────
// Build a draft from a tool_use payload (real or mock)
// ────────────────────────────────────────────────────────────

function buildDraftFromExtraction(
  body: ExtractRequest,
  input: Record<string, unknown>
): ExtractionDraft {
  const draftId = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const attachmentId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: draftId,
    tenant_id: "", // client stamps on persist
    module: body.module,
    source_attachment_id: attachmentId,
    staged_actions: [
      {
        // tag for client → executor routing
        kind: actionKindFor(body.module),
        ...input,
      },
    ],
    status: "pending",
    confidence: typeof input.confidence === "number" ? input.confidence : 0.9,
    field_confidences: (input.field_confidences as Record<string, number>) ?? {},
    notes: typeof input.notes === "string" ? input.notes : undefined,
    auto_approved: false,
    created_at: new Date().toISOString(),
  };
}

function actionKindFor(module: ExtractionModule): string {
  switch (module) {
    case "bill":
      return "create_bill_from_doc";
    case "vendor":
      return "create_vendor_from_doc";
    case "certification":
      return "create_certification_from_doc";
    case "asset":
      return "create_asset_from_doc";
    case "packing_slip":
      return "receive_stock_from_doc";
    case "staff_onboarding":
      return "create_staff_from_doc";
  }
}

// ────────────────────────────────────────────────────────────
// Module-specific Anthropic tool schemas
// ────────────────────────────────────────────────────────────

const TOOL_BY_MODULE: Record<ExtractionModule, Anthropic.Messages.Tool> = {
  bill: {
    name: "extract_bill",
    description: "Extract a vendor bill / invoice from a PDF or photo.",
    input_schema: {
      type: "object",
      properties: {
        vendor_name: { type: "string" },
        vendor_address: { type: "string" },
        number: { type: "string", description: "Invoice number from the doc" },
        bill_date: { type: "string", description: "YYYY-MM-DD" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        payment_terms_hint: {
          type: "string",
          enum: ["due_on_receipt", "net_7", "net_15", "net_30", "net_60"],
        },
        amount: { type: "number", description: "Total amount due" },
        line_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              amount: { type: "number" },
              gl_account_hint: { type: "string" },
            },
            required: ["description", "amount"],
          },
        },
        confidence: { type: "number" },
        field_confidences: { type: "object" },
        notes: { type: "string" },
      },
      required: ["vendor_name", "number", "amount"],
    },
  },
  vendor: {
    name: "extract_vendor",
    description: "Extract a vendor profile from a W-9, contract, or invoice header.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        display_name: { type: "string" },
        contact_name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        address_line1: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        postal_code: { type: "string" },
        tax_id_last4: { type: "string" },
        payment_terms: {
          type: "string",
          enum: ["due_on_receipt", "net_7", "net_15", "net_30", "net_60"],
        },
        default_gl_account_hint: { type: "string" },
        confidence: { type: "number" },
        field_confidences: { type: "object" },
        notes: { type: "string" },
      },
      required: ["name", "payment_terms"],
    },
  },
  certification: {
    name: "extract_certification",
    description: "Extract a staff certification from a photo or PDF.",
    input_schema: {
      type: "object",
      properties: {
        holder_name: { type: "string" },
        cert_name: { type: "string" },
        issuer: { type: "string" },
        issued_at: { type: "string" },
        expires_at: { type: "string" },
        confidence: { type: "number" },
        field_confidences: { type: "object" },
        notes: { type: "string" },
      },
      required: ["cert_name", "issued_at"],
    },
  },
  asset: {
    name: "extract_asset",
    description: "Extract a marina asset from a purchase invoice or spec sheet.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        kind: {
          type: "string",
          enum: [
            "forklift",
            "boat_lift",
            "hoist",
            "pump_out_boat",
            "pump_out_station",
            "courtesy_cart",
            "fuel_pump",
            "fuel_tank",
            "fire_system",
            "compressor",
            "generator",
            "office_equipment",
            "other",
          ],
        },
        manufacturer: { type: "string" },
        model: { type: "string" },
        serial_number: { type: "string" },
        purchase_date: { type: "string" },
        purchase_price: { type: "number" },
        warranty_until: { type: "string" },
        confidence: { type: "number" },
        field_confidences: { type: "object" },
        notes: { type: "string" },
      },
      required: ["name", "kind"],
    },
  },
  packing_slip: {
    name: "extract_packing_slip",
    description: "Extract a supplier packing slip — vendor + line items.",
    input_schema: {
      type: "object",
      properties: {
        vendor_name: { type: "string" },
        po_number: { type: "string" },
        received_at: { type: "string" },
        line_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              sku_hint: { type: "string" },
              quantity: { type: "number" },
              unit_cost: { type: "number" },
            },
            required: ["description", "quantity"],
          },
        },
        confidence: { type: "number" },
        field_confidences: { type: "object" },
        notes: { type: "string" },
      },
      required: ["vendor_name", "line_items"],
    },
  },
  staff_onboarding: {
    name: "extract_staff_onboarding",
    description:
      "Extract a new-hire's onboarding documents (DL, W-4, signed offer letter).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        address_line1: { type: "string" },
        date_of_birth: { type: "string" },
        position: { type: "string" },
        employment_type: { type: "string", enum: ["w2", "1099"] },
        hourly_rate: { type: "number" },
        salary_annual: { type: "number" },
        hire_date: { type: "string" },
        federal_filing_status: { type: "string" },
        confidence: { type: "number" },
        field_confidences: { type: "object" },
        notes: { type: "string" },
      },
      required: ["name", "position", "employment_type"],
    },
  },
};

// ────────────────────────────────────────────────────────────
// Module-specific prompts
// ────────────────────────────────────────────────────────────

const PROMPTS: Record<
  ExtractionModule,
  (knownVendors: Pick<Vendor, "id" | "name" | "display_name">[]) => string
> = {
  bill: (known) => `
This is a vendor bill or invoice. Extract the fields into the extract_bill tool.

Known vendors (match exactly if you find one in the doc; otherwise return the
vendor_name as written on the doc and we'll fuzzy-match or create):
${known.map((v) => `- ${v.display_name ?? v.name}`).join("\n") || "(none — return the name as written)"}

Rules:
- bill_date and due_date must be YYYY-MM-DD. If due_date is implied by terms (e.g. "Net 30"), compute it from bill_date.
- amount is the grand total INCLUDING tax + freight. Don't return subtotal.
- For line_items, split shipping/freight + tax into their own rows so they can be GL-classified separately.
- gl_account_hint for each line: pick a short label like "Fuel — Cost of Goods", "Ship Store — Cost of Goods", "Maintenance & Repair", "Utilities", "Insurance", "Professional Services", "Supplies".
- payment_terms_hint: parse the term language ("Due on receipt", "Net 30", etc).
- confidence: your overall confidence the extraction is correct (0-1).
- field_confidences: per-field map (e.g. {"due_date": 0.7, "amount": 0.99}).
- notes: 1 sentence on anything unusual (handwritten amounts, ambiguous totals, etc).

Call the extract_bill tool now.`,

  vendor: () => `
Extract the vendor profile into the extract_vendor tool. This may be a W-9, a service contract, or just an invoice with the vendor's letterhead.

- name = legal entity name as printed.
- display_name = the friendlier conversational name if different.
- payment_terms: parse any term language; default to net_30 if unstated.
- tax_id_last4: ONLY the last 4 digits of the EIN/SSN — never the full number.
- confidence + field_confidences as in the bill tool.

Call the extract_vendor tool now.`,

  certification: () => `
This is a staff certification photo or PDF. Extract:
- holder_name (the person it was issued to)
- cert_name (e.g. "Forklift Operator", "First Aid / CPR", "TWIC")
- issuer (organization that issued it)
- issued_at / expires_at as YYYY-MM-DD

Call the extract_certification tool now.`,

  asset: () => `
This is a purchase invoice or spec sheet for a marina asset (forklift, hoist, pump-out station, etc).
Extract the asset profile into extract_asset.

- kind must be one of the enum values (best-fit).
- purchase_date and warranty_until as YYYY-MM-DD when shown.
- purchase_price as a number with no currency symbol.

Call the extract_asset tool now.`,

  packing_slip: () => `
This is a supplier packing slip. Extract the vendor + each line.
- quantity is the count received (not the count ordered, if they differ).
- unit_cost is per-unit if shown; omit if not on the slip.
- sku_hint: any SKU/part number printed on the line.

Call the extract_packing_slip tool now.`,

  staff_onboarding: () => `
This is one or more onboarding documents for a new hire (DL + W-4 + signed offer letter, etc).
Extract into extract_staff_onboarding.

- employment_type: w2 unless the offer letter explicitly says 1099.
- hourly_rate OR salary_annual depending on which the offer states.
- hire_date as YYYY-MM-DD.

Call the extract_staff_onboarding tool now.`,
};

// ────────────────────────────────────────────────────────────
// Mock extractions — deterministic by hash so demos are stable
// ────────────────────────────────────────────────────────────

const MOCK_EXTRACTIONS: Record<
  ExtractionModule,
  (seed: number) => Record<string, unknown>
> = {
  bill: (seed) => {
    const vendors = [
      "Sandia Marine Supply",
      "Pinon Petroleum",
      "LiftWorks Industrial",
      "Loon Fuel & Lubricants",
    ];
    const amounts = [284.12, 1249.5, 8275.0, 412.88, 67.4];
    const v = vendors[seed % vendors.length];
    const amt = amounts[seed % amounts.length];
    const today = new Date();
    const billDate = new Date(today.getTime() - (seed % 5) * 86400000)
      .toISOString()
      .slice(0, 10);
    const dueDate = new Date(today.getTime() + 30 * 86400000)
      .toISOString()
      .slice(0, 10);
    return {
      vendor_name: v,
      number: `INV-${100000 + (seed % 90000)}`,
      bill_date: billDate,
      due_date: dueDate,
      payment_terms_hint: "net_30",
      amount: amt,
      line_items: [
        {
          description: v.includes("Petroleum") || v.includes("Fuel")
            ? "Diesel #2 — 250 gal"
            : "Marine supplies — assorted",
          amount: +(amt * 0.92).toFixed(2),
          gl_account_hint: v.includes("Petroleum") || v.includes("Fuel")
            ? "Fuel — Cost of Goods"
            : "Ship Store — Cost of Goods",
        },
        {
          description: "Freight",
          amount: +(amt * 0.06).toFixed(2),
          gl_account_hint: "Freight In",
        },
        {
          description: "Tax",
          amount: +(amt * 0.02).toFixed(2),
          gl_account_hint: "Sales Tax",
        },
      ],
      confidence: 0.94,
      field_confidences: { due_date: 0.85, amount: 0.99 },
      notes: "Tax line was implied (8% on subtotal) — confirm before approving.",
    };
  },
  vendor: (seed) => {
    const samples = [
      { name: "Boatzone Marine LLC", terms: "net_30", gl: "Ship Store — Cost of Goods" },
      { name: "Lakeside Electrical Co.", terms: "net_15", gl: "Maintenance & Repair" },
      { name: "Northwoods Diesel Service", terms: "net_30", gl: "Maintenance & Repair" },
    ];
    const s = samples[seed % samples.length];
    return {
      name: s.name,
      display_name: s.name.replace(/ LLC| Co\./, ""),
      contact_name: "Accounts Receivable",
      email: `ap@${s.name.toLowerCase().replace(/[^a-z]/g, "")}.com`,
      payment_terms: s.terms,
      default_gl_account_hint: s.gl,
      tax_id_last4: String(1000 + (seed % 9000)),
      confidence: 0.91,
      field_confidences: { email: 0.7 },
      notes: "Email guessed from common AP pattern — please confirm.",
    };
  },
  certification: (seed) => {
    const types = [
      "Forklift Operator",
      "First Aid / CPR",
      "TWIC",
      "Boat Operator Safety",
    ];
    const t = types[seed % types.length];
    const issued = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10);
    const expires = new Date(Date.now() + (seed % 365) * 86400000)
      .toISOString()
      .slice(0, 10);
    return {
      holder_name: ["Dock Lead A", "Dock Lead B", "Manager Marina Demo"][seed % 3],
      cert_name: t,
      issuer:
        t === "Forklift Operator"
          ? "OSHA-Approved Trainer Inc."
          : t === "TWIC"
          ? "TSA"
          : "American Heart Association",
      issued_at: issued,
      expires_at: expires,
      confidence: 0.96,
    };
  },
  asset: (seed) => {
    const kinds = ["forklift", "hoist", "pump_out_station", "generator"];
    const k = kinds[seed % kinds.length];
    return {
      name:
        k === "forklift"
          ? "Forklift — Toyota 7FBCU25"
          : k === "hoist"
          ? "Boat Hoist — Marine Travelift 35BFM"
          : k === "pump_out_station"
          ? "Dockside Pump-Out Station"
          : "Backup Generator — Kohler 20RES",
      kind: k,
      manufacturer:
        k === "forklift" ? "Toyota" : k === "hoist" ? "Marine Travelift" : "Kohler",
      model: ["7FBCU25", "35BFM", "PRO-300", "20RES"][seed % 4],
      serial_number: `SN-${Math.floor(seed * 7919) % 1000000}`,
      purchase_date: new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10),
      purchase_price: [22500, 87500, 5400, 9800][seed % 4],
      confidence: 0.92,
    };
  },
  packing_slip: (seed) => ({
    vendor_name: "Sandia Marine Supply",
    po_number: `PO-${4000 + (seed % 1000)}`,
    received_at: new Date().toISOString().slice(0, 10),
    line_items: [
      { description: "Dock line — 5/8\" × 25'", sku_hint: "DL-58-25", quantity: 24, unit_cost: 12.5 },
      { description: "Fender — F-3 boat fender", sku_hint: "FN-F3", quantity: 12, unit_cost: 18.75 },
      { description: "Flare kit — USCG approved", sku_hint: "FLR-USCG", quantity: 6, unit_cost: 32.4 },
    ],
    confidence: 0.93,
    notes: "Line #3 had handwritten quantity — verify before posting.",
  }),
  staff_onboarding: (seed) => ({
    name: ["Jamie Reyes", "Casey Morgan", "Riley Patel"][seed % 3],
    email: ["jamie@example.com", "casey@example.com", "riley@example.com"][seed % 3],
    phone: "(415) 555-0188",
    address_line1: "1244 Lake View Rd",
    position: ["Dockhand", "Harbormaster Assist", "POS — Ship Store"][seed % 3],
    employment_type: "w2",
    hourly_rate: [22, 24, 19][seed % 3],
    hire_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    federal_filing_status: "single",
    confidence: 0.95,
  }),
};
