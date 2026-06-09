import { redirect } from "next/navigation";

/*
 * Boat Rentals consolidated into /bookings → Fleet Bookings sub-tab.
 * The per-boat detail surface and the booking wizard still live at
 * /boat-rentals/[id] and /boat-rentals/book — only the landing list
 * moved.
 */
export default function BoatRentalsPage() {
  redirect("/bookings?tab=fleet");
}
