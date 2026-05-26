import { PageShell } from "@/components/page-shell";
import { BoatRentalsView } from "@/components/boat-rentals/boat-rentals-view";

export const metadata = { title: "Boat Rentals — Marina Stee" };

/*
 * Boat Rentals — the marina's own-fleet rental business. Distinct
 * from Slips (annual dockage leases) and Reservations (transient
 * slip bookings). Fleet of pontoons, kayaks, jet skis, paddleboards,
 * fishing skiffs rented hourly / half-day / full-day to walk-in
 * patrons or existing annual holders.
 *
 * Landing surface: KPI strip → fleet grid (boat cards w/ today's
 * booking status) → today's pickups + returns → recent bookings.
 */
export default function BoatRentalsPage() {
  return (
    <PageShell
      title="Boat Rentals"
      description="Marina-owned fleet — book it, send a link, customer signs + pays, dockhand hands over the keys. Same flow whether they're a walk-in or one of your annual holders."
      width="wide"
    >
      <BoatRentalsView />
    </PageShell>
  );
}
