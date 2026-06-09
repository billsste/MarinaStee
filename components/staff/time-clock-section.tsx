"use client";

/*
 * components/staff/time-clock-section.tsx
 *
 * Operator surface for the Time Clock sub-tab. Shows:
 *   - Today's roster card (who's on the clock, in-progress hours,
 *     who's late vs. their scheduled shift)
 *   - Recent entries table with filter (date range + staff)
 *   - Inline adjust drawer (audit-logged manual override)
 *
 * The PIN-based dock surface lives at /dock — this is the operator
 * dashboard side of the same data.
 */

import * as React from "react";
import { Clock4, AlertTriangle, Pencil, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  adjustTimeEntry,
  deriveTimeEntryStatus,
  pauseTimeEntry,
  resumeTimeEntry,
  useShifts,
  useStaff,
  useTimeEntries,
} from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { TimeEntry } from "@/lib/types";

type StaffById = Map<string, ReturnType<typeof useStaff>[number]>;

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function hoursElapsed(t: TimeEntry): number {
  if (t.calculated_hours !== undefined) return t.calculated_hours;
  const end = t.clock_out_at ? new Date(t.clock_out_at).getTime() : Date.now();
  const pauseSec = (t.pause_seconds_total ?? 0)
    + (t.paused_at ? Math.max(0, Math.floor((Date.now() - new Date(t.paused_at).getTime()) / 1000)) : 0);
  const breakHrs = (t.break_minutes ?? 0) / 60;
  const raw = (end - new Date(t.clock_in_at).getTime()) / 3_600_000 - breakHrs - pauseSec / 3600;
  return Math.max(0, raw);
}

