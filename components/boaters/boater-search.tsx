"use client";

import * as React from "react";
import { Sparkles, Search, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function BoaterSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  // Heuristic: if the input looks like a natural-language command
  // ("add ...", "create ...", contains a verb-like word), treat as create-mode.
  const isCreate = /^(add|create|new|register|sign up)\b/i.test(value.trim());

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-[12px] border bg-surface-1 px-3 py-2 transition-colors",
        isCreate ? "border-primary/60 ring-2 ring-primary/20" : "border-hairline focus-within:border-hairline-strong"
      )}
    >
      <div className="flex size-7 shrink-0 items-center justify-center text-fg-subtle">
        {isCreate ? (
          <Sparkles className="size-4 text-primary" strokeWidth={2} />
        ) : (
          <Search className="size-4" strokeWidth={1.75} />
        )}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Find a boater — or type 'add Sarah Reyes, monthly, slip B-12, 1989 Sea Ray 28ft'"
        className="block flex-1 bg-transparent text-[14px] text-fg placeholder:text-fg-tertiary focus:outline-none"
        aria-label="Search or create a boater"
      />
      <div className="flex items-center gap-2 text-[11px] text-fg-tertiary">
        {isCreate ? (
          <>
            <span className="hidden sm:inline">Agent will draft</span>
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-[6px] bg-primary text-on-primary hover:bg-primary-hover"
              aria-label="Send to agent"
            >
              <ArrowUp className="size-3.5" strokeWidth={2.25} />
            </button>
          </>
        ) : (
          <kbd className="rounded border border-hairline bg-surface-2 px-1 py-0.5 text-[10px] text-fg-subtle">
            /
          </kbd>
        )}
      </div>
    </div>
  );
}
