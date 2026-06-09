import { MarinaProfileView } from "@/components/settings/marina-profile-view";

export const metadata = { title: "Marina Profile — Marina Stee Settings" };

/*
 * Settings → Marina Profile. The Settings layout owns the H1, description,
 * and the persistent left rail; this page just renders the editor view.
 */
export default function MarinaProfilePage() {
  return <MarinaProfileView />;
}
