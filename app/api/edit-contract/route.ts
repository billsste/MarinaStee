import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { BOATERS, SEED_TENANT_ID, VESSELS } from "@/lib/mock-data";
import {
  buildTokenizationMap,
  detokenize,
  tokenize,
} from "@/lib/pii-tokenizer";

/*
 * POST /api/edit-contract
 *
 * The "ask the agent to fix something" endpoint behind the Contract
 * Preview sheet. Takes the current drafted markdown + a natural-language
 * instruction from the operator ("shorten the cancellation policy", "add
 * a clause about pets", "make the late-fee schedule monthly instead of
 * weekly") and returns the rewritten markdown.
 *
 * Falls back to no-op + an explanatory note when ANTHROPIC_API_KEY isn't
 * set — the demo still works, the operator just gets a hint that the
 * agent isn't wired live.
 *
 * Request body:
 *   {
 *     current_body: string         // current drafted markdown
 *     instruction:  string         // operator's natural-language ask
 *     contract_label?: string      // e.g. "C-1042 — Jones, Robert · A04"
 *     tenant_id?:   string         // tenant scope for PII tokenizer
 *   }
 *
 * Response: { drafted_body_markdown: string, source: "claude" | "local", note?: string }
 */

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are a contract editing assistant for Marina Stee, a marina-management SaaS.

The operator (a marina manager) is reviewing a drafted contract and has asked you to make a specific change. Your job: return the FULL contract markdown with that change applied — keep everything else exactly as-is.

Rules:
- Return ONLY the full updated markdown. No preamble, no explanation, no code fences.
- Apply the operator's instruction literally and surgically. Don't over-edit.
- Preserve the existing sections, headings, and overall structure unless the instruction specifically asks to restructure.
- Keep money values formatted with $ and two decimals.
- Keep dates formatted as "Month D, YYYY".
- If the instruction is ambiguous, do the most conservative interpretation.
- Do not invent or remove clauses outside the scope of the instruction.`;

export async function POST(req: NextRequest) {
  let body: {
    current_body?: string;
    instruction?: string;
    contract_label?: string;
    tenant_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { current_body, instruction, contract_label, tenant_id } = body;
  if (!current_body || !instruction) {
    return NextResponse.json(
      { error: "current_body and instruction are required" },
      { status: 400 },
    );
  }

  // Tenant scope for the PII tokenizer — same rationale as
  // /api/draft-contract. A Lakeside-tenant edit must not be salted
  // against Marina Stee boater names.
  const effectiveTenantId = tenant_id ?? SEED_TENANT_ID;
  const scopedBoaters = BOATERS.filter(
    (b) => (b.tenant_id ?? SEED_TENANT_ID) === effectiveTenantId,
  );
  const scopedBoaterIds = new Set(scopedBoaters.map((b) => b.id));
  const scopedVessels = VESSELS.filter((v) => scopedBoaterIds.has(v.boater_id));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Local fallback: return the body untouched with a note. The Preview
    // sheet renders the note so the operator knows the edit didn't land.
    return NextResponse.json({
      drafted_body_markdown: current_body,
      source: "local",
      note:
        "Agent edits require ANTHROPIC_API_KEY. Use “Edit text” to make changes manually for now.",
    });
  }

  try {
    const anthropic = new Anthropic({ apiKey });

    // Tokenize both the current body AND the instruction so any boater
    // name the operator references inside the instruction itself
    // ("change Mr. Jones's late fee") doesn't reach the LLM in raw form.
    const tokenMap = buildTokenizationMap({
      boaters: scopedBoaters,
      vessels: scopedVessels,
    });
    const tokenizedBody = tokenize(current_body, tokenMap);
    const tokenizedInstruction = tokenize(instruction, tokenMap);

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Contract: ${contract_label ?? "(unlabeled)"}

Operator instruction:
${tokenizedInstruction}

Current contract markdown:
\`\`\`markdown
${tokenizedBody}
\`\`\`

Return the FULL updated markdown.`,
        },
      ],
    });

    const rawText = message.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const text = detokenize(rawText, tokenMap);

    if (!text) {
      return NextResponse.json({
        drafted_body_markdown: current_body,
        source: "local",
        note: "Agent returned an empty edit. Contract left unchanged.",
      });
    }

    return NextResponse.json({
      drafted_body_markdown: text,
      source: "claude",
    });
  } catch (err) {
    console.error("[edit-contract] Claude API error", err);
    return NextResponse.json({
      drafted_body_markdown: current_body,
      source: "local",
      note: "Agent edit failed. Contract left unchanged.",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
