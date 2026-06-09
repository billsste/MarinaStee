import * as React from "react";
import { AssetDetailClient } from "./asset-detail-client";

type Props = { params: Promise<{ id: string }> };

export const metadata = { title: "Asset — Marina Stee" };

export default async function AssetDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <React.Suspense fallback={null}>
      <AssetDetailClient id={id} />
    </React.Suspense>
  );
}
