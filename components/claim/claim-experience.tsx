"use client";

import * as React from "react";
import { Anchor, Sparkles, CheckCircle2, Clock, MapPin, Zap, Droplet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  claimWaitlistOffer,
  getWaitlistByClaimToken,
  updateWaitlistStatus,
  useStore,
} from "@/lib/client-store";
import { SLIPS, RENTAL_SPACES } from "@/lib/mock-data";
import type { WaitlistEntry } from "@/lib/types";

/*
 * Boater-facing waitlist claim experience.
 *
 * "A slip just opened that matches what you asked for. First to confirm
 * gets it." Single decision page — Claim or Pass — with a visible
 * expiration countdown. Claiming flips the waitlist entry to converted
 * and drops a comm to staff to start the slip-onboarding chain.
 */
export function ClaimExperience({
  token,
  ssrEntry,
}: {
  token: string;
  ssrEntry: WaitlistEntry | null;
}) {
  const store = useStore();
  const entry =
    getWaitlistByClaimToken(token) ??
    store.waitlist.find((w) => w.claim_token === token) ??
    ssrEntry;

  const [view, setView] = React.useState<"open" | "claimed" | "passed" | "expired" | "taken">(
    "open"
  );
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!entry) {
    return (
      <main className="min-h-screen bg-canvas">
        <div className="mx-auto max-w-xl px-6 py-24 text-center">
          <Anchor className="mx-auto mb-3 size-8 text-fg-tertiary" />
          <h1 className="text-[20px] font-semibold text-fg">This claim link isn&apos;t valid</h1>
          <p className="mt-2 text-[13px] text-fg-subtle">
            The offer may have expired or already been claimed.
          </p>
        </div>
      </main>
    );
  }

  // Resolve the offered slip — could be from SLIPS or RENTAL_SPACES
  const slipId = entry.offered_slip_id ?? "";
  const slip = SLIPS.find((s) => s.id === slipId);
  const space = !slip ? RENTAL_SPACES.find((s) => s.id === slipId) : undefined;
  const slipMeta = slip
    ? {
        number: slip.number,
        dock: slip.dock,
        maxLOA: slip.max_loa_inches,
        hasPower: slip.has_power,
        hasWater: slip.has_water,
      }
    : space
    ? {
        number: space.number,
        dock: space.group_id,
        maxLOA: space.length_inches ?? 0,
        hasPower: space.has_power,
        hasWater: space.has_water,
      }
    : {
        number: slipId,
        dock: "—",
        maxLOA: 0,
        hasPower: false,
        hasWater: false,
      };

  const expiresMs = entry.offer_expires_at ? new Date(entry.offer_expires_at).getTime() : 0;
  const remainingMs = Math.max(0, expiresMs - now);
  const expired = expiresMs > 0 && remainingMs === 0;

  // If we land and the entry isn't in offered state, route accordingly.
  if (entry.status === "converted" && view === "open") {
    return (
      <ClaimedView slipNumber={slipMeta.number} dock={slipMeta.dock} byMe={false} />
    );
  }
  if (entry.status === "expired" || expired) {
    if (view === "open") return <ExpiredView />;
  }
  if (entry.status === "declined") {
    return <PassedView />;
  }

  const [autoOnboardToken, setAutoOnboardToken] = React.useState<string | null>(null);

  // ── Actions
  function handleClaim() {
    const result = claimWaitlistOffer(token);
    if (!result) {
      setView(expired ? "expired" : "taken");
      return;
    }
    setView("claimed");
    if (result.onboardToken) {
      setAutoOnboardToken(result.onboardToken);
      // Brief celebration before we hand them off to the onboarding chain.
      setTimeout(() => {
        if (typeof window !== "undefined") {
          window.location.href = `/onboard/${result.onboardToken}`;
        }
      }, 2500);
    }
  }
  function handlePass() {
    updateWaitlistStatus(entry!.id, "declined");
    setView("passed");
  }

  if (view === "claimed") {
    return (
      <ClaimedView
        slipNumber={slipMeta.number}
        dock={slipMeta.dock}
        byMe
        autoOnboardToken={autoOnboardToken}
      />
    );
  }
  if (view === "expired") return <ExpiredView />;
  if (view === "passed") return <PassedView />;
  if (view === "taken") {
    return (
      <main className="min-h-screen bg-canvas">
        <div className="mx-auto max-w-xl px-6 py-24 text-center">
          <h1 className="text-[20px] font-semibold text-fg">Already claimed</h1>
          <p className="mt-2 text-[13px] text-fg-subtle">
            Someone else got there first. We&apos;ll keep you on the list for the next opening.
          </p>
        </div>
      </main>
    );
  }

  // ── Live offer view
  const customerFirst =
    (entry.guest_name ?? "").split(/\s+/)[0] || "there";

  return (
    <main className="min-h-screen bg-canvas">
      {/* Top bar */}
      <header className="border-b border-hairline bg-surface-1">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-[6px] bg-primary text-on-primary">
              <span className="font-semibold text-[12px]">M</span>
            </div>
            <span className="text-[13px] font-medium text-fg">Marina Stee</span>
          </div>
          <Badge tone="ok" size="sm">
            Waitlist offer
          </Badge>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-5 py-6">
        <div className="rounded-[14px] border border-status-ok/30 bg-status-ok/[0.05] px-5 py-6 text-center">
          <Sparkles className="mx-auto size-7 text-status-ok" />
          <h1 className="display-tight mt-2 text-[26px] font-semibold text-fg">
            A slip just opened, {customerFirst}.
          </h1>
          <p className="mt-1 text-[13px] text-fg-subtle">
            It matches your waitlist request. First to claim wins.
          </p>
          <div className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-full border border-status-warn/30 bg-status-warn/[0.05] px-3 py-1 text-[12px] text-status-warn">
            <Clock className="size-3.5" />
            Expires in <span className="tabular font-medium">{formatCountdown(remainingMs)}</span>
          </div>
        </div>

        <section className="mt-4 rounded-[12px] border border-hairline bg-surface-1">
          <div className="border-b border-hairline bg-surface-2 px-4 py-2.5 text-[13px] font-medium text-fg">
            The slip
          </div>
          <div className="p-4">
            <div className="flex items-baseline gap-2">
              <Anchor className="size-4 text-primary" />
              <span className="font-mono text-[20px] font-semibold text-fg">
                {slipMeta.number}
              </span>
              <span className="text-[13px] text-fg-subtle">· {slipMeta.dock}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
              {slipMeta.maxLOA > 0 && (
                <Field
                  icon={<Anchor className="size-3.5" />}
                  label="Max LOA"
                  value={`${Math.round(slipMeta.maxLOA / 12)}'`}
                />
              )}
              {slipMeta.hasPower && (
                <Field icon={<Zap className="size-3.5" />} label="Power" value="Yes" />
              )}
              {slipMeta.hasWater && (
                <Field icon={<Droplet className="size-3.5" />} label="Water" value="Yes" />
              )}
              <Field
                icon={<MapPin className="size-3.5" />}
                label="Cadence"
                value={entry.reservation_type}
              />
            </dl>
          </div>
        </section>

        {entry.preferred_arrival && (
          <p className="mt-3 rounded-[10px] border border-hairline bg-surface-2 px-4 py-3 text-[12px] text-fg-subtle">
            <strong className="text-fg">Why we matched you:</strong> you asked for{" "}
            {entry.reservation_type} dockage
            {entry.preferred_arrival && ` from ${entry.preferred_arrival}`}
            {entry.loa_inches ? ` for a ${Math.round(entry.loa_inches / 12)}' boat` : ""}
            {entry.preferred_dock ? ` near ${entry.preferred_dock}` : ""}. This slip fits.
          </p>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button variant="primary" onClick={handleClaim} className="flex-1">
            <CheckCircle2 className="size-4" />
            Claim slip {slipMeta.number}
          </Button>
          <button
            type="button"
            onClick={handlePass}
            className="flex-1 rounded-[10px] border border-hairline bg-surface-1 px-4 py-2.5 text-[13px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            Pass — keep me on the list
          </button>
        </div>

        <p className="mt-4 text-[11px] text-fg-tertiary">
          Claiming starts the slip onboarding — marina staff will reach out within an
          hour to confirm dates + send your contract.
        </p>
      </div>
    </main>
  );
}

function Field({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-fg-tertiary">{icon}</span>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">{label}</div>
        <div className="text-[13px] text-fg">{value}</div>
      </div>
    </div>
  );
}

function ClaimedView({
  slipNumber,
  dock,
  byMe,
  autoOnboardToken,
}: {
  slipNumber: string;
  dock: string;
  byMe: boolean;
  autoOnboardToken?: string | null;
}) {
  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <CheckCircle2 className="mx-auto mb-3 size-10 text-status-ok" />
        <h1 className="display-tight text-[24px] font-semibold text-fg">
          {byMe ? "Slip claimed — welcome aboard." : "This slip was claimed."}
        </h1>
        {byMe ? (
          autoOnboardToken ? (
            <>
              <p className="mt-2 text-[13px] text-fg-subtle">
                Slip {slipNumber} at {dock} is yours. We&apos;ve drafted your contract
                and sent it your way — opening it now…
              </p>
              <a
                href={`/onboard/${autoOnboardToken}`}
                className="pill mt-4 inline-flex items-center gap-2 bg-primary px-5 py-2 text-[14px] font-semibold text-on-primary"
              >
                Continue to contract →
              </a>
            </>
          ) : (
            <p className="mt-2 text-[13px] text-fg-subtle">
              Slip {slipNumber} at {dock} is yours. We&apos;ll be in touch within the
              hour to set up your account and send the contract.
            </p>
          )
        ) : (
          <p className="mt-2 text-[13px] text-fg-subtle">
            Someone else got there first. You&apos;re still on the waitlist for the next opening.
          </p>
        )}
      </div>
    </main>
  );
}

function ExpiredView() {
  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <Clock className="mx-auto mb-3 size-8 text-fg-tertiary" />
        <h1 className="text-[20px] font-semibold text-fg">This offer expired</h1>
        <p className="mt-2 text-[13px] text-fg-subtle">
          The 24-hour window has passed. You&apos;re still on the waitlist for the next opening.
        </p>
      </div>
    </main>
  );
}

function PassedView() {
  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="text-[20px] font-semibold text-fg">Got it — passed.</h1>
        <p className="mt-2 text-[13px] text-fg-subtle">
          We&apos;ll let you know about the next opening that fits your preferences.
        </p>
      </div>
    </main>
  );
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0h 0m";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}
