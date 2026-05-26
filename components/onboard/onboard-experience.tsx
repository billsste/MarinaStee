"use client";

import * as React from "react";
import {
  Anchor,
  CheckCircle2,
  CreditCard,
  FileText,
  Mail,
  PartyPopper,
  ShieldCheck,
  Ship,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SignaturePad, capturePadDataUrl } from "@/components/sign/signature-pad";
import { formatMoney, BOATERS, SLIPS, VESSELS } from "@/lib/mock-data";
import {
  addCardForBoater,
  getContractByToken as getContractByTokenFromStore,
  markContractOnboardingStep,
  nextCardId,
  useStore,
} from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { Boater, CardOnFile, Contract, Slip, Vessel } from "@/lib/types";

/*
 * Unified boater-facing onboarding experience. Resolves a Contract by
 * its signature_token and walks the holder through:
 *
 *   1. REVIEW  — read the contract terms (rate, term, slip, services)
 *   2. SIGN    — capture an e-signature (canvas pad)
 *   3. PAY     — add a card on file (CC tokenization happens here in
 *                production; in mock we store last 4 + brand)
 *   4. DONE    — welcome + handoff to the holder's portal
 *
 * Each completed step writes back to the Contract via
 * markContractOnboardingStep, which auto-advances status:
 *   draft -> sent (mint) -> executed (sign) -> active (sign + card)
 */

type Step = 0 | 1 | 2 | 3;

const STEPS = [
  { id: "review", label: "Review", icon: FileText },
  { id: "sign", label: "Sign", icon: ShieldCheck },
  { id: "pay", label: "Payment", icon: CreditCard },
  { id: "done", label: "Welcome", icon: PartyPopper },
] as const;

