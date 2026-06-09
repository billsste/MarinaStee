"use client";

import { Repeat } from "lucide-react";
import { LocalTime } from "@/components/ui/local-time";
import { nextRecurringDate } from "@/lib/recurring-cleaning";
import { useWorkOrders } from "@/lib/client-store";
import type { WorkOrder } from "@/lib/types";

// Recurrence card — shown when a cleaning WO is part of a recurring
// chain. Subscribes to the live WO store so the "Next" date updates
// the moment the walker advances the anchor — without this, the
// server-rendered prop stays frozen and the preview lies about when
// the next cleaning lands.

const CADENCE_LABEL = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  bi_yearly: "Every 6 months",
  yearly: "Yearly",
} as const;

export function RecurringPreview({ wo }: { wo: WorkOrder }) {
  // Pull the live WO record off the store so the displayed "Next"
  // tracks store mutations (Advance button, agent actions, manual
  // edits). Falls back to the server-rendered prop while the store
  // hydrates on first paint.
  const wos = useWorkOrders();
  const live = wos.find((w) => w.id === wo.id) ?? wo;
  if (!live.is_recurring || !live.recurring_schedule) return null;
  // Prefer the store-stamped `recurring_next_date` (advanced by the
  // walker on every spawn) so the displayed "Next" date stays accurate
  // after the first cycle has fired. Fall back to deriving from
  // start_date + one cadence step only when no next-date exists yet —
  // e.g. a brand-new WO that hasn't been picked up by the walker.
  const nextIso =
    live.recurring_next_date ??
    (live.start_date
      ? nextRecurringDate(live.start_date, live.recurring_schedule)
      : undefined);

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          <Repeat className="size-3.5" />
          Recurring
        </div>
        <div className="text-[11px] text-fg-muted">
          {CADENCE_LABEL[live.recurring_schedule]}
        </div>
      </div>
      <div className="px-3 py-2 text-[13px] text-fg">
        {nextIso ? (
          <>
            <span className="text-fg-muted">Next: </span>
            <LocalTime iso={nextIso} fmt="weekday" />
          </>
        ) : (
          <span className="text-fg-tertiary">
            No anchor date — add a start date to schedule the next spawn.
          </span>
        )}
      </div>
    </div>
  );
}
