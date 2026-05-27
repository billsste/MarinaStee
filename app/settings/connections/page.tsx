import { PageShell } from "@/components/page-shell";
import { ConnectionsView } from "@/components/settings/connections-view";

export const metadata = { title: "Connections — Marina Stee Settings" };

export default function ConnectionsPage() {
  return (
    <PageShell
      title="Connections"
      description="Connect your payment processor, email + SMS providers, and accounting system. Credentials are stored encrypted in your tenant."
    >
      <ConnectionsView />
    </PageShell>
  );
}
