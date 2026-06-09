/*
 * Saved reports for the agent.
 *
 * Five v1 reports the operator can ask for in plain English ("who owes
 * money?", "what's expiring in October?", "how full are the docks?").
 * Each report is a pure server-side function that returns a TableResult
 * the chat host renders as an actual table card — not markdown.
 *
 * Why a fixed catalog instead of a flexible query builder
 * ───────────────────────────────────────────────────────
 * A `query_entities(entity, filters, group_by, aggregate)` mega-tool would
 * be flexible but hard to constrain — the agent would invent invalid
 * field paths and the operator would get spinning-wheel-of-death
 * responses. Five well-shaped reports cover ~80% of the daily ops asks
 * with predictable output. Add more here as the agent surfaces gaps.
 *
 * Adding a report
 * ───────────────
 *   1. Add the report function to REPORTS below — it returns a TableResult.
 *   2. Add a `report_*` entry to READ_TOOLS in app/api/agent/route.ts.
 *   3. Wire executeReadTool to call your function.
 *   4. Mention it in the system-prompt reports section.
 */

import {
  CONTRACTS,
  METER_READINGS,
  RENTAL_GROUPS,
  RENTAL_SPACES,
  RESERVATIONS,
  SLIPS,
  WORK_ORDERS,
  meterDelta,
} from "@/lib/mock-data";
import type { Boater, Contract, LedgerEntry } from "@/lib/types";
import {
  EXPIRING_SOON_WINDOW_MS,
  classifyContractStatus,
  localIsoDate,
} from "@/lib/contracts";
import { deriveSlipStatus } from "@/lib/slip-status";
import { daysBetween } from "@/lib/utils";

/**
 * Cell value shape — kept narrow so the chat-host renderer can format
 * each column consistently (currency right-aligned, dates as YYYY-MM-DD,
 * etc.) without sniffing types per row.
 */
export type CellValue = string | number | null;

export type ColumnAlign = "left" | "right";

export type ColumnFormat = "text" | "currency" | "number" | "date" | "percent" | "days";

export interface TableColumn {
  /** Stable column key — used as object key in rows. */
  key: string;
  /** Header label shown in the table card. */
  label: string;
  /** Renderer hint. Currency formats with $ + 2dp, percent with %, etc. */
  format?: ColumnFormat;
  /** Cell alignment. Defaults to "right" for numeric formats, "left" otherwise. */
  align?: ColumnAlign;
}

export interface TableResult {
  /** Discriminator the chat host reads to switch into table mode. */
  kind: "table";
  /** Report title for the card header. */
  title: string;
  /** Optional one-line subtitle — date range, filter summary. */
  subtitle?: string;
  /** Column definitions in render order. */
  columns: TableColumn[];
  /** Data rows. Object keys must match column keys. */
  rows: Record<string, CellValue>[];
  /** Optional footer row (total). Same shape as a data row. */
  total_row?: Record<string, CellValue>;
  /** Count surfaced in the agent transcript line above the table. */
  count: number;
  /** Catalog key of the report — useful for "rerun" affordances later. */
  report_key: string;
  /**
   * Parallel array — one entry per row. When set, the renderer makes
   * the row a clickable button that does client-side router.push(path).
   * `null` means that row has no drill-down (e.g. a synthesized
   * aggregate row). Used by reports where each row maps to a single
   * domain entity: open_balances → /members/[id], contracts_expiring
   * → /services/contracts/[id], etc.
   */
  row_paths?: (string | null)[];
}

/*
 * ────────────────────────────────────────────────────────────
 * Catalog
 * ────────────────────────────────────────────────────────────
 */

/**
 * Open balances — boaters with money owed. Operator's daily A/R glance.
 * Sorted by amount descending. Excludes zero balances.
 */
