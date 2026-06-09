"use client";

import * as React from "react";
import Link from "next/link";
import { Anchor, AlertTriangle, CalendarClock, Crown, DollarSign, FileSignature, Percent, Sailboat, Ship, TrendingUp, UserMinus, Wallet } from "lucide-react";
import { anyApi } from "convex/server";
import { Badge } from "@/components/ui/badge";
import {
  BOATERS,
  RENTAL_GROUPS,
  RENTAL_SPACES,
  formatMoney,
  totalOccupancy,
} from "@/lib/mock-data";
import { effectivePlanFor, useBoaters, useClubBookings, useClubSubscriptions, useContracts, useStore } from "@/lib/client-store";
import { isExpiringWithin, localIsoDate } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import type { Contract, LedgerEntry, PosOrder } from "@/lib/types";
import { useTenantQuery } from "@/lib/use-tenant-query";
import { OccupancyPanel } from "./occupancy-panel";
import { RevenueMixPanel } from "./revenue-mix-panel";
import { ArAgingPanel } from "./ar-aging-panel";
import { ChurnRiskPanel } from "./churn-risk-panel";
import { FleetUtilizationPanel } from "./fleet-utilization-panel";
import { ClubPerformancePanel } from "./club-performance-panel";
import { CommsThroughputPanel } from "./comms-throughput-panel";
import { ExpiringWatchlistPanel } from "./expiring-watchlist-panel";

/*
 * Reports / Analytics — single-page operational + financial dashboard.
 *
 * All data is derived from the live client store, so a POS sale, a portal
 * payment, or an agent-charged fee shows up here on the next render.
 *
 * Charts are hand-rolled SVG / CSS bars (no chart library). The point is
 * to give marina staff "where am I" answers in <3 seconds — not to be a BI
 * platform.
 *
 * Sections:
 *   1. KPI strip (MTD revenue, YoY proxy, occupancy %, avg slip rate)
 *   2. Revenue by category — horizontal stacked bar w/ legend
 *   3. Revenue trend — 12-month sparkline
 *   4. Top 10 boaters by lifetime revenue
 *   5. Occupancy by dock — horizontal bars
 */

// Category-tinted swatches — palette stays small and intentional.
const CATEGORY_COLORS: Record<string, string> = {
  "Slip Fee Revenue": "var(--primary)",
  "Fuel Sales": "var(--status-info)",
  Services: "var(--status-warn)",
  "Retail Sales": "var(--status-ok)",
  Restaurant: "#c084fc",
  "A/R": "var(--fg-tertiary)",
  Other: "var(--fg-tertiary)",
};

// ─────────────────────────────────────────────────────────────────
// Phase 3 (Wave 3) read seam.
//
// /reports is read-only by nature, so this is a pure read flip. We
// route the 3 heaviest panels' data through `useTenantQuery`:
//   - Revenue by category (ledger invoices + POS orders)
//   - Revenue trend (ledger invoices)
//   - Top boaters (ledger invoices)
//   - Annual portfolio KPIs (contracts)
//   - Occupancy by dock (still mock — pulls from RENTAL_GROUPS /
//     RENTAL_SPACES static seeds; deferred until rentalGroups +
//     rentalSpaces are extended on the Convex side and the
//     totalOccupancy() helper is rewritten to take a slice argument)
//
// Rental Club analytics (subscriptions + bookings) also stays on the
// mock — the club subscriptions table hasn't migrated yet.
//
// Convex shapes carry `_id` + `tenantId`; the adapters reshape to the
// page's existing mock types (`id` + `tenant_id`). For LedgerEntry we
// surface the page-required fields (date, amount, type, status, etc.)
// and pass through mock-only fields (`gl_account`, `linked_*_id`,
// `refund_reason`) as defaults — every consumer in this file tolerates
// missing optional fields.
// ─────────────────────────────────────────────────────────────────

// Convex's ledger `method` union is wider than the mock's
// (`charge_to_account` doesn't exist on the mock). Type it as a free
// string here and coerce at the adapter boundary.
interface ConvexLedgerEntry {
  _id: string;
  tenantId: string;
  boater_id: string;
  type: LedgerEntry["type"];
  number?: string;
  date: string;
  amount: number;
  open_balance: number;
  method?: "card" | "cash" | "check" | "ach" | "charge_to_account";
  status: LedgerEntry["status"];
  line_items?: { description: string; amount: number }[];
  applied_to_invoice_ids?: string[];
  linked_pos_order_id?: string;
  linked_contract_id?: string;
  linked_work_order_id?: string;
  refund_notes?: string;
}

interface ConvexContract {
  _id: string;
  tenantId: string;
  number: string;
  boater_id: string;
  template_id: string;
  template_version: number;
  vessel_id?: string;
  slip_id?: string;
  status: Contract["status"];
  effective_start: string;
  effective_end: string;
  annual_rate?: number;
  billing_cadence: Contract["billing_cadence"];
  signed_at?: string;
}

interface ConvexPosOrder {
  _id: string;
  tenantId: string;
  number: string;
  location_id: string;
  customer_kind: PosOrder["customer_kind"];
  boater_id?: string;
  patron_name?: string;
  line_items: { sku: string; name: string; qty: number; unit_price: number; total: number }[];
  subtotal: number;
  tax: number;
  total: number;
  payment_method: PosOrder["payment_method"];
  status: string;
  closed_at?: string;
  linked_ledger_entry_id?: string;
}

function convexLedgerToMock(rows: ConvexLedgerEntry[]): LedgerEntry[] {
  return rows.map((r) => {
    // Map Convex method (`charge_to_account` etc.) to the mock's
    // narrower set. The reports page only uses `amount`, `type`,
    // `status`, `date`, `gl_account` — `method` is a safety default
    // for /ledger consumers that haven't migrated yet.
    let method: LedgerEntry["method"] = null;
    if (r.method === "card") method = "card";
    else if (r.method === "ach") method = "ach";
    else if (r.method === "check") method = "check";
    else if (r.method === "cash") method = "cash";
    else if (r.method === "charge_to_account") method = "fuel_charge";

    return {
      id: r._id,
      boater_id: r.boater_id,
      type: r.type,
      number: r.number,
      date: r.date,
      amount: r.amount,
      open_balance: r.open_balance,
      method,
      status: r.status,
      line_items: r.line_items,
      applied_to_invoice_ids: r.applied_to_invoice_ids,
      linked_pos_order_id: r.linked_pos_order_id,
      linked_contract_id: r.linked_contract_id,
      linked_work_order_id: r.linked_work_order_id,
      refund_notes: r.refund_notes,
    };
  });
}

function convexContractsToMock(rows: ConvexContract[]): Contract[] {
  return rows.map((r) => ({
    id: r._id,
    number: r.number,
    boater_id: r.boater_id,
    template_id: r.template_id,
    template_version: r.template_version,
    vessel_id: r.vessel_id,
    slip_id: r.slip_id,
    status: r.status,
    effective_start: r.effective_start,
    effective_end: r.effective_end,
    annual_rate: r.annual_rate,
    billing_cadence: r.billing_cadence,
    signed_at: r.signed_at,
  }));
}

