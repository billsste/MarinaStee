"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Anchor, ArrowLeft } from "lucide-react";
import { ApplyStatusCard } from "@/components/apply/apply-status-card";
import { useApplicationByToken } from "@/lib/client-store";
import { MARINA_PROFILE_SEED } from "@/lib/mock-data";

/*
 * /apply/[token] — boater-facing application status check.
 *
 * The boater follows the magic link from the comm they receive after
 * submitting (or the success page). We resolve the token via
 * `useApplicationByToken` (already tenant-stamped at submit time, so no
 * cross-tenant leak).
 *
 * Tokens don't expire as a structural rule, but `mintApplicationToken`
 * can rotate them. When the token is invalid we render a generic
 * not-found card with a link back to /apply.
 */
export default function ApplyStatusPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const application = useApplicationByToken(token);
  const profile = MARINA_PROFILE_SEED;

  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto w-full max-w-[640px] px-5 pt-12 pb-20 sm:px-6 sm:pt-16">
        <header className="mb-8 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-[12px] bg-primary text-on-primary">
            <Anchor className="size-5" />
          </div>
          <div className="text-[11px] font-medium uppercase tracking-widest text-fg-tertiary">
            {profile.short_name}
          </div>
          <h1 className="display-tight mt-1 text-[24px] font-semibold text-fg">
            Application status
          </h1>
        </header>

        {application ? (
          <ApplyStatusCard application={application} />
        ) : (
          <NotFound />
        )}

        <div className="mt-6 text-center text-[12px] text-fg-tertiary">
          <Link
            href="/apply"
            className="inline-flex items-center gap-1 text-fg-subtle hover:text-fg"
          >
            <ArrowLeft className="size-3" />
            Apply for another boat
          </Link>
        </div>
      </div>
    </main>
  );
}

function NotFound() {
  return (
    <div className="rounded-[16px] border border-hairline bg-surface-1 p-8 text-center shadow-sm">
      <h2 className="text-[18px] font-semibold text-fg">
        We couldn't find that application.
      </h2>
      <p className="mt-2 text-[13px] text-fg-subtle">
        The link may have expired, or the application may have been removed.
        You can submit a fresh application at any time.
      </p>
      <Link
        href="/apply"
        className="mt-5 inline-flex items-center gap-1.5 rounded-[8px] bg-primary px-3 py-2 text-[13px] font-medium text-on-primary hover:bg-primary-hover"
      >
        Start a new application
      </Link>
    </div>
  );
}
