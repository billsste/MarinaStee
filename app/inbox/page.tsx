import { PageShell } from "@/components/page-shell";
import { InboxView } from "@/components/inbox/inbox-view";

export const metadata = { title: "Inbox — Marina Stee" };

export default function InboxPage() {
  return (
    <PageShell
      title="Inbox"
      description="Every message in and out, across every boater. Triage with the agent — answer, escalate, or close."
      width="wide"
    >
      <InboxView />
    </PageShell>
  );
}
