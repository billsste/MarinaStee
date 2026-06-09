"use client";

import * as React from "react";
import { ArrowUp, Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { executeAgentAction } from "@/lib/agent-actions";
import { streamHolderAgent } from "@/lib/agent-fetch";
import { useLedgerForBoater } from "@/lib/client-store";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/mock-data";
import {
  formatTableCell,
  isTableResult,
  tableColumnAlign,
  type TableResult,
} from "@/lib/agent-reports";
import type { AgentAction } from "@/lib/simulated-agent";
import type { Boater } from "@/lib/types";

/*
 * HolderAgentChat — mobile-first agent chat for the holder portal.
 *
 * Differences from the staff AgentChat:
 *  - Calls streamHolderAgent (mode=holder, scoped to this boater)
 *  - Warmer voice in placeholder + empty state
 *  - Action cards render holder-* kinds with friendly per-kind summaries
 *  - "Approve" labels framed as the holder confirming their own action
 *    ("Send", "Pay now", "Submit", "Request") instead of staff "Approve"
 */

type Message =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "agent";
      id: string;
      text: string;
      streaming: boolean;
      actions: {
        action: AgentAction;
        executed?: boolean;
        dismissed?: boolean;
        refusedReason?: string;
      }[];
      // Tool results — TableResult ones render as actual table cards
      // (balance, history, vessels). Non-table results are silently
      // dropped on the holder surface; we don't want the boater seeing
      // raw debug "↳ queried X" trails the way operators do.
      tables: TableResult[];
    };

export function HolderAgentChat({
  boater,
  initialPrompt,
  suggestions = HOLDER_SUGGESTIONS,
  placeholder = "Type to the marina…",
  className,
}: {
  boater: Boater;
  initialPrompt?: string;
  suggestions?: string[];
  placeholder?: string;
  className?: string;
}) {
  const ledger = useLedgerForBoater(boater.id);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState("");
  const initialFired = React.useRef(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const submit = React.useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const uid = Math.random().toString(36).slice(2, 6);
      const userId = `hu_${Date.now()}_${uid}`;
      const agentId = `ha_${Date.now()}_${uid}`;

      setMessages((prev) => [
        ...prev,
        { kind: "user", id: userId, text: trimmed },
        { kind: "agent", id: agentId, text: "", streaming: true, actions: [], tables: [] },
      ]);

      try {
        for await (const ev of streamHolderAgent(trimmed, ledger, boater.id)) {
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
            // Holder only sees TABLE results — non-table tool results
            // (counts, single facts) get folded into the agent's text
            // reply by the model. Showing raw "↳ queried X — 3 results"
            // crumbs in a boater-facing UI feels too technical.
            if (isTableResult(ev.result)) {
              const table = ev.result as TableResult;
              setMessages((prev) =>
                prev.map((m) =>
                  m.kind === "agent" && m.id === agentId
                    ? { ...m, tables: [...m.tables, table] }
                    : m
                )
              );
            }
          } else if (ev.kind === "error") {
            setMessages((prev) =>
              prev.map((m) =>
                m.kind === "agent" && m.id === agentId
                  ? { ...m, text: m.text + `\n[${ev.message}]` }
                  : m
              )
            );
          }
        }
      } finally {
        setMessages((prev) =>
          prev.map((m) =>
            m.kind === "agent" && m.id === agentId
              ? { ...m, streaming: false }
              : m
          )
        );
      }
    },
    [boater.id, ledger]
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
    const result = executeAgentAction(m.actions[index].action);
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
    <div className={cn("flex flex-col", className)}>
      {messages.length === 0 ? (
        // Idle state — the input lives in the parent HolderShell hero;
        // here we just show the friendly suggestion chips.
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => submit(s)}
              className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-2 px-2.5 py-1 text-[11px] text-fg-subtle hover:border-primary/40 hover:bg-primary-soft/30 hover:text-fg"
            >
              {s}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="max-h-[55vh] min-h-[160px] overflow-y-auto px-1 py-2"
          >
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
          </div>
        </>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
          setInput("");
        }}
        className="mt-3 flex items-center gap-2 rounded-[12px] border border-hairline bg-surface-2 px-3 py-2 focus-within:border-primary/50 focus-within:bg-surface-1"
      >
        <Sparkles className="size-3.5 shrink-0 text-fg-tertiary" />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[14px] text-fg placeholder:text-fg-tertiary focus:outline-none"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
            input.trim()
              ? "bg-primary text-on-primary hover:opacity-90"
              : "bg-surface-3 text-fg-tertiary"
          )}
          aria-label="Send"
        >
          <ArrowUp className="size-3.5" />
        </button>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────

