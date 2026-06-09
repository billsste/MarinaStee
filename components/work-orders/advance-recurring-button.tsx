"use client";

import * as React from "react";
import { PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { advanceRecurringCleanings } from "@/lib/recurring-cleaning";
import { localIsoDate } from "@/lib/contracts";

// Dev-mode trigger for the recurring-cleaning walker. The real cron
// lands when Convex backend flips — until then staff can tap this on
// the WO detail page to fast-forward the chain and confirm the spawned
// WO carries the right RecurringSource marker + cleaning back-ref.
//
// Visibility is gated to non-production builds so prod operators don't
// see a tester button. Once the cron is real this component goes away.

export function AdvanceRecurringButton() {
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);

  if (process.env.NODE_ENV === "production") return null;

  async function run() {
    setBusy(true);
    setResult(null);
    // localIsoDate() — `.toISOString().slice(0,10)` is UTC and would
    // fire the walker a calendar day early west of UTC after local
    // evening. Walker compares against `recurring_next_date` (a local
    // YYYY-MM-DD) so both sides need the same local-tz semantics.
    const todayIso = localIsoDate();
    const out = advanceRecurringCleanings({ todayIso });
    setResult(
      out.spawned === 0
        ? "No recurring cleanings due."
        : `Spawned ${out.spawned} cleaning ${out.spawned === 1 ? "WO" : "WOs"}.`,
    );
    setBusy(false);
  }

  return (
    <div className="rounded-[12px] border border-dashed border-hairline bg-surface-1 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
            Dev · recurring cron
          </div>
          <div className="mt-0.5 text-[11px] text-fg-tertiary">
            Advance every recurring cleaning WO whose next-spawn date has landed.
          </div>
          {result && (
            <div className="mt-1 text-[12px] text-fg">{result}</div>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={run} disabled={busy}>
          <PlayCircle className="size-3.5" />
          {busy ? "Running…" : "Advance recurring cleanings"}
        </Button>
      </div>
    </div>
  );
}
