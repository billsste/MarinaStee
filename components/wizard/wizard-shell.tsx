"use client";

import * as React from "react";
import { X } from "lucide-react";
import { WizardProgress, type WizardStep } from "@/components/wizard/wizard-progress";

/*
 * Shared wizard shell. Centered card layout with header (eyebrow + title +
 * subtitle), progress bars, and a content slot. The footer is rendered by
 * the consuming step page so it can manage busy / disabled state inline.
 *
 * Designed to be reused across multiple workflows: slip assignment, new
 * holder onboarding, work-order intake, etc.
 *
 * Two chrome modes:
 *   - "page"  (default) — inline, lives inside a route. Used by routed
 *               wizards like /services/[id]/assign.
 *   - "modal" — fixed-inset overlay with a dimmed backdrop and an X close
 *               button. Used by wizards launched from anywhere in the app
 *               (e.g. ReservationWizard from /bookings).
 */
export function WizardShell({
  eyebrow,
  title,
  subtitle,
  steps,
  currentIdx,
  onStepClick,
  stepsClickAny = false,
  children,
  rightRail,
  railTone = "default",
  headerAction,
  chrome = "page",
  onExit,
}: {
  /** Small label above the title, e.g. "ASSIGN SLIP A01" */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Progress steps. Omit to render a flat single-form mode without
   *  the progress bar — e.g. when the same shell hosts both a wizard
   *  flow and a single-form edit flow under one modal. */
  steps?: WizardStep[];
  currentIdx?: number;
  onStepClick?: (idx: number) => void;
  /** Pass true for edit flows so the stepper allows free navigation
   *  to any step (forward + backward), not just visited ones. */
  stepsClickAny?: boolean;
  children: React.ReactNode;
  /** Optional right-rail content (agent affordance, contextual help). */
  rightRail?: React.ReactNode;
  /**
   * Optional header action — renders in the top-right of the header,
   * just to the left of the close X. Use for mode-swap shortcuts
   * ("Edit slip info instead", "Back to assign holder", etc.) that
   * need to be immediately visible without scrolling to a footer.
   */
  headerAction?: React.ReactNode;
  /**
   * Rail visual treatment. "default" applies the grey bg + left
   * border — used for assign-mode wizards where the rail carries
   * contextual content. "minimal" drops the grey + border so the
   * rail column reserves space without looking like a sidebar —
   * used when a wizard hosts both an assign mode (with rail) and
   * an edit mode (no rail), so toggling between them keeps modal
   * dimensions locked without showing an empty grey panel.
   */
  railTone?: "default" | "minimal";
  /** "page" (default) renders inline; "modal" wraps the shell in a fixed
   *  overlay with backdrop + close affordance. */
  chrome?: "modal" | "page";
  /** Called when the operator dismisses a modal-mode wizard (X button or
   *  backdrop click). Required for chrome="modal" — ignored otherwise. */
  onExit?: () => void;
}) {
  const card = (
    <div className="rounded-[14px] border border-hairline bg-surface-1 shadow-sm">
      {/* Header */}
      <div className="relative border-b border-hairline px-6 py-5">
        {eyebrow && (
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
            {eyebrow}
          </div>
        )}
        <h1 className="display-tight text-[22px] font-semibold text-fg">{title}</h1>
        {subtitle && (
          <p className="mt-1 max-w-2xl text-[13px] text-fg-subtle">{subtitle}</p>
        )}
        {/* Header action + close — pinned to the top-right of the
            header. headerAction sits to the left of the X so the
            close affordance always anchors the corner. */}
        <div className="absolute right-4 top-4 flex items-center gap-2">
          {headerAction}
          {chrome === "modal" && onExit && (
            <button
              type="button"
              onClick={onExit}
              aria-label="Close"
              className="flex size-8 items-center justify-center rounded-full border border-hairline bg-surface-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Progress — only rendered when the shell hosts a wizard flow.
          Flat single-form mode (edit dialogs) skips this band. */}
      {steps && typeof currentIdx === "number" && (
        <div className="border-b border-hairline px-6 py-4">
          <WizardProgress
            steps={steps}
            currentIdx={currentIdx}
            onStepClick={onStepClick}
            clickAny={stepsClickAny}
          />
        </div>
      )}

      {/* Body — content-driven height with a small floor. The form
          column renders top-aligned so the footer sits right under
          the fields (no justify-between pushing it to the bottom of
          an arbitrary fixed-height box, which left whitespace below
          the form on short steps). Each mode hugs its content
          naturally. The outer modal wrapper caps at max-h-[90vh]
          with overflow-y-auto for very-tall edge cases. */}
      <div
        className={
          rightRail
            ? "grid min-h-[280px] grid-cols-1 items-stretch lg:grid-cols-[minmax(0,1fr)_280px]"
            : "min-h-[280px]"
        }
      >
        <div className="px-6 py-4">{children}</div>
        {rightRail && (
          // h-full + self-stretch defensively force the aside to fill
          // its grid cell, so the grey bg always extends to match the
          // taller of (form, right-rail) — the form column tends to
          // grow once the secondary action row + footer land below
          // the fields, and we don't want the grey to stop short.
          <aside
            className={
              railTone === "minimal"
                ? "h-full self-stretch px-5 py-6"
                : "h-full self-stretch border-l border-hairline bg-surface-2 px-5 py-6"
            }
          >
            {rightRail}
          </aside>
        )}
      </div>
    </div>
  );

  if (chrome === "modal") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget && onExit) onExit();
        }}
      >
        {/* Outer wrapper provides max-w/max-h + scroll + shadow only.
            No bg or border — the card supplies its own. Matching the
            card's rounded radius keeps the corners seamless (previously
            the outer used rounded-[16px] + bg-canvas, peeking through
            past the card's rounded-[14px] edges and leaving a visible
            grey seam in the bottom-right). */}
        <div className="max-h-[90vh] w-full max-w-[820px] overflow-y-auto rounded-[14px] shadow-2xl">
          {card}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[920px] px-5 py-8">
      {card}
    </div>
  );
}
