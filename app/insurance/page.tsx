import * as React from "react";
import { PageShell } from "@/components/page-shell";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { InsuranceView } from "@/components/insurance/insurance-view";

export const metadata = { title: "Insurance / COIs — Marina Stee" };

export default function InsurancePage() {
  return (
    <PageShell
      title="Insurance / COIs"
      description="Certificates of Insurance for every holder. Lapsed coverage is a liability — chase renewals before policies expire."
      width="wide"
    >
      <RentalsAsk
        placeholder="Ask the agent — e.g. 'send renewal reminders for COIs expiring in 30 days' or 'log Emmons's new State Farm COI'"
        suggestions={[
          "Send renewal reminders for COIs expiring in 30 days",
          "Which vessels have no COI on file?",
          "Log a new COI for Emmons",
          "Show me expired certificates from last year",
        ]}
      />

      <div className="mt-5">
        {/* Suspense boundary required by Next 16 for static prerender
            of any client component that reads useSearchParams — see
            https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout */}
        <React.Suspense fallback={null}>
          <InsuranceView />
        </React.Suspense>
      </div>
    </PageShell>
  );
}
