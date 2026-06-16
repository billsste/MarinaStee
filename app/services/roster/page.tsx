import { Suspense } from "react";
import { RosterView } from "@/components/rentals/roster-view";

export const metadata = { title: "Slips — Marina Stee" };

// Agent prompt lives in app/services/layout.tsx.
//
// The slip roster is the SOLE content on this surface. The waitlist
// used to share this page above the roster, but operators with
// 800-slip marinas + 500-person waitlists need each surface to scroll
// independently — the waitlist now lives at /services/waitlist with
// its own 4-tab structure.
//
// RosterView calls useSearchParams() to support the agent's deep-link
// ?assign=<slipId> pattern. Next.js Turbopack prod build requires
// useSearchParams() consumers to sit inside a Suspense boundary so
// the page can stream static markup while the search params resolve.
// Wrapping here keeps the consumer code clean.
export default function SlipsRosterPage() {
  return (
    <Suspense fallback={null}>
      <RosterView />
    </Suspense>
  );
}
