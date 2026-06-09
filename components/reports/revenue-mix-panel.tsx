"use client";

/*
 * Revenue mix YTD — horizontal stacked bar by category + per-row legend
 * with $ and % of total.
 *
 * Mock side reads `useLedger` + `usePosOrders` to compute the same
 * shape (Slip Fees / POS / Fuel / Restaurant / Retail / Services /
 * Boat Rentals). Convex side reads `reports.revenueMixYtd` — both sides
 * return the same `{ category, amount }[]` shape.
 */

import * as React from "react";
import { DollarSign } from "lucide-react";
import { anyApi } from "convex/server";
import { useLedger, usePosOrders } from "@/lib/client-store";
import { formatMoney } from "@/lib/mock-data";
import { useTenantQuery } from "@/lib/use-tenant-query";

export interface RevenueRow {
  category: string;
  amount: number;
}

const EMPTY_ARGS = {} as const;

/**
 * Palette — keep small + intentional. New categories fall back to
 * the "Other" gray token so a typo doesn't show up as transparent.
 */
const CATEGORY_TONE: Record<string, string> = {
  "Slip Fees": "var(--primary)",
  Fuel: "var(--status-info)",
  Restaurant: "#c084fc",
  Retail: "var(--status-ok)",
  POS: "var(--status-ok)",
  Services: "var(--status-warn)",
  "Boat Rentals": "#60a5fa",
  Club: "#f59e0b",
  Other: "var(--fg-tertiary)",
};

export function RevenueMixPanel() {
  const ledger = useLedger();
  const posOrders = usePosOrders();

  const mock = React.useMemo<RevenueRow[]>(() => {
    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    const buckets = new Map<string, number>();
    for (const l of ledger) {
      if (l.type !== "invoice") continue;
      if (l.date < yearStart) continue;
      let cat: string;
      if (l.linked_pos_order_id) cat = "POS";
      else if (l.linked_contract_id) cat = "Slip Fees";
      else if (l.linked_boat_rental_id) cat = "Boat Rentals";
      else if (l.linked_club_subscription_id) cat = "Club";
      else if (l.gl_account) cat = l.gl_account.replace(" Revenue", "").replace(" Sales", "");
      else cat = "Services";
      buckets.set(cat, (buckets.get(cat) ?? 0) + l.amount);
    }
    for (const o of posOrders) {
      if (o.status !== "paid") continue;
      // Classify by first line item — quick + close enough for the mix
      // strip. The Convex side classifies by location key which is
      // structurally similar (and the panel doesn't pivot on the
      // distinction).
      const hasFuel = o.line_items.some((li) => /fuel/i.test(li.sku) || /fuel/i.test(li.name));
      const hasFood = o.line_items.some((li) => /restaurant|cafe|sandwich|beer|coffee/i.test(li.name));
      const cat = hasFuel ? "Fuel" : hasFood ? "Restaurant" : "Retail";
      buckets.set(cat, (buckets.get(cat) ?? 0) + o.subtotal);
    }
    return Array.from(buckets.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [ledger, posOrders]);

  const rows = useTenantQuery<RevenueRow[]>({
    mock,
    convexRef: anyApi.reports.revenueMixYtd,
    convexArgs: EMPTY_ARGS,
  });

  const total = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
          <DollarSign className="size-3.5" />
          Revenue mix · YTD
        </h3>
        <span className="text-[12px] text-fg-subtle">{formatMoney(total)} total</span>
      </div>
      <div className="p-4">
        {total === 0 ? (
          <div className="rounded-[8px] border border-dashed border-hairline px-3 py-6 text-center text-[12px] text-fg-tertiary">
            No revenue posted this year yet.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex h-3 overflow-hidden rounded-full bg-surface-3">
              {rows.map((r) => {
                const pct = total > 0 ? (r.amount / total) * 100 : 0;
                return (
                  <div
                    key={r.category}
                    style={{ width: `${pct}%`, backgroundColor: CATEGORY_TONE[r.category] ?? CATEGORY_TONE.Other }}
                    title={`${r.category}: ${formatMoney(r.amount)} (${pct.toFixed(1)}%)`}
                  />
                );
              })}
            </div>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-2 text-[12px] sm:grid-cols-2">
              {rows.map((r) => {
                const pct = total > 0 ? (r.amount / total) * 100 : 0;
                return (
                  <li key={r.category} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 truncate">
                      <span
                        aria-hidden
                        className="inline-block size-2.5 rounded-sm"
                        style={{ backgroundColor: CATEGORY_TONE[r.category] ?? CATEGORY_TONE.Other }}
                      />
                      <span className="truncate text-fg">{r.category}</span>
                    </span>
                    <span className="tabular text-fg-subtle">
                      {formatMoney(r.amount)} · <span className="text-fg-tertiary">{pct.toFixed(1)}%</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
