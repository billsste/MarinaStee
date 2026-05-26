import { BOAT_RENTALS, RENTAL_BOATS, BOATERS, getBoatRentalByToken } from "@/lib/mock-data";
import { PickupExperience } from "@/components/pickup/pickup-experience";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props) {
  const { token } = await params;
  const r =
    getBoatRentalByToken(token) ??
    BOAT_RENTALS.find((x) => x.pickup_token === token);
  return {
    title: r ? `Complete pickup · ${r.number}` : "Boat Rentals — Marina Stee",
  };
}

/*
 * Public boat-rental pickup URL.
 *
 * Staff creates a booking in the /boat-rentals/book wizard → a
 * pickup_token is minted on the BoatRental, an outbound Communication
 * is dispatched with /pickup/[token] as the CTA. This is the URL the
 * customer lands on. Single sequential flow: Review → Sign agreement →
 * Add deposit card → Done.
 *
 * Mirrors /onboard/[token] for slip contracts.
 */
export default async function PickupPage({ params }: Props) {
  const { token } = await params;
  const rental = getBoatRentalByToken(token);
  if (!rental) {
    // For the demo we still render so client-store can re-resolve.
    return (
      <PickupExperience
        token={token}
        ssrRental={null}
        ssrBoat={null}
        ssrBoater={null}
      />
    );
  }
  const boat = RENTAL_BOATS.find((b) => b.id === rental.boat_id) ?? null;
  const boater = rental.boater_id
    ? (BOATERS.find((b) => b.id === rental.boater_id) ?? null)
    : null;
  return (
    <PickupExperience
      token={token}
      ssrRental={rental}
      ssrBoat={boat}
      ssrBoater={boater}
    />
  );
}
