// Recurring-cleaning cron helper.
//
// Cleaning work orders flagged with `is_recurring` carry a cadence
// (`recurring_schedule`) + an anchor date (`recurring_next_date`). When
// the cron fires (or in the prototype, when staff taps the "Advance
// recurring cleanings" button on the WO detail page) the walker scans
// every WO whose next-spawn date has landed and emits a fresh WO via
// the agent-action pipeline so the audit log + RBAC checks still apply.
//
// The previous WO's `recurring_next_date` advances by one cadence step,
// and the new WO carries a `RecurringSource: <prev_wo_id>` line at the
// top of `internal_notes` so the detail page can render a back-ref
// without growing the WorkOrder type.
//
// Cron path lands when Convex backend flips (see
// docs/architecture-convex.md). Until then this is a manual + dev-mode
// button-driven walker.

import { BOATERS } from "@/lib/mock-data";
import {
  getWorkOrders,
  updateWorkOrder,
} from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";
import type { RecurringSchedule, WorkOrder } from "@/lib/types";

/**
 * Compute the next ISO date (yyyy-mm-dd) for a recurring cadence.
 * UTC-anchored — the same calendar day on every spawn regardless of
 * the operator's local timezone. Ported from
 * agent-actions.ts → computeRecurringNextDate so the recurrence engine
 * and the WO action handler can't drift apart.
 */
export function nextRecurringDate(
  startIso: string,
  cadence: RecurringSchedule,
): string {
  // Tolerate both bare yyyy-mm-dd and full ISO timestamps — the WO
  // action handler stores yyyy-mm-dd, but callers passing a Date.toISOString()
  // shouldn't break.
  const anchor = startIso.length === 10
    ? `${startIso}T00:00:00Z`
    : startIso;
  const d = new Date(anchor);
  switch (cadence) {
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "monthly":
      addUtcMonthsClamped(d, 1);
      break;
    case "quarterly":
      addUtcMonthsClamped(d, 3);
      break;
    case "bi_yearly":
      addUtcMonthsClamped(d, 6);
      break;
    case "yearly":
      addUtcMonthsClamped(d, 12);
      break;
  }
  return d.toISOString().slice(0, 10);
}

// JS `setUTCMonth(+n)` overflows the day component on month-end anchors
// — Jan 31 + 1 month → Feb 31 → Mar 3, silently SKIPPING February. The
// same trap hits Feb 29 on yearly cadence (Feb 29 2024 + 1 year →
// Mar 1 2025). Clamp the day to the destination month's last valid day
// so a recurring cleaning anchored on the 29th–31st stays on cadence
// instead of jumping two months at every boundary.
function addUtcMonthsClamped(d: Date, months: number): void {
  const day = d.getUTCDate();
  d.setUTCDate(1); // dodge the overflow before moving the month pointer
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
}

/**
 * Prefix marker stashed at the top of `internal_notes` on a spawned
 * recurring cleaning WO. Format: `RecurringSource: wo_xyz`. Sits above
 * any existing `Source: …` line so the WO detail page can find both
 * without ambiguity.
 */
export const RECURRING_SOURCE_PREFIX = "RecurringSource:";

/**
 * Parse the `RecurringSource: <wo_id>` marker out of an internal_notes
 * block. Returns undefined when the marker is absent or malformed.
 */
export function parseRecurringSourceId(
  internalNotes: string | undefined,
): string | undefined {
  if (!internalNotes) return undefined;
  for (const line of internalNotes.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(RECURRING_SOURCE_PREFIX)) {
      const id = trimmed.slice(RECURRING_SOURCE_PREFIX.length).trim();
      return id || undefined;
    }
  }
  return undefined;
}

/**
 * Parse the `Source: <label> <id>` cleaning back-reference stashed by
 * the create_work_order handler. Returns the source kind + id pair so
 * the detail page can render a clickable link.
 *
 * Tolerates both labels the handler uses ("Club booking", "Paid rental")
 * and falls back to undefined when the marker isn't present.
 */
