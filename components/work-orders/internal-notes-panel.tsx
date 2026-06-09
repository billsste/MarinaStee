"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateWorkOrder, useWorkOrders } from "@/lib/client-store";
import {
  preserveInternalNotesMarkers,
  stripInternalNotesMarkers,
} from "@/lib/recurring-cleaning";
import type { WorkOrder } from "@/lib/types";

// Staff-only notes — kept distinct from `description` (which is the
// customer-facing scope and can land on a quote/portal). The textarea
// renders the body only; system markers (`Source: …`,
// `RecurringSource: …`) live in the underlying internal_notes field
// but get filtered out of the editor so the operator only sees what
// they actually wrote, and re-prepended on save so the cleaning
// back-reference / recurring chain stays intact.

export function InternalNotesPanel({ wo }: { wo: WorkOrder }) {
  // Subscribe so the textarea stays in sync if the WO's notes change
  // out from under us (e.g. another tab toggles a recurring spawn).
  const wos = useWorkOrders();
  const live = wos.find((w) => w.id === wo.id) ?? wo;

  const bodyFromStore = stripInternalNotesMarkers(live.internal_notes);
  const [draft, setDraft] = React.useState(bodyFromStore);
  // Reset the local draft whenever the underlying body changes from
  // outside (markers don't count). React.useId is overkill — just key
  // on the body string.
  const lastSyncedRef = React.useRef(bodyFromStore);
  if (lastSyncedRef.current !== bodyFromStore && draft === lastSyncedRef.current) {
    lastSyncedRef.current = bodyFromStore;
    // queueMicrotask avoids the render-phase setState warning
    queueMicrotask(() => setDraft(bodyFromStore));
  }

  const dirty = draft !== bodyFromStore;

  function save() {
    const merged = preserveInternalNotesMarkers(live.internal_notes, draft);
    updateWorkOrder(live.id, { internal_notes: merged || undefined });
    lastSyncedRef.current = draft;
  }

  function reset() {
    setDraft(bodyFromStore);
  }

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          <Lock className="size-3.5" />
          Internal notes
        </div>
        <span className="text-[10px] text-fg-tertiary">staff only</span>
      </div>
      <div className="p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Dispatcher remarks, tech notes — never visible on the boater portal."
          rows={4}
          className="block w-full resize-y rounded-[8px] border border-hairline bg-surface-1 px-2.5 py-2 text-[13px] text-fg placeholder:text-fg-tertiary focus:border-primary focus:outline-none"
        />
        {dirty && (
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={save}>
              Save notes
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
