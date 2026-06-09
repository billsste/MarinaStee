import * as React from "react";
import { AssetsClient } from "./assets-client";

export const metadata = { title: "Assets & Maintenance — Marina Stee" };

export default function AssetsPage() {
  return (
    <React.Suspense fallback={null}>
      <AssetsClient />
    </React.Suspense>
  );
}
