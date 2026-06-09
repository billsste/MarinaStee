"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { LocalTime } from "@/components/ui/local-time";
import { cn } from "@/lib/utils";
import type { SupportTicketMessage } from "@/lib/types";

/*
 * Support ticket conversation thread.
 *
 * Three author kinds, visually distinct per global §5:
 *  - boater  → right-aligned, primary-tinted bubble
 *  - staff   → left-aligned, surface-2 bubble (marina reply)
 *  - system  → centered, muted strip ("Ticket received", "Cancelled by …")
 *
 * Composer is optional — `onSend` undefined means read-only (cancelled
 * tickets, or staff viewing in a read-only context). Submit clears
 * the textarea on success.
 */

interface Props {
  messages: SupportTicketMessage[];
  /** Optional reply composer. Omit for read-only views. */
  onSend?: (body: string) => void;
  /** Author label rendered for the *current viewer's* outgoing
   *  messages (boater portal → boater's name; operator queue → staff). */
  viewerKind?: "boater" | "staff";
  placeholder?: string;
}

export function SupportConversation({
  messages,
  onSend,
  viewerKind = "boater",
  placeholder,
}: Props) {
  const [draft, setDraft] = React.useState("");
  const endRef = React.useRef<HTMLLIElement>(null);

  // Pin to bottom whenever the thread grows so the latest reply is in
  // view — same behavior as iMessage / Slack threads.
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function submit() {
    if (!onSend) return;
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft("");
  }

  return (
    <div className="flex flex-col">
      <div className="max-h-[360px] overflow-y-auto pr-1">
        <ul className="space-y-2.5">
          {messages.map((m) => (
            <li key={m.id}>
              <MessageBubble message={m} viewerKind={viewerKind} />
            </li>
          ))}
          <li ref={endRef} aria-hidden />
        </ul>
      </div>

      {onSend && (
        <div className="mt-3 rounded-[12px] border border-hairline bg-surface-1 p-2.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              placeholder ??
              (viewerKind === "boater"
                ? "Reply to the marina…"
                : "Reply to the boater…")
            }
            rows={2}
            className="w-full resize-none rounded-[8px] bg-surface-1 px-2 py-1.5 text-[13px] text-fg placeholder:text-fg-tertiary focus:outline-none"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[10px] text-fg-tertiary">
              ⌘↵ to send
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim()}
              className={cn(
                "rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors",
                draft.trim()
                  ? "bg-primary text-on-primary hover:bg-primary-hover"
                  : "cursor-not-allowed bg-surface-3 text-fg-tertiary",
              )}
            >
              Send reply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  viewerKind,
}: {
  message: SupportTicketMessage;
  viewerKind: "boater" | "staff";
}) {
  if (message.author_kind === "system") {
    // System notices — centered, muted, with a sparkle to mark them as
    // automated. Carries the "received", "cancelled", "marked resolved"
    // copy so the timeline reads chronologically.
    return (
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-2 px-2.5 py-1 text-[11px] text-fg-tertiary">
          <Sparkles className="size-3 text-primary" />
          <span>{message.body}</span>
          <span className="text-fg-tertiary/70">·</span>
          <LocalTime iso={message.created_at} fmt="short_datetime" />
        </div>
      </div>
    );
  }

  const isOwn = message.author_kind === viewerKind;
  const align = isOwn ? "items-end" : "items-start";
  const bubbleTone = isOwn
    ? "bg-primary-soft/60 text-fg border-primary/20"
    : "bg-surface-2 text-fg border-hairline";

  return (
    <div className={cn("flex flex-col gap-1", align)}>
      <div
        className={cn(
          "max-w-[85%] rounded-[12px] border px-3 py-2 text-[13px] leading-5 whitespace-pre-wrap",
          bubbleTone,
        )}
      >
        {message.body}
      </div>
      <div className="text-[10px] text-fg-tertiary">
        {message.author_label}
        <span className="px-1 text-fg-tertiary/70">·</span>
        <LocalTime iso={message.created_at} fmt="short_datetime" />
      </div>
    </div>
  );
}
