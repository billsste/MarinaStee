"use client";

import * as React from "react";
import { WizardProgress, type WizardStep } from "@/components/wizard/wizard-progress";

/*
 * Shared wizard shell. Centered card layout with header (eyebrow + title +
 * subtitle), progress bars, and a content slot. The footer is rendered by
 * the consuming step page so it can manage busy / disabled state inline.
 *
 * Designed to be reused across multiple workflows: slip assignment, new
 * holder onboarding, work-order intake, etc.
 */
export function WizardShell({
  eyebrow,
  title,
  subtitle,
  steps,
  currentIdx,
  onStepClick,
  children,
  rightRail,
}: {
  /** Small label above the title, e.g. "ASSIGN SLIP A01" */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  steps: WizardStep[];
  currentIdx: number;
  onStepClick?: (idx: number) => void;
  children: React.ReactNode;
  /** Optional right-rail content (agent affordance, contextual help). */
  rightRail?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[920px] px-5 py-8">
      <div className="rounded-[14px] border border-hairline bg-surface-1 shadow-sm">
        {/* Header */}
        <div className="border-b border-hairline px-6 py-5">
          {eyebrow && (
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
              {eyebrow}
            </div>
          )}
          <h1 className="display-tight text-[22px] font-semibold text-fg">{title}</h1>
          {subtitle && (
            <p className="mt-1 max-w-2xl text-[13px] text-fg-subtle">{subtitle}</p>
          )}
        </div>

        {/* Progress */}
        <div className="border-b border-hairline px-6 py-4">
          <WizardProgress steps={steps} currentIdx={currentIdx} onStepClick={onStepClick} />
        </div>

        {/* Body — optionally split into content + right rail */}
        <div className={rightRail ? "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]" : ""}>
          <div className="px-6 py-6">{children}</div>
          {rightRail && (
            <aside className="border-l border-hairline bg-surface-2 px-5 py-6">
              {rightRail}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
