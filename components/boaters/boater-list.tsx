"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { type ServiceLabel } from "./boater-row";
import { MemberSetupWizard } from "./member-setup-wizard";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilterSelect } from "@/components/ui/list-filter-select";
import { cn } from "@/lib/utils";
import { formatMoney, getCurrentReservation, getOpenBalance, getSlip, initialsOf } from "@/lib/mock-data";
import {
  useBoaters,
  useClubSubscriptions,
  useContracts,
  useLedger,
  useReservations,
  useVessels,
} from "@/lib/client-store";
import {
  EXPIRING_SOON_WINDOW_MS,
  LIVE_CONTRACT_PRIORITY,
  TERMINAL_CONTRACT_STATUSES,
  localIsoDate,
} from "@/lib/contracts";
import type { ClubSubscription } from "@/lib/types";

// Shared grid template — header + row stay in lockstep so columns never
// drift apart on resize. Six columns: Member · Slip · Cadence · Vessel ·
// Balance · Status (badge LAST per the Services pattern).
const BOATER_COLS =
  "minmax(0, 1.6fr) minmax(0, 0.7fr) minmax(0, 0.8fr) minmax(0, 1.2fr) minmax(0, 0.8fr) minmax(0, 0.9fr)";

export function BoaterList() {
  const boaters = useBoaters();
  // Tenant-scoped hooks (useReservations / useContracts / useLedger)
  // instead of useStore() destructure — preserves multi-tenant isolation
  // so a boater list can never accidentally surface another marina's
  // rows when seed data grows past a single tenant.
  const reservations = useReservations();
  const contracts = useContracts();
  const ledger = useLedger();
  const vessels = useVessels();
  const [query, setQuery] = React.useState("");
  // Single CTA opens the canonical 5-step slip-holder wizard. The old
  // "Full setup" / "New member" split collapsed into one path — both
  // launchers previously landed on this boater-list page and split the
  // operator's attention between a quick sheet and the full wizard.
  const [wizardOpen, setWizardOpen] = React.useState(false);

  // Live club roster — drives the "Rental Club" quick filter AND the
  // Service column derivation. Indexed by boater_id for O(1) lookup
  // inside the per-row computation below.
  const subscriptions = useClubSubscriptions();
  const clubSubByBoaterId = React.useMemo(() => {
    const m = new Map<string, ClubSubscription>();
    for (const s of subscriptions) {
      if (s.status === "active" || s.status === "past_due") {
        m.set(s.boater_id, s);
      }
    }
    return m;
  }, [subscriptions]);
  // Compute rows live from the store so runtime-created boaters appear immediately.
  // Lookups are pre-grouped by boater_id so the per-row computation is O(1)
  // instead of N×(reservations + contracts + ledger + vessels) — previously
  // every render did 4 linear scans per boater.
  const liveReservationByBoaterId = React.useMemo(() => {
    // First "occupied", then "scheduled" — keep the original preference.
    const occ = new Map<string, (typeof reservations)[number]>();
    const sched = new Map<string, (typeof reservations)[number]>();
    for (const r of reservations) {
      if (r.status === "occupied" && !occ.has(r.boater_id)) occ.set(r.boater_id, r);
      else if (r.status === "scheduled" && !sched.has(r.boater_id))
        sched.set(r.boater_id, r);
    }
    return { occ, sched };
  }, [reservations]);
  // Live (in-force) contracts — pick the highest-priority status per
  // boater (active > executed > partially_signed > sent > draft). Old
  // first-wins behavior could surface a stale draft over a real
  // active contract; this fixes that.
  const liveContractByBoaterId = React.useMemo(() => {
    const m = new Map<string, (typeof contracts)[number]>();
    for (const c of contracts) {
      if (!c.slip_id) continue;
      const priority = LIVE_CONTRACT_PRIORITY[c.status] ?? 0;
      if (priority === 0) continue;
      const existing = m.get(c.boater_id);
      if (
        !existing ||
        priority > (LIVE_CONTRACT_PRIORITY[existing.status] ?? 0)
      ) {
        m.set(c.boater_id, c);
      }
    }
    return m;
  }, [contracts]);
  // Most-recently-ended terminal contract per boater — drives the
  // 'Lapsed' filter for boaters whose last contract is expired /
  // terminated and who don't have a current live contract. Without
  // this, rowStatus could never produce 'lapsed' for any boater
  // whose contract was already marked terminal by the back-office.
  const lapsedContractByBoaterId = React.useMemo(() => {
    const m = new Map<string, (typeof contracts)[number]>();
    for (const c of contracts) {
      if (!c.slip_id) continue;
      if (!TERMINAL_CONTRACT_STATUSES.has(c.status)) continue;
      const existing = m.get(c.boater_id);
      if (
        !existing ||
        (c.effective_end ?? "") > (existing.effective_end ?? "")
      ) {
        m.set(c.boater_id, c);
      }
    }
    return m;
  }, [contracts]);
  const openBalanceByBoaterId = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const l of ledger) {
      if (l.type !== "invoice") continue;
      m.set(l.boater_id, (m.get(l.boater_id) ?? 0) + l.open_balance);
    }
    return m;
  }, [ledger]);
  const primaryVesselByBoaterId = React.useMemo(() => {
    const m = new Map<string, (typeof vessels)[number]>();
    for (const v of vessels) {
      const existing = m.get(v.boater_id);
      // Prefer active vessels; otherwise first match wins.
      if (!existing || (existing.active === false && v.active !== false)) {
        m.set(v.boater_id, v);
      }
    }
    return m;
  }, [vessels]);
  // Date strings (YYYY-MM-DD) for the rowStatus classifier — computed
  // each render so day-rollover is automatic. String comparison is
  // timezone-stable, unlike Date.now() vs new Date('YYYY-MM-DD')
  // which mismatches at midnight in non-UTC timezones.
  const todayIso = localIsoDate();
  const ninetyDaysOutIso = localIsoDate(
    new Date(Date.now() + EXPIRING_SOON_WINDOW_MS),
  );
  const rows = React.useMemo(() => {
    // Show every boater — slip-holders AND dual slip+club members.
    // Cross-sell is a real path (a slip holder may also subscribe to
    // the rental club), and hiding them here breaks the boater
    // profile's "see everything in one place" rule. The row itself
    // surfaces a "Club" chip when applicable so the operator knows
    // they're looking at someone with both memberships.
    return boaters.map((boater) => {
      // Occupied reservation wins. Scheduled reservation is only
      // accepted if it's actually current (arrival <= today <=
      // departure) — otherwise a far-future "scheduled" row would
      // mislead the operator about the boater's current state.
      const occRes = liveReservationByBoaterId.occ.get(boater.id);
      const schedRes = liveReservationByBoaterId.sched.get(boater.id);
      const schedIsCurrent =
        schedRes != null &&
        schedRes.arrival_date <= todayIso &&
        schedRes.departure_date >= todayIso;
      const liveRes = occRes ?? (schedIsCurrent ? schedRes : undefined);
      const currentReservation = liveRes ?? getCurrentReservation(boater.id);

      const liveContract = liveContractByBoaterId.get(boater.id);
      const slipIdForService = currentReservation?.slip_id ?? liveContract?.slip_id;

      // Use .has() to distinguish "no live ledger rows" from "rows
      // that sum to $0" — without it, a boater who paid off every
      // invoice would silently fall back to the stale seed balance.
      const openBalance = openBalanceByBoaterId.has(boater.id)
        ? openBalanceByBoaterId.get(boater.id)!
        : getOpenBalance(boater.id);
      const sub = clubSubByBoaterId.get(boater.id);
      const service = deriveService(slipIdForService, sub);
      const primaryVessel = primaryVesselByBoaterId.get(boater.id);

      // Status classifier — matches the badge logic in SlipHolderRow
      // so the filter chips, dropdown counts, and visible badge tone
      // always agree. Priorities (top wins):
      //   1. past_due   — has open balance
      //   2. lapsed     — live contract end has passed, OR no live
      //                   contract and a terminal contract exists
      //   3. expiring   — live contract end within 90 days, OR
      //                   transient with occupied reservation ending
      //                   within 90 days (no contract on file)
      //   4. pending    — contract in draft / sent / partially_signed
      //   5. vacant     — no slip, no contract, not a club member
      //   6. active     — everything else
      const liveEndIso = liveContract?.effective_end ?? null;
      const transientEndIso =
        currentReservation?.status === "occupied"
          ? currentReservation.departure_date
          : null;
      const effectiveEndIso = liveEndIso ?? transientEndIso ?? null;
      const lapsedContract = lapsedContractByBoaterId.get(boater.id);
      const lapsedFallbackEndIso = liveContract
        ? null
        : lapsedContract?.effective_end ?? null;
      const slipNumber = currentReservation?.slip_id ?? liveContract?.slip_id ?? null;

      let rowStatus:
        | "active"
        | "past_due"
        | "expiring"
        | "lapsed"
        | "pending"
        | "vacant";
      if (openBalance > 0) {
        rowStatus = "past_due";
      } else if (
        (effectiveEndIso !== null && effectiveEndIso <= todayIso) ||
        (lapsedFallbackEndIso !== null && lapsedFallbackEndIso <= todayIso)
      ) {
        rowStatus = "lapsed";
      } else if (
        effectiveEndIso !== null &&
        effectiveEndIso <= ninetyDaysOutIso
      ) {
        rowStatus = "expiring";
      } else if (
        liveContract?.status === "draft" ||
        liveContract?.status === "sent" ||
        liveContract?.status === "partially_signed"
      ) {
        rowStatus = "pending";
      } else if (!slipNumber && !sub) {
        rowStatus = "vacant";
      } else {
        rowStatus = "active";
      }

      return {
        boater,
        currentReservation,
        contractSlipId: liveContract?.slip_id,
        contractStatus: liveContract?.status,
        contractEffectiveEnd: liveContract?.effective_end,
        contractCadence: liveContract?.billing_cadence,
        primaryVessel,
        openBalance,
        service,
        clubSubscription: sub,
        rowStatus,
      };
    });
  }, [
    boaters,
    liveReservationByBoaterId,
    liveContractByBoaterId,
    lapsedContractByBoaterId,
    openBalanceByBoaterId,
    primaryVesselByBoaterId,
    clubSubByBoaterId,
    todayIso,
    ninetyDaysOutIso,
  ]);

  type CadenceFilter = "all" | "annual" | "seasonal" | "monthly" | "transient";
  type StatusFilter =
    | "all"
    | "active"
    | "past_due"
    | "expiring"
    | "lapsed"
    | "pending"
    | "vacant";
  // Lifecycle segment — "Members" hides waitlist-only prospects from
  // the operator's default view (no point seeing 500 prospects when
  // working the slip-holder roster). "Waitlist" inverts that;
  // "All" shows the unified list. Tag-based so the cost is O(1).
  type LifecycleSegment = "members" | "waitlist" | "all";
  const [cadence, setCadence] = React.useState<CadenceFilter>("all");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [segment, setSegment] = React.useState<LifecycleSegment>("members");

  // counts + filtered both read row.rowStatus (pre-classified in the rows
  // memo) — no per-render classification, no Date.now() instability.
  const counts = React.useMemo(() => {
    const c = {
      active: 0,
      past_due: 0,
      expiring: 0,
      lapsed: 0,
      pending: 0,
      vacant: 0,
    };
    for (const r of rows) c[r.rowStatus]++;
    return c;
  }, [rows]);

  // Lifecycle segment counts — used as labels on the segmented control.
  const segmentCounts = React.useMemo(() => {
    let waitlist = 0;
    for (const r of rows) {
      if ((r.boater.tags ?? []).includes("waitlist-only")) waitlist++;
    }
    return { members: rows.length - waitlist, waitlist, all: rows.length };
  }, [rows]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows;

    // Lifecycle segment first so the count badges on the cadence /
    // status filters below reflect the active segment.
    if (segment === "members") {
      out = out.filter(
        (r) => !(r.boater.tags ?? []).includes("waitlist-only"),
      );
    } else if (segment === "waitlist") {
      out = out.filter((r) =>
        (r.boater.tags ?? []).includes("waitlist-only"),
      );
    }

    if (cadence !== "all") {
      out = out.filter((r) => r.boater.billing_cadence === cadence);
    }
    if (status !== "all") {
      out = out.filter((r) => r.rowStatus === status);
    }

    if (!q) return out;
    if (/^(add|create|new|register|sign up)\b/i.test(q)) return out;
    return out.filter((r) => {
      const b = r.boater;
      return (
        b.display_name.toLowerCase().includes(q) ||
        b.code?.toLowerCase().includes(q) ||
        b.primary_contact.email?.toLowerCase().includes(q) ||
        b.primary_contact.phone?.includes(q) ||
        r.currentReservation?.slip_id.toLowerCase().includes(q)
      );
    });
  }, [rows, query, cadence, status, segment]);

  return (
    // The agent lives on the parent layout (members-client.tsx) so it
    // persists across the Slip Holders ↔ Rental Club sub-nav switch
    // and the agent → toolbar gap matches /services to the pixel.
    <div className="space-y-5">
      {/* Compact filter row: in-list search + cadence/balance chips + CTA. */}
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-surface-1 p-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a boater by name, code, slip…"
            className="w-full rounded-[8px] border border-hairline bg-surface-2 py-1.5 pl-8 pr-3 text-[12px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
          />
        </div>
        {/* Lifecycle segment — three-way toggle for the audience the
            operator is working: active members, waitlist prospects,
            or everyone. Tags drive the partition (see ensureWaitlist-
            Boater for the source of the "waitlist-only" tag). */}
        <div className="inline-flex rounded-[8px] border border-hairline bg-surface-2 p-0.5">
          {(
            [
              { id: "members", label: `Members · ${segmentCounts.members}` },
              {
                id: "waitlist",
                label: `Waitlist · ${segmentCounts.waitlist}`,
              },
              { id: "all", label: `All · ${segmentCounts.all}` },
            ] as { id: LifecycleSegment; label: string }[]
          ).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSegment(s.id)}
              className={cn(
                "rounded-[6px] px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                segment === s.id
                  ? "bg-surface-1 text-fg shadow-sm"
                  : "text-fg-subtle hover:text-fg",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <ListFilterSelect
          value={cadence}
          onChange={(v) => setCadence(v as CadenceFilter)}
          label="Cadence"
          options={[
            { value: "all", label: "All cadences" },
            { value: "annual", label: "Annual" },
            { value: "seasonal", label: "Seasonal" },
            { value: "monthly", label: "Monthly" },
            { value: "transient", label: "Transient" },
          ]}
        />

        <ListFilterSelect
          value={status}
          onChange={(v) => setStatus(v as StatusFilter)}
          label="Status"
          options={[
            { value: "all", label: `All · ${rows.length}` },
            { value: "active", label: `Active · ${counts.active}` },
            { value: "past_due", label: `Past due · ${counts.past_due}` },
            { value: "expiring", label: `Expiring · ${counts.expiring}` },
            { value: "lapsed", label: `Lapsed · ${counts.lapsed}` },
            { value: "pending", label: `Pending approval · ${counts.pending}` },
            { value: "vacant", label: `Vacant · ${counts.vacant}` },
          ]}
        />

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setWizardOpen(true)}
          >
            <Plus className="size-3.5" />
            New slip holder
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{ gridTemplateColumns: BOATER_COLS }}
        >
          <span>Member</span>
          <span>Slip</span>
          <span>Cadence</span>
          <span>Vessel</span>
          <span className="text-right">Balance</span>
          <span>Status</span>
        </div>
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-fg-subtle">
            No slip holders match{" "}
            <span className="font-medium text-fg">&ldquo;{query}&rdquo;</span>.
            Try a different name, or click{" "}
            <span className="font-medium text-primary">+ New slip holder</span> to add one.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {filtered.map((r) => (
              <SlipHolderRow
                key={r.boater.id}
                boater={r.boater}
                currentReservation={r.currentReservation}
                contractSlipId={r.contractSlipId}
                contractStatus={r.contractStatus}
                contractEffectiveEnd={r.contractEffectiveEnd}
                contractCadence={r.contractCadence}
                vessel={r.primaryVessel}
                openBalance={r.openBalance}
                clubSubscription={r.clubSubscription}
                rowStatus={r.rowStatus}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between text-[11px] text-fg-tertiary">
        <span>
          {filtered.length} of {rows.length} boaters
        </span>
        <span>
          <Badge tone="primary" size="sm">
            Agent
          </Badge>{" "}
          can also bulk-message, filter, or open a contract from this list — just ask.
        </span>
      </div>

      <MemberSetupWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}

// Derive a Service Type label for the list column. Club membership wins
// when present (since it's the most product-defining identity). Falls
// back to the member's current slip class for slip holders, mapped onto
// the Service Type taxonomy. Returns null when no recognizable service
// is on file — that renders as "—" in the column.
function deriveService(
  slipId: string | undefined,
  subscription: ClubSubscription | undefined
): ServiceLabel {
  if (subscription) return "Rental Club";
  if (!slipId) return null;
  const slip = getSlip(slipId);
  if (!slip) return null;
  switch (slip.slip_class) {
    case "buoy":
      return "Buoy";
    case "dry_storage":
      return "Dry Storage";
    case "covered":
    case "uncovered":
    case "t_head":
      return "Standard";
    default:
      return "Standard";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SlipHolderRow — slim 5-column row tailored for the slip-holder directory.
// Replaces the older BoaterRow which carried generic columns (Service, Trust,
// Last seen). Optimized for the "renew / chase / identify" tasks that
// actually happen on this page.
// ─────────────────────────────────────────────────────────────────────────────

// Single source of truth for status badge tone + label. Parent (BoaterList)
// pre-classifies row.rowStatus; the row just renders. Guarantees the
// counts-chip number and the visible badge can never disagree.
type RowStatus =
  | "active"
  | "past_due"
  | "expiring"
  | "lapsed"
  | "pending"
  | "vacant";

const ROW_STATUS_BADGE: Record<
  RowStatus,
  { label: string; tone: "ok" | "info" | "warn" | "danger" | "neutral" }
> = {
  active: { label: "Active", tone: "ok" },
  past_due: { label: "Past due", tone: "danger" },
  expiring: { label: "Expiring", tone: "warn" },
  lapsed: { label: "Lapsed", tone: "danger" },
  pending: { label: "Pending approval", tone: "info" },
  vacant: { label: "Vacant", tone: "neutral" },
};

function SlipHolderRow({
  boater,
  currentReservation,
  contractSlipId,
  contractStatus,
  contractEffectiveEnd,
  contractCadence,
  vessel,
  openBalance,
  clubSubscription,
  rowStatus,
}: {
  boater: import("@/lib/types").Boater;
  currentReservation?: import("@/lib/types").Reservation;
  contractSlipId?: string;
  contractStatus?: import("@/lib/types").ContractStatus;
  contractEffectiveEnd?: string;
  contractCadence?: import("@/lib/types").BillingCadence;
  vessel?: import("@/lib/types").Vessel;
  openBalance: number;
  clubSubscription?: ClubSubscription;
  rowStatus: RowStatus;
}) {
  const slipNumber = currentReservation?.slip_id ?? contractSlipId ?? null;
  const slipStatus = currentReservation
    ? currentReservation.status
    : contractStatus
    ? contractStatusLabel(contractStatus)
    : null;

  // daysToExpiry is used ONLY to format the inline "expires in Nd /
  // expired Nd ago" text on the Contract cell. The classification
  // (rowStatus) is pre-computed by the parent using stable ISO date
  // strings so it doesn't drift across renders or midnight; this
  // count is purely cosmetic and self-corrects on the next render.
  const daysToExpiry = contractEffectiveEnd
    ? Math.round(
        (new Date(contractEffectiveEnd).getTime() - Date.now()) / 86_400_000
      )
    : null;
  const expiringSoon = daysToExpiry !== null && daysToExpiry > 0 && daysToExpiry <= 90;
  const expired = daysToExpiry !== null && daysToExpiry <= 0;

  const badge = ROW_STATUS_BADGE[rowStatus];

  return (
    <li>
      <Link
        href={`/members/${boater.id}`}
        className="grid items-center gap-x-3 px-3 py-2 text-[13px] transition-colors hover:bg-surface-2"
        style={{ gridTemplateColumns: BOATER_COLS }}
      >
        {/* Member identity */}
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-7 shrink-0 text-[10px]">
            <AvatarFallback>{initialsOf(boater.display_name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-medium text-fg">
                {boater.display_name}
              </span>
              {clubSubscription && (
                <span
                  className="shrink-0 rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-primary"
                  title={`Rental Club member — ${clubSubscription.status}`}
                >
                  Club
                </span>
              )}
            </div>
            {boater.code && (
              <div className="truncate text-[11px] text-fg-tertiary">
                {boater.code}
              </div>
            )}
          </div>
        </div>

        {/* Slip */}
        <div className="min-w-0">
          {slipNumber ? (
            <div>
              <div className="font-medium text-fg">{slipNumber}</div>
              {slipStatus && (
                <div className="truncate text-[11px] text-fg-tertiary">{slipStatus}</div>
              )}
            </div>
          ) : (
            <span className="text-fg-tertiary">—</span>
          )}
        </div>

        {/* Cadence — billing cadence + expiry hint. Lights up amber when
            within 90 days, red when expired. */}
        <div className="min-w-0">
          {contractCadence ? (
            <div>
              <div className="capitalize text-fg">{contractCadence}</div>
              {contractEffectiveEnd && (
                <div
                  className={
                    "truncate text-[11px] " +
                    (expired
                      ? "text-status-danger"
                      : expiringSoon
                      ? "text-status-warn"
                      : "text-fg-tertiary")
                  }
                >
                  {expired
                    ? `expired ${Math.abs(daysToExpiry ?? 0)}d ago`
                    : expiringSoon
                    ? `expires in ${daysToExpiry}d`
                    : `ends ${contractEffectiveEnd}`}
                </div>
              )}
            </div>
          ) : (
            <span className="text-fg-tertiary">—</span>
          )}
        </div>

        {/* Vessel */}
        <div className="min-w-0">
          {vessel ? (
            <div>
              <div className="truncate text-fg">{vessel.name}</div>
              <div className="truncate text-[11px] text-fg-tertiary">
                {[vessel.year, vessel.make, vessel.model].filter(Boolean).join(" ") ||
                  "—"}
              </div>
            </div>
          ) : (
            <span className="text-fg-tertiary">—</span>
          )}
        </div>

        {/* Balance */}
        <div className="text-right tabular-nums">
          <span
            className={
              openBalance > 0
                ? "font-medium text-status-warn"
                : "text-fg-subtle"
            }
          >
            {formatMoney(openBalance)}
          </span>
        </div>

        {/* Status — Badge LAST per the Services pattern. */}
        <div className="min-w-0">
          <Badge tone={badge.tone} size="sm">
            {badge.label}
          </Badge>
        </div>
      </Link>
    </li>
  );
}

function contractStatusLabel(s?: import("@/lib/types").ContractStatus): string {
  switch (s) {
    case "active":
      return "active";
    case "executed":
      return "executed";
    case "draft":
    case "sent":
    case "partially_signed":
      return "pending approval";
    default:
      return s ?? "";
  }
}
