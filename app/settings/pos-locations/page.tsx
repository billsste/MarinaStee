import { PageShell } from "@/components/page-shell";
import { PosLocationsView } from "@/components/settings/locations-view";

export const metadata = { title: "POS Locations — Marina Stee Settings" };

export default function PosLocationsPage() {
  return (
    <PageShell
      title="POS Locations"
      description="Your registers — Fuel Dock, Ship Store, Restaurant, Harbormaster, or whatever you call them. Items in the Catalog map to these locations."
    >
      <PosLocationsView />
    </PageShell>
  );
}
