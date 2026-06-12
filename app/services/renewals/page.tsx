import { RenewalSweepCoordinator } from "@/components/contracts/renewal-sweep-coordinator";

export const metadata = { title: "Renewals — Marina Stee" };

/*
 * Renewal Sweep Coordinator page.
 *
 * The deliberate-operator-workflow surface for the annual renewal cycle.
 * Distinct from /services/contracts → Renewal pipeline (which is the
 * fall-cycle dashboard showing every contract by stage). This page owns
 * the long-lived sweep entity that ties N contracts together as a
 * coordinated batch with priority + rate adjustment + per-item
 * acceptance tracking.
 *
 * No <h2> + description block above the content — the layout breadcrumb
 * already identifies the page (per CLAUDE.md §"List-page UX consistency"
 * rule #10). Any prose the operator needs lives inside the coordinator
 * itself, in context.
 */
export default function RenewalsPage() {
  return (
    <div className="space-y-4">
      <RenewalSweepCoordinator />
    </div>
  );
}
