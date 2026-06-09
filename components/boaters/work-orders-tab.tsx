"use client";

import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getUser, getQuoteForWorkOrder, formatMoney } from "@/lib/mock-data";
import { useWorkOrdersForBoater } from "@/lib/client-store";
import { NewWorkOrderWizard } from "@/components/work-orders/new-work-order-wizard";
import type { WorkOrder, WorkOrderStatus } from "@/lib/types";

const COLUMNS: { key: WorkOrderStatus; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "scheduled", label: "Scheduled" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed", label: "Done" },
];

export function WorkOrdersTab({
  workOrders,
  boaterId,
}: {
  workOrders: WorkOrder[];
  boaterId: string;
}) {
  // Live work orders from store; fall back to server-rendered prop on first paint.
  const live = useWorkOrdersForBoater(boaterId);
  const items = live.length > 0 ? live : workOrders;
  const [newOpen, setNewOpen] = React.useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-fg-subtle">
          Drag-or-ask to move between columns. Open any card for the full quote, signature, and payment flow.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/work-orders">All work orders →</Link>
          </Button>
          <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}>
            + New work order
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const cards = items.filter((w) => w.status === col.key);
          return (
            <div key={col.key} className="rounded-[12px] border border-hairline bg-surface-1">
              <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
                <h3 className="text-[12px] font-medium uppercase tracking-wide text-fg-subtle">
                  {col.label}
                </h3>
                <Badge tone="neutral" size="sm">{cards.length}</Badge>
              </div>
              <div className="space-y-2 p-2">
                {cards.length === 0 ? (
                  <div className="rounded-[8px] border border-dashed border-hairline px-3 py-6 text-center text-[12px] text-fg-tertiary">
                    None
                  </div>
                ) : (
                  cards.map((w) => <WorkOrderCard key={w.id} w={w} />)
                )}
              </div>
            </div>
          );
        })}
      </div>

      <NewWorkOrderWizard
        open={newOpen}
        onOpenChange={setNewOpen}
        defaultBoaterId={boaterId}
      />
    </div>
  );
}

function WorkOrderCard({ w }: { w: WorkOrder }) {
  const assignee = getUser(w.assignee_user_id);
  const quote = getQuoteForWorkOrder(w.id);
  return (
    <Link
      href={`/work-orders/${w.id}`}
      className="block rounded-[8px] border border-hairline bg-surface-2 p-3 transition-colors hover:border-hairline-strong hover:bg-surface-3"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-[13px] font-medium text-fg">{w.subject}</h4>
        <Badge
          tone={w.priority === "urgent" ? "danger" : w.priority === "high" ? "warn" : "neutral"}
          size="sm"
        >
          {w.priority}
        </Badge>
      </div>
      <div className="mt-1 flex items-center gap-1 text-[10px] font-mono text-fg-tertiary">
        {w.number}
        {quote?.signed_at && <Badge tone="ok" size="sm">Signed</Badge>}
        {quote?.status === "invoiced" && <Badge tone="primary" size="sm">Billed</Badge>}
      </div>
      {w.description && (
        <p className="mt-1 line-clamp-2 text-[12px] text-fg-subtle">{w.description}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg-tertiary">
        {w.activity_type && <Badge tone="outline" size="sm">{w.activity_type.replace("_", " ")}</Badge>}
        {quote && <span>· {formatMoney(quote.total)}</span>}
        {assignee && <span>· {assignee.name}</span>}
        {w.start_date && <span>· {w.start_date}</span>}
        {w.due_date && !w.start_date && <span>· due {w.due_date}</span>}
      </div>
    </Link>
  );
}
