"use client";

import { PageShell } from "@/components/page-shell";
import { BulkRenewalWizard } from "@/components/contracts/bulk-renewal-wizard";

/*
 * Bulk renewal sweep — operator-side bulk-draft contracts surface.
 *
 * Lives under /members/bulk-renewals (not /services/contracts) because
 * members own the relationship and operators land here from the renewal
 * pipeline view. The existing BulkRenewalSheet is a one-shot dialog —
 * the wizard surface here is the persistent home for the action.
 */
export default function BulkRenewalsPage() {
  return (
    <PageShell
      title="Bulk renewal sweep"
      description="Draft renewal contracts for every active contract expiring within N days. Drafts land in status: draft; signing happens per-contract from the renewal pipeline."
      backHref="/members"
      backLabel="Back to Members"
    >
      <BulkRenewalWizard />
    </PageShell>
  );
}