export function parseCleaningSource(
  internalNotes: string | undefined,
): { kind: "club_booking" | "paid_rental"; id: string } | undefined {
  if (!internalNotes) return undefined;
  for (const line of internalNotes.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("Source:")) continue;
    const rest = trimmed.slice("Source:".length).trim();
    // "Club booking cb_001" or "Paid rental br_007"
    if (rest.startsWith("Club booking ")) {
      const id = rest.slice("Club booking ".length).trim();
      if (id) return { kind: "club_booking", id };
    } else if (rest.startsWith("Paid rental ")) {
      const id = rest.slice("Paid rental ".length).trim();
      if (id) return { kind: "paid_rental", id };
    }
    return undefined;
  }
  return undefined;
}

/**
 * Strip leading `RecurringSource:` / `Source:` marker lines out of an
 * internal_notes block so the staff-facing notes textarea only renders
 * the free-text portion the operator actually wrote. The system markers
 * stay in the underlying field so the detail rail / spawn walker keep
 * working — only the visible textarea is filtered.
 */
export function stripInternalNotesMarkers(
  internalNotes: string | undefined,
): string {
  if (!internalNotes) return "";
  return internalNotes
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return (
        !t.startsWith("Source:") && !t.startsWith(RECURRING_SOURCE_PREFIX)
      );
    })
    .join("\n")
    .trim();
}

/**
 * Re-prefix a free-text notes string with whatever system markers were
 * present on the original WO. Used when the operator saves the
 * internal-notes textarea — we keep `Source:` / `RecurringSource:`
 * untouched and only swap the body.
 */
export function preserveInternalNotesMarkers(
  original: string | undefined,
  edited: string,
): string {
  if (!original) return edited.trim();
  const markers = original
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return (
        t.startsWith("Source:") || t.startsWith(RECURRING_SOURCE_PREFIX)
      );
    });
  const body = edited.trim();
  if (markers.length === 0) return body;
  if (!body) return markers.join("\n");
  return `${markers.join("\n")}\n${body}`;
}

/**
 * Walk every recurring cleaning WO whose `recurring_next_date` is on
 * or before `todayIso`. For each one:
 *   1. spawn a fresh WO via executeAgentAction({ kind: "create_work_order" })
 *      carrying the same boater / vessel / slip / cadence / checklist /
 *      estimate / cleaning-source / attachments
 *   2. stamp the new WO's internal_notes with `RecurringSource: <prev_id>`
 *      so the detail page can render the back-ref
 *   3. advance the prior WO's `recurring_next_date` by one cadence step
 *      so the next tick doesn't re-spawn the same job
 *
 * Returns the list of spawned WO ids (resolved post-mutation) so the
 * caller (dev button, eventual cron handler) can surface a toast.
 *
 * Defensive guards:
 *   - skips WOs missing cadence or anchor (data-integrity bug elsewhere)
 *   - skips when boater no longer exists (cross-tenant guard in
 *     executeAgentAction would reject anyway, but bail early to keep
 *     the audit log clean)
 *   - reuses the *raw* internal_notes from the source WO when spawning
 *     so the `Source: …` cleaning-back-reference is preserved
 */
