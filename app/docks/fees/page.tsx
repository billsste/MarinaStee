import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { FeesManager } from "@/components/rentals/fees-manager";

export const metadata = { title: "Additional Fees — Marina Stee Docks" };

export default function FeesPage() {
  return (
    <div className="space-y-5">
      <RentalsAsk
        placeholder="Apply, create, or analyze a fee — e.g. 'add a hoist fee to David Emmons next invoice'"
        suggestions={[
          "Add hoist fee to David Emmons",
          "Bulk-apply winterization to all annual boaters",
          "Add a new pump-out fee at $30",
        ]}
      />
      <FeesManager />
    </div>
  );
}
