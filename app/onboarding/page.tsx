import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const metadata = { title: "Set up your marina — Marina Stee" };

/*
 * /onboarding — first-run setup wizard for a new tenant. Walks the
 * operator through: marina identity → slips import → boaters import
 * → POS catalog → comms providers → invite staff → launch.
 *
 * Each step is resumable via sessionStorage; the wizard persists
 * configuration as the operator advances so they can drop and pick up
 * later. The "Launch" final step flips the tenant out of onboarding
 * mode and routes to the dashboard.
 */
export default function OnboardingPage() {
  return <OnboardingWizard />;
}
