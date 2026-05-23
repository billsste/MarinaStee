import { PageShell } from "@/components/page-shell";
import { WoKanban } from "@/components/work-orders/wo-kanban";
import { WORK_ORDERS } from "@/lib/mock-data";

export const metadata = { title: "Work Orders — Marina Stee" };

export default function WorkOrdersPage() {
  return (
    <PageShell
      title="Work Orders"
      description="Service jobs across every boater, vessel, and slip. Drag to update status — or ask the agent to handle it."
    >
      <WoKanban initial={WORK_ORDERS} />
    </PageShell>
  );
}