export function reportOpenBalances(
  ledger: LedgerEntry[],
  scopedBoaters: Boater[],
  options: { min_amount?: number } = {},
): TableResult {
  const minAmount = options.min_amount ?? 0;
  const today = localIsoDate();
  const enriched = scopedBoaters
    .map((b) => {
      const openInvoices = ledger.filter(
        (l) => l.boater_id === b.id && l.type === "invoice" && l.open_balance > 0,
      );
      const open = openInvoices.reduce((s, l) => s + l.open_balance, 0);
      // Oldest open invoice → drives days_overdue.
      const oldest = openInvoices
        .map((l) => l.date)
        .sort()
        [0];
      const days = oldest
        ? Math.max(0, daysBetween(oldest, today))
        : 0;
      const slipCode = b.code ?? "—";
      return {
        boater_id: b.id,
        row: {
          boater: b.display_name,
          slip: slipCode,
          balance: open,
          days_overdue: days,
          oldest_invoice: oldest ?? null,
        },
      };
    })
    .filter((r) => (r.row.balance as number) >= minAmount && (r.row.balance as number) > 0)
    .sort((a, b) => (b.row.balance as number) - (a.row.balance as number));
  const rows = enriched.map((e) => e.row);
  const rowPaths = enriched.map((e) => `/members/${e.boater_id}`);

  const totalOpen = rows.reduce((s, r) => s + (r.balance as number), 0);

  return {
    kind: "table",
    title: "Open balances",
    subtitle: minAmount > 0 ? `Filter: ≥ $${minAmount}` : undefined,
    report_key: "report_open_balances",
    count: rows.length,
    columns: [
      { key: "boater", label: "Boater" },
      { key: "slip", label: "Slip" },
      { key: "balance", label: "Open balance", format: "currency", align: "right" },
      { key: "days_overdue", label: "Days overdue", format: "days", align: "right" },
      { key: "oldest_invoice", label: "Oldest invoice", format: "date" },
    ],
    rows,
    row_paths: rowPaths,
    total_row: {
      boater: "Total",
      slip: "",
      balance: totalOpen,
      days_overdue: null,
      oldest_invoice: null,
    },
  };
}

/**
 * Renewals by month — projected renewal pipeline for the next N months.
 * Counts contracts whose effective_end falls in each month + sums their
 * annual_rate as an ARR-at-risk signal.
 */
export function reportRenewalsByMonth(options: { months_ahead?: number } = {}): TableResult {
  const monthsAhead = Math.max(1, Math.min(24, options.months_ahead ?? 12));
  const today = new Date();
  const buckets: { month: string; label: string; count: number; arr: number }[] = [];
  for (let i = 0; i < monthsAhead; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
    buckets.push({ month: ym, label, count: 0, arr: 0 });
  }

  for (const c of CONTRACTS) {
    if (c.status === "terminated") continue;
    const expiresYm = (c.effective_end ?? "").slice(0, 7);
    const bucket = buckets.find((b) => b.month === expiresYm);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.arr += c.annual_rate ?? 0;
  }

  const totalContracts = buckets.reduce((s, b) => s + b.count, 0);
  const totalArr = buckets.reduce((s, b) => s + b.arr, 0);

  return {
    kind: "table",
    title: "Renewals by month",
    subtitle: `${monthsAhead}-month horizon · ${totalContracts} contracts · $${totalArr.toLocaleString()} ARR at risk`,
    report_key: "report_renewals_by_month",
    count: buckets.length,
    columns: [
      { key: "label", label: "Month" },
      { key: "count", label: "Contracts expiring", format: "number", align: "right" },
      { key: "arr", label: "ARR at risk", format: "currency", align: "right" },
    ],
    rows: buckets.map((b) => ({
      label: b.label,
      count: b.count,
      arr: b.arr,
    })),
    total_row: { label: "Total", count: totalContracts, arr: totalArr },
  };
}

/**
 * Occupancy by dock — wide view of how full each dock is plus how many
 * slips are lapsed (need attention). Sorted by occupancy_pct descending
 * so the busiest docks float to the top.
 *
 * "Lapsed" is computed from the live contract on each slip — a slip is
 * lapsed iff its current contract's effective_end is on or before today.
 * SpaceStatus itself ("vacant" / "occupied" / "reserved" / "out_of_service")
 * doesn't track this; the roster view does the same derivation.
 */
export function reportOccupancyByDock(): TableResult {
  // Canonical slip-status derivation — same helper the waitlist sheet
  // and reportLapsedAccounts call into. Single source of truth for
  // "is this slip taken / has its contract lapsed."
  const { lapsedSlipIds } = deriveSlipStatus(CONTRACTS);

  const enriched = RENTAL_GROUPS.map((g) => {
    const spaces = RENTAL_SPACES.filter((s) => s.group_id === g.id);
    const occupied = spaces.filter((s) => s.status === "occupied").length;
    const vacant = spaces.filter((s) => s.status === "vacant").length;
    const lapsed = spaces.filter((s) => lapsedSlipIds.has(s.id)).length;
    const total = spaces.length;
    const pct = total === 0 ? 0 : Math.round((occupied / total) * 100);
    return {
      group_id: g.id,
      row: {
        dock: g.name,
        total,
        occupied,
        vacant,
        lapsed,
        occupancy_pct: pct,
      },
    };
  }).sort((a, b) => (b.row.occupancy_pct as number) - (a.row.occupancy_pct as number));
  const rows = enriched.map((e) => e.row);
  const rowPaths = enriched.map((e) => `/services/roster?dock=${encodeURIComponent(e.group_id)}`);

  const totals = rows.reduce(
    (acc, r) => ({
      total: acc.total + (r.total as number),
      occupied: acc.occupied + (r.occupied as number),
      vacant: acc.vacant + (r.vacant as number),
      lapsed: acc.lapsed + (r.lapsed as number),
    }),
    { total: 0, occupied: 0, vacant: 0, lapsed: 0 },
  );
  const overallPct = totals.total === 0 ? 0 : Math.round((totals.occupied / totals.total) * 100);

  return {
    kind: "table",
    title: "Occupancy by dock",
    subtitle: `${totals.occupied} / ${totals.total} occupied (${overallPct}%)`,
    report_key: "report_occupancy_by_dock",
    count: rows.length,
    columns: [
      { key: "dock", label: "Dock" },
      { key: "total", label: "Slips", format: "number", align: "right" },
      { key: "occupied", label: "Occupied", format: "number", align: "right" },
      { key: "vacant", label: "Vacant", format: "number", align: "right" },
      { key: "lapsed", label: "Lapsed", format: "number", align: "right" },
      { key: "occupancy_pct", label: "Occupied %", format: "percent", align: "right" },
    ],
    rows,
    row_paths: rowPaths,
    total_row: {
      dock: "Total",
      total: totals.total,
      occupied: totals.occupied,
      vacant: totals.vacant,
      lapsed: totals.lapsed,
      occupancy_pct: overallPct,
    },
  };
}

