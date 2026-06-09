import * as React from "react";
import { StaffDetailClient } from "./staff-detail-client";

type Props = { params: Promise<{ id: string }> };

export const metadata = { title: "Staff member — Marina Stee" };

export default async function StaffDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <React.Suspense fallback={null}>
      <StaffDetailClient id={id} />
    </React.Suspense>
  );
}
