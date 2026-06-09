"use client";

/*
 * components/dock/clock-in-tile.tsx
 *
 * Dock home-view tile (already wired in /dock/page.tsx) re-exported
 * as a standalone component so other surfaces (e.g. an admin "Quick
 * actions" rail) can drop it in without re-rendering the whole dock
 * grid.
 *
 * The PIN keypad + staff picker live in `clock-in-flow.tsx`. This
 * file is the iconography + count badge surface.
 */

import * as React from "react";
import { Clock4 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTimeEntries } from "@/lib/client-store";

interface Props {
  onClick: () => void;
  className?: string;
}

export function ClockInTile({ onClick, className }: Props) {
  const entries = useTimeEntries();
  const onTheClock = entries.filter((t) => !t.clock_out_at).length;
  const tone =
    onTheClock > 0
      ? "border-status-info/30 bg-status-info/[0.06] text-status-info"
      : "border-hairline bg-surface-1 text-fg-muted";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "tap-scale flex aspect-square flex-col items-start justify-between rounded-[18px] border p-5 transition-colors",
        tone,
        className
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-surface-1/80">
        <Clock4 className="size-5" />
      </span>
      <div>
        <div className="display-tight text-[19px] font-semibold text-fg">
          Clock in / out
        </div>
        <div className="mt-0.5 text-[13px] text-fg-subtle">
          {onTheClock > 0
            ? `${onTheClock} on the clock`
            : "Tap to start your shift"}
        </div>
      </div>
    </button>
  );
}
