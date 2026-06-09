import { BOATERS, SLIPS, WAITLIST } from "@/lib/mock-data";
import { WaitlistOfferExperience } from "@/components/services/waitlist-offer-experience";

type Props = { params: Promise<{ token: string }> };

/*
 * Public landing for an auto-offer cascade recipient.
 *
 * URL: /apply/waitlist/[offer_token]
 *
 * SSR resolves the entry from the WAITLIST seed (a freshly-fired offer
 * lives only in the client store; the client component re-resolves
 * once mounted to catch the in-session case). Validates token + expiry
 * before rendering accept/decline; expired tokens render a "this
 * offer has expired" state with a note pointing them back to the
 * waitlist.
 *
 * This page intentionally NEVER reads more than the WaitlistEntry +
 * the boater's first_name + the slip's display fields — the full
 * Boater + Marina record stays server-side.
 */
export async function generateMetadata({ params }: Props) {
  const { token } = await params;
  const w = WAITLIST.find((x) => x.offer_token === token);
  return {
    title: w
      ? `Slip ${w.offered_slip_id ?? ""} is yours if you want it — Marina Stee`
      : "Waitlist offer — Marina Stee",
  };
}

export default async function WaitlistOfferPage({ params }: Props) {
  const { token } = await params;
  const ssrEntry = WAITLIST.find((w) => w.offer_token === token) ?? null;
  const boater = ssrEntry?.boater_id
    ? BOATERS.find((b) => b.id === ssrEntry.boater_id)
    : undefined;
  const slip = ssrEntry?.offered_slip_id
    ? SLIPS.find((s) => s.id === ssrEntry.offered_slip_id)
    : undefined;
  return (
    <WaitlistOfferExperience
      token={token}
      ssrEntry={ssrEntry}
      firstName={
        boater?.first_name ??
        (ssrEntry?.guest_name ?? "").split(/\s+/).reverse()[0] ??
        undefined
      }
      slipLabel={slip ? `${slip.id} — ${slip.dock}` : ssrEntry?.offered_slip_id}
      slipMaxLoaInches={slip?.max_loa_inches}
      slipClass={slip?.slip_class}
    />
  );
}
