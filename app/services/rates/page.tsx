import { ServiceRatesView } from "@/components/services/service-rates-view";

export const metadata = { title: "Service rates — Marina Stee" };

/*
 * /services/rates — unified pricing surface.
 *
 * One page, two tabs:
 *   "Slip pricing" (default) — SlipType rows. The categorization
 *     (class + size band + amenities) + inline Annual / Monthly /
 *     Seasonal / Transient columns that auto-resolve from the
 *     underlying Rate rows.
 *   "Other rates" — non-slip rate rows: jet ski day/week, Rental Club
 *     plan tiers, per-tier setup fees, ad-hoc service rates.
 *
 * Replaces the prior split between /services/slip-types and
 * /services/rates. The Slip Types route has been retired; bookmarks
 * land on the Slip pricing tab here.
 *
 * Agent prompt + breadcrumb come from app/services/layout.tsx.
 */
export default function RatesPage() {
  return <ServiceRatesView />;
}
