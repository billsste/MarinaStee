import { Suspense } from "react";
import { PageShell } from "@/components/page-shell";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { WoKanban } from "@/components/work-orders/wo-kanban";
import { WORK_ORDERS } from "@/lib/mock-data";

export const metadata = { title: "Work Orders — Marina Stee" };

export default function WorkOrdersPage() {
  return (
    <PageShell
      title="Work Orders"
      description="Service jobs across every boater, vessel, and slip. Drag to update status — or ask the agent to handle it."
      width="wide"
    >
      <div className="mb-5">
        <RentalsAsk
          placeholder="Ask the agent — e.g. 'open a winterize WO for the Bayliner' or 'what's urgent today?'"
          suggestions={[
            "What urgent work orders are open?",
            "Open a winterize WO for the Bayliner",
            "Reassign overdue WOs to the next available tech",
            "Close out completed work older than 7 days",
          ]}
        />
      </div>
      {/* WoKanban reads ?tab= via useSearchParams — Suspense lets the
          static prerender skip past it and hydrate client-side. */}
      <Suspense fallback={null}>
        <WoKanban initial={WORK_ORDERS} />
      </Suspense>
    </PageShell>
  );
}
