"use client";

import * as React from "react";
import { ChevronRight, LifeBuoy } from "lucide-react";
import { LocalTime } from "@/components/ui/local-time";
import {
  STATUS_LABEL,
  SupportPriorityBadge,
  SupportStatusBadgeOps,
  SupportTypeBadge,
} from "@/components/support/support-ticket-badges";
import { SupportTicketModal } from "@/components/support/support-ticket-modal";
import { useAllBoaters, useSupportTicketsForTenant } from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { Boater, SupportTicketStatus } from "@/lib/types";

/*
 * Operator-side support queue.
 *
 * Dense table with status filter chips on top. Click a row to open
 * the staff-flavored detail modal (same modal as the boater portal,
 * with the staff-only header strip + status pills enabled).
 *
 * Visible columns: ref · subject · boater · status · priority · last
 * activity. Type lives in the modal — keeping the table to 6 columns
 * preserves scannability at marina scale.
 */

const STATUS_FILTERS: { value: "all" | SupportTicketStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "awaiting_boater", label: "Awaiting boater" },
  { value: "resolved", label: "Resolved" },
  { value: "cancelled", label: "Cancelled" },
];

export function SupportQueueTable() {
  const tickets = useSupportTicketsForTenant();
  const allBoaters = useAllBoaters();
  const [filter, setFilter] = React.useState<"all" | SupportTicketStatus>(
    "open",
  );
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const boaterById = React.useMemo(() => {
    const m = new Map<string, Boater>();
    for (const b of allBoaters) m.set(b.id, b);
    return m;
  }, [allBoaters]);

  const visible = React.useMemo(() => {
    const sorted = [...tickets].sort((a, b) =>
      a.updated_at < b.updated_at ? 1 : -1,
    );
    if (filter === "all") return sorted;
    return sorted.filter((t) => t.status === filter);
  }, [tickets, filter]);

  const counts = React.useMemo(() => {
    const c: Record<"all" | SupportTicketStatus, number> = {
      all: tickets.length,
      open: 0,
      in_progress: 0,
      awaiting_boater: 0,
      resolved: 0,
      cancelled: 0,
    };
    for (const t of tickets) c[t.status] += 1;
    return c;
  }, [tickets]);

  const active = activeId ? tickets.find((t) => t.id === activeId) ?? null : null;
  const activeBoater = active ? boaterById.get(active.boater_id) ?? null : null;

  return (
    <div className="space-y-3">
      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_FILTERS.map((f) => {
          const isActive = filter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                isActive
                  ? "border-primary/40 bg-primary-soft text-primary"
                  : "border-hairline bg-surface-1 text-fg-muted hover:border-hairline-strong hover:bg-surface-2",
              )}
            >
              {f.label}
              <span className="ml-1 text-fg-tertiary">
                {counts[f.value]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div
          className="grid items-center gap-2 border-b border-hairline bg-surface-2 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{
            gridTemplateColumns:
              "92px minmax(0,1.8fr) minmax(0,1.2fr) 140px 100px 130px 24px",
          }}
        >
          <span>Ref</span>
          <span>Subject</span>
          <span>Boater</span>
          <span>Status</span>
          <span>Priority</span>
          <span>Last activity</span>
          <span aria-hidden />
        </div>

        {visible.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <LifeBuoy className="mx-auto size-5 text-fg-tertiary" />
            <p className="mt-2 text-[13px] text-fg-subtle">
              {filter === "all"
                ? "No tickets yet."
                : `No ${STATUS_LABEL[filter as SupportTicketStatus].toLowerCase()} tickets.`}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {visible.map((t) => {
              const b = boaterById.get(t.boater_id) ?? null;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(t.id)}
                    className="group grid w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-primary-soft/15"
                    style={{
                      gridTemplateColumns:
                        "92px minmax(0,1.8fr) minmax(0,1.2fr) 140px 100px 130px 24px",
                    }}
                  >
                    <span className="text-[12px] font-medium tabular text-fg">
                      {t.reference}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-fg">
                        {t.subject}
                      </span>
                      <span className="block truncate text-[11px] text-fg-tertiary">
                        <SupportTypeBadge type={t.type} size="sm" />
                      </span>
                    </span>
                    <span className="min-w-0 truncate text-[12px] text-fg-subtle">
                      {b?.display_name ?? "Unknown boater"}
                    </span>
                    <span>
                      <SupportStatusBadgeOps status={t.status} size="sm" />
                    </span>
                    <span>
                      <SupportPriorityBadge priority={t.priority} size="sm" />
                    </span>
                    <LocalTime
                      iso={t.updated_at}
                      fmt="short_datetime"
                      className="text-[11px] tabular text-fg-tertiary"
                    />
                    <ChevronRight className="size-3.5 text-fg-tertiary transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {active && (
        <SupportTicketModal
          ticket={active}
          boater={activeBoater}
          open={true}
          onClose={() => setActiveId(null)}
          viewerKind="staff"
        />
      )}
    </div>
  );
}
