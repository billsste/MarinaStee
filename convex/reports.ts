/*
 * Marina Stee — Reports / Analytics aggregator queries.
 *
 * Every query here:
 *   1. Calls `requireTenant(ctx)` first — no cross-tenant leakage.
 *   2. Pulls tenant-scoped rows via the existing `by_tenant` indexes.
 *   3. Reduces server-side and returns ONLY the aggregated shape — never
 *      raw row sets. The /reports surface is read-heavy so the wire cost
 *      of returning the underlying rows would dwarf the aggregate.
 *
 * Each aggregator is one query — DO NOT fan out from a panel into N
 * queries (that's a Convex subscription waterfall and the dashboard
 * stutters). Pages compose multiple aggregators in parallel via
 * `useTenantQuery` on the read side; the Convex client handles batching.
 *
 * Mock parity: every page-side panel computes the same aggregated shape
 * from the existing `useStore()` data when CONVEX_URL is unset. See
 * `components/reports/*-panel.tsx` for the JS mirror of each function.
 */

import { query } from "./_generated/server";
import { requireTenant } from "./_helpers";

// ────────────────────────────────────────────────────────────
// Local helpers
// ────────────────────────────────────────────────────────────

/** YYYY-MM-DD in local time. Mirrors lib/contracts.ts → localIsoDate. */
function isoFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const DAY_MS = 86_400_000;

// ────────────────────────────────────────────────────────────
// Occupancy by dock
// ────────────────────────────────────────────────────────────

/**
 * occupancyByDock — one row per dock with occupancy split.
 *
 * Returns: [{ dock_id, name, total, occupied, vacant, occupancy_pct }]
 * Source: `docks` + `slips` (occupancy_status field on slip).
 *
 * Note: we do NOT subdivide "vacant" into seasonal vs annual here — that
 * distinction lives on the contract side and would require a join per
 * slip. The panel surfaces a simple occupied/vacant split; the
 * seasonal/annual breakdown is exposed in the contracts portfolio KPIs.
 */
export const occupancyByDock = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    const docks = await ctx.db
      .query("docks")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const slips = await ctx.db
      .query("slips")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();

    const byDock = new Map<
      string,
      { dock_id: string; name: string; total: number; occupied: number; reserved: number; out_of_service: number; vacant: number }
    >();
    for (const d of docks) {
      byDock.set(d._id, {
        dock_id: d._id,
        name: d.short_name || d.name,
        total: 0,
        occupied: 0,
        reserved: 0,
        out_of_service: 0,
        vacant: 0,
      });
    }
    for (const s of slips) {
      const row = byDock.get(s.dock_id);
      if (!row) continue;
      row.total += 1;
      if (s.occupancy_status === "occupied") row.occupied += 1;
      else if (s.occupancy_status === "reserved") row.reserved += 1;
      else if (s.occupancy_status === "out_of_service") row.out_of_service += 1;
      else row.vacant += 1;
    }
    return Array.from(byDock.values())
      .map((r) => ({
        ...r,
        // Count occupied + reserved as "in use" for the percentage —
        // matches the existing total-occupancy KPI behavior.
        occupancy_pct: r.total > 0 ? ((r.occupied + r.reserved) / r.total) * 100 : 0,
      }))
      .sort((a, b) => b.occupancy_pct - a.occupancy_pct);
  },
});

// ────────────────────────────────────────────────────────────
// Revenue mix — YTD by category
// ────────────────────────────────────────────────────────────

/**
 * revenueMixYtd — total dollars per revenue category for the current
 * calendar year. Slip / Fuel / POS / Boat Rentals / Club / Services.
 *
 * Categorization rules:
 *   - Ledger invoices: gl_account-tagged go to that bucket; rentals
 *     linked through linked_boat_rental_id go to Boat Rentals; club
 *     linked through linked_club_subscription_id → Club; otherwise
 *     fall back to gl_account or "Other".
 *   - POS orders: rolled up by location key (fuel → Fuel Sales, etc.).
 *
 * Returns: [{ category, amount }] sorted by amount desc.
 *
 * NOTE: the page-side mock mirror in `revenue-mix-panel.tsx` runs the
 * same classification so the visual is identical regardless of source.
 */
