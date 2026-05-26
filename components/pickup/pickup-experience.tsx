"use client";

import * as React from "react";
import {
  CheckCircle2,
  CreditCard,
  FileText,
  PartyPopper,
  Sailboat,
  ShieldCheck,
  MapPin,
  Clock,
  Fuel,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SignaturePad, capturePadDataUrl } from "@/components/sign/signature-pad";
import { formatMoney, rentalDurationLabel, RENTAL_BOATS } from "@/lib/mock-data";
import {
  addCardForBoater,
  getBoatRentalByToken as getBoatRentalByTokenFromStore,
  markBookingCheckinStep,
  nextCardId,
  useStore,
} from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { BoatRental, Boater, CardOnFile, RentalBoat } from "@/lib/types";

/*
 * Public boat-rental pickup experience. Resolves a BoatRental by its
 * pickup_token and walks the customer through:
 *
 *   1. REVIEW   — boat photo / time / total / deposit hold breakdown
 *   2. AGREE    — rental agreement + damage waiver + signature pad
 *   3. DEPOSIT  — card-on-file capture for the refundable hold
 *   4. DONE     — pickup instructions (location, what to bring)
 *
 * Each step writes back via markBookingCheckinStep, which auto-promotes
 *   reserved → confirmed (when signed + deposit on file)
 */

type Step = 0 | 1 | 2 | 3;

const STEPS = [
  { id: "review", label: "Review", icon: FileText },
  { id: "agree", label: "Agreement", icon: ShieldCheck },
  { id: "deposit", label: "Deposit", icon: CreditCard },
  { id: "done", label: "Pickup", icon: PartyPopper },
] as const;

