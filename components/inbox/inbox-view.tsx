"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CheckCheck,
  Inbox as InboxIcon,
  Mail,
  Megaphone,
  MessageCircle,
  Phone,
  Search,
  Send,
  Sparkles,
} from "lucide-react";
import { BroadcastSheet } from "@/components/comms/broadcast-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useBoaters, useStore } from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";
import { cn } from "@/lib/utils";
import type { Boater, Communication } from "@/lib/types";

type ChannelFilter = "all" | "email" | "sms" | "voice";
type StatusFilter = "all" | "unread" | "needs_reply" | "done";

/*
 * Unified Inbox — every communication across every boater in one place.
 * Threads are grouped by boater (since that's how marina staff think about
 * messages: "what does Peterson need?"). Inbound messages bubble to the top
 * with a "needs reply" affordance until staff clicks Mark replied / Mark done.
 *
 * Local-only triage state (read/replied/done flags) lives in component state
 * to keep this demo lightweight — in production this would be a per-user
 * read_status table.
 */
export function InboxView() {
  const { communications } = useStore();
  const boaters = useBoaters();

  // Local triage flags — keyed by communication id
  const [triage, setTriage] = React.useState<
    Record<string, "read" | "replied" | "done">
  >({});

  const [channel, setChannel] = React.useState<ChannelFilter>("all");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [query, setQuery] = React.useState("");
  const [selectedBoaterId, setSelectedBoaterId] = React.useState<string | null>(null);
  const [broadcastOpen, setBroadcastOpen] = React.useState(false);

  // Group all messages by boater, sorted by most recent
  const threads = React.useMemo(() => {
    const byBoater = new Map<string, Communication[]>();
    for (const c of communications) {
      const list = byBoater.get(c.boater_id) ?? [];
      list.push(c);
      byBoater.set(c.boater_id, list);
    }
    const items: ThreadSummary[] = [];
    for (const [boaterId, msgs] of byBoater) {
      const boater = boaters.find((b) => b.id === boaterId);
      if (!boater) continue;
      const sorted = msgs.slice().sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1));
      const latest = sorted[0];
      const inboundUntriaged = msgs.filter(
        (m) => m.direction === "inbound" && !triage[m.id]
      ).length;
      items.push({ boater, messages: sorted, latest, inboundUntriaged });
    }
    return items.sort((a, b) => (a.latest.sent_at < b.latest.sent_at ? 1 : -1));
  }, [communications, boaters, triage]);

  // Apply filters
  const visibleThreads = React.useMemo(() => {
    return threads.filter((t) => {
      // Channel filter — thread matches if any message is on the channel
      if (channel !== "all" && !t.messages.some((m) => m.type === channel)) return false;
      // Status filter
      if (status === "unread" && t.inboundUntriaged === 0) return false;
      if (status === "needs_reply") {
        // Inbound message exists that hasn't been replied to
        const hasUnreplied = t.messages.some(
          (m) => m.direction === "inbound" && triage[m.id] !== "replied" && triage[m.id] !== "done"
        );
        if (!hasUnreplied) return false;
      }
      if (status === "done") {
        // All inbound messages are marked done
        const inbound = t.messages.filter((m) => m.direction === "inbound");
        if (inbound.length === 0) return false;
        if (inbound.some((m) => triage[m.id] !== "done")) return false;
      }
      // Search — match boater name or any message body
      const q = query.trim().toLowerCase();
      if (q) {
        const hit =
          t.boater.display_name.toLowerCase().includes(q) ||
          t.messages.some(
            (m) =>
              m.body_preview.toLowerCase().includes(q) ||
              (m.subject ?? "").toLowerCase().includes(q)
          );
        if (!hit) return false;
      }
      return true;
    });
  }, [threads, channel, status, query, triage]);

  const selectedThread = visibleThreads.find((t) => t.boater.id === selectedBoaterId)
    ?? visibleThreads[0]
    ?? null;

  // Counts for the rail
  const totalInbound = threads.reduce((s, t) => s + t.inboundUntriaged, 0);
  const totalThreads = threads.length;

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(320px, 1fr) minmax(0, 1.6fr) minmax(280px, 320px)" }}>
      {/* ── LEFT: thread list ─────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-2">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-hairline bg-surface-2 p-1">
          {(["all", "unread", "needs_reply", "done"] as StatusFilter[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setStatus(k)}
              className={cn(
                "flex-1 rounded-[6px] px-2 py-1 text-[11px] font-medium capitalize transition-colors",
                status === k
                  ? "bg-surface-1 text-fg shadow-sm"
                  : "text-fg-subtle hover:text-fg"
              )}
            >
              {k === "needs_reply" ? "Needs reply" : k}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or message…"
              className="w-full rounded-[8px] border border-hairline bg-surface-1 py-1.5 pl-8 pr-3 text-[12px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
            />
          </div>
          {(["all", "email", "sms", "voice"] as ChannelFilter[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              aria-label={c}
              className={cn(
                "rounded-[6px] border px-1.5 py-1 text-[11px] font-medium capitalize transition-colors",
                channel === c
                  ? "border-primary/40 bg-primary-soft text-primary"
                  : "border-hairline bg-surface-1 text-fg-muted hover:bg-surface-2"
              )}
            >
              {c === "all" ? "All" : c === "email" ? <Mail className="size-3" /> : c === "sms" ? <MessageCircle className="size-3" /> : <Phone className="size-3" />}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
          {visibleThreads.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
              <InboxIcon className="mx-auto size-5 text-fg-tertiary" />
              <p className="mt-2 text-[12px] text-fg-subtle">No threads match these filters.</p>
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {visibleThreads.map((t) => (
                <ThreadRow
                  key={t.boater.id}
                  thread={t}
                  active={selectedThread?.boater.id === t.boater.id}
                  triage={triage}
                  onSelect={() => setSelectedBoaterId(t.boater.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── CENTER: selected thread ───────────────────────────────────── */}
      <div className="flex min-h-[500px] min-w-0 flex-col rounded-[12px] border border-hairline bg-surface-1">
        {selectedThread ? (
          <ThreadView
            thread={selectedThread}
            triage={triage}
            onTriage={(msgId, kind) =>
              setTriage((prev) => ({ ...prev, [msgId]: kind }))
            }
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-[12px] text-fg-subtle">
            Select a thread to read.
          </div>
        )}
      </div>

      {/* ── RIGHT: agent triage rail ──────────────────────────────────── */}
      <aside className="flex flex-col gap-3">
        <Button
          variant="primary"
          size="md"
          className="w-full justify-center"
          onClick={() => setBroadcastOpen(true)}
        >
          <Megaphone className="size-3.5" />
          New broadcast
        </Button>

        <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-tertiary">
            <Sparkles className="size-3 text-primary" />
            Agent triage
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <Stat label="Threads" value={totalThreads.toString()} />
            <Stat
              label="Inbound to triage"
              value={totalInbound.toString()}
              tone={totalInbound > 0 ? "warn" : "neutral"}
            />
          </div>
          <p className="mt-3 text-[12px] leading-5 text-fg-subtle">
            Open a thread and click <span className="font-medium text-fg">Draft reply</span> — the agent reads the boater's history and proposes 1-3 sentences for your approval.
          </p>
        </div>

        <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-tertiary">
            Quick prompts
          </div>
          <ul className="space-y-1.5 text-[12px]">
            <li>
              <Link href="/" className="inline-flex items-center gap-1 text-primary hover:underline">
                <ArrowUpRight className="size-3" />
                "Draft replies to everyone overdue"
              </Link>
            </li>
            <li>
              <Link href="/" className="inline-flex items-center gap-1 text-primary hover:underline">
                <ArrowUpRight className="size-3" />
                "Send arrival reminders to today's transients"
              </Link>
            </li>
            <li>
              <Link href="/" className="inline-flex items-center gap-1 text-primary hover:underline">
                <ArrowUpRight className="size-3" />
                "Anyone asking about a quote? Summarize."
              </Link>
            </li>
          </ul>
        </div>
      </aside>

      <BroadcastSheet open={broadcastOpen} onOpenChange={setBroadcastOpen} />
    </div>
  );
}