/**
 * Contracts expiring — per-contract drill-down for renewals work.
 * Defaults to a 60-day window. Sorted soonest first.
 */
export function reportContractsExpiring(
  scopedBoaters: Boater[],
  options: { within_days?: number } = {},
): TableResult {
  const days = Math.max(1, Math.min(365, options.within_days ?? 60));
  const today = localIsoDate();
  const cutoff = localIsoDate(new Date(Date.now() + days * 86_400_000));
  const boaterIds = new Set(scopedBoaters.map((b) => b.id));
  const matches = CONTRACTS.filter(
    (c) =>
      c.status !== "terminated" &&
      c.status !== "expired" &&
      boaterIds.has(c.boater_id) &&
      !!c.effective_end &&
      c.effective_end > today &&
      c.effective_end <= cutoff,
  ).sort((a: Contract, b: Contract) => (a.effective_end < b.effective_end ? -1 : 1));

  // Single-pass lookup maps — avoids the O(matches × boaters) +
  // O(matches × slips) cost of per-row .find() inside the map.
  const boaterById = new Map(scopedBoaters.map((b) => [b.id, b]));
  const slipById = new Map(SLIPS.map((s) => [s.id, s]));
  const enriched = matches.map((c) => {
    const boater = boaterById.get(c.boater_id);
    const slip = c.slip_id ? slipById.get(c.slip_id) : undefined;
    const daysOut = Math.max(0, daysBetween(today, c.effective_end));
    return {
      contract_id: c.id,
      row: {
        boater: boater?.display_name ?? c.boater_id,
        slip: slip?.number ?? c.slip_id ?? "—",
        contract: c.number,
        expiry: c.effective_end,
        days_out: daysOut,
        annual_rate: c.annual_rate ?? 0,
      },
    };
  });
  const rows = enriched.map((e) => e.row);
  const rowPaths = enriched.map((e) => `/services/contracts/${e.contract_id}`);

  const totalArr = rows.reduce((s, r) => s + (r.annual_rate as number), 0);

  return {
    kind: "table",
    title: "Contracts expiring",
    subtitle: `Within ${days} days · $${totalArr.toLocaleString()} ARR`,
    report_key: "report_contracts_expiring",
    count: rows.length,
    columns: [
      { key: "boater", label: "Boater" },
      { key: "slip", label: "Slip" },
      { key: "contract", label: "Contract" },
      { key: "expiry", label: "Expires", format: "date" },
      { key: "days_out", label: "Days out", format: "days", align: "right" },
      { key: "annual_rate", label: "Annual rate", format: "currency", align: "right" },
    ],
    rows,
    row_paths: rowPaths,
    total_row: {
      boater: "Total",
      slip: "",
      contract: "",
      expiry: null,
      days_out: null,
      annual_rate: totalArr,
    },
  };
}

/**
 * Lapsed accounts — boaters whose slip is flagged lapsed AND who carry
 * an open balance. The crossover cohort is the renewal-collection
 * priority list.
 */
