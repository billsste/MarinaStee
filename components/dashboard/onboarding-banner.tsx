"use client";

import Link from "next/link";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { dismissOnboarding, useAiSettings } from "@/lib/client-store";

/*
 * Dashboard onboarding banner.
 *
 * Surfaces while the tenant is still mid-setup. Shows progress
 * (N / 10 done) and a CTA into /onboarding. Dismissible — clicking
 * the × flips `onboarding_dismissed` so the banner doesn't reappear,
 * even if the tenant hasn't finished. The /onboarding page is still
 * reachable from the sidebar.
 *
 * Hides automatically when 9+ steps are done OR the tenant dismisses
 * it — whichever comes first.
 */
const TOTAL_STEPS = 10;
const SHOW_THRESHOLD = 9; // hide when this many or more are done

export function OnboardingBanner() {
  const ai = useAiSettings();
  const completed = ai.onboarding_completed_steps.length;
  if (ai.onboarding_dismissed) return null;
  if (completed >= SHOW_THRESHOLD) return null;

  const pct = Math.round((completed / TOTAL_STEPS) * 100);
  const remaining = TOTAL_STEPS - completed;

  return (
    <div className="mx-auto mt-4 w-full max-w-[1240px] px-6">
      <div className="flex items-center gap-3 rounded-[12px] border border-primary/30 bg-primary/[0.04] px-4 py-3">
        <div className="rounded-full bg-primary/15 p-2 text-primary">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-[13px] font-semibold text-fg">
              Finish setting up Marina Stee
            </div>
            <div className="text-[11px] text-fg-subtle">
              {completed} of {TOTAL_STEPS} done
            </div>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 text-[11px] text-fg-subtle">
            {remaining} step{remaining === 1 ? "" : "s"} to unlock the rest of the AI workflow.
          </div>
        </div>
        <Link
          href="/onboarding"
          className="inline-flex shrink-0 items-center gap-1 rounded-[8px] bg-primary px-3 py-1.5 text-[12px] font-medium text-on-primary hover:bg-primary-hover"
        >
          Resume <ArrowRight className="size-3" />
        </Link>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => dismissOnboarding()}
          className="shrink-0 rounded-[6px] p-1 text-fg-tertiary hover:bg-surface-2 hover:text-fg"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
