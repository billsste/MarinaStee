"use client";

import * as React from "react";
import { X } from "lucide-react";
import { LocalTime } from "@/components/ui/local-time";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  SupportPriorityBadge,
  SupportStatusBadge,
  SupportStatusBadgeOps,
  SupportTypeBadge,
  TYPE_LABEL,
} from "@/components/support/support-ticket-badges";
import { SupportConversation } from "@/components/support/support-conversation";
import {
  addSupportTicketMessage,
  cancelSupportTicket,
  updateSupportTicketStatus,
} from "@/lib/client-store";
import type {
  Boater,
  SupportTicket,
  SupportTicketStatus,
} from "@/lib/types";

/*
 * Ticket detail modal. Two flavors:
 *
 *   viewerKind="boater" — portal view. Shows everything from the
 *   global §5 "client-visible fields" list, lets the boater post
 *   replies + cancel. No internal metadata.
 *
 *   viewerKind="staff" — operator queue view. Same modal + status
 *   selector + ability to mark resolved. The conversation composer
 *   posts as `staff`.
 *
 * Hierarchy follows the global rule: title + status + actions at the
 * top so the operator/holder can see the state and next step in one
 * glance.
 */

interface Props {
  ticket: SupportTicket;
  boater: Boater | null;
  open: boolean;
  onClose: () => void;
  viewerKind: "boater" | "staff";
}

const STAFF_STATUS_OPTIONS: SupportTicketStatus[] = [
  "open",
  "in_progress",
  "awaiting_boater",
  "resolved",
];

