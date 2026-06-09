import * as React from "react";
import { Anchor, Sailboat, ShieldCheck } from "lucide-react";
import { MARINA_PROFILE_SEED } from "@/lib/mock-data";
import { ApplyWizard } from "@/components/apply/apply-wizard";

export const metadata = { title: "Apply for a slip — Marina Stee" };

/*
 * /apply — public boater self-onboarding landing.
 *
 * Single-marina mode for now: every submission lands in the seed
 * tenant's queue. When the platform runs multiple tenants from one
 * apply URL we'll add a tenant-slug param (e.g. /apply/{slug}) and
 * resolve the active marina from there.
 *
 * Marketing-style hero + 4-step wizard. No operator chrome — the
 * `/apply` prefix is excluded from AppShell in components/app-shell.tsx
 * so prospective customers don't see internal nav.
 */
export default function ApplyLandingPage() {
  const profile = MARINA_PROFILE_SEED;
  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto w-full max-w-[760px] px-5 pt-12 pb-20 sm:px-6 sm:pt-16">
        <Hero
          shortName={profile.short_name}
          displayName={profile.display_name}
          tagline={profile.tagline}
        />

        <div className="mt-10">
          <ApplyWizard />
        </div>

        <Trust />

        <Footer
          email={profile.email}
          phone={profile.phone}
          website={profile.website}
        />
      </div>
    </main>
  );
}

function Hero({
  shortName,
  displayName,
  tagline,
}: {
  shortName: string;
  displayName: string;
  tagline?: string;
}) {
  return (
    <header className="text-center">
      <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-[14px] bg-primary text-on-primary shadow-sm">
        <Anchor className="size-6" />
      </div>
      <div className="text-[11px] font-medium uppercase tracking-widest text-fg-tertiary">
        {shortName}
      </div>
      <h1 className="display-tight mt-2 text-[34px] font-semibold text-fg sm:text-[40px]">
        Apply for a slip
      </h1>
      <p className="mx-auto mt-3 max-w-[480px] text-[15px] leading-relaxed text-fg-muted">
        Welcome to {displayName}. Tell us a bit about you and your boat — we
        review every application personally and get back to you within two
        business days.
      </p>
      {tagline ? (
        <p className="mt-2 text-[12px] italic text-fg-tertiary">{tagline}</p>
      ) : null}
    </header>
  );
}

function Trust() {
  return (
    <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <TrustPill
        icon={Sailboat}
        title="Boats of all sizes"
        body="Slip-side & dry storage, weekend visits to seasonal stays."
      />
      <TrustPill
        icon={ShieldCheck}
        title="Quick decision"
        body="Most applications get a response within 2 business days."
      />
      <TrustPill
        icon={Anchor}
        title="Family-run"
        body="A real person reads every submission. No bots, no waiting on hold."
      />
    </div>
  );
}

function TrustPill({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <Icon className="size-4 text-primary" />
      <div className="mt-2 text-[13px] font-medium text-fg">{title}</div>
      <p className="mt-1 text-[12px] leading-relaxed text-fg-subtle">{body}</p>
    </div>
  );
}

function Footer({
  email,
  phone,
  website,
}: {
  email: string;
  phone: string;
  website?: string;
}) {
  return (
    <footer className="mt-12 border-t border-hairline pt-6 text-center text-[12px] text-fg-tertiary">
      Questions? Reach the harbormaster at{" "}
      <a className="text-primary hover:underline" href={`mailto:${email}`}>
        {email}
      </a>{" "}
      or{" "}
      <a className="text-primary hover:underline" href={`tel:${phone}`}>
        {phone}
      </a>
      .
      {website ? (
        <>
          {" · "}
          <a className="hover:underline" href={website}>
            {website.replace(/^https?:\/\//, "")}
          </a>
        </>
      ) : null}
    </footer>
  );
}