const HOLDER_SUGGESTIONS = [
  "What's my balance?",
  "Pay my open invoice",
  "Schedule a pump-out for Saturday",
  "I need to submit a work order",
  "Review my contract",
  "Update my phone number",
];

function UserBubble({ text }: { text: string }) {
  return (
    <li className="flex justify-end">
      <div className="max-w-[80%] rounded-[14px] rounded-br-[4px] bg-primary px-3 py-2 text-[14px] leading-5 text-on-primary">
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
    <li className="flex max-w-full flex-col gap-2">
      <div className="flex items-start gap-2">
        <div className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-2 text-primary">
          <Sparkles className="size-3" />
        </div>
        <div className="rounded-[14px] rounded-bl-[4px] border border-hairline bg-surface-2 px-3 py-2 text-[14px] leading-5 text-fg">
          {message.text || (message.streaming ? "Thinking…" : "")}
          {message.streaming && (
            <span className="ml-0.5 inline-block size-1.5 animate-pulse rounded-full bg-primary align-baseline" />
          )}
        </div>
      </div>
      {/* Table results — render below the bubble so the holder can scan
          their balance / history / vessels inline without leaving chat. */}
      {message.tables.length > 0 && (
        <div className="ml-8 flex flex-col gap-2">
          {message.tables.map((t, i) => (
            <HolderTableCard key={i} table={t} />
          ))}
        </div>
      )}
      {message.actions.map((a, i) =>
        a.dismissed ? null : (
          <HolderActionCard
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

/**
 * Holder-mode table card — lighter chrome than the operator TableCard.
 * No CSV export (boater doesn't need a spreadsheet), no count chip
 * (clutter), but same per-column formatting.
 */
function HolderTableCard({ table }: { table: TableResult }) {
  // Shared formatters live in lib/agent-reports.ts next to TableResult.
  // Precompute per-column alignment classes once.
  const columnsMeta = React.useMemo(
    () =>
      table.columns.map((c) => {
        const isRight = tableColumnAlign(c.format, c.align) === "right";
        return {
          col: c,
          thClass: cn(
            "px-3 py-1.5 font-medium",
            isRight ? "text-right" : "text-left",
          ),
          tdClass: cn(
            "px-3 py-1.5",
            isRight ? "text-right tabular-nums" : "text-left",
          ),
        };
      }),
    [table.columns],
  );
  return (
    <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
      <div className="border-b border-hairline px-3 py-2">
        <div className="text-[13px] font-medium text-fg">{table.title}</div>
        {table.subtitle && (
          <div className="mt-0.5 text-[12px] text-fg-subtle">{table.subtitle}</div>
        )}
      </div>
      {table.rows.length === 0 ? (
        <div className="px-3 py-4 text-center text-[12px] text-fg-subtle">
          Nothing to show.
        </div>
      ) : (
        <div className="max-h-[260px] overflow-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-surface-2 text-[11px] uppercase tracking-wide text-fg-subtle">
              <tr>
                {columnsMeta.map(({ col, thClass }) => (
                  <th key={col.key} className={thClass}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-hairline/60">
                  {columnsMeta.map(({ col, tdClass }) => (
                    <td key={col.key} className={tdClass}>
                      {formatTableCell(r[col.key], col.format)}
                    </td>
                  ))}
                </tr>
              ))}
              {table.total_row && (
                <tr className="border-t-2 border-hairline bg-surface-2/60 font-medium">
                  {columnsMeta.map(({ col, tdClass }) => (
                    <td key={col.key} className={tdClass}>
                      {formatTableCell(table.total_row![col.key], col.format)}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HolderActionCard({
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
  const { ctaLabel, summary, kicker } = describeHolderAction(action);
  const isOperatorGated =
    action.kind === "holder_request_slip_change" ||
    action.kind === "holder_request_termination" ||
    action.kind === "holder_request_renewal_inquiry";

  return (
    <div className="ml-8 rounded-[12px] border border-primary/30 bg-primary-soft/40 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
        <Sparkles className="size-3 text-primary" />
        {kicker}
      </div>
      <div className="text-[13px] font-medium text-fg">{action.label}</div>
      {summary && (
        <p className="mt-1 text-[12px] leading-5 text-fg-subtle">{summary}</p>
      )}
      {isOperatorGated && !executed && (
        <p className="mt-1 text-[11px] italic text-fg-tertiary">
          The marina has to confirm. We&apos;ll let you know once they reply.
        </p>
      )}
      {refusedReason && (
        <p className="mt-2 text-[12px] text-status-warn">{refusedReason}</p>
      )}
      <div className="mt-3 flex items-center gap-2">
        {executed ? (
          <div className="inline-flex items-center gap-1.5 text-[12px] text-status-ok">
            <Check className="size-3.5" />
            Done
          </div>
        ) : (
          <>
            <Button variant="primary" size="sm" onClick={onApprove}>
              <Check className="size-3.5" />
              {ctaLabel}
            </Button>
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              <X className="size-3.5" />
              Not now
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function describeHolderAction(action: AgentAction): {
  ctaLabel: string;
  summary?: string;
  kicker: string;
} {
  switch (action.kind) {
    case "holder_message_marina":
      return {
        ctaLabel: "Send",
        kicker: "Message",
        summary: action.body,
      };
    case "holder_request_work_order":
      return {
        ctaLabel: "Submit",
        kicker: "Service request",
        summary: [
          action.subject,
          action.description,
          action.preferred_date ? `Preferred ${action.preferred_date}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "holder_schedule_pump_out":
      return {
        ctaLabel: "Submit",
        kicker: "Pump-out",
        summary: [
          action.preferred_date ? `For ${action.preferred_date}` : "Schedule when staff is next available",
          action.notes,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "holder_pay_balance":
      return {
        ctaLabel: "Pay now",
        kicker: "Payment",
        summary: `${formatMoney(action.amount)} via ${action.method}`,
      };
    case "holder_update_contact":
      return {
        ctaLabel: "Update",
        kicker: "Contact info",
        summary: [
          action.email && `Email → ${action.email}`,
          action.phone && `Phone → ${action.phone}`,
          (action.address_line_1 ||
            action.city ||
            action.state ||
            action.postal_code) &&
            `Address → ${[action.address_line_1, action.city, action.state, action.postal_code]
              .filter(Boolean)
              .join(", ")}`,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "holder_add_card":
      return {
        ctaLabel: "Add card",
        kicker: "Payment method",
        summary: `${action.brand.toUpperCase()} ending ${action.last4} · expires ${action.exp_month}/${action.exp_year}${action.is_default ? " · set as default" : ""}`,
      };
    case "holder_remove_card":
      return {
        ctaLabel: "Remove",
        kicker: "Payment method",
        summary: action.card_summary,
      };
    case "holder_request_slip_change":
      return {
        ctaLabel: "Send request",
        kicker: "Slip change",
        summary: [
          action.reason,
          action.desired_slip_traits && `Looking for: ${action.desired_slip_traits}`,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "holder_request_termination":
      return {
        ctaLabel: "Send request",
        kicker: "Termination",
        summary: [
          `Contract ${action.contract_number}`,
          action.desired_end_date && `Effective ${action.desired_end_date}`,
          action.reason,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "holder_request_renewal_inquiry":
      return {
        ctaLabel: "Send",
        kicker: "Renewal question",
        summary: [
          action.season_year && `Season ${action.season_year}`,
          action.questions,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    default:
      return { ctaLabel: "Approve", kicker: "Action" };
  }
}
