import { Info } from "lucide-react";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { RatesManager } from "@/components/rentals/rates-manager";

export const metadata = { title: "Service rates — Marina Stee Docks" };

/*
 * Service rates catalog. Annual slip pricing lives ON THE SLIP (each
 * slip carries default_annual_rate / default_monthly_rate /
 * default_seasonal_rate based on its class — covered, uncovered,
 * T-head, buoy, dry storage). This page covers everything that ISN'T
 * a slip lease: transient nightly, day-pass, jet ski hourly, kayak
 * day rentals, hoist services, winterization tiers, etc.
 */
export default function RatesPage() {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-[12px] border border-status-info/30 bg-status-info/[0.05] px-4 py-3 text-[12px] leading-relaxed text-fg-subtle">
        <Info className="mt-0.5 size-4 shrink-0 text-status-info" />
        <div>
          <strong className="text-fg">Service rates only.</strong>{" "}
          Annual slip leases price from the slip itself (each slip has a class
          + default annual rate). Use this page for transient nightly,
          day-passes, hourly rentals, hoist + winterization tiers, and any
          one-off rate cards that don't ride on a specific slip.
        </div>
      </div>
      <RentalsAsk
        placeholder="Ask about service rates — e.g. 'add a $35 jet-ski cleaning fee'"
        suggestions={[
          "Add a winterization tier — $450",
          "Bump transient nightly rates 8% for next season",
          "Show jet ski + kayak hourly rates",
        ]}
      />
      <RatesManager />
    </div>
  );
}