function hoursLabel(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${hh}h ${mm.toString().padStart(2, "0")}m`;
}

export function TimeClockSection() {
  const allEntries = useTimeEntries();
  const staff = useStaff();
  const shifts = useShifts();
  const staffById: StaffById = React.useMemo(
    () => new Map(staff.map((s) => [s.id, s])),
    [staff]
  );

  // ── Today's roster ──
  const today = new Date().toISOString().slice(0, 10);
  const todaysShifts = shifts.filter(
    (s) => s.start_at.slice(0, 10) === today
  );
  const openToday = allEntries.filter((t) => !t.clock_out_at);
  const completedToday = allEntries.filter(
    (t) => t.clock_out_at && t.clock_out_at.slice(0, 10) === today
  );
  // Late = scheduled to start > 10 mins ago and no open entry.
  const lateNow = todaysShifts.filter((s) => {
    const startMs = new Date(s.start_at).getTime();
    if (Date.now() - startMs < 10 * 60_000) return false;
    return !openToday.some((t) => t.staff_id === s.staff_id);
  });

  // ── Filters + recent entries ──
  const [filterStaff, setFilterStaff] = React.useState<string>("");
  const [rangeDays, setRangeDays] = React.useState<7 | 14 | 30>(14);
  const cutoff = Date.now() - rangeDays * 86_400_000;
  const filtered = allEntries
    .filter((t) => {
      if (filterStaff && t.staff_id !== filterStaff) return false;
      const ts = new Date(t.clock_in_at).getTime();
      return ts >= cutoff;
    })
    .sort((a, b) => b.clock_in_at.localeCompare(a.clock_in_at));

  const [editing, setEditing] = React.useState<TimeEntry | null>(null);

  return (
    <div className="space-y-6">
      {/* Roster card — who's on the clock right now */}
      <section className="rounded-[12px] border border-hairline bg-surface-1 p-4">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-[14px] font-medium text-fg">Today's roster</h2>
            <p className="mt-0.5 text-[12px] text-fg-tertiary">
              {openToday.length} on the clock · {completedToday.length} completed · {lateNow.length} late
            </p>
          </div>
          {lateNow.length > 0 && (
            <Badge tone="warn" size="sm">
              <AlertTriangle className="size-3" />
              {lateNow.length} late
            </Badge>
          )}
        </div>

        {openToday.length === 0 && completedToday.length === 0 ? (
          <p className="text-[12px] text-fg-tertiary">
            No clock-ins yet today. Staff can clock in from /dock with their 4-digit PIN.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {openToday.map((t) => {
              const s = staffById.get(t.staff_id);
              const status = deriveTimeEntryStatus(t);
              const elapsed = hoursElapsed(t);
              return (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-fg">
                        {s?.name ?? t.staff_id}
                      </span>
                      <Badge
                        tone={status === "paused" ? "warn" : "ok"}
                        size="sm"
                      >
                        {status === "paused" ? "on break" : "on the clock"}
                      </Badge>
                      {t.position && (
                        <span className="text-[11px] text-fg-tertiary">
                          · {t.position}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-fg-tertiary">
                      Clocked in {fmtTime(t.clock_in_at)} · {hoursLabel(elapsed)} so far
                    </div>
                  </div>
                  {status === "paused" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => resumeTimeEntry(t.id)}
                    >
                      Resume
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => pauseTimeEntry(t.id)}
                    >
                      Pause
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Recent entries — filterable */}
      <section>
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-medium text-fg">Recent time entries</h2>
            <p className="mt-0.5 text-[12px] text-fg-tertiary">
              Click any row to adjust. Locked once a payroll period closes.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-[8px] border border-hairline bg-surface-1 px-2 py-1 text-[12px] text-fg"
              value={filterStaff}
              onChange={(e) => setFilterStaff(e.target.value)}
            >
              <option value="">All staff</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-[8px] border border-hairline bg-surface-1 px-2 py-1 text-[12px] text-fg"
              value={rangeDays}
              onChange={(e) => setRangeDays(Number(e.target.value) as 7 | 14 | 30)}
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-[12px] border border-hairline bg-surface-1 px-4 py-6 text-center text-[12px] text-fg-tertiary">
            No entries in this window.
          </div>
        ) : (
          <ul className="divide-y divide-hairline rounded-[12px] border border-hairline bg-surface-1">
            {filtered.map((t) => {
              const s = staffById.get(t.staff_id);
              const status = deriveTimeEntryStatus(t);
              const locked = !!t.payroll_run_id;
              return (
                <li key={t.id} className="group">
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => !locked && setEditing(t)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors",
                      locked ? "opacity-60" : "hover:bg-surface-2 cursor-pointer"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-fg">
                          {s?.name ?? t.staff_id}
                        </span>
                        <Badge
                          tone={
                            status === "in_progress" || status === "paused"
                              ? "info"
                              : status === "adjusted"
                              ? "warn"
                              : "neutral"
                          }
                          size="sm"
                        >
                          {status.replace("_", " ")}
                        </Badge>
                        {locked && (
                          <Badge tone="neutral" size="sm">
                            paid
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-fg-tertiary">
                        {fmtDate(t.clock_in_at)} · {fmtTime(t.clock_in_at)}
                        {t.clock_out_at ? ` → ${fmtTime(t.clock_out_at)}` : " → in progress"}
                        {" · "}
                        {hoursLabel(hoursElapsed(t))}
                        {t.adjusted_by ? " · adjusted" : ""}
                      </div>
                    </div>
                    {!locked && (
                      <span className="opacity-0 transition-opacity group-hover:opacity-100">
                        <Pencil className="size-3.5 text-fg-tertiary" />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editing && (
        <AdjustEntryDrawer
          entry={editing}
          staffName={staffById.get(editing.staff_id)?.name ?? editing.staff_id}
          adjusterStaffId={staff[0]?.id ?? ""}
          onClose={() => setEditing(null)}
        />
      )}

      <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
        <div className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-fg-subtle">
          <Sparkles className="size-3 text-primary" />
          Try the agent
        </div>
        <p className="text-[12px] text-fg-subtle">
          &ldquo;Who&apos;s on the clock?&rdquo; &middot;
          &ldquo;Fix Dock Lead A&apos;s Friday timecard&rdquo; &middot;
          &ldquo;Clock out Dock Lead B&rdquo;
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Inline adjust drawer (audit-logged)
// ────────────────────────────────────────────────────────────

function AdjustEntryDrawer({
  entry,
  staffName,
  adjusterStaffId,
  onClose,
}: {
  entry: TimeEntry;
  staffName: string;
  adjusterStaffId: string;
  onClose: () => void;
}) {
  // Pre-fill with local time strings rounded to the minute. `datetime-local`
  // doesn't accept the ISO Z suffix, so we strip it. On save we convert back
  // to ISO via new Date(...).
  const toLocal = (iso?: string): string => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [clockIn, setClockIn] = React.useState(toLocal(entry.clock_in_at));
  const [clockOut, setClockOut] = React.useState(toLocal(entry.clock_out_at));
  const [breakMin, setBreakMin] = React.useState(
    (entry.break_minutes ?? 0).toString()
  );
  const [notes, setNotes] = React.useState(entry.notes ?? "");

  function save() {
    adjustTimeEntry(
      entry.id,
      {
        clock_in_at: new Date(clockIn).toISOString(),
        clock_out_at: clockOut ? new Date(clockOut).toISOString() : undefined,
        break_minutes: Number(breakMin) || 0,
        notes: notes || undefined,
      },
      adjusterStaffId
    );
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-[16px] border border-hairline bg-surface-1 p-5 shadow-xl sm:rounded-[16px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <h3 className="text-[15px] font-medium text-fg">
            Adjust timecard
          </h3>
          <p className="mt-0.5 text-[12px] text-fg-tertiary">
            {staffName} · {fmtDate(entry.clock_in_at)} · changes are audit-logged
          </p>
        </div>

        <div className="space-y-3">
          <Field label="Clock in">
            <input
              type="datetime-local"
              value={clockIn}
              onChange={(e) => setClockIn(e.target.value)}
              className="w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-fg"
            />
          </Field>
          <Field label="Clock out">
            <input
              type="datetime-local"
              value={clockOut}
              onChange={(e) => setClockOut(e.target.value)}
              className="w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-fg"
            />
          </Field>
          <Field label="Break minutes (unpaid)">
            <input
              type="text"
              inputMode="numeric"
              value={breakMin}
              onChange={(e) => setBreakMin(e.target.value.replace(/[^\d]/g, ""))}
              className="w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-fg"
            />
          </Field>
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="What changed and why?"
              className="w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-fg placeholder:text-fg-tertiary"
            />
          </Field>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={save}>
            <Clock4 className="size-3.5" />
            Save adjust
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </span>
      {children}
    </label>
  );
}
