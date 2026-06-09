import { redirect } from "next/navigation";

/*
 * Staff & Roles consolidated into /staff (Roster + Roles & access
 * sub-sections). This redirect preserves any old bookmarks / sidebar
 * links until they're cleaned up.
 */
export default function StaffSettingsPage() {
  redirect("/staff?section=roster");
}
