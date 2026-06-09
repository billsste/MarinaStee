"use client";

/*
 * components/dock/clock-in-flow.tsx
 *
 * Two-step PWA flow: pick your name → enter PIN → result.
 *
 * Distinct from the inline `ClockView` in /dock/page.tsx (which is
 * PIN-only — the dockhand types their PIN and we resolve to a staff
 * record). The picker-first variant is better when the operator wants
 * the dockhand to confirm WHO is clocking in (anti-buddy-punching),
 * and when the tablet is shared by ~10+ staff and PIN collisions are
 * possible.
 *
 * This component can be dropped into /dock/page.tsx by replacing the
 * `view === "clock" && <ClockView />` line with
 * `view === "clock" && <ClockInFlow onDone={onDone} />`.
 */

import * as React from "react";
import { Clock4, ChevronLeft, Delete, Check, AlertTriangle } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  clockInByPin,
  clockOutByPin,
  pauseTimeEntry,
  resumeTimeEntry,
  useActiveTimeEntryForStaff,
  useStaff,
} from "@/lib/client-store";
import { initialsOf } from "@/lib/mock-data";
import type { StaffMember } from "@/lib/types";

type Step = "pick" | "pin" | "done";

interface Props {
  onDone: (message: string) => void;
}

export function ClockInFlow({ onDone }: Props) {
  const staff = useStaff();
  const eligible = staff.filter(
    (s) => s.status === "active" && !!s.mobile_clock_pin
  );

  const [step, setStep] = React.useState<Step>("pick");
  const [picked, setPicked] = React.useState<StaffMember | null>(null);
  const [pin, setPin] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [resultMsg, setResultMsg] = React.useState<string | null>(null);

  function pickStaff(s: StaffMember) {
    setPicked(s);
    setStep("pin");
    setPin("");
    setError(null);
  }

  function back() {
    setError(null);
    if (step === "pin") {
      setStep("pick");
      setPicked(null);
      setPin("");
    }
  }

  function press(d: string) {
    setError(null);
    if (pin.length >= 4) return;
    setPin((p) => p + d);
  }
  function backspace() {
    setError(null);
    setPin((p) => p.slice(0, -1));
  }
  function clear() {
    setError(null);
    setPin("");
  }

  function submit() {
    if (!picked) return;
    if (pin.length !== 4) {
      setError("PIN must be 4 digits.");
      return;
    }
    if (pin !== picked.mobile_clock_pin) {
      setError("PIN doesn't match.");
      return;
    }
    // PIN matches → either clock out (if active) or clock in.
    const out = clockOutByPin(pin);
    if (out.ok && out.staff) {
      const msg = `Clocked out — ${out.staff.name} · ${(out.hours ?? 0).toFixed(2)} hrs`;
      setResultMsg(msg);
      setStep("done");
      onDone(msg);
      return;
    }
    const inResult = clockInByPin(pin);
    if (inResult.ok && inResult.staff) {
      const msg = `Clocked in — ${inResult.staff.name}${inResult.staff.default_position ? ` (${inResult.staff.default_position})` : ""}`;
      setResultMsg(msg);
      setStep("done");
      onDone(msg);
      return;
    }
    setError("Could not register the punch. Try again.");
  }

  // ── Step: pick ──
  if (step === "pick") {
    return (
      <div className="space-y-4">
        <header>
          <h2 className="display-tight text-[20px] font-semibold text-fg">
            Who&apos;s clocking in?
          </h2>
          <p className="mt-1 text-[13px] text-fg-tertiary">
            Tap your name, then enter your 4-digit PIN.
          </p>
        </header>
        {eligible.length === 0 ? (
          <div className="rounded-[12px] border border-status-warn/30 bg-status-warn/10 p-3 text-[12px] text-status-warn">
            <AlertTriangle className="mr-1 inline-block size-3.5" />
            No staff have a clock-in PIN configured. Manager → /staff →
            Roster to assign PINs.
          </div>
        ) : (
          <ul className="space-y-2">
            {eligible.map((s) => (
              <StaffRow key={s.id} staff={s} onPick={pickStaff} />
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ── Step: pin ──
  if (step === "pin" && picked) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={back}
          className="inline-flex items-center gap-1.5 text-[12px] text-fg-tertiary hover:text-fg"
        >
          <ChevronLeft className="size-3.5" />
          Back
        </button>
        <header>
          <h2 className="display-tight text-[20px] font-semibold text-fg">
            {picked.name}
          </h2>
          <p className="mt-1 text-[13px] text-fg-tertiary">
            Enter your 4-digit PIN.
          </p>
        </header>

        {/* PIN display */}
        <div className="flex items-center justify-center gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={cn(
                "flex size-12 items-center justify-center rounded-[10px] border text-[24px] font-mono",
                pin.length > i
                  ? "border-primary bg-primary-soft/40 text-fg"
                  : "border-hairline bg-surface-1 text-fg-tertiary"
              )}
            >
              {pin.length > i ? "•" : ""}
            </div>
          ))}
        </div>
        {error && (
          <div className="rounded-[10px] border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-center text-[12px] text-status-danger">
            {error}
          </div>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => press(d)}
              className="h-14 rounded-[12px] border border-hairline bg-surface-1 text-[20px] font-medium text-fg transition-colors hover:bg-surface-2"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={clear}
            className="h-14 rounded-[12px] border border-hairline bg-surface-1 text-[12px] font-medium text-fg-subtle hover:bg-surface-2"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => press("0")}
            className="h-14 rounded-[12px] border border-hairline bg-surface-1 text-[20px] font-medium text-fg hover:bg-surface-2"
          >
            0
          </button>
          <button
            type="button"
            onClick={backspace}
            className="flex h-14 items-center justify-center rounded-[12px] border border-hairline bg-surface-1 text-fg-subtle hover:bg-surface-2"
            aria-label="Backspace"
          >
            <Delete className="size-5" />
          </button>
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={pin.length !== 4}
          className={cn(
            "block w-full rounded-[12px] py-3 text-[15px] font-medium transition-colors",
            pin.length === 4
              ? "bg-primary text-on-primary hover:bg-primary-hover"
              : "cursor-not-allowed bg-surface-3 text-fg-tertiary"
          )}
        >
          Submit
        </button>
      </div>
    );
  }

  // ── Step: done (success card) ──
  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-status-ok/15 text-status-ok">
        <Check className="size-8" />
      </div>
      <p className="text-[15px] font-medium text-fg">{resultMsg}</p>
      <button
        type="button"
        onClick={() => {
          setStep("pick");
          setPicked(null);
          setPin("");
          setResultMsg(null);
        }}
        className="text-[12px] text-fg-tertiary hover:text-fg"
      >
        Done
      </button>
    </div>
  );
}

