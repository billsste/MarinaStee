"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sailboat, Sparkles, User, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardFooter } from "@/components/wizard/wizard-footer";
import type { WizardStep } from "@/components/wizard/wizard-progress";
import { BOATERS, formatMoney, rentalDurationLabel } from "@/lib/mock-data";
import {
  addBoatRental,
  addCommunication,
  mintBookingPickupToken,
  nextBoatRentalId,
  nextBoatRentalNumber,
  useBoaters,
  useRentalBoats,
} from "@/lib/client-store";
import type {
  BoatRental,
  BoatRentalRateKind,
  Communication,
  RentalBoat,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * Boat-rental booking wizard. Modeled on AssignSlipClient.
 *
 *   0. Boat       — fleet grid filtered by availability
 *   1. Customer   — existing holder combobox OR walk-in (name/email/phone/ID)
 *   2. Time       — start/end + rate kind (hourly / half / full)
 *   3. Review     — summary + Draft + Send link CTA
 *
 * On submit:
 *   - addBoatRental
 *   - mintBookingPickupToken
 *   - addCommunication with /pickup/[token] URL
 *   - router.push("/boat-rentals")
 */

const STORAGE_KEY = "marina_book_rental_draft";

const STEPS: WizardStep[] = [
  { id: "boat", label: "Boat" },
  { id: "customer", label: "Customer" },
  { id: "time", label: "Time" },
  { id: "review", label: "Review" },
];

type CustomerKind = "holder" | "walk_in";

type DraftState = {
  boatId: string;
  customerKind: CustomerKind;
  boaterId: string;
  walkInName: string;
  walkInEmail: string;
  walkInPhone: string;
  walkInIdLast4: string;
  start: string;   // YYYY-MM-DDTHH:mm (input value)
  end: string;
  rateKind: BoatRentalRateKind;
};

export function BookRentalClient({
  searchParamsPromise,
}: {
  searchParamsPromise: Promise<{ boatId?: string }>;
}) {
  const router = useRouter();
  const fleet = useRentalBoats();
  const liveBoaters = useBoaters();
  const boaters = liveBoaters.length > 0 ? liveBoaters : BOATERS;

  // Resolve searchParams once on mount — Next 16 passes them as a promise.
  const [presetBoatId, setPresetBoatId] = React.useState<string>("");
  React.useEffect(() => {
    searchParamsPromise.then((p) => {
      if (p.boatId) setPresetBoatId(p.boatId);
    });
  }, [searchParamsPromise]);

  const [stepIdx, setStepIdx] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);

  const [draft, setDraft] = React.useState<DraftState>(() => {
    const today = new Date();
    today.setHours(10, 0, 0, 0);
    const start = toLocalInput(today);
    const endD = new Date(today.getTime() + 4 * 3_600_000);
    const end = toLocalInput(endD);
    return {
      boatId: "",
      customerKind: "walk_in",
      boaterId: "",
      walkInName: "",
      walkInEmail: "",
      walkInPhone: "",
      walkInIdLast4: "",
      start,
      end,
      rateKind: "hourly",
    };
  });

  // Apply preset boat id once it arrives from the URL
  React.useEffect(() => {
    if (presetBoatId && !draft.boatId) {
      setDraft((d) => ({ ...d, boatId: presetBoatId }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetBoatId]);

  // ── sessionStorage resume ────────────────────────────────────────────
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { step: number; draft: DraftState };
        if (parsed.draft) setDraft(parsed.draft);
        if (typeof parsed.step === "number") setStepIdx(parsed.step);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ step: stepIdx, draft })
      );
    } catch {
      /* ignore */
    }
  }, [stepIdx, draft]);

  // ── Derived
  const selectedBoat = fleet.find((b) => b.id === draft.boatId);
  const selectedBoater = boaters.find((b) => b.id === draft.boaterId);
  const startDate = parseLocalInput(draft.start);
  const endDate = parseLocalInput(draft.end);
  const durationHours =
    startDate && endDate
      ? Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 3_600_000))
      : 0;

  // Price calculation by rate kind
  const baseAmount = React.useMemo(() => {
    if (!selectedBoat) return 0;
    if (draft.rateKind === "full_day") return selectedBoat.full_day_rate ?? 0;
    if (draft.rateKind === "half_day") return selectedBoat.half_day_rate ?? 0;
    return (selectedBoat.hourly_rate ?? 0) * durationHours;
  }, [selectedBoat, draft.rateKind, durationHours]);

  // ── Validation gates
  const canStep0 = draft.boatId.length > 0;
  const canStep1 =
    draft.customerKind === "holder"
      ? draft.boaterId.length > 0
      : draft.walkInName.trim().length > 0 &&
        (draft.walkInEmail.trim().length > 0 || draft.walkInPhone.trim().length > 0);
  const canStep2 =
    draft.start.length > 0 &&
    draft.end.length > 0 &&
    !!startDate &&
    !!endDate &&
    endDate > startDate &&
    baseAmount > 0;
  const canStep3 = canStep0 && canStep1 && canStep2;
  const canContinue = [canStep0, canStep1, canStep2, canStep3][stepIdx];

  function next() {
    if (stepIdx < STEPS.length - 1) setStepIdx((i) => i + 1);
  }
  function back() {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  }

  async function submit() {
    if (!canStep3 || !selectedBoat || !startDate || !endDate) return;
    setSubmitting(true);
    try {
      const id = nextBoatRentalId();
      const number = nextBoatRentalNumber();
      const now = new Date().toISOString();

      const booking: BoatRental = {
        id,
        number,
        boat_id: selectedBoat.id,
        boater_id: draft.customerKind === "holder" ? draft.boaterId : undefined,
        patron_name:
          draft.customerKind === "walk_in" ? draft.walkInName.trim() : undefined,
        patron_email:
          draft.customerKind === "walk_in" && draft.walkInEmail
            ? draft.walkInEmail.trim()
            : undefined,
        patron_phone:
          draft.customerKind === "walk_in" && draft.walkInPhone
            ? draft.walkInPhone.trim()
            : undefined,
        patron_id_last4:
          draft.customerKind === "walk_in" && draft.walkInIdLast4
            ? draft.walkInIdLast4.trim()
            : undefined,
        start_at: startDate.toISOString(),
        end_at: endDate.toISOString(),
        rate_kind: draft.rateKind,
        base_amount: baseAmount,
        deposit_hold: selectedBoat.deposit_amount,
        status: "reserved",
        checkin: {},
        created_at: now,
        updated_at: now,
      };

      addBoatRental(booking);

      // Onboarding chain — mint pickup token + dispatch outbound comm.
      // Same pattern as the contract slip-assign chain.
      const token = mintBookingPickupToken(id);
      if (token) {
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const pickupUrl = `${origin}/pickup/${token}`;

        // Resolve recipient — annual holder uses their pref channel; walk-in
        // defaults to email if present, else SMS.
        let commType: Communication["type"] = "email";
        let recipient = "";
        let displayFirst = "";
        if (selectedBoater) {
          commType = selectedBoater.communication_prefs.preferred_channel;
          recipient =
            commType === "email"
              ? (selectedBoater.primary_contact.email ?? "")
              : (selectedBoater.primary_contact.phone ?? "");
          displayFirst = selectedBoater.first_name;
        } else {
          if (draft.walkInEmail) {
            commType = "email";
            recipient = draft.walkInEmail.trim();
          } else if (draft.walkInPhone) {
            commType = "sms";
            recipient = draft.walkInPhone.trim();
          }
          displayFirst = draft.walkInName.trim().split(/\s+/)[0] ?? "there";
        }

        addCommunication({
          id: `cm_pickup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          // For walk-ins we don't have a boater record, so the comm is
          // recorded against the booking via related_entity; boater_id
          // is left as a synthetic placeholder ("walk_in:<id>") so the
          // inbox can still group it.
          boater_id: selectedBoater ? selectedBoater.id : `walk_in:${id}`,
          type: commType,
          direction: "outbound",
          sender_label: "Marina Stee",
          sender_is_system: true,
          recipient,
          subject: `Your ${selectedBoat.name} rental — complete pickup`,
          body_preview: `Sign the rental agreement + put a card on file: ${pickupUrl}`,
          full_body:
            `Hi ${displayFirst},\n\n` +
            `Your ${selectedBoat.name} rental is booked for ${formatRange(startDate, endDate)}. ` +
            `Please knock out two quick things before pickup:\n\n` +
            `  1. Sign the rental agreement + damage waiver\n` +
            `  2. Add a card for your $${selectedBoat.deposit_amount} refundable deposit hold\n\n` +
            `Takes about 90 seconds: ${pickupUrl}\n\n` +
            `On the day of, head to ${selectedBoat.home_dock} — we'll have your boat fueled and ready.\n\n` +
            `Marina Stee`,
          sent_at: now,
          status: "delivered",
          related_entity: { type: "work_order", id },
        });
      }

      try {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      router.push("/boat-rentals");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Right rail
  const rightRail = (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">Booking</div>
        <div className="mt-1 text-[20px] font-semibold text-fg">
          {selectedBoat ? selectedBoat.name : "—"}
        </div>
        {selectedBoat && (
          <div className="text-[12px] capitalize text-fg-subtle">
            {selectedBoat.type.replace("_", " ")} · {selectedBoat.capacity} pax
          </div>
        )}
      </div>
      <dl className="space-y-1.5 border-t border-hairline pt-3 text-[12px]">
        <RailRow
          label="Customer"
          value={
            draft.customerKind === "holder"
              ? selectedBoater?.display_name ?? "—"
              : draft.walkInName || "—"
          }
        />
        {startDate && endDate && (
          <>
            <RailRow label="Start" value={formatLocalTime(startDate)} />
            <RailRow label="End" value={formatLocalTime(endDate)} />
            <RailRow label="Duration" value={`${durationHours}h`} />
          </>
        )}
        {selectedBoat && draft.rateKind && (
          <RailRow
            label="Rate"
            value={`${formatMoney(baseAmount)} (${
              draft.rateKind === "hourly" ? "hourly" : draft.rateKind === "half_day" ? "half-day" : "full-day"
            })`}
          />
        )}
      </dl>
      <div className="rounded-[10px] border border-primary/30 bg-primary-soft/40 p-3">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-primary">
          <Sparkles className="size-3.5" />
          Ask the agent
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-subtle">
          "Book Pontoon 1 for the Whitfields, Saturday 2pm to 8pm, half-day rate." The agent fills the wizard.
        </p>
      </div>
    </div>
  );

  return (
    <WizardShell
      eyebrow="New booking"
      title={STEP_TITLES[stepIdx]}
      subtitle={STEP_SUBTITLES[stepIdx]}
      steps={STEPS}
      currentIdx={stepIdx}
      onStepClick={(idx) => idx < stepIdx && setStepIdx(idx)}
      rightRail={rightRail}
    >
      {/* Step 0 — Boat */}
      {stepIdx === 0 && (
        <div className="space-y-3">
          <p className="text-[12px] text-fg-subtle">
            Pick a boat from the fleet. Boats in maintenance are hidden.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {fleet
              .filter((b) => b.active && b.status !== "maintenance" && b.status !== "off_season")
              .map((b) => (
                <BoatPickerCard
                  key={b.id}
                  boat={b}
                  selected={draft.boatId === b.id}
                  onClick={() => {
                    // Default rateKind from the boat's primary pricing
                    const nextRateKind: BoatRentalRateKind =
                      b.hourly_rate ? "hourly" : b.half_day_rate ? "half_day" : "full_day";
                    setDraft((d) => ({ ...d, boatId: b.id, rateKind: nextRateKind }));
                  }}
                />
              ))}
          </div>
        </div>
      )}

      {/* Step 1 — Customer */}
      {stepIdx === 1 && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <CustomerToggle
              active={draft.customerKind === "walk_in"}
              onClick={() => setDraft((d) => ({ ...d, customerKind: "walk_in" }))}
              icon={<UserPlus className="size-3.5" />}
              label="Walk-in customer"
              hint="One-off rental — capture name + contact + ID."
            />
            <CustomerToggle
              active={draft.customerKind === "holder"}
              onClick={() => setDraft((d) => ({ ...d, customerKind: "holder" }))}
              icon={<User className="size-3.5" />}
              label="Existing member"
              hint="Annual slip member renting for the day."
            />
          </div>

          {draft.customerKind === "holder" ? (
            <FieldLabel
              label="Member"
              hint="Use the same charge-to-account setup the member already has."
            >
              <Combobox
                value={draft.boaterId}
                onChange={(v) => setDraft((d) => ({ ...d, boaterId: v }))}
                options={boaters.map((b) => ({
                  value: b.id,
                  label: b.display_name,
                  hint: b.code ? `· ${b.code}` : undefined,
                }))}
                placeholder="Pick a member…"
                searchPlaceholder="Search by name, code…"
              />
            </FieldLabel>
          ) : (
            <div className="space-y-3">
              <FieldLabel label="Customer name" required>
                <Input
                  value={draft.walkInName}
                  onChange={(v) => setDraft((d) => ({ ...d, walkInName: v }))}
                  placeholder="Full name on ID"
                />
              </FieldLabel>
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldLabel label="Email">
                  <Input
                    value={draft.walkInEmail}
                    onChange={(v) => setDraft((d) => ({ ...d, walkInEmail: v }))}
                    placeholder="customer@example.com"
                    inputMode="email"
                  />
                </FieldLabel>
                <FieldLabel label="Phone">
                  <Input
                    value={draft.walkInPhone}
                    onChange={(v) => setDraft((d) => ({ ...d, walkInPhone: v }))}
                    placeholder="(231) 555-0100"
                    inputMode="tel"
                  />
                </FieldLabel>
              </div>
              <FieldLabel
                label="Driver's license — last 4"
                hint="Captured at pickup, surfaced on the rental agreement audit trail. Optional at booking."
              >
                <Input
                  value={draft.walkInIdLast4}
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, walkInIdLast4: v.replace(/\D/g, "").slice(0, 4) }))
                  }
                  placeholder="1234"
                  inputMode="numeric"
                />
              </FieldLabel>
              <p className="text-[11px] text-fg-tertiary">
                We need at least an email or phone to send the pickup link.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Step 2 — Time */}
      {stepIdx === 2 && selectedBoat && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="Pickup" required>
              <input
                type="datetime-local"
                value={draft.start}
                onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))}
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
              />
            </FieldLabel>
            <FieldLabel label="Return" required>
              <input
                type="datetime-local"
                value={draft.end}
                onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))}
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
              />
            </FieldLabel>
          </div>
          {startDate && endDate && endDate <= startDate && (
            <p className="text-[12px] text-status-danger">
              Return must be after pickup.
            </p>
          )}

          <FieldLabel label="Rate kind">
            <div className="grid gap-2 sm:grid-cols-3">
              {selectedBoat.hourly_rate != null && (
                <RateOption
                  selected={draft.rateKind === "hourly"}
                  onClick={() => setDraft((d) => ({ ...d, rateKind: "hourly" }))}
                  label="Hourly"
                  price={`${formatMoney(selectedBoat.hourly_rate)}/hr`}
                  total={`${formatMoney(selectedBoat.hourly_rate * Math.max(1, durationHours))} (${durationHours}h)`}
                />
              )}
              {selectedBoat.half_day_rate != null && (
                <RateOption
                  selected={draft.rateKind === "half_day"}
                  onClick={() => setDraft((d) => ({ ...d, rateKind: "half_day" }))}
                  label="Half day"
                  price={`${formatMoney(selectedBoat.half_day_rate)}`}
                  total="4-hour block"
                />
              )}
              {selectedBoat.full_day_rate != null && (
                <RateOption
                  selected={draft.rateKind === "full_day"}
                  onClick={() => setDraft((d) => ({ ...d, rateKind: "full_day" }))}
                  label="Full day"
                  price={`${formatMoney(selectedBoat.full_day_rate)}`}
                  total="8-hour block"
                />
              )}
            </div>
          </FieldLabel>

          <div className="rounded-[10px] border border-hairline bg-surface-2 p-3 text-[12px]">
            <div className="flex items-baseline justify-between">
              <span className="text-fg-subtle">Base rental</span>
              <span className="money-display text-[16px] text-fg">{formatMoney(baseAmount)}</span>
            </div>
            <div className="flex items-baseline justify-between text-fg-tertiary">
              <span>Refundable deposit hold</span>
              <span className="tabular">{formatMoney(selectedBoat.deposit_amount)}</span>
            </div>
            <p className="mt-2 text-[11px] text-fg-tertiary">
              Deposit is authorized at pickup and released on return. Fuel /
              damage / late fees are applied to the deposit if applicable; any
              remaining balance auto-bills the card on file.
            </p>
          </div>
        </div>
      )}

      {/* Step 3 — Review */}
      {stepIdx === 3 && selectedBoat && startDate && endDate && (
        <div className="space-y-3">
          <ReviewBlock
            label="Boat"
            value={`${selectedBoat.name} · ${selectedBoat.type.replace("_", " ")} · ${selectedBoat.capacity} pax`}
            onEdit={() => setStepIdx(0)}
          />
          <ReviewBlock
            label="Customer"
            value={
              draft.customerKind === "holder"
                ? selectedBoater?.display_name ?? "—"
                : `${draft.walkInName}${draft.walkInIdLast4 ? ` · ID ****${draft.walkInIdLast4}` : ""}`
            }
            onEdit={() => setStepIdx(1)}
          />
          <ReviewBlock
            label="Contact"
            value={
              draft.customerKind === "holder"
                ? selectedBoater?.primary_contact.email ?? selectedBoater?.primary_contact.phone ?? "—"
                : draft.walkInEmail || draft.walkInPhone || "—"
            }
            onEdit={() => setStepIdx(1)}
          />
          <ReviewBlock
            label="Time"
            value={`${formatRange(startDate, endDate)} · ${rentalDurationLabel({
              ...({} as BoatRental),
              start_at: startDate.toISOString(),
              end_at: endDate.toISOString(),
              rate_kind: draft.rateKind,
            } as BoatRental)}`}
            onEdit={() => setStepIdx(2)}
          />
          <ReviewBlock
            label="Total"
            value={`${formatMoney(baseAmount)} · ${formatMoney(selectedBoat.deposit_amount)} deposit hold`}
            onEdit={() => setStepIdx(2)}
          />

          <div className="mt-3 rounded-[10px] border border-primary/30 bg-primary-soft/30 p-3 text-[12px]">
            <div className="flex items-center gap-1.5 text-primary">
              <Sailboat className="size-3.5" />
              <span className="font-medium">On submit:</span>
            </div>
            <ol className="ml-5 mt-1 list-decimal space-y-0.5 text-fg-subtle">
              <li>Booking <strong>{nextBoatRentalNumber.toString().includes("BR-") ? "" : ""}</strong>created in <em>reserved</em> state</li>
              <li>Pickup link minted + sent to customer ({draft.customerKind === "holder" ? "via their preferred channel" : draft.walkInEmail ? "email" : "SMS"})</li>
              <li>They sign agreement + put card on file → status flips to <em>confirmed</em></li>
              <li>Dockhand checks them out on the day → status flips to <em>checked_out</em></li>
            </ol>
          </div>
        </div>
      )}

      <WizardFooter
        stepIndex={stepIdx}
        totalSteps={STEPS.length}
        stepLabel={STEPS[stepIdx].label}
        onBack={back}
        onContinue={stepIdx === STEPS.length - 1 ? submit : next}
        continueLabel={stepIdx === STEPS.length - 1 ? "Book + send link" : "Continue"}
        continueDisabled={!canContinue}
        busy={submitting}
        exitHref="/boat-rentals"
        busyLabel="Booking…"
      />
    </WizardShell>
  );
}

