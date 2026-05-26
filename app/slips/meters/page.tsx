import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { MetersManager } from "@/components/rentals/meters-manager";

export const metadata = { title: "Meter Readings — Marina Stee Docks" };

export default function MetersPage() {
  return (
    <div className="space-y-5">
      <RentalsAsk
        placeholder="Ask about meters — e.g. 'generate utility charges for May readings'"
        suggestions={[
          "Generate utility charges for May",
          "Why is pedestal A04 high?",
          "Schedule a meter walk for Damsite C",
        ]}
      />
      <MetersManager />
    </div>
  );
}