export function reportLapsedAccounts(
  ledger: LedgerEntry[],
  scopedBoaters: Boater[],
): TableResult {
  const today = localIsoDate();
  const ninetyDaysOutIso = localIsoDate(new Date(Date.now() + EXPIRING_SOON_WINDOW_MS));

  // Build lookup maps once instead of calling .find()/.filter() inside
  // the per-slip loop. Without these, the report is O(lapsed × boaters)
  // + O(lapsed × ledger) — fine at seed scale but quadratic past 500
  // entries either side.
  const boaterById = new Map(scopedBoaters.map((b) => [b.id, b]));
  const slipById = new Map(SLIPS.map((s) => [s.id, s]));
  const invoicesByBoater = new Map<string, LedgerEntry[]>();
  const paymentsByBoater = new Map<string, LedgerEntry[]>();
  for (const l of ledger) {
    const bucket = l.type === "invoice"
      ? invoicesByBoater
      : l.type === "payment"
        ? paymentsByBoater
        : null;
    if (!bucket) continue;
    const arr = bucket.get(l.boater_id);
    if (arr) arr.push(l);
    else bucket.set(l.boater_id, [l]);
  }

  // Canonical slip-status derivation — same helper the waitlist sheet
  // and reportOccupancyByDock use. lapsedSlipIds is the set of slips
  // whose live contract has run past effective_end.
  const { lapsedSlipIds, slipToBoater } = deriveSlipStatus(CONTRACTS, {
    today,
    ninetyDaysOut: ninetyDaysOutIso,
  });

  type LapsedEntry = { boater_id: string; row: Record<string, CellValue> };
  const entries: LapsedEntry[] = [];
  for (const spaceId of lapsedSlipIds) {
    const boaterId = slipToBoater.get(spaceId);
    if (!boaterId) continue;
    const boater = boaterById.get(boaterId);
    if (!boater) continue;
    const openInvoices =
      (invoicesByBoater.get(boaterId) ?? []).filter((l) => l.open_balance > 0);
    const balance = openInvoices.reduce((s, l) => s + l.open_balance, 0);
    if (balance <= 0) continue;
    const lastPayment = (paymentsByBoater.get(boaterId) ?? [])
      .map((l) => l.date)
      .sort()
      .at(-1);
    const daysSincePayment = lastPayment ? daysBetween(lastPayment, today) : null;
    const slip = slipById.get(spaceId);
    entries.push({
      boater_id: boaterId,
      row: {
        boater: boater.display_name,
        slip: slip?.number ?? spaceId,
        balance,
        last_payment: lastPayment ?? null,
        days_since_payment: daysSincePayment,
      },
    });
  }
  entries.sort((a, b) => (b.row.balance as number) - (a.row.balance as number));
  const rows = entries.map((e) => e.row);
  const rowPaths = entries.map((e) => `/members/${e.boater_id}`);

  const totalBalance = rows.reduce((s, r) => s + (r.balance as number), 0);

  return {
    kind: "table",
    title: "Lapsed accounts",
    subtitle: `${rows.length} lapsed slips with open balance · $${totalBalance.toLocaleString()} at risk`,
    report_key: "report_lapsed_accounts",
    count: rows.length,
    columns: [
      { key: "boater", label: "Boater" },
      { key: "slip", label: "Slip" },
      { key: "balance", label: "Open balance", format: "currency", align: "right" },
      { key: "last_payment", label: "Last payment", format: "date" },
      { key: "days_since_payment", label: "Days since", format: "days", align: "right" },
    ],
    rows,
    row_paths: rowPaths,
    total_row: {
      boater: "Total",
      slip: "",
      balance: totalBalance,
      last_payment: null,
      days_since_payment: null,
    },
  };
}

/*
 * ────────────────────────────────────────────────────────────
 * Wave 2 — additional operator reports
 * ────────────────────────────────────────────────────────────
 */

/**
 * Revenue by category — windowed split across GL accounts. Uses the
 * LedgerEntry.gl_account field where present; falls back to coarse
 * inference from invoice line items.
 */
export function reportRevenueByCategory(
  ledger: LedgerEntry[],
  options: { window?: "this_month" | "last_month" | "this_quarter" | "ytd" } = {},
): TableResult {
  const window = options.window ?? "this_month";
  const { fromIso, toIso, label } = resolveWindow(window);

  const inRange = ledger.filter((l) => l.date >= fromIso && l.date <= toIso);

  type Bucket = { category: string; invoiced: number; paid: number; outstanding: number };
  const buckets: Record<string, Bucket> = {};

  for (const l of inRange) {
    if (l.type !== "invoice") continue;
    const cat = normalizeCategory(l.gl_account ?? inferCategoryFromLines(l));
    const b = buckets[cat] ?? { category: cat, invoiced: 0, paid: 0, outstanding: 0 };
    b.invoiced += l.amount;
    b.paid += l.amount - l.open_balance;
    b.outstanding += l.open_balance;
    buckets[cat] = b;
  }

  const rows = Object.values(buckets).sort((a, b) => b.invoiced - a.invoiced);
  const totalInvoiced = rows.reduce((s, r) => s + r.invoiced, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);
  const totalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);

  return {
    kind: "table",
    title: "Revenue by category",
    subtitle: `${label} · $${Math.round(totalInvoiced).toLocaleString()} invoiced`,
    report_key: "report_revenue_by_category",
    count: rows.length,
    columns: [
      { key: "category", label: "Category" },
      { key: "invoiced", label: "Invoiced", format: "currency", align: "right" },
      { key: "paid", label: "Paid", format: "currency", align: "right" },
      { key: "outstanding", label: "Outstanding", format: "currency", align: "right" },
    ],
    rows,
    total_row: {
      category: "Total",
      invoiced: totalInvoiced,
      paid: totalPaid,
      outstanding: totalOutstanding,
    },
  };
}

