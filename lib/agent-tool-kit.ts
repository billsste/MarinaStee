/*
 * Agent tool kit — convention + helper for new agent tools.
 *
 * Why this file exists
 * ────────────────────
 * Marina Stee's agent has ~100 tools wired across four files:
 *   1. app/api/agent/route.ts          → JSON tool schema (Anthropic)
 *   2. lib/simulated-agent.ts          → AgentAction discriminated-union
 *   3. lib/agent-fetch.ts              → tool_use → AgentAction resolver
 *   4. lib/agent-actions.ts            → permission gate + runAction executor
 *
 * That fan-out is unavoidable given the architecture (the union is a TS
 * type and can't be code-generated at runtime), but new tools should at
 * minimum colocate the schema + resolver + permission so they don't drift.
 * This file is that on-ramp.
 *
 * Going forward
 * ─────────────
 * - NEW tools (added after this commit): use `defineTool` and place the
 *   tool's full definition in `lib/agent-tools/<name>.ts`.
 * - EXISTING tools: stay in their inline form. Migrating 100 tools just
 *   to use the helper is churn-for-churn. The helper exists for new
 *   surface area.
 *
 * Convention for new tools
 * ────────────────────────
 *   // lib/agent-tools/edit-contract-draft.ts
 *   import { defineTool } from "@/lib/agent-tool-kit";
 *
 *   export const EditContractDraftTool = defineTool({
 *     name: "edit_contract_draft",
 *     actionKind: "edit_contract_draft",
 *     description: "Edit a drafted contract...",
 *     inputSchema: {
 *       type: "object",
 *       properties: { ... },
 *       required: ["..."],
 *     },
 *     permission: { entity: "contract", action: "edit" },
 *     resolve(input) {
 *       // Pure: validate input, look up referenced entities,
 *       // return { ok: true, action } or { ok: false, reason }.
 *       // The executor (runAction) handles the mutation side.
 *     },
 *   });
 *
 * Then register the tool with `registerTool(EditContractDraftTool)` from
 * `lib/agent-tools/index.ts`. The aggregator exposes:
 *   - allToolSchemas() — for ACTION_TOOLS in route.ts
 *   - resolveTool(ev)  — for the dispatcher in agent-fetch.ts
 *   - toolPermissions() — for ACTION_PERMISSION in agent-actions.ts
 *
 * The AgentAction union member still needs to be added by hand in
 * simulated-agent.ts. We accept that — TS type unions can't be generated
 * at runtime. The helper makes everything else mechanical.
 *
 * Result shape
 * ────────────
 * Resolvers return a discriminated result instead of `Action | null`:
 *   { ok: true; action: T }
 *   { ok: false; reason: string }    ← logged to the agent transcript so
 *                                      the operator sees WHY the tool no-op'd
 * Today most existing resolvers swallow failures with `return null`. The
 * helper opts into the better shape — the dispatcher detects `reason` and
 * yields a `tool_step` event with the explanation.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { Action, Entity } from "@/lib/auth";
import type { AgentAction } from "@/lib/simulated-agent";

/**
 * Result a `resolve()` can return.
 *  - `ok: true` → proposes the action to the operator
 *  - `ok: false` → tool call resolved but yielded no action (e.g. boater
 *    not found). The reason is surfaced in the agent transcript so the
 *    operator sees what went wrong instead of a silent no-op.
 */
export type ResolveResult<T extends AgentAction> =
  | { ok: true; action: T }
  | { ok: false; reason: string };

/**
 * The shape every tool exports. Internally we keep the source `name` and
 * the resolved action's `kind` separate even though they usually match —
 * this lets a tool name expose Claude-friendly verbs ("look_up_boater")
 * while the action kind stays domain-shaped ("boater.read").
 */
export type ToolWireEvent = {
  type: "tool";
  name: string;
  input: Record<string, unknown>;
};

