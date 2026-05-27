import { PageShell } from "@/components/page-shell";
import { MarinaProfileView } from "@/components/settings/marina-profile-view";

export const metadata = { title: "Marina Profile — Marina Stee Settings" };

/*
 * Settings → Marina Profile. Operator-facing editor for the per-tenant
 * marina identity record — branding, address, contact, hours, tax +
 * accounting defaults, outbound sender labels.
 *
 * Every customer-facing surface (receipts, portal, signed contracts,
 * comm template merge tokens) reads from this profile. Edits here
 * propagate the moment the underlying input blurs.
 */
export default function MarinaProfilePage() {
  return (
    <PageShell
      title="Marina Profile"
      description="The marina's identity — what shows up on receipts, contracts, the boater portal, and every outbound message. Changes save automatically when you leave a field — confirmation appears in the bottom-right."
    >
      <MarinaProfileView />
    </PageShell>
  );
}
