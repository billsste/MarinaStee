"use client";

import * as React from "react";
import Link from "next/link";
import {
  CreditCard,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Mail,
  Plus,
  Sailboat,
  Ship,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  InlineEditCell,
  InlineToggle,
} from "@/components/ui/inline-edit-cell";
import { LocalTime } from "@/components/ui/local-time";
import { HolderAgentChat } from "@/components/portal/holder-agent-chat";
import { ThemeToggle } from "@/components/theme-toggle";
import { localIsoDate } from "@/lib/contracts";
import { formatMoney, getSlip, getVesselsForBoater } from "@/lib/mock-data";
import {
  cancelClubSubscription,
  deleteCardForBoater,
  effectivePlanFor,
  getClubCapacityForDate,
  joinClubFromPortal,
  nextClubBookingId,
  pauseClubSubscription,
  setClubBookingSentiment,
  switchTenant,
  updateBoater,
  updateVessel,
  upsertClubBooking,
  upsertClubSubscription,
  useCardsForBoater,
  useClubBookingsForBoater,
  useClubPlans,
  useClubSubscriptionForBoater,
  useCommunicationsForBoater,
  useContractsForBoater,
  useCurrentTenant,
  useEffectivePlanFor,
  useLedgerForBoater,
  useMarinaProfile,
  useRates,
  useReservationsForBoater,
  useVesselsForBoater,
} from "@/lib/client-store";
import {
  signInHolder,
  signOutHolder,
  touchHolderSession,
  useHolderSession,
} from "@/lib/holder-session";
import { cn } from "@/lib/utils";
import type { Boater, Vessel } from "@/lib/types";

/*
 * HolderShell — agent-first portal experience for slip holders.
 *
 * Top: identity bar + agent chat hero (always reachable).
 * Below: horizontal tab nav into tabular surfaces — Overview · Account ·
 * Contract · Inbox. Each tab is dense + inline-editable on the fields a
 * holder can change (contact, vessel basics, card nicknames + default).
 *
 * Patterns mirror the operator side (Settings rebuild from #228 + the
 * tabular/inline sweep on Rates / Fees / POS Locations / Connections):
 * tabular rows, click-cell to edit, no Back-button chains, trash icons
 * on hover, agent always pinned at top.
 */
type SectionKey = "overview" | "account" | "club" | "contract" | "inbox";

