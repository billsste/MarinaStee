/*
 * navigate_to — second tool migrated to the defineTool registry.
 *
 * Opens a specific page in the app. The chat host detects the action
 * kind, fires `router.push(action.path)` on approve, and writes an
 * audit row. Unlike mutation actions, the executor is a no-op — the
 * side effect lives at the UI layer because navigation is a UI
 * concern, not a domain mutation.
 *
 * Picks a `route_key` from the catalog in lib/routes.ts. The Anthropic
 * tool schema uses `enum: ROUTE_KEYS` so the model literally cannot
 * invent a URL — only existing catalog entries are valid.
 */

import {
  ROUTE_KEYS,
  getRoute,
  resolveRoutePath,
} from "@/lib/routes";
import { defineTool, type ToolWireEvent } from "@/lib/agent-tool-kit";
import type { AgentAction } from "@/lib/simulated-agent";

type NavigateToAction = Extract<AgentAction, { kind: "navigate_to" }>;

export const NavigateToTool = defineTool({
  name: "navigate_to",
  actionKind: "navigate_to",
  description:
    "Propose opening a specific page in the app. The chat shows a clickable card the operator can click to navigate. Use for 'where is X', 'open Y', 'take me to Z'. Pick route_key from the Routes catalog in the system prompt — DO NOT invent URLs or pass arbitrary paths.",
  inputSchema: {
    type: "object",
    properties: {
      route_key: {
        type: "string",
        description:
          "Stable key from the Routes catalog (e.g. 'services.contracts', 'members.detail', 'services.rates'). Must match a key listed in the catalog.",
        enum: ROUTE_KEYS,
      },
      params: {
        type: "object",
        description:
          "Substituted into [param] segments of the route. Required when the catalog entry lists params (e.g. {id: 'b_42'} for members.detail). Omit otherwise.",
        additionalProperties: { type: "string" },
      },
      rationale: {
        type: "string",
        description:
          "One short sentence — why this page answers the user's request. Surfaced to the operator on the link card.",
      },
    },
    required: ["route_key"],
  },
  // No real privilege gate on navigation — every role with `view`
  // permission can move around the app. The audit row still gets
  // written so we see which navigations the agent successfully
  // nudged the operator into.
  permission: { entity: "boater", action: "view" },
  resolve(ev: ToolWireEvent) {
    const routeKey = String(ev.input.route_key ?? "");
    if (!routeKey) {
      return { ok: false, reason: "Missing route_key." };
    }
    const entry = getRoute(routeKey);
    if (!entry) {
      return { ok: false, reason: `Unknown route_key '${routeKey}'.` };
    }

    // Defensively stringify params — Claude sometimes returns numbers.
    const rawParams =
      typeof ev.input.params === "object" && ev.input.params !== null
        ? (ev.input.params as Record<string, unknown>)
        : {};
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawParams)) {
      if (v == null) continue;
      params[k] = String(v);
    }

    let path: string;
    try {
      path = resolveRoutePath(entry, params);
    } catch (err) {
      return {
        ok: false,
        reason:
          err instanceof Error
            ? err.message
            : `Could not resolve path for '${routeKey}'.`,
      };
    }

    const rationale =
      typeof ev.input.rationale === "string" ? ev.input.rationale : undefined;

    const action: NavigateToAction = {
      kind: "navigate_to",
      label: `Open ${entry.label}`,
      route_key: entry.key,
      path,
      route_label: entry.label,
      rationale,
    };
    return { ok: true, action };
  },
});
