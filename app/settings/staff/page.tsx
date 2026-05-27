import { PageShell } from "@/components/page-shell";
import { StaffView } from "@/components/settings/staff-view";

export const metadata = { title: "Staff & Roles — Marina Stee Settings" };

export default function StaffPage() {
  return (
    <PageShell
      title="Staff & Roles"
      description="Invite staff, assign roles, manage permissions. Each role gates which actions show up across the tool."
    >
      <StaffView />
    </PageShell>
  );
}
