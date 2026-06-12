import { PageShell } from "@/components/page-shell";
import { HelpDeskView } from "@/components/help-desk/help-desk-view";

export const metadata = { title: "Help & Feedback — Marina Stee" };

/*
 * Help-desk entry — marina operators file build-side tickets to the
 * Marina Stee SaaS team. Modeled on EquipDispatch's /(admin)/support
 * page structure (tabs: New Ticket | My Tickets; submit form, table,
 * detail modal) but rendered in Marina Stee's design language.
 *
 * Distinct from /support (multi-tenant boater→marina queue).
 *
 * v1 destination is the in-browser store in lib/help-desk.ts. When
 * admin.marinastee.com lands, the store calls swap to POST + GET
 * against that backend without changing the page.
 */
export default function HelpDeskPage() {
  return (
    <PageShell
      title="Help & feedback"
      description="File a ticket with the Marina Stee team. Bugs, enhancement requests, and questions go straight into our engineering queue and update here as they move."
      width="default"
      hideHeader
    >
      <HelpDeskView />
    </PageShell>
  );
}
