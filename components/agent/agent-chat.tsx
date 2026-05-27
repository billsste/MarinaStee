"use client";

import * as React from "react";
import { Sparkles, ArrowUp, CheckCheck, X, User as UserIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatPhone } from "@/lib/utils";
import { useStore } from "@/lib/client-store";
import type { AgentAction } from "@/lib/simulated-agent";
import { executeAgentAction } from "@/lib/agent-actions";
import { useCurrentUser } from "@/lib/auth";
import { streamAgent } from "@/lib/agent-fetch";

type Message =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "agent";
      id: string;
      text: string;     // built up as chunks stream in
      streaming: boolean;
      actions: { action: AgentAction; executed?: boolean; dismissed?: boolean; refusedReason?: string }[];
      toolSteps: { name: string; result: unknown }[];
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
  const currentUser = useCurrentUser();
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
        { kind: "agent", id: agentId, text: "", streaming: true, actions: [], toolSteps: [] },
      ]);

      try {
        for await (const ev of streamAgent(trimmed, ledger)) {
          if (ev.kind === "text") {
            setMessages((prev) =>
              prev.map((m) =>
                m.kind === "agent" && m.id === agentId
                  ? { ...m, text: m.text + ev.text }
                  : m
              )
            );
          } else if (ev.kind === "action") {
            setMessages((prev) =>
              prev.map((m) =>
                m.kind === "agent" && m.id === agentId
                  ? { ...m, actions: [...m.actions, { action: ev.action }] }
                  : m
              )
            );
          } else if (ev.kind === "tool_step") {
            setMessages((prev) =>
              prev.map((m) =>
                m.kind === "agent" && m.id === agentId
                  ? { ...m, toolSteps: [...m.toolSteps, { name: ev.name, result: ev.result }] }
                  : m
              )
            );
          } else if (ev.kind === "error") {
            setMessages((prev) =>
              prev.map((m) =>
                m.kind === "agent" && m.id === agentId
                  ? { ...m, text: m.text + `\n[agent error: ${ev.message}]` }
                  : m
              )
            );
          }
        }
      } finally {
        setMessages((prev) =>
          prev.map((m) =>
            m.kind === "agent" && m.id === agentId ? { ...m, streaming: false } : m
          )
        );
      }
    },
    [ledger]
  );

  React.useEffect(() => {
    if (initialPrompt && !initialFired.current) {
      initialFired.current = true;
      submit(initialPrompt);
    }
  }, [initialPrompt, submit]);

  function approveAction(messageId: string, index: number) {
    const m = messages.find((x) => x.kind === "agent" && x.id === messageId);
    if (!m || m.kind !== "agent" || !m.actions[index]) return;
    const result = executeAgentAction(m.actions[index].action, currentUser.role);
    setMessages((prev) =>
      prev.map((x) =>
        x.kind === "agent" && x.id === messageId
          ? {
              ...x,
              actions: x.actions.map((a, i) =>
                i === index
                  ? result.ok
                    ? { ...a, executed: true }
                    : { ...a, refusedReason: result.reason }
                  : a
              ),
            }
          : x
      )
    );
  }

  function dismissAction(messageId: string, index: number) {
    setMessages((prev) =>
      prev.map((x) =>
        x.kind === "agent" && x.id === messageId
          ? {
              ...x,
              actions: x.actions.map((a, i) =>
                i === index ? { ...a, dismissed: true } : a
              ),
            }
          : x
      )
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
              Try: "largest open balance" · "winterize David's Bayliner" · "record a $400 check from Emmons" · "book A12 for Peterson Friday night"
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
                  onApprove={(i) => approveAction(m.id, i)}
                  onDismiss={(i) => dismissAction(m.id, i)}
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
  onApprove: (index: number) => void;
  onDismiss: (index: number) => void;
}) {
  return (
    <li className="flex max-w-[92%] flex-col gap-2">
      {/* Tool steps — show the agent's thinking trail */}
      {message.toolSteps.length > 0 && (
        <ul className="ml-8 flex flex-col gap-0.5 text-[11px] text-fg-tertiary">
          {message.toolSteps.map((s, i) => (
            <li key={i} className="inline-flex items-center gap-1.5">
              <span className="font-mono">↳</span>
              <span className="font-medium text-fg-subtle">{prettyToolName(s.name)}</span>
              <span className="text-fg-tertiary">— {summarizeResult(s.result)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-start gap-2">
        <div className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-2 text-primary">
          <Sparkles className="size-3" />
        </div>
        <div className="rounded-[12px] rounded-bl-[4px] border border-hairline bg-surface-2 px-3 py-2 text-[14px] leading-6 text-fg">
          {message.text || (message.streaming ? "Thinking…" : "")}
          {message.streaming && (
            <span className="ml-0.5 inline-block size-1.5 animate-pulse rounded-full bg-primary align-baseline" />
          )}
        </div>
      </div>
      {message.actions.map((a, i) =>
        a.dismissed ? null : (
          <ActionCard
            key={i}
            action={a.action}
            executed={!!a.executed}
            refusedReason={a.refusedReason}
            onApprove={() => onApprove(i)}
            onDismiss={() => onDismiss(i)}
          />
        )
      )}
    </li>
  );
}

function prettyToolName(n: string) {
  return n
    .replace(/^query_/, "queried ")
    .replace(/_/g, " ");
}

function summarizeResult(r: unknown): string {
  if (!r || typeof r !== "object") return String(r);
  const obj = r as Record<string, unknown>;
  if (typeof obj.count === "number") {
    const totalOpen = obj.total_open as number | undefined;
    return totalOpen !== undefined
      ? `${obj.count} result${obj.count === 1 ? "" : "s"} · $${totalOpen.toLocaleString()}`
      : `${obj.count} result${obj.count === 1 ? "" : "s"}`;
  }
  return "done";
}

function ActionCard({
  action,
  executed,
  refusedReason,
  onApprove,
  onDismiss,
}: {
  action: AgentAction;
  executed: boolean;
  refusedReason?: string;
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
      {action.kind === "create_work_order" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.subject}
          {action.activity_type && ` · ${action.activity_type.replace("_", " ")}`}
          {action.priority && ` · ${action.priority}`}
          {action.due_date && ` · due ${action.due_date}`}
        </p>
      )}
      {action.kind === "create_reservation" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.arrival_date} → {action.departure_date} · {action.type}
        </p>
      )}
      {action.kind === "record_payment" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          ${action.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} · {action.method}
          {action.notes && ` · ${action.notes}`}
        </p>
      )}
      {action.kind === "create_boater" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.email && `${action.email} · `}
          {action.phone && `${formatPhone(action.phone)} · `}
          {action.preferred_channel} · {action.billing_cadence}
        </p>
      )}
      {action.kind === "create_vessel" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {[
            action.year,
            action.make,
            action.model,
            action.vessel_type,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {action.kind === "create_contract" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.template_id.replace("tpl_", "").replace("_", " ")} · {action.effective_start} → {action.effective_end}
          {action.annual_rate && ` · $${action.annual_rate.toLocaleString()}/yr`}
        </p>
      )}
      {action.kind === "add_card" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.brand} ····{action.last4} · exp {String(action.exp_month).padStart(2, "0")}/{String(action.exp_year).slice(-2)}
          {action.is_default && " · default"}
        </p>
      )}
      {refusedReason && (
        <div className="mt-2 rounded-[8px] border border-status-warn/30 bg-status-warn/10 px-2.5 py-1.5 text-[12px] text-status-warn">
          {refusedReason}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        {executed ? (
          <Badge tone="ok">
            <CheckCheck className="size-3" />
            Executed
          </Badge>
        ) : refusedReason ? (
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            <X className="size-3.5" />
            Dismiss
          </Button>
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
