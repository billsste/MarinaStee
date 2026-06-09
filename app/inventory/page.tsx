import * as React from "react";
import { InventoryClient } from "./inventory-client";

export const metadata = { title: "Inventory — Marina Stee" };

export default function InventoryPage() {
  return (
    <React.Suspense fallback={null}>
      <InventoryClient />
    </React.Suspense>
  );
}