export function SupportTicketModal({
  ticket,
  boater,
  open,
  onClose,
  viewerKind,
}: Props) {
  // Close on Escape — standard modal hygiene.
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const readOnly = ticket.status === "cancelled";
  const closed = ticket.status === "resolved" || ticket.status === "cancelled";

  function postReply(body: string) {
    addSupportTicketMessage({
      ticket_id: ticket.id,
      body,
      author_kind: viewerKind,
      author_label:
        viewerKind === "boater"
          ? boater
            ? `${boater.first_name} ${boater.last_name}`.trim()
            : "Boater"
          : "Marina staff",
    });
  }

  function cancelByBoater() {
    if (
      !window.confirm(
        "Cancel this ticket? The conversation stays on file — you can always open a new one.",
      )
    )
      return;
    cancelSupportTicket(ticket.id, {
      actor_label: boater ? boater.first_name : "the boater",
    });
  }

  function staffSetStatus(next: SupportTicketStatus) {
    updateSupportTicketStatus(ticket.id, next);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="support-ticket-modal-title"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 py-8 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[calc(100vh-64px)] w-full max-w-[680px] flex-col overflow-hidden rounded-[16px] border border-hairline bg-surface-1 shadow-xl">
        {/* Header — title + status + close */}
        <header className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
              <span>{ticket.reference}</span>
              <span>·</span>
              <span>
                Submitted{" "}
                <LocalTime iso={ticket.created_at} fmt="short_datetime" />
              </span>
            </div>
            <h2
              id="support-ticket-modal-title"
              className="display-tight mt-1 text-[18px] font-semibold leading-tight text-fg"
            >
              {ticket.subject}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {viewerKind === "staff" ? (
                <SupportStatusBadgeOps status={ticket.status} />
              ) : (
                <SupportStatusBadge status={ticket.status} />
              )}
              <SupportPriorityBadge priority={ticket.priority} />
              <SupportTypeBadge type={ticket.type} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-[8px] p-1.5 text-fg-tertiary hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </header>

        {/* Scrollable body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Operator-only: staff context strip with the boater identity */}
          {viewerKind === "staff" && boater && (
            <section className="rounded-[10px] border border-hairline bg-surface-2 px-3 py-2 text-[12px]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-fg-subtle">
                <span>
                  <span className="text-fg-tertiary">From:</span>{" "}
                  <span className="font-medium text-fg">
                    {boater.display_name}
                  </span>
                </span>
                {boater.primary_contact.email && (
                  <span>
                    <span className="text-fg-tertiary">Email:</span>{" "}
                    {boater.primary_contact.email}
                  </span>
                )}
                {boater.primary_contact.phone && (
                  <span>
                    <span className="text-fg-tertiary">Phone:</span>{" "}
                    {boater.primary_contact.phone}
                  </span>
                )}
              </div>
              {(ticket.context.submitted_from_url ||
                ticket.context.app_version) && (
                <div className="mt-1 text-[11px] text-fg-tertiary">
                  {ticket.context.submitted_from_url && (
                    <span>From {ticket.context.submitted_from_url}</span>
                  )}
                  {ticket.context.submitted_from_url &&
                    ticket.context.app_version && <span> · </span>}
                  {ticket.context.app_version && (
                    <span>v{ticket.context.app_version}</span>
                  )}
                </div>
              )}
            </section>
          )}

          <DataCard title="Description">
            <p className="whitespace-pre-wrap text-[13px] leading-5 text-fg">
              {ticket.description}
            </p>
          </DataCard>

          {ticket.steps_to_reproduce && (
            <DataCard title="Steps to reproduce">
              <p className="whitespace-pre-wrap text-[13px] leading-5 text-fg">
                {ticket.steps_to_reproduce}
              </p>
            </DataCard>
          )}

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <MiniField label="Where">
              {ticket.page_or_area ?? "—"}
            </MiniField>
            <MiniField label="Type">{TYPE_LABEL[ticket.type]}</MiniField>
            <MiniField label="Priority">
              {PRIORITY_LABEL[ticket.priority]}
            </MiniField>
            <MiniField label="Last activity">
              <LocalTime iso={ticket.updated_at} fmt="short_datetime" />
            </MiniField>
          </div>

          {ticket.attachments.length > 0 && (
            <DataCard title={`Attachments (${ticket.attachments.length})`}>
              <ul className="space-y-1.5">
                {ticket.attachments.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between rounded-[6px] border border-hairline bg-surface-2 px-2.5 py-1.5"
                  >
                    <span className="truncate text-[12px] text-fg">
                      {a.name}
                    </span>
                    <span className="text-[10px] text-fg-tertiary">
                      {a.mime_type}
                    </span>
                  </li>
                ))}
              </ul>
            </DataCard>
          )}

          <DataCard title="Conversation">
            <SupportConversation
              messages={ticket.messages}
              onSend={readOnly ? undefined : postReply}
              viewerKind={viewerKind}
              placeholder={
                viewerKind === "boater"
                  ? "Reply to the marina…"
                  : "Reply to the boater…"
              }
            />
          </DataCard>
        </div>

        {/* Footer actions — viewer-specific */}
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline bg-surface-1 px-5 py-3">
          {viewerKind === "boater" ? (
            <>
              <p className="text-[11px] text-fg-tertiary">
                {closed
                  ? "This ticket is closed. Reply to reopen it, or start a new one."
                  : "We'll reply here. Reopen anytime."}
              </p>
              {ticket.status !== "cancelled" &&
                ticket.status !== "resolved" && (
                  <button
                    type="button"
                    onClick={cancelByBoater}
                    className="rounded-[8px] border border-hairline px-3 py-1.5 text-[12px] text-fg-subtle transition-colors hover:border-status-danger/40 hover:text-status-danger"
                  >
                    Cancel ticket
                  </button>
                )}
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide text-fg-tertiary">
                Status:
              </span>
              {STAFF_STATUS_OPTIONS.map((s) => {
                const active = ticket.status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => staffSetStatus(s)}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                      active
                        ? "border-primary/40 bg-primary-soft text-primary"
                        : "border-hairline bg-surface-1 text-fg-muted hover:border-hairline-strong hover:bg-surface-2"
                    }`}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                );
              })}
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

function DataCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  // Separated boxes for key data sections — required by global §5
  // visual direction.
  return (
    <section className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
      <header className="border-b border-hairline px-3 py-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          {title}
        </h3>
      </header>
      <div className="px-3 py-2.5">{children}</div>
    </section>
  );
}

function MiniField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-hairline bg-surface-1 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
        {label}
      </div>
      <div className="mt-0.5 text-[13px] text-fg">{children}</div>
    </div>
  );
}
