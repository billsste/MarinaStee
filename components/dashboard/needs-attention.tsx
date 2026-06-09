"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  HardHat,
  Inbox,
  Receipt,
  Sailboat,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { formatMoney } from "@/lib/mock-data";
import {
  useAiSettings,
  useBills,
  useBoaters,
  useClubBookings,
  useExtractionDrafts,
  useMarinaAssets,
  usePmSchedules,
  usePosCatalog,
  useStore,
} from "@/lib/client-store";

/*
 * Dashboard — Needs attention.
 *
 * Replaces the old KpiStrip + BackOfficeStrip + QuickActions rows with
 * one urgency-sorted row that ONLY surfaces things that demand action.
 * Vanity metrics (slip occupancy %, MRR, staff on duty, "today's stays
 * 0/1") moved to /reports — they don't earn space here.
 *
 * Rendering rules:
 *   - Tiles render only when count > 0
 *   - When nothing is open: one "All clear" pill spans the row
 *   - Red tones for money / urgent ops; yellow for soft risk
 */

type Tone = "danger" | "warn" | "info";

const TONE_RING: Record<Tone, string> = {
  danger: "ring-status-danger/30 bg-status-danger/[0.04]",
  warn: "ring-status-warn/30 bg-status-warn/[0.04]",
  info: "ring-status-info/30 bg-status-info/[0.04]",
};
const TONE_TEXT: Record<Tone, string> = {
  danger: "text-status-danger",
  warn: "text-status-warn",
  info: "text-status-info",
};

type Item = {
  key: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: Tone;
  href: string;
};

