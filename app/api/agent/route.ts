import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

/*
 * POST /api/agent
 *
 * If ANTHROPIC_API_KEY is set, streams a Claude response back as plain text
 * chunks (one chunk per `text_delta` event).
 *
 * If the key is missing, returns 503 so the client falls through to the
 * deterministic simulated agent in lib/simulated-agent.ts.
 *
 * The action-detection layer (charge_to_account / send_message) lives on
 * the client and runs against the user's raw prompt regardless of which
 * model produced the text. This keeps tool execution deterministic and
 * auditable while still letting Claude do the narration.
 */

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are the Marina Stee agent — a concise, operational assistant for marina staff.

You help managers and dockhands run a marina: answer questions about boaters, slips, ledger balances, work orders, contracts, meter readings, fuel margin, and reservations. You also draft outbound communications.

Style:
- Reply in 1-3 short sentences unless the user asks for detail.
- Lead with the answer. Numbers come first; reasoning second.
- Use marina vocabulary: boater (not customer), slip (not space), transient (not walk-in), work order (not ticket), charge-to-account (not invoice on file).
- If you propose an action the user should approve, end with a brief one-liner like "Approve below to execute." (The UI renders the actual approval card.)
- Never invent boater names, slip numbers, or balances. If you don't have data, say so plainly.

You do NOT have tool access in this mode — your job is the narration. The client app detects executable actions from the user's prompt deterministically and renders an approval card; you don't have to format them.`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "agent_not_configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: { prompt?: string } = {};
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "invalid_json" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  const prompt = body.prompt?.trim();
  if (!prompt) {
    return new Response(
      JSON.stringify({ error: "missing_prompt" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const client = new Anthropic({ apiKey });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const upstream = await client.messages.stream({
          model: "claude-sonnet-4-5",
          max_tokens: 512,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        });

        for await (const event of upstream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "unknown agent error";
        controller.enqueue(encoder.encode(`\n[agent error: ${message}]`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
