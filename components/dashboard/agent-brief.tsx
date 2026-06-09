"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import {
  useAuditLog,
  useBills,
  useBoaters,
  useClubBookings,
  useExtractionDrafts,
  useMarinaProfile,
  useReservations,
  useStore,
  useVessels,
} from "@/lib/client-store";
import { cn } from "@/lib/utils";

/*
 * AgentBrief — bulleted status snapshot.
 *
 * Renders the marina's current state as a bulleted list with inline
 * action chips below. When `embedded` is true, drops the outer container
 * so the brief lives inside the agent box (one unified surface).
 */

const LAST_VISIT_KEY = "marina-stee:dashboard:last-visit";

export function AgentBrief({ embedded = false }: { embedded?: boolean } = {}) {
  const [mounted, setMounted] = React.useState(false);
  const [lastVisit, setLastVisit] = React.useState<number | null>(null);
  const [greeting, setGreeting] = React.useState("Hello");

  const profile = useMarinaProfile();
  const { ledger, insurance, workOrders } = useStore();
  const bills = useBills();
  const boaters = useBoaters();
  const vessels = useVessels();
  const reservations = useReservations();
  const clubBookings = useClubBookings();
  const auditLog = useAuditLog();
  const allDrafts = useExtractionDrafts();

  React.useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");
    const prior = typeof window !== "undefined" ? localStorage.getItem(LAST_VISIT_KEY) : null;
    setLastVisit(prior ? Number(prior) : null);
    if (typeof window !== "undefined") {
      localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
    }
    setMounted(true);
  }, []);

  // ── Data ─────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const boaterIds = new Set(boaters.map((b) => b.id));
  const boaterById = React.useMemo(
    () => new Map(boaters.map((b) => [b.id, b])),
    [boaters]
  );
  const vesselById = React.useMemo(
    () => new Map(vessels.map((v) => [v.id, v])),
    [vessels]
  );

  const pastDueInvoices = ledger.filter(
    (l) =>
      l.type === "invoice" &&
      l.open_balance > 0 &&
      boaterIds.has(l.boater_id)
  );
  const pastDueAR = pastDueInvoices.reduce((s, l) => s + l.open_balance, 0);
  const pastDueAccounts = new Set(pastDueInvoices.map((l) => l.boater_id)).size;

  const pastDueBills = bills.filter(
    (b) => b.status !== "paid" && b.due_date < today
  );
  const pastDueBillsTotal = pastDueBills.reduce(
    (s, b) => s + (b.amount - b.amount_paid),
    0
  );

  const urgentWO = workOrders.filter(
    (w) =>
      (w.priority === "urgent" || w.flagged) &&
      ["open", "scheduled", "in_progress", "blocked"].includes(w.status)
  );
  const pendingClub = clubBookings.filter((b) => b.status === "requested");

  const now = Date.now();
  const thirtyDays = 30 * 86_400_000;
  const coiAtRisk = insurance.filter((c) => {
    if (!boaterIds.has(c.boater_id)) return false;
    const endMs = new Date(c.effective_end).getTime();
    return endMs - now <= thirtyDays && endMs - now >= 0;
  });

  const arrivalsToday = reservations
    .filter(
      (r) =>
        r.arrival_date === today &&
        r.status !== "cancelled" &&
        r.status !== "completed"
    )
    .map((r) => ({
      boater: boaterById.get(r.boater_id),
      vessel: vesselById.get(r.vessel_id),
    }))
    .filter((a) => a.boater);

  const pendingDrafts = allDrafts.filter((d) => d.status === "pending").length;

  const sinceVisit = lastVisit ?? 0;
  const recentAudit = auditLog.filter(
    (a) =>
      new Date(a.created_at).getTime() > sinceVisit &&
      (a.via_agent ||
        a.action_type.startsWith("extraction_draft.auto_approve") ||
        a.action_type.startsWith("run_"))
  );
  const autoApprovedBills = recentAudit.filter((a) =>
    a.action_type.includes("auto_approve")
  ).length;
  const billingRunsRecent = recentAudit.filter(
    (a) =>
      a.action_type.includes("billing") || a.action_type.includes("payroll")
  ).length;

  if (!mounted) {
    const shell = (
      <>
        <div className="h-5 w-32 rounded bg-surface-2" />
        <div className="mt-3 h-4 w-full rounded bg-surface-2/60" />
        <div className="mt-1.5 h-4 w-3/4 rounded bg-surface-2/60" />
      </>
    );
    return embedded ? <div>{shell}</div> : (
      <div className="rounded-[16px] border border-hairline bg-surface-1 px-6 py-5">{shell}</div>
    );
  }

  // ── Bullet items ─────────────────────────────────────────────────────
  const bullets: string[] = [];
  const actionLinks: Array<{ label: string; href: string }> = [];

  if (pastDueAccounts > 0) {
    bullets.push(`${formatMoney(pastDueAR)} past due across ${pastDueAccounts} account${pastDueAccounts === 1 ? "" : "s"}`);
    actionLinks.push({ label: "Review A/R", href: "/ledger" });
  }
  if (pastDueBills.length > 0) {
    bullets.push(`${formatMoney(pastDueBillsTotal)} unpaid to vendors`);
    actionLinks.push({ label: "Pay bills", href: "/vendors?section=bills" });
  }
  if (urgentWO.length > 0) {
    bullets.push(`${urgentWO.length} urgent work order${urgentWO.length === 1 ? "" : "s"}`);
    actionLinks.push({ label: "Open work orders", href: "/work-orders" });
  }
  if (pendingClub.length > 0) {
    bullets.push(`${pendingClub.length} club booking request${pendingClub.length === 1 ? "" : "s"} waiting`);
    actionLinks.push({ label: "Review requests", href: "/members?tab=club" });
  }
  if (coiAtRisk.length > 0 && bullets.length < 4) {
    bullets.push(`${coiAtRisk.length} COI${coiAtRisk.length === 1 ? "" : "s"} expiring this month`);
  }
  if (pendingDrafts > 0 && bullets.length < 4) {
    bullets.push(`${pendingDrafts} AI draft${pendingDrafts === 1 ? "" : "s"} ready to review`);
    actionLinks.push({ label: "Open AP inbox", href: "/vendors?section=inbox" });
  }

  const firstArrival = arrivalsToday[0];
  const todayLine = (() => {
    if (arrivalsToday.length === 0) return "No arrivals today.";
    if (arrivalsToday.length === 1 && firstArrival?.boater) {
      const v = firstArrival.vessel?.name ? ` (${firstArrival.vessel.name})` : "";
      return `One arrival today: ${firstArrival.boater.display_name}${v}.`;
    }
    if (firstArrival?.boater) {
      const v = firstArrival.vessel?.name ? ` on ${firstArrival.vessel.name}` : "";
      return `${arrivalsToday.length} arrivals today, starting with ${firstArrival.boater.display_name}${v}.`;
    }
    return `${arrivalsToday.length} arrivals scheduled today.`;
  })();

  const autonomousLine = (() => {
    if (!lastVisit) return null;
    if (autoApprovedBills === 0 && billingRunsRecent === 0) return null;
    const parts: string[] = [];
    if (autoApprovedBills > 0)
      parts.push(`auto-paid ${autoApprovedBills} routine bill${autoApprovedBills === 1 ? "" : "s"}`);
    if (billingRunsRecent > 0)
      parts.push(`processed ${billingRunsRecent} billing run${billingRunsRecent === 1 ? "" : "s"}`);
    return `Since you were last here, I ${parts.join(" and ")}. No exceptions.`;
  })();

  const allQuiet = bullets.length === 0 && arrivalsToday.length === 0;

  const inner = (
    <>
      {/* Section eyebrow — matches sibling dashboard panels. Hidden in
          embedded mode (where it would compete with the chat surface). */}
      {!embedded && (
        <div className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          <Sparkles className="size-3 text-primary" />
          Today's briefing
        </div>
      )}

      <div className="flex items-start gap-3">
        {embedded && (
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Sparkles className="size-3.5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          {/* Drop the institutional "· Marina Stee" suffix — the marina
              name already appears in the top breadcrumb. Lead with a
              conversational phrase so a non-technical owner sees a
              friendly briefing, not a system header. */}
          <div className="text-[13px] font-medium text-fg-tertiary">
            {greeting} — here&apos;s where things stand
          </div>

        {allQuiet ? (
          <p className="mt-1 text-[14px] leading-relaxed text-fg">
            All quiet today. No past-due money, no urgent work, and no arrivals on the schedule.
            {autonomousLine && <span className="text-fg-subtle"> {autonomousLine}</span>}
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-[14px] text-fg">
            {bullets.map((item, idx) => (
              <li
                key={`b-${idx}`}
                className="flex items-start gap-2 leading-snug"
              >
                <span
                  aria-hidden
                  className="mt-[7px] size-1 shrink-0 rounded-full bg-fg-tertiary"
                />
                <span>{capitalize(item)}</span>
              </li>
            ))}
            <li className="flex items-start gap-2 leading-snug text-fg-subtle">
              <span
                aria-hidden
                className="mt-[7px] size-1 shrink-0 rounded-full bg-fg-tertiary/60"
              />
              <span>{todayLine}</span>
            </li>
            {autonomousLine && (
              <li className="mt-1 flex items-start gap-2 leading-snug text-[12px] text-fg-tertiary">
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-status-ok" />
                <span>
                  {autonomousLine}{" "}
                  <Link
                    href="/settings/audit-log"
                    className="underline-offset-2 hover:underline"
                  >
                    Details
                  </Link>
                </span>
              </li>
            )}
          </ul>
        )}

          {actionLinks.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {actionLinks.map((a) => (
                <Link
                  key={a.label}
                  href={a.href}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-fg-subtle transition-colors",
                    "hover:border-primary/40 hover:bg-primary/[0.05] hover:text-primary"
                  )}
                >
                  {a.label}
                  <ArrowRight className="size-3" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );

  return embedded ? inner : (
    <div className="rounded-[16px] border border-hairline bg-surface-1 px-6 py-5">{inner}</div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatMoney(amount: number) {
  return "$" + amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
