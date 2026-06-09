import { PageShell } from "@/components/page-shell";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { ReportsView } from "@/components/reports/reports-view";

export const metadata = { title: "Reports — Marina Stee" };

export default function ReportsPage() {
  return (
    <PageShell
      title="Reports"
      description="Revenue, occupancy, and customer mix. Live from the same ledger that drives Notifications and QuickBooks sync."
      width="wide"
    >
      <RentalsAsk
        placeholder="Ask the agent — e.g. 'what's our MRR from the rental club?' or 'compare May revenue to last year'"
        suggestions={[
          "What's our MRR from the rental club?",
          "Compare May revenue to last year",
          "Which plan tier has the worst retention?",
          "Show me top 10 boaters by lifetime spend",
        ]}
      />

      <div className="mt-5">
        <ReportsView />
      </div>
    </PageShell>
  );
}
