import { redirect } from "next/navigation";
import { getBoaterByPortalToken } from "@/lib/mock-data";
import { HolderShell } from "@/components/portal/holder-shell";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props) {
  const { token } = await params;
  const b = getBoaterByPortalToken(token);
  return {
    title: b ? `${b.first_name} — Marina Stee` : "Member portal — Marina Stee",
  };
}

/*
 * Member portal entry point.
 *
 * Magic-link flow: marina sends `/portal/{boater.portal_token}` once
 * via SMS/email. First landing validates the token here; on success
 * the HolderShell client component calls `signInHolder()` to persist
 * the session, so re-opening the URL (or the PWA icon) skips this
 * server check on subsequent visits.
 *
 * Invalid token → bounce to /portal landing (in dev that's the member
 * picker; in prod it'd be a "this link expired, request a new one" page).
 */
export default async function MemberPortalPage({ params }: Props) {
  const { token } = await params;
  const boater = getBoaterByPortalToken(token);
  if (!boater) {
    redirect("/portal");
  }
  return <HolderShell boater={boater} token={token} />;
}
