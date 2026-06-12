import { PageShell } from "@/components/page-shell";
import { RentalsSubNav } from "@/components/rentals/rentals-sub-nav";
import { SlipTypesView } from "@/components/services/slip-types-view";

export const metadata = { title: "Slip Types — Marina Stee" };

/*
 * Services → Slip Types. First-class entity per tenant that combines
 * (class × size band × pricing × included fees) so:
 *   - bumping covered-slip pricing edits ONE row, not 30
 *   - "covered tier auto-includes shore power fee" is configurable
 *   - the waitlist segments by type without hard-coded labels
 *   - reports aggregate by class + tier natively
 *
 * Each slip resolves to a type via Slip.type_id (explicit override)
 * or by deriving from (class + max_loa_inches). See
 * lib/slip-type-helpers.ts.
 */
export default function SlipTypesPage() {
  return (
    <PageShell
      title="Slip Types"
      description="Combine class + size band + pricing + included fees in one place. Slips derive their tier from class + length, or you can pin a slip to a specific type."
      width="wide"
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_1fr]">
        <RentalsSubNav />
        <SlipTypesView />
      </div>
    </PageShell>
  );
}
