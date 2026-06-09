import { redirect } from "next/navigation";
import {
  BOATERS,
  INSURANCE_CERTIFICATES,
  VESSELS,
  getBoaterByPortalToken,
} from "@/lib/mock-data";
import { HolderCoiUpload } from "@/components/portal/holder-coi-upload";

/*
 * Holder-portal COI renewal upload — magic-link landing for boaters
 * who tapped the auto-draft renewal reminder.
 *
 * Distinct from `/coi-upload/[token]` (which keys off the upload_token
 * minted by requestCoiRenewal). This route lives INSIDE the holder
 * portal's persistent session (portal_token) so the member can also
 * reach it from the portal nav. We resolve the boater from the portal
 * token, then look up the one COI on file that most needs renewal
 * (any in the expiring window — soonest expiry first).
 *
 * UX patterns mirror HolderShell — safe-area padded canvas, warm
 * greeting, larger hit targets, agent-friendly copy.
 */

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props) {
  const { token } = await params;
  const b = getBoaterByPortalToken(token);
  return {
    title: b ? `Upload COI — ${b.first_name} — Marina Stee` : "Upload COI — Marina Stee",
  };
}

export default async function PortalCoiUploadPage({ params }: Props) {
  const { token } = await params;
  const boater = getBoaterByPortalToken(token);
  if (!boater) {
    redirect("/portal");
  }

  // Find the COI on file for this boater that most needs renewal.
  // Priority: expired > soonest-expiring. We sort by effective_end
  // ASC so the row at index 0 is always "most urgent."
  const myCois = INSURANCE_CERTIFICATES
    .filter((c) => c.boater_id === boater.id)
    .sort((a, b) => a.effective_end.localeCompare(b.effective_end));
  const targetCoi = myCois[0] ?? null;
  const vessel = targetCoi
    ? VESSELS.find((v) => v.id === targetCoi.vessel_id) ?? null
    : null;
  // Resolve boater again from the live BOATERS list to ensure type
  // narrowing aligns with the rest of the page (getBoaterByPortalToken
  // already returns a Boater | undefined — we've redirected if missing).
  const boaterRecord = BOATERS.find((b) => b.id === boater.id) ?? boater;

  return (
    <HolderCoiUpload
      boater={boaterRecord}
      token={token}
      coi={targetCoi}
      vessel={vessel}
    />
  );
}
