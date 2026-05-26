import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AgentHero } from "@/components/agent-hero";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { KpiStrip } from "@/components/dashboard/kpi-strip";
import { WORK_ORDERS } from "@/lib/mock-data";

export default function DashboardPage() {
  // Open work orders count (static; WO list isn't store-backed yet)
  const openWO = WORK_ORDERS.filter((w) =>
    ["open", "scheduled", "in_progress", "blocked"].includes(w.status)
  ).length;
  const urgentWO = WORK_ORDERS.filter((w) => w.priority === "urgent" || w.flagged).length;

  return (
    <div className="pb-24">
      <AgentHero />

      <section className="mx-auto w-full max-w-[1080px] px-6 pb-10">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-[15px] font-medium text-fg">Today at a glance</h2>
            <p className="text-[12px] text-fg-subtle">
              Operational snapshot — point-and-click as a fallback to the agent.
            </p>
          </div>
        </div>

        <KpiStrip />

        <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Panel title="Recent activity" className="lg:col-span-2" href="/work-orders">
            <ActivityFeed />
          </Panel>
          <Panel title="Open work orders" href="/work-orders">
            <div className="space-y-3">
              <KpiInline label="Open / scheduled / in-progress" value={`${openWO}`} />
              <KpiInline label="Flagged or urgent" value={`${urgentWO}`} tone={urgentWO > 0 ? "warn" : "ok"} />
              <div className="border-t border-hairline pt-3">
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-fg-tertiary">
                  Quick actions
                </div>
                <div className="flex flex-col gap-1.5">
                  <QuickAction label="Open the slip roster" href="/docks/slips" />
                  <QuickAction label="Run the renewal pipeline" href="/docks/contracts" />
                  <QuickAction label="Generate annual invoices" href="/ledger" />
                  <QuickAction label="See contracts expiring in 90 days" href="/reports" />
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </section>
    </div>
  );
}

function Panel({
  title,
  className,
  children,
  href,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
  href?: string;
}) {
  return (
    <div
      className={`rounded-[12px] border border-hairline bg-surface-1 ${className ?? ""}`}
    >
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="text-[13px] font-medium text-fg">{title}</h3>
        {href && (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Open <ArrowRight className="size-3" />
          </Link>
        )}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function KpiInline({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "neutral";
}) {
  const valueTone = tone === "warn" ? "text-status-warn" : "text-fg";
  return (
    <div className="flex items-center justify-between rounded-[8px] border border-hairline bg-surface-2 px-3 py-2">
      <span className="text-[12px] text-fg-muted">{label}</span>
      <span className={"text-[16px] font-semibold tracking-tight " + valueTone}>{value}</span>
    </div>
  );
}

function QuickAction({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-[8px] border border-hairline bg-surface-1 px-3 py-2 text-left text-[13px] text-fg-muted transition-colors hover:border-hairline-strong hover:bg-surface-2 hover:text-fg"
    >
      {label}
    </Link>
  );
}
