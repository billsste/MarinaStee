import { PageShell } from "@/components/page-shell";
import { CommTemplatesView } from "@/components/settings/comm-templates-view";

export const metadata = { title: "Comm Templates — Marina Stee Settings" };

export default function CommTemplatesPage() {
  return (
    <PageShell
      title="Comm Templates"
      description="Edit the copy of every system-generated message — receipts, contract sends, COI reminders, payment failures. Merge tokens fill at send time."
    >
      <CommTemplatesView />
    </PageShell>
  );
}
