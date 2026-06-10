"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/*
 * Wizard progress — borrowed from HomeField Raise's pattern.
 * Two stacked rows: filled progress bars on top, labels underneath.
 * Already-visited steps are clickable (either as buttons that fire
 * onStepClick, or as <Link>s when the wizard is route-based).
 */

export type WizardStep = {
  id: string;
  label: string;
  href?: string; // present when this step lives on its own route
};

export function WizardProgress({
  steps,
  currentIdx,
  onStepClick,
  clickAny = false,
}: {
  steps: WizardStep[];
  currentIdx: number;
  onStepClick?: (idx: number) => void;
  /**
   * When true, every step (including future ones) is clickable.
   * Default behavior locks future steps until the operator reaches
   * them via Continue — appropriate for creation flows. Edit flows
   * should pass `clickAny` since the underlying record is already
   * valid and any section can be jumped to in any order.
   */
  clickAny?: boolean;
}) {
  return (
    <div className="space-y-2">
      {/* Filled bars */}
      <div className="flex gap-1.5">
        {steps.map((s, idx) => {
          const filled = idx <= currentIdx;
          return (
            <div
              key={s.id}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                filled ? "bg-primary" : "bg-surface-3"
              )}
            />
          );
        })}
      </div>

      {/* Labels */}
      <div className="flex gap-1.5">
        {steps.map((s, idx) => {
          const isCurrent = idx === currentIdx;
          const isVisited = idx < currentIdx;
          const isFuture = idx > currentIdx;
          // clickAny: edit-flow callers (data already valid) want any
          // step reachable. clickable = visited (always) OR future-and-
          // clickAny (edit mode).
          const clickable = isVisited || (clickAny && !isCurrent);
          // No `truncate` — labels wrap to a second line on narrow modals
          // instead of clipping with `…` (which produced "SCHEDULE & ESTIMA…"
          // on the 6-step work-order stepper). `leading-tight` keeps the
          // wrapped row from blowing out the header height.
          const baseCls = cn(
            "flex-1 text-[11px] uppercase leading-tight tracking-wide transition-colors break-words",
            isCurrent && "font-medium text-fg",
            clickable && !isCurrent && "text-fg-subtle hover:text-fg cursor-pointer",
            isFuture && !clickable && "text-fg-tertiary"
          );
          if (clickable && s.href) {
            return (
              <Link key={s.id} href={s.href} className={baseCls}>
                {s.label}
              </Link>
            );
          }
          if (clickable && onStepClick) {
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onStepClick(idx)}
                className={cn(baseCls, "text-left")}
              >
                {s.label}
              </button>
            );
          }
          return (
            <div key={s.id} className={baseCls}>
              {s.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