// ── Step copy ─────────────────────────────────────────────────────────

const STEP_TITLES = [
  "Pick a boat",
  "Who's renting?",
  "When and how long?",
  "Review and send the link",
];

const STEP_SUBTITLES = [
  "Pick from the available fleet — boats in maintenance are hidden.",
  "An existing annual member can charge against their account; walk-ins get a one-off pickup link.",
  "Set the window + pick a rate kind. The customer will see the same totals when they open the link.",
  "Confirm the booking — clicking Book mints a pickup link and dispatches it to the customer.",
];

// ── Small inline subcomponents ────────────────────────────────────────

function FieldLabel({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-fg-subtle">
          {label}
          {required && <span className="ml-1 text-status-danger">*</span>}
        </span>
      </div>
      {children}
      {hint && <p className="mt-1 text-[11px] text-fg-tertiary">{hint}</p>}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "text" | "email" | "tel" | "numeric";
}) {
  return (
    <input
      type="text"
      inputMode={inputMode}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
    />
  );
}

function CustomerToggle({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 flex-col items-start rounded-[10px] border px-3 py-2.5 text-left transition-colors",
        active
          ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
          : "border-hairline bg-surface-1 hover:border-hairline-strong hover:bg-surface-2"
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-fg">
        {icon}
        {label}
      </span>
      <span className="mt-0.5 text-[11px] text-fg-subtle">{hint}</span>
    </button>
  );
}

