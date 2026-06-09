import { Suspense } from "react";
import { CustomizationView } from "@/components/settings/customization-view";

export const metadata = { title: "Picklists & Docks — Marina Stee Settings" };

export default function CustomizationPage() {
  return (
    <Suspense fallback={null}>
      <CustomizationView />
    </Suspense>
  );
}