// Nav groups are built dynamically inside the shell because the "Rental
// Club" item only appears when the signed-in member actually has a
// ClubSubscription. Static config moved into a builder fn below.
function buildNavGroups(hasClub: boolean): {
  label: string;
  items: {
    key: SectionKey;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[];
}[] {
  const marinaItems: {
    key: SectionKey;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [{ key: "contract", label: "Contract", icon: FileText }];

  // Rental Club tab — only renders for club members. Slip-only holders
  // never see it, keeping their nav focused.
  if (hasClub) {
    marinaItems.push({ key: "club", label: "Rental Club", icon: Sailboat });
  }
  marinaItems.push({ key: "inbox", label: "Messages", icon: Inbox });

  return [
    {
      label: "Personal",
      items: [
        { key: "overview", label: "Overview", icon: LayoutDashboard },
        { key: "account", label: "Account", icon: User },
      ],
    },
    {
      label: "Marina",
      items: marinaItems,
    },
  ];
}

export function HolderShell({
  boater,
  token,
}: {
  boater: Boater;
  token: string;
}) {
  const session = useHolderSession();

  // Is this member in the Rental Club? Determines whether the "Rental
  // Club" nav item appears.
  const subscription = useClubSubscriptionForBoater(boater.id);
  const navGroups = React.useMemo(
    () => buildNavGroups(!!subscription),
    [subscription]
  );

  // Deep-link via ?section=club (used by the PWA manifest shortcut).
  // Only honor known section keys; ignore unknown values silently.
  const [section, setSection] = React.useState<SectionKey>(() => {
    if (typeof window === "undefined") return "overview";
    const sp = new URLSearchParams(window.location.search);
    const want = sp.get("section");
    const allowed: SectionKey[] = [
      "overview",
      "account",
      "club",
      "contract",
      "inbox",
    ];
    if (want && (allowed as string[]).includes(want)) {
      // Don't show "club" if the member doesn't have a subscription
      if (want === "club" && !subscription) return "overview";
      return want as SectionKey;
    }
    return "overview";
  });

  // Persist the session on first landing.
  // signInHolder is idempotent — calling it with the same token is a no-op.
  React.useEffect(() => {
    if (!session || session.token !== token) {
      signInHolder(token, boater.id);
    } else {
      touchHolderSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tenant-aware portal: when the boater belongs to a tenant other
  // than the one currently active in this browser session, switch.
  // Ensures the holder sees THEIR marina's branding + retention
  // config, not whichever tenant staff was last viewing.
  const currentTenant = useCurrentTenant();
  React.useEffect(() => {
    const boaterTenantId = boater.tenant_id;
    if (!boaterTenantId) return;
    if (currentTenant?.id !== boaterTenantId) {
      switchTenant(boaterTenantId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boater.id]);

  return (
    <main
      className="min-h-screen bg-canvas"
      style={{
        // Safe-area padding so the iPhone notch + home indicator don't
        // eat content when the portal is installed as a PWA. Resolves
        // to 0 on desktop, so this is a no-op outside standalone mode.
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {/* Identity bar */}
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-hairline bg-surface-1/95 px-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-[8px] bg-primary text-on-primary">
            <span className="text-[12px] font-semibold">M</span>
          </div>
          <div className="leading-tight">
            <div className="text-[12px] font-medium text-fg">Marina Stee</div>
            <div className="text-[10px] text-fg-tertiary">
              Hi, {boater.first_name}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Sign out of Marina Stee on this device?")) {
                signOutHolder();
                window.location.href = "/portal";
              }
            }}
            className="rounded-[6px] p-2 text-fg-tertiary hover:bg-surface-2 hover:text-fg"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1100px] px-4 pb-24 pt-6">
        {/* Agent hero */}
        <section className="rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-sm">
          <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-wide text-primary">
            <Sparkles className="size-3.5" />
            Marina Stee agent
          </div>
          <h1 className="display-tight mt-2 text-[26px] font-semibold leading-tight text-fg">
            How can I help, {boater.first_name}?
          </h1>
          <p className="mt-1 text-[13px] text-fg-subtle">
            Pay your balance, schedule a pump-out, message the marina, update
            your contact info — I&apos;ll handle the rest.
          </p>

          <HolderAgentChat boater={boater} className="mt-4" />
        </section>

        {/* Rail + content — left-rail nav identical pattern to Settings */}
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[200px_1fr]">
          {/* Left rail */}
          <nav
            aria-label="Portal sections"
            className="space-y-4 md:sticky md:top-20 md:self-start"
          >
            {navGroups.map((group) => (
              <div key={group.label}>
                <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
                  {group.label}
                </div>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = section === item.key;
                    return (
                      <li key={item.key}>
                        <button
                          type="button"
                          onClick={() => setSection(item.key)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] transition-colors",
                            isActive
                              ? "bg-surface-3 font-medium text-fg"
                              : "text-fg-subtle hover:bg-surface-2 hover:text-fg"
                          )}
                        >
                          <Icon className="size-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">
                            {item.label}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          {/* Content */}
          <div className="min-w-0">
            {section === "overview" && <OverviewTab boater={boater} />}
            {section === "account" && <AccountTab boater={boater} />}
            {section === "club" && subscription && (
              <ClubTab boater={boater} subscription={subscription} />
            )}
            {section === "contract" && <ContractTab boater={boater} />}
            {section === "inbox" && <InboxTab boater={boater} />}
          </div>
        </div>
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Overview — snapshot + recent activity
// ─────────────────────────────────────────────────────────────────────

function OverviewTab({ boater }: { boater: Boater }) {
  const ledger = useLedgerForBoater(boater.id);
  const reservations = useReservationsForBoater(boater.id);
  const contracts = useContractsForBoater(boater.id);
  // Connection layer — surface vessel + most-recent comm inline on the
  // overview so the member sees their slip, vessel, balance, and the
  // last message from the marina without click chains.
  const liveVessels = useVesselsForBoater(boater.id);
  const vessels =
    liveVessels.length > 0 ? liveVessels : getVesselsForBoater(boater.id);
  const primaryVessel = vessels[0];
  const comms = useCommunicationsForBoater(boater.id);
  const latestComm = React.useMemo(() => {
    if (comms.length === 0) return null;
    return [...comms].sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1))[0];
  }, [comms]);
  // If the member is in the club, surface a billing-filter chip row
  // above the activity table so they can split "Monthly fees" from
  // "Other charges." Slip-only holders see no chips (unchanged UI).
  const clubSubscription = useClubSubscriptionForBoater(boater.id);
  // Show the self-signup CTA only when the member isn't already in
  // the club AND there's at least one club plan they could pick.
  const clubPlans = useClubPlans();
  const [joinOpen, setJoinOpen] = React.useState(false);
  const showJoinCta = !clubSubscription && clubPlans.length > 0;
  const [billingFilter, setBillingFilter] = React.useState<"all" | "club" | "other">(
    "all"
  );
  function isClubLedgerEntry(l: import("@/lib/types").LedgerEntry): boolean {
    return (
      l.gl_account === "Rental Club Revenue" ||
      (l.line_items?.some((li) => /Rental Club/i.test(li.description)) ?? false)
    );
  }
  const visibleLedger =
    !clubSubscription || billingFilter === "all"
      ? ledger
      : billingFilter === "club"
      ? ledger.filter(isClubLedgerEntry)
      : ledger.filter((l) => !isClubLedgerEntry(l));

  const today = localIsoDate();
  const currentRes = reservations.find(
    (r) => r.arrival_date <= today && r.departure_date >= today
  );
  const upcomingRes = reservations
    .filter((r) => r.arrival_date > today)
    .sort((a, b) => (a.arrival_date < b.arrival_date ? -1 : 1))[0];
  const activeSlipId = currentRes?.slip_id ?? contracts[0]?.slip_id;
  const slip = activeSlipId ? getSlip(activeSlipId) : null;
  const openInvoices = ledger.filter(
    (l) => l.type === "invoice" && l.open_balance > 0
  );
  const openBalance = openInvoices.reduce((s, l) => s + l.open_balance, 0);
  const activeContract = contracts.find((c) => c.status === "executed");
  const contractYear = activeContract
    ? activeContract.effective_start.slice(0, 4)
    : null;

  return (
    <div className="space-y-4">
      {/* Snapshot panels — connection layer at a glance: balance, slip,
          and primary vessel side-by-side so the member never has to
          click into a sub-page to see who/where/what. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Panel
          icon={<CreditCard className="size-3.5" />}
          label="Account balance"
        >
          <div
            className={cn(
              "money-display-lg text-[28px] leading-tight",
              openBalance > 0 ? "text-status-warn" : "text-status-ok"
            )}
          >
            {formatMoney(openBalance)}
          </div>
          <div className="mt-1 text-[12px] text-fg-subtle">
            {openBalance > 0
              ? `${openInvoices.length} open ${openInvoices.length === 1 ? "bill" : "bills"}.`
              : "All caught up."}
          </div>
        </Panel>

        <Panel icon={<Ship className="size-3.5" />} label="Your slip">
          {slip ? (
            <>
              <div className="text-[20px] font-medium text-fg">{slip.id}</div>
              <div className="mt-1 text-[12px] text-fg-subtle">
                {currentRes
                  ? `In slip — checked in ${formatDate(currentRes.arrival_date)}.`
                  : activeContract
                  ? `Annual ${contractYear ?? ""} contract — ${activeContract.number}.`
                  : "Reserved."}
              </div>
              {upcomingRes && (
                <div className="mt-2 text-[11px] text-fg-tertiary">
                  Next visit ·{" "}
                  <LocalTime iso={upcomingRes.arrival_date} fmt="short_date" />
                </div>
              )}
            </>
          ) : (
            <div className="text-[13px] text-fg-subtle italic">
              No slip on file yet.
            </div>
          )}
        </Panel>

        <Panel icon={<Sailboat className="size-3.5" />} label="Your vessel">
          {primaryVessel ? (
            <>
              <div className="truncate text-[16px] font-medium text-fg">
                {primaryVessel.name}
              </div>
              <div className="mt-1 truncate text-[12px] text-fg-subtle">
                {[primaryVessel.year, primaryVessel.make, primaryVessel.model]
                  .filter(Boolean)
                  .join(" ") || "—"}
              </div>
              {vessels.length > 1 && (
                <div className="mt-2 text-[11px] text-fg-tertiary">
                  +{vessels.length - 1} more on file
                </div>
              )}
            </>
          ) : (
            <div className="text-[13px] text-fg-subtle italic">
              No vessel on file yet.
            </div>
          )}
        </Panel>
      </div>

      {/* Latest message — single-line summary so the member knows the
          marina's most recent touch without leaving the overview. */}
      {latestComm && (
        <div className="flex items-center justify-between gap-3 rounded-[12px] border border-hairline bg-surface-1 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Mail className="size-3.5 shrink-0 text-fg-tertiary" />
            <div className="min-w-0">
              <div className="truncate text-[12px] text-fg">
                <span className="font-medium">
                  {latestComm.subject ?? "(no subject)"}
                </span>
                {latestComm.body_preview && (
                  <span className="text-fg-subtle">
                    {" "}
                    — {latestComm.body_preview}
                  </span>
                )}
              </div>
            </div>
          </div>
          <LocalTime
            iso={latestComm.sent_at}
            fmt="short_datetime"
            className="shrink-0 text-[11px] text-fg-tertiary"
          />
        </div>
      )}

      {/* Join the Rental Club — only when the member isn't enrolled
          and there's a plan to pick. The CTA gives a one-line pitch
          (cheapest monthly + days/month) so the member can decide
          whether it's worth opening the sheet. */}
      {showJoinCta && (
        <JoinClubCta plans={clubPlans} onOpen={() => setJoinOpen(true)} />
      )}

      {/* Recent activity */}
      <Section title="Recent activity" count={visibleLedger.length}>
        {clubSubscription && (
          <div className="border-b border-hairline px-4 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <BillingFilterChip
                label="All"
                value="all"
                current={billingFilter}
                onClick={setBillingFilter}
              />
              <BillingFilterChip
                label="Monthly fees"
                value="club"
                current={billingFilter}
                onClick={setBillingFilter}
              />
              <BillingFilterChip
                label="Other charges"
                value="other"
                current={billingFilter}
                onClick={setBillingFilter}
              />
            </div>
          </div>
        )}
        {visibleLedger.length === 0 ? (
          <EmptyRow
            body={
              clubSubscription && billingFilter !== "all"
                ? `No ${billingFilter === "club" ? "monthly fees" : "other charges"} yet.`
                : "No activity yet."
            }
          />
        ) : (
          <Table
            columns={[
              { key: "type", label: "" },
              { key: "ref", label: "Ref" },
              { key: "date", label: "Date" },
              { key: "amount", label: "Amount" },
            ]}
            templateCols="32px_minmax(0,1.6fr)_120px_120px"
          >
            {visibleLedger.slice(0, 8).map((l) => {
              // Surface a 'Club' badge on Rental Club entries so members
              // can tell their membership fee apart from slip invoices
              // at a glance. We detect via gl_account (canonical) and
              // fall back to the line-item description for legacy data.
              const isClubLedger =
                l.gl_account === "Rental Club Revenue" ||
                l.line_items?.some((li) =>
                  /Rental Club/i.test(li.description)
                );
              return (
                <Row key={l.id} templateCols="32px_minmax(0,1.6fr)_120px_120px">
                  <LedgerIcon type={l.type} />
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate text-[13px] text-fg">
                      {l.type === "invoice"
                        ? `Invoice ${l.number ?? ""}`
                        : l.type === "payment"
                        ? "Payment received"
                        : l.type === "refund"
                        ? "Refund"
                        : l.type}
                    </span>
                    {isClubLedger && (
                      <Badge tone="info" size="sm">
                        Club
                      </Badge>
                    )}
                  </span>
                  <LocalTime
                    iso={l.date}
                    fmt="short_date"
                    className="text-[12px] text-fg-tertiary"
                  />
                  <span
                    className={cn(
                      "money-display text-[13px] tabular",
                      l.type === "payment" ? "text-status-ok" : "text-fg"
                    )}
                  >
                    {l.type === "payment" ? "-" : ""}
                    {formatMoney(l.amount)}
                  </span>
                </Row>
              );
            })}
          </Table>
        )}
      </Section>

      {/* Sheet lives at the bottom of OverviewTab so it has access to
          the same boater/plans context. Renders nothing when closed. */}
      <JoinClubSheet
        open={joinOpen}
        onOpenChange={setJoinOpen}
        boater={boater}
        plans={clubPlans}
        onJoined={() => {
          setJoinOpen(false);
          // After joining, the Club nav item auto-appears because
          // useClubSubscriptionForBoater re-runs through the store
          // subscription. No manual nav switch needed.
        }}
      />
    </div>
  );
}

// ── Join Rental Club CTA + signup sheet ───────────────────────────
//
// Shown on the portal Overview tab when the member isn't already in
// the club and at least one plan is configured. The sheet lists every
// plan with monthly fee + join fee + days/month, then on confirm calls
// joinClubFromPortal to create the subscription, post the join-fee
// invoice (auto-paying if a default card is on file), and dispatch
// the welcome comm.

function JoinClubCta({
  plans,
  onOpen,
}: {
  plans: import("@/lib/types").Rate[];
  onOpen: () => void;
}) {
  // Highlight the cheapest plan as the lead pitch — most members
  // shopping a club land on the entry tier.
  const lead = plans[0];
  if (!lead) return null;
  return (
    <div className="rounded-[12px] border border-primary/30 bg-primary-soft/30 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-primary">
            <Sailboat className="size-3.5" />
            Rental Club
          </div>
          <div className="mt-1 text-[14px] font-medium text-fg">
            Join the Rental Club — skip the slip, take a boat.
          </div>
          <div className="mt-0.5 text-[12px] text-fg-subtle">
            Plans start at {formatMoney(lead.amount)}/mo for{" "}
            {lead.days_per_month ?? 0} days on the water each month.
            {plans.length > 1 ? ` ${plans.length} tiers available.` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="shrink-0 rounded-[10px] bg-primary px-3 py-2 text-[13px] font-medium text-on-primary transition-colors hover:bg-primary-hover"
        >
          See plans
        </button>
      </div>
    </div>
  );
}

function JoinClubSheet({
  open,
  onOpenChange,
  boater,
  plans,
  onJoined,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  boater: Boater;
  plans: import("@/lib/types").Rate[];
  onJoined: () => void;
}) {
  const [selected, setSelected] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  // Per-tier setup fees — now their own catalog rows, looked up by
  // plan_tier from the live rate catalog. Replaces the deprecated
  // `plan.join_fee` embedded field.
  const allRates = useRates();
  const setupForTier = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allRates) {
      if (
        r.occupancy_type === "Rental Club" &&
        r.cadence === "one_time" &&
        r.plan_tier
      ) {
        m.set(r.plan_tier, r.amount);
      }
    }
    return m;
  }, [allRates]);
  const setupAmount = (p: import("@/lib/types").Rate) =>
    p.plan_tier ? setupForTier.get(p.plan_tier) ?? 0 : 0;

  React.useEffect(() => {
    if (open) {
      setSelected(plans[0]?.id ?? null);
      setConfirming(false);
    }
  }, [open, plans]);

  if (!open) return null;

  const plan = plans.find((p) => p.id === selected) ?? null;

  function confirm() {
    if (!plan || confirming) return;
    setConfirming(true);
    const id = joinClubFromPortal(boater.id, plan.id);
    setConfirming(false);
    if (id) {
      const setup = setupAmount(plan);
      window.alert(
        `Welcome aboard! You're on the ${plan.name} plan. ` +
          (setup > 0
            ? `The ${formatMoney(setup)} setup fee posted to your account.`
            : `No setup fee — you're all set.`)
      );
      onJoined();
    } else {
      window.alert("Couldn't enroll — try again, or contact the marina.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[520px] rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-fg">Join the Rental Club</h3>
        <p className="mt-1 text-[12px] text-fg-subtle">
          Pick a plan. You can book days right after enrollment — and you can
          cancel or switch plans anytime.
        </p>

        <ul className="mt-4 space-y-2">
          {plans.map((p) => {
            const isSelected = selected === p.id;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelected(p.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-[12px] border px-3 py-2.5 text-left transition-colors",
                    isSelected
                      ? "border-primary bg-primary-soft/40"
                      : "border-hairline bg-surface-2 hover:border-hairline-strong"
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-fg">{p.name}</span>
                      {p.plan_tier && (
                        <Badge tone="neutral" size="sm">
                          {p.plan_tier}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-fg-subtle">
                      {p.days_per_month ?? 0} days/month
                      {setupAmount(p) > 0
                        ? ` · ${formatMoney(setupAmount(p))} setup fee`
                        : " · No setup fee"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="money-display text-[18px] text-fg">
                      {formatMoney(p.amount)}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
                      / month
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-[8px] px-3 py-1.5 text-[13px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!plan || confirming}
            className={cn(
              "rounded-[10px] px-3 py-2 text-[13px] font-medium transition-colors",
              plan && !confirming
                ? "bg-primary text-on-primary hover:bg-primary-hover"
                : "cursor-not-allowed bg-surface-3 text-fg-tertiary"
            )}
          >
            {plan
              ? setupAmount(plan) > 0
                ? `Join — ${formatMoney(setupAmount(plan))}`
                : "Join"
              : "Join"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Account — contact + vessels + cards (all inline-editable)
// ─────────────────────────────────────────────────────────────────────

function AccountTab({ boater }: { boater: Boater }) {
  const liveVessels = useVesselsForBoater(boater.id);
  const cards = useCardsForBoater(boater.id);
  const vessels =
    liveVessels.length > 0 ? liveVessels : getVesselsForBoater(boater.id);

  return (
    <div className="space-y-4">
      {/* Contact — labeled inline rows */}
      <Section title="Contact info" hint="Click any field to edit. Saves on blur.">
        <div className="divide-y divide-hairline overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
          <ContactRow label="Email">
            <InlineEditCell
              value={boater.primary_contact.email ?? ""}
              placeholder="add email"
              onSave={(next) =>
                updateBoater(boater.id, {
                  primary_contact: {
                    ...boater.primary_contact,
                    email: String(next),
                  },
                })
              }
              inputClassName="w-full max-w-[280px]"
              className="text-[13px] text-fg"
            />
          </ContactRow>
          <ContactRow label="Phone">
            <InlineEditCell
              value={boater.primary_contact.phone ?? ""}
              placeholder="add phone"
              onSave={(next) =>
                updateBoater(boater.id, {
                  primary_contact: {
                    ...boater.primary_contact,
                    phone: String(next),
                  },
                })
              }
              inputClassName="w-full max-w-[200px]"
              className="text-[13px] text-fg"
            />
          </ContactRow>
          <ContactRow label="Street">
            <InlineEditCell
              value={boater.address.line1}
              onSave={(next) =>
                updateBoater(boater.id, {
                  address: { ...boater.address, line1: String(next) },
                })
              }
              inputClassName="w-full max-w-[280px]"
              className="text-[13px] text-fg"
            />
          </ContactRow>
          <ContactRow label="City">
            <InlineEditCell
              value={boater.address.city}
              onSave={(next) =>
                updateBoater(boater.id, {
                  address: { ...boater.address, city: String(next) },
                })
              }
              inputClassName="w-full max-w-[200px]"
              className="text-[13px] text-fg"
            />
          </ContactRow>
          <ContactRow label="State">
            <InlineEditCell
              value={boater.address.state}
              onSave={(next) =>
                updateBoater(boater.id, {
                  address: { ...boater.address, state: String(next) },
                })
              }
              inputClassName="w-20"
              className="text-[13px] text-fg"
            />
          </ContactRow>
          <ContactRow label="Zip">
            <InlineEditCell
              value={boater.address.zip}
              onSave={(next) =>
                updateBoater(boater.id, {
                  address: { ...boater.address, zip: String(next) },
                })
              }
              inputClassName="w-24"
              className="text-[13px] text-fg"
            />
          </ContactRow>
        </div>
      </Section>

      {/* Vessels — tabular, inline editable name + year + make + model */}
      <Section title="Vessels" count={vessels.length} hint="Click any cell to edit.">
        {vessels.length === 0 ? (
          <EmptyRow body="No vessels on file. Ask the agent to add one." />
        ) : (
          <Table
            columns={[
              { key: "name", label: "Name" },
              { key: "year", label: "Year" },
              { key: "make_model", label: "Make / Model" },
              { key: "loa", label: "LOA" },
            ]}
            templateCols="minmax(0,1.4fr)_72px_minmax(0,1.6fr)_72px"
          >
            {vessels.map((v) => (
              <VesselRow key={v.id} vessel={v} />
            ))}
          </Table>
        )}
      </Section>

      {/* Cards — tabular */}
      <Section
        title="Payment methods"
        count={cards.length}
        hint="Click the default toggle to change your auto-pay card."
      >
        {cards.length === 0 ? (
          <EmptyRow body="No cards on file. Ask the agent to add one." />
        ) : (
          <Table
            columns={[
              { key: "brand", label: "Card" },
              { key: "exp", label: "Expires" },
              { key: "nickname", label: "Nickname" },
              { key: "default", label: "Default" },
              { key: "actions", label: "" },
            ]}
            templateCols="minmax(0,1.4fr)_100px_minmax(0,1.4fr)_90px_36px"
          >
            {cards.map((c) => (
              <Row
                key={c.id}
                templateCols="minmax(0,1.4fr)_100px_minmax(0,1.4fr)_90px_36px"
                groupHover
              >
                <span className="text-[13px] font-medium text-fg">
                  {c.brand.toUpperCase()} ending {c.last4}
                </span>
                <span className="text-[12px] tabular text-fg-subtle">
                  {String(c.exp_month).padStart(2, "0")}/{c.exp_year}
                </span>
                <span className="min-w-0">
                  <InlineEditCell
                    value={c.nickname ?? ""}
                    placeholder="add nickname"
                    onSave={() => {
                      // Cards in the store are immutable in the prototype;
                      // operator-side rotation handles nickname today.
                      window.alert(
                        "Card details flow through the marina — message them via the agent to update."
                      );
                    }}
                    inputClassName="w-full max-w-[180px]"
                    className="text-[12px] text-fg-subtle"
                  />
                </span>
                <span>
                  <InlineToggle
                    value={c.is_default}
                    onSave={() => {
                      window.alert(
                        "Ask the agent to change your default card."
                      );
                    }}
                    onLabel="Default"
                    offLabel="Set default"
                  />
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove ${c.brand.toUpperCase()} ending ${c.last4}?`
                      )
                    ) {
                      deleteCardForBoater(boater.id, c.id);
                    }
                  }}
                  className="rounded-md p-1 text-fg-tertiary opacity-0 transition-opacity hover:bg-surface-3 hover:text-status-danger group-hover:opacity-100"
                  aria-label="Remove card"
                  title="Remove"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </Row>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}

function ContactRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="group grid items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
      style={{ gridTemplateColumns: "100px minmax(0, 1fr)" }}
    >
      <span className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function VesselRow({ vessel }: { vessel: Vessel }) {
  return (
    <Row
      templateCols="minmax(0,1.4fr)_72px_minmax(0,1.6fr)_72px"
      groupHover
    >
      <InlineEditCell
        value={vessel.name}
        onSave={(next) =>
          updateVessel(vessel.id, { name: String(next) || vessel.name })
        }
        className="text-[13px] font-medium text-fg"
        inputClassName="w-full max-w-[220px]"
      />
      <InlineEditCell
        value={vessel.year ?? ""}
        kind="number"
        onSave={(next) =>
          updateVessel(vessel.id, { year: Number(next) || undefined })
        }
        inputClassName="w-16"
        className="text-[12px] tabular text-fg-subtle"
      />
      <span className="min-w-0 truncate">
        <InlineEditCell
          value={[vessel.make, vessel.model].filter(Boolean).join(" ")}
          placeholder="add make + model"
          onSave={(next) => {
            const parts = String(next).split(/\s+/);
            updateVessel(vessel.id, {
              make: parts[0] || undefined,
              model: parts.slice(1).join(" ") || undefined,
            });
          }}
          inputClassName="w-full max-w-[220px]"
          className="text-[12px] text-fg-subtle"
        />
      </span>
      <span className="text-[12px] tabular text-fg-subtle">
        {vessel.loa_inches ? `${(vessel.loa_inches / 12).toFixed(0)}'` : "—"}
      </span>
    </Row>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Rental Club — member view of their subscription + bookings
//
// Three blocks stacked:
//   1. Plan summary card — tier, monthly fee, days remaining this month
//   2. Upcoming bookings — confirmed + requested days
//   3. Past bookings + Request-a-day CTA
//
// Members never see other members' bookings. Cancelling sets the
// booking to status=cancelled rather than deleting (so the operator
// still sees the audit trail).
// ─────────────────────────────────────────────────────────────────────

function ClubTab({
  boater,
  subscription,
}: {
  boater: Boater;
  subscription: import("@/lib/types").ClubSubscription;
}) {
  const bookings = useClubBookingsForBoater(boater.id);
  const plan = useEffectivePlanFor(subscription);
  const [requestOpen, setRequestOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  const now = new Date();
  const thisMonthPrefix = `${now.getFullYear()}-${String(
    now.getMonth() + 1
  ).padStart(2, "0")}`;
  const todayIso = localIsoDate(now);

  const thisMonthBookings = bookings.filter(
    (b) =>
      b.date.startsWith(thisMonthPrefix) &&
      b.status !== "cancelled" &&
      b.status !== "no_show"
  );
  const daysUsedThisMonth = thisMonthBookings.length;
  const daysRemaining = Math.max(
    0,
    (plan?.days_per_month ?? 0) - daysUsedThisMonth
  );

  // Upcoming = anything happening today or later that isn't a closed
  // state. Includes `checked_in` so the member sees their day-of
  // status when staff has already started the rental for them.
  const upcoming = bookings
    .filter(
      (b) =>
        b.date >= todayIso &&
        (b.status === "confirmed" ||
          b.status === "requested" ||
          b.status === "checked_in")
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const past = bookings
    .filter((b) => b.date < todayIso || b.status === "completed")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Plan summary */}
      <section className="rounded-[12px] border border-hairline bg-surface-1 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sailboat className="size-4 text-primary" />
              <h2 className="text-[15px] font-semibold text-fg">
                Rental Club
              </h2>
              <ClubStatusBadge status={subscription.status} />
            </div>
            <div className="mt-0.5 text-[12px] text-fg-subtle capitalize">
              {plan?.plan_tier ?? "—"} plan · member since{" "}
              {subscription.member_since}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRequestOpen(true)}
            disabled={
              subscription.status !== "active" || daysRemaining === 0
            }
            className={cn(
              "inline-flex items-center gap-1 rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors",
              subscription.status === "active" && daysRemaining > 0
                ? "bg-primary text-on-primary hover:bg-primary-hover"
                : "cursor-not-allowed bg-surface-3 text-fg-tertiary"
            )}
            title={
              daysRemaining === 0
                ? "You've used all your days this month"
                : subscription.status !== "active"
                ? `Membership is ${subscription.status}`
                : "Request a club day"
            }
          >
            <Plus className="size-3" />
            Request a day
          </button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-[8px] bg-surface-2 p-2.5">
            <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
              Monthly fee
            </div>
            <div className="money-display mt-0.5 text-[16px] text-fg">
              {formatMoney(plan?.monthly_fee ?? 0)}
            </div>
          </div>
          <div className="rounded-[8px] bg-surface-2 p-2.5">
            <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
              Days this month
            </div>
            <div className="money-display mt-0.5 text-[16px] text-fg">
              {daysUsedThisMonth} / {plan?.days_per_month ?? "—"}
            </div>
          </div>
          <div className="rounded-[8px] bg-surface-2 p-2.5">
            <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
              Next billing
            </div>
            <div className="money-display mt-0.5 text-[16px] text-fg">
              {subscription.next_billing_date ?? "—"}
            </div>
          </div>
        </div>
        {subscription.status === "past_due" && (
          <div className="mt-3 rounded-[8px] border border-status-warn/30 bg-status-warn/10 px-3 py-2 text-[12px] text-status-warn">
            Your membership is past due. Update your card or reach out to the
            marina to keep booking days.
          </div>
        )}
      </section>

      {/* Notifications — channel overrides for club comms. Falls back
          to the member's primary preferred_channel (set on Account) when
          either is left blank. */}
      <ClubChannelsCard subscription={subscription} boater={boater} />

      {/* Upcoming bookings */}
      <section className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <header className="border-b border-hairline px-4 py-2.5">
          <h3 className="text-[13px] font-medium text-fg">
            Upcoming bookings
          </h3>
        </header>
        {upcoming.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-fg-tertiary">
            No upcoming days. Tap{" "}
            <span className="font-medium text-fg-subtle">Request a day</span>{" "}
            to schedule one.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {upcoming.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between px-4 py-2.5 text-[13px]"
              >
                <div className="min-w-0">
                  <LocalTime
                    iso={b.date}
                    fmt="weekday"
                    className="font-medium text-fg"
                  />
                  {b.notes && (
                    <div className="text-[11px] text-fg-tertiary">
                      {b.notes}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <BookingStatusBadge status={b.status} />
                  {/* Cancel button hidden once the rental is live —
                      the day's already happening, so cancellation has
                      to go through staff. */}
                  {b.status !== "checked_in" && (
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Cancel your booking for ${b.date}?`
                          )
                        )
                          return;
                        upsertClubBooking({ ...b, status: "cancelled" });
                      }}
                      className="rounded-md p-1 text-fg-tertiary hover:bg-surface-3 hover:text-status-danger"
                      aria-label={`Cancel booking on ${b.date}`}
                      title="Cancel booking"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Past bookings */}
      {past.length > 0 && (
        <section className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
          <header className="border-b border-hairline px-4 py-2.5">
            <h3 className="text-[13px] font-medium text-fg">
              Recent bookings
            </h3>
          </header>
          <ul className="divide-y divide-hairline">
            {past.map((b) => {
              const ratable = b.status === "completed" || b.status === "checked_in";
              return (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] text-fg-subtle"
                >
                  <div className="min-w-0">
                    <LocalTime iso={b.date} fmt="weekday" />
                    {/* One-tap sentiment row. Shows under unrated days
                        the member can act on. Once rated, swaps to a
                        muted "Thanks!" with the chosen emoji. */}
                    {ratable && (
                      <SentimentRow
                        bookingId={b.id}
                        current={b.sentiment}
                      />
                    )}
                  </div>
                  <BookingStatusBadge status={b.status} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Lifecycle actions — Pause (active only) + Cancel (any non-
          cancelled). Quiet bottom-of-page link style; cancellation
          first surfaces a retention offer (50% off next month) so the
          member has a graceful off-ramp. */}
      {subscription.status !== "cancelled" && (
        <div className="flex items-center justify-center gap-4 pt-2">
          {subscription.status === "active" && (
            <button
              type="button"
              onClick={() => {
                if (
                  !window.confirm(
                    `Pause your Rental Club membership? Billing stops and forward bookings will be cancelled. Resume anytime from this page.`
                  )
                )
                  return;
                pauseClubSubscription(subscription.id);
              }}
              className="text-[11px] text-fg-tertiary underline underline-offset-2 hover:text-fg"
            >
              Pause membership
            </button>
          )}
          <button
            type="button"
            onClick={() => setCancelOpen(true)}
            className="text-[11px] text-fg-tertiary underline underline-offset-2 hover:text-status-danger"
          >
            Cancel membership
          </button>
        </div>
      )}

      <RequestDaySheet
        open={requestOpen}
        onOpenChange={setRequestOpen}
        boater={boater}
        subscription={subscription}
      />
      <CancelMembershipSheet
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        subscription={subscription}
      />
    </div>
  );
}

/*
 * Member-side card for splitting comm channels. Booking confirmations
 * (arrival reminders, day-of texts) often want SMS; billing receipts
 * usually want email. When either is left blank, the marina falls
 * back to the member's primary preferred channel (set on Account).
 *
 * Changes save instantly via upsertClubSubscription — no save button,
 * no dirty state. Mirrors the inline-edit pattern used everywhere else
 * in the portal.
 */
// Filter chip used in the OverviewTab activity table when the member
// is in the club. Same shape as the staff /members filter row.
function BillingFilterChip({
  label,
  value,
  current,
  onClick,
}: {
  label: string;
  value: "all" | "club" | "other";
  current: "all" | "club" | "other";
  onClick: (v: "all" | "club" | "other") => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
        active
          ? "border-primary/40 bg-primary-soft text-primary"
          : "border-hairline bg-surface-1 text-fg-muted hover:border-hairline-strong hover:bg-surface-2"
      )}
    >
      {label}
    </button>
  );
}

function ClubChannelsCard({
  subscription,
  boater,
}: {
  subscription: import("@/lib/types").ClubSubscription;
  boater: Boater;
}) {
  const defaultChannel = boater.communication_prefs.preferred_channel;
  const bookingChannel = subscription.booking_channel ?? "";
  const billingChannel = subscription.billing_channel ?? "";

  function update(field: "booking_channel" | "billing_channel", value: string) {
    upsertClubSubscription({
      ...subscription,
      [field]: value || undefined,
    });
  }

  return (
    <section className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
      <header className="border-b border-hairline px-4 py-2.5">
        <h3 className="text-[13px] font-medium text-fg">Notifications</h3>
        <p className="mt-0.5 text-[11px] text-fg-tertiary">
          Default channel for everything else:{" "}
          <span className="font-medium text-fg-subtle capitalize">
            {defaultChannel}
          </span>{" "}
          (set on Account)
        </p>
      </header>
      <div className="space-y-3 p-4">
        <ChannelRow
          label="Booking confirmations"
          value={bookingChannel}
          defaultLabel={defaultChannel}
          onChange={(v) => update("booking_channel", v)}
        />
        <ChannelRow
          label="Monthly billing receipts"
          value={billingChannel}
          defaultLabel={defaultChannel}
          onChange={(v) => update("billing_channel", v)}
        />
      </div>
    </section>
  );
}

function ChannelRow({
  label,
  value,
  defaultLabel,
  onChange,
}: {
  label: string;
  value: string;
  defaultLabel: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-fg">{label}</div>
        <div className="text-[11px] text-fg-tertiary">
          {value
            ? `Sent by ${value}`
            : `Using default — ${defaultLabel}`}
        </div>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-[6px] border border-hairline bg-surface-2 px-2 py-1 text-[12px] text-fg focus:border-primary focus:outline-none"
        aria-label={`${label} channel`}
      >
        <option value="">Default</option>
        <option value="email">Email</option>
        <option value="sms">SMS</option>
        <option value="voice">Voice</option>
      </select>
    </div>
  );
}

function ClubStatusBadge({
  status,
}: {
  status: import("@/lib/types").ClubSubscription["status"];
}) {
  if (status === "active") return <Badge tone="ok" size="sm">Active</Badge>;
  if (status === "past_due") return <Badge tone="warn" size="sm">Past due</Badge>;
  if (status === "paused") return <Badge tone="neutral" size="sm">Paused</Badge>;
  return <Badge tone="danger" size="sm">Cancelled</Badge>;
}

// One-tap sentiment selector for past/completed club bookings.
// Three buckets (happy / neutral / sad) so the member doesn't have to
// think. Once rated, the row collapses to a quiet "Thanks!" tag so
// the member knows it landed without nagging them to re-pick.
function SentimentRow({
  bookingId,
  current,
}: {
  bookingId: string;
  current?: import("@/lib/types").ClubBookingSentiment;
}) {
  if (current) {
    const emoji =
      current === "happy" ? "😀" : current === "neutral" ? "😐" : "😞";
    return (
      <div className="mt-1 text-[10px] text-fg-tertiary">
        <span>Thanks for rating —</span> <span>{emoji}</span>
      </div>
    );
  }
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-fg-tertiary">
      <span>How was it?</span>
      <SentimentButton
        bookingId={bookingId}
        sentiment="happy"
        emoji="😀"
        label="Happy"
      />
      <SentimentButton
        bookingId={bookingId}
        sentiment="neutral"
        emoji="😐"
        label="Neutral"
      />
      <SentimentButton
        bookingId={bookingId}
        sentiment="sad"
        emoji="😞"
        label="Sad"
      />
    </div>
  );
}

function SentimentButton({
  bookingId,
  sentiment,
  emoji,
  label,
}: {
  bookingId: string;
  sentiment: import("@/lib/types").ClubBookingSentiment;
  emoji: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => setClubBookingSentiment(bookingId, sentiment)}
      aria-label={label}
      title={label}
      className="rounded-full p-1 text-[14px] leading-none transition-transform hover:scale-110"
    >
      {emoji}
    </button>
  );
}

function BookingStatusBadge({
  status,
}: {
  status: import("@/lib/types").ClubBooking["status"];
}) {
  if (status === "confirmed")
    return <Badge tone="ok" size="sm">Confirmed</Badge>;
  if (status === "requested")
    return <Badge tone="warn" size="sm">Pending</Badge>;
  if (status === "checked_in")
    return <Badge tone="info" size="sm">Checked in</Badge>;
  if (status === "completed")
    return <Badge tone="neutral" size="sm">Completed</Badge>;
  if (status === "no_show")
    return <Badge tone="danger" size="sm">No show</Badge>;
  return <Badge tone="danger" size="sm">Cancelled</Badge>;
}

// Lightweight request-a-day sheet. Mobile-friendly modal-ish UI on top
// of native <dialog>. Submits as status=requested so staff review it
// before confirming.
function RequestDaySheet({
  open,
  onOpenChange,
  boater,
  subscription,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  boater: Boater;
  subscription: import("@/lib/types").ClubSubscription;
}) {
  const [date, setDate] = React.useState("");
  const [notes, setNotes] = React.useState("");

  // Reset on close
  React.useEffect(() => {
    if (!open) {
      setDate("");
      setNotes("");
    }
  }, [open]);

  if (!open) return null;

  const minDate = localIsoDate();

  // Capacity check — runs whenever the date input changes. When 0
  // available, block submission. When ≤2 available, warn but allow.
  const capacity = date ? getClubCapacityForDate(date) : null;
  const capacityFull = capacity ? capacity.available === 0 : false;
  const capacityTight =
    capacity ? capacity.available > 0 && capacity.available <= 2 : false;

  function submit() {
    if (!date || capacityFull) return;
    upsertClubBooking({
      id: nextClubBookingId(),
      subscription_id: subscription.id,
      boater_id: boater.id,
      date,
      status: "requested",
      notes: notes.trim() || undefined,
      created_at: new Date().toISOString(),
    });
    onOpenChange(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[420px] rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-fg">Request a club day</h3>
        <p className="mt-1 text-[12px] text-fg-subtle">
          The marina confirms the boat assignment. You&apos;ll get a message
          once it&apos;s booked.
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
              Date
            </label>
            <input
              type="date"
              value={date}
              min={minDate}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
            {/* Real-time capacity hint. The marina has a small fleet,
                so popular days fill up. We surface "fully booked" /
                "limited" before the request is submitted to set
                expectations. */}
            {capacity && (
              <p
                className={cn(
                  "mt-1.5 text-[11px]",
                  capacityFull
                    ? "text-status-danger"
                    : capacityTight
                    ? "text-status-warn"
                    : "text-fg-subtle"
                )}
              >
                {capacityFull
                  ? `Fully booked — ${capacity.fleetSize} of ${capacity.fleetSize} boats reserved. Try another day.`
                  : capacityTight
                  ? `Limited availability — only ${capacity.available} ${capacity.available === 1 ? "boat" : "boats"} left.`
                  : `${capacity.available} of ${capacity.fleetSize} boats available.`}
              </p>
            )}
          </div>
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Boat preference, party size, etc."
              className="mt-1 block w-full resize-none rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-[8px] px-3 py-1.5 text-[13px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!date || capacityFull}
            title={
              capacityFull
                ? "Fully booked for this day — pick another date."
                : !date
                ? "Pick a date first"
                : "Submit request"
            }
            className={cn(
              "rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition-colors",
              date && !capacityFull
                ? "bg-primary text-on-primary hover:bg-primary-hover"
                : "cursor-not-allowed bg-surface-3 text-fg-tertiary"
            )}
          >
            Request
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// CancelMembershipSheet — retention offer + final confirm
//
// Two-step flow: first surface a "50% off next month" offer; if the
// member accepts, set retention_credit_pct on their sub and keep the
// membership. If they decline, run the standard cancellation flow
// (which posts the pro-rate refund).
// ─────────────────────────────────────────────────────────────────────

function CancelMembershipSheet({
  open,
  onOpenChange,
  subscription,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  subscription: import("@/lib/types").ClubSubscription;
}) {
  // Variant pool comes from tenant config — Settings → Customization
  // → Rental Club lets the marina admin enable/disable each one. Falls
  // back to all 3 when unconfigured; falls back to "half_off" only
  // when the operator has disabled every variant (defense against an
  // empty cancel sheet).
  const profile = useMarinaProfile();
  const plan = useEffectivePlanFor(subscription);
  const clubPlans = useClubPlans();
  // Full rate catalog — used to look up the setup-fee Rate for any
  // tier the member might downgrade to. Setup fees are no longer
  // embedded on plan rows; they're their own catalog entries.
  const allRates = useRates();
  // Find the next-cheaper plan for the downgrade variant. Plans are
  // sorted ascending by amount in useClubPlans(), so we look for the
  // last plan whose amount is strictly less than the current one. Null
  // when the member is already on the cheapest plan (downgrade still
  // works — falls through to the cheapest plan itself).
  const downgradePlan = React.useMemo(() => {
    if (!plan) return null;
    const cheaper = clubPlans.filter((p) => p.amount < plan.monthly_fee);
    return cheaper.length > 0 ? cheaper[cheaper.length - 1] : null;
  }, [plan, clubPlans]);
  const enabledVariants: import("@/lib/types").RetentionOfferVariant[] =
    profile.enabled_retention_variants ?? ["half_off", "free_month", "downgrade"];
  // Defense: if the operator disabled every variant in Settings →
  // Customization, fall back to half_off so the cancel sheet never
  // shows an empty offer. Typed as the union (not string) so the
  // member's recorded variant stays narrow. Also drop the downgrade
  // variant when there's no cheaper plan to step down to.
  const variantPool: import("@/lib/types").RetentionOfferVariant[] = (() => {
    const filtered = enabledVariants.filter(
      (v) => v !== "downgrade" || downgradePlan !== null
    );
    return filtered.length > 0 ? filtered : ["half_off"];
  })();

  // Pick + persist a variant on first open. The same member seeing
  // the same variant twice is intentional — we don't want to flip
  // the offer mid-decision.
  React.useEffect(() => {
    if (!open) return;
    if (subscription.retention_offer_shown_at) return;
    const variant =
      variantPool[Math.floor(Math.random() * variantPool.length)];
    upsertClubSubscription({
      ...subscription,
      retention_offer_shown_at: new Date().toISOString(),
      retention_offer_variant: variant,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  // Resolve which variant to render. Fall back to half_off when the
  // sub doesn't have one yet (first frame after open, before the
  // effect commits). Mirrors React's two-pass render gracefully.
  const variant: import("@/lib/types").RetentionOfferVariant =
    subscription.retention_offer_variant ?? "half_off";

  // Variant-specific math + copy.
  const isHalfOff = variant === "half_off";
  const isFreeMonth = variant === "free_month";
  // Current plan summary (with sensible fallbacks if the plan
  // catalog row was deleted — sub still renders, just with empty
  // labels rather than crashing).
  const currentMonthlyFee = plan?.monthly_fee ?? 0;
  const currentPlanName = plan?.plan_name ?? "current";
  const downgradeName = downgradePlan?.name ?? "cheaper";
  const downgradeFee = downgradePlan?.amount ?? 0;
  const downgradeDays = downgradePlan?.days_per_month ?? 0;

  const heading = isHalfOff
    ? "Before you go — 50% off next month?"
    : isFreeMonth
    ? "Before you go — your next month on us?"
    : `Before you go — switch to the ${downgradeName} plan?`;
  const subhead = isHalfOff
    ? `We'd hate to see you leave. Stay on your ${currentPlanName} plan and we'll knock 50% off your next monthly invoice.`
    : isFreeMonth
    ? `We'd hate to see you leave. Stay on your ${currentPlanName} plan and we'll comp your next monthly invoice entirely.`
    : `We'd hate to see you leave. Step down to the ${downgradeName} plan — fewer days, lower monthly. You can always upgrade back.`;

  const discountedFee = isHalfOff
    ? +(currentMonthlyFee * 0.5).toFixed(2)
    : isFreeMonth
    ? 0
    : downgradeFee;
  const offerLabel = isHalfOff
    ? "With 50% credit"
    : isFreeMonth
    ? "First month free"
    : `${downgradeName} plan`;
  const acceptLabel = isHalfOff
    ? "Yes — keep my membership with the credit"
    : isFreeMonth
    ? "Yes — give me the free month"
    : `Yes — move me to ${downgradeName}`;

  function acceptOffer() {
    if (isHalfOff) {
      upsertClubSubscription({
        ...subscription,
        retention_credit_pct: 50,
        retention_offer_outcome: "accepted",
      });
      window.alert(
        `Done. Your next monthly invoice will be ${formatMoney(discountedFee)} instead of ${formatMoney(currentMonthlyFee)}.`
      );
    } else if (isFreeMonth) {
      upsertClubSubscription({
        ...subscription,
        retention_credit_pct: 100,
        retention_offer_outcome: "accepted",
      });
      window.alert(
        `Done. Your next monthly invoice is on us. After that you're back to ${formatMoney(currentMonthlyFee)}/mo.`
      );
    } else if (downgradePlan) {
      // Downgrade — repoint plan_rate_id at the cheaper plan and
      // snapshot the new joined_at_* values so future price changes
      // grandfather correctly. retention_credit_pct stays 0 — the
      // price reduction IS the save.
      // Setup fee for the downgrade plan now lives as its own catalog
      // Rate (cadence: one_time, matching plan_tier) — look it up
      // live rather than reading a `join_fee` field that no longer
      // exists on the plan row.
      const downgradeSetup = allRates.find(
        (r) =>
          r.occupancy_type === "Rental Club" &&
          r.cadence === "one_time" &&
          r.plan_tier === downgradePlan.plan_tier
      );
      upsertClubSubscription({
        ...subscription,
        plan_rate_id: downgradePlan.id,
        joined_at_monthly_fee: downgradePlan.amount,
        joined_at_join_fee: downgradeSetup?.amount ?? 0,
        joined_at_days_per_month: downgradePlan.days_per_month ?? 0,
        retention_offer_outcome: "accepted",
      });
      window.alert(
        `Done. You're on the ${downgradeName} plan now — ${formatMoney(downgradeFee)}/mo, ${downgradeDays} days/month.`
      );
    }
    onOpenChange(false);
  }
  function confirmCancel() {
    upsertClubSubscription({
      ...subscription,
      retention_offer_outcome: "declined",
    });
    const result = cancelClubSubscription(subscription.id);
    onOpenChange(false);
    if (result.ok && result.refundAmount > 0) {
      window.alert(
        `Cancelled. ${formatMoney(result.refundAmount)} will be refunded to your card on file in 3–5 business days.`
      );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[440px] rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-fg">{heading}</h3>
        <p className="mt-1 text-[12px] text-fg-subtle">{subhead}</p>
        <div className="mt-4 rounded-[10px] border border-hairline bg-surface-2 p-3 text-[13px]">
          <div className="flex items-center justify-between">
            <span className="text-fg-subtle">Current monthly</span>
            <span className="money-display text-fg">
              {formatMoney(currentMonthlyFee)}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between font-medium text-status-ok">
            <span>{offerLabel}</span>
            <span className="money-display">{formatMoney(discountedFee)}</span>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={acceptOffer}
            className="rounded-[10px] bg-primary px-3 py-2 text-[13px] font-medium text-on-primary transition-colors hover:bg-primary-hover"
          >
            {acceptLabel}
          </button>
          <button
            type="button"
            onClick={confirmCancel}
            className="rounded-[10px] border border-hairline px-3 py-2 text-[13px] text-fg-subtle transition-colors hover:border-status-danger/40 hover:text-status-danger"
          >
            No thanks, cancel anyway
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-[11px] text-fg-tertiary hover:text-fg"
          >
            Never mind, keep me on
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Contract — terms (read-only) + actions
// ─────────────────────────────────────────────────────────────────────

function ContractTab({ boater }: { boater: Boater }) {
  const contracts = useContractsForBoater(boater.id);
  const active =
    contracts.find((c) => c.status === "executed") ?? contracts[0];

  if (!active) {
    return (
      <div className="rounded-[12px] border border-dashed border-hairline-strong bg-surface-1 px-6 py-10 text-center text-[13px] text-fg-subtle">
        No contract on file yet. Ask the agent if you have questions about
        getting one.
      </div>
    );
  }

  const slip = active.slip_id ? getSlip(active.slip_id) : null;

  return (
    <div className="space-y-4">
      <Section title={`Contract ${active.number}`}>
        <div className="divide-y divide-hairline overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
          <KvRow label="Status">
            <Badge tone={active.status === "executed" ? "ok" : "neutral"} size="sm">
              {active.status.replace("_", " ")}
            </Badge>
          </KvRow>
          <KvRow label="Effective">
            <span className="text-[13px] text-fg">
              <LocalTime iso={active.effective_start} fmt="short_date" />
              {" → "}
              <LocalTime iso={active.effective_end} fmt="short_date" />
            </span>
          </KvRow>
          {active.annual_rate ? (
            <KvRow label="Annual rate">
              <span className="money-display text-[13px] text-fg">
                {formatMoney(active.annual_rate)}
              </span>
            </KvRow>
          ) : null}
          <KvRow label="Billing">
            <span className="text-[13px] capitalize text-fg">
              {active.billing_cadence}
            </span>
          </KvRow>
          {slip ? (
            <KvRow label="Slip">
              <span className="text-[13px] text-fg">{slip.id}</span>
            </KvRow>
          ) : null}
          {active.signed_at ? (
            <KvRow label="Signed">
              <LocalTime
                iso={active.signed_at}
                fmt="short_date"
                className="text-[13px] text-fg-subtle"
              />
            </KvRow>
          ) : null}
        </div>
      </Section>

      {/* Quick-fire requests — same destinations as the agent tools */}
      <Section
        title="Need a change?"
        hint="These go to the marina to review — type to the agent above for anything else."
      >
        <div className="flex flex-wrap gap-2">
          <ActionPill
            label="Discuss renewal"
            href="#"
            agentPrompt="I'd like to talk about renewing for next season."
          />
          <ActionPill
            label="Request a different slip"
            href="#"
            agentPrompt="I'd like to request a different slip — could we discuss options?"
          />
          <ActionPill
            label="Request termination"
            href="#"
            agentPrompt="I'd like to start the process to cancel my contract."
            tone="danger"
          />
        </div>
      </Section>

      {active.signature_token ? (
        <Section title="Document">
          <Link
            href={`/sign/${active.signature_token}`}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-hairline bg-surface-1 px-3 py-2 text-[13px] text-fg-subtle hover:border-hairline-strong hover:bg-surface-2"
          >
            <FileText className="size-3.5" />
            View signed contract
          </Link>
        </Section>
      ) : null}
    </div>
  );
}

function KvRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="grid items-center gap-3 px-4 py-2.5"
      style={{ gridTemplateColumns: "120px minmax(0, 1fr)" }}
    >
      <span className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function ActionPill({
  label,
  agentPrompt,
  tone = "neutral",
}: {
  label: string;
  href?: string;
  agentPrompt: string;
  tone?: "neutral" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={() => {
        // Focus the agent input and prefill — the chat lives in the
        // sibling hero above, the input is the only text input with this
        // placeholder shape.
        const input = document.querySelector<HTMLInputElement>(
          'input[placeholder="Type to the marina…"]'
        );
        if (input) {
          input.value = agentPrompt;
          input.focus();
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
        tone === "danger"
          ? "border-status-danger/30 bg-status-danger/5 text-status-danger hover:bg-status-danger/10"
          : "border-hairline bg-surface-2 text-fg hover:bg-surface-3"
      )}
    >
      <Sparkles className="size-3" />
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Inbox — recent comms (read-only, tabular)
// ─────────────────────────────────────────────────────────────────────

function InboxTab({ boater }: { boater: Boater }) {
  const comms = useCommunicationsForBoater(boater.id);
  const sorted = [...comms].sort((a, b) =>
    a.sent_at < b.sent_at ? 1 : -1
  );
  // Club filter — only renders when the member has subscription
  // history. Lets them isolate booking confirmations + monthly billing
  // receipts from other marina messages.
  const clubSubscription = useClubSubscriptionForBoater(boater.id);
  const [inboxFilter, setInboxFilter] = React.useState<"all" | "club" | "other">(
    "all"
  );
  // Match comms whose subject / id signals a club origin. Covers:
  //   - cm_club_billing_…  → monthly billing receipt
  //   - cm_club_book_…     → booking confirm / check-in
  //   - subjects starting with "Rental Club" or "Club day"
  function isClubComm(c: import("@/lib/types").Communication): boolean {
    if (c.id.startsWith("cm_club_")) return true;
    const subj = c.subject ?? "";
    return /^(Rental Club|Club day|Welcome aboard)/i.test(subj);
  }
  const visible =
    !clubSubscription || inboxFilter === "all"
      ? sorted
      : inboxFilter === "club"
      ? sorted.filter(isClubComm)
      : sorted.filter((c) => !isClubComm(c));

  return (
    <Section title="Messages" count={visible.length}>
      {clubSubscription && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
          <BillingFilterChip
            label="All"
            value="all"
            current={inboxFilter}
            onClick={setInboxFilter}
          />
          <BillingFilterChip
            label="Club"
            value="club"
            current={inboxFilter}
            onClick={setInboxFilter}
          />
          <BillingFilterChip
            label="Other"
            value="other"
            current={inboxFilter}
            onClick={setInboxFilter}
          />
        </div>
      )}
      {visible.length === 0 ? (
        <EmptyRow
          body={
            clubSubscription && inboxFilter !== "all"
              ? `No ${inboxFilter === "club" ? "club messages" : "other messages"} yet.`
              : "No messages yet."
          }
        />
      ) : (
        <Table
          columns={[
            { key: "dir", label: "" },
            { key: "subject", label: "Subject" },
            { key: "channel", label: "Channel" },
            { key: "date", label: "Date" },
          ]}
          templateCols="28px_minmax(0,2fr)_88px_120px"
        >
          {visible.slice(0, 20).map((c) => (
            <Row
              key={c.id}
              templateCols="28px_minmax(0,2fr)_88px_120px"
              groupHover
            >
              <span className="text-fg-tertiary">
                {c.direction === "inbound" ? (
                  <Sparkles className="size-3" />
                ) : (
                  <Mail className="size-3" />
                )}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] text-fg">
                    {c.subject ?? "(no subject)"}
                  </span>
                  {isClubComm(c) && (
                    <Badge tone="info" size="sm">
                      Club
                    </Badge>
                  )}
                </div>
                {c.body_preview && (
                  <div className="truncate text-[11px] text-fg-tertiary">
                    {c.body_preview}
                  </div>
                )}
              </div>
              <span className="text-[11px] capitalize text-fg-subtle">
                {c.type}
              </span>
              <LocalTime
                iso={c.sent_at}
                fmt="short_datetime"
                className="text-[11px] text-fg-tertiary"
              />
            </Row>
          ))}
        </Table>
      )}
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Generic primitives
// ─────────────────────────────────────────────────────────────────────

function Section({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count?: number;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4 first:mt-0">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          <h2 className="text-[12px] font-medium uppercase tracking-wide text-fg-tertiary">
            {title}
          </h2>
          {count !== undefined && count > 0 && (
            <span className="text-[11px] text-fg-tertiary">{count}</span>
          )}
        </div>
        {hint && <span className="text-[11px] text-fg-tertiary">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Table({
  columns,
  templateCols,
  children,
}: {
  columns: { key: string; label: string }[];
  templateCols: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
      <div
        className="grid gap-x-3 border-b border-hairline bg-surface-2 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
        style={{ gridTemplateColumns: templateCols.replace(/_/g, " ") }}
      >
        {columns.map((c) => (
          <span key={c.key}>{c.label}</span>
        ))}
      </div>
      <ul className="divide-y divide-hairline">{children}</ul>
    </div>
  );
}

function Row({
  templateCols,
  groupHover,
  children,
}: {
  templateCols: string;
  groupHover?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li
      className={cn(
        "grid items-center gap-x-3 px-4 py-2.5",
        groupHover && "group transition-colors hover:bg-surface-2"
      )}
      style={{ gridTemplateColumns: templateCols.replace(/_/g, " ") }}
    >
      {children}
    </li>
  );
}

function LedgerIcon({ type }: { type: string }) {
  const tone =
    type === "payment"
      ? "text-status-ok"
      : type === "refund"
      ? "text-status-info"
      : "text-fg-tertiary";
  const Icon = type === "payment" ? Plus : Mail;
  return (
    <span className={tone}>
      <Icon className="size-3" />
    </span>
  );
}

function Panel({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[14px] border border-hairline bg-surface-1 p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
        {icon}
        {label}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function EmptyRow({ body }: { body: string }) {
  return (
    <div className="rounded-[12px] border border-dashed border-hairline-strong bg-surface-1 px-4 py-6 text-center text-[12px] text-fg-tertiary">
      {body}
    </div>
  );
}

// Compact "short_date" formatter for cases where the date needs to land
// inside a template literal (e.g. composing a sentence) rather than as
// its own DOM node. JSX callsites should use <LocalTime> instead — this
// helper mirrors the same date-only parsing path so a YYYY-MM-DD string
// renders as the same calendar day on server + client.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
function formatDate(iso: string) {
  try {
    const d = DATE_ONLY_RE.test(iso)
      ? (() => {
          const [y, m, dd] = iso.split("-").map(Number);
          return new Date(y, m - 1, dd);
        })()
      : new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const today = new Date();
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
    });
  } catch {
    return iso;
  }
}
