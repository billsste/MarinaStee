"use client";

import { Mail, MessageCircle, Phone, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCommunicationsForBoater } from "@/lib/client-store";
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
  if (comms.length === 0) {
    return (
      <div className="rounded-[12px] border border-dashed border-hairline-strong bg-surface-1 p-10 text-center">
        <Inbox className="mx-auto size-6 text-fg-tertiary" />
        <h3 className="mt-2 text-[15px] font-medium text-fg">No communications yet</h3>
        <p className="mt-1 text-[13px] text-fg-subtle">
          Ask the agent to send a welcome message, payment reminder, or arrivals SMS.
        </p>
      </div>
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
          <Button variant="primary" size="sm">+ New message</Button>
        </div>
      </div>

      <ol className="relative space-y-3">
        {sorted.map((c) => (
          <li
            key={c.id}
            className={
              "rounded-[12px] border border-hairline bg-surface-1 px-4 py-3 " +
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
          </li>
        ))}
      </ol>
    </div>
  );
}