function BoatPickerCard({
  boat,
  selected,
  onClick,
}: {
  boat: RentalBoat;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[10px] border px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
          : "border-hairline bg-surface-1 hover:border-hairline-strong hover:bg-surface-2"
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-fg">{boat.name}</span>
        <Badge tone={boat.status === "available" ? "ok" : "info"} size="sm">
          {boat.status === "rented" ? "on water" : boat.status}
        </Badge>
      </div>
      <div className="mt-0.5 text-[11px] capitalize text-fg-tertiary">
        {boat.type.replace("_", " ")} · {boat.capacity} pax · {boat.home_dock}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        {boat.hourly_rate != null && (
          <span className="text-[11px] text-fg-subtle">
            <span className="money-display text-[13px] text-fg">{formatMoney(boat.hourly_rate)}</span>/hr
          </span>
        )}
        {boat.half_day_rate != null && (
          <span className="text-[11px] text-fg-subtle">
            · <span className="money-display text-[13px] text-fg">{formatMoney(boat.half_day_rate)}</span>/half
          </span>
        )}
        {boat.full_day_rate != null && (
          <span className="text-[11px] text-fg-subtle">
            · <span className="money-display text-[13px] text-fg">{formatMoney(boat.full_day_rate)}</span>/day
          </span>
        )}
      </div>
    </button>
  );
}

