"use client";

/*
 * Club program performance — per plan tier (Basic / Plus / Premium):
 *   - active subscribers
 *   - MRR contribution
 *   - avg bookings per subscriber per month
 *   - no-show rate
 *
 * Convex side (clubProgramPerformance) returns an empty plans array
 * until the clubSubscriptions table lands — the mock side computes the
 * real numbers from `useClubSubscriptions` / `useClubBookings` so the
 * panel renders in demo mode until then.
 */

import * as React from "react";
import { Crown } from "lucide-react";
import { anyApi } from "convex/server";
import { effectivePlanFor, useClubBookings, useClubSubscriptions } from "@/lib/client-store";
import { formatMoney } from "@/lib/mock-data";
import { useTenantQuery } from "@/lib/use-tenant-query";
import type { ClubPlanTier } from "@/lib/types";

export interface ClubPlanRow {
  tier: ClubPlanTier;
  active: number;
  mrr: number;
  avg_bookings_per_member: number;
  no_show_rate: number;
}

export interface ClubPerformanceShape {
  plans: ClubPlanRow[];
}

const EMPTY_ARGS = {} as const;
const ORDERED_TIERS: ClubPlanTier[] = ["basic", "plus", "premium"];
const TIER_TONE: Record<ClubPlanTier, string> = {
  basic: "var(--status-ok)",
  plus: "var(--status-info)",
  premium: "var(--primary)",
};

export function ClubPerformancePanel() {
  const subs = useClubSubscriptions();
  const bookings = useClubBookings();

  const mock = React.useMemo<ClubPerformanceShape>(() => {
    const monthsActiveByTier: Record<ClubPlanTier, number> = { basic: 0, plus: 0, premium: 0 };
    const plans: Record<ClubPlanTier, ClubPlanRow> = {
      basic: { tier: "basic", active: 0, mrr: 0, avg_bookings_per_member: 0, no_show_rate: 0 },
      plus: { tier: "plus", active: 0, mrr: 0, avg_bookings_per_member: 0, no_show_rate: 0 },
      premium: { tier: "premium", active: 0, mrr: 0, avg_bookings_per_member: 0, no_show_rate: 0 },
    };
    const tierSubIds: Record<ClubPlanTier, Set<string>> = {
      basic: new Set(),
      plus: new Set(),
      premium: new Set(),
    };

    const now = new Date();
    for (const s of subs) {
      if (s.status !== "active") continue;
      const plan = effectivePlanFor(s);
      if (!plan?.plan_tier) continue;
      const tier = plan.plan_tier;
      plans[tier].active += 1;
      plans[tier].mrr += plan.monthly_fee ?? 0;
      tierSubIds[tier].add(s.id);
      // Months active — clamp to >=1 so freshly-joined members don't
      // divide by zero in the averages below.
      const monthsActive = Math.max(
        1,
        Math.floor((now.getTime() - new Date(s.member_since).getTime()) / (30 * 86_400_000)),
      );
      monthsActiveByTier[tier] += monthsActive;
    }

    const bookingsByTier: Record<ClubPlanTier, number> = { basic: 0, plus: 0, premium: 0 };
    const noShowsByTier: Record<ClubPlanTier, number> = { basic: 0, plus: 0, premium: 0 };
    for (const b of bookings) {
      // Resolve tier through the subscription. If unresolved (deleted
      // subscription, weird seed) skip — the rollup is best-effort.
      const tier = ORDERED_TIERS.find((t) => tierSubIds[t].has(b.subscription_id));
      if (!tier) continue;
      if (b.status === "no_show") noShowsByTier[tier] += 1;
      if (b.status === "completed" || b.status === "checked_in" || b.status === "confirmed" || b.status === "no_show") {
        bookingsByTier[tier] += 1;
      }
    }
    for (const t of ORDERED_TIERS) {
      const memberMonths = monthsActiveByTier[t];
      plans[t].avg_bookings_per_member =
        memberMonths > 0 ? bookingsByTier[t] / memberMonths : 0;
      const denom = bookingsByTier[t];
      plans[t].no_show_rate = denom > 0 ? (noShowsByTier[t] / denom) * 100 : 0;
    }
    return { plans: ORDERED_TIERS.map((t) => plans[t]) };
  }, [subs, bookings]);

  const data = useTenantQuery<ClubPerformanceShape>({
    mock,
    convexRef: anyApi.reports.clubProgramPerformance,
    convexArgs: EMPTY_ARGS,
  });
  // When Convex returns empty (placeholder until subs table migrates)
  // fall back to the mock derivation so the panel still renders.
  const plans = data.plans.length > 0 ? data.plans : mock.plans;
  const totalActive = plans.reduce((s, p) => s + p.active, 0);

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
          <Crown className="size-3.5" />
          Club program performance
        </h3>
        <span className="text-[11px] text-fg-tertiary">
          {totalActive} active member{totalActive === 1 ? "" : "s"}
        </span>
      </div>
      <div className="p-4">
        {totalActive === 0 ? (
          <div className="rounded-[8px] border border-dashed border-hairline px-3 py-6 text-center text-[12px] text-fg-tertiary">
            No club subscriptions yet.
          </div>
        ) : (
          <div className="space-y-3">
            {plans.map((p) => (
              <div
                key={p.tier}
                className="rounded-[8px] border border-hairline bg-surface-2/40 p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] font-medium text-fg capitalize">
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ background: TIER_TONE[p.tier] }}
                    />
                    {p.tier}
                  </span>
                  <span className="text-[11px] text-fg-tertiary">
                    {p.active} sub{p.active === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                  <div className="rounded-[6px] bg-surface-2 p-2">
                    <div className="money-display text-[14px] text-fg">{formatMoney(p.mrr)}</div>
                    <div className="text-fg-tertiary">MRR</div>
                  </div>
                  <div className="rounded-[6px] bg-surface-2 p-2">
                    <div className="money-display text-[14px] text-fg">
                      {p.avg_bookings_per_member.toFixed(1)}
                    </div>
                    <div className="text-fg-tertiary">Bookings / mo</div>
                  </div>
                  <div
                    className={
                      p.no_show_rate > 10
                        ? "rounded-[6px] bg-status-danger/10 p-2"
                        : "rounded-[6px] bg-surface-2 p-2"
                    }
                  >
                    <div
                      className={
                        p.no_show_rate > 10
                          ? "money-display text-[14px] text-status-danger"
                          : "money-display text-[14px] text-fg"
                      }
                    >
                      {p.no_show_rate.toFixed(0)}%
                    </div>
                    <div className="text-fg-tertiary">No-show</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
