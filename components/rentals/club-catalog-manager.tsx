"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Search, Tag, Trash2 } from "lucide-react";
import { ListFilterSelect } from "@/components/ui/list-filter-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import {
  deleteRate,
  migrateMembersToCurrentPrice,
  nextRateId,
  upsertRate,
  useClubPlans,
  useClubSubscriptions,
  useFeesForEntity,
  useRates,
  useRentalBoats,
} from "@/lib/client-store";
import { NewBoatButton } from "@/components/rentals/new-boat-button";
import { RentalBoatEditSheet } from "@/components/rentals/rental-boat-edit-sheet";
import { useCan } from "@/lib/auth";
import { formatMoney } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import type { ClubPlanTier, Rate, RentalBoat } from "@/lib/types";

/*
 * Services → Rental Club catalog. Two stacked sections:
 *
 *  1. PLANS — rows from the Rate catalog filtered to
 *     (occupancy_type="Rental Club", cadence="monthly"). The form
 *     exposes the four numbers that actually drive billing:
 *     monthly fee, join fee, days/month, and the tier slot
 *     (basic/plus/premium). Tier ties a plan to the corresponding
 *     downgrade slot in retention offers.
 *
 *  2. FLEET — rows from RentalBoat filtered to the operator's full
 *     boat list. A single toggle flips `available_for_club` on/off
 *     so the boat rotates in (or out of) the club rotation. The
 *     toggle is the entire affordance — the catalog isn't where you
 *     add new boats (that lives on /boat-rentals).
 */

// ─── Plan field spec ─────────────────────────────────────────────
//
// We hand-roll the field list rather than reuse RATES because the
// club-plan fields (days_per_month, plan_tier) only make sense in
// this context. occupancy_type + cadence get stamped at save time
// so the operator never has to pick them. The setup fee is NOT a
// field on the plan row — it's its own catalog Rate (cadence:
// one_time, same plan_tier) edited from Services → Rates like
// every other fee. See getSetupRateForTier().

const PLAN_TIER_OPTIONS: { value: ClubPlanTier; label: string }[] = [
  { value: "basic", label: "Basic" },
  { value: "plus", label: "Plus" },
  { value: "premium", label: "Premium" },
];

const PLAN_FIELDS: FieldSpec<Rate>[] = [
  {
    key: "name",
    label: "Plan name",
    kind: "text",
    required: true,
    col: 2,
    placeholder: "Pontoon Club — Basic",
  },
  {
    key: "plan_tier",
    label: "Tier slot",
    kind: "select",
    required: true,
    col: 2,
    options: PLAN_TIER_OPTIONS,
  },
  {
    key: "amount",
    label: "Monthly fee ($)",
    kind: "money",
    required: true,
    col: 2,
    step: "1",
    placeholder: "199",
  },
  {
    key: "days_per_month",
    label: "Days / month",
    kind: "number",
    required: true,
    col: 2,
    step: "1",
    placeholder: "4",
  },
];

/*
 * Rental Club catalog — Fleet-only.
 *
 * Plans (Basic / Plus / Premium) live in /services/rates as Rate rows
 * with occupancy_type === "Rental Club". They're priced + edited there
 * alongside every other service rate, so this page is purely the fleet
 * rotation: which boats are in the club, which are walk-up only.
 */
export function ClubCatalogManager() {
  return (
    <div className="space-y-6">
      <FleetSection />
    </div>
  );
}

// ─── PLANS ────────────────────────────────────────────────────────

