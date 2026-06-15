"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  Check,
  Clock,
  Filter,
  Mail,
  Phone,
  Search,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BOATERS, SLIPS, formatInches, getCurrentReservation } from "@/lib/mock-data";
import {
  acceptWaitlistOffer,
  archiveWaitlistEntries,
  ensureWaitlistBoater,
  bulkStampLastContact,
  declineWaitlistOffer,
  useWaitlist,
} from "@/lib/client-store";
import type { SlipClass, WaitlistEntry, WaitlistOfferStatus } from "@/lib/types";
import { useTabUrlState } from "@/lib/use-tab-url-state";
import { ListFilterSelect } from "@/components/ui/list-filter-select";
import { WaitlistFireOfferModal } from "./waitlist-fire-offer-modal";
import { WaitlistLogCallModal } from "./waitlist-log-call-modal";
import { WaitlistApplicantSheet } from "./waitlist-applicant-sheet";
import { AssignHolderWizard } from "@/app/services/[id]/assign/assign-slip-client";
import { cn } from "@/lib/utils";

/*
 * Waitlist operator surface — 4-tab structure for the 500-person
 * reality marinas actually face.
 *
 *   Queue   — active applicants ranked oldest-first. Filter +
 *             bulk-select + per-row Fire offer. The primary daily
 *             driver.
 *   Offers  — pending + recent decisions across all slips. Watch
 *             the auto-offer cascade as it fires.
 *   Stale   — entries that have gone cold (no contact > 9 months,
 *             never contacted at all, OR ≥3 declines). Bulk
 *             "check-in" stamps last_contact_at so re-engaged
 *             entries leave Stale automatically.
 *   Archive — historical record (got_slip / withdrew / aged_out /
 *             non_responder / too_many_declines). Searchable for
 *             re-engagement.
 *
 * Filter bar lives ABOVE the tabs and applies to whichever tab is
 * active. Tabs are URL-synced via useTabUrlState so an agent
 * suggestion like "open the stale tab" can deep-link directly.
 */

// Mirrors ROSTER_COLS in components/rentals/roster-view.tsx so the
// waitlist table reads at the same density as the slip roster.
// Columns: [checkbox] / RANK or SLIP / WANTS (preferred dock) /
// APPLICANT / VESSEL / CURRENT (slip-holder upgrading?) / CADENCE /
// SIGNAL / STATUS / ACTION.
const WAITLIST_COLS =
  "28px 56px 88px minmax(0, 1.7fr) minmax(0, 1.4fr) 96px 88px 140px 90px 130px";

const OFFER_TONE: Record<
  WaitlistOfferStatus,
  { tone: "ok" | "warn" | "info" | "danger" | "neutral"; label: string }
> = {
  none: { tone: "neutral", label: "no offer" },
  pending: { tone: "warn", label: "pending" },
  accepted: { tone: "ok", label: "accepted" },
  declined: { tone: "danger", label: "declined" },
  expired: { tone: "neutral", label: "expired" },
};

type WaitlistTab = "queue" | "offers" | "stale" | "archive";

function isWaitlistTab(v: string | null | undefined): v is WaitlistTab {
  return v === "queue" || v === "offers" || v === "stale" || v === "archive";
}

// "Stale" criteria — these are the defaults; settings/notification-rules
// will eventually let the operator tune the threshold per tenant.
const STALE_NO_CONTACT_DAYS = 270; // ~9 months
const STALE_DECLINE_COUNT = 3;

function isStale(entry: WaitlistEntry, nowMs: number): boolean {
  // Only pending entries can be "stale" — archived/converted are
  // out of the queue entirely.
  if (entry.status !== "pending") return false;
  if ((entry.decline_count ?? 0) >= STALE_DECLINE_COUNT) return true;
  const last = entry.last_contact_at ?? entry.created_at;
  const ageDays = (nowMs - new Date(last).getTime()) / 86_400_000;
  return ageDays >= STALE_NO_CONTACT_DAYS;
}

// Length-band buckets for the filter bar. Matches the realistic
// segmentation operators do when fitting an opened slip to the queue.
type LengthBand = "all" | "under_25" | "26_35" | "36_45" | "over_46";
function inLengthBand(loaInches: number | undefined, band: LengthBand): boolean {
  if (band === "all") return true;
  if (loaInches == null) return false;
  const ft = loaInches / 12;
  if (band === "under_25") return ft <= 25;
  if (band === "26_35") return ft > 25 && ft <= 35;
  if (band === "36_45") return ft > 35 && ft <= 45;
  return ft > 45;
}

type CadenceFilter = "all" | WaitlistEntry["reservation_type"];

