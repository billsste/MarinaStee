"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/*
 * Wizard footer — Back / Exit / Continue. Back can be a button or a
 * Link (for routed steps). Continue shows a busy state during submit.
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
  busyLabel?: string;
}) {
  return (
    <div className="mt-6 flex items-center justify-between gap-4 border-t border-hairline pt-4">
      <div className="flex items-center gap-3">
        {stepIndex > 0 ? (
          backHref ? (
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
          )
        ) : (
          <Link
            href={exitHref}
            className="inline-flex items-center gap-1 rounded-[8px] px-3 py-1.5 text-[13px] text-fg-tertiary hover:text-fg"
          >
            Exit
          </Link>
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
  );
}
