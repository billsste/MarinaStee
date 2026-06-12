import { SlipTypesView } from "@/components/services/slip-types-view";

export const metadata = { title: "Slip Types — Marina Stee" };

/*
 * /services/slip-types — first-class SlipType entity per tenant.
 *
 * Combines (class × size band × pricing × included fees) so bumping
 * "Covered 30-40 ft" pricing for 2026 edits ONE row instead of N
 * slip records, and "covered tier auto-includes shore power" is
 * configurable.
 *
 * Each slip resolves to a type via Slip.type_id (explicit override)
 * or by deriving from (class + max_loa_inches). See
 * lib/slip-type-helpers.ts for the resolver + pricing inheritance.
 *
 * Layout (`app/services/layout.tsx`) provides the breadcrumb header
 * + left-rail sub-nav + agent prompt; this page only renders the
 * Slip Types content into the layout's right column.
 */
export default function SlipTypesPage() {
  return <SlipTypesView />;
}
