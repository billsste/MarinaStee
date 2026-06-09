import { ReservationDetail } from "@/components/reservations/reservation-detail";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: `Reservation ${id} — Marina Stee` };
}

/*
 * Per-reservation detail page. Mirrors the work-order / contract /
 * boat-rental detail pattern: identity bar at top, then a linked-
 * entities rail showing the full connection layer (boater, vessel,
 * slip, contract, insurance, ledger, comms, work orders touching
 * the vessel during the stay).
 */
export default async function ReservationDetailPage({ params }: Props) {
  const { id } = await params;
  return <ReservationDetail reservationId={id} />;
}
