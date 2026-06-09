import { Suspense } from "react";
import { WaitlistSection } from "@/components/services/waitlist-section";

export const metadata = { title: "Slip Waitlist — Marina Stee" };

/*
 * /services/waitlist — dedicated operator surface for the slip
 * waitlist. Hosts the 4-tab structure (Queue / Offers / Stale /
 * Archive) plus the filter bar + bulk actions.
 *
 * Split out of /services/roster so the slip roster table doesn't have
 * to share scroll real estate with the waitlist tabs — operators
 * managing 800 slips + 500 waitlisters need to navigate to each
 * surface independently.
 *
 * Agent prompt + breadcrumb header live in the parent layout.
 *
 * Suspense wrapper: WaitlistSection → useTabUrlState → useSearchParams,
 * which Next 16's static prerender refuses to render without a
 * Suspense boundary. The wrapper opts the section into client-side
 * hydration on first paint — operator-only surface, no SEO loss.
 */
export default function SlipWaitlistPage() {
  return (
    <Suspense fallback={null}>
      <WaitlistSection />
    </Suspense>
  );
}