function PlansSection() {
  const plans = useClubPlans();
  const subs = useClubSubscriptions();
  const rates = useRates();
  const canCreate = useCan("create", "rate");

  // Setup fee per tier — looked up live from the catalog so plans
  // always display the current setup-fee amount. Catalog rows with
  // cadence="one_time" + matching plan_tier are the source of truth.
  const setupForTier = React.useMemo(() => {
    const m = new Map<ClubPlanTier, Rate>();
    for (const r of rates) {
      if (
        r.occupancy_type === "Rental Club" &&
        r.cadence === "one_time" &&
        r.plan_tier
      ) {
        m.set(r.plan_tier, r);
      }
    }
    return m;
  }, [rates]);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Rate | undefined>();

  function openCreate() {
    setEditing(undefined);
    setDialogOpen(true);
  }
  function openEdit(rate: Rate) {
    setEditing(rate);
    setDialogOpen(true);
  }
  function handleSave(values: Rate) {
    // Stamp the implicit fields the dialog doesn't expose — these are
    // what make this a club plan vs a regular service rate. The Rate
    // entity is shared with /services/rates; only club plans get
    // days_per_month + plan_tier populated. Setup fees live as their
    // own one-time Rate rows (linked via plan_tier), not as a field
    // on this row.
    upsertRate({
      ...values,
      id: values.id || editing?.id || nextRateId(),
      occupancy_type: "Rental Club",
      cadence: "monthly",
      amount: Number(values.amount) || 0,
      days_per_month:
        values.days_per_month !== undefined
          ? Number(values.days_per_month) || 0
          : undefined,
    });
  }
  function handleDelete(rate: Rate) {
    // Defense: don't let the operator delete a plan that members are
    // actively pointing at — existing subs would lose their snapshot
    // fallback if joined_at_* is also missing.
    const inUse = subs.filter((s) => s.plan_rate_id === rate.id).length;
    if (inUse > 0) {
      window.alert(
        `Can't delete "${rate.name}" — ${inUse} active member${inUse === 1 ? "" : "s"} on this plan. Move them to another plan first.`
      );
      return;
    }
    if (!window.confirm(`Delete plan "${rate.name}"?`)) return;
    deleteRate(rate.id);
  }

  // Per-plan active-member count for the table.
  function membersOnPlan(planId: string): number {
    return subs.filter(
      (s) => s.plan_rate_id === planId && s.status === "active"
    ).length;
  }

  // Count of active members whose grandfathered snapshot doesn't match
  // the plan's current catalog values — these are the candidates for
  // bulk migration. Skips members already at the current price.
  function outOfDateOnPlan(plan: Rate): number {
    const currentSetup =
      plan.plan_tier !== undefined
        ? setupForTier.get(plan.plan_tier)?.amount
        : undefined;
    return subs.filter((s) => {
      if (s.plan_rate_id !== plan.id || s.status !== "active") return false;
      const monthly = s.joined_at_monthly_fee ?? plan.amount;
      const join = s.joined_at_join_fee ?? currentSetup;
      const days = s.joined_at_days_per_month ?? plan.days_per_month;
      return (
        monthly !== plan.amount ||
        join !== currentSetup ||
        days !== plan.days_per_month
      );
    }).length;
  }

  function handleMigrate(plan: Rate) {
    const count = outOfDateOnPlan(plan);
    if (count === 0) return;
    const ok = window.confirm(
      `Migrate ${count} grandfathered member${count === 1 ? "" : "s"} to the current ${plan.name} pricing?\n\n` +
        `Each member will be notified of the change. Their next billing cycle reflects the new monthly fee. Existing invoices aren't touched.`
    );
    if (!ok) return;
    const result = migrateMembersToCurrentPrice(plan.id);
    window.alert(
      `Migrated ${result.migrated.length} member${result.migrated.length === 1 ? "" : "s"} to current pricing` +
        (result.alreadyCurrent > 0
          ? `\n${result.alreadyCurrent} already at current price`
          : "")
    );
  }

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="inline-flex items-center gap-1.5 text-[14px] font-medium text-fg">
            <Tag className="size-3.5 text-primary" />
            Plans
          </h2>
          <p className="mt-0.5 text-[12px] text-fg-tertiary">
            Click a row to edit. New members pick from this list; existing
            members keep their grandfathered amounts at signup.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" size="sm" onClick={openCreate}>
            <Plus className="size-3.5" />
            New plan
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{
            gridTemplateColumns:
              "minmax(0, 2.2fr) 100px 110px 110px 100px 90px 140px 36px",
          }}
        >
          <span>Plan name</span>
          <span>Tier</span>
          <span>Monthly</span>
          <span>Join fee</span>
          <span>Days / mo</span>
          <span>Members</span>
          <span>Grandfathered</span>
          <span />
        </div>
        {plans.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-fg-tertiary">
            No plans yet. Click{" "}
            <span className="font-medium text-fg-subtle">New plan</span> to
            create your first Rental Club tier.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {plans.map((p) => {
              const memberCount = membersOnPlan(p.id);
              const grandfathered = outOfDateOnPlan(p);
              return (
                <li key={p.id} className="group relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDelete(p);
                    }}
                    className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-md p-1 text-fg-tertiary opacity-0 transition-opacity hover:bg-surface-3 hover:text-status-danger group-hover:opacity-100"
                    aria-label={`Delete ${p.name}`}
                    title="Delete plan"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    style={{
                      gridTemplateColumns:
                        "minmax(0, 2.2fr) 100px 110px 110px 100px 90px 140px 36px",
                    }}
                    className="grid w-full cursor-pointer items-center gap-x-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
                    title="Edit plan"
                  >
                    <span className="min-w-0 truncate text-[13px] font-medium text-fg">
                      {p.name}
                    </span>
                    <span className="text-[12px] text-fg-subtle capitalize">
                      {p.plan_tier ?? "—"}
                    </span>
                    <span className="money-display text-[14px] text-fg">
                      {formatMoney(p.amount)}
                    </span>
                    <span className="money-display text-[14px] text-fg-subtle">
                      {formatMoney(
                        p.plan_tier !== undefined
                          ? setupForTier.get(p.plan_tier)?.amount ?? 0
                          : 0
                      )}
                    </span>
                    <span className="tabular text-[13px] text-fg-subtle">
                      {p.days_per_month ?? 0}
                    </span>
                    <span className="text-[12px] text-fg-subtle">
                      {/* Slot for the member-count chip — the actual
                          rendered Link sits as an absolute sibling
                          (button-in-button isn't legal HTML). */}
                      <span aria-hidden className="text-fg-tertiary">
                        {memberCount > 0 ? memberCount : "—"}
                      </span>
                    </span>
                    {/* Slot for the migrate-grandfathered button — the
                        actual rendered button is absolute-positioned
                        below (same button-in-button avoidance). */}
                    <span aria-hidden className="text-[12px] text-fg-tertiary">
                      {grandfathered > 0 ? `${grandfathered} on old price` : "—"}
                    </span>
                    <span />
                  </button>
                  {memberCount > 0 && (
                    // Member-count drill link — absolute-positioned over
                    // the member column. stopPropagation prevents the
                    // outer row click from hijacking into the edit dialog.
                    <Link
                      href={`/members?tab=club&plan=${p.id}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{ right: 228 }}
                      className="absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-status-ok/15 px-2 py-0.5 text-[12px] font-medium text-status-ok transition-colors hover:bg-status-ok/25"
                      title={`View ${memberCount} member${memberCount === 1 ? "" : "s"} on this plan`}
                    >
                      {memberCount}
                    </Link>
                  )}
                  {grandfathered > 0 && (
                    // Migrate-grandfathered button. Sits in the
                    // "Grandfathered" column. The button uses an
                    // operator-tier warn tone so it stands out when
                    // the operator just edited the plan's price and
                    // there's a fresh batch of grandfathered members.
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleMigrate(p);
                      }}
                      style={{ right: 50 }}
                      className="absolute top-1/2 z-10 -translate-y-1/2 rounded-full border border-status-warn/40 bg-status-warn/10 px-2 py-0.5 text-[11px] font-medium text-status-warn transition-colors hover:bg-status-warn/20"
                      title={`Migrate ${grandfathered} member${grandfathered === 1 ? "" : "s"} to current ${p.name} pricing`}
                    >
                      Migrate {grandfathered}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <RecordEditDialog<Rate>
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? `Edit plan — ${editing.name}` : "New club plan"}
        description="Plans flow into all new Rental Club subscriptions. Grandfathered amounts on existing members come from the snapshot taken at signup."
        record={editing}
        fields={PLAN_FIELDS}
        onSave={handleSave}
        onDelete={editing ? handleDelete : undefined}
        entity="rate"
      />
    </section>
  );
}

// ─── FLEET ────────────────────────────────────────────────────────

// Grid template matched to the slip page's pattern. Six columns
// laid out in the same identity → location → category → detail →
// money → status order the slip roster uses:
//   BOAT · DOCK · TYPE · SEATS · FEES · STATUS
// (slip equivalent: SLIP · DOCK · MEMBER · VESSEL · RATE · STATUS).
const FLEET_COLS =
  "minmax(160px, 2.2fr) minmax(110px, 1.2fr) 110px 60px minmax(130px, 1.3fr) 110px";

function FleetSection() {
  const boats = useRentalBoats();
  const rentalBoatFees = useFeesForEntity("rental_boat");
  const [editing, setEditing] = React.useState<RentalBoat | null>(null);

  // Quick lookup of fee details by id so the FEES column can render
  // both the attached count and the deposit (the canonical money
  // value per boat — analogous to the slip's RATE column).
  const feeById = React.useMemo(() => {
    const m = new Map<string, (typeof rentalBoatFees)[number]>();
    for (const f of rentalBoatFees) m.set(f.id, f);
    return m;
  }, [rentalBoatFees]);

  function summarizeFees(boat: RentalBoat): { count: number; depositAmount: number } {
    const ids = boat.attached_fee_ids ?? [];
    let depositAmount = boat.deposit_amount ?? 0;
    for (const id of ids) {
      const fee = feeById.get(id);
      if (fee?.is_deposit) depositAmount = fee.amount;
    }
    return { count: ids.length, depositAmount };
  }

  // Slip-page-mirrored filter UX: single-row toolbar with search +
  // three dropdowns + the create button. Replaced the prior chip-row +
  // section-header layout for consistency across every list page.
  const [query, setQuery] = React.useState("");
  const [useFilter, setUseFilter] = React.useState<"all" | "club" | "transient">("all");
  const [typeFilter, setTypeFilter] = React.useState<string>("all");
  const [statusFilter, setStatusFilter] = React.useState<"all" | RentalBoat["status"]>("all");

  // Count rollups for the Status dropdown labels (slip page convention).
  const counts = React.useMemo(() => {
    const acc = {
      all: boats.length,
      available: 0,
      rented: 0,
      maintenance: 0,
      off_season: 0,
    };
    for (const b of boats) acc[b.status] = (acc[b.status] ?? 0) + 1;
    return acc;
  }, [boats]);

  // Unique boat types present in the fleet — drives the Type dropdown
  // options dynamically so a marina with no jet-skis doesn't see the
  // option at all.
  const typeOptions = React.useMemo(() => {
    const seen = new Set<string>();
    for (const b of boats) seen.add(b.type);
    return Array.from(seen);
  }, [boats]);

  const filtered = boats.filter((b) => {
    if (useFilter === "club" && b.available_for_club !== true) return false;
    if (useFilter === "transient" && b.available_for_club === true) return false;
    if (typeFilter !== "all" && b.type !== typeFilter) return false;
    if (statusFilter !== "all" && b.status !== statusFilter) return false;
    if (query.trim().length > 0) {
      const q = query.trim().toLowerCase();
      const hay =
        `${b.name} ${b.type} ${b.home_dock ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <section className="space-y-4">
      {/* Single-row toolbar — mirrors the slip page's roster toolbar.
          Search + three compact dropdowns + Add button. */}
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-surface-1 p-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Boat, type, or dock…"
            className="w-full rounded-[8px] border border-hairline bg-surface-2 py-1.5 pl-8 pr-3 text-[12px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
          />
        </div>

        <ListFilterSelect
          value={typeFilter}
          onChange={setTypeFilter}
          label="Type"
          options={[
            { value: "all", label: "All types" },
            ...typeOptions.map((t) => ({
              value: t,
              label: t.replace(/_/g, " "),
            })),
          ]}
        />

        <ListFilterSelect
          value={useFilter}
          onChange={(v) => setUseFilter(v as typeof useFilter)}
          label="Use"
          options={[
            { value: "all", label: "All uses" },
            { value: "club", label: "Boat Club" },
            { value: "transient", label: "Transient only" },
          ]}
        />

        <ListFilterSelect
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as typeof statusFilter)}
          label="Status"
          options={[
            { value: "all", label: `All · ${counts.all}` },
            { value: "available", label: `Available · ${counts.available}` },
            { value: "rented", label: `Rented · ${counts.rented}` },
            { value: "maintenance", label: `Maintenance · ${counts.maintenance}` },
            { value: "off_season", label: `Off season · ${counts.off_season}` },
          ]}
        />

        <NewBoatButton />
      </div>

      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        {/* Column header — same density tokens the slip page uses
            (px-3 py-2 + 10px uppercase) so the two tables sit at
            identical visual weight. Capacity gets its own narrow
            column instead of riding under the boat name as sub-text;
            keeps every row to exactly one line. */}
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{ gridTemplateColumns: FLEET_COLS }}
        >
          <span>Boat</span>
          <span>Dock</span>
          <span>Type</span>
          <span>Seats</span>
          <span>Fees</span>
          <span>Status</span>
        </div>

        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-fg-subtle">
            No boats match this filter.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {filtered.map((b) => {
              const fees = summarizeFees(b);
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => setEditing(b)}
                    className="grid w-full cursor-pointer items-center gap-x-3 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-2"
                    style={{ gridTemplateColumns: FLEET_COLS }}
                  >
                    {/* Identity — boat name + a subtle club/transient
                        side-marker so the operator can scan the column
                        and still tell at a glance which revenue stream a
                        given boat belongs to. Single line — capacity
                        moved to its own column. */}
                    <span className="flex min-w-0 items-center gap-1.5 truncate font-medium text-fg">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          b.available_for_club ? "bg-status-info" : "bg-status-ok"
                        )}
                        title={b.available_for_club ? "Boat Club rotation" : "Transient only"}
                        aria-hidden
                      />
                      <span className="truncate">{b.name}</span>
                    </span>
                    <span className="truncate text-[12px] text-fg-subtle">
                      {b.home_dock || "—"}
                    </span>
                    <span className="truncate text-[12px] capitalize text-fg-subtle">
                      {b.type.replace(/_/g, " ")}
                    </span>
                    <span className="tabular text-[12px] text-fg-subtle">
                      {b.capacity}
                    </span>
                    <span className="truncate text-[12px] text-fg-subtle">
                      {fees.count === 0 ? (
                        <span className="text-fg-tertiary">—</span>
                      ) : (
                        <>
                          <span className="tabular text-fg">{fees.count}</span>
                          {" "}
                          rate{fees.count === 1 ? "" : "s"}
                          {fees.depositAmount > 0 && (
                            <span className="ml-1 text-fg-tertiary">
                              · {formatMoney(fees.depositAmount)} hold
                            </span>
                          )}
                        </>
                      )}
                    </span>
                    <span>
                      <Badge tone={statusTone(b.status)} size="sm">
                        {statusLabel(b.status)}
                      </Badge>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Edit sheet — opens on row click. RentalBoatWizard handles new
          boats (multi-step UX for a fresh entity); RentalBoatEditSheet
          handles edits (single scrollable form, matched to the wizard
          for visual + behavioral parity, including the catalog-vs-
          custom rates toggle). */}
      {editing && (
        <RentalBoatEditSheet
          boat={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}


// ── Status badge helpers ────────────────────────────────────────
// Map the RentalBoat.status enum onto the Badge tones we already use
// elsewhere (Reservations, ledger, work orders) so the dashboard,
// catalog, and /boat-rentals all speak the same visual language.
function statusTone(status: RentalBoat["status"]): "ok" | "info" | "warn" | "neutral" {
  switch (status) {
    case "available":
      return "ok";
    case "rented":
      return "info";
    case "maintenance":
      return "warn";
    case "off_season":
      return "neutral";
    default:
      return "neutral";
  }
}

function statusLabel(status: RentalBoat["status"]): string {
  switch (status) {
    case "available":
      return "Available";
    case "rented":
      return "On the water";
    case "maintenance":
      return "Maintenance";
    case "off_season":
      return "Off-season";
    default:
      return status;
  }
}
