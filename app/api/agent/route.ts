import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  BOATERS,
  CONTRACTS,
  METER_READINGS,
  RENTAL_GROUPS,
  RENTAL_SPACES,
  meterAnomaly,
  meterDelta,
} from "@/lib/mock-data";
import { generateAgentResponse } from "@/lib/simulated-agent";
import type { LedgerEntry } from "@/lib/types";

/*
 * POST /api/agent
 *
 * Multi-turn agent loop.
 *  - Read-only query tools (query_open_balances, query_meter_anomalies,
 *    query_contract_expiry) execute server-side; results loop back to Claude.
 *  - Action tools (charge_to_account, send_message) require human approval —
 *    they're streamed to the client as Proposed Action cards and end the turn.
 *
 * Wire format (NDJSON, one event per line):
 *   {"type":"source","source":"claude"|"simulated"}
 *   {"type":"text","delta":"..."}                              (repeated)
 *   {"type":"tool_step","name":"query_...","result":...}        (auto-executed query results, for transparency)
 *   {"type":"tool","name":"charge_to_account"|"send_message"|"create_work_order"|"create_reservation"|"record_payment","input":{...}}
 *   {"type":"done"}
 *   {"type":"error","message":"..."}
 */

export const runtime = "nodejs";

// ────────────────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────────────────

const READ_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "query_open_balances",
    description:
      "Returns a ranked list of boaters with non-zero open A/R balances. Use this when the user asks about overdue accounts, who owes money, or wants to identify boaters to follow up with.",
    input_schema: {
      type: "object",
      properties: {
        min_amount: {
          type: "number",
          description: "Optional minimum balance threshold in dollars. Default: 0.",
        },
      },
      required: [],
    },
  },
  {
    name: "query_meter_anomalies",
    description:
      "Returns meter readings flagged as anomalous (consumption spikes). Use this when investigating unusual utility draw or planning work orders.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "query_contract_expiry",
    description:
      "Returns active contracts expiring within a window. Use this when planning renewals or finding contracts that need attention.",
    input_schema: {
      type: "object",
      properties: {
        days_window: {
          type: "number",
          description: "How many days from today to look ahead. Default: 90.",
        },
      },
      required: [],
    },
  },
];

