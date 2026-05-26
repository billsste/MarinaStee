"use client";

import * as React from "react";
import Link from "next/link";
import { Anchor, CalendarClock, Crown, DollarSign, FileSignature, Percent, Ship, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  BOATERS,
  RENTAL_GROUPS,
  RENTAL_SPACES,
  formatMoney,
  totalOccupancy,
} from "@/lib/mock-data";
import { useContracts, useStore } from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { LedgerEntry } from "@/lib/types";

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

export function ReportsView() {
  const { ledger, posOrders } = useStore();
  const contracts = useContracts();

  // ── Annual portfolio metrics (the LEAD section) ──────────────────────
  const now = new Date();
  const ninetyDays = now.getTime() + 90 * 86_400_000;
  const oneEightyDays = now.getTime() + 180 * 86_400_000;
  const lastYearStartDate = new Date(now.getFullYear() - 1, 0, 1).getTime();
  const lastYearEndDate = new Date(now.getFullYear() - 1, 11, 31).getTime();

  const activeAnnualContracts = contracts.filter(
    (c) => c.status === "active" && (c.billing_cadence === "monthly" || c.billing_cadence === "annual")
  );
  const annualARR = activeAnnualContracts.reduce((s, c) => s + (c.annual_rate ?? 0), 0);

  const expiring90 = activeAnnualContracts.filter((c) => {
    const end = new Date(c.effective_end).getTime();
    return end > now.getTime() && end <= ninetyDays;
  });
  const expiring180 = activeAnnualContracts.filter((c) => {
    const end = new Date(c.effective_end).getTime();
    return end > now.getTime() && end <= oneEightyDays;
  });

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

  return (
    <div className="space-y-6">
      {/* ── ANNUAL PORTFOLIO — the lead section ───────────────────── */}
      <section>
        <h2 className="mb-3 text-[13px] font-medium uppercase tracking-wide text-fg-tertiary">
          Annual portfolio
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Kpi
            icon={<DollarSign className="size-4" />}
            label="Annual ARR"
            value={formatMoney(annualARR)}
            sub={`${activeAnnualContracts.length} active contracts`}
            tone="ok"
            href="/docks/contracts"
          />
          <Kpi
            icon={<CalendarClock className="size-4" />}
            label="Expiring in 90 days"
            value={`${expiring90.length}`}
            sub={`${expiring180.length} within 180 days`}
            tone={expiring90.length > 0 ? "warn" : "neutral"}
            href="/docks/slips"
          />
          <Kpi
            icon={<FileSignature className="size-4" />}
            label="Renewal rate (last yr)"
            value={renewalRate === null ? "—" : `${renewalRate.toFixed(0)}%`}
            sub={
              renewalRate === null
                ? "No contracts ended yet"
                : `${renewedCount} of ${endedLastYear.length} renewed`
            }
            tone={renewalRate === null ? "neutral" : renewalRate >= 85 ? "ok" : renewalRate >= 70 ? "info" : "warn"}
            href="/docks/contracts"
          />
          <Kpi
            icon={<Ship className="size-4" />}
            label="Lapsed"
            value={`${lapsedContracts.length}`}
            sub="Need re-engagement or waitlist match"
            tone={lapsedContracts.length > 0 ? "warn" : "ok"}
            href="/docks/slips"
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
            sub={`${invoicesBetween(invoices, monthStart, now).length} invoices`}
            tone="neutral"
            href="/ledger"
          />
          <Kpi
            icon={<TrendingUp className="size-4" />}
            label="YTD vs last year"
            value={
              lastYearTotal === 0
                ? "—"
                : `${yoyDelta >= 0 ? "+" : ""}${yoyDelta.toFixed(1)}%`
            }
            sub={`${formatMoney(ytd)} this year`}
            tone={yoyDelta >= 0 ? "ok" : "warn"}
            href="/ledger"
          />
          <Kpi
            icon={<Percent className="size-4" />}
            label="Occupancy"
            value={`${occ.pct.toFixed(0)}%`}
            sub={`${occ.occupied} of ${occ.total} spaces`}
            tone={occ.pct > 80 ? "ok" : occ.pct > 50 ? "info" : "warn"}
            href="/docks"
          />
          <Kpi
            icon={<Ship className="size-4" />}
            label="Avg slip invoice"
            value={formatMoney(avgSlipInvoice)}
            sub={`${slipInvoices.length} slip invoices`}
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
                    href={`/holders/${r.boater!.id}`}
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

      <p className="text-center text-[11px] text-fg-tertiary">
        Reports recompute from the live store. Pay an invoice in /portal or ring up a sale in /ledger
        and refresh — the numbers move.
      </p>
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
