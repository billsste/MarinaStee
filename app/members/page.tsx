import * as React from "react";
import { MembersClient } from "./members-client";

export const metadata = { title: "Members — Marina Stee" };

/*
 * /members landing — server shell. The actual section switching (All
 * members ↔ Rental Club) lives in the client component so we can keep
 * the URL stable and avoid an extra route hop. Same pattern as
 * /settings + /ledger + /services.
 *
 * Suspense boundary wraps the client tree because MembersClient reads
 * `?tab=` via useSearchParams — Next 16 requires it for static prerender.
 */
export default function MembersPage() {
  return (
    <React.Suspense fallback={null}>
      <MembersClient />
    </React.Suspense>
  );
}
