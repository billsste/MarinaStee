"use client";

import { PageShell } from "@/components/page-shell";
import { BulkRunWizard } from "@/components/billing/bulk-run-wizard";

/*
 * Bulk billing run — operator-side bulk charge surface.
 *
 * Lives under /billing/bulk-run rather than folding into /ledger?tab=billing
 * because the wizard step-flow needs vertical breathing room and the
 * existing BillingRuns surface is single-page (all controls visible at
 * once). Cross-link from /ledger?tab=billing → "Use the wizard" CTA in
 * a follow-up if operators ask for it.
 */
export default function BulkBillingRunPage() {
  return (
    <PageShell
      title="Bulk billing run"
      description="Pick a period and rule. Preview the candidate charges. Confirm to post N invoices + dispatch one comm per boater in a single atomic-feeling run."
      backHref="/ledger"
      backLabel="Back to Ledger / POS"
    >
      <BulkRunWizard />
    </PageShell>
  );
}
