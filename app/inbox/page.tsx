import { PageShell } from "@/components/page-shell";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { InboxView } from "@/components/inbox/inbox-view";

export const metadata = { title: "Inbox — Marina Stee" };

export default function InboxPage() {
  return (
    <PageShell
      title="Inbox"
      description="Every message in and out, across every boater. Triage with the agent — answer, escalate, or close."
      width="wide"
      hideHeader
    >
      <RentalsAsk
        placeholder="Ask the agent — e.g. 'reply to Peterson about the slip' or 'broadcast: pump-out closed Saturday'"
        suggestions={[
          "Reply to Peterson about the slip transfer",
          "Broadcast: pump-out closed Saturday",
          "Send a reactivation message to lapsed club members",
          "Which boaters haven't replied in 7 days?",
        ]}
      />

      <div className="mt-5">
        <InboxView />
      </div>
    </PageShell>
  );
}
