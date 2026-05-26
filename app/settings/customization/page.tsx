import { PageShell } from "@/components/page-shell";
import { CustomizationView } from "@/components/settings/customization-view";

export const metadata = { title: "Customization — Marina Stee Settings" };

/*
 * Settings → Customization. Super-user surface for tenant taxonomy.
 *
 * Today: picklist values for the 7 user-editable enums across the
 * app (slip_class, vessel_type, activity_type, event_type,
 * rental_boat_type, contact_role, refund_reason).
 *
 * Tomorrow: custom fields + layout configs (deferred until backend +
 * first paying customer per the rollout decision).
 */
export default function CustomizationPage() {
  return (
    <PageShell
      title="Customization"
      description="Tune the dropdown values that appear across the app to match how your marina actually works. Changes apply tenant-wide and update every dropdown immediately."
    >
      <CustomizationView />
    </PageShell>
  );
}
