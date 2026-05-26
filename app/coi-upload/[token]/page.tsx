import { INSURANCE_CERTIFICATES, BOATERS, VESSELS } from "@/lib/mock-data";
import { CoiUploadExperience } from "@/components/coi-upload/coi-upload-experience";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props) {
  const { token } = await params;
  const c = INSURANCE_CERTIFICATES.find((x) => x.upload_token === token);
  return { title: c ? `Upload COI — ${c.carrier}` : "Upload COI — Marina Stee" };
}

/*
 * Public boater-facing COI renewal page.
 *
 * Staff (or auto-trigger on expiry alert) → requestCoiRenewal mints
 * the upload_token + dispatches an outbound Comm. Boater lands here,
 * sees their expiring policy on file, drops a new PDF + new effective
 * dates, and submits — landing a new InsuranceCertificate in the store
 * with uploaded_by: "boater".
 *
 * Mirrors /onboard/[token] and /pickup/[token].
 */
export default async function CoiUploadPage({ params }: Props) {
  const { token } = await params;
  const coi = INSURANCE_CERTIFICATES.find((x) => x.upload_token === token) ?? null;
  const boater = coi ? (BOATERS.find((b) => b.id === coi.boater_id) ?? null) : null;
  const vessel = coi ? (VESSELS.find((v) => v.id === coi.vessel_id) ?? null) : null;
  return (
    <CoiUploadExperience
      token={token}
      ssrCoi={coi}
      ssrBoater={boater}
      ssrVessel={vessel}
    />
  );
}