export function WaitlistSection() {
  const router = useRouter();
  const entries = useWaitlist();

  /**
   * Open the boater profile for a waitlist entry — same destination as
   * clicking a member row, so the experience stays consistent across
   * the tool. Guest entries (no boater_id yet) get lazy-minted into a
   * lightweight Boater first so they HAVE a profile to navigate to.
   * Per the carve-out architecture, every person who interacts with
   * the marina ends up represented as a Boater eventually; this is
   * just the moment of conversion for those who came in via the
   * waitlist queue.
   */
  function openProfileForEntry(entryId: string) {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;
    const boaterId = ensureWaitlistBoater(entry);
    router.push(`/members/${boaterId}`);
  }
  const [tab, setTab] = useTabUrlState<WaitlistTab>(
    "wl",
    isWaitlistTab,
    "queue",
  );
  const [fireOpen, setFireOpen] = React.useState(false);
  const [prefilledSlipId, setPrefilledSlipId] = React.useState<string | undefined>();
  // ── Log Call modal — primary action per Steven's "phone-first"
  //    flow. Opens with a single entry's context; closes after the
  //    operator records accept / decline_archive / decline_stay.
  const [logCallEntryId, setLogCallEntryId] = React.useState<string | null>(
    null,
  );
  const logCallEntry = React.useMemo(
    () => (logCallEntryId
      ? entries.find((e) => e.id === logCallEntryId) ?? null
      : null),
    [entries, logCallEntryId],
  );

  // ── Applicant detail sheet (row click) + convert flow ──
  // selectedApplicantId opens the WaitlistApplicantSheet. When the
  // operator picks a slip from inside that sheet, it closes itself
  // and triggers wizardArgs which mounts AssignHolderWizard pre-filled
  // with the applicant's contact info.
  const [selectedApplicantId, setSelectedApplicantId] = React.useState<
    string | null
  >(null);
  const [wizardArgs, setWizardArgs] = React.useState<{
    slipId: string;
    prefill: {
      first_name: string;
      last_name: string;
      email?: string;
      phone?: string;
    };
    /**
     * Source waitlist entry id. Used to archive the entry as `got_slip`
     * only AFTER the wizard successfully drafts a contract — if the
     * operator cancels the wizard mid-flow, the entry stays in the Queue
     * tab (prior version archived on slip-pick, which orphaned the
     * applicant if they backed out).
     */
    waitlistEntryId: string;
  } | null>(null);
  const selectedEntry = React.useMemo(
    () => (selectedApplicantId ? entries.find((e) => e.id === selectedApplicantId) ?? null : null),
    [entries, selectedApplicantId],
  );

  // ── Filter state — applies to whichever tab is active ──
  const [query, setQuery] = React.useState("");
  const [lengthBand, setLengthBand] = React.useState<LengthBand>("all");
  const [cadence, setCadence] = React.useState<CadenceFilter>("all");
  // Slip-class filter — primary axis Steven uses to work "the covered
  // waitlist" separately from "the uncovered waitlist". An entry
  // matches when its preferred_classes array contains the active
  // class, or when preferred_classes is empty/undefined (no class
  // preference recorded = match everything).
  const [classFilter, setClassFilter] = React.useState<SlipClass | "all">(
    "all",
  );

  // ── Bulk selection — keyed by entry.id. Cleared on tab switch
  //    so the operator never accidentally bulk-acts on a row they
  //    forgot was selected on a different tab. ──
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  React.useEffect(() => {
    setSelectedIds(new Set());
  }, [tab]);

  // ── Tab-specific row partitioning ──
  // Cheaper to derive once and reuse for counters than to re-filter
  // per render branch. nowMs lives inside the memo body — pulling it
  // out as a render-level const re-invalidated the memo every render
  // (a `Date.now()` deps invariant doesn't hold), which silently
  // turned the memo into per-render work. `isStale` only cares about
  // day-level age, so refreshing only when `entries` changes is fine.
  // pendingOfferCount counted alongside the partition so the badge
  // doesn't allocate a throwaway filtered array on every render.
  const { partitions, pendingOfferCount } = React.useMemo(() => {
    const nowMs = Date.now();
    const queue: WaitlistEntry[] = [];
    const offers: WaitlistEntry[] = [];
    const stale: WaitlistEntry[] = [];
    const archive: WaitlistEntry[] = [];
    let pendingOfferCount = 0;
    for (const e of entries) {
      if (e.archived_at) {
        archive.push(e);
        continue;
      }
      if (e.status === "converted") {
        archive.push(e);
        continue;
      }
      if (e.offer_status && e.offer_status !== "none") {
        offers.push(e);
        if (e.offer_status === "pending") pendingOfferCount += 1;
      }
      if (e.status === "pending") {
        if (isStale(e, nowMs)) {
          stale.push(e);
        } else {
          queue.push(e);
        }
      }
    }
    queue.sort((a, b) => a.created_at.localeCompare(b.created_at));
    offers.sort((a, b) => {
      const ap = a.offer_status === "pending" ? 0 : 1;
      const bp = b.offer_status === "pending" ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const at = a.offer_responded_at ?? a.offered_at ?? "";
      const bt = b.offer_responded_at ?? b.offered_at ?? "";
      return bt.localeCompare(at);
    });
    stale.sort((a, b) => {
      // Worst-first: most declines, then oldest last-contact.
      const dd = (b.decline_count ?? 0) - (a.decline_count ?? 0);
      if (dd !== 0) return dd;
      const al = a.last_contact_at ?? a.created_at;
      const bl = b.last_contact_at ?? b.created_at;
      return al.localeCompare(bl);
    });
    archive.sort((a, b) => {
      const ad = a.archived_at ?? a.created_at;
      const bd = b.archived_at ?? b.created_at;
      return bd.localeCompare(ad);
    });
    return {
      partitions: { queue, offers, stale, archive },
      pendingOfferCount,
    };
  }, [entries]);

  // ── Filter pipeline — runs after partition; same filter state
  //    drives every tab so the operator can carry a "covered slip
  //    over 36' annual" lens across Queue → Stale → Archive. ──
  //
  // boaterById is precomputed so each keystroke in the search box
  // doesn't do entries × BOATERS lookups (was O(n × m) per keystroke;
  // now O(m) build + O(1) per row).
  const boaterById = React.useMemo(
    () => new Map(BOATERS.map((b) => [b.id, b])),
    [],
  );
  const filterRow = React.useCallback(
    (e: WaitlistEntry) => {
      if (!inLengthBand(e.loa_inches, lengthBand)) return false;
      if (cadence !== "all" && e.reservation_type !== cadence) return false;
      // Class filter — match when the applicant either prefers this
      // class or has no class preference recorded at all (legacy seed
      // rows that pre-date the field shouldn't disappear from view).
      if (classFilter !== "all") {
        const prefs = e.preferred_classes;
        if (prefs && prefs.length > 0 && !prefs.includes(classFilter)) {
          return false;
        }
      }
      if (query.trim()) {
        const q = query.toLowerCase();
        const boater = e.boater_id ? boaterById.get(e.boater_id) : undefined;
        const haystack = [
          boater?.display_name,
          e.guest_name,
          e.guest_email,
          e.guest_phone,
          e.notes,
          e.preferred_dock,
          ...(e.tags ?? []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    },
    [query, lengthBand, cadence, classFilter, boaterById],
  );

  const visible = React.useMemo(() => {
    const list = partitions[tab];
    return list.filter(filterRow);
  }, [partitions, tab, filterRow]);

  // Per-class counts shown on the chips. Counted against the active
  // lifecycle tab so the chip labels reflect "active waitlist by
  // class," not "all waitlist by class" — operators care about the
  // pipeline they're working right now.
  const classCounts = React.useMemo(() => {
    const counts: Record<SlipClass | "all", number> = {
      all: partitions[tab].length,
      covered: 0,
      uncovered: 0,
      t_head: 0,
      buoy: 0,
      dry_storage: 0,
    };
    for (const e of partitions[tab]) {
      const prefs = e.preferred_classes;
      if (!prefs || prefs.length === 0) continue;
      for (const c of prefs) counts[c]++;
    }
    return counts;
  }, [partitions, tab]);

  const filtersDirty =
    query.trim().length > 0 ||
    lengthBand !== "all" ||
    cadence !== "all" ||
    classFilter !== "all";

  // pendingOfferCount is destructured from the partition memo above —
  // counted in the same pass so we don't allocate a throwaway
  // filtered array on every render.

  // ── Bulk actions
  function toggleAll() {
    if (selectedIds.size === visible.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visible.map((v) => v.id)));
    }
  }
  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="space-y-4">
      {/* No sub-heading — the Services layout's breadcrumb already
          identifies the page. List surfaces dive straight into the
          tabs/toolbar to match the canonical Slips page. See
          marina-stee/CLAUDE.md → "List-page UX consistency". */}

      {/* Pending-offer notice — surfaced inline when offers are out
          for response and the operator isn't currently looking at the
          Offers stage. Replaces the "1 pending" badge that used to
          live on the Offers tab. Clicking it switches the Stage
          filter so the operator lands on the offer list. */}
      {pendingOfferCount > 0 && tab !== "offers" && (
        <button
          type="button"
          onClick={() => setTab("offers")}
          className="flex w-full items-center justify-between gap-3 rounded-[10px] border border-status-warn/30 bg-status-warn/10 px-3 py-2 text-left text-[12px] text-status-warn transition-colors hover:bg-status-warn/15"
        >
          <span className="inline-flex items-center gap-2 font-medium">
            <Sparkles className="size-3.5" />
            {pendingOfferCount} offer{pendingOfferCount === 1 ? "" : "s"} awaiting response
          </span>
          <span className="text-[11px] text-status-warn/80">
            View offers →
          </span>
        </button>
      )}

      {/* ── Filter bar — canonical single-row toolbar (same shape as
                /services/roster, /services/rates, /services/meters).
                ALL filter axes live as ListFilterSelect dropdowns —
                no chip rows, no second filter row, no segment toggles
                stacked above. Operators learn one filter vocabulary
                that works on every list page in the app. See
                marina-stee/CLAUDE.md → "List-page UX consistency"
                rule #10 (no chip rows above the toolbar) and rule #11
                (single-row toolbar across every list surface). */}
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-surface-1 p-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, boat, phone, dock, or tag…"
            className="w-full rounded-[8px] border border-hairline bg-surface-2 py-1.5 pl-8 pr-3 text-[12px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
          />
        </div>
        <ListFilterSelect
          label="Stage"
          value={tab}
          onChange={(v) => setTab(v as WaitlistTab)}
          options={[
            { value: "queue", label: `Queue · ${partitions.queue.length}` },
            { value: "offers", label: `Offers · ${partitions.offers.length}` },
            { value: "stale", label: `Stale · ${partitions.stale.length}` },
            { value: "archive", label: `Archive · ${partitions.archive.length}` },
          ]}
        />
        <ListFilterSelect
          label="Class"
          value={classFilter}
          onChange={(v) => setClassFilter(v as SlipClass | "all")}
          options={[
            { value: "all", label: `All classes · ${classCounts.all}` },
            { value: "covered", label: `Covered · ${classCounts.covered}` },
            { value: "uncovered", label: `Uncovered · ${classCounts.uncovered}` },
            { value: "t_head", label: `T-head · ${classCounts.t_head}` },
            { value: "buoy", label: `Buoy / Mooring · ${classCounts.buoy}` },
            { value: "dry_storage", label: `Dry storage · ${classCounts.dry_storage}` },
          ]}
        />
        <ListFilterSelect
          label="Length"
          value={lengthBand}
          onChange={(v) => setLengthBand(v as LengthBand)}
          options={[
            { value: "all", label: "All lengths" },
            { value: "under_25", label: "≤ 25'" },
            { value: "26_35", label: "26-35'" },
            { value: "36_45", label: "36-45'" },
            { value: "over_46", label: "46'+" },
          ]}
        />
        <ListFilterSelect
          label="Cadence"
          value={cadence}
          onChange={(v) => setCadence(v as CadenceFilter)}
          options={[
            { value: "all", label: "All cadences" },
            { value: "annual", label: "Annual" },
            { value: "seasonal", label: "Seasonal" },
            { value: "monthly", label: "Monthly" },
            { value: "transient", label: "Transient" },
          ]}
        />
        {filtersDirty && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("");
              setLengthBand("all");
              setCadence("all");
              setClassFilter("all");
            }}
          >
            Clear
          </Button>
        )}
        <div className="ml-auto inline-flex items-center gap-1 text-[11px] text-fg-tertiary">
          <Filter className="size-3" />
          Showing {visible.length} of {partitions[tab].length}
        </div>
      </div>

      {/* ── Bulk action bar (only when selection exists) ──── */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-primary/40 bg-primary/10 px-3 py-2">
          <div className="text-[12.5px] font-medium text-fg">
            {selectedIds.size} selected
          </div>
          <div className="flex items-center gap-1.5">
            {tab !== "archive" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  bulkStampLastContact(Array.from(selectedIds));
                  setSelectedIds(new Set());
                }}
                title="Stamp last_contact_at on each selected entry. Use after sending a check-in email or making outbound calls."
              >
                <Mail className="size-3.5" />
                Mark contacted
              </Button>
            )}
            {tab !== "archive" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const reason = tab === "stale" ? "non_responder" : "withdrew";
                  archiveWaitlistEntries(Array.from(selectedIds), reason);
                  setSelectedIds(new Set());
                }}
                title="Move these entries to the Archive tab. They stay searchable but leave the active queue."
              >
                <Archive className="size-3.5" />
                Archive
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
            >
              <X className="size-3.5" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* ── Body ── Mirrors the slip roster layout: rounded table
                with a sticky column header, then either a flat row
                list or dock-grouped collapsible sections. Operators
                only learn one row pattern across slips + waitlist. */}
      {visible.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-hairline bg-surface-1 px-3 py-10 text-center text-[13px] text-fg-subtle">
          {tab === "queue" && (filtersDirty
            ? "No active waitlisters match the filter."
            : "Nothing in the active queue. The marina has capacity, or every applicant has been moved to Stale / Archive.")}
          {tab === "offers" && "No offers fired yet."}
          {tab === "stale" && "No stale entries. Every applicant has been contacted in the last 9 months."}
          {tab === "archive" && (filtersDirty
            ? "No archived entries match the filter."
            : "No archived entries yet.")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
          {/* Column header. Was `sticky top-16` to match the slip
              roster, but waitlist rows are two-line (name + email)
              while slip rows are single-line — the sticky header
              ended up clipping the first row's top half when the
              user scrolled past the dock group toggle. Keeping it
              static avoids the clipping; the dock toggle button
              still scrolls along to give the operator orientation. */}
          <div
            className="grid items-center gap-x-3 border-b border-hairline bg-surface-2 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
            style={{ gridTemplateColumns: WAITLIST_COLS }}
          >
            <button
              type="button"
              onClick={toggleAll}
              className="inline-flex size-4 items-center justify-center rounded border border-hairline bg-surface-1 hover:border-primary"
              aria-label={
                selectedIds.size === visible.length
                  ? "Deselect all"
                  : "Select all visible"
              }
            >
              {selectedIds.size === visible.length && visible.length > 0 && (
                <Check className="size-3 text-primary" />
              )}
            </button>
            <span>{tab === "queue" ? "Rank" : "Slip"}</span>
            <span>Wants</span>
            <span>Applicant</span>
            <span>Vessel</span>
            <span title="Current slip — set when this applicant is also a slip-holder upgrading to a better tier">
              Current
            </span>
            <span>Cadence</span>
            <span>
              {tab === "queue"
                ? "Match"
                : tab === "offers"
                  ? "Window"
                  : tab === "stale"
                    ? "Signal"
                    : "Reason"}
            </span>
            <span>Status</span>
            <span className="text-right">Action</span>
          </div>

          {/* Flat row list — same shape across all four tabs. The Dock
              filter at the top + the "Wants" column ("preferred dock")
              do the per-dock partitioning when the operator needs it.
              Rank counter is global so #1 = oldest applicant overall,
              not "oldest applicant per dock" (which would mislead). */}
          <ul className="divide-y divide-hairline">
            {tab === "queue"
              ? visible.map((entry, idx) => (
                  <WaitlistRow
                    key={entry.id}
                    entry={entry}
                    rank={idx + 1}
                    selected={selectedIds.has(entry.id)}
                    onToggle={() => toggleOne(entry.id)}
                    variant="queue"
                    onOpen={() => openProfileForEntry(entry.id)}
                    onFire={() => {
                      setPrefilledSlipId(undefined);
                      setFireOpen(true);
                    }}
                    onResend={() => undefined}
                    onLogCall={() => setLogCallEntryId(entry.id)}
                  />
                ))
              : visible.map((entry) => (
                <WaitlistRow
                  key={entry.id}
                  entry={entry}
                  rank={undefined}
                  selected={selectedIds.has(entry.id)}
                  onToggle={() => toggleOne(entry.id)}
                  variant={tab}
                  onOpen={() => openProfileForEntry(entry.id)}
                  onFire={() => {
                    setPrefilledSlipId(undefined);
                    setFireOpen(true);
                  }}
                  onResend={() => {
                    setPrefilledSlipId(entry.offered_slip_id);
                    setFireOpen(true);
                  }}
                  onLogCall={() => setLogCallEntryId(entry.id)}
                />
              ))}
          </ul>
        </div>
      )}

      <WaitlistFireOfferModal
        open={fireOpen}
        onOpenChange={setFireOpen}
        prefilledSlipId={prefilledSlipId}
      />

      {/* Log Call modal — primary surface for marina staff. Records
          phone-call outcome and (on accept) routes to slip onboarding
          via the existing waitlist applicant sheet. */}
      <WaitlistLogCallModal
        entry={logCallEntry}
        open={!!logCallEntry}
        onOpenChange={(next) => {
          if (!next) setLogCallEntryId(null);
        }}
        onAccepted={({ entryId }) => {
          // After "accept" is logged, route the operator to the
          // existing applicant sheet so they can pick the slip via
          // the convert-to-slip flow. The call log already has the
          // tentatively-accepted slip id stored; the sheet just gives
          // them the rich slip picker + wizard.
          setSelectedApplicantId(entryId);
        }}
      />

      {/* Applicant detail sheet — opens on row click. Owns the comms +
          confirm-interest + convert-to-slip flow. */}
      <WaitlistApplicantSheet
        entry={selectedEntry}
        open={selectedApplicantId !== null}
        onOpenChange={(next) => {
          if (!next) setSelectedApplicantId(null);
        }}
        onConvert={({ slipId, prefill, waitlistEntryId }) => {
          // Stage the wizard. We do NOT archive the waitlist entry
          // yet — only after the wizard successfully drafts a
          // contract (via onContractDrafted below) do we flip the
          // entry to got_slip. If the operator cancels, the entry
          // stays in the Queue.
          setSelectedApplicantId(null);
          setWizardArgs({ slipId, prefill, waitlistEntryId });
        }}
      />

      {/* AssignHolderWizard — opens after the operator picks a slip
          from the applicant sheet. Pre-fills the "Add a new member"
          sub-sheet with the applicant's contact info. Archive of the
          source waitlist entry waits until the wizard drafts a
          contract — see onContractDrafted. */}
      {wizardArgs && (
        <AssignHolderWizard
          slipId={wizardArgs.slipId}
          open
          onOpenChange={(open) => {
            if (!open) setWizardArgs(null);
          }}
          prefillNewMember={wizardArgs.prefill}
          onContractDrafted={() => {
            // Wizard fired through to a draft contract — safe to
            // archive the source waitlist entry now.
            archiveWaitlistEntries([wizardArgs.waitlistEntryId], "got_slip");
          }}
        />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────

/**
 * Unified waitlist row — one component renders all four tabs in the
 * same grid layout (same WAITLIST_COLS) so the visual language
 * matches the slip roster. Per-cell content branches on `variant`:
 *   - queue:  rank, match badges, Fire offer
 *   - offers: slip, countdown + applicant URL, Sim accept / Resend
 *   - stale:  slip (if any), stale signal (months no contact / N
 *             declines), no per-row action (operator works in
 *             bulk via the bulk action bar)
 *   - archive: slip (if any), archive reason + date, no action
 *
 * Action column collapses to "—" when there's no per-row action so
 * column alignment stays consistent across tabs.
 */
function WaitlistRow({
  entry,
  rank,
  selected,
  onToggle,
  variant,
  onOpen,
  onFire,
  onResend,
  onLogCall,
}: {
  entry: WaitlistEntry;
  rank?: number;
  selected: boolean;
  onToggle: () => void;
  variant: WaitlistTab;
  /**
   * Row click → boater profile. Interactive children (checkbox, action
   * buttons) stopPropagation so the row click doesn't double-fire.
   * Matches CLAUDE.md §6.1 pattern.
   */
  onOpen: () => void;
  onFire: () => void;
  onResend: () => void;
  /** Opens the Log Call modal for this entry. Primary action per
   *  Steven's phone-first flow — operators call applicants, log the
   *  outcome. */
  onLogCall: () => void;
}) {
  const boater = entry.boater_id
    ? BOATERS.find((b) => b.id === entry.boater_id)
    : undefined;
  const displayName =
    boater?.display_name ?? entry.guest_name ?? "Unknown applicant";
  const email = boater?.primary_contact?.email ?? entry.guest_email;

  // Match-quality chips — same idea as the legacy single-column view.
  const sizeFits = entry.loa_inches
    ? SLIPS.some((s) => s.max_loa_inches >= (entry.loa_inches ?? 0))
    : true;
  const classMatch = entry.preferred_dock
    ? SLIPS.some((s) => s.dock === entry.preferred_dock)
    : false;

  const lastContact = entry.last_contact_at;
  const ageDays = lastContact
    ? Math.floor((Date.now() - new Date(lastContact).getTime()) / 86_400_000)
    : null;

  // Live-tick the offer countdown chip without burning render budget.
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (variant !== "offers" || !entry.offer_expires_at) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [variant, entry.offer_expires_at]);
  const remaining = React.useMemo(() => {
    if (!entry.offer_expires_at) return null;
    const ms = new Date(entry.offer_expires_at).getTime() - Date.now();
    if (ms <= 0) return "expired";
    const hrs = Math.floor(ms / 3_600_000);
    if (hrs >= 24) return `${Math.floor(hrs / 24)}d ${hrs % 24}h left`;
    const mins = Math.floor((ms % 3_600_000) / 60_000);
    return `${hrs}h ${mins}m left`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.offer_expires_at, tick]);

  const offerTone = OFFER_TONE[entry.offer_status ?? "none"];

  // Status badge — varies per tab.
  const statusBadge = (() => {
    if (variant === "queue") {
      return (
        <Badge tone="neutral" size="sm">
          Waiting
        </Badge>
      );
    }
    if (variant === "offers") {
      return (
        <Badge tone={offerTone.tone} size="sm">
          {offerTone.label}
        </Badge>
      );
    }
    if (variant === "stale") {
      return (
        <Badge tone="warn" size="sm">
          Stale
        </Badge>
      );
    }
    // archive
    return (
      <Badge tone="neutral" size="sm">
        Archived
      </Badge>
    );
  })();

  return (
    <li
      className={cn(
        // min-h locks every row to the same height across every stage
        // (queue/offers/stale/archive). Queue's "Log call" button is
        // the tallest action element; we anchor to that height so
        // rows without actions don't render shorter. See CLAUDE.md
        // §"List-page UX consistency" rule #9 — uniform single-line
        // rows across every list page in the app.
        "group grid min-h-[45px] cursor-pointer items-center gap-x-3 px-3 py-2 text-[13px] transition-colors",
        selected ? "bg-primary/5" : "hover:bg-surface-2",
      )}
      style={{ gridTemplateColumns: WAITLIST_COLS }}
      onClick={onOpen}
    >
      {/* Checkbox — stopPropagation so toggling doesn't open the sheet. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="inline-flex size-4 items-center justify-center rounded border border-hairline bg-surface-1 hover:border-primary"
        aria-label={selected ? `Deselect ${displayName}` : `Select ${displayName}`}
      >
        {selected && <Check className="size-3 text-primary" />}
      </button>

      {/* Rank (queue) or offered Slip (offers) — mirrors the SLIP column on the roster */}
      <span className="font-mono text-[12px] font-medium text-fg">
        {variant === "queue" && rank !== undefined ? `#${rank}` : entry.offered_slip_id ?? "—"}
      </span>

      {/* Wants (preferred dock) — mirrors DOCK column on the roster */}
      <span className="truncate text-[12px] text-fg-subtle">
        {entry.preferred_dock ?? "any"}
      </span>

      {/* Applicant — mirrors MEMBER column on the roster. Single
          line; email goes to the `title` tooltip so row height stays
          consistent across every waitlist stage (queue/offers/stale/
          archive). See marina-stee/CLAUDE.md §"List-page UX
          consistency" rule #9 — secondary IDs never get a second line.
          Link stopPropagation so opening the member page doesn't also
          fire the sheet behind it. */}
      <div className="min-w-0" title={email ? `${displayName} · ${email}` : undefined}>
        {boater ? (
          <Link
            href={`/members/${boater.id}`}
            onClick={(e) => e.stopPropagation()}
            className="block truncate font-medium text-fg hover:text-primary"
          >
            {displayName}
          </Link>
        ) : (
          <span className="block truncate font-medium text-fg">{displayName}</span>
        )}
      </div>

      {/* Vessel — mirrors VESSEL column on the roster */}
      <span className="min-w-0 truncate text-fg-subtle">
        {entry.loa_inches
          ? `${formatInches(entry.loa_inches)} LOA`
          : "—"}
        {entry.beam_inches ? ` · ${formatInches(entry.beam_inches)} beam` : ""}
      </span>

      {/* Current slip — set when this applicant is also a slip-holder
          upgrading to a better tier. Cheap per-row lookup: the active
          reservation set is short and getCurrentReservation does the
          today-window check. */}
      <CurrentSlipCell entry={entry} />

      {/* Cadence — mirrors CADENCE column on the roster */}
      <span className="text-[12px] capitalize text-fg-subtle">
        {entry.reservation_type}
      </span>

      {/* Signal column — varies per tab. ONE badge / span per row;
          secondary signals collapse into the cell's `title` tooltip
          so row height stays consistent across every stage. See
          CLAUDE.md §"List-page UX consistency" rule #9. */}
      {(() => {
        // Queue: combine size-fits + dock-match into a single line.
        if (variant === "queue") {
          const matches: string[] = [];
          if (sizeFits) matches.push("size fits");
          if (classMatch) matches.push("dock match");
          if (matches.length === 0) {
            return <span className="truncate text-[11px] text-fg-tertiary">—</span>;
          }
          return (
            <div
              className="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden"
              title={matches.join(" · ")}
            >
              {sizeFits && (
                <Badge tone="ok" size="sm">
                  size fits
                </Badge>
              )}
              {classMatch && (
                <Badge tone="info" size="sm">
                  dock match
                </Badge>
              )}
            </div>
          );
        }
        // Offers: countdown OR responded-date (mutually exclusive states).
        if (variant === "offers") {
          if (entry.offer_status === "pending" && remaining) {
            return (
              <span className="inline-flex min-w-0 items-center gap-1 truncate text-[11px] text-status-warn tabular">
                <Clock className="size-3 shrink-0" />
                {remaining}
              </span>
            );
          }
          if (entry.offer_responded_at) {
            return (
              <span className="truncate text-[11px] text-fg-tertiary tabular">
                responded {new Date(entry.offer_responded_at).toLocaleDateString()}
              </span>
            );
          }
          return <span className="truncate text-[11px] text-fg-tertiary">—</span>;
        }
        // Stale: precedence — declines > never_contacted > months_silent.
        // Secondary signals go in title so the operator can see the full
        // picture on hover without breaking row height.
        if (variant === "stale") {
          const signals: string[] = [];
          if ((entry.decline_count ?? 0) >= STALE_DECLINE_COUNT) {
            signals.push(`${entry.decline_count} declines`);
          }
          if (!lastContact) {
            signals.push("never contacted");
          } else if (ageDays !== null && ageDays >= STALE_NO_CONTACT_DAYS) {
            signals.push(`${Math.round(ageDays / 30)} mo silent`);
          }
          if (signals.length === 0) {
            return <span className="truncate text-[11px] text-fg-tertiary">—</span>;
          }
          const primary = signals[0];
          const tone = primary.includes("decline") ? "danger" : "warn";
          return (
            <span title={signals.join(" · ")}>
              <Badge tone={tone} size="sm">
                {primary}
              </Badge>
            </span>
          );
        }
        // Archive: reason badge + date as inline secondary. Date moved
        // into the badge's title tooltip so the row stays single-line.
        if (variant === "archive") {
          if (entry.archive_reason) {
            const dateLabel = entry.archived_at
              ? new Date(entry.archived_at).toLocaleDateString()
              : undefined;
            const title = dateLabel
              ? `${archiveReasonLabel(entry.archive_reason)} · ${dateLabel}`
              : archiveReasonLabel(entry.archive_reason);
            return (
              <span title={title}>
                <Badge tone="neutral" size="sm">
                  {archiveReasonLabel(entry.archive_reason)}
                </Badge>
              </span>
            );
          }
          return <span className="truncate text-[11px] text-fg-tertiary">—</span>;
        }
        return null;
      })()}

      {/* Status badge */}
      <span>{statusBadge}</span>

      {/* Action — fixed-width column on the right edge mirrors how
          the slip roster reserves space for the row-level action.
          Each button stopPropagation so the row's onClick (open sheet)
          doesn't fire after the per-row action. */}
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {variant === "queue" && (
          <>
            {/* Primary action — Log a phone call. Records accept /
                decline_archive / decline_stay so the marina has a real
                paper trail of outreach without leaning on the parallel
                offer cascade. */}
            <Button variant="primary" size="sm" onClick={onLogCall}>
              <Phone className="size-3.5" />
              Log call
            </Button>
          </>
        )}
        {variant === "offers" && entry.offer_status === "pending" && entry.offer_token && (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (!entry.offer_token) return;
                acceptWaitlistOffer(entry.offer_token);
              }}
              title="Simulate the applicant hitting Accept"
            >
              Accept
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!entry.offer_token) return;
                declineWaitlistOffer(entry.offer_token, { auto_advance: true });
              }}
              title="Simulate the applicant hitting Decline + auto-advance"
            >
              <X className="size-3.5" />
            </Button>
          </>
        )}
        {variant === "offers" && entry.offer_status !== "pending" && (
          <Button variant="ghost" size="sm" onClick={onResend}>
            Resend
          </Button>
        )}
        {(variant === "stale" || variant === "archive") && (
          <span className="text-[11px] text-fg-tertiary">—</span>
        )}
      </div>
    </li>
  );
}

