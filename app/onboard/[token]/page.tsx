import { notFound } from "next/navigation";
import { BOATERS, CONTRACTS, SLIPS, VESSELS, getContractByToken } from "@/lib/mock-data";
import { OnboardExperience } from "@/components/onboard/onboard-experience";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props) {
  const { token } = await params;
  const c =
    getContractByToken(token) ??
    // Fallback for the demo: if the token doesn't resolve from static
    // mock data, the client-side store will. We render the experience
    // anyway and let the client re-resolve.
    CONTRACTS.find((x) => x.signature_token === token);
  return { title: c ? `Complete onboarding · ${c.number}` : "Onboarding — Marina Stee" };
}

/*
 * Public boater-facing onboarding URL.
 *
 * Marina staff complete the slip-assignment wizard → a token is minted
 * on the new Contract, an outbound Communication is dispatched to the
 * holder with /onboard/[token] as its CTA. This is the URL the boater
 * lands on. Single sequential flow: Review → Sign → Add card → Welcome.
 *
 * The token resolves to a Contract via getContractByToken (mock-data
 * for SSR + client-store for live drafts created in-session).
 */
export default async function OnboardPage({ params }: Props) {
  const { token } = await params;
  const contract = getContractByToken(token);
  if (!contract) {
    // For the demo we still render the experience so a freshly-minted
    // token from the client store can resolve on hydration.
    return <OnboardExperience token={token} ssrContract={null} ssrBoater={null} ssrVessel={null} ssrSlip={null} />;
  }
  const boater = BOATERS.find((b) => b.id === contract.boater_id) ?? null;
  const vessel = contract.vessel_id
    ? (VESSELS.find((v) => v.id === contract.vessel_id) ?? null)
    : null;
  const slip = contract.slip_id
    ? (SLIPS.find((s) => s.id === contract.slip_id) ?? null)
    : null;
  return (
    <OnboardExperience
      token={token}
      ssrContract={contract}
      ssrBoater={boater}
      ssrVessel={vessel}
      ssrSlip={slip}
    />
  );
}