export function OnboardExperience({
  token,
  ssrContract,
  ssrBoater,
  ssrVessel,
  ssrSlip,
}: {
  token: string;
  ssrContract: Contract | null;
  ssrBoater: Boater | null;
  ssrVessel: Vessel | null;
  ssrSlip: Slip | null;
}) {
  // Subscribe to the live store so we always reflect the freshest
  // contract (especially important when the token was minted in this
  // same session and didn't make it into the SSR mock data).
  const store = useStore();
  const liveContract = React.useMemo(
    () =>
      getContractByTokenFromStore(token) ??
      store.contracts.find((c) => c.signature_token === token) ??
      ssrContract,
    [store.contracts, token, ssrContract]
  );

  // Resolve boater / slip / vessel from the live contract.
  const boater = React.useMemo(() => {
    if (!liveContract) return ssrBoater;
    return (
      store.boaters.find((b) => b.id === liveContract.boater_id) ??
      BOATERS.find((b) => b.id === liveContract.boater_id) ??
      ssrBoater
    );
  }, [liveContract, store.boaters, ssrBoater]);

  const vessel = React.useMemo(() => {
    if (!liveContract?.vessel_id) return ssrVessel;
    return (
      store.vessels.find((v) => v.id === liveContract.vessel_id) ??
      VESSELS.find((v) => v.id === liveContract.vessel_id) ??
      ssrVessel
    );
  }, [liveContract, store.vessels, ssrVessel]);

  const slip = React.useMemo(() => {
    if (!liveContract?.slip_id) return ssrSlip;
    return SLIPS.find((s) => s.id === liveContract.slip_id) ?? ssrSlip;
  }, [liveContract, ssrSlip]);

  const [step, setStep] = React.useState<Step>(0);

  // Mark "link viewed" once on mount so staff sees the holder opened it.
  React.useEffect(() => {
    if (liveContract?.id && !liveContract.onboarding?.link_viewed_at) {
      markContractOnboardingStep(liveContract.id, "link_viewed_at");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveContract?.id]);

  if (!liveContract || !boater) {
    return (
      <main className="min-h-screen bg-canvas">
        <div className="mx-auto flex max-w-xl flex-col items-center px-6 py-24 text-center">
          <Anchor className="mb-3 size-8 text-fg-tertiary" />
          <h1 className="text-[20px] font-semibold text-fg">
            This onboarding link isn&apos;t valid
          </h1>
          <p className="mt-2 text-[13px] text-fg-subtle">
            The link may have expired, been replaced, or the contract was
            voided. Reach out to your marina if you need a new one.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto w-full max-w-[820px] px-5 py-8">
        {/* Marina header */}
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-[8px] bg-primary text-on-primary">
              <Anchor className="size-4" />
            </span>
            <span className="text-[14px] font-medium text-fg">Marina Stee</span>
          </div>
          <Badge tone="ok" size="sm">
            <ShieldCheck className="size-3" />
            Secure
          </Badge>
        </header>

        {/* Progress strip */}
        <Stepper currentIdx={step} />

        {/* Active step body */}
        <div className="mt-6 rounded-[14px] border border-hairline bg-surface-1 shadow-sm">
          {step === 0 && (
            <ReviewStep
              contract={liveContract}
              boater={boater}
              vessel={vessel}
              slip={slip}
              onContinue={() => setStep(1)}
            />
          )}
          {step === 1 && (
            <SignStep
              contract={liveContract}
              boater={boater}
              onSigned={() => setStep(2)}
              onBack={() => setStep(0)}
            />
          )}
          {step === 2 && (
            <PayStep
              contract={liveContract}
              boater={boater}
              onDone={() => setStep(3)}
              onBack={() => setStep(1)}
            />
          )}
          {step === 3 && (
            <DoneStep contract={liveContract} boater={boater} />
          )}
        </div>

        <footer className="mt-6 flex items-center justify-between text-[11px] text-fg-tertiary">
          <span>
            Contract <span className="font-mono">{liveContract.number}</span>{" "}
            · Token <span className="font-mono">{token.slice(0, 12)}…</span>
          </span>
          <span>
            Need help? Reply to the email or text you received from your marina.
          </span>
        </footer>
      </div>
    </main>
  );
}

// ── Progress stepper ──────────────────────────────────────────────────

function Stepper({ currentIdx }: { currentIdx: Step }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {STEPS.map((_, idx) => (
          <div
            key={idx}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              idx <= currentIdx ? "bg-primary" : "bg-surface-3"
            )}
          />
        ))}
      </div>
      <div className="flex gap-1.5">
        {STEPS.map((s, idx) => {
          const Icon = s.icon;
          const active = idx === currentIdx;
          const done = idx < currentIdx;
          return (
            <div
              key={s.id}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 text-[11px] uppercase tracking-wide",
                active && "font-medium text-fg",
                done && "text-fg-subtle",
                !active && !done && "text-fg-tertiary"
              )}
            >
              {done ? <CheckCircle2 className="size-3 text-status-ok" /> : <Icon className="size-3" />}
              {s.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Step 0: Review ────────────────────────────────────────────────────

function ReviewStep({
  contract,
  boater,
  vessel,
  slip,
  onContinue,
}: {
  contract: Contract;
  boater: Boater;
  vessel: Vessel | null;
  slip: Slip | null;
  onContinue: () => void;
}) {
  return (
    <div className="px-6 py-6">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        Welcome, {boater.first_name}
      </div>
      <h1 className="display-tight text-[24px] font-semibold text-fg">
        Let&apos;s get you settled in.
      </h1>
      <p className="mt-1 max-w-2xl text-[13px] text-fg-subtle">
        We&apos;ve prepared your slip lease. Take a minute to review it below.
        Next you&apos;ll sign and add a payment method — that&apos;s the whole flow.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
        <SummaryCard icon={<Anchor className="size-3.5" />} label="Slip">
          {slip ? (
            <>
              <div className="text-[15px] font-medium text-fg">
                {slip.dock} · {slip.number}
              </div>
              <div className="mt-0.5 text-[11px] text-fg-tertiary">
                Max LOA {Math.round(slip.max_loa_inches / 12)}&apos; · Power{" "}
                {slip.has_power ? "yes" : "no"} · Water {slip.has_water ? "yes" : "no"}
              </div>
            </>
          ) : (
            <span className="text-fg-tertiary">—</span>
          )}
        </SummaryCard>

        <SummaryCard icon={<Ship className="size-3.5" />} label="Vessel">
          {vessel ? (
            <>
              <div className="text-[15px] font-medium text-fg">{vessel.name}</div>
              <div className="mt-0.5 text-[11px] text-fg-tertiary">
                {[vessel.year, vessel.make, vessel.model].filter(Boolean).join(" ")}
              </div>
            </>
          ) : (
            <span className="text-[12px] italic text-fg-tertiary">
              No vessel on file yet — add one any time from your portal.
            </span>
          )}
        </SummaryCard>

        <SummaryCard icon={<FileText className="size-3.5" />} label="Term">
          <div className="text-[15px] font-medium text-fg">
            {contract.effective_start} → {contract.effective_end}
          </div>
          <div className="mt-0.5 text-[11px] capitalize text-fg-tertiary">
            {contract.billing_cadence} billing
          </div>
        </SummaryCard>

        <SummaryCard icon={<CreditCard className="size-3.5" />} label="Rate">
          {contract.annual_rate ? (
            <>
              <div className="money-display text-[20px] text-fg">
                {formatMoney(contract.annual_rate)}
              </div>
              <div className="mt-0.5 text-[11px] text-fg-tertiary">
                / year · billed {contract.billing_cadence}
              </div>
            </>
          ) : (
            <span className="text-fg-tertiary">—</span>
          )}
        </SummaryCard>
      </div>

      {contract.attachments && contract.attachments.length > 0 && (
        <div className="mt-5">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
            Documents
          </div>
          <ul className="space-y-1.5">
            {contract.attachments.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[12px]"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-fg">
                  {a.name}
                </span>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-primary hover:underline"
                >
                  Open
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex justify-end border-t border-hairline pt-4">
        <Button variant="primary" size="md" onClick={onContinue}>
          Continue to signature
        </Button>
      </div>
    </div>
  );
}

// ── Step 1: Sign ──────────────────────────────────────────────────────

function SignStep({
  contract,
  boater,
  onSigned,
  onBack,
}: {
  contract: Contract;
  boater: Boater;
  onSigned: () => void;
  onBack: () => void;
}) {
  const [signerName, setSignerName] = React.useState(
    `${boater.first_name} ${boater.last_name}`
  );
  const [hasSignature, setHasSignature] = React.useState(false);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  function commit() {
    if (!hasSignature || !signerName.trim()) return;
    const dataUrl = capturePadDataUrl(canvasRef.current);
    markContractOnboardingStep(contract.id, "signed_at", {
      signed_at: new Date().toISOString(),
      signer_name: signerName.trim(),
      signature_data_url: dataUrl,
    });
    onSigned();
  }

  return (
    <div className="px-6 py-6">
      <h2 className="text-[18px] font-semibold text-fg">Sign your agreement</h2>
      <p className="mt-1 text-[13px] text-fg-subtle">
        By signing below you agree to the terms of the slip lease (
        contract <span className="font-mono">{contract.number}</span>). A timestamped
        copy will be emailed to you.
      </p>

      <div className="mt-5 space-y-3">
        <label className="block">
          <span className="text-[12px] font-medium text-fg-subtle">
            Signer name
          </span>
          <input
            type="text"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            className="mt-1 block h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
          />
        </label>

        <div>
          <span className="text-[12px] font-medium text-fg-subtle">Signature</span>
          <div className="mt-1">
            <SignaturePad
              canvasRef={canvasRef}
              hasSignature={hasSignature}
              onChange={setHasSignature}
              signerName={signerName}
              height={160}
            />
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-hairline pt-4">
        <button
          type="button"
          onClick={onBack}
          className="text-[12px] text-fg-subtle hover:text-fg"
        >
          ← Back
        </button>
        <Button
          variant="primary"
          size="md"
          onClick={commit}
          disabled={!hasSignature || !signerName.trim()}
        >
          Sign and continue
        </Button>
      </div>
    </div>
  );
}

// ── Step 2: Pay (capture card) ────────────────────────────────────────

function PayStep({
  contract,
  boater,
  onDone,
  onBack,
}: {
  contract: Contract;
  boater: Boater;
  onDone: () => void;
  onBack: () => void;
}) {
  const [cardName, setCardName] = React.useState(
    `${boater.first_name} ${boater.last_name}`
  );
  const [cardNumber, setCardNumber] = React.useState("");
  const [expMonth, setExpMonth] = React.useState("");
  const [expYear, setExpYear] = React.useState("");
  const [zip, setZip] = React.useState(boater.address.zip ?? "");

  // For the demo we strip non-digits and just record the last 4 + a
  // brand guess. In production this is replaced with Stripe Elements
  // (or equivalent) and the PAN never touches our servers.
  const digitsOnly = cardNumber.replace(/\D/g, "");
  const last4 = digitsOnly.slice(-4);
  const brand = guessBrand(digitsOnly);
  const expMonthNum = Number(expMonth);
  const expYearNum = Number(expYear);
  const canCommit =
    cardName.trim().length > 0 &&
    digitsOnly.length >= 12 &&
    expMonthNum >= 1 &&
    expMonthNum <= 12 &&
    expYearNum >= new Date().getFullYear() % 100 &&
    last4.length === 4 &&
    zip.length >= 3;

  function commit() {
    if (!canCommit) return;
    const card: CardOnFile = {
      id: nextCardId(),
      brand,
      last4,
      exp_month: expMonthNum,
      exp_year: expYearNum < 100 ? 2000 + expYearNum : expYearNum,
      nickname: cardName.trim(),
      is_default: true,
      // In production this is the Stripe (or equivalent) token. In the
      // demo we mint a placeholder so the type is satisfied; no real
      // payment processor is wired.
      processor_token: `demo_tok_${Date.now().toString(36)}`,
    };
    addCardForBoater(boater.id, card);
    markContractOnboardingStep(contract.id, "card_added_at");
    onDone();
  }

  return (
    <div className="px-6 py-6">
      <h2 className="text-[18px] font-semibold text-fg">Add a payment method</h2>
      <p className="mt-1 text-[13px] text-fg-subtle">
        Your marina will charge this card per your billing cadence. You can swap
        it any time from your portal. Cards are tokenized — we never store the
        full number.
      </p>

      <div className="mt-5 space-y-3">
        <label className="block">
          <span className="text-[12px] font-medium text-fg-subtle">Name on card</span>
          <input
            type="text"
            value={cardName}
            onChange={(e) => setCardName(e.target.value)}
            className="mt-1 block h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-[12px] font-medium text-fg-subtle">Card number</span>
          <input
            type="text"
            value={cardNumber}
            onChange={(e) => setCardNumber(e.target.value)}
            inputMode="numeric"
            placeholder="4242 4242 4242 4242"
            className="mt-1 block h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 font-mono text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
          />
        </label>

        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-[12px] font-medium text-fg-subtle">Exp month</span>
            <input
              type="text"
              value={expMonth}
              onChange={(e) => setExpMonth(e.target.value.replace(/\D/g, "").slice(0, 2))}
              placeholder="MM"
              className="mt-1 block h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 font-mono text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-fg-subtle">Exp year</span>
            <input
              type="text"
              value={expYear}
              onChange={(e) => setExpYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="YYYY"
              className="mt-1 block h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 font-mono text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-fg-subtle">ZIP</span>
            <input
              type="text"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              className="mt-1 block h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
            />
          </label>
        </div>

        {digitsOnly.length >= 4 && (
          <div className="rounded-[10px] border border-hairline bg-surface-2 px-3 py-2 text-[12px] text-fg-subtle">
            We&apos;ll store{" "}
            <span className="font-medium text-fg">
              {brand.toUpperCase()} •••• {last4}
            </span>
            {expMonth && expYear && (
              <>
                {" "}exp{" "}
                <span className="font-medium text-fg">
                  {expMonth.padStart(2, "0")}/{expYear.length === 4 ? expYear.slice(-2) : expYear}
                </span>
              </>
            )}
            .
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-hairline pt-4">
        <button
          type="button"
          onClick={onBack}
          className="text-[12px] text-fg-subtle hover:text-fg"
        >
          ← Back
        </button>
        <Button variant="primary" size="md" onClick={commit} disabled={!canCommit}>
          Save card and finish
        </Button>
      </div>
    </div>
  );
}

function guessBrand(digits: string): CardOnFile["brand"] {
  if (digits.startsWith("4")) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "mastercard";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^6(?:011|5)/.test(digits)) return "discover";
  return "other";
}

// ── Step 3: Done ──────────────────────────────────────────────────────

function DoneStep({
  contract,
  boater,
}: {
  contract: Contract;
  boater: Boater;
}) {
  React.useEffect(() => {
    if (!contract.onboarding?.welcomed_at) {
      markContractOnboardingStep(contract.id, "welcomed_at");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract.id]);

  return (
    <div className="px-6 py-10 text-center">
      <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-status-ok/10 text-status-ok">
        <CheckCircle2 className="size-6" />
      </span>
      <h2 className="text-[22px] font-semibold text-fg">
        You&apos;re all set, {boater.first_name}.
      </h2>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-fg-subtle">
        Your contract is active. A signed copy and receipt confirmation will
        arrive in your inbox. Anything else — schedules, pump-outs, work orders
        — lives in your boater portal.
      </p>

      <div className="mx-auto mt-6 grid max-w-md grid-cols-1 gap-2">
        <a
          href={`/portal/${boater.id}`}
          className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-primary px-4 py-2.5 text-[14px] font-medium text-on-primary hover:opacity-90"
        >
          <Sparkles className="size-3.5" />
          Open your portal
        </a>
        <a
          href={`mailto:?subject=Slip lease ${contract.number} confirmation`}
          className="inline-flex items-center justify-center gap-2 rounded-[10px] border border-hairline bg-surface-1 px-4 py-2.5 text-[13px] text-fg-subtle hover:bg-surface-2"
        >
          <Mail className="size-3.5" />
          Email me a copy
        </a>
      </div>
    </div>
  );
}

// ── Shared subcomponents ──────────────────────────────────────────────

function SummaryCard({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-hairline bg-surface-2 px-4 py-3">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-fg-tertiary">
        {icon}
        {label}
      </div>
      <div className="text-[13px] text-fg">{children}</div>
    </div>
  );
}