const ACTION_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "charge_to_account",
    description:
      "Propose adding a charge to a boater's account. Requires human approval — the staff member reviews and clicks Approve in the UI before it executes.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: {
          type: "string",
          description:
            "Last name, first name, or slip code identifying the boater. Examples: 'Emmons', 'David', 'DSM A29'.",
        },
        item_query: {
          type: "string",
          description:
            "What to charge. Either a POS catalog item (gasoline, dock line, fender) or a service fee (hoist fee, transfer fee, pump-out, winterization).",
        },
      },
      required: ["boater_query", "item_query"],
    },
  },
  {
    name: "send_message",
    description:
      "Propose sending a message to a boater. Requires human approval. Use for payment reminders, arrival reminders, ad-hoc updates.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: {
          type: "string",
          description: "Last name, first name, or slip code identifying the boater.",
        },
        channel: {
          type: "string",
          enum: ["sms", "email"],
          description: "Default to the boater's preferred_channel from context.",
        },
        subject: { type: "string" },
        body: {
          type: "string",
          description: "1-3 short sentences. Use the boater's first name.",
        },
      },
      required: ["boater_query", "channel", "body"],
    },
  },
  {
    name: "create_work_order",
    description:
      "Propose creating a new service work order for a boater. Requires human approval. Use when staff says things like 'schedule winterization for David's Bayliner' or 'open a haul-out work order for the Peterson sloop'.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: {
          type: "string",
          description: "Last name, first name, or slip code identifying the boater.",
        },
        subject: {
          type: "string",
          description: "Short title for the work order, e.g. 'Winterize 1989 Bayliner'.",
        },
        description: {
          type: "string",
          description: "Optional longer detail for the technician.",
        },
        activity_type: {
          type: "string",
          enum: ["winterization", "bottom_paint", "service", "inspection", "haul_out", "pump_out", "task", "other"],
          description: "Category of work. 'task' is for staff to-dos like 'call X re renewal'. 'pump_out' is sanitation. Default 'service' when unclear.",
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "urgent"],
          description: "Default 'normal'.",
        },
        vessel_query: {
          type: "string",
          description:
            "Optional vessel name to attach. If the boater has only one vessel, the agent may omit and the UI will pick it.",
        },
        slip_query: {
          type: "string",
          description: "Optional slip number or dock label.",
        },
        due_date: {
          type: "string",
          description: "Optional ISO date (YYYY-MM-DD) when the work must be done by.",
        },
      },
      required: ["boater_query", "subject"],
    },
  },
  {
    name: "create_reservation",
    description:
      "Propose creating a new reservation (annual / seasonal / monthly / transient). Requires human approval. Use for 'book A12 for the Petersons next weekend' or 'put David in slip 14 for the season'.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: { type: "string" },
        slip_query: {
          type: "string",
          description: "Slip number, dock label, or slip id. Required.",
        },
        vessel_query: { type: "string", description: "Optional vessel name." },
        arrival_date: {
          type: "string",
          description: "ISO date (YYYY-MM-DD).",
        },
        departure_date: {
          type: "string",
          description: "ISO date (YYYY-MM-DD).",
        },
        type: {
          type: "string",
          enum: ["annual", "seasonal", "monthly", "transient", "recurring"],
          description: "Default 'transient' for short stays.",
        },
      },
      required: ["boater_query", "slip_query", "arrival_date", "departure_date"],
    },
  },
  {
    name: "record_payment",
    description:
      "Propose recording a manual payment received outside the POS (check, cash, ACH, or manually-keyed card). Requires human approval. Use for 'record a $400 check from Emmons' or 'apply $1,200 ACH to David's open invoices'.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: { type: "string" },
        amount: {
          type: "number",
          description: "Payment amount in dollars (positive).",
        },
        method: {
          type: "string",
          enum: ["check", "cash", "ach", "card"],
        },
        notes: {
          type: "string",
          description: "Optional memo, e.g. check number.",
        },
      },
      required: ["boater_query", "amount", "method"],
    },
  },
  {
    name: "create_boater",
    description:
      "Propose adding a new boater (customer) to the marina. Requires human approval. Use when staff says 'onboard a new boater named ...' or 'add Smith family to the books'.",
    input_schema: {
      type: "object",
      properties: {
        first_name: { type: "string" },
        last_name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        preferred_channel: {
          type: "string",
          enum: ["email", "sms", "voice"],
          description: "Default 'email'.",
        },
        billing_cadence: {
          type: "string",
          enum: ["annual", "seasonal", "monthly", "transient"],
          description: "Default 'transient'.",
        },
        code: {
          type: "string",
          description: "Optional slip-encoded shorthand, e.g. 'DSM A29'.",
        },
        notes: { type: "string" },
      },
      required: ["first_name", "last_name"],
    },
  },
  {
    name: "create_vessel",
    description:
      "Propose adding a vessel to a boater's profile. Requires human approval. Use when staff says 'add the 32-foot Sea Ray to David's account' or 'register a new boat for Peterson'.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: { type: "string" },
        name: { type: "string", description: "Vessel name, e.g. 'Reel Time'." },
        year: { type: "number" },
        make: { type: "string" },
        model: { type: "string" },
        vessel_type: {
          type: "string",
          enum: ["powerboat", "sailboat", "pontoon", "houseboat", "pwc", "other"],
        },
        fuel_type: {
          type: "string",
          enum: ["gasoline", "diesel", "electric", "none"],
        },
        loa_inches: { type: "number", description: "Length overall in inches." },
        beam_inches: { type: "number" },
        draft_inches: { type: "number" },
        hull_vin: { type: "string" },
        registration: { type: "string" },
      },
      required: ["boater_query", "name"],
    },
  },
  {
    name: "create_contract",
    description:
      "Propose drafting a new contract (annual/seasonal slip lease, winterization, etc.) for a boater. Requires human approval. Default status is 'draft' — staff will send for signature separately.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: { type: "string" },
        template_id: {
          type: "string",
          enum: ["tpl_annual_slip", "tpl_seasonal_slip", "tpl_winterization"],
          description: "Which contract template to use.",
        },
        vessel_query: { type: "string" },
        slip_query: { type: "string" },
        effective_start: { type: "string", description: "ISO date." },
        effective_end: { type: "string", description: "ISO date." },
        annual_rate: { type: "number" },
        billing_cadence: {
          type: "string",
          enum: ["annual", "seasonal", "monthly", "transient"],
          description: "Default 'monthly'.",
        },
      },
      required: ["boater_query", "template_id", "effective_start", "effective_end"],
    },
  },
  {
    name: "add_card",
    description:
      "Propose adding a card-on-file for a boater (for future auto-charges, deposits, etc.). Requires human approval. Production: would tokenize via the payment processor first; here we just record the metadata.",
    input_schema: {
      type: "object",
      properties: {
        boater_query: { type: "string" },
        brand: {
          type: "string",
          enum: ["visa", "mastercard", "amex", "discover"],
        },
        last4: { type: "string", description: "4-digit string." },
        exp_month: { type: "number" },
        exp_year: { type: "number", description: "4-digit year." },
        nickname: { type: "string" },
        is_default: { type: "boolean", description: "Default false." },
      },
      required: ["boater_query", "brand", "last4", "exp_month", "exp_year"],
    },
  },
];

