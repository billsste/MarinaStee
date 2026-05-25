import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { RatesManager } from "@/components/rentals/rates-manager";

export const metadata = { title: "Rates — Marina Stee Rentals" };

export default function RatesPage() {
  return (
    <div className="space-y-5">
      <RentalsAsk
        placeholder="Ask about rates — e.g. 'raise all annual rates 5% for 2027'"
        suggestions={[
          "Raise all annual rates 5% for 2027",
          "Compare jet ski rates vs last year",
          "Add a winter discount for buoys",
        ]}
      />
      <RatesManager />
    </div>
  );
}
