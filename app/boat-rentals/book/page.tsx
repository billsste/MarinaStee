import { BookRentalClient } from "./book-rental-client";

export const metadata = { title: "New booking — Boat Rentals" };

/*
 * Boat-rental booking wizard. Mirrors the slip-assignment wizard:
 *   1. Boat       — pick a boat from the available fleet
 *   2. Customer   — existing annual holder OR walk-in patron info
 *   3. Time       — start/end + rate kind (hourly / half / full)
 *   4. Review     — summary + Draft + Send link CTA
 *
 * On submit: creates BoatRental, mints pickup_token, dispatches
 * outbound Communication to the customer with /pickup/[token] URL.
 */
export default function BookRentalPage({
  searchParams,
}: {
  searchParams: Promise<{ boatId?: string }>;
}) {
  return <BookRentalClient searchParamsPromise={searchParams} />;
}
