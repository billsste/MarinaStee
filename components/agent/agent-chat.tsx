"use client";

import * as React from "react";
import {
  ArrowUp,
  ArrowUpRight,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Sparkles,
  X,
  User as UserIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, downloadCsv, formatPhone } from "@/lib/utils";
import { formatMoney } from "@/lib/mock-data";
import { useStore } from "@/lib/client-store";
import type { AgentAction } from "@/lib/simulated-agent";
import { executeAgentAction } from "@/lib/agent-actions";
import { useCurrentUser } from "@/lib/auth";
import { streamAgent } from "@/lib/agent-fetch";
import {
  formatTableCell,
  isTableResult,
  tableColumnAlign,
  type TableResult,
} from "@/lib/agent-reports";

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
  const router = useRouter();
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
    const action = m.actions[index].action;

    // Wrap the executor in try/catch so an unwrapped exception (audit
    // logger failure, missing boater, mock-data invariant violation,
    // etc.) doesn't leave the action card stuck in a half-applied
    // state. Any throw is treated the same as ok:false — the operator
    // sees the failure inline as a refusal message and can dismiss
    // the card.
    let result: ReturnType<typeof executeAgentAction>;
    try {
      result = executeAgentAction(action, currentUser.role);
    } catch (err) {
      result = {
        ok: false,
        reason:
          err instanceof Error
            ? `Executor error: ${err.message}`
            : "Executor error — see console for details.",
      };
      // eslint-disable-next-line no-console
      console.error("[agent-chat] executeAgentAction threw", err);
    }

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
    // navigate_to: side effect after audit row is written. router.push is
    // intentionally outside executeAgentAction since the executor is
    // domain-state only — keep UI navigation in the UI layer. Skipped
    // on the throw path (result.ok = false) so we don't navigate after
    // a half-applied executor.
    if (result.ok && action.kind === "navigate_to") {
      router.push(action.path);
    }
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
      {/* Tool steps — show the agent's thinking trail.
          Table results render as full cards; everything else collapses
          to a one-line summary. */}
      {message.toolSteps.length > 0 && (
        <div className="ml-8 flex flex-col gap-2">
          <ul className="flex flex-col gap-0.5 text-[11px] text-fg-tertiary">
            {message.toolSteps.map((s, i) =>
              isTableResult(s.result) ? null : (
                <li key={i} className="inline-flex items-center gap-1.5">
                  <span className="font-mono">↳</span>
                  <span className="font-medium text-fg-subtle">{prettyToolName(s.name)}</span>
                  <span className="text-fg-tertiary">— {summarizeResult(s.result)}</span>
                </li>
              ),
            )}
          </ul>
          {message.toolSteps
            .filter((s) => isTableResult(s.result))
            .map((s, i) => (
              <TableCard key={i} table={s.result as TableResult} />
            ))}
        </div>
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
  if (typeof obj.refused === "string") return `refused — ${obj.refused}`;
  if (typeof obj.count === "number") {
    const totalOpen = obj.total_open as number | undefined;
    return totalOpen !== undefined
      ? `${obj.count} result${obj.count === 1 ? "" : "s"} · $${totalOpen.toLocaleString()}`
      : `${obj.count} result${obj.count === 1 ? "" : "s"}`;
  }
  return "done";
}

/**
 * Render a saved-report TableResult as a structured card. Stripe-style
 * dense table — left-aligned text columns, right-aligned numeric
 * columns, total row split out with a top border. Surfaces row count
 * + subtitle from the report. CSV export uses the same column order.
 *
 * When the report sets `row_paths`, each row becomes a clickable target
 * that does client-side router.push to the matching detail page. Rows
 * without a link stay non-interactive.
 */
function TableCard({ table }: { table: TableResult }) {
  const router = useRouter();
  // null sortKey = the report's natural order (what the server returned).
  // First click cycles to "asc"; second click to "desc"; third resets to null.
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | null>(null);

  function cycleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  // Apply sort + maintain parallel row_paths so links stay correct.
  const displayed = React.useMemo(() => {
    if (!sort) {
      return { rows: table.rows, paths: table.row_paths ?? null };
    }
    const indexed = table.rows.map((row, idx) => ({
      row,
      path: table.row_paths?.[idx] ?? null,
    }));
    indexed.sort((a, b) => {
      const av = a.row[sort.key];
      const bv = b.row[sort.key];
      const dir = sort.dir === "asc" ? 1 : -1;
      if (av === null || av === undefined) return 1;       // nulls last either dir
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return {
      rows: indexed.map((i) => i.row),
      paths: indexed.map((i) => i.path),
    };
  }, [sort, table.rows, table.row_paths]);
  // formatCell + alignFor moved to lib/agent-reports.ts so the holder
  // chat can share the same formatters. Precompute per-column meta
  // once per columns change — saves ~300 redundant alignFor + cn()
  // calls per render on a typical 50×6 report.
  const columnsMeta = React.useMemo(
    () =>
      table.columns.map((c) => {
        const isRight = tableColumnAlign(c.format, c.align) === "right";
        return {
          col: c,
          isRight,
          thClass: cn(
            "cursor-pointer select-none px-3 py-1.5 font-medium transition-colors hover:bg-surface-3",
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

  function exportCsv() {
    // Shared downloadCsv lives in lib/utils.ts — handles the escape +
    // Blob + temp anchor dance so paystub-preview-modal (and any
    // future CSV exporter) share the same RFC-4180 logic.
    downloadCsv({
      columns: table.columns,
      rows: table.rows,
      totalRow: table.total_row,
      filename: table.report_key,
    });
  }

  return (
    <div className="overflow-hidden rounded-[10px] border border-hairline bg-surface-1">
      <div className="flex items-start justify-between gap-3 border-b border-hairline px-3 py-2">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-fg">{table.title}</div>
          {table.subtitle && (
            <div className="mt-0.5 text-[11px] text-fg-subtle">{table.subtitle}</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-fg-tertiary">
            {table.count} {table.count === 1 ? "row" : "rows"}
          </span>
          <Button variant="ghost" size="sm" onClick={exportCsv} disabled={table.rows.length === 0}>
            CSV
          </Button>
        </div>
      </div>
      {table.rows.length === 0 ? (
        <div className="px-3 py-4 text-center text-[12px] text-fg-subtle">
          No rows match.
        </div>
      ) : (
        <div className="max-h-[320px] overflow-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-surface-2 text-[11px] uppercase tracking-wide text-fg-subtle">
              <tr>
                {columnsMeta.map(({ col, isRight, thClass }) => {
                  const active = sort?.key === col.key;
                  return (
                    <th
                      key={col.key}
                      onClick={() => cycleSort(col.key)}
                      className={cn(thClass, active && "text-fg")}
                    >
                      <span
                        className={cn(
                          "inline-flex items-center gap-1",
                          isRight && "flex-row-reverse",
                        )}
                      >
                        {col.label}
                        {active && (
                          sort?.dir === "asc" ? (
                            <ChevronUp className="size-3" />
                          ) : (
                            <ChevronDown className="size-3" />
                          )
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {displayed.rows.map((r, i) => {
                const path = displayed.paths?.[i] ?? null;
                const clickable = !!path;
                return (
                  <tr
                    key={i}
                    className={cn(
                      "border-t border-hairline/60",
                      clickable && "cursor-pointer transition-colors hover:bg-surface-2",
                    )}
                    onClick={clickable ? () => router.push(path!) : undefined}
                  >
                    {columnsMeta.map(({ col, tdClass }) => (
                      <td key={col.key} className={tdClass}>
                        {formatTableCell(r[col.key], col.format)}
                      </td>
                    ))}
                  </tr>
                );
              })}
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

// csvEscape moved to lib/utils.ts. Use downloadCsv there for any new
// CSV exporters — keeps the escape logic consistent + RFC-4180 safe.

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
  // ── Navigate-to: render as a compact link card (one click → open).
  // No "Approve" button — clicking the card IS the approval.
  if (action.kind === "navigate_to") {
    return (
      <div className="ml-8">
        <button
          type="button"
          onClick={onApprove}
          disabled={executed}
          className={cn(
            "group flex w-full items-center justify-between gap-3 rounded-[10px] border border-primary/30 bg-primary-soft/40 px-3 py-2.5 text-left transition-colors",
            executed
              ? "cursor-default opacity-70"
              : "hover:border-primary/60 hover:bg-primary-soft/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
              <Sparkles className="size-3 text-primary" />
              {executed ? "Opened" : "Open"}
            </div>
            <div className="truncate text-[13px] font-medium text-fg">
              {action.route_label}
            </div>
            {action.rationale && (
              <p className="mt-0.5 truncate text-[12px] text-fg-subtle">
                {action.rationale}
              </p>
            )}
            <p className="mt-0.5 truncate font-mono text-[11px] text-fg-muted">
              {action.path}
            </p>
          </div>
          {executed ? (
            <Badge tone="ok">
              <CheckCheck className="size-3" />
              Opened
            </Badge>
          ) : (
            <ArrowUpRight className="size-4 shrink-0 text-primary transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          )}
        </button>
        {refusedReason && (
          <div className="mt-1.5 rounded-[8px] border border-status-warn/30 bg-status-warn/10 px-2.5 py-1.5 text-[12px] text-status-warn">
            {refusedReason}
          </div>
        )}
      </div>
    );
  }

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
          {formatMoney(action.amount)} · {action.method}
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
      {action.kind === "invite_staff" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.role_name} · {action.email}
          {action.phone && ` · ${formatPhone(action.phone)}`}
        </p>
      )}
      {action.kind === "update_work_order" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.work_order_number} · {action.summary}
        </p>
      )}
      {action.kind === "update_marina_profile" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.summary}
        </p>
      )}
      {action.kind === "create_dock" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          prefix {action.slip_prefix.toUpperCase()}
          {action.sort_order != null && ` · sort ${action.sort_order}`}
          {!action.active && " · inactive"}
        </p>
      )}
      {action.kind === "update_dock" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.dock_name} · {action.summary}
        </p>
      )}
      {action.kind === "update_pos_location" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.location_name} · {action.summary}
        </p>
      )}
      {action.kind === "create_pos_item" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.location_name} · {action.category} · {formatMoney(action.price)}
          {action.cost != null && ` (cost ${formatMoney(action.cost)})`}
        </p>
      )}
      {action.kind === "update_pos_item" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.item_name} · {action.summary}
        </p>
      )}
      {action.kind === "create_fee" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          ${action.amount.toFixed(2)} · {action.recurrence} · {action.applies_to.replace(/_/g, " ")}
          {action.auto_attach && " · auto-attach"}
        </p>
      )}
      {action.kind === "update_fee" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.fee_name} · {action.summary}
        </p>
      )}
      {action.kind === "update_comm_template" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.template_name} · {action.summary}
        </p>
      )}
      {action.kind === "connect_provider" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.provider} · {action.kind_of}
        </p>
      )}
      {action.kind === "disconnect_provider" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.provider}
        </p>
      )}
      {action.kind === "create_role" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.permissions.length} permission{action.permissions.length === 1 ? "" : "s"}
          {action.description && ` · ${action.description}`}
        </p>
      )}
      {action.kind === "update_role" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.role_name} · {action.summary}
        </p>
      )}
      {action.kind === "update_staff" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.staff_name} · {action.summary}
        </p>
      )}
      {action.kind === "update_boater" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.boater_name} · {action.summary}
        </p>
      )}
      {action.kind === "update_vessel" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.vessel_name} · {action.summary}
        </p>
      )}
      {action.kind === "update_contract" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.contract_number} · {action.summary}
        </p>
      )}
      {action.kind === "terminate_contract" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.contract_number}
          {action.reason && ` · ${action.reason}`}
        </p>
      )}
      {action.kind === "update_reservation" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.reservation_number} · {action.summary}
        </p>
      )}
      {action.kind === "cancel_reservation" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.reservation_number}
          {action.reason && ` · ${action.reason}`}
        </p>
      )}
      {action.kind === "send_for_signature" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.contract_number}
        </p>
      )}
      {action.kind === "bulk_send_message" && (
        <>
          <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
            {action.filter_summary} · {action.channel.toUpperCase()}
            {action.subject ? ` · ${action.subject}` : ""}
          </p>
          {action.preview_table && (
            <div className="mt-2">
              <TableCard table={action.preview_table} />
            </div>
          )}
        </>
      )}
      {action.kind === "bulk_draft_renewals" && (
        <>
          <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
            {action.filter_summary}
            {action.rate_adjustment_pct != null && action.rate_adjustment_pct !== 0
              ? ` · ${action.rate_adjustment_pct > 0 ? "+" : ""}${action.rate_adjustment_pct}%`
              : ""}
          </p>
          {action.preview_table && (
            <div className="mt-2">
              <TableCard table={action.preview_table} />
            </div>
          )}
        </>
      )}
      {action.kind === "bulk_apply_fee" && (
        <>
          <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
            {action.fee_name} · ${action.fee_amount.toFixed(2)} × {action.target_boater_ids.length}
          </p>
          {action.preview_table && (
            <div className="mt-2">
              <TableCard table={action.preview_table} />
            </div>
          )}
        </>
      )}
      {action.kind === "run_billing_run" && (
        <>
          <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
            {action.target_count} contract{action.target_count === 1 ? "" : "s"}
            {action.estimated_total > 0 && ` · est $${action.estimated_total.toLocaleString()}`}
          </p>
          {action.preview_table && (
            <div className="mt-2">
              <TableCard table={action.preview_table} />
            </div>
          )}
        </>
      )}
      {action.kind === "run_qb_sync" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.pending_count > 0
            ? `${action.pending_count} pending · $${action.pending_total.toLocaleString()}`
            : "Catch up sync"}
        </p>
      )}
      {action.kind === "create_threshold_rule" && (
        <p className="mt-1 max-w-md text-[12px] text-fg-subtle">
          {action.kind_of.replace(/_/g, " ")} ≤ {action.threshold_value}
          {action.threshold_unit} → {action.action.replace(/_/g, " ")}
          {action.notes && ` · ${action.notes}`}
        </p>
      )}
      {action.kind === "schedule_reminder" && (
        <div className="mt-1 max-w-md text-[12px] text-fg-subtle">
          <p>
            {action.channel.toUpperCase()} on{" "}
            {new Date(action.due_at).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {action.reason && ` · ${action.reason}`}
          </p>
          <p className="mt-1 italic">"{action.body}"</p>
        </div>
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
