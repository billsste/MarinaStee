import { MetersManager } from "@/components/rentals/meters-manager";

export const metadata = { title: "Meter Readings — Marina Stee Docks" };

// Agent prompt lives in app/services/layout.tsx.
export default function MetersPage() {
  return <MetersManager />;
}