export function NeedsAttention() {
  const { ledger, insurance, workOrders } = useStore();
  const bills = useBills();
  const catalog = usePosCatalog();
  const pms = usePmSchedules();
  const assets = useMarinaAssets();
  const boaters = useBoaters();
  const clubBookings = useClubBookings();
  const ai = useAiSettings();
  const allDrafts = useExtractionDrafts();

  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const thirtyDays = 30 * 86_400_000;
  const boaterIds = new Set(boaters.map((b) => b.id));

  // ── Past-due A/R (red) ──
  // LedgerEntry doesn't carry a due_date — we use the same heuristic as
  // KpiStrip: any open invoice (open_balance > 0). Real-world we'd net
  // 30 from invoice.date; the seed already represents these as past-due.
  const pastDueInvoices = ledger.filter(
    (l) =>
      l.type === "invoice" &&
      l.open_balance > 0 &&
      boaterIds.has(l.boater_id)
  );
  const pastDueAR = pastDueInvoices.reduce((s, l) => s + l.open_balance, 0);
  const pastDueAccounts = new Set(pastDueInvoices.map((l) => l.boater_id)).size;

  // ── Past-due bills (red) ──
  const pastDueBills = bills.filter(
    (b) => b.status !== "paid" && b.due_date < today
  );
  const pastDueBillsTotal = pastDueBills.reduce(
    (s, b) => s + (b.amount - b.amount_paid),
    0
  );

  // ── Urgent / flagged work orders (red) ──
  const openWO = workOrders.filter((w) =>
    ["open", "scheduled", "in_progress", "blocked"].includes(w.status)
  );
  const urgentWO = openWO.filter((w) => w.priority === "urgent" || w.flagged);

  // ── Pending club requests (info) ──
  const pendingClub = clubBookings.filter((b) => b.status === "requested");

  // ── COIs at risk (warn) ──
  const coiAtRisk = insurance.filter((c) => {
    if (!boaterIds.has(c.boater_id)) return false;
    const endMs = new Date(c.effective_end).getTime();
    return endMs - now <= thirtyDays;
  });

  // ── Low stock (warn) ──
  const lowStock = catalog.filter(
    (i) => i.tracked && (i.stock_on_hand ?? 0) <= (i.reorder_point ?? 0)
  );

  // ── PM due ≤30d (warn) ──
  const pmDue = pms.filter((p) => {
    if (!p.active) return false;
    const days = Math.round((new Date(p.next_due_at).getTime() - now) / 86_400_000);
    return days <= 30;
  });

  const items: Item[] = [];

  if (pastDueAR > 0) {
    items.push({
      key: "ar",
      icon: <Receipt className="size-4" />,
      label: "Past-due A/R",
      value: formatMoney(pastDueAR),
      sub: `${pastDueAccounts} account${pastDueAccounts === 1 ? "" : "s"}`,
      tone: "danger",
      href: "/ledger",
    });
  }
  if (pastDueBills.length > 0) {
    items.push({
      key: "bills",
      icon: <AlertTriangle className="size-4" />,
      label: "Past-due bills",
      value: formatMoney(pastDueBillsTotal),
      sub: `${pastDueBills.length} bill${pastDueBills.length === 1 ? "" : "s"}`,
      tone: "danger",
      href: "/vendors?section=bills",
    });
  }
  if (urgentWO.length > 0) {
    items.push({
      key: "wo",
      icon: <Wrench className="size-4" />,
      label: "Urgent work orders",
      value: `${urgentWO.length}`,
      sub: `${openWO.length} open total`,
      tone: "danger",
      href: "/work-orders",
    });
  }
  if (pendingClub.length > 0) {
    items.push({
      key: "club",
      icon: <Sailboat className="size-4" />,
      label: "Club requests",
      value: `${pendingClub.length}`,
      sub: "Awaiting confirmation",
      tone: "info",
      href: "/members?tab=club",
    });
  }
  if (coiAtRisk.length > 0) {
    items.push({
      key: "coi",
      icon: <ShieldCheck className="size-4" />,
      label: "COIs at risk",
      value: `${coiAtRisk.length}`,
      sub: "Expiring ≤ 30 days",
      tone: "warn",
      href: "/insurance",
    });
  }
  if (lowStock.length > 0) {
    items.push({
      key: "stock",
      icon: <Boxes className="size-4" />,
      label: "Low stock",
      value: `${lowStock.length}`,
      sub: "At or below reorder",
      tone: "warn",
      href: "/inventory?section=low-stock",
    });
  }
  if (pmDue.length > 0) {
    items.push({
      key: "pm",
      icon: <HardHat className="size-4" />,
      label: "PM due",
      value: `${pmDue.length}`,
      sub: `${assets.length} asset${assets.length === 1 ? "" : "s"} tracked`,
      tone: "warn",
      href: "/assets?section=pm-due",
    });
  }

  // ── AI drafts awaiting review (info) ──
  // Only render when at least one inbox is enabled — otherwise the
  // queue can't grow and the tile would be confusing.
  const inboxesEnabled =
    ai.bills_inbox_enabled ||
    ai.staff_onboarding_doc_intake_enabled ||
    ai.certs_photo_intake_enabled ||
    ai.assets_pm_auto_derive_from_manual;
  const pendingDrafts = allDrafts.filter((d) => d.status === "pending");
  if (inboxesEnabled && pendingDrafts.length > 0) {
    // Route to the inbox of whichever module has the most drafts.
    const byModule = pendingDrafts.reduce<Record<string, number>>((acc, d) => {
      acc[d.module] = (acc[d.module] ?? 0) + 1;
      return acc;
    }, {});
    const topModule = Object.entries(byModule).sort((a, b) => b[1] - a[1])[0]?.[0];
    const href =
      topModule === "bill" || topModule === "vendor"
        ? "/vendors?section=inbox"
        : topModule === "staff_onboarding"
        ? "/staff?section=onboarding"
        : topModule === "certification"
        ? "/staff?section=certifications"
        : topModule === "asset"
        ? "/assets?section=inbox"
        : topModule === "packing_slip"
        ? "/inventory?section=receive"
        : "/vendors?section=inbox";
    items.push({
      key: "drafts",
      icon: <Inbox className="size-4" />,
      label: "Drafts to review",
      value: `${pendingDrafts.length}`,
      sub: "AI-extracted, awaiting approval",
      tone: "info",
      href,
    });
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border border-hairline bg-surface-1 px-4 py-2.5">
        <CheckCircle2 className="size-4 text-status-ok" />
        <span className="text-[13px] text-fg">
          All clear — no past-due money, no urgent work, no expiring COIs.
        </span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={`rounded-[12px] p-3.5 ring-1 transition-colors hover:brightness-[1.05] ${TONE_RING[item.tone]}`}
        >
          <div className="mb-1.5 flex items-center justify-between">
            <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${TONE_TEXT[item.tone]}`}>
              {item.icon}
              {item.label}
            </span>
          </div>
          <div className="money-display text-[22px] text-fg">{item.value}</div>
          <div className="mt-0.5 truncate text-[11px] text-fg-subtle">{item.sub}</div>
        </Link>
      ))}
    </div>
  );
}
