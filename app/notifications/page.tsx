import { PageShell } from "@/components/page-shell";
import { NotificationsView } from "@/components/notifications/notifications-view";

export const metadata = { title: "Notifications — Marina Stee" };

export default function NotificationsPage() {
  return (
    <PageShell
      title="Notifications"
      description="Everything that needs your attention — overdue invoices, meter anomalies, expiring contracts, low fuel, urgent jobs, unanswered messages. Ask the agent to triage."
      width="wide"
    >
      <NotificationsView />
    </PageShell>
  );
}
