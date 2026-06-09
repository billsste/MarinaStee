import * as React from "react";
import { VendorsClient } from "./vendors-client";

export const metadata = { title: "Vendors — Marina Stee" };

export default function VendorsPage() {
  return (
    <React.Suspense fallback={null}>
      <VendorsClient />
    </React.Suspense>
  );
}