export type DefinedTool<T extends AgentAction = AgentAction> = {
  /** Tool name Claude sees + calls. */
  name: string;
  /** Discriminator on the resolved AgentAction. Usually equals `name`. */
  actionKind: T["kind"];
  /** Claude-facing description; sets expectations + nudges good calls. */
  description: string;
  /** JSON Schema input contract — Anthropic validates against this. */
  inputSchema: Anthropic.Messages.Tool["input_schema"];
  /** RBAC gate — checked in preflightAction. */
  permission: { entity: Entity; action: Action };
  /**
   * Pure resolver: given the raw tool_use input, return the AgentAction the
   * UI should propose (or a `reason` explaining why no action was produced).
   * Must not mutate domain state — the runAction executor handles writes.
   */
  resolve: (ev: ToolWireEvent) => ResolveResult<T>;
};

/**
 * Helper that just identity-returns its argument — its only job is to give
 * each tool definition the same type-checked shape. Wrap every new tool in
 * `defineTool({...})` so the editor surfaces required fields and so future
 * additions to `DefinedTool` propagate through every call site.
 */
export function defineTool<K extends AgentAction["kind"]>(
  def: DefinedTool<Extract<AgentAction, { kind: K }>> & { actionKind: K },
): DefinedTool<Extract<AgentAction, { kind: K }>> {
  return def;
}

/**
 * Tool registry. New tools call `registerTool(MyTool)` and the four
 * consumers (route.ts, agent-fetch.ts, agent-actions.ts) read from this
 * registry instead of hardcoding entries.
 *
 * Module-load order matters here: `lib/agent-tools/index.ts` calls
 * `registerTool` at import time. Anything that calls the readers below
 * must import the index first.
 */
const TOOL_REGISTRY: Map<string, DefinedTool> = new Map();

export function registerTool<T extends AgentAction>(tool: DefinedTool<T>): void {
  if (TOOL_REGISTRY.has(tool.name)) {
    // In production a duplicate name is a real bug — two tools fighting
    // over the same dispatch key. In Next.js dev mode (Turbopack HMR),
    // editing a tool file re-evaluates lib/agent-tools/index.ts and
    // re-runs registerTool for every existing tool — a strict throw
    // kills the dev process on every save. Overwrite + warn in dev so
    // the loop survives; throw in production so real collisions still
    // surface loudly.
    if (process.env.NODE_ENV === "production") {
      throw new Error(`agent-tool-kit: duplicate registration for "${tool.name}"`);
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[agent-tool-kit] re-registering "${tool.name}" (HMR or duplicate import). Last definition wins.`,
    );
  }
  // The Map stores tools as the broad DefinedTool<AgentAction> shape.
  // After dropping the (unused) `summarize` field, T appears only in
  // the covariant position of `resolve`'s return type — so a
  // DefinedTool<Specific> is structurally a DefinedTool<AgentAction>
  // and TS accepts the assignment without `as unknown`. If a future
  // field needs T contravariantly (e.g. a per-tool action validator),
  // revisit this with a wrapping conversion instead of a cast.
  TOOL_REGISTRY.set(tool.name, tool);
}

/** All registered tool schemas — drop into ACTION_TOOLS in route.ts. */
export function registeredToolSchemas(): Anthropic.Messages.Tool[] {
  return Array.from(TOOL_REGISTRY.values()).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

/** Resolver entry point — called from the dispatcher in agent-fetch.ts. */
export function resolveRegisteredTool(
  ev: ToolWireEvent,
): ResolveResult<AgentAction> | null {
  const tool = TOOL_REGISTRY.get(ev.name);
  if (!tool) return null;
  return tool.resolve(ev);
}

/** Permission entries — merge into ACTION_PERMISSION in agent-actions.ts. */
export function registeredToolPermissions(): Record<
  string,
  { entity: Entity; action: Action }
> {
  const out: Record<string, { entity: Entity; action: Action }> = {};
  for (const t of TOOL_REGISTRY.values()) {
    out[t.actionKind] = t.permission;
  }
  return out;
}

/**
 * Sentinel: a tool was found but resolution refused. The dispatcher emits
 * this as a `tool_step` so the operator sees why the agent's suggestion
 * didn't render. Without this, refused tools are invisible.
 */
export function refusalToolStep(name: string, reason: string): {
  name: string;
  result: { kind: "refused"; reason: string };
} {
  return { name, result: { kind: "refused", reason } };
}
