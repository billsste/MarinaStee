"use client";

import * as React from "react";
import { Search, Flag, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WoCard } from "./wo-card";
import { NewWorkOrderWizard } from "./new-work-order-wizard";
import { cn } from "@/lib/utils";
import { getQuoteForWorkOrder } from "@/lib/mock-data";
import { updateWorkOrder, useWorkOrders } from "@/lib/client-store";
import { useTabUrlState } from "@/lib/use-tab-url-state";
import type {
  WorkOrder,
  WorkOrderStatus,
  WorkOrderActivityType,
} from "@/lib/types";

type ActivityFilter = WorkOrderActivityType | "all";

function isActivityFilter(v: string | null | undefined): v is ActivityFilter {
  return (
    v === "all" ||
    v === "winterization" ||
    v === "bottom_paint" ||
    v === "service" ||
    v === "inspection" ||
    v === "haul_out"
  );
}

type ColumnKey = "open" | "scheduled" | "in_progress" | "completed" | "billed";

const COLUMNS: { key: ColumnKey; label: string; sourceStatus?: WorkOrderStatus }[] = [
  { key: "open", label: "Open", sourceStatus: "open" },
  { key: "scheduled", label: "Scheduled", sourceStatus: "scheduled" },
  { key: "in_progress", label: "In Progress", sourceStatus: "in_progress" },
  { key: "completed", label: "Completed", sourceStatus: "completed" },
  { key: "billed", label: "Billed" },
];

const ACTIVITY_TABS: { key: WorkOrderActivityType | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "winterization", label: "Winterization" },
  { key: "bottom_paint", label: "Bottom paint" },
  { key: "service", label: "Service" },
  { key: "inspection", label: "Inspection" },
  { key: "haul_out", label: "Haul-out" },
];

function columnFor(wo: WorkOrder): ColumnKey {
  const quote = getQuoteForWorkOrder(wo.id);
  if (wo.status === "completed" && quote?.status === "invoiced") return "billed";
  if (wo.status === "scheduled") return "scheduled";
  if (wo.status === "in_progress" || wo.status === "blocked") return "in_progress";
  if (wo.status === "completed") return "completed";
  return "open";
}

