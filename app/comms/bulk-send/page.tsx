"use client";

import { PageShell } from "@/components/page-shell";
import { BulkSendWizard } from "@/components/comms/bulk-send-wizard";

/*
 * Bulk comm send — pick a template + a filter, preview the merged
 * tokens for the first 3 recipients, confirm to dispatch N comms.
 *
 * Lives under /comms/bulk-send rather than folding into /inbox because
 * /inbox is read-focused (incoming + threading) and this is an outbound
 * authoring tool. Cross-link from /inbox header → "Broadcast" CTA can
 * point here in a follow-up.
 */
export default function BulkCommSendPage() {
  return (
    <PageShell
      title="Bulk comm send"
      description="Pick a template + an audience filter. Preview the merged-token output, then dispatch one comm per recipient."
      backHref="/inbox"
      backLabel="Back to Inbox"
    >
      <BulkSendWizard />
    </PageShell>
  );
}