const ALL_TOOLS = [...READ_TOOLS, ...ACTION_TOOLS];
const ACTION_TOOL_NAMES = new Set(ACTION_TOOLS.map((t) => t.name));

// ────────────────────────────────────────────────────────────
// Read-only tool execution (server-side)
// ────────────────────────────────────────────────────────────

function executeReadTool(
  name: string,
  input: Record<string, unknown>,
  ledger: LedgerEntry[]
): unknown {
  if (name === "query_open_balances") {
    const minAmount = Number(input.min_amount ?? 0);
    const ranked = BOATERS.map((b) => {
      const open = ledger
        .filter((l) => l.boater_id === b.id && l.type === "invoice")
        .reduce((s, l) => s + l.open_balance, 0);
      return { boater_id: b.id, display_name: b.display_name, code: b.code, open };
    })
      .filter((r) => r.open >= minAmount && r.open > 0)
      .sort((a, b) => b.open - a.open);
    return {
      count: ranked.length,
      total_open: ranked.reduce((s, r) => s + r.open, 0),
      boaters: ranked,
    };
  }

  if (name === "query_meter_anomalies") {
    const anomalous = METER_READINGS.filter(meterAnomaly).map((m) => {
      const sp = RENTAL_SPACES.find((s) => s.id === m.space_id);
      return {
        slip_number: sp?.number,
        meter_number: m.meter_number,
        delta: meterDelta(m),
        unit: m.unit,
        current_reading: m.current_reading,
      };
    });
    return { count: anomalous.length, readings: anomalous };
  }

  if (name === "query_contract_expiry") {
    const daysWindow = Number(input.days_window ?? 90);
    const now = Date.now();
    const cutoff = now + daysWindow * 86_400_000;
    const expiring = CONTRACTS.filter((c) => c.status === "active")
      .filter((c) => {
        const end = new Date(c.effective_end).getTime();
        return end >= now && end <= cutoff;
      })
      .map((c) => {
        const b = BOATERS.find((x) => x.id === c.boater_id);
        const days_remaining = Math.round(
          (new Date(c.effective_end).getTime() - now) / 86_400_000
        );
        return {
          contract_number: c.number,
          boater_id: c.boater_id,
          boater_name: b?.display_name,
          effective_end: c.effective_end,
          annual_rate: c.annual_rate,
          days_remaining,
        };
      })
      .sort((a, b) => a.days_remaining - b.days_remaining);
    return { count: expiring.length, contracts: expiring };
  }

  return { error: `unknown read tool: ${name}` };
}

// ────────────────────────────────────────────────────────────
// Context snapshot for the system prompt (always-on context)
// ────────────────────────────────────────────────────────────

// Intentionally static across requests so the entire system block can be
// prompt-cached. Anything that changes per-request (live ledger totals,
// timestamps, request IDs) must NOT be interpolated here — it would
// invalidate the cache on every call. The agent has query_* tools for
// fetching live data on demand.
function buildContext(): string {
  const occupied = RENTAL_SPACES.filter((s) => s.status === "occupied").length;
  const vacant = RENTAL_SPACES.filter((s) => s.status === "vacant").length;

  return `STATIC SNAPSHOT (stable mock data — for fresh numbers, call the query_* tools):

Slip occupancy: ${occupied}/${RENTAL_SPACES.length} (${vacant} vacant)
Meter anomalies flagged: ${METER_READINGS.filter(meterAnomaly).length}
Active contracts: ${CONTRACTS.filter((c) => c.status === "active").length}

Boaters in the system:
${BOATERS.map((b) => `  - ${b.display_name} (id=${b.id}, code=${b.code ?? "—"}, ${b.billing_cadence}, prefers ${b.communication_prefs.preferred_channel})`).join("\n")}

Rental groups: ${RENTAL_GROUPS.map((g) => g.name).join(", ")}.

For specific data, use the query_* tools — they return live results.`;
}

