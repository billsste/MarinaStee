import { PageShell } from "@/components/page-shell";
import { DocksView } from "@/components/settings/docks-view";

export const metadata = { title: "Docks — Marina Stee Settings" };

export default function DocksPage() {
  return (
    <PageShell
      title="Docks"
      description="Manage the docks at your marina. Each dock owns a set of slips; the prefix drives auto-generated slip ids."
    >
      <DocksView />
    </PageShell>
  );
}