/**
 * Top-revenue boaters in a window — pareto view of who pays the most.
 * Useful for "who are our biggest customers", retention targeting, and
 * comping decisions.
 */
export function reportTopRevenueBoaters(
  ledger: LedgerEntry[],
  scopedBoaters: Boater[],
  options: { window?: "this_month" | "last_month" | "this_quarter" | "ytd"; limit?: number } = {},
): TableResult {
  const window = options.window ?? "ytd";
  const { fromIso, toIso, label } = resolveWindow(window);
  const limit = Math.max(1, Math.min(100, options.limit ?? 20));

  // Pre-bucket in-range invoices by boater_id once. Without this, we'd
  // walk the full window ledger for each boater (O(boaters × ledger)).
  const invoicesByBoater = new Map<string, LedgerEntry[]>();
  for (const l of ledger) {
    if (l.type !== "invoice") continue;
    if (l.date < fromIso || l.date > toIso) continue;
    const arr = invoicesByBoater.get(l.boater_id);
    if (arr) arr.push(l);
    else invoicesByBoater.set(l.boater_id, [l]);
  }

  const enriched = scopedBoaters
    .map((b) => {
      const invoices = invoicesByBoater.get(b.id) ?? [];
      const invoiced = invoices.reduce((s, l) => s + l.amount, 0);
      const paid = invoices.reduce((s, l) => s + (l.amount - l.open_balance), 0);
      const outstanding = invoices.reduce((s, l) => s + l.open_balance, 0);
      return {
        boater_id: b.id,
        row: {
          boater: b.display_name,
          slip: b.code ?? "—",
          invoices: invoices.length,
          invoiced,
          paid,
          outstanding,
        },
      };
    })
    .filter((e) => (e.row.invoiced as number) > 0)
    .sort((a, b) => (b.row.invoiced as number) - (a.row.invoiced as number))
    .slice(0, limit);
  const rows = enriched.map((e) => e.row);
  const rowPaths = enriched.map((e) => `/members/${e.boater_id}`);

  const totals = rows.reduce(
    (acc, r) => ({
      invoiced: acc.invoiced + (r.invoiced as number),
      paid: acc.paid + (r.paid as number),
      outstanding: acc.outstanding + (r.outstanding as number),
      invoices: acc.invoices + (r.invoices as number),
    }),
    { invoiced: 0, paid: 0, outstanding: 0, invoices: 0 },
  );

  return {
    kind: "table",
    title: "Top revenue boaters",
    subtitle: `${label} · top ${rows.length}`,
    report_key: "report_top_revenue_boaters",
    count: rows.length,
    columns: [
      { key: "boater", label: "Boater" },
      { key: "slip", label: "Slip" },
      { key: "invoices", label: "Invoices", format: "number", align: "right" },
      { key: "invoiced", label: "Invoiced", format: "currency", align: "right" },
      { key: "paid", label: "Paid", format: "currency", align: "right" },
      { key: "outstanding", label: "Outstanding", format: "currency", align: "right" },
    ],
    rows,
    row_paths: rowPaths,
    total_row: {
      boater: "Total",
      slip: "",
      invoices: totals.invoices,
      invoiced: totals.invoiced,
      paid: totals.paid,
      outstanding: totals.outstanding,
    },
  };
}

/**
 * Work order aging — open WOs bucketed by how long they've been open.
 * Anything 90+ days old is a real ops problem; this surfaces it.
 */