const SYSTEM_PROMPT = `You are the Marina Stee agent — a concise, operational assistant for marina staff.

Style:
- Reply in 1-3 short sentences unless the user asks for detail.
- Lead with the answer. Numbers come first; reasoning second.
- Use marina vocabulary: boater (not customer), slip (not space), transient (not walk-in), work order (not ticket), charge-to-account (not invoice on file).
- Never invent boater names, slip numbers, or balances. Use only tool results or the SNAPSHOT.

Tools:
- query_* tools auto-execute server-side; you'll see the result and can use it to inform your next step.
- All action tools are PROPOSED — the staff member must approve each in the UI. You can propose multiple in one turn (e.g. one per overdue boater after a query_open_balances call).
- Available actions: charge_to_account, send_message, create_work_order, create_reservation, record_payment, create_boater, create_vessel, create_contract, add_card.
- Chain tools when useful: e.g. for "send a reminder to everyone overdue", first call query_open_balances, then propose one send_message per result.
- Anything the staff can do via "+ New" buttons in the UI, you can propose with the matching tool. Default sensible values when the user is vague (e.g. preferred_channel=email, billing_cadence=transient for new boaters; activity_type=service, priority=normal for work orders).

When proposing actions, narrate briefly (1 sentence) so the user knows what's queued for approval.`;

