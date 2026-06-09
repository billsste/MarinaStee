import { redirect } from "next/navigation";

/*
 * /settings → /settings/marina-profile.
 *
 * The Settings shell (layout.tsx) is the new home — left rail handles
 * navigation between sub-areas. We default into Marina Profile so the
 * operator lands on something useful instead of an empty content pane.
 */
export default function SettingsPage() {
  redirect("/settings/marina-profile");
}
