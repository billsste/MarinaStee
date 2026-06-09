"use client";

import * as React from "react";
import {
  Anchor,
  Archive,
  ArrowRight,
  Check,
  Mail,
  MessageSquare,
  Phone,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BOATERS,
  SLIPS,
  formatInches,
  formatMoney,
} from "@/lib/mock-data";
import {
  addCommunication,
  archiveWaitlistEntries,
  confirmWaitlistInterest,
  logAuditLocal,
  stampWaitlistContact,
  updateWaitlistEntry,
  useCommunicationsForBoater,
  useSlipStatus,
  useSlips,
} from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";
import { useCurrentUser } from "@/lib/auth";
import type { WaitlistEntry } from "@/lib/types";
import {
  capitalize,
  cn,
  formatPhone,
  formatPhoneInput,
  phoneDigitCount,
} from "@/lib/utils";

/*
 * WaitlistApplicantSheet — operator-facing detail view that opens when
 * a waitlist row is clicked. Replaces the previous "no row affordance"
 * gap so the waitlist matches the click-to-edit pattern the rest of
 * the app uses.
 *
 * Why a sheet, not inline edit
 * ────────────────────────────
 * Inline edit (per CLAUDE.md §6.1) is the default for simple tabular
 * data. Waitlist applicants aren't simple — onboarding one is a
 * multi-step workflow (reach out → confirm interest → pick a slip →
 * convert). Cramming that into an expanded row would either lose
 * affordances (comms thread, slip picker) or overflow the row height.
 *
 * The sheet is the right pattern for "open a record that has its own
 * workflow." It mirrors ContractPreviewSheet — same two-column layout
 * (content left, action sidebar right), same full-screen overlay.
 *
 * The "reach out first" requirement
 * ──────────────────────────────────
 * Steven's mandate: operators must confirm the applicant still wants
 * the slip BEFORE the wizard fires. We gate "Convert to slip holder"
 * on `interest_confirmed_at` — set explicitly via the "Mark interest
 * confirmed" button after the operator has talked to (or messaged with)
 * the applicant. The Fire-offer cascade is a separate path and isn't
 * gated this way; cascade-fired offers already have their own back-and-
 * forth via /apply/waitlist/[token].
 */

const QUICK_TEMPLATES: Array<{
  id: string;
  label: string;
  subject?: string;
  body: (a: ApplicantContext) => string;
}> = [
  {
    id: "confirm_interest",
    label: "Still interested?",
    subject: "Quick check-in from the marina",
    body: (a) =>
      `Hi ${a.firstName},\n\nA slip is opening up that may fit what you were looking for (${a.lengthLabel}, ${a.dockPref}). Are you still interested in moving forward?\n\nReply here or give us a call — we'll hold off the cascade until we hear back.\n\nThanks,\n${a.marinaName}`,
  },
  {
    id: "slip_ready",
    label: "Slip ready",
    subject: "Your slip is ready",
    body: (a) =>
      `Hi ${a.firstName},\n\nGood news — we have a slip ready for you. I'll send the onboarding paperwork over once you confirm.\n\n— ${a.marinaName}`,
  },
  {
    id: "deferred_followup",
    label: "Following up",
    subject: "Checking back in",
    body: (a) =>
      `Hi ${a.firstName},\n\nFollowing up on the waitlist — are you still looking for a slip this season? Just want to make sure we keep your spot accurate.\n\n— ${a.marinaName}`,
  },
];

type ApplicantContext = {
  firstName: string;
  lengthLabel: string;
  dockPref: string;
  marinaName: string;
};

