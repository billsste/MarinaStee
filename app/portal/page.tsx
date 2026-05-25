import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BOATERS } from "@/lib/mock-data";

export const metadata = { title: "Boater portal — Marina Stee" };

/*
 * Demo landing for the boater self-service portal. In production this would
 * be a magic-link auth flow keyed by boater email. Here we list the mock
 * boaters so you can jump in as any of them.
 */
export default function PortalLanding() {
  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-[640px] px-6 pt-16 pb-24">
        <header className="mb-8 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-[12px] bg-primary text-on-primary">
            <span className="text-[18px] font-semibold">M</span>
          </div>
          <h1 className="display-tight text-[28px] font-semibold text-fg">Marina Stee — Boater Portal</h1>
          <p className="mt-2 text-[14px] text-fg-subtle">
            Pay your balance, view contracts, message the marina, request service. Pick a demo profile below.
          </p>
        </header>

        <ul className="space-y-2">
          {BOATERS.map((b) => (
            <li key={b.id}>
              <Link
                href={`/portal/${b.id}`}
                className="flex items-center justify-between gap-3 rounded-[12px] border border-hairline bg-surface-1 px-4 py-3 transition-colors hover:border-hairline-strong hover:bg-surface-2"
              >
                <div>
                  <div className="text-[14px] font-medium text-fg">{b.display_name}</div>
                  <div className="text-[12px] text-fg-tertiary">
                    {b.code ?? "—"} · {b.billing_cadence} · prefers {b.communication_prefs.preferred_channel}
                  </div>
                </div>
                <ArrowRight className="size-4 text-fg-subtle" />
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-center text-[11px] text-fg-tertiary">
          Demo only. Production sign-in is via emailed magic link.
        </p>
      </div>
    </main>
  );
}
