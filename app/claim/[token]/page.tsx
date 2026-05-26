import { WAITLIST } from "@/lib/mock-data";
import { ClaimExperience } from "@/components/claim/claim-experience";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props) {
  const { token } = await params;
  const w = WAITLIST.find((x) => x.claim_token === token);
  return {
    title: w ? `Claim slip ${w.offered_slip_id ?? ""}` : "Slip claim — Marina Stee",
  };
}

/*
 * Public waitlist-claim URL.
 *
 * A slip opens → notifyWaitlistOfSlipOpening fans out comms to top N
 * matching waitlisters with /claim/[token] URLs. Customers race to
 * claim — first to confirm wins. Mirrors the "Send a public link"
 * pattern from /onboard and /pickup.
 */
export default async function ClaimPage({ params }: Props) {
  const { token } = await params;
  // Most of the time the entry lives in the client store (just-minted
  // tokens from this session) but we still try the static seed too.
  const entry = WAITLIST.find((w) => w.claim_token === token) ?? null;
  return <ClaimExperience token={token} ssrEntry={entry} />;
}
