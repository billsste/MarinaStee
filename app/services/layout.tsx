import { RentalsSubNav } from "@/components/rentals/rentals-sub-nav";
import { RentalsAsk } from "@/components/rentals/rentals-ask";

/*
 * Services layout.
 *
 * Shape: title at top, then a 2-column grid: [rail | (agent + content)].
 *
 * The agent sits INSIDE the content column (not above the grid) so the
 * agent box visually pairs with the content area. Earlier draft had
 * the agent full-width above the grid, which made it span over the
 * rail and feel off-aligned. Now agent + content stack as one block,
 * rail sits beside both.
 */
export default function ServicesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 pt-6 pb-32">
      <header className="mb-6">
        <h1 className="display-tight text-[26px] font-semibold text-fg">Services</h1>
        <p className="mt-1 text-[13px] text-fg-subtle">
          Slips, rental club, rates, fees, gas, meters, contracts — everything the marina sells.
        </p>
      </header>

      <div
        className="grid gap-6"
        style={{ gridTemplateColumns: "200px minmax(0, 1fr)" }}
      >
        <RentalsSubNav />

        <div className="min-w-0 space-y-5">
          <RentalsAsk
            placeholder="Ask about slips, rental club, rates, fees, fuel, meters, contracts — e.g. 'who has the largest open balance?' or 'add a $30 pump-out fee'"
            suggestions={[
              "Who has the largest open balance?",
              "Add a $30 pump-out fee on POS",
              "Bump the winterization fee to $475",
              "Which contracts expire in October?",
            ]}
          />
          {children}
        </div>
      </div>
    </div>
  );
}
