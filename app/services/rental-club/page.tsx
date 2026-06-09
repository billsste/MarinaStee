import { ClubCatalogManager } from "@/components/rentals/club-catalog-manager";

export const metadata = { title: "Rental Boats — Marina Stee" };

/*
 * Services → Rental Boats — unified fleet catalog. ONE table covers
 * the whole rental fleet, with a per-boat toggle for Boat Club rotation
 * vs. Transient-only.
 *
 * Plans (Basic / Plus / Premium) live on /services/rates as Rate rows
 * with occupancy_type="Rental Club". Day-to-day member ops live on
 * /members → Rental Club.
 */
export default function ServicesRentalClubPage() {
  return (
    <div className="space-y-5">
      <ClubCatalogManager />
    </div>
  );
}
