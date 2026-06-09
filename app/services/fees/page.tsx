import { FeesManager } from "@/components/rentals/fees-manager";

export const metadata = { title: "Additional Fees — Marina Stee Docks" };

// Agent prompt lives in app/services/layout.tsx so it spans the full width
// above the rail + content split. Each sub-page just renders its
// tabular surface.
export default function FeesPage() {
  return <FeesManager />;
}
