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
 */
export default function RenewalsPage() {
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-[20px] font-medium text-fg">Annual renewal sweep</h2>
        <p className="mt-1 text-[12px] text-fg-subtle">
          Coordinate the fall renewal cycle as one workflow — pick a
          window, set rates, fan out renewal links, track acceptance %.
        </p>
      </header>
      <RenewalSweepCoordinator />
    </div>
  );
}