function convexPosOrdersToMock(rows: ConvexPosOrder[]): PosOrder[] {
  return rows.map((r) => ({
    id: r._id,
    tenant_id: r.tenantId,
    number: r.number,
    location_id: r.location_id,
    customer_kind: r.customer_kind,
    boater_id: r.boater_id,
    line_items: r.line_items,
    subtotal: r.subtotal,
    tax: r.tax,
    total: r.total,
    payment_method: r.payment_method,
    // Mock has narrower `status` enum than Convex's free string —
    // coerce known values, default to "open" otherwise. The reports
    // page doesn't filter by status, so this is for type safety only.
    status:
      r.status === "draft" ||
      r.status === "open" ||
      r.status === "paid" ||
      r.status === "voided" ||
      r.status === "refunded"
        ? r.status
        : "open",
    // Mock requires `created_at`; Convex tracks it via _creationTime which
    // we don't surface here. closed_at is close enough for the trend
    // analytics in this view (they bucket by ledger date anyway).
    created_at: r.closed_at ?? new Date().toISOString(),
    closed_at: r.closed_at,
    linked_ledger_entry_id: r.linked_ledger_entry_id,
  }));
}

const REPORTS_EMPTY_ARGS = {} as const;

// ────────────────────────────────────────────────────────────
// Small-sample thresholds for ratio Kpis.
//
// Marina owners landing on /reports for the first time will only have
// a handful of contracts ended / invoices issued / prior-year revenue.
// Showing a 0% renewal rate or a +12,000% YoY swing on top of two
// data points reads as catastrophic operator signal when it's actually
// just sparse history. Each Kpi below this threshold renders a neutral
// "not enough history" state instead of the misleading extreme.
//
// These are tuned for the demo seed; tighten once real production data
// is flowing.
// ────────────────────────────────────────────────────────────
const RENEWAL_MIN_SAMPLE = 5; // ended contracts needed before % shows
const YOY_MIN_BASE = 1000;    // prior-year revenue (dollars) needed
const AVG_MIN_SAMPLE = 5;     // invoices needed before avg shows