/**
 * Current slip cell — shows the slip the applicant currently holds, if
 * any. Empty for waitlist-only prospects (the common case). When set,
 * surfaces the "upgrading" pattern at a glance: "A29 → wants Covered".
 *
 * Renders as compact text (slip id + dock) so the column stays narrow.
 * Lives as its own component so the per-row reservation lookup +
 * boater context stays local — no need to thread current-slip state
 * down through WaitlistRow props.
 */
function CurrentSlipCell({ entry }: { entry: WaitlistEntry }) {
  // Guest entries (no boater) can't have a current slip.
  if (!entry.boater_id) {
    return <span className="text-[12px] text-fg-tertiary">—</span>;
  }
  const reservation = getCurrentReservation(entry.boater_id);
  const slipId = reservation?.slip_id;
  if (!slipId) {
    return <span className="text-[12px] text-fg-tertiary">—</span>;
  }
  const slip = SLIPS.find((s) => s.id === slipId);
  return (
    <span className="flex min-w-0 flex-col text-[12px] text-fg-subtle">
      <span className="font-medium text-fg tabular">{slipId}</span>
      {slip && (
        <span className="truncate text-[11px] text-fg-tertiary">
          {slip.dock}
        </span>
      )}
    </span>
  );
}

function archiveReasonLabel(r: NonNullable<WaitlistEntry["archive_reason"]>): string {
  switch (r) {
    case "got_slip":
      return "Got slip";
    case "withdrew":
      return "Withdrew";
    case "aged_out":
      return "Aged out";
    case "non_responder":
      return "Non-responder";
    case "too_many_declines":
      return "Too many declines";
    case "duplicate":
      return "Duplicate";
  }
}
