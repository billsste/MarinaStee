/*
 * schedule_reminder — first tool built via lib/agent-tool-kit.ts.
 *
 * Schedules a future-dated SMS/email follow-up to a boater. Common operator
 * asks:
 *   "Text Jones in two weeks to confirm slip change"
 *   "Email everyone overdue tomorrow morning"  (paired with a report tool)
 *   "Set a reminder for myself to call Hess about COI on Monday"
 *
 * On approval, the executor logs the reminder to the SCHEDULED_REMINDERS
 * store. The dispatcher actually sending the message at the due time is
 * a separate worker (not yet built) — for now, schedule_reminder is a
 * write-only commit that surfaces in /notifications + the audit log.
 *
 * This file is the reference template for every NEW tool. Look at the
 * structure here when adding the next one:
 *   - One file in lib/agent-tools/<name>.ts
 *   - defineTool({...}) at the top, registered in lib/agent-tools/index.ts
 *   - Schema in the file, not split across route.ts
 *   - Resolver in the file, not split across agent-fetch.ts
 *   - Permission in the file, not split across agent-actions.ts
 *   - Action type still added by hand in simulated-agent.ts (TS union limit)
 *   - Executor still added by hand in agent-actions.ts runAction (mutation
 *     logic needs the client-store import which is browser-only)
 *
 * Trade-off: not 100% colocation, but 4 places → 2 places is a real win.
 */

import { findBoaterFuzzy } from "@/lib/boater-lookup";
import { defineTool, type ToolWireEvent } from "@/lib/agent-tool-kit";
import type { AgentAction } from "@/lib/simulated-agent";

type ScheduleReminderAction = Extract<AgentAction, { kind: "schedule_reminder" }>;

export const ScheduleReminderTool = defineTool({
  name: "schedule_reminder",
  actionKind: "schedule_reminder",
  description:
    "Schedule a future-dated SMS or email follow-up to a boater. Use for 'remind me to text X next week', 'set a follow-up with Y in 30 days', 'email everyone overdue tomorrow morning'. Requires operator approval — the message dispatches at due_at.",
  inputSchema: {
    type: "object",
    properties: {
      boater_query: {
        type: "string",
        description:
          "Last name, first name, or slip code identifying the boater. Examples: 'Jones', 'Robert', 'A04'.",
      },
      due_at: {
        type: "string",
        description:
          "When to send. Accepts YYYY-MM-DD (interpreted as 9am local) or full ISO datetime. Examples: '2026-09-15', '2026-09-15T14:00:00'.",
      },
      channel: {
        type: "string",
        enum: ["sms", "email"],
        description: "Default to the boater's preferred_channel.",
      },
      subject: {
        type: "string",
        description: "Email subject; ignored for SMS.",
      },
      body: {
        type: "string",
        description: "1-3 short sentences. Use the boater's first name.",
      },
      reason: {
        type: "string",
        description:
          "Short tag explaining why — 'renewal follow-up', 'COI expiring', 'pump-out reminder'. Surfaces in /notifications + audit log.",
      },
    },
    required: ["boater_query", "due_at", "channel", "body"],
  },
  permission: { entity: "broadcast", action: "create" },
  resolve(ev: ToolWireEvent) {
    const boaterQuery = String(ev.input.boater_query ?? "").trim();
    const dueAtRaw = String(ev.input.due_at ?? "").trim();
    const channel = String(ev.input.channel ?? "").trim();
    const body = String(ev.input.body ?? "").trim();
    if (!boaterQuery || !dueAtRaw || !channel || !body) {
      return { ok: false, reason: "Missing one of: boater_query, due_at, channel, body." };
    }
    if (channel !== "sms" && channel !== "email") {
      return { ok: false, reason: `channel must be 'sms' or 'email' (got '${channel}').` };
    }

    // Shared fuzzy lookup (id → last name → first name → slip code).
    // findBoaterFuzzy lives in lib/agent-fetch.ts — exported so new
    // tools don't re-inline the lookup.
    const boater = findBoaterFuzzy(boaterQuery);
    if (!boater) {
      return { ok: false, reason: `No boater matched '${boaterQuery}'.` };
    }

    // Normalize due_at — accept YYYY-MM-DD → bump to 9am local, full ISO passes through.
    let dueAt = dueAtRaw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dueAtRaw)) {
      dueAt = `${dueAtRaw}T09:00:00`;
    }
    const dueDate = new Date(dueAt);
    if (Number.isNaN(dueDate.getTime())) {
      return { ok: false, reason: `Couldn't parse due_at '${dueAtRaw}'.` };
    }
    // Defensive: refuse past-dated reminders — operator probably typo'd.
    if (dueDate.getTime() < Date.now() - 60_000) {
      return { ok: false, reason: `due_at '${dueAtRaw}' is in the past.` };
    }

    const subject =
      typeof ev.input.subject === "string" && ev.input.subject.trim().length > 0
        ? ev.input.subject.trim()
        : undefined;
    const reason =
      typeof ev.input.reason === "string" && ev.input.reason.trim().length > 0
        ? ev.input.reason.trim()
        : undefined;

    const labelDate = dueDate.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    const action: ScheduleReminderAction = {
      kind: "schedule_reminder",
      label: `Remind ${boater.display_name} on ${labelDate}${reason ? ` — ${reason}` : ""}`,
      boater_id: boater.id,
      due_at: dueAt,
      channel: channel as "sms" | "email",
      subject,
      body,
      reason,
    };
    return { ok: true, action };
  },
});