export function ReportsView() {
  const { ledger: mockLedger, posOrders: mockPosOrders } = useStore();
  const mockContracts = useContracts();

  const ledger = useTenantQuery<LedgerEntry[], ConvexLedgerEntry[]>({
    mock: mockLedger,
    convexRef: anyApi.ledger.list,
    convexArgs: REPORTS_EMPTY_ARGS,
    convexAdapter: convexLedgerToMock,
  });
  const contracts = useTenantQuery<Contract[], ConvexContract[]>({
    mock: mockContracts,
    convexRef: anyApi.contracts.list,
    convexArgs: REPORTS_EMPTY_ARGS,
    convexAdapter: convexContractsToMock,
  });
  const posOrders = useTenantQuery<PosOrder[], ConvexPosOrder[]>({
    mock: mockPosOrders,
    convexRef: anyApi.pos.listOrders,
    convexArgs: REPORTS_EMPTY_ARGS,
    convexAdapter: convexPosOrdersToMock,
  });

  // Rental Club analytics inputs. All read-only — surfaced in the new
  // section near the bottom of the report.
  const clubSubs = useClubSubscriptions();
  const clubBookings = useClubBookings();

  // ── Annual portfolio metrics (the LEAD section) ──────────────────────
  const now = new Date();
  const lastYearStartDate = new Date(now.getFullYear() - 1, 0, 1).getTime();
  const lastYearEndDate = new Date(now.getFullYear() - 1, 11, 31).getTime();

  // ISO cutoffs for the 90- / 180-day expiring buckets. Computed once
  // per render so the filter loops are allocation-free and timezone-
  // stable (ISO string compare via isExpiringWithin avoids the
  // new Date("YYYY-MM-DD") UTC-midnight footgun).
  const todayIso = localIsoDate();
  const ninetyDaysOutIso = localIsoDate(
    new Date(now.getTime() + 90 * 86_400_000),
  );
  const oneEightyDaysOutIso = localIsoDate(
    new Date(now.getTime() + 180 * 86_400_000),
  );

  const activeAnnualContracts = contracts.filter(
    (c) => c.status === "active" && (c.billing_cadence === "monthly" || c.billing_cadence === "annual")
  );
  const annualARR = activeAnnualContracts.reduce((s, c) => s + (c.annual_rate ?? 0), 0);

  // Preserves the `status === "active"` narrowing — see migration
  // report C3. The active-only filter above already gates these, so
  // isExpiringWithin's internal isLiveContract check is a no-op here.
  const expiring90 = activeAnnualContracts.filter((c) =>
    isExpiringWithin(c, todayIso, ninetyDaysOutIso),
  );
  const expiring180 = activeAnnualContracts.filter((c) =>
    isExpiringWithin(c, todayIso, oneEightyDaysOutIso),
  );

  // Renewal rate proxy: of contracts that ended in the last year, how many
  // have a successor active contract for the same slip?
  const endedLastYear = contracts.filter((c) => {
    const end = new Date(c.effective_end).getTime();
    return end >= lastYearStartDate && end <= lastYearEndDate;
  });
  const renewedCount = endedLastYear.filter((c) => {
    // A renewal exists if there's another contract for the same slip with a
    // later effective_start.
    return contracts.some(
      (other) =>
        other.id !== c.id &&
        other.slip_id === c.slip_id &&
        new Date(other.effective_start).getTime() >
          new Date(c.effective_start).getTime()
    );
  }).length;
  const renewalRate = endedLastYear.length > 0
    ? (renewedCount / endedLastYear.length) * 100
    : null;
  const lapsedContracts = contracts.filter((c) => c.status === "expired");

  // Revenue universe: invoices + POS sales (charge-to-account invoices are
  // double-counted via ledger; we ignore that for the demo).
  const invoices = ledger.filter((l) => l.type === "invoice");

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
  const lastYearEnd = new Date(now.getFullYear() - 1, 11, 31);

  const mtd = sum(invoicesBetween(invoices, monthStart, now));
  const ytd = sum(invoicesBetween(invoices, yearStart, now));
  const lastYearTotal = sum(invoicesBetween(invoices, lastYearStart, lastYearEnd));
  const yoyDelta = lastYearTotal > 0 ? ((ytd - lastYearTotal) / lastYearTotal) * 100 : 0;

  // Revenue by category — pivot on gl_account
  const byCategory = new Map<string, number>();
  for (const inv of invoices) {
    const k = inv.gl_account ?? "Other";
    byCategory.set(k, (byCategory.get(k) ?? 0) + inv.amount);
  }
  // Add POS sales as Retail / Restaurant / Fuel based on category presence
  for (const p of posOrders) {
    const cat = guessPosCategory(p.line_items);
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + p.subtotal);
  }
  const totalRevenue = Array.from(byCategory.values()).reduce((s, n) => s + n, 0);
  const categoryRows = Array.from(byCategory.entries())
    .map(([cat, amount]) => ({
      cat,
      amount,
      pct: totalRevenue > 0 ? (amount / totalRevenue) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  // Revenue trend — last 12 months
  const months: { iso: string; label: string; total: number }[] = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push({
      iso,
      label: d.toLocaleDateString(undefined, { month: "short" }),
      total: sum(invoicesBetween(invoices, d, next)),
    });
  }

  // Top boaters by lifetime revenue
  const byBoater = new Map<string, number>();
  for (const inv of invoices) {
    byBoater.set(inv.boater_id, (byBoater.get(inv.boater_id) ?? 0) + inv.amount);
  }
  const topBoaters = Array.from(byBoater.entries())
    .map(([id, total]) => ({ boater: BOATERS.find((b) => b.id === id), total }))
    .filter((r) => r.boater)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  // Occupancy strip + by dock
  const occ = totalOccupancy();
  // Group RENTAL_SPACES by group → compute occupied/total
  const byGroup = RENTAL_GROUPS.map((g) => {
    const spaces = RENTAL_SPACES.filter((s) => s.group_id === g.id);
    const occupied = spaces.filter((s) => s.status === "occupied" || s.status === "reserved").length;
    return {
      id: g.id,
      name: g.name,
      total: spaces.length || g.total_spaces,
      occupied: spaces.length > 0 ? occupied : g.occupied_spaces,
    };
  });

  // Avg slip rate from invoices tagged "Slip Fee Revenue"
  const slipInvoices = invoices.filter((i) => i.gl_account === "Slip Fee Revenue");
  const avgSlipInvoice =
    slipInvoices.length > 0
      ? slipInvoices.reduce((s, i) => s + i.amount, 0) / slipInvoices.length
      : 0;

  // ── Quick-glance KPI strip inputs ────────────────────────────────
  // MRR run-rate (sum of effective monthly fees across active subs)
  const activeClubSubs = clubSubs.filter((s) => s.status === "active");
  const mrrRunRate = activeClubSubs.reduce(
    (sum, s) => sum + (effectivePlanFor(s)?.monthly_fee ?? 0),
    0,
  );
  // Outstanding A/R — open balance across open + partial invoices.
  const outstandingAr = ledger.reduce((s, l) => {
    if (l.type !== "invoice") return s;
    if (l.status !== "open" && l.status !== "partial") return s;
    return s + Math.max(0, l.open_balance);
  }, 0);
  // Occupancy % already computed above as `occ.pct`.
  // Churn top score — mirrors the panel's mock calc but trimmed to
  // just the max score so the KPI strip doesn't double the work.
  const boatersAll = useBoaters();
  const churnTopScore = React.useMemo(() => {
    const todayMs = Date.now();
    const sixtyOutIso = localIsoDate(new Date(todayMs + 60 * 86_400_000));
    const todayIsoForChurn = localIsoDate();
    let max = 0;
    for (const b of boatersAll) {
      let score = 0;
      const myContracts = contracts.filter((c) => c.boater_id === b.id);
      const myLedger = ledger.filter((l) => l.boater_id === b.id);
      if (myContracts.some((c) => c.status === "expired" || c.status === "terminated")) score += 35;
      if (
        myLedger.some(
          (l) => l.type === "invoice" && l.open_balance > 0 && (todayMs - new Date(l.date).getTime()) / 86_400_000 >= 60,
        )
      )
        score += 25;
      if (
        myContracts.some(
          (c) => c.status === "active" && c.effective_end > todayIsoForChurn && c.effective_end <= sixtyOutIso,
        )
      )
        score += 20;
      if (score > max) max = score;
    }
    return Math.min(100, max);
  }, [boatersAll, contracts, ledger]);

  return (
    <div className="space-y-6">
      {/* ── QUICK GLANCE — 4-card KPI strip ──────────────────────── */}
      <section>
        <h2 className="mb-3 text-[13px] font-medium uppercase tracking-wide text-fg-tertiary">
          Quick glance
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Kpi
            icon={<DollarSign className="size-4" />}
            label="Recurring monthly revenue"
            value={formatMoney(mrrRunRate)}
            sub={`${activeClubSubs.length} active club ${activeClubSubs.length === 1 ? "member" : "members"}`}
            tone={mrrRunRate > 0 ? "ok" : "neutral"}
            href="/members?service_type=Rental+Club&status=active"
          />
          <Kpi
            icon={<Wallet className="size-4" />}
            label="Money owed"
            value={formatMoney(outstandingAr)}
            sub={outstandingAr > 0 ? "Across unpaid + partial invoices" : "All settled"}
            tone={outstandingAr > 0 ? "warn" : "ok"}
            href="/ledger?status=open"
          />
          <Kpi
            icon={<Percent className="size-4" />}
            label="Occupancy"
            value={`${occ.pct.toFixed(0)}%`}
            sub={`${occ.occupied} of ${occ.total} spaces`}
            tone={occ.pct > 80 ? "ok" : occ.pct > 50 ? "info" : "warn"}
            href="/services"
          />
          <Kpi
            icon={<AlertTriangle className="size-4" />}
            label="Members at risk"
            value={`${churnTopScore}`}
            sub={churnTopScore >= 70 ? "Critical — act now" : churnTopScore >= 40 ? "Worth a call" : "Healthy book"}
            tone={churnTopScore >= 70 ? "warn" : churnTopScore >= 40 ? "info" : "ok"}
          />
        </div>
      </section>

      {/* ── ANNUAL PORTFOLIO — the lead section ───────────────────── */}
      <section>
        <h2 className="mb-3 text-[13px] font-medium uppercase tracking-wide text-fg-tertiary">
          Annual portfolio
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Kpi
            icon={<DollarSign className="size-4" />}
            label="Annual revenue locked in"
            value={formatMoney(annualARR)}
            sub={`${activeAnnualContracts.length} active ${activeAnnualContracts.length === 1 ? "contract" : "contracts"}`}
            tone="ok"
            href="/services/contracts"
          />
          <Kpi
            icon={<CalendarClock className="size-4" />}
            label="Expiring in 90 days"
            value={`${expiring90.length}`}
            sub={`${expiring180.length} within 180 days`}
            tone={expiring90.length > 0 ? "warn" : "neutral"}
            href="/services/contracts?window=90"
          />
          {/* Renewal rate is meaningful once enough contracts have
              ended to draw a trend. Below RENEWAL_MIN_SAMPLE, surface a
              neutral "not enough history" state instead of a 0% / 100%
              extreme that would read as a panic signal to a new operator
              looking at fresh seed data. */}
          <Kpi
            icon={<FileSignature className="size-4" />}
            label="Renewal rate (last yr)"
            value={
              renewalRate === null || endedLastYear.length < RENEWAL_MIN_SAMPLE
                ? "—"
                : `${renewalRate.toFixed(0)}%`
            }
            sub={
              renewalRate === null
                ? "No contracts ended yet"
                : endedLastYear.length < RENEWAL_MIN_SAMPLE
                  ? `${endedLastYear.length} ended — too few to trend`
                  : `${renewedCount} of ${endedLastYear.length} renewed`
            }
            tone={
              renewalRate === null || endedLastYear.length < RENEWAL_MIN_SAMPLE
                ? "neutral"
                : renewalRate >= 85
                  ? "ok"
                  : renewalRate >= 70
                    ? "info"
                    : "warn"
            }
            href="/services/contracts"
          />
          <Kpi
            icon={<Ship className="size-4" />}
            label="Lapsed"
            value={`${lapsedContracts.length}`}
            sub="Need re-engagement or waitlist match"
            tone={lapsedContracts.length > 0 ? "warn" : "ok"}
            href="/services/contracts?status=expired"
          />
        </div>
      </section>

      {/* ── DAILY OPS — secondary KPIs ────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-[13px] font-medium uppercase tracking-wide text-fg-tertiary">
          Daily operations
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Kpi
            icon={<DollarSign className="size-4" />}
            label="Month-to-date revenue"
            value={formatMoney(mtd)}
            sub={(() => {
              const n = invoicesBetween(invoices, monthStart, now).length;
              return `${n} ${n === 1 ? "invoice" : "invoices"}`;
            })()}
            tone="neutral"
            href={`/ledger?from=${monthStart.toISOString().slice(0, 10)}`}
          />
          {/* YoY only makes sense when last year has a real base. A
              $5 → $500 swing reads as +9,900% which is technically
              correct but useless to an owner. Require last year to be
              at least YOY_MIN_BASE before showing the percentage. */}
          <Kpi
            icon={<TrendingUp className="size-4" />}
            label="YTD vs last year"
            value={
              lastYearTotal < YOY_MIN_BASE
                ? "—"
                : `${yoyDelta >= 0 ? "+" : ""}${yoyDelta.toFixed(1)}%`
            }
            sub={
              lastYearTotal < YOY_MIN_BASE
                ? `${formatMoney(ytd)} this year — too little history`
                : `${formatMoney(ytd)} this year`
            }
            tone={
              lastYearTotal < YOY_MIN_BASE
                ? "neutral"
                : yoyDelta >= 0
                  ? "ok"
                  : "warn"
            }
            href={`/ledger?from=${yearStart.toISOString().slice(0, 10)}`}
          />
          <Kpi
            icon={<Percent className="size-4" />}
            label="Occupancy"
            value={`${occ.pct.toFixed(0)}%`}
            sub={`${occ.occupied} of ${occ.total} spaces`}
            tone={occ.pct > 80 ? "ok" : occ.pct > 50 ? "info" : "warn"}
            href="/services"
          />
          {/* Average over a handful of invoices skews wildly — soften
              below AVG_MIN_SAMPLE so the operator doesn't draw a
              conclusion from a sample of one. */}
          <Kpi
            icon={<Ship className="size-4" />}
            label="Avg slip invoice"
            value={
              slipInvoices.length < AVG_MIN_SAMPLE
                ? "—"
                : formatMoney(avgSlipInvoice)
            }
            sub={
              slipInvoices.length === 0
                ? "No slip invoices yet"
                : slipInvoices.length < AVG_MIN_SAMPLE
                  ? `${slipInvoices.length} slip ${slipInvoices.length === 1 ? "invoice" : "invoices"} — need ${AVG_MIN_SAMPLE}+ to average`
                  : `${slipInvoices.length} slip invoices`
            }
            tone="neutral"
            href="/ledger"
          />
        </div>
      </section>

      {/* Revenue by category */}
      <Panel
        title="Revenue by category"
        icon={<DollarSign className="size-3.5" />}
        right={<span className="text-[12px] text-fg-subtle">{formatMoney(totalRevenue)} total</span>}
      >
        {totalRevenue === 0 ? (
          <Empty text="No invoiced revenue yet. POS sales appear here once they're rung up." />
        ) : (
          <div className="space-y-3">
            {/* Stacked bar */}
            <div className="flex h-3 overflow-hidden rounded-full bg-surface-3">
              {categoryRows.map((r) => (
                <div
                  key={r.cat}
                  style={{
                    width: `${r.pct}%`,
                    backgroundColor: CATEGORY_COLORS[r.cat] ?? CATEGORY_COLORS.Other,
                  }}
                  title={`${r.cat}: ${formatMoney(r.amount)} (${r.pct.toFixed(1)}%)`}
                />
              ))}
            </div>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-2 text-[12px] sm:grid-cols-2">
              {categoryRows.map((r) => (
                <li key={r.cat} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 truncate">
                    <span
                      aria-hidden
                      className="inline-block size-2.5 rounded-sm"
                      style={{ backgroundColor: CATEGORY_COLORS[r.cat] ?? CATEGORY_COLORS.Other }}
                    />
                    <span className="truncate text-fg">{r.cat}</span>
                  </span>
                  <span className="tabular text-fg-subtle">
                    {formatMoney(r.amount)} ·{" "}
                    <span className="text-fg-tertiary">{r.pct.toFixed(1)}%</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      {/* Revenue trend + Top boaters side-by-side on wide */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel
          title="Revenue trend (12 months)"
          icon={<TrendingUp className="size-3.5" />}
          className="lg:col-span-2"
        >
          <TrendChart months={months} />
        </Panel>

        <Panel title="Top holders" icon={<Crown className="size-3.5" />}>
          {topBoaters.length === 0 ? (
            <Empty text="No revenue yet." />
          ) : (
            <ol className="space-y-1.5 text-[12px]">
              {topBoaters.map((r, i) => (
                <li
                  key={r.boater!.id}
                  className="flex items-center justify-between gap-2 rounded-[6px] px-2 py-1 hover:bg-surface-2"
                >
                  <Link
                    href={`/members/${r.boater!.id}`}
                    className="flex min-w-0 items-center gap-2 truncate text-fg hover:text-primary"
                  >
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[10px] font-medium text-fg-subtle">
                      {i + 1}
                    </span>
                    <span className="truncate">{r.boater!.display_name}</span>
                  </Link>
                  <span className="tabular text-fg-subtle">{formatMoney(r.total)}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      {/* Occupancy by dock */}
      <Panel title="Occupancy by dock" icon={<Anchor className="size-3.5" />}>
        <ul className="space-y-2.5">
          {byGroup.map((g) => {
            const pct = g.total > 0 ? (g.occupied / g.total) * 100 : 0;
            const tone =
              pct > 90 ? "bg-status-danger"
              : pct > 75 ? "bg-status-warn"
              : pct > 40 ? "bg-status-info"
              : "bg-status-ok";
            return (
              <li key={g.id}>
                <div className="mb-1 flex items-center justify-between gap-2 text-[12px]">
                  <span className="font-medium text-fg">{g.name}</span>
                  <span className="text-fg-subtle">
                    {g.occupied} / {g.total} ·{" "}
                    <span className="tabular text-fg">{pct.toFixed(0)}%</span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                  <div className={cn("h-full transition-all", tone)} style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      {/* ── ANALYTICAL DEPTH — 8 new operator panels ──────────────── */}
      {/*
       * Two-column responsive grid. Order is roughly "money first" so
       * the operator's eye lands on revenue + collections before
       * digging into utilization / engagement.
       */}
      <section>
        <h2 className="mb-3 text-[13px] font-medium uppercase tracking-wide text-fg-tertiary">
          Operator analytics
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <RevenueMixPanel />
          <ArAgingPanel />
          <OccupancyPanel />
          <ChurnRiskPanel />
          <FleetUtilizationPanel />
          <ClubPerformancePanel />
          <CommsThroughputPanel />
          <ExpiringWatchlistPanel />
        </div>
      </section>

      {/* ── RENTAL CLUB — subscription product analytics ─────────── */}
      <RentalClubAnalytics subscriptions={clubSubs} bookings={clubBookings} />

      <p className="text-center text-[11px] text-fg-tertiary">
        Reports recompute from the live store. Pay an invoice in /portal or ring up a sale in /ledger
        and refresh — the numbers move.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rental Club — subscription metrics
//
// Surfaces MRR, active vs past-due vs cancelled split, days-booked
// utilization (used vs total allotment this month), and plan-tier
// distribution. Hidden when there are no club subscriptions at all so
// the surface stays clean for marinas without the product.
// ─────────────────────────────────────────────────────────────────────────────

function RentalClubAnalytics({
  subscriptions,
  bookings,
}: {
  subscriptions: import("@/lib/types").ClubSubscription[];
  bookings: import("@/lib/types").ClubBooking[];
}) {
  if (subscriptions.length === 0) return null;

  const active = subscriptions.filter((s) => s.status === "active");
  const pastDue = subscriptions.filter((s) => s.status === "past_due");
  const cancelled = subscriptions.filter((s) => s.status === "cancelled");
  // Per-sub plan resolution — runs through the catalog so price edits
  // flow through and missing-plan rows (deleted catalog row) contribute
  // 0 instead of crashing.
  const mrr = active.reduce(
    (sum, s) => sum + (effectivePlanFor(s)?.monthly_fee ?? 0),
    0
  );
  const annualizedRev = mrr * 12;

  // Days-booked utilization for the current month: how many of the
  // total allotment got used by active members. Counts confirmed +
  // checked_in + completed (treats requested as "not yet booked" since
  // staff hasn't confirmed yet — gives a truthful utilization number).
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const totalAllotment = active.reduce(
    (sum, s) => sum + (effectivePlanFor(s)?.days_per_month ?? 0),
    0
  );
  const daysBooked = bookings.filter(
    (b) =>
      b.date.startsWith(monthPrefix) &&
      (b.status === "confirmed" ||
        b.status === "checked_in" ||
        b.status === "completed")
  ).length;
  const utilization =
    totalAllotment > 0 ? Math.round((daysBooked / totalAllotment) * 100) : 0;

  // Plan tier mix — for the horizontal bar viz. plan_tier comes from
  // the Rate row the sub points at; skip if unresolved.
  const tierCounts: Record<"basic" | "plus" | "premium", number> = {
    basic: 0,
    plus: 0,
    premium: 0,
  };
  for (const s of active) {
    const tier = effectivePlanFor(s)?.plan_tier;
    if (tier) tierCounts[tier] += 1;
  }

  // Retention-offer funnel — counts subs the portal cancel sheet has
  // surfaced for + their outcome. Conversion rate = accepted / shown.
  const retentionShown = subscriptions.filter(
    (s) => s.retention_offer_shown_at != null
  ).length;
  const retentionAccepted = subscriptions.filter(
    (s) => s.retention_offer_outcome === "accepted"
  ).length;
  const retentionDeclined = subscriptions.filter(
    (s) => s.retention_offer_outcome === "declined"
  ).length;
  const retentionConversion =
    retentionShown > 0
      ? Math.round((retentionAccepted / retentionShown) * 100)
      : 0;

  // Per-variant breakdown for the A/B side-by-side. Each variant gets
  // shown/accepted/conversion. Variants without any shown stay at 0
  // and the renderer skips them so the panel doesn't get noisy.
  type VariantStats = {
    label: string;
    shown: number;
    accepted: number;
    conversion: number;
  };
  function statsForVariant(
    variant: import("@/lib/types").RetentionOfferVariant,
    label: string
  ): VariantStats {
    const shown = subscriptions.filter(
      (s) => s.retention_offer_variant === variant
    ).length;
    const accepted = subscriptions.filter(
      (s) =>
        s.retention_offer_variant === variant &&
        s.retention_offer_outcome === "accepted"
    ).length;
    return {
      label,
      shown,
      accepted,
      conversion: shown > 0 ? Math.round((accepted / shown) * 100) : 0,
    };
  }
  const variantStats: VariantStats[] = [
    statsForVariant("half_off", "50% off"),
    statsForVariant("free_month", "Free month"),
    statsForVariant("downgrade", "Downgrade tier"),
  ];
  const anyVariantShown = variantStats.some((v) => v.shown > 0);

  // Cohort retention — group signups by month-of-member_since, compute
  // % still active at 30/90/180 days. When `tier` is provided, only
  // that tier's subs are counted (used by the split-by-tier toggle).
  // Cohorts where the milestone hasn't been reached yet show "—" to
  // avoid misleading rates.
  type Cohort = {
    label: string;
    monthKey: string;
    size: number;
    retained30: number | null;
    retained90: number | null;
    retained180: number | null;
  };
  function buildCohorts(
    tierFilter?: import("@/lib/types").ClubPlanTier
  ): Cohort[] {
    const cohortMap = new Map<string, import("@/lib/types").ClubSubscription[]>();
    for (const s of subscriptions) {
      if (tierFilter && effectivePlanFor(s)?.plan_tier !== tierFilter) continue;
      const key = s.member_since.slice(0, 7); // YYYY-MM
      const arr = cohortMap.get(key) ?? [];
      arr.push(s);
      cohortMap.set(key, arr);
    }
    const todayMs = Date.now();
    return Array.from(cohortMap.entries())
      .sort(([a], [b]) => (a < b ? 1 : -1)) // newest first
      .map(([monthKey, subs]) => {
        const cohortStart = new Date(monthKey + "-15").getTime();
        const daysOld = Math.floor((todayMs - cohortStart) / 86_400_000);
        function retainedAt(days: number): number | null {
          if (daysOld < days) return null;
          const survivors = subs.filter((s) => s.status !== "cancelled").length;
          return Math.round((survivors / subs.length) * 100);
        }
        const label = new Date(monthKey + "-01").toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
        });
        return {
          label,
          monthKey,
          size: subs.length,
          retained30: retainedAt(30),
          retained90: retainedAt(90),
          retained180: retainedAt(180),
        };
      })
      .slice(0, 6); // last 6 months
  }
  const cohorts = buildCohorts();
  const cohortsByTier: Record<
    import("@/lib/types").ClubPlanTier,
    Cohort[]
  > = {
    basic: buildCohorts("basic"),
    plus: buildCohorts("plus"),
    premium: buildCohorts("premium"),
  };

  // Reactivation campaign outcomes — count cancelled subs that have a
  // back-pointer to a newly-created sub. Pairs with the reactivation
  // outreach action (sendClubReactivationComms / run_club_reactivation
  // agent tool) so the operator can see "did it work?"
  const reactivationsSent = subscriptions.filter(
    (s) => s.reactivation_sent_at != null
  ).length;
  const reactivationsConverted = subscriptions.filter(
    (s) => s.reactivated_to_subscription_id != null
  ).length;
  const reactivationConversion =
    reactivationsSent > 0
      ? Math.round((reactivationsConverted / reactivationsSent) * 100)
      : 0;

  // Sentiment — aggregate distribution across all completed bookings.
  // Skips unrated (sentiment === undefined) so the % reflects opinion-
  // ed members, not response rate. Response rate shown separately.
  const completedBookings = bookings.filter((b) => b.status === "completed");
  const ratedBookings = completedBookings.filter((b) => b.sentiment != null);
  const sentimentCounts = {
    happy: ratedBookings.filter((b) => b.sentiment === "happy").length,
    neutral: ratedBookings.filter((b) => b.sentiment === "neutral").length,
    sad: ratedBookings.filter((b) => b.sentiment === "sad").length,
  };
  const responseRate =
    completedBookings.length > 0
      ? Math.round((ratedBookings.length / completedBookings.length) * 100)
      : 0;

  // Signup trend — 12 weekly buckets. Each bucket counts subscriptions
  // whose member_since falls in that 7-day window. Drives the sparkline
  // + the "New members (30d)" KPI.
  const weekBuckets: number[] = Array(12).fill(0);
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  let newMembers30d = 0;
  for (const s of subscriptions) {
    const since = new Date(s.member_since);
    const daysAgo = Math.floor(
      (today.getTime() - since.getTime()) / 86_400_000
    );
    if (daysAgo < 30 && daysAgo >= 0) newMembers30d += 1;
    const weekIdx = 11 - Math.floor(daysAgo / 7);
    if (weekIdx >= 0 && weekIdx < 12) weekBuckets[weekIdx] += 1;
  }
  const maxBucket = Math.max(1, ...weekBuckets);

  return (
    <section>
      <h2 className="mb-3 text-[13px] font-medium uppercase tracking-wide text-fg-tertiary">
        Rental Club
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Kpi
          icon={<DollarSign className="size-4" />}
          label="Monthly recurring"
          value={formatMoney(mrr)}
          sub={`${formatMoney(annualizedRev)} annualized`}
          tone="ok"
          href="/members?service_type=Rental+Club&status=active"
        />
        <Kpi
          icon={<Sailboat className="size-4" />}
          label="Active members"
          value={`${active.length}`}
          sub={
            pastDue.length > 0
              ? `${pastDue.length} past due · ${cancelled.length} cancelled`
              : `${cancelled.length} cancelled lifetime`
          }
          tone={pastDue.length > 0 ? "warn" : "neutral"}
          href="/members?service_type=Rental+Club&status=active"
        />
        <Kpi
          icon={<Percent className="size-4" />}
          label="Days utilization (MTD)"
          value={`${utilization}%`}
          sub={`${daysBooked} of ${totalAllotment} allotted days`}
          tone={utilization > 80 ? "warn" : "ok"}
          href="/members?service_type=Rental+Club#bookings"
        />
        <Kpi
          icon={<UserMinus className="size-4" />}
          label="Cancellations (lifetime)"
          value={`${cancelled.length}`}
          sub={
            subscriptions.length > 0
              ? `${Math.round((cancelled.length / subscriptions.length) * 100)}% churn`
              : "—"
          }
          tone={cancelled.length === 0 ? "ok" : "neutral"}
          href="/members?service_type=Rental+Club&status=cancelled"
        />
      </div>

      {/* Signup velocity — 12-week sparkline + "New members (30d)" KPI */}
      <div className="mt-3 rounded-[12px] border border-hairline bg-surface-1 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[13px] font-medium text-fg">Signup velocity</h3>
            <p className="mt-0.5 text-[11px] text-fg-tertiary">
              Last 12 weeks. Counts include cancelled members so trends reflect raw demand.
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="money-display text-[20px] text-fg">
              {newMembers30d}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
              New (30d)
            </div>
          </div>
        </div>
        {/* Bar sparkline — last 12 weeks left → right (oldest → newest) */}
        <div className="mt-3 flex h-12 items-end gap-1">
          {weekBuckets.map((count, i) => {
            const heightPct = (count / maxBucket) * 100;
            return (
              <div
                key={i}
                title={`Week ${12 - i} ago: ${count} signup${count === 1 ? "" : "s"}`}
                className="flex-1 rounded-sm bg-primary/30 transition-colors hover:bg-primary/60"
                style={{ height: `${Math.max(4, heightPct)}%` }}
              />
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-fg-tertiary">
          <span>12 wks ago</span>
          <span>Now</span>
        </div>
      </div>

      {/* Retention save attempts — only renders when at least one
          cancel sheet has been surfaced. Conversion rate = % of
          members shown the offer who accepted it. */}
      {retentionShown > 0 && (
        <div className="mt-3 rounded-[12px] border border-hairline bg-surface-1 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[13px] font-medium text-fg">Save attempts</h3>
              <p className="mt-0.5 text-[11px] text-fg-tertiary">
                Members shown the cancel-sheet retention offer + how
                many took it.
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="money-display text-[20px] text-fg">
                {retentionConversion}%
              </div>
              <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
                Conversion
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
            <div className="rounded-[8px] bg-surface-2 p-2">
              <div className="money-display text-[16px] text-fg">{retentionShown}</div>
              <div className="text-fg-tertiary">Shown</div>
            </div>
            <div className="rounded-[8px] bg-status-ok/10 p-2">
              <div className="money-display text-[16px] text-status-ok">
                {retentionAccepted}
              </div>
              <div className="text-status-ok">Accepted</div>
            </div>
            <div className="rounded-[8px] bg-status-danger/10 p-2">
              <div className="money-display text-[16px] text-status-danger">
                {retentionDeclined}
              </div>
              <div className="text-status-danger">Declined</div>
            </div>
          </div>
          {/* Visual conversion bar */}
          <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="bg-status-ok"
              style={{ width: `${retentionConversion}%` }}
            />
            <div
              className="bg-status-danger/40"
              style={{
                width: `${
                  retentionShown > 0
                    ? Math.round((retentionDeclined / retentionShown) * 100)
                    : 0
                }%`,
              }}
            />
          </div>

          {/* Per-variant breakdown — only renders when at least one
              variant has been shown. Helps the operator decide which
              save offer is worth keeping. */}
          {anyVariantShown && (
            <div className="mt-4 border-t border-hairline pt-3">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
                By variant
              </div>
              <div className="grid grid-cols-3 gap-2">
                {variantStats.map((v) => (
                  <div
                    key={v.label}
                    className={cn(
                      "rounded-[8px] border p-2 text-center",
                      v.shown === 0
                        ? "border-hairline bg-surface-2 opacity-50"
                        : v.conversion >= retentionConversion
                        ? "border-status-ok/30 bg-status-ok/10"
                        : "border-hairline bg-surface-2"
                    )}
                  >
                    <div className="money-display text-[18px] text-fg">
                      {v.conversion}%
                    </div>
                    <div className="mt-0.5 text-[11px] font-medium text-fg-subtle">
                      {v.label}
                    </div>
                    <div className="text-[10px] text-fg-tertiary">
                      {v.accepted}/{v.shown}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Plan tier mix */}
      {active.length > 0 && (
        <div className="mt-3 rounded-[12px] border border-hairline bg-surface-1 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[13px] font-medium text-fg">Plan mix</h3>
            <span className="text-[11px] text-fg-tertiary">
              {active.length} active member{active.length === 1 ? "" : "s"}
            </span>
          </div>
          {/* Simple horizontal stacked bar — tiers in revenue order */}
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
            {(["basic", "plus", "premium"] as const).map((tier) => {
              const count = tierCounts[tier];
              if (count === 0) return null;
              const widthPct = (count / active.length) * 100;
              const bg =
                tier === "premium"
                  ? "var(--primary)"
                  : tier === "plus"
                  ? "var(--status-info)"
                  : "var(--status-ok)";
              return (
                <div
                  key={tier}
                  style={{ width: `${widthPct}%`, background: bg }}
                  title={`${count} ${tier} (${widthPct.toFixed(0)}%)`}
                />
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-fg-subtle">
            {(["basic", "plus", "premium"] as const).map((tier) => (
              <span key={tier} className="inline-flex items-center gap-1.5 capitalize">
                <span
                  className="size-2 rounded-full"
                  style={{
                    background:
                      tier === "premium"
                        ? "var(--primary)"
                        : tier === "plus"
                        ? "var(--status-info)"
                        : "var(--status-ok)",
                  }}
                />
                {tier} · {tierCounts[tier]}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Reactivation campaign ROI — only renders when at least one
          outreach has been sent. Pairs the count of "come back"
          messages with how many actually rejoined. */}
      {reactivationsSent > 0 && (
        <div className="mt-3 rounded-[12px] border border-hairline bg-surface-1 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[13px] font-medium text-fg">
                Reactivation campaign
              </h3>
              <p className="mt-0.5 text-[11px] text-fg-tertiary">
                Cancelled members who got a &ldquo;come back&rdquo; comm + how many rejoined.
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="money-display text-[20px] text-fg">
                {reactivationConversion}%
              </div>
              <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
                Won back
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-center text-[11px]">
            <div className="rounded-[8px] bg-surface-2 p-2">
              <div className="money-display text-[16px] text-fg">
                {reactivationsSent}
              </div>
              <div className="text-fg-tertiary">Reached</div>
            </div>
            <div className="rounded-[8px] bg-status-ok/10 p-2">
              <div className="money-display text-[16px] text-status-ok">
                {reactivationsConverted}
              </div>
              <div className="text-status-ok">Rejoined</div>
            </div>
          </div>
        </div>
      )}

      {/* Cohort retention — by signup month. Older cohorts have more
          milestones reached; younger ones show "—" for milestones not
          yet hit. Toggle splits by plan tier to spot whether premium
          retains better than basic. */}
      {cohorts.length > 0 && (
        <CohortRetentionPanel
          cohortsAll={cohorts}
          cohortsByTier={cohortsByTier}
        />
      )}

      {/* Member sentiment — one-tap rating distribution from completed
          bookings. Response rate shown separately so the operator knows
          if the sample is meaningful. */}
      {completedBookings.length > 0 && (
        <div className="mt-3 rounded-[12px] border border-hairline bg-surface-1 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[13px] font-medium text-fg">Member sentiment</h3>
              <p className="mt-0.5 text-[11px] text-fg-tertiary">
                Distribution of one-tap ratings on completed club days.
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="money-display text-[18px] text-fg">
                {responseRate}%
              </div>
              <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
                Response rate
              </div>
            </div>
          </div>
          {ratedBookings.length === 0 ? (
            <p className="mt-3 text-[12px] text-fg-tertiary">
              No ratings yet — members rate from the portal after their club day.
            </p>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <SentimentCard
                  emoji="😀"
                  label="Happy"
                  count={sentimentCounts.happy}
                  total={ratedBookings.length}
                  tone="ok"
                />
                <SentimentCard
                  emoji="😐"
                  label="Neutral"
                  count={sentimentCounts.neutral}
                  total={ratedBookings.length}
                  tone="neutral"
                />
                <SentimentCard
                  emoji="😞"
                  label="Sad"
                  count={sentimentCounts.sad}
                  total={ratedBookings.length}
                  tone="danger"
                />
              </div>
              {/* Stacked distribution bar */}
              <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="bg-status-ok"
                  style={{
                    width: `${Math.round((sentimentCounts.happy / ratedBookings.length) * 100)}%`,
                  }}
                />
                <div
                  className="bg-fg-tertiary/40"
                  style={{
                    width: `${Math.round((sentimentCounts.neutral / ratedBookings.length) * 100)}%`,
                  }}
                />
                <div
                  className="bg-status-danger/60"
                  style={{
                    width: `${Math.round((sentimentCounts.sad / ratedBookings.length) * 100)}%`,
                  }}
                />
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// Local Cohort row shape — duplicated here so this panel can live
// outside the analytics component without a full type re-export.
type CohortRow = {
  label: string;
  monthKey: string;
  size: number;
  retained30: number | null;
  retained90: number | null;
  retained180: number | null;
};

// Cohort retention panel with all-vs-by-tier toggle. Header chips
// flip the body between a single table (All) and three stacked
// tables (Basic / Plus / Premium).
function CohortRetentionPanel({
  cohortsAll,
  cohortsByTier,
}: {
  cohortsAll: CohortRow[];
  cohortsByTier: Record<
    import("@/lib/types").ClubPlanTier,
    CohortRow[]
  >;
}) {
  const [splitByTier, setSplitByTier] = React.useState(false);
  const COLS = "minmax(0, 1.4fr) 60px 80px 80px 80px";

  function renderTable(rows: CohortRow[]) {
    if (rows.length === 0) {
      return (
        <div className="px-4 py-4 text-[12px] text-fg-tertiary">
          No members in this tier yet.
        </div>
      );
    }
    return (
      <>
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{ gridTemplateColumns: COLS }}
        >
          <span>Cohort</span>
          <span className="text-right">Size</span>
          <span className="text-right">30d</span>
          <span className="text-right">90d</span>
          <span className="text-right">180d</span>
        </div>
        <ul className="divide-y divide-hairline">
          {rows.map((c) => (
            <li
              key={c.monthKey}
              className="grid items-center gap-x-3 px-4 py-2 text-[12px]"
              style={{ gridTemplateColumns: COLS }}
            >
              <span className="text-fg">{c.label}</span>
              <span className="text-right tabular text-fg-subtle">{c.size}</span>
              <CohortCell value={c.retained30} />
              <CohortCell value={c.retained90} />
              <CohortCell value={c.retained180} />
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <div className="mt-3 overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
      <header className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-fg">Cohort retention</h3>
          <p className="mt-0.5 text-[11px] text-fg-tertiary">
            % of each signup month&apos;s members still active at 30/90/180 days.
            Newest cohorts on top.
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setSplitByTier(false)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
              !splitByTier
                ? "border-primary/40 bg-primary-soft text-primary"
                : "border-hairline bg-surface-1 text-fg-muted hover:bg-surface-2"
            )}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setSplitByTier(true)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
              splitByTier
                ? "border-primary/40 bg-primary-soft text-primary"
                : "border-hairline bg-surface-1 text-fg-muted hover:bg-surface-2"
            )}
          >
            By tier
          </button>
        </div>
      </header>
      {!splitByTier ? (
        renderTable(cohortsAll)
      ) : (
        <div>
          {(["basic", "plus", "premium"] as const).map((tier) => (
            <div
              key={tier}
              className="border-b border-hairline last:border-b-0"
            >
              <div className="bg-surface-2/50 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
                {tier}
              </div>
              {renderTable(cohortsByTier[tier])}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Cohort retention cell — colors the % based on its band so the
// operator can scan the table without reading numbers.
function CohortCell({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-right text-fg-tertiary">—</span>;
  }
  const tone =
    value >= 80
      ? "text-status-ok"
      : value >= 60
      ? "text-fg"
      : value >= 40
      ? "text-status-warn"
      : "text-status-danger";
  return <span className={cn("text-right tabular", tone)}>{value}%</span>;
}

function SentimentCard({
  emoji,
  label,
  count,
  total,
  tone,
}: {
  emoji: string;
  label: string;
  count: number;
  total: number;
  tone: "ok" | "neutral" | "danger";
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div
      className={cn(
        "rounded-[8px] p-2.5",
        tone === "ok"
          ? "bg-status-ok/10"
          : tone === "danger"
          ? "bg-status-danger/10"
          : "bg-surface-2"
      )}
    >
      <div className="text-[20px]">{emoji}</div>
      <div className="mt-0.5 money-display text-[14px] text-fg">{pct}%</div>
      <div className="text-[10px] text-fg-tertiary">
        {label} · {count}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components

function Kpi({
  icon,
  label,
  value,
  sub,
  tone,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: "ok" | "warn" | "info" | "neutral";
  /** Optional drill-through. Clicking the tile navigates to a filtered list. */
  href?: string;
}) {
  const dot =
    tone === "warn" ? "bg-status-warn"
    : tone === "info" ? "bg-status-info"
    : tone === "ok" ? "bg-status-ok"
    : "bg-fg-tertiary/40";
  const valueTone = tone === "warn" ? "text-status-warn" : tone === "ok" ? "text-status-ok" : "text-fg";
  const inner = (
    <>
      <div className="mb-1.5 flex items-center justify-between text-fg-subtle">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium">{icon}{label}</span>
        <span className={"size-1.5 rounded-full " + dot} aria-hidden />
      </div>
      <div className={cn("money-display text-[26px]", valueTone)}>{value}</div>
      <div className="mt-1 text-[11px] text-fg-tertiary">{sub}</div>
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="rounded-[12px] border border-hairline bg-surface-1 p-4 transition-colors hover:border-hairline-strong hover:bg-surface-2"
      >
        {inner}
      </Link>
    );
  }
  return <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">{inner}</div>;
}

function Panel({
  title,
  icon,
  right,
  className,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-[12px] border border-hairline bg-surface-1", className)}>
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
          {icon}
          {title}
        </h3>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-[8px] border border-dashed border-hairline px-3 py-6 text-center text-[12px] text-fg-tertiary">
      {text}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sparkline / bar chart

function TrendChart({ months }: { months: { iso: string; label: string; total: number }[] }) {
  const max = Math.max(...months.map((m) => m.total), 1);
  const width = 600;
  const height = 140;
  const padding = { l: 8, r: 8, t: 8, b: 22 };
  const innerW = width - padding.l - padding.r;
  const innerH = height - padding.t - padding.b;
  const stepX = innerW / Math.max(months.length - 1, 1);

  const points = months.map((m, i) => ({
    x: padding.l + i * stepX,
    y: padding.t + innerH - (m.total / max) * innerH,
    m,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath =
    `M ${points[0].x} ${padding.t + innerH} ` +
    points.map((p) => `L ${p.x} ${p.y}`).join(" ") +
    ` L ${points[points.length - 1].x} ${padding.t + innerH} Z`;

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[160px] w-full" preserveAspectRatio="none">
        {/* Area */}
        <path d={areaPath} fill="var(--primary)" fillOpacity="0.12" />
        {/* Line */}
        <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        {/* Dots */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={2.5} fill="var(--primary)" />
            <text
              x={p.x}
              y={height - 8}
              textAnchor="middle"
              fontSize={9}
              fill="var(--fg-tertiary)"
            >
              {p.m.label}
            </text>
            <title>{`${p.m.label}: ${formatMoney(p.m.total)}`}</title>
          </g>
        ))}
      </svg>
      <div className="flex items-center justify-between text-[11px] text-fg-tertiary">
        <span>Hover any dot for the exact number.</span>
        <span>Peak: {formatMoney(max)}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

function invoicesBetween(invoices: LedgerEntry[], start: Date, end: Date): LedgerEntry[] {
  const s = start.toISOString();
  const e = end.toISOString();
  return invoices.filter((i) => i.date >= s.slice(0, 10) && i.date < e.slice(0, 10));
}

function sum(entries: LedgerEntry[]): number {
  return entries.reduce((s, i) => s + i.amount, 0);
}

function guessPosCategory(items: { sku: string; name: string }[]): string {
  // Roll up POS line items by SKU prefix
  const hasFuel = items.some((i) => i.sku?.startsWith("FUEL"));
  const hasFood = items.some((i) => /restaurant|cafe|sandwich|beer|coffee/i.test(i.name));
  if (hasFuel) return "Fuel Sales";
  if (hasFood) return "Restaurant";
  return "Retail Sales";
}
