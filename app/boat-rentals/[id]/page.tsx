import { notFound } from "next/navigation";
import { BOATERS, RENTAL_BOATS, getBoatRental } from "@/lib/mock-data";
import { BoatRentalDetail } from "@/components/boat-rentals/boat-rental-detail";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const r = getBoatRental(id);
  return { title: r ? `${r.number} — Boat Rentals` : "Boat Rentals — Marina Stee" };
}

export default async function BoatRentalDetailPage({ params }: Props) {
  const { id } = await params;
  const rental = getBoatRental(id);
  if (!rental) notFound();
  const boat = RENTAL_BOATS.find((b) => b.id === rental.boat_id) ?? null;
  const boater = rental.boater_id
    ? (BOATERS.find((b) => b.id === rental.boater_id) ?? null)
    : null;
  return (
    <BoatRentalDetail
      ssrRental={rental}
      ssrBoat={boat}
      ssrBoater={boater}
    />
  );
}