export function reportWorkOrderAging(): TableResult {
  const today = localIsoDate();
  const buckets = [
    { label: "0-7 days", min: 0, max: 7, count: 0, urgent: 0, high: 0, normal: 0, low: 0 },
    { label: "8-30 days", min: 8, max: 30, count: 0, urgent: 0, high: 0, normal: 0, low: 0 },
    { label: "31-90 days", min: 31, max: 90, count: 0, urgent: 0, high: 0, normal: 0, low: 0 },
    { label: "90+ days", min: 91, max: Infinity, count: 0, urgent: 0, high: 0, normal: 0, low: 0 },
  ];

  const openStatuses = new Set(["open", "scheduled", "in_progress", "blocked"]);
  for (const wo of WORK_ORDERS) {
    if (!openStatuses.has(wo.status)) continue;
    const openedIso = wo.start_date ?? wo.due_date;
    if (!openedIso) continue;
    const age = Math.max(0, daysBetween(openedIso, today));
    const bucket = buckets.find((b) => age >= b.min && age <= b.max);
    if (!bucket) continue;
    bucket.count += 1;
    bucket[wo.priority as "urgent" | "high" | "normal" | "low"] += 1;
  }

  const totalOpen = buckets.reduce((s, b) => s + b.count, 0);
  const rows = buckets.map((b) => ({
    bucket: b.label,
    count: b.count,
    urgent: b.urgent,
    high: b.high,
    normal: b.normal,
    low: b.low,
  }));

  return {
    kind: "table",
    title: "Open work orders by age",
    subtitle: `${totalOpen} open across all buckets`,
    report_key: "report_work_order_aging",
    count: rows.length,
    columns: [
      { key: "bucket", label: "Age" },
      { key: "count", label: "Open", format: "number", align: "right" },
      { key: "urgent", label: "Urgent", format: "number", align: "right" },
      { key: "high", label: "High", format: "number", align: "right" },
      { key: "normal", label: "Normal", format: "number", align: "right" },
      { key: "low", label: "Low", format: "number", align: "right" },
    ],
    rows,
    total_row: {
      bucket: "Total",
      count: totalOpen,
      urgent: rows.reduce((s, r) => s + (r.urgent as number), 0),
      high: rows.reduce((s, r) => s + (r.high as number), 0),
      normal: rows.reduce((s, r) => s + (r.normal as number), 0),
      low: rows.reduce((s, r) => s + (r.low as number), 0),
    },
  };
}

/**
 * Meter consumption top — biggest electric users by recent kWh delta.
 * Sorted descending. Helps spot leaks / phantom loads / heaters left on.
 */
export function reportMeterConsumptionTop(
  scopedBoaters: Boater[],
  options: { limit?: number } = {},
): TableResult {
  const limit = Math.max(1, Math.min(50, options.limit ?? 15));
  // Build slip → boater via active contracts (matches the dock view).
  const slipToBoater = new Map<string, string>();
  for (const c of CONTRACTS) {
    if (!c.slip_id) continue;
    if (c.status === "terminated") continue;
    slipToBoater.set(c.slip_id, c.boater_id);
  }
  // Lookup maps for the per-reading loop — beats RENTAL_SPACES.find +
  // scopedBoaters.find per reading (O(readings × spaces) + O(readings ×
  // boaters)) which becomes meaningful at real meter scale (~thousands
  // of readings per marina/year).
  const spaceById = new Map(RENTAL_SPACES.map((s) => [s.id, s]));
  const boaterById = new Map(scopedBoaters.map((b) => [b.id, b]));

  type MeterEntry = { boater_id: string; row: Record<string, CellValue> };
  const entries: MeterEntry[] = [];
  for (const m of METER_READINGS) {
    const delta = meterDelta(m);
    if (!Number.isFinite(delta) || delta <= 0) continue;
    const space = spaceById.get(m.space_id);
    if (!space) continue;
    const boaterId = slipToBoater.get(m.space_id);
    const boater = boaterId ? boaterById.get(boaterId) : undefined;
    if (!boater) continue;
    entries.push({
      boater_id: boater.id,
      row: {
        boater: boater.display_name,
        slip: space.number,
        kwh: delta,
        unit: m.unit ?? null,
        current: m.current_reading,
      },
    });
  }
  entries.sort((a, b) => (b.row.kwh as number) - (a.row.kwh as number));
  const top = entries.slice(0, limit);
  const rows = top.map((e) => e.row);
  const rowPaths = top.map((e) => `/members/${e.boater_id}`);
  const totalKwh = rows.reduce((s, r) => s + (r.kwh as number), 0);

  return {
    kind: "table",
    title: "Top electric consumers",
    subtitle: `Top ${top.length} · ${totalKwh.toLocaleString()} kWh combined`,
    report_key: "report_meter_consumption_top",
    count: top.length,
    columns: [
      { key: "boater", label: "Boater" },
      { key: "slip", label: "Slip" },
      { key: "kwh", label: "kWh used", format: "number", align: "right" },
      { key: "current", label: "Current reading", format: "number", align: "right" },
    ],
    rows,
    row_paths: rowPaths,
    total_row: { boater: "Total", slip: "", kwh: totalKwh, current: null },
  };
}

/**
 * Arrivals window — count of reservations arriving each day in a window.
 * Use for staffing forecasts and arrival-day kickoff messaging.
 */
