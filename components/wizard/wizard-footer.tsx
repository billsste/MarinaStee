"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/*
 * Wizard footer — Back / Exit / Continue. Back can be a button or a
 * Link (for routed steps). Continue shows a busy state during submit.
 *
 * Exit appears in two cases:
 *   - stepIdx === 0 (no Back) — replaces Back with an Exit affordance
 *   - onExit is set on any step — always-visible Exit alongside Back
 *
 * onExit takes priority over exitHref (used by modal-mode wizards that
 * need to fire a close callback instead of routing away).
 */
export function WizardFooter({
  stepIndex,
  totalSteps,
  stepLabel,
  onBack,
  backHref,
  onContinue,
  continueLabel = "Continue",
  continueDisabled = false,
  busy = false,
  exitHref = "/",
  onExit,
  secondaryAction,
  busyLabel = "Saving…",
}: {
  stepIndex: number;
  totalSteps: number;
  stepLabel: string;
  onBack?: () => void;
  backHref?: string;
  onContinue: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  busy?: boolean;
  exitHref?: string;
  /** When set, Exit becomes a button calling onExit instead of a routed
   *  link. Used by modal-mode wizards. */
  onExit?: () => void;
  /**
   * Optional opt-out / sibling-edit affordance — "Edit slip info
   * instead", "Open boater profile", etc. Renders as its own row
   * directly above the main Back/Step/Continue row, right-aligned,
   * with a hairline separator. The standardized slot for sibling-
   * edit shortcuts across every wizard.
   */
  secondaryAction?: React.ReactNode;
  busyLabel?: string;
}) {
  const exitNode = onExit ? (
    <button
      type="button"
      onClick={onExit}
      className="inline-flex items-center gap-1 rounded-[8px] px-3 py-1.5 text-[13px] text-fg-tertiary hover:text-fg"
    >
      Exit
    </button>
  ) : (
    <Link
      href={exitHref}
      className="inline-flex items-center gap-1 rounded-[8px] px-3 py-1.5 text-[13px] text-fg-tertiary hover:text-fg"
    >
      Exit
    </Link>
  );

  return (
    <div className="mt-6 border-t border-hairline pt-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {stepIndex > 0 ? (
          <>
            {backHref ? (
              <Link
                href={backHref}
                className="inline-flex items-center gap-1 rounded-[8px] px-3 py-1.5 text-[13px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
              >
                <ChevronLeft className="size-3.5" />
                Back
              </Link>
            ) : (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1 rounded-[8px] px-3 py-1.5 text-[13px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
              >
                <ChevronLeft className="size-3.5" />
                Back
              </button>
            )}
            {/* In modal-mode wizards we want Exit visible at every step,
                not just step 0. Page-mode wizards keep the old behavior
                (Exit only on step 0) unless they opt in via onExit. */}
            {onExit && exitNode}
          </>
        ) : (
          exitNode
        )}
      </div>

      <span className="text-[12px] text-fg-tertiary">
        Step {stepIndex + 1} of {totalSteps} — {stepLabel}
      </span>

      <Button
        variant="primary"
        size="md"
        onClick={onContinue}
        disabled={continueDisabled || busy}
      >
        {busy ? busyLabel : (
          <>
            {continueLabel}
            <ChevronRight className="size-3.5" />
          </>
        )}
      </Button>
      </div>
      {/* Secondary action row — opt-out / sibling-edit shortcut.
          Sits BELOW the main Back/Step/Continue row so it never
          competes with the primary action flow, but stays within
          the footer block. Right-aligned, muted text-link styling. */}
      {secondaryAction && (
        <div className="mt-3 flex justify-end">{secondaryAction}</div>
      )}
    </div>
  );
}