type ThreadSummary = {
  boater: Boater;
  messages: Communication[];
  latest: Communication;
  inboundUntriaged: number;
};

function ThreadRow({
  thread,
  active,
  triage,
  onSelect,
}: {
  thread: ThreadSummary;
  active: boolean;
  triage: Record<string, "read" | "replied" | "done">;
  onSelect: () => void;
}) {
  const { boater, latest, inboundUntriaged } = thread;
  const isInbound = latest.direction === "inbound";
  const untriaged = isInbound && !triage[latest.id];

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "block w-full px-3 py-2.5 text-left transition-colors",
          active ? "bg-primary-soft/40" : "hover:bg-surface-2"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "truncate text-[13px]",
              untriaged ? "font-semibold text-fg" : "font-medium text-fg"
            )}
          >
            {boater.display_name}
          </span>
          <span className="shrink-0 text-[10px] text-fg-tertiary">
            {formatRelative(latest.sent_at)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <ChannelDot type={latest.type} />
          <span className="line-clamp-1 text-[12px] text-fg-subtle">
            {isInbound ? "" : "→ "}
            {latest.subject ?? latest.body_preview}
          </span>
        </div>
        {inboundUntriaged > 0 && (
          <div className="mt-1.5">
            <Badge tone="warn" size="sm">
              {inboundUntriaged} needs triage
            </Badge>
          </div>
        )}
      </button>
    </li>
  );
}

