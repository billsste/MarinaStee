"use client";

import * as React from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { AgentChat } from "@/components/agent/agent-chat";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "How many slips are vacant?",
  "Who has the largest open balance?",
  "Charge a hoist fee to David Emmons",
  "Any meter anomalies this period?",
];

export function AgentHero() {
  const [value, setValue] = React.useState("");
  const [submitted, setSubmitted] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }, [value]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setSubmitted(trimmed);
    setValue("");
  }

  if (submitted) {
    return (
      <section className="mx-auto w-full max-w-[760px] px-6 pt-6 pb-10">
        <div className="mb-3 flex items-center justify-between">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-1 px-2.5 py-1 text-[11px] font-medium text-fg-subtle">
            <Sparkles className="size-3 text-primary" />
            <span>Marina Stee Agent</span>
          </div>
          <button
            type="button"
            onClick={() => setSubmitted(null)}
            className="text-[11px] text-fg-subtle hover:text-fg"
          >
            Start over
          </button>
        </div>
        <AgentChat initialPrompt={submitted} />
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-[720px] px-6 pt-8 pb-10">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-1 px-2.5 py-1 text-[11px] font-medium text-fg-subtle">
          <Sparkles className="size-3 text-primary" strokeWidth={2} />
          <span>Agent-native marina ops</span>
        </div>
        <h1 className="display-tight text-[36px] font-semibold leading-tight text-fg">
          What do you want to do today?
        </h1>
        <p className="max-w-md text-[14px] leading-6 text-fg-subtle">
          Ask in plain language — assign slips, draft boater messages, reconcile
          the ledger. Or use the menu on the left.
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className={cn(
          "group rounded-[14px] border border-hairline bg-surface-1 p-2.5 transition-colors",
          "focus-within:border-hairline-strong"
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit(e as unknown as React.FormEvent);
            }
          }}
          rows={1}
          placeholder="Message Marina Stee…"
          className="block w-full resize-none bg-transparent px-2.5 py-2 text-[15px] leading-6 text-fg placeholder:text-fg-tertiary focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2 px-1.5 pt-1.5">
          <p className="text-[11px] text-fg-tertiary">
            <kbd className="rounded border border-hairline bg-surface-2 px-1 py-0.5 font-sans text-[10px] text-fg-subtle">⏎</kbd>{" "}
            to send,{" "}
            <kbd className="rounded border border-hairline bg-surface-2 px-1 py-0.5 font-sans text-[10px] text-fg-subtle">⇧⏎</kbd>{" "}
            for newline
          </p>
          <button
            type="submit"
            disabled={!value.trim()}
            aria-label="Send"
            className={cn(
              "tap-scale inline-flex size-9 items-center justify-center rounded-full transition-colors",
              value.trim()
                ? "bg-primary text-on-primary hover:bg-primary-hover"
                : "bg-surface-3 text-fg-tertiary"
            )}
          >
            <ArrowUp className="size-4" strokeWidth={2.25} />
          </button>
        </div>
      </form>

      <ul className="mt-6 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => setSubmitted(s)}
              className="rounded-full border border-hairline bg-surface-1 px-3 py-1.5 text-[12px] text-fg-muted transition-colors hover:border-hairline-strong hover:bg-surface-2 hover:text-fg"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
