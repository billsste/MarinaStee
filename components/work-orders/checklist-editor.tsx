"use client";

import { Check } from "lucide-react";
import { LocalTime } from "@/components/ui/local-time";
import { updateWorkOrder, useWorkOrders } from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { WorkOrder, WorkOrderChecklistItem } from "@/lib/types";

// Cleaning checklist editor — only renders when the WO carries one
// (seeded by the wizard from DEFAULT_CLEANING_CHECKLIST). Click a row
// to toggle done; counter at the top tracks "n / total". Completion
// stamps `completed_at` (ISO now) + `completed_by` (placeholder staff
// id until real auth lands — same constant the prototype uses for
// other "who did this" stamps).
//
// We mutate via updateWorkOrder() directly rather than threading the
// patch through executeAgentAction → update_work_order because the
// existing action's patch type only carries status/priority/assignee/
// due_date. Checklist edits are a high-frequency in-page action — the
// wo-kanban already calls updateWorkOrder directly for the same reason.

// Placeholder until real auth ships — the prototype has no logged-in
// staff session. Once Clerk wires up, replace with the active user id.
const PROTOTYPE_USER_ID = "u_demo_staff";

export function ChecklistEditor({ wo }: { wo: WorkOrder }) {
  // Subscribe to the store so checklist toggles re-render this view
  // without a parent refresh — the WO detail page is a server component
  // and won't re-fetch on a client mutation.
  const wos = useWorkOrders();
  const live = wos.find((w) => w.id === wo.id) ?? wo;
  const checklist = live.checklist ?? [];
  if (checklist.length === 0) return null;
  const doneCount = checklist.filter((c) => c.completed_at).length;

  function toggle(item: WorkOrderChecklistItem) {
    const current = (live.checklist ?? []).map((c) =>
      c.id === item.id
        ? c.completed_at
          ? { id: c.id, label: c.label }
          : {
              ...c,
              completed_at: new Date().toISOString(),
              completed_by: PROTOTYPE_USER_ID,
            }
        : c,
    );
    updateWorkOrder(live.id, { checklist: current });
  }

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          Cleaning checklist
        </div>
        <div className="tabular text-[12px] text-fg-muted">
          {doneCount} / {checklist.length}
        </div>
      </div>
      <ul className="divide-y divide-hairline">
        {checklist.map((c) => {
          const done = !!c.completed_at;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => toggle(c)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-2",
                  done && "bg-status-ok/5",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors",
                    done
                      ? "border-status-ok bg-status-ok text-white"
                      : "border-hairline-strong bg-surface-1 text-transparent",
                  )}
                  aria-hidden
                >
                  <Check className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "text-[13px]",
                      done ? "text-fg-muted line-through" : "text-fg",
                    )}
                  >
                    {c.label}
                  </div>
                  {done && c.completed_at && (
                    <div className="mt-0.5 text-[11px] text-fg-tertiary">
                      Done{" "}
                      <LocalTime iso={c.completed_at} fmt="datetime" />
                    </div>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