export function PickupExperience({
  token,
  ssrRental,
  ssrBoat,
  ssrBoater,
}: {
  token: string;
  ssrRental: BoatRental | null;
  ssrBoat: RentalBoat | null;
  ssrBoater: Boater | null;
}) {
  const store = useStore();
  const liveRental = React.useMemo(
    () =>
      getBoatRentalByTokenFromStore(token) ??
      store.boatRentals.find((r) => r.pickup_token === token) ??
      ssrRental,
    [store.boatRentals, token, ssrRental]
  );
  const boat = React.useMemo(() => {
    if (!liveRental) return ssrBoat;
    return (
      store.rentalBoats.find((b) => b.id === liveRental.boat_id) ??
      RENTAL_BOATS.find((b) => b.id === liveRental.boat_id) ??
      ssrBoat
    );
  }, [liveRental, store.rentalBoats, ssrBoat]);
  const boater = React.useMemo(() => {
    if (!liveRental?.boater_id) return ssrBoater;
    return store.boaters.find((b) => b.id === liveRental.boater_id) ?? ssrBoater;
  }, [liveRental, store.boaters, ssrBoater]);

  const [step, setStep] = React.useState<Step>(0);

  // Mark "viewed" once when the customer lands on the page.
  React.useEffect(() => {
    if (liveRental?.id && !liveRental.checkin.link_viewed_at) {
      markBookingCheckinStep(liveRental.id, "link_viewed_at");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRental?.id]);

  if (!liveRental || !boat) {
    return (
      <main className="min-h-screen bg-canvas">
        <div className="mx-auto flex max-w-xl flex-col items-center px-6 py-24 text-center">
          <Sailboat className="mb-3 size-8 text-fg-tertiary" />
          <h1 className="text-[20px] font-semibold text-fg">
            This pickup link isn&apos;t valid
          </h1>
          <p className="mt-2 text-[13px] text-fg-subtle">
            The booking may have been cancelled or the link expired. If you
            think this is a mistake, get in touch with the marina.
          </p>
        </div>
      </main>
    );
  }

  // ── Already-confirmed? Jump to Done.
  React.useEffect(() => {
    if (
      liveRental.checkin.agreement_signed_at &&
      liveRental.checkin.deposit_authorized_at &&
      step === 0
    ) {
      setStep(3);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRental.checkin.agreement_signed_at, liveRental.checkin.deposit_authorized_at]);

  const customerFirst =
    boater?.first_name ??
    (liveRental.patron_name ?? "").trim().split(/\s+/)[0] ??
    "there";
  const totalDue = liveRental.base_amount;

  return (
    <main className="min-h-screen bg-canvas">
      {/* Top bar */}
      <header className="border-b border-hairline bg-surface-1">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-[6px] bg-primary text-on-primary">
              <span className="font-semibold text-[12px]">M</span>
            </div>
            <span className="text-[13px] font-medium text-fg">Marina Stee</span>
          </div>
          <Badge tone="info" size="sm">
            {boat.name}
          </Badge>
        </div>
      </header>

      {/* Progress */}
      <div className="border-b border-hairline bg-surface-1">
        <div className="mx-auto flex max-w-3xl items-center gap-1 px-5 py-3">
          {STEPS.map((s, idx) => {
            const Icon = s.icon;
            const done = idx < step;
            const active = idx === step;
            return (
              <React.Fragment key={s.id}>
                <div
                  className={cn(
                    "flex items-center gap-1.5 text-[11px]",
                    active ? "text-fg" : done ? "text-fg-subtle" : "text-fg-tertiary"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full border text-[10px] tabular",
                      active
                        ? "border-primary bg-primary text-on-primary"
                        : done
                        ? "border-status-ok bg-status-ok/10 text-status-ok"
                        : "border-hairline bg-surface-2"
                    )}
                  >
                    {done ? <CheckCircle2 className="size-3" /> : <Icon className="size-3" />}
                  </span>
                  {s.label}
                </div>
                {idx < STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className={cn(
                      "h-px w-6 sm:w-10",
                      done ? "bg-status-ok" : "bg-hairline"
                    )}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-3xl px-5 py-6">
        {step === 0 && (
          <ReviewStep
            rental={liveRental}
            boat={boat}
            customerFirst={customerFirst}
            totalDue={totalDue}
            onContinue={() => setStep(1)}
          />
        )}
        {step === 1 && (
          <AgreeStep
            rental={liveRental}
            boat={boat}
            boater={boater}
            customerFirst={customerFirst}
            onBack={() => setStep(0)}
            onCommitted={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <DepositStep
            rental={liveRental}
            boat={boat}
            boater={boater}
            onBack={() => setStep(1)}
            onCommitted={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <DoneStep
            rental={liveRental}
            boat={boat}
            customerFirst={customerFirst}
          />
        )}
      </div>
    </main>
  );
}

// ── Step 1: Review ──────────────────────────────────────────────

function ReviewStep({
  rental,
  boat,
  customerFirst,
  totalDue,
  onContinue,
}: {
  rental: BoatRental;
  boat: RentalBoat;
  customerFirst: string;
  totalDue: number;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="display-tight text-[24px] font-semibold text-fg">
          Welcome aboard, {customerFirst}.
        </h1>
        <p className="mt-1 text-[14px] text-fg-subtle">
          Two quick steps before pickup: sign the rental agreement and add a card
          for the refundable deposit hold. Takes about 90 seconds.
        </p>
      </div>

      <section className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div className="border-b border-hairline bg-surface-2 px-4 py-2.5">
          <h2 className="text-[13px] font-medium text-fg">Your rental</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[1fr_240px]">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Sailboat className="size-4 text-primary" />
              <span className="text-[15px] font-medium text-fg">{boat.name}</span>
            </div>
            <div className="text-[12px] capitalize text-fg-subtle">
              {boat.type.replace("_", " ")} · seats up to {boat.capacity}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
              <div>
                <dt className="text-fg-tertiary">Pickup</dt>
                <dd className="text-fg">{formatLocal(rental.start_at)}</dd>
              </div>
              <div>
                <dt className="text-fg-tertiary">Return</dt>
                <dd className="text-fg">{formatLocal(rental.end_at)}</dd>
              </div>
              <div>
                <dt className="text-fg-tertiary">Duration</dt>
                <dd className="text-fg">{rentalDurationLabel(rental)}</dd>
              </div>
              <div>
                <dt className="text-fg-tertiary">Pickup spot</dt>
                <dd className="text-fg">{boat.home_dock}</dd>
              </div>
            </dl>
          </div>
          <div className="rounded-[10px] border border-hairline bg-surface-2 p-3">
            <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
              You&apos;ll be charged
            </div>
            <div className="money-display mt-1 text-[26px] text-fg">
              {formatMoney(totalDue)}
            </div>
            <div className="mt-2 border-t border-hairline pt-2 text-[11px] text-fg-tertiary">
              Refundable deposit hold
            </div>
            <div className="tabular text-[14px] text-fg">
              {formatMoney(rental.deposit_hold)}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-fg-tertiary">
              Deposit is authorized at pickup and released on return. Fuel /
              damage / late fees are applied first; remainder is released back
              to your card.
            </p>
          </div>
        </div>
      </section>

      <div className="rounded-[12px] border border-status-info/30 bg-status-info/[0.05] px-4 py-3 text-[12px] leading-relaxed text-fg-subtle">
        <strong className="text-fg">Heads up:</strong> you must be 21+ with a
        valid driver&apos;s license to operate. Boating safety certificate
        required for {boat.type === "jet_ski" ? "PWC operation" : "vessels >10hp"} in
        Michigan if born after 1978. The dockhand will verify on pickup.
      </div>

      <div className="flex justify-end">
        <Button variant="primary" onClick={onContinue}>
          Continue to agreement →
        </Button>
      </div>
    </div>
  );
}

// ── Step 2: Agreement ──────────────────────────────────────────

function AgreeStep({
  rental,
  boat,
  boater,
  customerFirst,
  onBack,
  onCommitted,
}: {
  rental: BoatRental;
  boat: RentalBoat;
  boater: Boater | null;
  customerFirst: string;
  onBack: () => void;
  onCommitted: () => void;
}) {
  const padRef = React.useRef<HTMLCanvasElement | null>(null);
  const [hasSignature, setHasSignature] = React.useState(false);
  const initialName =
    boater?.display_name?.replace(/^[^,]+,\s*/, "") ??
    rental.patron_name ??
    "";
  const [signerName, setSignerName] = React.useState(initialName);
  const [waiverChecked, setWaiverChecked] = React.useState(false);
  const [committing, setCommitting] = React.useState(false);

  const canCommit = hasSignature && signerName.trim().length > 0 && waiverChecked;

  function commit() {
    if (!canCommit || !rental) return;
    setCommitting(true);
    try {
      const signature_data_url = capturePadDataUrl(padRef.current);
      markBookingCheckinStep(rental.id, "agreement_signed_at", {
        signer_name: signerName.trim(),
        signature_data_url,
      });
      onCommitted();
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="display-tight text-[22px] font-semibold text-fg">
          Rental agreement & damage waiver
        </h1>
        <p className="mt-1 text-[13px] text-fg-subtle">
          One signature covers the rental terms and the damage waiver.
        </p>
      </div>

      {/* Agreement text */}
      <section className="rounded-[12px] border border-hairline bg-surface-1">
        <div className="border-b border-hairline bg-surface-2 px-4 py-2.5 text-[12px] font-medium text-fg">
          Marina Stee Boat Rental Agreement
        </div>
        <div className="max-h-72 overflow-y-auto p-4 text-[12px] leading-relaxed text-fg-subtle">
          <p className="text-fg">
            <strong>Rental terms.</strong> {customerFirst}, you are renting the{" "}
            {boat.name} ({boat.type.replace("_", " ")}) from Marina Stee for the
            window {formatLocal(rental.start_at)} → {formatLocal(rental.end_at)}.
            Total rental: <strong>{formatMoney(rental.base_amount)}</strong>. A{" "}
            <strong>{formatMoney(rental.deposit_hold)}</strong> refundable deposit
            will be authorized against your card at pickup.
          </p>
          <p className="mt-3">
            <strong>Operator responsibility.</strong> You agree to operate the
            vessel safely, in compliance with all applicable state and federal
            regulations. Persons under 21 may not operate. Operators born after
            1978 must hold a valid Michigan Boating Safety Certificate.
            Alcohol use while operating is prohibited.
          </p>
          <p className="mt-3">
            <strong>Damage & loss.</strong> You are responsible for damage caused
            during your rental period, including but not limited to hull damage,
            propeller damage, lost items, and grounding. Marina Stee will
            assess damage at return and itemize any charges against your
            deposit. Charges exceeding the deposit will be billed to the card
            on file.
          </p>
          <p className="mt-3">
            <strong>Fuel.</strong> You will be charged for fuel consumed at
            current pump prices, calculated by the difference between
            outbound and return fuel levels. Return the boat with at least 25%
            fuel to avoid a $25 refueling fee.
          </p>
          <p className="mt-3">
            <strong>Late return.</strong> Late returns are billed at $50 per
            half hour beyond the scheduled return time, applied to the
            deposit.
          </p>
          <p className="mt-3">
            <strong>Cancellation.</strong> Free cancellation up to 24 hours
            before pickup. Within 24 hours, 50% of the rental fee is forfeited.
            No-shows forfeit 100%.
          </p>
          <p className="mt-3 text-fg-tertiary">
            By signing below, you acknowledge you have read and agree to these
            terms, including the limitation of liability and indemnification
            clauses on file at the marina office.
          </p>
        </div>
      </section>

      {/* Signer name */}
      <label className="block">
        <div className="mb-1.5 text-[12px] font-medium text-fg-subtle">
          Full legal name <span className="text-status-danger">*</span>
        </div>
        <input
          type="text"
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          placeholder="Jane Q. Customer"
          className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
        />
      </label>

      {/* Signature pad */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[12px] font-medium text-fg-subtle">
            Signature <span className="text-status-danger">*</span>
          </span>
        </div>
        <SignaturePad
          canvasRef={padRef}
          hasSignature={hasSignature}
          onChange={setHasSignature}
          signerName={signerName}
        />
      </div>

      {/* Waiver checkbox */}
      <label className="flex cursor-pointer items-start gap-2 rounded-[10px] border border-hairline bg-surface-1 p-3 text-[12px]">
        <input
          type="checkbox"
          checked={waiverChecked}
          onChange={(e) => setWaiverChecked(e.target.checked)}
          className="mt-0.5 accent-primary"
        />
        <span className="text-fg-subtle">
          I am 21 or older, I have a valid driver&apos;s license, and I assume
          all responsibility for damage and operator safety during this
          rental.
        </span>
      </label>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-[12px] text-fg-subtle hover:text-fg"
        >
          ← Back
        </button>
        <Button
          variant="primary"
          onClick={commit}
          disabled={!canCommit || committing}
        >
          {committing ? "Saving…" : "Agree & continue →"}
        </Button>
      </div>
    </div>
  );
}

// ── Step 3: Deposit ──────────────────────────────────────────

function DepositStep({
  rental,
  boat,
  boater,
  onBack,
  onCommitted,
}: {
  rental: BoatRental;
  boat: RentalBoat;
  boater: Boater | null;
  onBack: () => void;
  onCommitted: () => void;
}) {
  const [holderName, setHolderName] = React.useState(
    boater?.display_name?.replace(/^[^,]+,\s*/, "") ?? rental.patron_name ?? ""
  );
  const [number, setNumber] = React.useState("");
  const [exp, setExp] = React.useState("");
  const [cvc, setCvc] = React.useState("");
  const [zip, setZip] = React.useState("");
  const [committing, setCommitting] = React.useState(false);

  const cleanNumber = number.replace(/\D/g, "");
  const last4 = cleanNumber.slice(-4);
  const brand = guessBrand(cleanNumber);
  const [expMonth, expYear] = parseExp(exp);

  const canCommit =
    holderName.trim().length > 0 &&
    cleanNumber.length >= 13 &&
    last4.length === 4 &&
    !!expMonth &&
    !!expYear &&
    cvc.length >= 3 &&
    zip.length >= 5;

  function commit() {
    if (!canCommit || !rental) return;
    setCommitting(true);
    try {
      const cardId = nextCardId();
      const card: CardOnFile = {
        id: cardId,
        brand,
        last4,
        exp_month: expMonth!,
        exp_year: expYear!,
        nickname: "Rental deposit",
        is_default: !boater, // walk-ins: this is their only card on file
        processor_token: `demo_tok_${Date.now().toString(36)}`,
      };
      // If the customer is an existing holder, store the card against
      // their account (it's now a permanent card on file). For walk-ins,
      // we store it under a synthetic boater key so the rental record
      // can still reference it via deposit_card_id.
      if (boater) {
        addCardForBoater(boater.id, card);
      } else {
        addCardForBoater(`walk_in:${rental.id}`, card);
      }
      markBookingCheckinStep(rental.id, "deposit_authorized_at", {
        deposit_card_id: cardId,
      });
      onCommitted();
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="display-tight text-[22px] font-semibold text-fg">
          Deposit hold
        </h1>
        <p className="mt-1 text-[13px] text-fg-subtle">
          We&apos;ll authorize a {formatMoney(rental.deposit_hold)} hold against
          your card at pickup — released on return, less any fuel / damage / late
          fees. The base rental ({formatMoney(rental.base_amount)}) is charged
          on return.
        </p>
      </div>

      <section className="rounded-[12px] border border-hairline bg-surface-1 p-4">
        <div className="space-y-3">
          <label className="block">
            <div className="mb-1.5 text-[12px] font-medium text-fg-subtle">
              Name on card
            </div>
            <input
              type="text"
              value={holderName}
              onChange={(e) => setHolderName(e.target.value)}
              className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
            />
          </label>
          <label className="block">
            <div className="mb-1.5 text-[12px] font-medium text-fg-subtle">
              Card number
            </div>
            <input
              type="text"
              inputMode="numeric"
              value={number}
              onChange={(e) => setNumber(formatCardInput(e.target.value))}
              placeholder="1234 5678 9012 3456"
              className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 font-mono text-[14px] text-fg tabular focus:border-hairline-strong focus:outline-none"
              maxLength={19}
            />
            {cleanNumber.length >= 13 && (
              <div className="mt-1 text-[11px] uppercase text-fg-tertiary">{brand}</div>
            )}
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <div className="mb-1.5 text-[12px] font-medium text-fg-subtle">Expiry</div>
              <input
                type="text"
                inputMode="numeric"
                value={exp}
                onChange={(e) => setExp(formatExpInput(e.target.value))}
                placeholder="MM/YY"
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-center font-mono text-[14px] text-fg tabular focus:border-hairline-strong focus:outline-none"
                maxLength={5}
              />
            </label>
            <label className="block">
              <div className="mb-1.5 text-[12px] font-medium text-fg-subtle">CVC</div>
              <input
                type="text"
                inputMode="numeric"
                value={cvc}
                onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="123"
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-center font-mono text-[14px] text-fg tabular focus:border-hairline-strong focus:outline-none"
              />
            </label>
            <label className="block">
              <div className="mb-1.5 text-[12px] font-medium text-fg-subtle">ZIP</div>
              <input
                type="text"
                inputMode="numeric"
                value={zip}
                onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
                placeholder="49682"
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-center font-mono text-[14px] text-fg tabular focus:border-hairline-strong focus:outline-none"
              />
            </label>
          </div>
        </div>
      </section>

      <p className="text-[11px] text-fg-tertiary">
        🔒 Demo only — in production this is tokenized at the processor and
        we never store the raw PAN.
      </p>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-[12px] text-fg-subtle hover:text-fg"
        >
          ← Back
        </button>
        <Button variant="primary" onClick={commit} disabled={!canCommit || committing}>
          {committing ? "Authorizing…" : `Authorize ${formatMoney(rental.deposit_hold)} hold →`}
        </Button>
      </div>
    </div>
  );
}

// ── Step 4: Done ──────────────────────────────────────────────

function DoneStep({
  rental,
  boat,
  customerFirst,
}: {
  rental: BoatRental;
  boat: RentalBoat;
  customerFirst: string;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-[14px] border border-status-ok/30 bg-status-ok/[0.05] px-5 py-6 text-center">
        <PartyPopper className="mx-auto size-8 text-status-ok" />
        <h1 className="display-tight mt-2 text-[24px] font-semibold text-fg">
          You&apos;re all set, {customerFirst}.
        </h1>
        <p className="mt-1 text-[13px] text-fg-subtle">
          Agreement signed. Deposit authorized. The boat will be fueled and
          waiting.
        </p>
      </div>

      <section className="rounded-[12px] border border-hairline bg-surface-1">
        <div className="border-b border-hairline bg-surface-2 px-4 py-2.5 text-[13px] font-medium text-fg">
          On the day of
        </div>
        <ul className="divide-y divide-hairline">
          <Tile
            icon={<Clock className="size-4 text-primary" />}
            title="Pickup time"
            body={formatLocal(rental.start_at)}
          />
          <Tile
            icon={<MapPin className="size-4 text-primary" />}
            title="Where to go"
            body={`${boat.home_dock} — ask the dockhand for ${boat.name}.`}
          />
          <Tile
            icon={<Sailboat className="size-4 text-primary" />}
            title="What to bring"
            body="Driver's license · Boating safety certificate (if applicable) · Sunscreen, towels, snacks."
          />
          <Tile
            icon={<Fuel className="size-4 text-primary" />}
            title="Fuel"
            body={`Boat will be at ${boat.current_fuel_pct ?? "—"}% on pickup. Return with ≥ 25% to avoid the refueling fee.`}
          />
        </ul>
      </section>

      <div className="rounded-[12px] border border-hairline bg-surface-1 px-4 py-3 text-[12px] text-fg-subtle">
        Questions? Reply to this thread or call us at <strong className="text-fg">(231) 555-0100</strong>.
      </div>
    </div>
  );
}

function Tile({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-surface-3">
        {icon}
      </div>
      <div>
        <div className="text-[13px] font-medium text-fg">{title}</div>
        <div className="text-[12px] text-fg-subtle">{body}</div>
      </div>
    </li>
  );
}

// ── Helpers ────────────────────────────────────────────────────

function formatLocal(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function guessBrand(num: string): CardOnFile["brand"] {
  if (/^4/.test(num)) return "visa";
  if (/^5[1-5]/.test(num)) return "mastercard";
  if (/^3[47]/.test(num)) return "amex";
  if (/^6(?:011|5)/.test(num)) return "discover";
  return "other";
}

function parseExp(s: string): [number | null, number | null] {
  const m = s.match(/^(\d{2})\s*\/?\s*(\d{2})$/);
  if (!m) return [null, null];
  const mm = parseInt(m[1], 10);
  const yy = parseInt(m[2], 10);
  if (mm < 1 || mm > 12 || isNaN(yy)) return [null, null];
  return [mm, 2000 + yy];
}

function formatCardInput(s: string) {
  return s
    .replace(/\D/g, "")
    .slice(0, 16)
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

function formatExpInput(s: string) {
  const digits = s.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}
