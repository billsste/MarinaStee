import { PageShell } from "@/components/page-shell";
import { ReportsView } from "@/components/reports/reports-view";

export const metadata = { title: "Reports — Marina Stee" };

export default function ReportsPage() {
  return (
    <PageShell
      title="Reports"
      description="Revenue, occupancy, and customer mix. Live from the same ledger that drives Notifications and QuickBooks sync."
    >
      <ReportsView />
    </PageShell>
  );
}
