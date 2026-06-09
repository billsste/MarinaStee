import { RatesManager } from "@/components/rentals/rates-manager";

export const metadata = { title: "Service rates — Marina Stee Docks" };

/*
 * Service rates catalog. Annual slip pricing lives ON THE SLIP (each
 * slip carries default_annual_rate / default_monthly_rate /
 * default_seasonal_rate based on its class). This page covers everything
 * that ISN'T a slip lease: transient nightly, day-pass, jet ski hourly,
 * kayak day rentals, hoist services, winterization tiers, etc.
 *
 * Agent prompt lives in app/services/layout.tsx.
 */
export default function RatesPage() {
  return (
    <div className="space-y-5">
      <RatesManager />
    </div>
  );
}
