import * as React from "react";
import { VendorDetailClient } from "./vendor-detail-client";

type Props = { params: Promise<{ id: string }> };

export const metadata = { title: "Vendor — Marina Stee" };

export default async function VendorDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <React.Suspense fallback={null}>
      <VendorDetailClient id={id} />
    </React.Suspense>
  );
}
