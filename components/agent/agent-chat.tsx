"use client";

import * as React from "react";
import { Sparkles, ArrowUp, CheckCheck, X, User as UserIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/client-store";
import {
  executeAgentAction,
  type AgentAction,
} from "@/lib/simulated-agent";
import { startAgentStream } from "@/lib/agent-fetch";

type Message =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "agent";
      id: string;
      text: string;     // built up as chunks stream in
      streaming: boolean;
      action?: AgentAction;
      actionExecuted?: boolean;
      actionDismissed?: boolean;
    };

export function AgentChat({
  initialPrompt,
  placeholder = "Ask Marina Stee anything…",
  className,
  compact = false,
}: {
  initialPrompt?: string;
  placeholder?: string;
  className?: string;
  compact?: boolean;
}) {
  const { ledger } = useStore();
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState("");
  const initialFired = React.useRef(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll on new content
  React.useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const submit = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const userId = `m_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const agentId = `m_a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      setMessages((prev) => [
        ...prev,
        { kind: "user", id: userId, text: trimmed },
        { kind: "agent", id: agentId, text: "", streaming: true },
      ]);

      // Tries the real /api/agent stream first (when ANTHROPIC_API_KEY is set
      // server-side), otherwise produces the deterministic simulated stream.
      // Either way the action proposal comes from the local schema matcher.
      const result = await startAgentStream(trimmed, ledger);

      for await (const chunk of result.text) {
        setMessages((prev) =>
          prev.map((m) =>
            m.kind === "agent" && m.id === agentId ? { ...m, text: m.text + chunk } : m
          )
        );
      }

      const action = await result.actionPromise;
      setMessages((prev) =>
        prev.map((m) =>
          m.kind === "agent" && m.id === agentId
            ? { ...m, streaming: false, action }
            : m
        )
      );
    },
    [ledger]
  );

  React.useEffect(() => {
    if (initialPrompt && !initialFired.current) {
      initialFired.current = true;
      submit(initialPrompt);
    }
  }, [initialPrompt, submit]);

  function approveAction(messageId: string) {
    const m = messages.find((x) => x.kind === "agent" && x.id === messageId);
    if (!m || m.kind !== "agent" || !m.action) return;
    executeAgentAction(m.action);
    setMessages((prev) =>
      prev.map((x) => (x.kind === "agent" && x.id === messageId ? { ...x, actionExecuted: true } : x))
    );
  }

  function dismissAction(messageId: string) {
    setMessages((prev) =>
      prev.map((x) => (x.kind === "agent" && x.id === messageId ? { ...x, actionDismissed: true } : x))
    );
  }

  return (
    <div className={cn("flex flex-col rounded-[14px] border border-hairline bg-surface-1", className)}>
      <div
        ref={scrollRef}
        className={cn(
          "flex-1 overflow-y-auto p-4",
          compact ? "max-h-[360px]" : "max-h-[520px] min-h-[280px]"
        )}
      >
        {messages.length === 0 ? (
          <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 text-center">
            <Sparkles className="size-5 text-primary" />
            <p className="text-[12px] text-fg-subtle">
              Try: "who has the largest open balance" · "vacant 30-footers with power" · "charge a hoist fee to David"
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {messages.map((m) =>
              m.kind === "user" ? (
                <UserBubble key={m.id} text={m.text} />
              ) : (
                <AgentBubble
                  key={m.id}
                  message={m}
                  onApprove={() => approveAction(m.id)}
                  onDismiss={() => dismissAction(m.id)}
                />
              )
            )}
          </ul>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
          setInput("");
        }}
        className="flex items-end gap-2 border-t border-hairline p-2.5"
      >
        <Sparkles className="mb-2 size-4 shrink-0 text-primary" />
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(input);
              setInput("");
            }
          }}
          rows={1}
          placeholder={placeholder}
          className="block max-h-32 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[14px] leading-6 text-fg placeholder:text-fg-tertiary focus:outline-none"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          aria-label="Send"
          className={cn(
            "mb-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] transition-colors",
            input.trim()
              ? "bg-primary text-on-primary hover:bg-primary-hover"
              : "bg-surface-3 text-fg-tertiary"
          )}
        >
          <ArrowUp className="size-4" strokeWidth={2.25} />
        </button>
      </form>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <li className="flex justify-end">
      <div className="max-w-[80%] rounded-[12px] rounded-br-[4px] bg-primary px-3 py-2 text-[14px] text-on-primary">
        {text}
      </div>
    </li>
  );
}

function AgentBubble({
  message,
  onApprove,
  onDismiss,
}: {
  message: Extract<Message, { kind: "agent" }>;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  return (
    <li className="flex max-w-[92%] flex-col gap-2">
      <div className="flex items-start gap-2">
        <div className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-2 text-primary">
          <Sparkles className="size-3" />
        </div>
        <div className="rounded-[12px] rounded-bl-[4px] border border-hairline bg-surface-2 px-3 py-2 text-[14px] leading-6 text-fg">
          {message.text}
          {message.streaming && (
            <span className="ml-0.5 inline-block size-1.5 animate-pulse rounded-full bg-primary align-baseline" />
          )}
        </div>
      </div>
      {message.action && !message.actionDismissed && (
        <ActionCard
          action={message.action}
          executed={!!message.actionExecuted}
          onApprove={onApprove}
          onDismiss={onDismiss}
        />
      )}
    </li>
  );
}

function ActionCard({
  action,
  executed,
  onApprove,
  onDismiss,
}: {
  action: AgentAction;
  executed: boolean;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="ml-8 rounded-[10px] border border-primary/30 bg-primary-soft/40 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
        <Sparkles className="size-3 text-primary" />
        Proposed action
      </div>
      <div className="text-[13px] font-medium text-fg">{action.label}</div>
      {action.kind === "send_message" && (
        <p className="mt-1 max-w-md text-[12px] italic text-fg-subtle">"{action.body}"</p>
      )}
      <div className="mt-3 flex items-center gap-2">
        {executed ? (
          <Badge tone="ok">
            <CheckCheck className="size-3" />
            Executed
          </Badge>
        ) : (
          <>
            <Button variant="primary" size="sm" onClick={onApprove}>
              <CheckCheck className="size-3.5" />
              Approve
            </Button>
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              <X className="size-3.5" />
              Dismiss
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// Silence unused-import warnings; UserIcon kept available for future @-mentions.
void UserIcon;
