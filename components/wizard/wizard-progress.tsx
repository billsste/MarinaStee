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
}: {
  steps: WizardStep[];
  currentIdx: number;
  onStepClick?: (idx: number) => void;
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
          const baseCls = cn(
            "flex-1 truncate text-[11px] uppercase tracking-wide transition-colors",
            isCurrent && "font-medium text-fg",
            isVisited && "text-fg-subtle hover:text-fg cursor-pointer",
            isFuture && "text-fg-tertiary"
          );
          if (isVisited && s.href) {
            return (
              <Link key={s.id} href={s.href} className={baseCls}>
                {s.label}
              </Link>
            );
          }
          if (isVisited && onStepClick) {
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