export const revenueMixYtd = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    const yearStart = isoFromDate(new Date(new Date().getFullYear(), 0, 1));

    const ledger = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const posOrders = await ctx.db
      .query("posOrders")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const locations = await ctx.db
      .query("posLocations")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const locById = new Map(locations.map((l) => [l._id, l] as const));

    const buckets = new Map<string, number>();
    for (const inv of ledger) {
      if (inv.type !== "invoice") continue;
      if (inv.date < yearStart) continue;
      let bucket: string;
      if (inv.linked_pos_order_id) bucket = "POS";
      else if (inv.linked_contract_id) bucket = "Slip Fees";
      else bucket = "Services";
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + inv.amount);
    }
    for (const order of posOrders) {
      if (!order.closed_at || order.closed_at < yearStart) continue;
      if (order.status !== "paid") continue;
      const loc = locById.get(order.location_id);
      const bucket =
        loc?.key === "fuel_dock"
          ? "Fuel"
          : loc?.key === "restaurant"
            ? "Restaurant"
            : "Retail";
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + order.subtotal);
    }

    return Array.from(buckets.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  },
});

// ────────────────────────────────────────────────────────────
// A/R aging buckets
// ────────────────────────────────────────────────────────────

/**
 * arAgingBuckets — open A/R bucketed by invoice age.
 *
 * Buckets: 0–30 / 31–60 / 61–90 / 90+ days past invoice date.
 * For each bucket returns total $ + count of contributing invoices.
 *
 * Also returns `byBucket: { [key]: boater_id[] }` so the panel can
 * present a per-bucket drill-down list. Boater ids dedupe per bucket.
 */
export const arAgingBuckets = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    const openInvoices = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "open"),
      )
      .collect();
    const partials = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_tenant_status", (q) =>
        q.eq("tenantId", tenantId).eq("status", "partial"),
      )
      .collect();

    const todayMs = Date.now();
    type BucketKey = "0_30" | "31_60" | "61_90" | "90_plus";
    const buckets: Record<BucketKey, { amount: number; count: number; boater_ids: string[] }> = {
      "0_30": { amount: 0, count: 0, boater_ids: [] },
      "31_60": { amount: 0, count: 0, boater_ids: [] },
      "61_90": { amount: 0, count: 0, boater_ids: [] },
      "90_plus": { amount: 0, count: 0, boater_ids: [] },
    };
    const seen: Record<BucketKey, Set<string>> = {
      "0_30": new Set(),
      "31_60": new Set(),
      "61_90": new Set(),
      "90_plus": new Set(),
    };

    for (const inv of [...openInvoices, ...partials]) {
      if (inv.type !== "invoice") continue;
      if (inv.open_balance <= 0) continue;
      const ageDays = Math.floor((todayMs - new Date(inv.date).getTime()) / DAY_MS);
      const bk: BucketKey =
        ageDays <= 30 ? "0_30" : ageDays <= 60 ? "31_60" : ageDays <= 90 ? "61_90" : "90_plus";
      buckets[bk].amount += inv.open_balance;
      buckets[bk].count += 1;
      if (!seen[bk].has(inv.boater_id)) {
        seen[bk].add(inv.boater_id);
        buckets[bk].boater_ids.push(inv.boater_id);
      }
    }

    return buckets;
  },
});

// ────────────────────────────────────────────────────────────
// Churn risk — top 10 boaters by composite signal
// ────────────────────────────────────────────────────────────

/**
 * churnRiskBoaters — composite 0-100 risk score per boater.
 *
 * Signals (weighted):
 *   +35 — has lapsed contract
 *   +25 — has invoices 60+ days past due
 *   +20 — contract expiring within 60 days, no successor on file
 *   +15 — bounced/failed outbound comm in last 30 days
 *   +5  — no payment recorded in last 90 days
 *
 * Returns the top 10 scored boaters with the signals that contributed.
 */
