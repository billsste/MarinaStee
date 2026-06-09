import { redirect } from "next/navigation";

/*
 * Legacy slip-assign page route. The wizard now lives as an inline
 * modal on the slips table (Roster) — same canonical chrome as the
 * rental-boat wizard. This route stays in place as a redirect so any
 * old bookmark / link surfaces the operator on the slips list, where
 * one click on the slip opens the modal.
 */
export default function AssignSlipPage() {
  redirect("/services");
}
