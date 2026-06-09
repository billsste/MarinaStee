import { redirect } from "next/navigation";

/*
 * Reservations consolidated into /bookings → Slip Reservations sub-tab.
 * This stub preserves old links and bookmarks.
 */
export default function ReservationsPage() {
  redirect("/bookings?tab=slips");
}
