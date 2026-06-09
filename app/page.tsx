import { AgentBrief } from "@/components/dashboard/agent-brief";
import { AgentHero } from "@/components/agent-hero";
import { LiveDock } from "@/components/dashboard/live-dock";
import { OnboardingBanner } from "@/components/dashboard/onboarding-banner";
import { QuietList } from "@/components/dashboard/quiet-list";

/*
 * Dashboard — agent-first.
 *
 *   1. AgentHero — centered narrow chat box + suggestion chips.
 *   2. AgentBrief — daily briefing panel at the dashboard width,
 *      aligned with the panels below for visual consistency.
 *   3. LiveDock + QuietList — two-column workspace below (2/3 + 1/3).
 *
 * Past activity → /inbox + /settings/audit-log.
 * Strategic dashboards → /reports.
 */
export default function DashboardPage() {
  return (
    <div className="pb-24">
      <AgentHero />
      <OnboardingBanner />

      <section className="mx-auto w-full max-w-[1240px] space-y-5 px-6 pb-10">
        <AgentBrief />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <LiveDock />
          </div>
          <div>
            <QuietList />
          </div>
        </div>
      </section>
    </div>
  );
}