function ThreadView({
  thread,
  triage,
  onTriage,
}: {
  thread: ThreadSummary;
  triage: Record<string, "read" | "replied" | "done">;
  onTriage: (msgId: string, kind: "read" | "replied" | "done") => void;
}) {
  const { boater, messages } = thread;
  const [replyBody, setReplyBody] = React.useState("");
  const [replyChannel, setReplyChannel] = React.useState<"email" | "sms">(
    boater.communication_prefs.preferred_channel === "sms" ? "sms" : "email"
  );

  React.useEffect(() => {
    // Reset reply state when switching threads
    setReplyBody("");
    setReplyChannel(boater.communication_prefs.preferred_channel === "sms" ? "sms" : "email");
  }, [boater.id, boater.communication_prefs.preferred_channel]);

  // Sort messages oldest-first for the thread view (reads like a conversation)
  const sortedAsc = messages.slice().sort((a, b) => (a.sent_at < b.sent_at ? -1 : 1));
  const lastInbound = messages.find((m) => m.direction === "inbound");

  function draftAgentReply() {
    // Naive auto-draft: greet + acknowledge the last inbound message.
    if (!lastInbound) return;
    const greet = `Hi ${boater.first_name},`;
    const ack = `Thanks for reaching out — `;
    const body = lastInbound.body_preview.toLowerCase().includes("pump-out")
      ? `we'll get the pump-out scheduled for tomorrow morning. I'll confirm a window once the dockhand checks in.`
      : lastInbound.body_preview.toLowerCase().includes("slip")
      ? `your slip A14 is confirmed for Friday — power and water are live. Text us when you're 30 minutes out.`
      : lastInbound.body_preview.toLowerCase().includes("paint")
      ? `the bottom-paint quote includes the keel touch-up. Earliest scheduling is the week of June 1 — does that work?`
      : `we got your message and will follow up shortly.`;
    setReplyBody(`${greet} ${ack}${body}`);
  }

  function sendReply() {
    const body = replyBody.trim();
    if (!body) return;
    executeAgentAction({
      kind: "send_message",
      label: "",
      boater_id: boater.id,
      type: replyChannel,
      subject: replyChannel === "email" ? "Re: marina message" : undefined,
      body,
    });
    if (lastInbound) {
      onTriage(lastInbound.id, "replied");
    }
    setReplyBody("");
  }

  return (
    <>
      {/* Thread header */}
      <header className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
        <div>
          <Link
            href={`/boaters/${boater.id}`}
            className="text-[15px] font-medium text-fg hover:text-primary"
          >
            {boater.display_name}
          </Link>
          <div className="mt-0.5 text-[11px] text-fg-tertiary">
            {boater.primary_contact.email ?? "—"}
            {boater.primary_contact.phone && ` · ${boater.primary_contact.phone}`}
            {" · "}
            prefers {boater.communication_prefs.preferred_channel}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {lastInbound && triage[lastInbound.id] !== "done" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => lastInbound && onTriage(lastInbound.id, "done")}
            >
              <CheckCheck className="size-3.5" />
              Mark done
            </Button>
          )}
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/boaters/${boater.id}`}>Open profile →</Link>
          </Button>
        </div>
      </header>

      {/* Messages */}
      <ol className="flex-1 space-y-3 overflow-y-auto px-4 py-3" style={{ maxHeight: "440px" }}>
        {sortedAsc.map((m) => {
          const inbound = m.direction === "inbound";
          return (
            <li
              key={m.id}
              className={cn(
                "max-w-[88%] rounded-[12px] border px-3 py-2",
                inbound
                  ? "border-primary/30 bg-primary-soft/30 mr-auto rounded-bl-[4px]"
                  : "ml-auto rounded-br-[4px] border-hairline bg-surface-2"
              )}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-fg-tertiary">
                <ChannelDot type={m.type} />
                <span className="font-medium text-fg-subtle">{m.sender_label}</span>
                <span>·</span>
                <span>{new Date(m.sent_at).toLocaleString()}</span>
                {m.related_entity && (
                  <Badge tone="outline" size="sm">
                    re: {m.related_entity.type}
                  </Badge>
                )}
                {triage[m.id] && (
                  <Badge tone="ok" size="sm">
                    {triage[m.id]}
                  </Badge>
                )}
              </div>
              {m.subject && (
                <div className="mb-0.5 text-[13px] font-medium text-fg">{m.subject}</div>
              )}
              <div className="text-[13px] leading-5 text-fg">{m.body_preview}</div>
            </li>
          );
        })}
      </ol>

      {/* Composer */}
      <div className="border-t border-hairline bg-surface-1 px-3 py-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {(["email", "sms"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setReplyChannel(c)}
                className={cn(
                  "rounded-[6px] border px-2 py-1 text-[11px] font-medium capitalize",
                  replyChannel === c
                    ? "border-primary/40 bg-primary-soft text-primary"
                    : "border-hairline bg-surface-1 text-fg-muted hover:bg-surface-2"
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={draftAgentReply} disabled={!lastInbound}>
            <Sparkles className="size-3.5" />
            Draft reply with agent
          </Button>
        </div>
        <div className="flex items-end gap-2 rounded-[10px] border border-hairline bg-surface-2 p-2">
          <textarea
            rows={3}
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder={
              replyChannel === "sms"
                ? `Reply to ${boater.first_name} via SMS…`
                : `Reply to ${boater.first_name} via email…`
            }
            className="block flex-1 resize-none bg-transparent px-1 py-1 text-[13px] leading-5 text-fg placeholder:text-fg-tertiary focus:outline-none"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={sendReply}
            disabled={!replyBody.trim()}
            aria-label="Send"
          >
            <Send className="size-3.5" />
            Send
          </Button>
        </div>
      </div>
    </>
  );
}

function ChannelDot({ type }: { type: Communication["type"] }) {
  const Icon = type === "email" ? Mail : type === "sms" ? MessageCircle : Phone;
  return (
    <span className="inline-flex size-4 items-center justify-center rounded-full bg-surface-3 text-fg-subtle">
      <Icon className="size-2.5" />
    </span>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "warn" }) {
  const valueTone = tone === "warn" ? "text-status-warn" : "text-fg";
  return (
    <div>
      <div className={cn("money-display text-[22px] leading-none", valueTone)}>{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-fg-tertiary">{label}</div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.round((now - t) / 60_000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `${diffD}d`;
  return new Date(iso).toLocaleDateString();
}
