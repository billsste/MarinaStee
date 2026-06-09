import * as React from "react";
import { BookingsClient } from "./bookings-client";

export const metadata = { title: "Bookings — Marina Stee" };

/*
 * /bookings landing — server shell. Header + sidebar nav + section
 * switching live in the client component (same pattern as /members,
 * /services, /settings, /ledger, /vendors, /staff, /assets,
 * /inventory). Suspense boundary is required because BookingsClient
 * reads `?tab=` via useSearchParams.
 */
export default function BookingsPage() {
  return (
    <React.Suspense fallback={null}>
      <BookingsClient />
    </React.Suspense>
  );
}