export function reportArrivalsWindow(
  options: { days_ahead?: number } = {},
): TableResult {
  const days = Math.max(1, Math.min(30, options.days_ahead ?? 7));
  const today = new Date();
  const rows: Record<string, CellValue>[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const iso = localIsoDate(d);
    const arriving = RESERVATIONS.filter((r) => r.arrival_date === iso);
    rows.push({
      date: iso,
      day_of_week: d.toLocaleDateString(undefined, { weekday: "short" }),
      arrivals: arriving.length,
      nights_avg:
        arriving.length === 0
          ? 0
          : Math.round(
              arriving.reduce(
                (s, r) => s + daysBetween(r.arrival_date, r.departure_date),
                0,
              ) / arriving.length,
            ),
    });
  }
  const totalArrivals = rows.reduce((s, r) => s + (r.arrivals as number), 0);
  return {
    kind: "table",
    title: "Arrivals forecast",
    subtitle: `${days}-day window · ${totalArrivals} arrivals`,
    report_key: "report_arrivals_window",
    count: rows.length,
    columns: [
      { key: "date", label: "Date", format: "date" },
      { key: "day_of_week", label: "Day" },
      { key: "arrivals", label: "Arrivals", format: "number", align: "right" },
      { key: "nights_avg", label: "Avg nights", format: "number", align: "right" },
    ],
    rows,
    total_row: { date: null, day_of_week: "Total", arrivals: totalArrivals, nights_avg: null },
  };
}

/*
 * ────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────
 */

// daysBetween moved to lib/utils.ts (also used in waitlist sheet, agent-brief).

/*
 * ────────────────────────────────────────────────────────────
 * Shared cell formatters
 * ────────────────────────────────────────────────────────────
 *
 * Used by both the operator TableCard (components/agent/agent-chat.tsx)
 * and the holder HolderTableCard (components/portal/holder-agent-chat.tsx).
 * Lives next to the TableResult type they format.
 */

/**
 * Format a single cell value per its column format. Returns "—" for
 * null/undefined/empty so missing data renders consistently. Currency
 * defers to the Intl currency formatter so negatives render with the
 * standard sign placement.
 */
export function formatTableCell(
  value: unknown,
  format: TableColumn["format"],
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (format === "currency") {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return n.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    });
  }
  if (format === "percent") {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return `${n}%`;
  }
  if (format === "days") {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return `${n}d`;
  }
  if (format === "number") return Number(value).toLocaleString();
  return String(value);
}

/**
 * Pick alignment for a column. Explicit `align` wins; otherwise numeric
 * formats default to "right" and text formats default to "left".
 */
export function tableColumnAlign(
  format: TableColumn["format"],
  explicit?: ColumnAlign,
): ColumnAlign {
  if (explicit) return explicit;
  if (
    format === "currency" ||
    format === "percent" ||
    format === "number" ||
    format === "days"
  )
    return "right";
  return "left";
}

/**
 * Map a window keyword to an ISO date range + human label. Mirrors the
 * dropdown in /reports so the agent output matches the manual report.
 */
function resolveWindow(
  window: "this_month" | "last_month" | "this_quarter" | "ytd",
): { fromIso: string; toIso: string; label: string } {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  if (window === "this_month") {
    return {
      fromIso: localIsoDate(new Date(y, m, 1)),
      toIso: localIsoDate(new Date(y, m + 1, 0)),
      label: "This month",
    };
  }
  if (window === "last_month") {
    return {
      fromIso: localIsoDate(new Date(y, m - 1, 1)),
      toIso: localIsoDate(new Date(y, m, 0)),
      label: "Last month",
    };
  }
  if (window === "this_quarter") {
    const qStart = Math.floor(m / 3) * 3;
    return {
      fromIso: localIsoDate(new Date(y, qStart, 1)),
      toIso: localIsoDate(new Date(y, qStart + 3, 0)),
      label: "This quarter",
    };
  }
  return {
    fromIso: `${y}-01-01`,
    toIso: localIsoDate(today),
    label: "YTD",
  };
}

/**
 * GL accounts the seed data uses verbatim. Map them onto operator-facing
 * category buckets so the report stays readable as new GL strings appear.
 */
function normalizeCategory(raw: string | undefined): string {
  if (!raw) return "Other";
  const r = raw.toLowerCase();
  if (r.includes("slip") || r.includes("rent")) return "Slip rent";
  if (r.includes("fuel") || r.includes("gas")) return "Fuel";
  if (r.includes("restaurant") || r.includes("food")) return "Restaurant";
  if (r.includes("retail") || r.includes("store")) return "Ship store";
  if (r.includes("service") || r.includes("labor")) return "Services";
  if (r.includes("club") || r.includes("rental")) return "Rental club";
  return "Other";
}

/**
 * Fallback when LedgerEntry.gl_account is empty — coarse keyword sniff
 * on line items. Conservative bucketing: anything we can't classify
 * goes to "Other" rather than getting misattributed.
 */
