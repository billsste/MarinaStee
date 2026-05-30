import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { RosterView } from "@/components/rentals/roster-view";

export const metadata = { title: "Slips — Marina Stee Docks" };

/*
 * /slips/roster — the unified slip page.
 *
 * Previously split into Status (operational) + Layout (inventory) tabs.
 * Merged: the Roster table already shows everything operationally
 * important; the slip-edit pencil exposes inventory fields. Adding new
 * slips happens via the toolbar "+ Add slip" action. The dock filter
 * chips effectively give the per-dock grouping the Layout view used to
 * provide.
 */
export default function SlipsPage() {
  return (
    <div className="space-y-5">
      <RentalsAsk
        placeholder="Ask the roster — e.g. 'who expires in the next 60 days?' or 'draft 2027 renewals for D Dock'"
        suggestions={[
          "Expiring in the next 90 days",
          "Show me everyone on A Dock",
          "Vacant slips > 30 ft",
          "Lapsed contracts — who needs to renew?",
        ]}
      />
      <RosterView />
    </div>
  );
}
