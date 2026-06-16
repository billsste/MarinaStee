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
  // TA / mechanical-services feedback row 10: "service order history tab
  // would be awesome." Toggle between the live kanban (current work) and
  // a flat chronological list (history across all years/statuses).
  const [view, setView] = React.useState<"kanban" | "history">("kanban");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-fg-subtle">
          {view === "kanban"
            ? "Drag-or-ask to move between columns. Open any card for the full quote, signature, and payment flow."
            : "Full service history — chronological across all statuses + years."}
        </p>
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-[8px] border border-hairline">
            <button
              type="button"
              onClick={() => setView("kanban")}
              className={`px-2.5 py-1 text-[12px] font-medium transition-colors ${view === "kanban" ? "bg-surface-2 text-fg" : "text-fg-tertiary hover:bg-surface-2"}`}
            >
              Kanban
            </button>
            <button
              type="button"
              onClick={() => setView("history")}
              className={`px-2.5 py-1 text-[12px] font-medium transition-colors ${view === "history" ? "bg-surface-2 text-fg" : "text-fg-tertiary hover:bg-surface-2"}`}
            >
              History
            </button>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/work-orders">All work orders →</Link>
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setNewOpen(true)}>
            + New work order
          </Button>
        </div>
      </div>

      {view === "kanban" ? (
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
      ) : (
        <WorkOrderHistory items={items} />
      )}

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

/*
 * History view — flat chronological list of all this boater's work
 * orders across every status + year. Sorted newest-first by end_date
 * (when present, else start_date, else due_date). Lets staff scan
 * "when did we last winterize this vessel" / "have they had recurring
 * pedestal issues" without flipping between kanban columns.
 *
 * Built per TA's feedback (Doc 1, row 10): "A service order history
 * tab would be awesome, especially when we start doing mechanical
 * services."
 */
function WorkOrderHistory({ items }: { items: WorkOrder[] }) {
  const ordered = React.useMemo(() => {
    const dateOf = (w: WorkOrder) =>
      w.end_date ?? w.start_date ?? w.due_date ?? "";
    return [...items].sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  }, [items]);

  if (ordered.length === 0) {
    return (
      <div className="rounded-[12px] border border-dashed border-hairline bg-surface-1 p-8 text-center text-[13px] text-fg-subtle">
        No work orders on file for this boater yet.
      </div>
    );
  }

  const STATUS_TONE: Record<WorkOrderStatus, "neutral" | "info" | "warn" | "ok" | "danger"> = {
    open: "neutral",
    scheduled: "info",
    in_progress: "warn",
    blocked: "danger",
    completed: "ok",
    cancelled: "danger",
  };

  return (
    <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
      <div className="grid grid-cols-[88px_minmax(0,1fr)_120px_140px_100px] items-center gap-x-3 border-b border-hairline bg-surface-2 px-3 py-2 text-[10px] uppercase tracking-wide text-fg-tertiary">
        <span>Date</span>
        <span>Subject</span>
        <span>Assignee</span>
        <span>Activity</span>
        <span>Status</span>
      </div>
      <ul className="divide-y divide-hairline">
        {ordered.map((w) => {
          const assignee = getUser(w.assignee_user_id);
          const displayDate = w.end_date ?? w.start_date ?? w.due_date ?? "—";
          return (
            <li key={w.id}>
              <Link
                href={`/work-orders/${w.id}`}
                className="grid grid-cols-[88px_minmax(0,1fr)_120px_140px_100px] items-center gap-x-3 px-3 py-2 text-[13px] transition-colors hover:bg-surface-2"
              >
                <span className="tabular text-fg-subtle">{displayDate}</span>
                <span className="min-w-0 truncate font-medium text-fg" title={w.subject}>
                  {w.subject}
                </span>
                <span className="truncate text-fg-subtle">
                  {assignee?.name ?? "—"}
                </span>
                <span className="truncate text-fg-subtle">
                  {w.activity_type ? w.activity_type.replace("_", " ") : "—"}
                </span>
                <Badge tone={STATUS_TONE[w.status]} size="sm">
                  {w.status.replace("_", " ")}
                </Badge>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
