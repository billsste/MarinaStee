import { redirect } from "next/navigation";

/*
 * Legacy route. Dock management folded into Settings → Customization
 * (alongside picklists) since docks behave like a picklist with extra
 * fields. Any bookmark or in-app link to /settings/docks lands on the
 * Docks tab inside the Customization page.
 */
export default function DocksRedirect() {
  redirect("/settings/customization?tab=docks");
}
