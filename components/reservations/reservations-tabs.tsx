"use client";

import * as React from "react";
import { CalendarDays, Clock, ListTodo, Sun } from "lucide-react";
import { CalendarView } from "./calendar-view";
import { TodayView } from "./today-view";
import { ReservationsTable } from "./reservations-table";
import { WaitlistView } from "./waitlist-view";
import { cn } from "@/lib/utils";

/*
 * Reservations left-rail nav — same canonical pattern as Settings,
 * Holder portal, Boater detail, Slips, Ledger.
 *
 * Default lens stays Calendar — most staff want the "what does the week
 * look like" view before drilling into a single day.
 */

type SectionKey = "calendar" | "today" | "list" | "waitlist";

const NAV_ITEMS: {
  key: SectionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "today", label: "Today", icon: Sun },
  { key: "list", label: "List", icon: ListTodo },
  { key: "waitlist", label: "Waitlist", icon: Clock },
];

export function ReservationsTabs() {
  const [section, setSection] = React.useState<SectionKey>("calendar");

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_1fr]">
      <nav
        aria-label="Reservations sections"
        className="space-y-0.5 md:sticky md:top-4 md:self-start"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = section === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setSection(item.key)}
              className={cn(
                "flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] transition-colors",
                isActive
                  ? "bg-surface-3 font-medium text-fg"
                  : "text-fg-subtle hover:bg-surface-2 hover:text-fg"
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0">
        {section === "calendar" && <CalendarView />}
        {section === "today" && <TodayView />}
        {section === "list" && <ReservationsTable />}
        {section === "waitlist" && <WaitlistView />}
      </div>
    </div>
  );
}
