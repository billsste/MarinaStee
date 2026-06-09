"use client";

import * as React from "react";
import { ArrowUp, RefreshCcw, Sparkles } from "lucide-react";
import { AgentChat } from "@/components/agent/agent-chat";
import { cn } from "@/lib/utils";

/*
 * Compact per-page agent input. The same input appears on every list / detail
 * surface — see app/services/*, app/settings, app/ledger, app/reservations,
 * components/work-orders/wo-kanban.
 *
 * Two states:
 *   1. Idle  — slim single-line input + suggestion chips. Looks like a search box.
 *   2. Active — replaces itself with an inline AgentChat, primed with the
 *      user's prompt. The chat owns its own follow-up input so the
 *      conversation continues in place. A small "Reset" link returns to
 *      the idle suggestion view.
 *
 * The agent itself is the single source of truth for what can be done —
 * tools live in app/api/agent/route.ts + lib/simulated-agent.ts.
 */
export function RentalsAsk({
  placeholder = "Ask about rentals — e.g. 'show me vacant slips over 30 feet'",
  suggestions = [
    "Find vacant 30-footers with power",
    "Which contracts expire in October?",
    "Raise all annual rates 5% for 2027",
    "Generate utility charges for May readings",
  ],
}: {
  placeholder?: string;
  suggestions?: string[];
}) {
  const [value, setValue] = React.useState("");
  const [submitted, setSubmitted] = React.useState<string | null>(null);

  function send(text: string) {
    const t = text.trim();
    if (!t) return;
    setSubmitted(t);
    setValue("");
  }

  if (submitted) {
    return (
      <div className="rounded-[12px] border border-hairline bg-surface-1">
        <div className="flex items-center justify-between border-b border-hairline px-3 py-1.5">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-fg-subtle">
            <Sparkles className="size-3 text-primary" />
            <span>Marina Stee Agent</span>
          </div>
          <button
            type="button"
            onClick={() => setSubmitted(null)}
            className="inline-flex items-center gap-1 text-[11px] text-fg-subtle hover:text-fg"
          >
            <RefreshCcw className="size-3" />
            Reset
          </button>
        </div>
        <AgentChat
          initialPrompt={submitted}
          placeholder="Follow up…"
          className="border-0"
          compact
        />
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(value);
        }}
        className="flex items-center gap-2"
      >
        <Sparkles className="ml-1 size-4 shrink-0 text-primary" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          // pl-1 keeps the caret off the placeholder's first character —
          // without it the focus caret butts directly against "Ask the agent…".
          className="block w-full bg-transparent pl-1 text-[14px] text-fg placeholder:text-fg-tertiary focus:outline-none"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          aria-label="Send"
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] transition-colors",
            value.trim()
              ? "bg-primary text-on-primary hover:bg-primary-hover"
              : "bg-surface-3 text-fg-tertiary"
          )}
        >
          <ArrowUp className="size-4" strokeWidth={2.25} />
        </button>
      </form>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => send(s)}
              className="rounded-full border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-muted transition-colors hover:border-hairline-strong hover:bg-surface-2 hover:text-fg"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
