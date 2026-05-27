"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Mail, MessageCircle, Phone, Inbox, X, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCommunicationsForBoater } from "@/lib/client-store";
import { useLedgerDrawer } from "@/components/ledger/ledger-entry-drawer";
import { NewMessageSheet } from "@/components/comms/new-message-sheet";
import { formatPhone } from "@/lib/utils";
import type { Communication } from "@/lib/types";

function channelIcon(type: Communication["type"]) {
  if (type === "email") return <Mail className="size-3.5" />;
  if (type === "sms") return <MessageCircle className="size-3.5" />;
  return <Phone className="size-3.5" />;
}

function statusTone(s: Communication["status"]): "ok" | "warn" | "danger" | "info" | "neutral" {
  if (s === "delivered") return "neutral";
  if (s === "opened" || s === "clicked" || s === "replied") return "ok";
  if (s === "bounced" || s === "failed") return "danger";
  return "info";
}

export function CommsTab({ boaterId }: { boaterId: string }) {
  const comms = useCommunicationsForBoater(boaterId);
  const [newOpen, setNewOpen] = React.useState(false);
  const [openComm, setOpenComm] = React.useState<Communication | null>(null);

  if (comms.length === 0) {
    return (
      <>
        <div className="rounded-[12px] border border-dashed border-hairline-strong bg-surface-1 p-10 text-center">
          <Inbox className="mx-auto size-6 text-fg-tertiary" />
          <h3 className="mt-2 text-[15px] font-medium text-fg">No communications yet</h3>
          <p className="mt-1 text-[13px] text-fg-subtle">
            Send a welcome message, payment reminder, or arrival reminder — or ask the agent to.
          </p>
          <div className="mt-4 inline-flex">
            <Button variant="primary" size="md" onClick={() => setNewOpen(true)}>
              + New message
            </Button>
          </div>
        </div>
        <NewMessageSheet open={newOpen} onOpenChange={setNewOpen} defaultBoaterId={boaterId} />
      </>
    );
  }

  const sorted = [...comms].sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-fg-subtle">
          Two-way thread — outbound + inbound, across channels. Click any row to see the full body.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm">Templates</Button>
          <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}>
            + New message
          </Button>
        </div>
      </div>

      <ol className="relative space-y-3">
        {sorted.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => setOpenComm(c)}
              className={
                "w-full rounded-[12px] border border-hairline bg-surface-1 px-4 py-3 text-left transition-colors hover:border-hairline-strong hover:bg-surface-2 " +
                (c.direction === "inbound" ? "ring-1 ring-primary/20" : "")
              }
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-fg-subtle">
                  {channelIcon(c.type)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={c.direction === "inbound" ? "primary" : "neutral"} size="sm">
                      {c.direction}
                    </Badge>
                    <Badge tone="outline" size="sm">{c.type.toUpperCase()}</Badge>
                    <span className="text-[12px] font-medium text-fg">
                      {c.subject ?? c.body_preview.slice(0, 50)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px] text-fg-subtle">
                    {c.body_preview}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-fg-tertiary">
                    <span>{c.sender_label}</span>
                    <span>·</span>
                    <span>{new Date(c.sent_at).toLocaleString()}</span>
                    <span>·</span>
                    <Badge tone={statusTone(c.status)} size="sm">{c.status}</Badge>
                    {c.related_entity && (
                      <>
                        <span>·</span>
                        <span>
                          re: {c.related_entity.type} {c.related_entity.id.slice(0, 8)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ol>

      <NewMessageSheet open={newOpen} onOpenChange={setNewOpen} defaultBoaterId={boaterId} />
      <CommDetailDialog comm={openComm} onClose={() => setOpenComm(null)} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Comm detail dialog — full body + metadata + related entity link
// ─────────────────────────────────────────────────────────────────────────────

function CommDetailDialog({
  comm,
  onClose,
}: {
  comm: Communication | null;
  onClose: () => void;
}) {
  const { openLedgerEntry } = useLedgerDrawer();
  const open = comm !== null;
  if (!comm) return (
    <Dialog.Root open={false} onOpenChange={() => onClose()}>
      <div />
    </Dialog.Root>
  );

  // Build the related-entity link target. Invoices open the ledger drawer
  // in-place; everything else navigates.
  function relatedLink() {
    if (!comm || !comm.related_entity) return null;
    const { type, id } = comm.related_entity;
    if (type === "invoice") {
      return (
        <button
          type="button"
          onClick={() => {
            onClose();
            openLedgerEntry(id);
          }}
          className="inline-flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-subtle hover:bg-surface-2"
        >
          <ArrowUpRight className="size-3" />
          Open invoice
        </button>
      );
    }
    const href =
      type === "work_order" ? `/work-orders/${id}` :
      type === "reservation" ? `/reservations` :
      type === "contract" ? `/slips/contracts` :
      "#";
    return (
      <Link
        href={href}
        onClick={onClose}
        className="inline-flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-subtle hover:bg-surface-2"
      >
        <ArrowUpRight className="size-3" />
        Open {type.replace("_", " ")}
      </Link>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(b) => { if (!b) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-[14px] border border-hairline bg-surface-1 shadow-xl outline-none">
          <div className="flex items-start justify-between border-b border-hairline px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="flex items-center gap-2 text-[15px] font-medium text-fg">
                <span className="flex size-7 items-center justify-center rounded-full bg-surface-3 text-fg-subtle">
                  {channelIcon(comm.type)}
                </span>
                <span>{comm.subject ?? "Message"}</span>
              </Dialog.Title>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone={comm.direction === "inbound" ? "primary" : "neutral"} size="sm">
                  {comm.direction}
                </Badge>
                <Badge tone="outline" size="sm">{comm.type.toUpperCase()}</Badge>
                <Badge tone={statusTone(comm.status)} size="sm">{comm.status}</Badge>
              </div>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="inline-flex size-7 items-center justify-center rounded-[6px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="space-y-4 px-5 py-4">
            {/* Metadata grid */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
              <div>
                <dt className="text-fg-tertiary">From</dt>
                <dd className="text-fg">{comm.sender_label}{comm.sender_is_system && " (system)"}</dd>
              </div>
              <div>
                <dt className="text-fg-tertiary">To</dt>
                <dd className="text-fg">{comm.type === "sms" || comm.type === "voice" ? formatPhone(comm.recipient) : comm.recipient}</dd>
              </div>
              <div>
                <dt className="text-fg-tertiary">Sent</dt>
                <dd className="text-fg">{new Date(comm.sent_at).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-fg-tertiary">Status</dt>
                <dd className="text-fg capitalize">{comm.status}</dd>
              </div>
            </dl>

            {/* Body */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">Message</div>
              <div className="mt-1 whitespace-pre-wrap rounded-[8px] border border-hairline bg-surface-2 px-3 py-2.5 text-[13px] leading-relaxed text-fg">
                {comm.full_body ?? comm.body_preview}
              </div>
            </div>

            {/* Related entity link */}
            {comm.related_entity && (
              <div className="flex items-center justify-between rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[12px]">
                <div className="text-fg-subtle">
                  Related: <span className="text-fg capitalize">{comm.related_entity.type.replace("_", " ")}</span>
                  <span className="ml-1 font-mono text-[11px] text-fg-tertiary">{comm.related_entity.id}</span>
                </div>
                {relatedLink()}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-hairline bg-surface-2 px-5 py-3">
            <span className="text-[11px] text-fg-tertiary">
              Inbound replies show in the unified Inbox too.
            </span>
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm">Close</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
