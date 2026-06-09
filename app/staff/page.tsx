import * as React from "react";
import { StaffClient } from "./staff-client";

export const metadata = { title: "Staff — Marina Stee" };

/*
 * /staff landing — server shell, same pattern as /members.
 * Suspense wraps the client tree because StaffClient reads
 * `?section=` via useSearchParams for deep-linking.
 */
export default function StaffPage() {
  return (
    <React.Suspense fallback={null}>
      <StaffClient />
    </React.Suspense>
  );
}
