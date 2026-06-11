/*
 * create_help_ticket — agent tool for filing a build-side support
 * ticket against Marina Stee itself (the SaaS provider).
 *
 * Lets the operator say:
 *   "File a bug — the work-order wizard hangs on the Customer step"
 *   "Request an enhancement: per-marina contract templates"
 *   "Ask support how the Convex auth roll-out is going"
 *
 * On approval the executor commits to lib/help-desk.ts's in-browser
 * store (the same store the /help page reads from), so the new ticket
 * appears in My Tickets immediately. When the real admin.marinastee.com
 * backend lands, only the executor's call swaps — the schema, resolver,
 * and surface stay put.
 */

import { defineTool, type ToolWireEvent } from "@/lib/agent-tool-kit";
import type { AgentAction } from "@/lib/simulated-agent";

// Inline the enums rather than importing from lib/help-desk.ts — that
// module is `"use client"` and the agent tool registry evaluates on the
// server too. Keep these in lockstep with AREA_OPTIONS/TYPE_OPTIONS in
// lib/help-desk.ts (we'd ideally pull both from a shared schema module,
// but the duplication is small and the boundary is the cheaper fix).
type HelpTicketType = "issue" | "enhancement" | "question";
type HelpTicketPriority = "low" | "normal" | "high" | "urgent";
type HelpTicketArea =
  | "members"
  | "slips_docks"
  | "contracts"
  | "ledger_pos"
  | "comms"
  | "bookings_rentals"
  | "work_orders"
  | "inbox"
  | "agent"
  | "onboarding"
  | "settings"
  | "auth"
  | "general";

const AREA_VALUES: HelpTicketArea[] = [
  "members",
  "slips_docks",
  "contracts",
  "ledger_pos",
  "comms",
  "bookings_rentals",
  "work_orders",
  "inbox",
  "agent",
  "onboarding",
  "settings",
  "auth",
  "general",
];

type CreateHelpTicketAction = Extract<AgentAction, { kind: "create_help_ticket" }>;

const TYPES = new Set<HelpTicketType>(["issue", "enhancement", "question"]);
const PRIORITIES = new Set<HelpTicketPriority>([
  "low",
  "normal",
  "high",
  "urgent",
]);
const AREAS = new Set<HelpTicketArea>(AREA_VALUES);

export const CreateHelpTicketTool = defineTool({
  name: "create_help_ticket",
  actionKind: "create_help_ticket",
  description:
    "File a build-side support ticket to the Marina Stee SaaS team. Use for 'report a bug', 'request a feature', 'ask the Marina Stee team a question'. Distinct from /support (which is the boater→marina customer-support queue). Requires operator approval; on commit the ticket appears under /help → My tickets.",
  inputSchema: {
    type: "object",
    properties: {
      subject: {
        type: "string",
        description:
          "Short one-line title. <= 80 chars. Example: 'Stepper label truncated on long step names'.",
      },
      description: {
        type: "string",
        description:
          "Full description — what happened, what the operator expected, and any helpful context. Multiple sentences OK.",
      },
      type: {
        type: "string",
        enum: ["issue", "enhancement", "question"],
        description:
          "Default 'issue'. Use 'enhancement' for feature requests, 'question' for how-do-I asks.",
      },
      priority: {
        type: "string",
        enum: ["low", "normal", "high", "urgent"],
        description:
          "Default 'normal'. 'urgent' = production down for this marina, 'high' = blocking a workflow, 'low' = nice-to-have.",
      },
      area: {
        type: "string",
        enum: AREA_VALUES,
        description:
          "Which part of Marina Stee the ticket is about. Default 'general' if unclear.",
      },
      steps_to_reproduce: {
        type: "string",
        description: "Optional. Numbered steps to repro a bug.",
      },
      page_url: {
        type: "string",
        description:
          "Optional. The page url where the issue occurred. The agent should fill from context when available.",
      },
    },
    required: ["subject", "description"],
  },
  permission: { entity: "broadcast", action: "create" },
  resolve(ev: ToolWireEvent) {
    const subject = String(ev.input.subject ?? "").trim();
    const description = String(ev.input.description ?? "").trim();
    if (subject.length < 3) {
      return { ok: false, reason: "subject must be at least 3 characters." };
    }
    if (description.length < 5) {
      return {
        ok: false,
        reason: "description must be at least 5 characters.",
      };
    }

    // Normalize type / priority / area with safe fallbacks so a slightly
    // off model output ("Bug" → "issue") doesn't dead-end. The schema's
    // enum already constrains live-mode responses; this guards simulated +
    // free-form paths.
    const rawType = String(ev.input.type ?? "issue").toLowerCase().trim();
    const type: HelpTicketType = TYPES.has(rawType as HelpTicketType)
      ? (rawType as HelpTicketType)
      : rawType === "bug" || rawType === "defect"
        ? "issue"
        : rawType === "feature" || rawType === "feature_request"
          ? "enhancement"
          : "issue";

    const rawPriority = String(ev.input.priority ?? "normal")
      .toLowerCase()
      .trim();
    const priority: HelpTicketPriority = PRIORITIES.has(
      rawPriority as HelpTicketPriority,
    )
      ? (rawPriority as HelpTicketPriority)
      : "normal";

    const rawArea = String(ev.input.area ?? "general").toLowerCase().trim();
    const area: HelpTicketArea = AREAS.has(rawArea as HelpTicketArea)
      ? (rawArea as HelpTicketArea)
      : "general";

    const stepsRaw = ev.input.steps_to_reproduce;
    const steps =
      typeof stepsRaw === "string" && stepsRaw.trim().length > 0
        ? stepsRaw.trim()
        : undefined;
    const pageUrlRaw = ev.input.page_url;
    const pageUrl =
      typeof pageUrlRaw === "string" && pageUrlRaw.trim().length > 0
        ? pageUrlRaw.trim()
        : undefined;

    const action: CreateHelpTicketAction = {
      kind: "create_help_ticket",
      label: `File a ${type === "issue" ? "bug" : type} ticket: ${subject}`,
      subject,
      description,
      type,
      priority,
      area,
      steps_to_reproduce: steps,
      page_url: pageUrl,
    };
    return { ok: true, action };
  },
});