export function WoKanban({ initial }: { initial?: WorkOrder[] }) {
  // Read from client store so new work orders (created via sheet OR agent)
  // appear instantly. Local drag-status edits are tracked separately in `localOverrides`.
  const storeItems = useWorkOrders();
  const [localOverrides, setLocalOverrides] = React.useState<Record<string, WorkOrderStatus>>({});
  const items: WorkOrder[] = (storeItems.length > 0 ? storeItems : initial ?? []).map((w) =>
    localOverrides[w.id] ? { ...w, status: localOverrides[w.id] } : w
  );

  // ?tab=winterization | bottom_paint | service | inspection | haul_out
  // — deep-link from the dashboard "review winterization queue" CTA,
  // the agent ("show me bottom-paint work orders"), or external links.
  // Default to "all" so a fresh navigation hits the full kanban.
  const [filterType, setFilterType] = useTabUrlState<ActivityFilter>(
    "tab",
    isActivityFilter,
    "all",
  );
  const [query, setQuery] = React.useState("");
  const [flaggedOnly, setFlaggedOnly] = React.useState(false);
  const [newOpen, setNewOpen] = React.useState(false);

  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = React.useState<ColumnKey | null>(null);

  const visible = items.filter((wo) => {
    if (filterType !== "all" && wo.activity_type !== filterType) return false;
    if (flaggedOnly && !wo.flagged) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      const hit = [wo.subject, wo.number, wo.description]
        .some((v) => v?.toLowerCase().includes(q));
      if (!hit) return false;
    }
    return true;
  });

  function handleDrop(col: ColumnKey) {
    if (!draggingId) return;
    const wo = items.find((w) => w.id === draggingId);
    if (!wo) return;
    const current = columnFor(wo);
    if (current === col) {
      setDraggingId(null);
      setDragOverCol(null);
      return;
    }
    // Map target column → status. "Billed" requires invoiced quote, so don't move there manually.
    const map: Record<ColumnKey, WorkOrderStatus | null> = {
      open: "open",
      scheduled: "scheduled",
      in_progress: "in_progress",
      completed: "completed",
      billed: null, // derived, not directly settable
    };
    const newStatus = map[col];
    if (!newStatus) {
      setDraggingId(null);
      setDragOverCol(null);
      return;
    }
    // Persist the transition through the store so the closeout chain
    // fires on transitions to "completed" (posts invoice + dispatches
    // service-complete comm). Local override stays as a visual fallback
    // for the initial paint while the store updates.
    updateWorkOrder(draggingId, { status: newStatus });
    setLocalOverrides((prev) => ({ ...prev, [draggingId]: newStatus }));
    setDraggingId(null);
    setDragOverCol(null);
  }

  return (
    // The agent lives on the parent page (app/work-orders/page.tsx) so
    // it persists across kanban filter changes and matches the canonical
    // agent-at-the-layout-level pattern used by every other top-level
    // page (/members, /services, /bookings, /settings).
    <div className="space-y-5">
      {/* Type filter tabs */}
      <div className="flex flex-wrap gap-1 rounded-[10px] border border-hairline bg-surface-2 p-1">
        {ACTIVITY_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setFilterType(t.key)}
            className={cn(
              "flex-1 min-w-fit rounded-[6px] px-2.5 py-1 text-[11px] font-medium transition-colors",
              filterType === t.key
                ? "bg-surface-1 text-fg shadow-sm"
                : "text-fg-subtle hover:text-fg"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search + flagged + new */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, number, description…"
            className="w-full rounded-[8px] border border-hairline bg-surface-1 py-2 pl-8 pr-3 text-[13px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => setFlaggedOnly((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-[12px] font-medium transition-colors",
            flaggedOnly
              ? "border-status-warn/40 bg-status-warn/15 text-status-warn"
              : "border-hairline bg-surface-1 text-fg-subtle hover:bg-surface-2"
          )}
        >
          <Flag className="size-3.5" />
          Flagged
        </button>
        <Button variant="primary" size="md" onClick={() => setNewOpen(true)}>
          <Plus className="size-3.5" />
          New Work Order
        </Button>
      </div>

      <NewWorkOrderWizard open={newOpen} onOpenChange={setNewOpen} />

      {/* Kanban */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(5, minmax(220px, 1fr))" }}>
        {COLUMNS.map((col) => {
          const colItems = visible.filter((wo) => columnFor(wo) === col.key);
          const over = dragOverCol === col.key;
          return (
            <div
              key={col.key}
              className="flex min-w-0 flex-col"
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverCol(col.key);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverCol(null);
                }
              }}
              onDrop={() => handleDrop(col.key)}
            >
              <div
                className={cn(
                  "mb-2 flex items-center justify-between rounded-[10px] border bg-surface-1 px-3 py-2 transition-colors",
                  over ? "border-primary/40 bg-primary-soft" : "border-hairline"
                )}
              >
                <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                  {col.label}
                </span>
                <Badge tone="neutral" size="sm">
                  {colItems.length}
                </Badge>
              </div>

              <div className={cn(
                "flex-1 space-y-2 rounded-[10px] p-1 transition-colors",
                over ? "bg-primary-soft/40" : ""
              )}>
                {colItems.length === 0 ? (
                  <div className="rounded-[8px] border border-dashed border-hairline p-4 text-center text-[11px] text-fg-tertiary">
                    None
                  </div>
                ) : (
                  colItems.map((wo) => (
                    <WoCard
                      key={wo.id}
                      wo={wo}
                      dragging={draggingId === wo.id}
                      onDragStart={() => setDraggingId(wo.id)}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverCol(null);
                      }}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-center text-[10px] text-fg-tertiary">
        Drag cards between columns to update status. "Billed" is derived — completed work orders with an invoiced quote.
      </p>
    </div>
  );
}