function inferCategoryFromLines(l: LedgerEntry): string {
  const text = (l.line_items ?? [])
    .map((li) => li.description.toLowerCase())
    .join(" ");
  if (/slip|annual|monthly|seasonal/.test(text)) return "Slip Fee Revenue";
  if (/fuel|gas|diesel/.test(text)) return "Fuel Sales";
  if (/restaurant|food/.test(text)) return "Restaurant";
  if (/store|retail|chandl/.test(text)) return "Retail Sales";
  if (/service|labor|haul|paint|winter|hoist|pump/.test(text)) return "Services";
  if (/rental|club/.test(text)) return "Rental Club";
  return "Other";
}

/*
 * ────────────────────────────────────────────────────────────
 * Holder-mode reports
 * ────────────────────────────────────────────────────────────
 *
 * Boater-portal-facing reports. The holder agent scopes everything
 * to the signed-in boater via boater_id — these helpers take a boater
 * directly rather than `scopedBoaters` because the holder context is
 * always a single member.
 */

/**
 * My open invoices — boater-facing A/R glance. Shows invoice # + date
 * + amount + open balance for each unpaid invoice.
 */
export function reportMyBalance(
  ledger: LedgerEntry[],
  boater: Boater,
): TableResult {
  const open = ledger
    .filter((l) => l.boater_id === boater.id && l.type === "invoice" && l.open_balance > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const rows = open.map((l) => ({
    invoice: l.number ?? l.id,
    date: l.date,
    description: (l.line_items?.[0]?.description ?? "—").slice(0, 60),
    amount: l.amount,
    open: l.open_balance,
  }));
  const totalOpen = rows.reduce((s, r) => s + (r.open as number), 0);
  return {
    kind: "table",
    title: "Your open invoices",
    subtitle:
      totalOpen === 0 ? "You're all paid up." : `${rows.length} unpaid · $${totalOpen.toFixed(2)} due`,
    report_key: "report_my_balance",
    count: rows.length,
    columns: [
      { key: "invoice", label: "Invoice" },
      { key: "date", label: "Date", format: "date" },
      { key: "description", label: "Description" },
      { key: "amount", label: "Amount", format: "currency", align: "right" },
      { key: "open", label: "Open", format: "currency", align: "right" },
    ],
    rows,
    total_row:
      rows.length > 0
        ? {
            invoice: "Total",
            date: null,
            description: "",
            amount: rows.reduce((s, r) => s + (r.amount as number), 0),
            open: totalOpen,
          }
        : undefined,
  };
}

/**
 * My recent activity — boater-facing ledger history.
 */
export function reportMyHistory(
  ledger: LedgerEntry[],
  boater: Boater,
  options: { limit?: number } = {},
): TableResult {
  const limit = Math.max(1, Math.min(50, options.limit ?? 20));
  const rows = ledger
    .filter((l) => l.boater_id === boater.id)
    .sort((a, b) => (a.date > b.date ? -1 : 1))
    .slice(0, limit)
    .map((l) => ({
      date: l.date,
      type: l.type,
      reference: l.number ?? l.id,
      description: (l.line_items?.[0]?.description ?? l.method ?? "—").slice(0, 60),
      amount: l.amount,
    }));
  return {
    kind: "table",
    title: "Your recent activity",
    subtitle: `Last ${rows.length} entries`,
    report_key: "report_my_history",
    count: rows.length,
    columns: [
      { key: "date", label: "Date", format: "date" },
      { key: "type", label: "Type" },
      { key: "reference", label: "Reference" },
      { key: "description", label: "Description" },
      { key: "amount", label: "Amount", format: "currency", align: "right" },
    ],
    rows,
  };
}

/**
 * My vessels on file.
 */
export function reportMyVessels(
  vessels: Array<{
    id: string;
    name: string;
    year?: number;
    make?: string;
    model?: string;
    length_inches?: number;
  }>,
): TableResult {
  const rows = vessels.map((v) => ({
    vessel: v.name,
    year: v.year ?? null,
    make: v.make ?? "—",
    model: v.model ?? "—",
    length_ft:
      typeof v.length_inches === "number" ? Math.round(v.length_inches / 12) : null,
  }));
  return {
    kind: "table",
    title: "Your vessels",
    subtitle: `${rows.length} on file`,
    report_key: "report_my_vessels",
    count: rows.length,
    columns: [
      { key: "vessel", label: "Vessel" },
      { key: "year", label: "Year", format: "number", align: "right" },
      { key: "make", label: "Make" },
      { key: "model", label: "Model" },
      { key: "length_ft", label: "Length (ft)", format: "number", align: "right" },
    ],
    rows,
  };
}

/**
 * Type guard for the chat host — a `tool_step` result is a TableResult
 * iff it has the discriminator. Saves duck-typing in the renderer.
 */
export function isTableResult(value: unknown): value is TableResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { kind?: unknown }).kind === "table" &&
    Array.isArray((value as { rows?: unknown }).rows)
  );
}