export function WaitlistApplicantSheet({
  entry,
  open,
  onOpenChange,
  onConvert,
}: {
  entry: WaitlistEntry | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /**
   * Called when the operator picks a slip to convert this applicant
   * into. Parent owns the AssignHolderWizard and uses these args to
   * mount it pre-filled with the applicant. Sheet closes itself before
   * firing the callback so there's no overlap with the wizard modal.
   */
  onConvert: (args: {
    slipId: string;
    prefill: {
      first_name: string;
      last_name: string;
      email?: string;
      phone?: string;
    };
    waitlistEntryId: string;
  }) => void;
}) {
  // Bail BEFORE subscribing to store slices — otherwise the closed
  // sheet still re-renders on every slip / contract / comm mutation,
  // which on the waitlist page is the busiest store in the app. The
  // Inner component owns the hooks now.
  if (!open || !entry) return null;
  return (
    <WaitlistApplicantSheetInner
      key={entry.id}
      entry={entry}
      onClose={() => onOpenChange(false)}
      onConvert={onConvert}
    />
  );
}

function WaitlistApplicantSheetInner({
  entry,
  onClose,
  onConvert,
}: {
  entry: WaitlistEntry;
  onClose: () => void;
  onConvert: (args: {
    slipId: string;
    prefill: { first_name: string; last_name: string; email?: string; phone?: string };
    waitlistEntryId: string;
  }) => void;
}) {
  // Store subscriptions live here (below the parent's open/entry gate)
  // so a closed sheet doesn't re-render on every store mutation.
  const boater = entry.boater_id
    ? BOATERS.find((b) => b.id === entry.boater_id)
    : undefined;
  const comms = useCommunicationsForBoater(entry.boater_id ?? "_none_");
  const slips = useSlips();
  // useSlipStatus = canonical "is this slip taken" derivation. Same
  // hook the agent's occupancy report consumes — no more divergent
  // local copies (sheet used to exclude only 'terminated', report
  // used the broader terminal set; this hook is the truth).
  const { occupiedSlipIds } = useSlipStatus();
  const currentUser = useCurrentUser();

  // Display name + applicant context — guest-mode applicants don't
  // have a boater row, so fall back to splitName on the raw guest
  // string. When a boater exists, prefer the structured fields so
  // "Last, First" / hyphenated names don't get mangled by splitName.
  const displayName =
    boater?.display_name ??
    entry.guest_name ??
    "Unknown applicant";
  const [guestFirst, guestLast] = splitName(entry.guest_name ?? "");
  const firstName = boater?.first_name ?? guestFirst;
  const lastName = boater?.last_name ?? guestLast;
  const email = boater?.primary_contact?.email ?? entry.guest_email ?? "";
  const phone = boater?.primary_contact?.phone ?? entry.guest_phone ?? "";

  // ── Inline-edit state — one field at a time, Enter to save, Esc
  //    to cancel. Matches CLAUDE.md §6.1 pattern.
  const [editingField, setEditingField] = React.useState<EditField | null>(null);

  // ── Composer state (collapsed by default; opens when the operator
  //    clicks Send message or picks a template).
  const [composerOpen, setComposerOpen] = React.useState(false);
  const [composerChannel, setComposerChannel] = React.useState<"sms" | "email">(
    "email",
  );
  const [composerSubject, setComposerSubject] = React.useState("");
  const [composerBody, setComposerBody] = React.useState("");
  function applyTemplate(t: (typeof QUICK_TEMPLATES)[number]) {
    setComposerOpen(true);
    setComposerChannel(email ? "email" : "sms");
    setComposerSubject(t.subject ?? "");
    setComposerBody(
      t.body({
        firstName: firstName || "there",
        lengthLabel: entry.loa_inches
          ? `${formatInches(entry.loa_inches)} LOA`
          : "your size",
        dockPref: entry.preferred_dock ?? "any dock",
        marinaName: "Marina Stee",
      }),
    );
  }

  function sendComposer() {
    if (!composerBody.trim()) return;

    if (boater) {
      // Member applicant — route through the standard send_message
      // executor so the comm picks up the full pipeline: audit log,
      // RBAC gate, real-provider dispatch (Twilio/Postmark when env
      // vars are set), and the Convex mutation when the migration
      // lands. Without this, waitlist-sheet messages would be the
      // only operator comms invisible to the audit trail.
      executeAgentAction(
        {
          kind: "send_message",
          label: `Send ${composerChannel.toUpperCase()} to ${boater.display_name}`,
          boater_id: boater.id,
          type: composerChannel,
          subject: composerSubject || undefined,
          body: composerBody,
        },
        currentUser.role,
      );
    } else {
      // Guest applicant — no boater row to look up, so the standard
      // send_message executor would silently drop. Write the
      // Communication directly AND log an audit row so the trail is
      // complete. When the guest converts to a member, future comms
      // route through the standard path.
      const id = `cm_wl_${Date.now()}`;
      addCommunication({
        id,
        boater_id: `guest_${entry.id}`,
        type: composerChannel,
        direction: "outbound",
        subject: composerSubject || undefined,
        body_preview: composerBody.slice(0, 80),
        full_body: composerBody,
        sender_label: "Operator",
        sender_is_system: false,
        recipient:
          composerChannel === "email" ? email || "—" : phone || "—",
        sent_at: new Date().toISOString(),
        status: "delivered",
      });
      logAuditLocal({
        actor_user_id: "u_current",
        actor_label: "Operator",
        action_type: "waitlist.guest_message",
        target_entity: "waitlist_entry",
        target_id: entry.id,
        payload_delta: JSON.stringify({
          channel: composerChannel,
          subject: composerSubject || null,
          body_length: composerBody.length,
        }),
      });
    }

    // Stamp last_contact_at so the entry leaves the Stale tab
    // automatically. Explicit method (not a side effect of update).
    stampWaitlistContact(entry.id);
    setComposerOpen(false);
    setComposerBody("");
    setComposerSubject("");
  }

  // ── Confirm-interest state ──
  // Plain string (no null sentinel) — the textbox never has a "not yet
  // typed in" state distinct from empty. clearConfirmation passes a
  // literal null to the store helper to unflip the confirmation; that
  // null is a different semantic (NOT the same as empty-string), so
  // the helper signature still takes string | null.
  const [confirmingNote, setConfirmingNote] = React.useState("");
  function confirmInterest() {
    confirmWaitlistInterest(entry.id, confirmingNote);
    setConfirmingNote("");
  }
  function clearConfirmation() {
    confirmWaitlistInterest(entry.id, null);
  }

  // ── Slip picker for the convert step. Filters to vacant slips
  //    matching the applicant's preferred dock + LOA. Operator can
  //    expand to "all vacant" if their preference is overly narrow. ──
  const [picking, setPicking] = React.useState(false);
  const [showAllSlips, setShowAllSlips] = React.useState(false);
  // occupiedSlipIds comes from useSlipStatus() above — the canonical
  // derivation, shared with the agent's occupancy report so both
  // surfaces agree on what counts as "taken."

  const eligibleSlips = React.useMemo(() => {
    return slips
      .filter((s) => {
        if (occupiedSlipIds.has(s.id)) return false;
        if (showAllSlips) return true;
        if (entry.preferred_dock && s.dock !== entry.preferred_dock) return false;
        if (entry.loa_inches && s.max_loa_inches < entry.loa_inches) return false;
        return true;
      })
      .slice(0, 50);
  }, [slips, occupiedSlipIds, entry.preferred_dock, entry.loa_inches, showAllSlips]);

  function pickSlip(slipId: string) {
    // DON'T archive yet — the operator can still cancel the wizard
    // mid-flow. Archive happens at the parent level when the wizard
    // successfully drafts a contract (onContractDrafted callback in
    // waitlist-section.tsx). If the operator hits Exit before that,
    // the waitlist entry stays in the Queue tab.
    onClose();
    onConvert({
      slipId,
      prefill: {
        first_name: firstName || "",
        last_name: lastName || "",
        email: email || undefined,
        phone: phone || undefined,
      },
      waitlistEntryId: entry.id,
    });
  }

  // ── Archive path ──
  function archive(reason: "withdrew" | "non_responder") {
    archiveWaitlistEntries([entry.id], reason);
    onClose();
  }

  const confirmed = !!entry.interest_confirmed_at;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Waitlist applicant"
      className="fixed inset-0 z-50 flex bg-surface-1/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="m-auto flex h-[88vh] w-full max-w-[1200px] flex-col overflow-hidden rounded-[14px] border border-hairline bg-surface-1 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <div className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
              Waitlist applicant
            </div>
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[16px] font-semibold text-fg">
                {displayName}
              </h2>
              {confirmed ? (
                <Badge tone="ok" size="sm">
                  <Check className="size-3" />
                  Interest confirmed
                </Badge>
              ) : (
                <Badge tone="neutral" size="sm">
                  Awaiting confirmation
                </Badge>
              )}
            </div>
            <div className="mt-0.5 text-[12px] text-fg-subtle">
              Applied{" "}
              {new Date(entry.created_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
              {entry.last_contact_at && (
                <>
                  {" · "}
                  Last contact{" "}
                  {new Date(entry.last_contact_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </>
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        {/* Body — left column scrolls; right rail stays put. */}
        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1fr_320px]">
          <div className="min-h-0 overflow-y-auto px-4 py-4">
            {/* Applicant info card */}
            <section className="rounded-[10px] border border-hairline bg-surface-2/40 p-3">
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-fg-subtle">
                Applicant
              </h3>
              <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
                <EditableField
                  label="Email"
                  value={email}
                  type="email"
                  editing={editingField === "email"}
                  onStartEdit={() => setEditingField("email")}
                  onCancel={() => setEditingField(null)}
                  onSave={(v) => {
                    updateWaitlistEntry(entry.id, { guest_email: v.trim() || undefined });
                    setEditingField(null);
                  }}
                  icon={<Mail className="size-3" />}
                />
                <EditableField
                  label="Phone"
                  value={phone ? formatPhone(phone) : ""}
                  type="tel"
                  editing={editingField === "phone"}
                  onStartEdit={() => setEditingField("phone")}
                  onCancel={() => setEditingField(null)}
                  onSave={(v) => {
                    if (v && phoneDigitCount(v) !== 10) return; // silent — keep editing
                    updateWaitlistEntry(entry.id, { guest_phone: v.trim() || undefined });
                    setEditingField(null);
                  }}
                  formatInput={formatPhoneInput}
                  icon={<Phone className="size-3" />}
                />
                <EditableField
                  label="Preferred dock"
                  value={entry.preferred_dock ?? ""}
                  type="text"
                  editing={editingField === "dock"}
                  onStartEdit={() => setEditingField("dock")}
                  onCancel={() => setEditingField(null)}
                  onSave={(v) => {
                    updateWaitlistEntry(entry.id, { preferred_dock: v.trim() || undefined });
                    setEditingField(null);
                  }}
                  icon={<Anchor className="size-3" />}
                />
                <ReadonlyField
                  label="Cadence"
                  value={capitalize(entry.reservation_type)}
                />
                <EditableField
                  label="LOA (inches)"
                  value={String(entry.loa_inches ?? "")}
                  type="numeric"
                  editing={editingField === "loa"}
                  onStartEdit={() => setEditingField("loa")}
                  onCancel={() => setEditingField(null)}
                  onSave={(v) => {
                    const n = parseInt(v, 10);
                    updateWaitlistEntry(entry.id, {
                      loa_inches: Number.isFinite(n) ? n : undefined,
                    });
                    setEditingField(null);
                  }}
                />
                <EditableField
                  label="Beam (inches)"
                  value={String(entry.beam_inches ?? "")}
                  type="numeric"
                  editing={editingField === "beam"}
                  onStartEdit={() => setEditingField("beam")}
                  onCancel={() => setEditingField(null)}
                  onSave={(v) => {
                    const n = parseInt(v, 10);
                    updateWaitlistEntry(entry.id, {
                      beam_inches: Number.isFinite(n) ? n : undefined,
                    });
                    setEditingField(null);
                  }}
                />
              </dl>

              <div className="mt-3">
                <EditableField
                  label="Notes"
                  value={entry.notes ?? ""}
                  type="textarea"
                  editing={editingField === "notes"}
                  onStartEdit={() => setEditingField("notes")}
                  onCancel={() => setEditingField(null)}
                  onSave={(v) => {
                    updateWaitlistEntry(entry.id, { notes: v.trim() || undefined });
                    setEditingField(null);
                  }}
                />
              </div>
            </section>

            {/* Comms thread */}
            <section className="mt-4 rounded-[10px] border border-hairline bg-surface-2/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-fg-subtle">
                  Communications
                </h3>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setComposerOpen((v) => !v)}
                >
                  <MessageSquare className="size-3.5" />
                  {composerOpen ? "Close composer" : "New message"}
                </Button>
              </div>

              {/* Quick templates */}
              <div className="mb-3 flex flex-wrap gap-1.5">
                {QUICK_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => applyTemplate(t)}
                    className="inline-flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-subtle transition-colors hover:border-primary/40 hover:text-fg"
                  >
                    <Sparkles className="size-3 text-primary" />
                    {t.label}
                  </button>
                ))}
              </div>

              {composerOpen && (
                <div className="mb-3 rounded-[8px] border border-primary/30 bg-primary-soft/30 p-2.5">
                  <div className="mb-2 flex items-center gap-2 text-[11px]">
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="radio"
                        checked={composerChannel === "email"}
                        onChange={() => setComposerChannel("email")}
                      />
                      Email
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="radio"
                        checked={composerChannel === "sms"}
                        onChange={() => setComposerChannel("sms")}
                      />
                      SMS
                    </label>
                    <span className="text-fg-tertiary">
                      to{" "}
                      {composerChannel === "email" ? email || "—" : formatPhone(phone) || "—"}
                    </span>
                  </div>
                  {composerChannel === "email" && (
                    <input
                      type="text"
                      placeholder="Subject"
                      value={composerSubject}
                      onChange={(e) => setComposerSubject(e.target.value)}
                      className="mb-1.5 w-full rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[12px] text-fg outline-none focus:border-primary"
                    />
                  )}
                  <textarea
                    rows={5}
                    placeholder="Write a message…"
                    value={composerBody}
                    onChange={(e) => setComposerBody(e.target.value)}
                    className="w-full rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[12px] text-fg outline-none focus:border-primary"
                  />
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setComposerOpen(false);
                        setComposerBody("");
                        setComposerSubject("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={sendComposer}
                      disabled={!composerBody.trim()}
                    >
                      <Send className="size-3.5" />
                      Send {composerChannel.toUpperCase()}
                    </Button>
                  </div>
                </div>
              )}

              {/* Recent thread (newest first, last 8). */}
              {comms.length === 0 ? (
                <p className="text-[12px] text-fg-tertiary">
                  No messages yet. Use a template above or write a custom one to reach out.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {comms.slice(0, 8).map((c) => (
                    <li
                      key={c.id}
                      className="rounded-[6px] border border-hairline bg-surface-1 p-2 text-[12px]"
                    >
                      <div className="mb-0.5 flex items-center justify-between text-[10.5px] text-fg-tertiary">
                        <span className="inline-flex items-center gap-1">
                          <Badge
                            tone={c.direction === "inbound" ? "info" : "neutral"}
                            size="sm"
                          >
                            {c.direction === "inbound" ? "in" : "out"}
                          </Badge>
                          <span className="uppercase">{c.type}</span>
                          {c.subject && <span>· {c.subject}</span>}
                        </span>
                        <span>{new Date(c.sent_at).toLocaleString()}</span>
                      </div>
                      <p className="line-clamp-3 text-fg-subtle">
                        {c.body_preview ?? c.full_body ?? "(empty)"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Slip picker (only when picking) */}
            {picking && (
              <section className="mt-4 rounded-[10px] border border-primary/30 bg-primary-soft/20 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[12px] font-semibold uppercase tracking-wide text-fg-subtle">
                    Pick a slip
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowAllSlips((v) => !v)}
                    className="text-[11px] text-primary hover:underline"
                  >
                    {showAllSlips ? "Match preferences only" : "Show all vacant"}
                  </button>
                </div>
                {eligibleSlips.length === 0 ? (
                  <p className="text-[12px] text-fg-subtle">
                    No vacant slips match. Try "Show all vacant" to expand the list.
                  </p>
                ) : (
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {eligibleSlips.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => pickSlip(s.id)}
                          className="flex w-full items-center justify-between gap-2 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1.5 text-left text-[12px] transition-colors hover:border-primary hover:bg-surface-2"
                        >
                          <span className="font-mono font-medium text-fg">
                            {s.number}
                          </span>
                          <span className="truncate text-fg-subtle">
                            {s.dock} · {formatInches(s.max_loa_inches)} max
                          </span>
                          <span className="text-fg-tertiary tabular">
                            {formatMoney(s.default_annual_rate ?? 0)}/yr
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setPicking(false)}>
                    Cancel
                  </Button>
                </div>
              </section>
            )}
          </div>

          {/* Right rail — action steps */}
          <aside className="flex flex-col gap-3 overflow-y-auto border-t border-hairline bg-surface-2/20 p-4 lg:border-l lg:border-t-0">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
                Step 1
              </div>
              <div className="text-[13px] font-medium text-fg">Reach out</div>
              <p className="mt-1 text-[12px] text-fg-subtle">
                Send a message or pick a template above. Stamp last contact
                so the row leaves Stale.
              </p>
            </div>

            <div className="rounded-[8px] border border-hairline bg-surface-1 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
                Step 2
              </div>
              <div className="text-[13px] font-medium text-fg">
                Mark interest confirmed
              </div>
              {confirmed ? (
                <div className="mt-2">
                  <Badge tone="ok" size="sm">
                    <Check className="size-3" />
                    Confirmed{" "}
                    {entry.interest_confirmed_at
                      ? new Date(entry.interest_confirmed_at).toLocaleDateString()
                      : ""}
                  </Badge>
                  {entry.interest_confirmation_note && (
                    <p className="mt-1 text-[11.5px] italic text-fg-subtle">
                      "{entry.interest_confirmation_note}"
                    </p>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearConfirmation}
                    className="mt-2"
                  >
                    Undo confirmation
                  </Button>
                </div>
              ) : (
                <div className="mt-2">
                  <p className="mb-1.5 text-[12px] text-fg-subtle">
                    Flip this AFTER you've heard back. Optional note about
                    how you confirmed.
                  </p>
                  <input
                    type="text"
                    placeholder="e.g. spoke 2pm, ready to move"
                    value={confirmingNote}
                    onChange={(e) => setConfirmingNote(e.target.value)}
                    className="mb-1.5 w-full rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[12px] text-fg outline-none focus:border-primary"
                  />
                  <Button variant="secondary" size="sm" onClick={confirmInterest}>
                    <Check className="size-3.5" />
                    Mark confirmed
                  </Button>
                </div>
              )}
            </div>

            <div
              className={cn(
                "rounded-[8px] border p-3",
                confirmed
                  ? "border-primary/40 bg-primary-soft/30"
                  : "border-hairline bg-surface-1 opacity-70",
              )}
            >
              <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
                Step 3
              </div>
              <div className="text-[13px] font-medium text-fg">
                Convert to slip holder
              </div>
              {!confirmed && (
                <p className="mt-1 text-[12px] text-fg-subtle">
                  Locked until interest is confirmed. Talk to the applicant
                  first, then flip Step 2.
                </p>
              )}
              {confirmed && !picking && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setPicking(true)}
                  className="mt-2 w-full"
                >
                  Pick a slip → open wizard
                  <ArrowRight className="size-3.5" />
                </Button>
              )}
              {confirmed && picking && (
                <p className="mt-2 text-[12px] text-fg-subtle">
                  Pick from the slip list on the left.
                </p>
              )}
            </div>

            <div className="mt-auto rounded-[8px] border border-hairline bg-surface-1 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
                Otherwise
              </div>
              <div className="text-[13px] font-medium text-fg">Archive</div>
              <p className="mt-1 text-[12px] text-fg-subtle">
                Use when the applicant withdrew or hasn't responded after
                multiple attempts.
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => archive("withdrew")}
                >
                  <Archive className="size-3.5" />
                  Withdrew
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => archive("non_responder")}
                >
                  <Archive className="size-3.5" />
                  Non-responder
                </Button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

type EditField = "email" | "phone" | "dock" | "loa" | "beam" | "notes";

function EditableField({
  label,
  value,
  type,
  editing,
  onStartEdit,
  onCancel,
  onSave,
  formatInput,
  icon,
}: {
  label: string;
  value: string;
  type: "email" | "tel" | "text" | "numeric" | "textarea";
  editing: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (v: string) => void;
  formatInput?: (v: string) => string;
  icon?: React.ReactNode;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => {
    if (editing) setDraft(value);
  }, [editing, value]);

  if (editing) {
    if (type === "textarea") {
      return (
        <div className="rounded-[6px] border border-primary/40 bg-primary-soft/30 p-2 ring-1 ring-primary/30">
          <label className="block text-[10.5px] font-medium uppercase tracking-wide text-fg-tertiary">
            {label}
          </label>
          <textarea
            autoFocus
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancel();
            }}
            className="mt-1 w-full rounded-[4px] border border-hairline bg-surface-1 px-2 py-1 text-[12px] text-fg outline-none focus:border-primary"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => onSave(draft)}>
              Save
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="rounded-[6px] border border-primary/40 bg-primary-soft/30 p-1.5 ring-1 ring-primary/30">
        <label className="block text-[10.5px] font-medium uppercase tracking-wide text-fg-tertiary">
          {label}
        </label>
        <input
          autoFocus
          type={type === "numeric" ? "text" : type}
          inputMode={type === "numeric" ? "numeric" : type === "tel" ? "tel" : undefined}
          value={draft}
          onChange={(e) => {
            const v = formatInput ? formatInput(e.target.value) : e.target.value;
            setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave(draft);
            if (e.key === "Escape") onCancel();
          }}
          className="mt-0.5 w-full rounded-[4px] border border-hairline bg-surface-1 px-2 py-1 text-[12px] text-fg outline-none focus:border-primary"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onStartEdit}
      className="group rounded-[6px] p-1.5 text-left transition-colors hover:bg-surface-2"
    >
      <dt className="flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-wide text-fg-tertiary">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-[13px] text-fg">
        {value || <span className="text-fg-tertiary">—</span>}
        <span className="ml-1 hidden text-[10.5px] text-fg-tertiary group-hover:inline">
          edit
        </span>
      </dd>
    </button>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-1.5">
      <dt className="text-[10.5px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] text-fg">
        {value || <span className="text-fg-tertiary">—</span>}
      </dd>
    </div>
  );
}

function splitName(full: string): [string, string] {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0) return ["", ""];
  if (parts.length === 1) return [parts[0], ""];
  // "Last, First" pattern — common in dense lists.
  if (parts[0].endsWith(",")) {
    return [parts.slice(1).join(" "), parts[0].slice(0, -1)];
  }
  return [parts[0], parts.slice(1).join(" ")];
}

// capitalize lives in lib/utils.ts (also used in agent-brief).
