import { PageShell } from "@/components/page-shell";
import { BoaterList } from "@/components/boaters/boater-list";

export const metadata = { title: "Holders — Marina Stee" };

export default function BoatersPage() {
  return (
    <PageShell
      title="Holders"
      description="Slip holders, transients, and house-charge accounts. Ask the agent, click a row, or hit + New boater."
    >
      <BoaterList />
    </PageShell>
  );
}
