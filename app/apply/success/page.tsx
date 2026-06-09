import * as React from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { MARINA_PROFILE_SEED } from "@/lib/mock-data";

export const metadata = { title: "Application sent — Marina Stee" };

/*
 * /apply/success?token=... — post-submit confirmation.
 *
 * The wizard bounces here after `submitApplication()` mints a token; we
 * render a quick confirmation + a link to the status check page. The
 * boater will also receive a Communication seeded into the mock store
 * (welcome / decline drafts live at decision time on the operator queue).
 *
 * Next.js 16 page props: `searchParams` is a Promise; await it.
 */
export default async function ApplySuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const profile = MARINA_PROFILE_SEED;
  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto w-full max-w-[640px] px-5 pt-16 pb-20 sm:px-6">
        <div className="rounded-[16px] border border-hairline bg-surface-1 p-8 shadow-sm text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-status-ok/15 text-status-ok">
            <CheckCircle2 className="size-7" />
          </div>
          <h1 className="display-tight text-[28px] font-semibold text-fg">
            Application sent.
          </h1>
          <p className="mx-auto mt-3 max-w-[440px] text-[14px] leading-relaxed text-fg-muted">
            Thank you. {profile.short_name} will review your application and
            email you within two business days.
            {token
              ? " You can check the status of your application anytime at the link below."
              : " We've emailed you a status link — check your inbox."}
          </p>

          {token ? (
            <Link
              href={`/apply/${token}`}
              className="mt-6 inline-flex items-center gap-1.5 rounded-[8px] bg-primary px-4 py-2 text-[13px] font-medium text-on-primary hover:bg-primary-hover"
            >
              Check application status
              <ArrowRight className="size-3.5" />
            </Link>
          ) : (
            // No token — the boater landed here via bookmark / refresh and
            // we can't deep-link to their status page. The bookmark hint
            // below referenced a "link below" that wasn't present; we now
            // suppress that hint and offer a clear way back to the apply
            // landing.
            <Link
              href="/apply"
              className="mt-6 inline-flex items-center gap-1.5 rounded-[8px] bg-primary px-4 py-2 text-[13px] font-medium text-on-primary hover:bg-primary-hover"
            >
              Done
              <ArrowRight className="size-3.5" />
            </Link>
          )}

          {token && (
            <p className="mt-6 text-[11px] text-fg-tertiary">
              Bookmark the status link — we&apos;ll keep it updated as your
              application moves through review.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
