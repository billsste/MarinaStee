"use client";

import * as React from "react";
import { ChevronRight, LifeBuoy, Plus } from "lucide-react";
import { LocalTime } from "@/components/ui/local-time";
import {
  SupportPriorityBadge,
  SupportStatusBadge,
  SupportTypeBadge,
} from "@/components/support/support-ticket-badges";
import { SupportNewTicketForm } from "@/components/support/support-new-ticket-form";
import { SupportTicketModal } from "@/components/support/support-ticket-modal";
import { useSupportTicketsForBoater } from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { Boater, SupportTicket } from "@/lib/types";

/*
 * Boater-facing support surface.
 *
 * Two tabs (per global §5):
 *   - "New ticket" — form
 *   - "My tickets" — card rail with hover affordance, click opens
 *     the modal detail. Empty state nudges to file the first ticket.
 *
 * Tone is warm + first-person plural ("we") since this is the
 * client-facing side. Reads/writes via the client-store hooks (mock
 * path); the convex path is identical behind useTenantQuery once
 * the Convex deployment exists.
 */

type Tab = "new" | "my";

interface Props {
  boater: Boater;
}

export function BoaterSupportView({ boater }: Props) {
  const tickets = useSupportTicketsForBoater(boater.id);
  const [tab, setTab] = React.useState<Tab>(tickets.length > 0 ? "my" : "new");
  const [activeTicketId, setActiveTicketId] = React.useState<string | null>(
    null,
  );

  // Newest first — open tickets drift to the top by virtue of being
  // recently created or updated. Sort by updated_at (covers replies
  // landing in old threads).
  const sorted = React.useMemo(
    () =>
      [...tickets].sort((a, b) =>
        a.updated_at < b.updated_at ? 1 : -1,
      ),
    [tickets],
  );

  // Counts for the My Tickets pill — "open" = anything not in a
  // terminal state.
  const openCount = sorted.filter(
    (t) => t.status !== "resolved" && t.status !== "cancelled",
  ).length;

  const activeTicket = activeTicketId
    ? sorted.find((t) => t.id === activeTicketId) ?? null
    : null;

  function handleSubmitted() {
    setTab("my");
  }

  return (
    <div className="space-y-5">
      {/* Hero header — generous breathing room per global §5. */}
      <header className="rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-sm">
        <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-wide text-primary">
          <LifeBuoy className="size-3.5" />
          Support
        </div>
        <h1 className="display-tight mt-1 text-[24px] font-semibold leading-tight text-fg">
          We&rsquo;re here when you need us.
        </h1>
        <p className="mt-1 max-w-[42rem] text-[13px] text-fg-subtle">
          File a ticket and we&rsquo;ll get back to you as soon as we can — usually
          within a few hours during business hours. You can track and reply
          to every conversation right here.
        </p>
      </header>

      {/* Tab switcher */}
      <div
        role="tablist"
        aria-label="Support tabs"
        className="flex items-center gap-1 rounded-[12px] border border-hairline bg-surface-1 p-1"
      >
        <TabButton
          active={tab === "new"}
          onClick={() => setTab("new")}
          role="tab"
          ariaSelected={tab === "new"}
        >
          <Plus className="size-3.5" />
          New ticket
        </TabButton>
        <TabButton
          active={tab === "my"}
          onClick={() => setTab("my")}
          role="tab"
          ariaSelected={tab === "my"}
        >
          My tickets
          <span
            className={cn(
              "ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
              tab === "my"
                ? "bg-primary/15 text-primary"
                : "bg-surface-3 text-fg-tertiary",
            )}
          >
            {sorted.length}
            {openCount > 0 && sorted.length > 0 ? ` · ${openCount} open` : ""}
          </span>
        </TabButton>
      </div>

      {/* Tab body */}
      {tab === "new" ? (
        <SupportNewTicketForm boater={boater} onSubmitted={() => handleSubmitted()} />
      ) : (
        <MyTicketsRail
          tickets={sorted}
          onSelect={(id) => setActiveTicketId(id)}
          onStartNew={() => setTab("new")}
        />
      )}

      {/* Detail modal */}
      {activeTicket && (
        <SupportTicketModal
          ticket={activeTicket}
          boater={boater}
          open={true}
          onClose={() => setActiveTicketId(null)}
          viewerKind="boater"
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  ariaSelected,
  role,
  children,
}: {
  active: boolean;
  onClick: () => void;
  ariaSelected: boolean;
  role: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role={role}
      aria-selected={ariaSelected}
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-[8px] px-3 py-2 text-[13px] font-medium transition-colors",
        active
          ? "bg-surface-3 text-fg shadow-sm"
          : "text-fg-subtle hover:bg-surface-2 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function MyTicketsRail({
  tickets,
  onSelect,
  onStartNew,
}: {
  tickets: SupportTicket[];
  onSelect: (id: string) => void;
  onStartNew: () => void;
}) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-[16px] border border-dashed border-hairline-strong bg-surface-1 px-6 py-12 text-center">
        <LifeBuoy className="mx-auto size-6 text-fg-tertiary" />
        <h2 className="mt-3 text-[15px] font-medium text-fg">
          No tickets yet.
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-5 text-fg-subtle">
          When you file one, you&rsquo;ll see it here with the marina&rsquo;s replies.
        </p>
        <button
          type="button"
          onClick={onStartNew}
          className="mt-4 inline-flex items-center gap-1.5 rounded-[10px] bg-primary px-3 py-2 text-[13px] font-medium text-on-primary transition-colors hover:bg-primary-hover"
        >
          <Plus className="size-3.5" />
          Start a ticket
        </button>
      </div>
    );
  }

  return (
    <ul className="space-y-2.5">
      {tickets.map((t) => (
        <li key={t.id}>
          <TicketCard ticket={t} onClick={() => onSelect(t.id)} />
        </li>
      ))}
    </ul>
  );
}

function TicketCard({
  ticket,
  onClick,
}: {
  ticket: SupportTicket;
  onClick: () => void;
}) {
  // Explicit hover affordance + pointer cursor per global §5.
  const latest = ticket.messages[ticket.messages.length - 1];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full cursor-pointer flex-col gap-2 rounded-[12px] border border-hairline bg-surface-1 p-4 text-left transition-colors",
        "hover:border-primary/30 hover:bg-primary-soft/15",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
            <span>{ticket.reference}</span>
            <span>·</span>
            <LocalTime iso={ticket.created_at} fmt="short_date" />
          </div>
          <div className="mt-1 truncate text-[14px] font-medium text-fg">
            {ticket.subject}
          </div>
        </div>
        <ChevronRight className="size-4 shrink-0 text-fg-tertiary transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <SupportStatusBadge status={ticket.status} size="sm" />
        <SupportPriorityBadge priority={ticket.priority} size="sm" />
        <SupportTypeBadge type={ticket.type} size="sm" />
      </div>

      {latest && (
        <div className="truncate text-[12px] text-fg-subtle">
          <span className="text-fg-tertiary">
            {latest.author_kind === "boater"
              ? "You"
              : latest.author_kind === "system"
                ? "System"
                : latest.author_label}
            :
          </span>{" "}
          {latest.body}
        </div>
      )}
    </button>
  );
}
