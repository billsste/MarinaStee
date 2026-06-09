import { PageShell } from "@/components/page-shell";
import { SupportQueueTable } from "@/components/support/support-queue-table";

export const metadata = { title: "Support — Marina Stee" };

/*
 * Operator-facing support queue.
 *
 * Per the Marina Stee carve-out in CLAUDE.md §5, tickets stay in
 * Marina Stee's own backend (Convex `supportTickets` table scoped by
 * tenantId). One marina's queue is invisible to another — the
 * `useSupportTicketsForTenant` hook does the tenant filter.
 *
 * v1 is intentionally minimal: a filtered queue + click-into modal.
 * Bulk actions, SLA timers, assignment, and saved views all land in
 * the follow-on once the surface earns its keep.
 */
export default function SupportPage() {
  return (
    <PageShell
      title="Support tickets"
      description="Boater tickets from this marina. Click a row to reply, change status, or mark resolved. One marina's queue stays invisible to every other tenant."
      width="wide"
    >
      <SupportQueueTable />
    </PageShell>
  );
}