function RateOption({
  selected,
  onClick,
  label,
  price,
  total,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  price: string;
  total: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[10px] border px-3 py-2 text-left transition-colors",
        selected
          ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
          : "border-hairline bg-surface-1 hover:bg-surface-2"
      )}
    >
      <div className="text-[12px] font-medium text-fg">{label}</div>
      <div className="money-display mt-0.5 text-[16px] text-fg">{price}</div>
      <div className="text-[10px] text-fg-tertiary">{total}</div>
    </button>
  );
}

function RailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-fg-tertiary">{label}</dt>
      <dd className="text-right text-fg">{value}</dd>
    </div>
  );
}

function ReviewBlock({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[10px] border border-hairline bg-surface-1 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">{label}</div>
        <div className="mt-0.5 text-[13px] text-fg">{value}</div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="text-[12px] text-primary hover:underline"
      >
        Edit
      </button>
    </div>
  );
}

// ── Date helpers ──────────────────────────────────────────────────────

// HTML datetime-local needs "YYYY-MM-DDTHH:mm" in LOCAL time (no zone).
function toLocalInput(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
function parseLocalInput(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function formatLocalTime(d: Date) {
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
function formatRange(start: Date, end: Date) {
  return `${formatLocalTime(start)} → ${formatLocalTime(end)}`;
}
