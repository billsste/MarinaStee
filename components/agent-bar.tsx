"use client";

import * as React from "react";
import { ArrowUp, Sparkles, X } from "lucide-react";
import { AgentChat } from "@/components/agent/agent-chat";
import { cn } from "@/lib/utils";

export function AgentBar() {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [submitted, setSubmitted] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setSubmitted(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setOpen(true);
    setSubmitted(trimmed);
    setValue("");
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
      <div
        className={cn(
          "pointer-events-auto w-full max-w-[760px] rounded-[14px] border border-hairline bg-surface-1/95 backdrop-blur transition-all",
          open ? "shadow-[0_8px_32px_-12px_rgba(0,0,0,0.25)]" : "shadow-sm"
        )}
      >
        {open && (
          <div className="flex items-center justify-between border-b border-hairline px-3 py-1.5">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-fg-subtle">
              <Sparkles className="size-3 text-primary" />
              <span>Marina Stee Agent</span>
            </div>
            <button
              type="button"
              aria-label="Close agent"
              onClick={() => {
                setOpen(false);
                setSubmitted(null);
              }}
              className="rounded-md p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* Conversation thread, shown after the first submit */}
        {submitted && (
          <AgentChat
            key={submitted}
            initialPrompt={submitted}
            placeholder="Follow up…"
            compact
            className="border-0"
          />
        )}

        {/* Compact composer (only when no thread yet) */}
        {!submitted && (
          <form onSubmit={onSubmit} className="flex items-end gap-2 p-2">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit(e as unknown as React.FormEvent);
                }
              }}
              rows={1}
              placeholder="Ask the agent — or press ⌘K"
              className="block max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] leading-6 text-fg placeholder:text-fg-tertiary focus:outline-none"
            />
            <button
              type="submit"
              disabled={!value.trim()}
              aria-label="Send"
              className={cn(
                "mb-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] transition-colors",
                value.trim()
                  ? "bg-primary text-on-primary hover:bg-primary-hover"
                  : "bg-surface-3 text-fg-tertiary"
              )}
            >
              <ArrowUp className="size-4" strokeWidth={2.25} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
