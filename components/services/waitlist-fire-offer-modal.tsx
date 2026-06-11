"use client";

import * as React from "react";
import { Megaphone, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { BOATERS, SLIPS, formatInches } from "@/lib/mock-data";
import { fireWaitlistOffer, useWaitlist } from "@/lib/client-store";
import type { WaitlistEntry } from "@/lib/types";

/*
 * Waitlist auto-offer cascade — operator wizard.
 *
 *   Step 1: Pick the slip that just became available
 *   Step 2: Top N candidates pre-selected from waitlist filtered by slip
 *            size + already-pending dedup. Operator can deselect.
 *   Step 3: Preview offer copy + expiry (48h default, configurable)
 *   Step 4: Confirm → mints N offer_tokens + dispatches comms in one batch
 *
 * Wizard state is intentionally local — no router push, no URL state. The
 * fire happens via lib/client-store fireWaitlistOffer (which dispatches
 * audit log + comms in one pass) and the parent surface re-renders the
 * Active Offers panel automatically via useWaitlist.
 */

const DEFAULT_TOP_N = 3;
const DEFAULT_EXPIRES_HOURS = 48;

export function WaitlistFireOfferModal({
  open,
  onOpenChange,
  prefilledSlipId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefilledSlipId?: string;
}) {
  const entries = useWaitlist();
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [slipId, setSlipId] = React.useState(prefilledSlipId ?? "");
  const [topN, setTopN] = React.useState(DEFAULT_TOP_N);
  const [expiresHours, setExpiresHours] = React.useState(DEFAULT_EXPIRES_HOURS);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [confirming, setConfirming] = React.useState(false);

  // Reset wizard when reopened.
  React.useEffect(() => {
    if (!open) return;
    setStep(1);
    setSlipId(prefilledSlipId ?? "");
    setTopN(DEFAULT_TOP_N);
    setExpiresHours(DEFAULT_EXPIRES_HOURS);
    setSelectedIds(new Set());
    setConfirming(false);
  }, [open, prefilledSlipId]);

  const slip = React.useMemo(
    () => SLIPS.find((s) => s.id === slipId),
    [slipId],
  );

  // Eligible candidates: pending entries whose size fits + no active
  // offer already pending. Sorted oldest-first so the queue is fair.
  const eligible = React.useMemo(() => {
    if (!slip) return [];
    return entries
      .filter((e) => e.status === "pending")
      .filter((e) => (e.offer_status ?? "none") !== "pending")
      .filter((e) => !e.loa_inches || e.loa_inches <= slip.max_loa_inches)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [entries, slip]);

  // Pre-select the top N on first arrival at step 2.
  React.useEffect(() => {
    if (step !== 2 || !slip || eligible.length === 0) return;
    if (selectedIds.size > 0) return;
    setSelectedIds(new Set(eligible.slice(0, topN).map((e) => e.id)));
  }, [step, slip, eligible, topN, selectedIds.size]);

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function confirm() {
    if (!slipId || selectedIds.size === 0) return;
    setConfirming(true);
    fireWaitlistOffer({
      slip_id: slipId,
      entry_ids: [...selectedIds],
      expires_hours: expiresHours,
    });
    onOpenChange(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-[640px] flex-col overflow-hidden rounded-[16px] border border-hairline bg-surface-1 shadow-xl">
        <header className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Megaphone className="size-4 text-status-info" />
            <h2 className="text-[14px] font-semibold text-fg">
              Fire waitlist offer
            </h2>
            <Badge tone="info" size="sm">
              Step {step} of 3
            </Badge>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-[6px] p-1 text-fg-tertiary hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {step === 1 && (
            <Step1
              slipId={slipId}
              setSlipId={setSlipId}
              topN={topN}
              setTopN={setTopN}
              expiresHours={expiresHours}
              setExpiresHours={setExpiresHours}
            />
          )}
          {step === 2 && slip && (
            <Step2
              slip={slip}
              eligible={eligible}
              selectedIds={selectedIds}
              toggle={toggle}
            />
          )}
          {step === 3 && slip && (
            <Step3
              slip={slip}
              selectedIds={selectedIds}
              eligible={eligible}
              expiresHours={expiresHours}
            />
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-hairline bg-surface-2/40 px-5 py-3">
          <div className="text-[12px] text-fg-tertiary">
            {step === 1 && "Pick a slip and target cohort size."}
            {step === 2 && `${selectedIds.size} candidate${selectedIds.size === 1 ? "" : "s"} selected.`}
            {step === 3 && "Review and confirm — comms dispatch on confirm."}
          </div>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
              >
                Back
              </Button>
            )}
            {step < 3 && (
              <Button
                variant="primary"
                size="sm"
                disabled={step === 1 ? !slipId : selectedIds.size === 0}
                onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
              >
                Next
              </Button>
            )}
            {step === 3 && (
              <Button
                variant="primary"
                size="sm"
                disabled={confirming || selectedIds.size === 0}
                onClick={confirm}
              >
                <Sparkles className="size-3.5" />
                Fire {selectedIds.size} offer{selectedIds.size === 1 ? "" : "s"}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

function Step1({
  slipId,
  setSlipId,
  topN,
  setTopN,
  expiresHours,
  setExpiresHours,
}: {
  slipId: string;
  setSlipId: (v: string) => void;
  topN: number;
  setTopN: (v: number) => void;
  expiresHours: number;
  setExpiresHours: (v: number) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 text-[12px] font-medium text-fg">
          Freed slip
        </div>
        {/* SLIPS list grows with marina size — per CLAUDE.md §6.3 lists
            with > 5 options must be a search-as-you-type combobox so the
            operator can type "A12" instead of scrolling. */}
        <Combobox
          value={slipId}
          onChange={setSlipId}
          options={SLIPS.map((s) => ({
            value: s.id,
            label: `${s.id} — ${s.dock}`,
            hint: `· ${formatInches(s.max_loa_inches)} max`,
          }))}
          placeholder="Pick the slip that just opened…"
          searchPlaceholder="Search by slip, dock…"
        />
        <p className="mt-1 text-[11px] text-fg-tertiary">
          Contract terminated, reservation cancelled, no-show — any of these
          free the slip up for the cascade.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <div className="mb-1.5 text-[12px] font-medium text-fg">
            Target cohort size
          </div>
          <select
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
            className="h-9 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[13px] text-fg focus:border-hairline-strong focus:outline-none"
          >
            {[1, 2, 3, 5, 10].map((n) => (
              <option key={n} value={n}>
                Top {n}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <div className="mb-1.5 text-[12px] font-medium text-fg">
            Expiry window
          </div>
          <select
            value={expiresHours}
            onChange={(e) => setExpiresHours(Number(e.target.value))}
            className="h-9 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[13px] text-fg focus:border-hairline-strong focus:outline-none"
          >
            <option value={24}>24 hours</option>
            <option value={48}>48 hours</option>
            <option value={72}>72 hours</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function Step2({
  slip,
  eligible,
  selectedIds,
  toggle,
}: {
  slip: { id: string; dock: string; max_loa_inches: number };
  eligible: WaitlistEntry[];
  selectedIds: Set<string>;
  toggle: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[12px] text-fg-subtle">
        Eligible for slip <span className="font-medium text-fg">{slip.id}</span>{" "}
        ({slip.dock} · up to {formatInches(slip.max_loa_inches)}). Filtered by
        vessel size + no active offer pending.
      </div>
      {eligible.length === 0 && (
        <div className="rounded-[8px] border border-dashed border-hairline px-3 py-6 text-center text-[12px] text-fg-tertiary">
          No eligible waitlisters. Nobody's in the queue who fits this slip
          right now.
        </div>
      )}
      <ul className="space-y-1.5">
        {eligible.map((e) => {
          const boater = e.boater_id
            ? BOATERS.find((b) => b.id === e.boater_id)
            : undefined;
          const displayName =
            boater?.display_name ?? e.guest_name ?? "Unknown applicant";
          const selected = selectedIds.has(e.id);
          return (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => toggle(e.id)}
                className={
                  "flex w-full items-center justify-between gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors " +
                  (selected
                    ? "border-primary/40 bg-primary-soft/40"
                    : "border-hairline bg-surface-2 hover:bg-surface-2/80")
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-medium text-fg">
                      {displayName}
                    </span>
                    <Badge tone="outline" size="sm">
                      {e.reservation_type}
                    </Badge>
                    {e.loa_inches && (
                      <span className="text-[11px] text-fg-tertiary">
                        {formatInches(e.loa_inches)} LOA
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-fg-tertiary">
                    Joined queue {new Date(e.created_at).toLocaleDateString()}
                    {e.preferred_dock ? ` · prefers ${e.preferred_dock}` : ""}
                  </div>
                </div>
                <div
                  className={
                    "size-4 shrink-0 rounded-[4px] border " +
                    (selected
                      ? "border-primary bg-primary"
                      : "border-hairline-strong bg-surface-1")
                  }
                  aria-hidden
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Step3({
  slip,
  selectedIds,
  eligible,
  expiresHours,
}: {
  slip: { id: string; dock: string; max_loa_inches: number };
  selectedIds: Set<string>;
  eligible: WaitlistEntry[];
  expiresHours: number;
}) {
  const selected = eligible.filter((e) => selectedIds.has(e.id));
  const expiresAt = new Date(Date.now() + expiresHours * 3_600_000);
  return (
    <div className="space-y-3">
      <div className="rounded-[10px] border border-hairline bg-surface-2 px-4 py-3">
        <div className="text-[11px] uppercase tracking-wider text-fg-tertiary">
          Outbound copy preview
        </div>
        <div className="mt-1 text-[13px] text-fg">
          Subject: A slip just opened — slip {slip.id}
        </div>
        <pre className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-fg-muted">
{`Hi {{first_name}},

A slip just opened up at the marina that matches your waitlist request:

  Slip:       ${slip.id}
  Dock:       ${slip.dock}
  Max LOA:    ${Math.round(slip.max_loa_inches / 12)}'

Accept or decline within ${expiresHours} hours:
/apply/waitlist/{{offer_token}}

If we don't hear back, we'll roll the offer to the next person in line.

Marina Stee`}
        </pre>
      </div>
      <div className="rounded-[10px] border border-hairline bg-surface-2 px-4 py-3">
        <div className="text-[11px] uppercase tracking-wider text-fg-tertiary">
          Recipients ({selected.length})
        </div>
        <ul className="mt-1.5 space-y-1">
          {selected.map((e) => {
            const boater = e.boater_id
              ? BOATERS.find((b) => b.id === e.boater_id)
              : undefined;
            const displayName =
              boater?.display_name ?? e.guest_name ?? "Unknown";
            const channel =
              boater?.communication_prefs.preferred_channel ??
              (e.guest_email ? "email" : "sms");
            return (
              <li
                key={e.id}
                className="flex items-center justify-between text-[12px] text-fg"
              >
                <span>{displayName}</span>
                <Badge tone="outline" size="sm">
                  via {channel}
                </Badge>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="text-[11px] text-fg-tertiary">
        Window closes{" "}
        <span className="text-fg-muted">{expiresAt.toLocaleString()}</span>.
        Any offers that lapse roll to the next eligible waitlister on this
        slip.
      </div>
    </div>
  );
}
