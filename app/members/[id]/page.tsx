import { HolderDetailClient } from "./holder-detail-client";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  // Title is best-effort; if the holder was created at runtime it won't
  // be in the seed yet and we fall back to a generic title.
  const { id } = await params;
  const { getBoater } = await import("@/lib/mock-data");
  const b = getBoater(id);
  return { title: b ? `${b.display_name} — Marina Stee` : "Holder — Marina Stee" };
}

export default async function HolderDetailPage({ params }: Props) {
  const { id } = await params;
  // Page body is a client component so it can resolve runtime-created
  // holders from the in-memory store. Server-rendering can only see the
  // seed array, which would 404 on freshly-minted ids.
  return <HolderDetailClient id={id} />;
}
