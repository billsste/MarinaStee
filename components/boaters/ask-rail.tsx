"use client";

import * as React from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Boater } from "@/lib/types";

export function AskRail({ boater }: { boater: Boater }) {
  const [value, setValue] = React.useState("");

  const QUICK_ASKS = [
    "Outstanding balance?",
    "When does their contract expire?",
    "Draft a payment reminder",
    "Last 30 days of activity",
    `Refund the last fuel charge`,
  ];

  return (
    <aside className="hidden w-[300px] shrink-0 lg:block">
      <div className="sticky top-4 flex flex-col gap-3">
        <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
          <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-fg-subtle">
            <Sparkles className="size-3 text-primary" />
            Ask about {boater.first_name}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
            }}
            className="flex items-end gap-2"
          >
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={`What about ${boater.first_name}?`}
              rows={2}
              className="block max-h-32 flex-1 resize-none rounded-[8px] border border-hairline bg-surface-2 px-2 py-1.5 text-[13px] leading-5 text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
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
          <ul className="mt-3 flex flex-col gap-1">
            {QUICK_ASKS.map((q) => (
              <li key={q}>
                <button
                  type="button"
                  onClick={() => setValue(q)}
                  className="w-full rounded-[6px] px-2 py-1.5 text-left text-[12px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
            Comm prefs
          </div>
          <div className="space-y-1 text-[12px] text-fg-muted">
            <div>
              <span className="text-fg-tertiary">Channel:</span>{" "}
              <span className="font-medium text-fg capitalize">
                {boater.communication_prefs.preferred_channel}
              </span>
            </div>
            {boater.communication_prefs.do_not_contact_after && (
              <div>
                <span className="text-fg-tertiary">Quiet hours:</span>{" "}
                <span className="font-medium text-fg">
                  after {boater.communication_prefs.do_not_contact_after}
                </span>
              </div>
            )}
            <div>
              <span className="text-fg-tertiary">Language:</span>{" "}
              <span className="font-medium text-fg uppercase">
                {boater.communication_prefs.language}
              </span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
