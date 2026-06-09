import { AiChecklist } from "@/components/onboarding/ai-checklist";

export const metadata = { title: "Set up your marina — Marina Stee" };

/*
 * /onboarding — productized AI activation checklist.
 *
 * Every marina sees the same checklist. Each step flips a
 * TenantAiSettings flag (or seeds a piece of state) that unlocks the
 * corresponding AI surface across the app. No bespoke setup, no
 * custom code per tenant — onboarding is configuration.
 *
 * The legacy multi-step wizard (marina identity / slips / POS / etc.)
 * is still available at /onboarding/setup for full first-run flow.
 */
export default function OnboardingPage() {
  return <AiChecklist />;
}
