import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BOATERS } from "@/lib/mock-data";
import { HolderSessionBounce } from "@/components/portal/holder-session-bounce";

export const metadata = { title: "Member portal — Marina Stee" };

/*
 * Demo landing for the member self-service portal.
 *
 * In production the member never sees this page — they receive a magic
 * link via SMS/email and tap straight through to /portal/{token}. Here
 * we list every seeded boater so the team can jump in as any of them
 * during prototyping.
 */
export default function PortalLanding() {
  return (
    <main className="min-h-screen bg-canvas">
      <HolderSessionBounce />
      <div className="mx-auto max-w-[640px] px-6 pt-16 pb-24">
        <header className="mb-8 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-[12px] bg-primary text-on-primary">
            <span className="text-[18px] font-semibold">M</span>
          </div>
          <h1 className="display-tight text-[26px] font-semibold text-fg">
            Marina Stee — Member portal
          </h1>
          <p className="mt-2 text-[14px] text-fg-subtle">
            Members usually arrive here straight from a link the marina
            sends them by text or email. Pick a demo member below to step
            into their portal.
          </p>
        </header>

        <ul className="space-y-2">
          {BOATERS.map((b) => (
            <li key={b.id}>
              <Link
                href={`/portal/${b.portal_token}`}
                className="flex items-center justify-between gap-3 rounded-[12px] border border-hairline bg-surface-1 px-4 py-3 transition-colors hover:border-hairline-strong hover:bg-surface-2"
              >
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-fg">
                    {b.display_name}
                  </div>
                  <div className="text-[12px] text-fg-tertiary">
                    {b.code ?? "—"} · {b.billing_cadence} · prefers{" "}
                    {b.communication_prefs.preferred_channel}
                  </div>
                </div>
                <ArrowRight className="size-4 text-fg-subtle" />
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-center text-[11px] text-fg-tertiary">
          Demo only. Production sign-in is via emailed or texted magic link.
        </p>
      </div>
    </main>
  );
}