export function advanceRecurringCleanings(opts: {
  todayIso: string;
}): { spawned: number; woIds: string[] } {
  const today = opts.todayIso.length === 10
    ? opts.todayIso
    : opts.todayIso.slice(0, 10);

  const candidates: WorkOrder[] = getWorkOrders().filter((wo) => {
    if (wo.work_class !== "cleaning") return false;
    if (!wo.is_recurring) return false;
    if (!wo.recurring_schedule) return false;
    if (!wo.recurring_next_date) return false;
    // Skip completed parents. Closeout (lib/wo-closeout.ts:391-398)
    // already spawns the next recurring WO at completion time but does
    // NOT advance the parent's `recurring_next_date` — the anchor still
    // reads as due on its original cadence. If we don't filter on
    // status, the walker sees the same parent on its next tick and
    // double-spawns. Closeout is the canonical spawn site once a WO
    // completes; the walker should only fire for parents the operator
    // hasn't closed out manually yet.
    if (wo.status === "completed") return false;
    return wo.recurring_next_date <= today;
  });

  const spawnedIds: string[] = [];
  for (const prev of candidates) {
    const boaterExists = BOATERS.some((b) => b.id === prev.boater_id);
    if (!boaterExists) continue;
    if (!prev.recurring_schedule) continue;
    if (!prev.recurring_next_date) continue;

    // Pull the cleaning-source back-ref off the prior WO. Prefer the
    // structured columns (cleaning_source_kind / cleaning_source_id)
    // and fall back to the legacy notes-prefix parser only for WOs
    // that pre-date the column migration. The action handler will
    // re-stamp the source onto the new WO so the chain stays linked
    // to its originating booking/rental.
    const cleaningSource =
      prev.cleaning_source_kind && prev.cleaning_source_id
        ? { kind: prev.cleaning_source_kind, id: prev.cleaning_source_id }
        : parseCleaningSource(prev.internal_notes);

    // Free-text notes (sans markers) get carried forward verbatim. The
    // new RecurringSource marker is prepended after the agent action
    // returns the spawned WO id.
    const carriedNotes = stripInternalNotesMarkers(prev.internal_notes);

    // Anchor the next spawn at the cadence step from the prior next-date,
    // not today — keeps the chain on its original calendar rhythm even
    // if the cron fires late.
    const nextAnchor = prev.recurring_next_date;

    const result = executeAgentAction({
      kind: "create_work_order",
      label: `Recurring cleaning spawn from ${prev.number}`,
      boater_id: prev.boater_id,
      subject: prev.subject,
      description: prev.description,
      activity_type: prev.activity_type ?? "other",
      priority: prev.priority,
      vessel_id: prev.vessel_id,
      slip_id: prev.slip_id,
      start_date: nextAnchor,
      end_date: prev.end_date,
      due_date: prev.due_date,
      assignee_user_id: prev.assignee_user_id,
      work_class: "cleaning",
      estimated_total: prev.estimated_total,
      estimated_hours: prev.estimated_hours,
      // Reset completion stamps on the cloned checklist so the new WO
      // renders as an empty checklist rather than inheriting the prior
      // crew's ticks.
      checklist: prev.checklist?.map((c) => ({
        id: c.id,
        label: c.label,
      })),
      // The spawned WO is a one-shot child of the recurring template:
      // ONLY the source WO carries is_recurring=true + a schedule. If
      // both records were flagged recurring with the same
      // recurring_next_date (the inherited cadence step), the walker
      // would pick up both on the next tick and spawn twice — and
      // double, then quadruple, every cycle. Keeping the child
      // one-shot means the next cycle has a single source.
      is_recurring: false,
      internal_notes: carriedNotes || undefined,
      attachment_ids: prev.attachment_ids,
      cleaning_source_kind: cleaningSource?.kind,
      cleaning_source_id: cleaningSource?.id,
    });

    if (!result.ok || !result.createdId) continue;
    spawnedIds.push(result.createdId);

    // Stamp the new WO with a RecurringSource marker pointing back to
    // the template. We do this directly because the agent action shape
    // doesn't carry a recurring_source field — keeping that out of the
    // discriminated union keeps the action surface stable. The marker
    // lives in internal_notes the same way `Source:` does for cleaning
    // back-refs.
    const spawned = getWorkOrders().find((w) => w.id === result.createdId);
    if (spawned) {
      const sourceLine = `${RECURRING_SOURCE_PREFIX} ${prev.id}`;
      const nextNotes = spawned.internal_notes
        ? `${sourceLine}\n${spawned.internal_notes}`
        : sourceLine;
      updateWorkOrder(spawned.id, { internal_notes: nextNotes });
    }

    // Advance the prior WO's anchor so we don't re-spawn on the next
    // tick. We do this regardless of the spawn outcome — if the spawn
    // failed we'd loop forever otherwise.
    updateWorkOrder(prev.id, {
      recurring_next_date: nextRecurringDate(
        nextAnchor,
        prev.recurring_schedule,
      ),
    });
  }

  return { spawned: spawnedIds.length, woIds: spawnedIds };
}
