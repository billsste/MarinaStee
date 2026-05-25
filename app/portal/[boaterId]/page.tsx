import { notFound } from "next/navigation";
import { getBoater } from "@/lib/mock-data";
import { PortalView } from "@/components/portal/portal-view";

type Props = { params: Promise<{ boaterId: string }> };

export async function generateMetadata({ params }: Props) {
  const { boaterId } = await params;
  const b = getBoater(boaterId);
  return { title: b ? `${b.first_name} — Marina Stee Portal` : "Portal — Marina Stee" };
}

export default async function PortalPage({ params }: Props) {
  const { boaterId } = await params;
  const boater = getBoater(boaterId);
  if (!boater) notFound();

  return <PortalView boaterId={boater.id} />;
}
