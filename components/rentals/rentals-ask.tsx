"use client";

import * as React from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

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

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
        }}
        className="flex items-center gap-2"
      >
        <Sparkles className="size-4 shrink-0 text-primary" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="block w-full bg-transparent text-[14px] text-fg placeholder:text-fg-tertiary focus:outline-none"
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
              onClick={() => setValue(s)}
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
