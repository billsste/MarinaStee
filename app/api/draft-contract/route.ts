import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

/*
 * POST /api/draft-contract
 *
 * Takes a template body (markdown with {{merge.tokens}}) plus the
 * concrete context for one contract and asks Claude to produce a
 * filled-in version. Falls back to a deterministic local fill if no
 * ANTHROPIC_API_KEY is present so the demo still works offline.
 *
 * Request body:
 *   {
 *     template_body: string         // raw markdown with {{tokens}}
 *     template_name: string         // e.g. "Annual Slip Lease"
 *     context: {
 *       boater: { display_name, code, primary_contact, address }
 *       slip:   { number, dock, slipClass, loaInches }
 *       vessel: { name, year, make, model } | null
 *       contract: {
 *         effective_start, effective_end, annual_rate, billing_cadence,
 *         services: { name, amount }[]
 *       }
 *     }
 *   }
 *
 * Response: { drafted_body_markdown: string, source: "claude" | "local" }
 */

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are a contract drafting assistant for Marina Stee, a marina-management SaaS.

Your job: take a markdown contract template that contains {{merge.tokens}} and a JSON context object, and return the markdown with every token replaced by the corresponding value from the context. Format money values with a dollar sign and two decimals. Format dates as "Month D, YYYY" (e.g., "May 27, 2026"). Be faithful to the template's wording, sections, and formatting — do not invent new clauses or remove existing ones. If a token has no value in the context, replace it with "—".

Return ONLY the filled markdown. No preamble, no explanation, no code fences.`;

function localFill(templateBody: string, context: Record<string, unknown>): string {
  // Deterministic fallback used when ANTHROPIC_API_KEY isn't set. Walks
  // the template, swaps {{a.b.c}} tokens against the context object.
  const flatten = (obj: unknown, prefix = ""): Record<string, string> => {
    const out: Record<string, string> = {};
    if (obj === null || obj === undefined) return out;
    if (typeof obj !== "object") {
      out[prefix] = String(obj);
      return out;
    }
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        Object.assign(out, flatten(v, key));
      } else if (Array.isArray(v)) {
        out[key] = v
          .map((x) =>
            typeof x === "object" && x !== null
              ? Object.values(x).join(" ")
              : String(x)
          )
          .join(", ");
      } else {
        out[key] = v === null || v === undefined ? "—" : String(v);
      }
    }
    return out;
  };
  const flat = flatten(context);
  return templateBody.replace(/\{\{([^}]+)\}\}/g, (_, token) => {
    const key = token.trim();
    return flat[key] ?? "—";
  });
}

export async function POST(req: NextRequest) {
  let body: {
    template_body?: string;
    template_name?: string;
    context?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { template_body, template_name, context } = body;
  if (!template_body || !context) {
    return NextResponse.json(
      { error: "template_body and context are required" },
      { status: 400 }
    );
  }

  // Pre-compute a couple of friendly views the template can reference
  // even if the caller didn't explicitly pass them. Keeps prompts and
  // local-fill consistent.
  const enriched: Record<string, unknown> = { ...context };
  if (
    enriched.contract &&
    typeof enriched.contract === "object" &&
    enriched.contract !== null
  ) {
    const c = enriched.contract as Record<string, unknown>;
    if (typeof c.annual_rate === "number" && !c.annual_rate_formatted) {
      c.annual_rate_formatted = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(c.annual_rate);
    }
    if (Array.isArray(c.services) && !c.services_summary) {
      const svcs = c.services as Array<{ name: string; amount: number }>;
      c.services_summary =
        svcs.length > 0
          ? svcs.map((s) => `${s.name} (${s.amount})`).join(", ")
          : "None";
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const filled = localFill(template_body, enriched);
    return NextResponse.json({
      drafted_body_markdown: filled,
      source: "local",
    });
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Template: ${template_name ?? "Contract"}

Context (JSON):
\`\`\`json
${JSON.stringify(enriched, null, 2)}
\`\`\`

Template body (markdown):
\`\`\`markdown
${template_body}
\`\`\`

Return the filled markdown. ONLY the filled markdown.`,
        },
      ],
    });

    const text = message.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!text) {
      // Defensive: if Claude returns empty, fall back to local fill so
      // the contract still has a body.
      const filled = localFill(template_body, enriched);
      return NextResponse.json({
        drafted_body_markdown: filled,
        source: "local",
      });
    }

    return NextResponse.json({
      drafted_body_markdown: text,
      source: "claude",
    });
  } catch (err) {
    console.error("[draft-contract] Claude API error", err);
    // Fallback so the wizard doesn't dead-end on transient API errors.
    const filled = localFill(template_body, enriched);
    return NextResponse.json({
      drafted_body_markdown: filled,
      source: "local",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