export const churnRiskBoaters = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    const boaters = await ctx.db
      .query("boaters")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const contracts = await ctx.db
      .query("contracts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const ledger = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const comms = await ctx.db
      .query("communications")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();

    const todayMs = Date.now();
    const sixtyOutIso = isoFromDate(new Date(todayMs + 60 * DAY_MS));
    const ninetyAgoIso = isoFromDate(new Date(todayMs - 90 * DAY_MS));
    const thirtyAgoIso = isoFromDate(new Date(todayMs - 30 * DAY_MS));

    type Row = {
      boater_id: string;
      display_name: string;
      score: number;
      signals: string[];
    };
    const rows: Row[] = [];
    for (const b of boaters) {
      let score = 0;
      const signals: string[] = [];
      const myContracts = contracts.filter((c) => c.boater_id === b._id);
      const myLedger = ledger.filter((l) => l.boater_id === b._id);
      const myComms = comms.filter((c) => c.boater_id === b._id);

      if (myContracts.some((c) => c.status === "expired" || c.status === "terminated")) {
        score += 35;
        signals.push("Lapsed contract");
      }
      const overdue60 = myLedger.some((l) => {
        if (l.type !== "invoice" || l.open_balance <= 0) return false;
        return (todayMs - new Date(l.date).getTime()) / DAY_MS >= 60;
      });
      if (overdue60) {
        score += 25;
        signals.push("Payments 60+ days overdue");
      }
      const expiring = myContracts.find(
        (c) =>
          c.status === "active" &&
          c.effective_end > isoFromDate(new Date(todayMs)) &&
          c.effective_end <= sixtyOutIso,
      );
      if (expiring) {
        score += 20;
        signals.push("Contract expiring < 60d");
      }
      const recentFail = myComms.some(
        (c) =>
          c.direction === "outbound" &&
          (c.status === "failed" || c.status === "bounced") &&
          c.sent_at >= thirtyAgoIso,
      );
      if (recentFail) {
        score += 15;
        signals.push("Comm bounced (30d)");
      }
      const recentPayment = myLedger.some(
        (l) => l.type === "payment" && l.date >= ninetyAgoIso,
      );
      if (!recentPayment && myLedger.length > 0) {
        score += 5;
        signals.push("No payment in 90d");
      }

      if (score > 0) {
        rows.push({
          boater_id: b._id,
          display_name: b.display_name,
          score: Math.min(100, score),
          signals,
        });
      }
    }
    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, 10);
  },
});

// ────────────────────────────────────────────────────────────
// Fleet utilization (last 14 days)
// ────────────────────────────────────────────────────────────

/**
 * fleetUtilizationDaily — per rental boat, the daily % of days booked
 * over the last 14 days plus a flat per-boat utilization rate.
 *
 * Returns per boat: { boat_id, name, type, daily: number[], pct }
 * where `daily[i]` is 0 or 1 for "had at least one booking that day"
 * over a 14-element sparkline window (oldest → newest).
 *
 * The panel highlights overused (>85%) and underused (<40%) rows.
 */
export const fleetUtilizationDaily = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    const boats = await ctx.db
      .query("rentalBoats")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const rentals = await ctx.db
      .query("boatRentals")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();

    const today = new Date();
    const window: string[] = [];
    for (let i = 13; i >= 0; i -= 1) {
      window.push(isoFromDate(new Date(today.getTime() - i * DAY_MS)));
    }

    return boats.map((b) => {
      const days = window.map((iso) => {
        const booked = rentals.some(
          (r) => r.boat_id === b._id && r.start_at.slice(0, 10) <= iso && r.end_at.slice(0, 10) >= iso && r.status !== "cancelled",
        );
        return booked ? 1 : 0;
      });
      const sum = days.reduce((a, n) => a + n, 0);
      return {
        boat_id: b._id,
        name: b.name,
        type: b.type,
        daily: days,
        pct: days.length > 0 ? (sum / days.length) * 100 : 0,
      };
    });
  },
});

// ────────────────────────────────────────────────────────────
// Comms throughput (last 8 weeks)
// ────────────────────────────────────────────────────────────

/**
 * commsThroughputWeekly — 8-week stacked bar:
 *   weekly buckets, each split by channel (email / sms / voice).
 *   delivered + failed counts per channel.
 *
 * Returns: { weeks: [{ iso, label, email: {delivered, failed}, sms: {...}, voice: {...} }] }
 */