function StaffRow({
  staff,
  onPick,
}: {
  staff: StaffMember;
  onPick: (s: StaffMember) => void;
}) {
  const active = useActiveTimeEntryForStaff(staff.id);
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(staff)}
        className="flex w-full items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 p-3 text-left transition-colors hover:bg-surface-2"
      >
        <Avatar className="size-10 shrink-0">
          <AvatarFallback>{initialsOf(staff.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-fg">{staff.name}</div>
          <div className="text-[12px] text-fg-tertiary">
            {staff.default_position ?? "Staff"}
            {active ? " · on the clock" : ""}
          </div>
        </div>
        {active && (
          <span className="inline-flex size-2 rounded-full bg-status-ok" aria-hidden />
        )}
      </button>
      {active && (
        <div className="mt-1 flex justify-end gap-2 px-2 text-[11px]">
          <button
            type="button"
            className="text-fg-tertiary hover:text-fg"
            onClick={(e) => {
              e.stopPropagation();
              if (active.paused_at) resumeTimeEntry(active.id);
              else pauseTimeEntry(active.id);
            }}
          >
            <Clock4 className="mr-0.5 inline-block size-3" />
            {active.paused_at ? "Resume" : "Pause for lunch"}
          </button>
        </div>
      )}
    </li>
  );
}
