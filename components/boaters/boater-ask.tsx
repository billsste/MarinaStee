"use client";

import * as React from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Boater } from "@/lib/types";

/*
 * Slim top-of-page agent composer for the boater detail. Replaces the old
 * right-rail AskRail (per the "agent on top only" rule). Suggestions are
 * scoped to this boater.
 *
 * Form currently captures the prompt locally; future work is to route it to
 * the dashboard agent or a per-boater agent surface.
 */
export function BoaterAsk({ boater }: { boater: Boater }) {
  const [value, setValue] = React.useState("");

  const QUICK_ASKS = [
    "Outstanding balance?",
    "When does their contract expire?",
    "Draft a payment reminder",
    "Refund the last fuel charge",
  ];

  return (
    <section className="rounded-[12px] border border-hairline bg-surface-1 px-4 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-fg-subtle">
        <Sparkles className="size-3 text-primary" />
        Ask about {boater.first_name}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
        }}
        className="flex items-center gap-2"
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`What about ${boater.first_name}?`}
          className="block min-w-0 flex-1 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          aria-label="Send"
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-[8px]",
            value.trim()
              ? "bg-primary text-on-primary hover:bg-primary-hover"
              : "bg-surface-3 text-fg-tertiary"
          )}
        >
          <ArrowUp className="size-4" strokeWidth={2.25} />
        </button>
      </form>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {QUICK_ASKS.map((q) => (
          <li key={q}>
            <button
              type="button"
              onClick={() => setValue(q)}
              className="rounded-full border border-hairline bg-surface-2 px-2.5 py-1 text-[11px] text-fg-muted transition-colors hover:border-hairline-strong hover:bg-surface-3 hover:text-fg"
            >
              {q}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