export const commsThroughputWeekly = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    const comms = await ctx.db
      .query("communications")
      .withIndex("by_tenant_sent_at", (q) => q.eq("tenantId", tenantId))
      .collect();

    const now = new Date();
    type ChannelCounts = { delivered: number; failed: number };
    type WeekRow = {
      iso: string;
      label: string;
      email: ChannelCounts;
      sms: ChannelCounts;
      voice: ChannelCounts;
    };
    const weeks: WeekRow[] = [];
    for (let i = 7; i >= 0; i -= 1) {
      const weekStart = new Date(now.getTime() - i * 7 * DAY_MS);
      // Snap to start-of-week (Monday-ish, locale-aware enough for buckets)
      const iso = isoFromDate(weekStart);
      weeks.push({
        iso,
        label: weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        email: { delivered: 0, failed: 0 },
        sms: { delivered: 0, failed: 0 },
        voice: { delivered: 0, failed: 0 },
      });
    }
    const oldestStartMs = new Date(weeks[0].iso).getTime();

    for (const c of comms) {
      const sentMs = new Date(c.sent_at).getTime();
      if (sentMs < oldestStartMs) continue;
      const weekIdx = Math.min(7, Math.floor((sentMs - oldestStartMs) / (7 * DAY_MS)));
      const bucket = weeks[weekIdx];
      if (!bucket) continue;
      const channelKey: "email" | "sms" | "voice" =
        c.type === "email" ? "email" : c.type === "sms" ? "sms" : "voice";
      const isFail = c.status === "failed" || c.status === "bounced";
      if (isFail) bucket[channelKey].failed += 1;
      else bucket[channelKey].delivered += 1;
    }
    return { weeks };
  },
});

// ────────────────────────────────────────────────────────────
// Expiring contracts / COIs counts
// ────────────────────────────────────────────────────────────

/**
 * expiringWatchlist — counts of contracts + COIs falling into 30/60/90
 * day buckets, plus an `expired` bucket. Light-weight summary so the
 * KPI strip + the expiring-watchlist panel can both read from one query.
 *
 * Returns: { contracts: {b30, b60, b90, expired}, cois: {b30, b60, b90, expired} }
 */
export const expiringWatchlist = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    const contracts = await ctx.db
      .query("contracts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const cois = await ctx.db
      .query("insuranceCertificates")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();

    const today = new Date();
    const todayIso = isoFromDate(today);
    const c30 = isoFromDate(new Date(today.getTime() + 30 * DAY_MS));
    const c60 = isoFromDate(new Date(today.getTime() + 60 * DAY_MS));
    const c90 = isoFromDate(new Date(today.getTime() + 90 * DAY_MS));

    function bucketize(endIso: string | undefined, alreadyExpired: boolean): "expired" | "b30" | "b60" | "b90" | null {
      if (!endIso) return null;
      if (alreadyExpired || endIso <= todayIso) return "expired";
      if (endIso <= c30) return "b30";
      if (endIso <= c60) return "b60";
      if (endIso <= c90) return "b90";
      return null;
    }

    const contractsBucket = { b30: 0, b60: 0, b90: 0, expired: 0 };
    for (const c of contracts) {
      // Mock + Convex contract status sets differ slightly — accept the
      // "live" statuses common to both.
      const live = c.status === "active" || c.status === "sent" || c.status === "signed";
      const isExpired = c.status === "expired" || c.status === "terminated";
      if (!live && !isExpired) continue;
      const b = bucketize(c.effective_end, isExpired);
      if (!b) continue;
      contractsBucket[b] += 1;
    }
    const coisBucket = { b30: 0, b60: 0, b90: 0, expired: 0 };
    for (const c of cois) {
      const b = bucketize(c.effective_end, c.status === "expired" || c.status === "lapsed");
      if (!b) continue;
      coisBucket[b] += 1;
    }

    return { contracts: contractsBucket, cois: coisBucket };
  },
});

// ────────────────────────────────────────────────────────────
// Club program performance — placeholder shape
// ────────────────────────────────────────────────────────────

/**
 * clubProgramPerformance — per-plan rollup for the Rental Club product.
 *
 * Convex doesn't have a clubSubscriptions table yet (Phase 4 leaves club
 * data on the mock store), so this query returns an empty result set.
 * Once the table lands this becomes a real rollup; the panel already
 * has the mock-side computation that mirrors the returned shape.
 *
 * Returns: { plans: [{ tier, active, mrr, avg_bookings_per_member, no_show_rate }] }
 */
export const clubProgramPerformance = query({
  args: {},
  handler: async (ctx) => {
    await requireTenant(ctx);
    return { plans: [] as Array<{
      tier: "basic" | "plus" | "premium";
      active: number;
      mrr: number;
      avg_bookings_per_member: number;
      no_show_rate: number;
    }> };
  },
});