// ────────────────────────────────────────────────────────────
// POST handler
// ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { prompt?: string; ledger?: LedgerEntry[] } = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const prompt = body.prompt?.trim();
  if (!prompt) {
    return new Response(JSON.stringify({ error: "missing_prompt" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ledger = Array.isArray(body.ledger) ? body.ledger : [];
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const encoder = new TextEncoder();
  const writeLine = (controller: ReadableStreamDefaultController, obj: unknown) => {
    controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
  };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (apiKey) {
          writeLine(controller, { type: "source", source: "claude" });
          await streamFromClaude({ controller, writeLine, apiKey, prompt, ledger });
        } else {
          writeLine(controller, { type: "source", source: "simulated" });
          await streamFromSimulated({ controller, writeLine, prompt, ledger });
        }
        writeLine(controller, { type: "done" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown agent error";
        writeLine(controller, { type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// ────────────────────────────────────────────────────────────
// Claude path — multi-turn tool loop
// ────────────────────────────────────────────────────────────

const MAX_TURNS = 4;

async function streamFromClaude({
  controller,
  writeLine,
  apiKey,
  prompt,
  ledger,
}: {
  controller: ReadableStreamDefaultController;
  writeLine: (c: ReadableStreamDefaultController, obj: unknown) => void;
  apiKey: string;
  prompt: string;
  ledger: LedgerEntry[];
}) {
  const client = new Anthropic({ apiKey });

  // ── Prompt caching ──────────────────────────────────────────
  // Render order is tools → system → messages. A cache_control marker on
  // the last system block caches tools + system together; we also mark
  // the last tool as a defense-in-depth breakpoint so the tools list
  // caches independently if we ever vary the system prefix.
  //
  // For the growing messages array inside the tool loop, we set a single
  // sliding breakpoint on the latest user-turn message each iteration —
  // older breakpoints fall off (cleared before each request) but their
  // cache entries persist in the 5-minute TTL store, so the new
  // breakpoint walks back and reads the prior turn's prefix.
  //
  // Verify hits via response.usage.cache_read_input_tokens — if zero
  // across repeated identical-prefix requests, something is invalidating
  // the prefix (see shared/prompt-caching.md).
  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: `${SYSTEM_PROMPT}\n\n${buildContext()}`,
      cache_control: { type: "ephemeral" },
    },
  ];

  // Mark the last tool with cache_control. The tools array is otherwise
  // identical to the original ALL_TOOLS export — only the final entry
  // gains a cache_control field.
  const cachedTools: Anthropic.Messages.Tool[] =
    ALL_TOOLS.length > 0
      ? [
          ...ALL_TOOLS.slice(0, -1),
          { ...ALL_TOOLS[ALL_TOOLS.length - 1], cache_control: { type: "ephemeral" } },
        ]
      : ALL_TOOLS;

  const messages: Anthropic.Messages.MessageParam[] = [
    {
      role: "user",
      content: [{ type: "text", text: prompt }],
    },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    // Move the messages-side cache_control breakpoint to the last content
    // block of the most-recent user-turn message. Strip any previous
    // markers first so we never exceed the 4-breakpoint per-request budget
    // (system + tools account for 2; this is the 3rd).
    applyMessagesCacheControl(messages);

    const upstream = client.messages.stream({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: systemBlocks,
      tools: cachedTools,
      messages,
    });

    // Track tool_use blocks as they stream so we can collect input JSON
    type ToolBlock = { id: string; name: string; jsonAcc: string };
    const blocksByIndex = new Map<number, ToolBlock>();
    const assistantContent: Anthropic.Messages.ContentBlock[] = [];

    for await (const event of upstream) {
      if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          blocksByIndex.set(event.index, {
            id: event.content_block.id,
            name: event.content_block.name,
            jsonAcc: "",
          });
        }
        continue;
      }
      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          writeLine(controller, { type: "text", delta: event.delta.text });
        } else if (event.delta.type === "input_json_delta") {
          const block = blocksByIndex.get(event.index);
          if (block) block.jsonAcc += event.delta.partial_json;
        }
      }
    }

    // Get the final assembled message so we have correct content blocks
    const finalMessage = await upstream.finalMessage();
    assistantContent.push(...finalMessage.content);

    // Collect tool_uses by category
    const toolUses = finalMessage.content.filter(
      (c): c is Anthropic.Messages.ToolUseBlock => c.type === "tool_use"
    );
    const readCalls = toolUses.filter((t) => !ACTION_TOOL_NAMES.has(t.name));
    const actionCalls = toolUses.filter((t) => ACTION_TOOL_NAMES.has(t.name));

    // Stream action proposals to the client immediately
    for (const a of actionCalls) {
      writeLine(controller, {
        type: "tool",
        name: a.name,
        input: a.input as Record<string, unknown>,
      });
    }

    // If Claude proposed only actions (or nothing left to do), we're done
    if (readCalls.length === 0) return;

    // Execute read-only tools server-side, append results, loop
    messages.push({ role: "assistant", content: assistantContent });
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = readCalls.map(
      (call) => {
        const result = executeReadTool(
          call.name,
          (call.input as Record<string, unknown>) ?? {},
          ledger
        );
        // Emit a tool_step event so the UI can show the agent's progress
        writeLine(controller, { type: "tool_step", name: call.name, result });
        return {
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify(result),
        };
      }
    );
    messages.push({ role: "user", content: toolResults });
  }
}

// ────────────────────────────────────────────────────────────
// Prompt-caching helpers
// ────────────────────────────────────────────────────────────

/**
 * Slides the messages-side prompt-cache breakpoint to the last content
 * block of the most-recent user-turn message. Strips any prior
 * cache_control markers first so we don't exceed the 4-breakpoint budget
 * as the conversation grows across tool-loop turns.
 *
 * The cache entries written by previous turns persist in the 5-min TTL
 * store; the new breakpoint walks back (up to 20 blocks) and reads them.
 */
function applyMessagesCacheControl(
  messages: Anthropic.Messages.MessageParam[]
): void {
  // Clear any existing cache_control on message content blocks.
  for (const msg of messages) {
    if (typeof msg.content === "string") continue;
    for (const block of msg.content) {
      if (block && typeof block === "object" && "cache_control" in block) {
        delete (block as { cache_control?: unknown }).cache_control;
      }
    }
  }

  // Find the last user-turn message and set cache_control on its final
  // content block. Tool-loop turns push user-role tool_result arrays;
  // turn 1 has the initial prompt in structured form.
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    if (typeof msg.content === "string" || msg.content.length === 0) return;
    const last = msg.content[msg.content.length - 1];
    if (last && typeof last === "object") {
      (last as { cache_control?: { type: "ephemeral" } }).cache_control = {
        type: "ephemeral",
      };
    }
    return;
  }
}

// ────────────────────────────────────────────────────────────
// Simulated path (unchanged) — single-pass pattern matcher
// ────────────────────────────────────────────────────────────

async function streamFromSimulated({
  controller,
  writeLine,
  prompt,
  ledger,
}: {
  controller: ReadableStreamDefaultController;
  writeLine: (c: ReadableStreamDefaultController, obj: unknown) => void;
  prompt: string;
  ledger: LedgerEntry[];
}) {
  const { stream: chunks, action } = generateAgentResponse(prompt, ledger);

  await delay(250);

  for (const chunk of chunks) {
    writeLine(controller, { type: "text", delta: chunk });
    await delay(Math.min(60 + chunk.length * 8, 250));
  }

  if (action) {
    if (action.kind === "charge_to_account") {
      writeLine(controller, {
        type: "tool",
        name: "charge_to_account",
        input: { boater_query: action.boater_id, item_query: action.line.name },
        resolved: {
          boater_id: action.boater_id,
          location_id: action.location_id,
          line: action.line,
        },
      });
    } else if (action.kind === "send_message") {
      writeLine(controller, {
        type: "tool",
        name: "send_message",
        input: {
          boater_query: action.boater_id,
          channel: action.type,
          subject: action.subject,
          body: action.body,
        },
        resolved: {
          boater_id: action.boater_id,
          type: action.type,
          subject: action.subject,
          body: action.body,
        },
      });
    } else if (action.kind === "create_work_order") {
      writeLine(controller, {
        type: "tool",
        name: "create_work_order",
        input: {
          boater_query: action.boater_id,
          subject: action.subject,
          description: action.description,
          activity_type: action.activity_type,
          priority: action.priority,
          vessel_query: action.vessel_id,
          slip_query: action.slip_id,
          due_date: action.due_date,
        },
      });
    } else if (action.kind === "create_reservation") {
      writeLine(controller, {
        type: "tool",
        name: "create_reservation",
        input: {
          boater_query: action.boater_id,
          slip_query: action.slip_id,
          vessel_query: action.vessel_id,
          arrival_date: action.arrival_date,
          departure_date: action.departure_date,
          type: action.type,
        },
      });
    } else if (action.kind === "record_payment") {
      writeLine(controller, {
        type: "tool",
        name: "record_payment",
        input: {
          boater_query: action.boater_id,
          amount: action.amount,
          method: action.method,
          notes: action.notes,
        },
      });
    } else if (action.kind === "create_boater") {
      writeLine(controller, {
        type: "tool",
        name: "create_boater",
        input: {
          first_name: action.first_name,
          last_name: action.last_name,
          email: action.email,
          phone: action.phone,
          preferred_channel: action.preferred_channel,
          billing_cadence: action.billing_cadence,
          code: action.code,
          notes: action.notes,
        },
      });
    } else if (action.kind === "create_vessel") {
      writeLine(controller, {
        type: "tool",
        name: "create_vessel",
        input: {
          boater_query: action.boater_id,
          name: action.name,
          year: action.year,
          make: action.make,
          model: action.model,
          vessel_type: action.vessel_type,
          fuel_type: action.fuel_type,
          loa_inches: action.loa_inches,
          beam_inches: action.beam_inches,
          draft_inches: action.draft_inches,
          hull_vin: action.hull_vin,
          registration: action.registration,
        },
      });
    } else if (action.kind === "create_contract") {
      writeLine(controller, {
        type: "tool",
        name: "create_contract",
        input: {
          boater_query: action.boater_id,
          template_id: action.template_id,
          vessel_query: action.vessel_id,
          slip_query: action.slip_id,
          effective_start: action.effective_start,
          effective_end: action.effective_end,
          annual_rate: action.annual_rate,
          billing_cadence: action.billing_cadence,
        },
      });
    } else if (action.kind === "add_card") {
      writeLine(controller, {
        type: "tool",
        name: "add_card",
        input: {
          boater_query: action.boater_id,
          brand: action.brand,
          last4: action.last4,
          exp_month: action.exp_month,
          exp_year: action.exp_year,
          nickname: action.nickname,
          is_default: action.is_default,
        },
      });
    }
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
