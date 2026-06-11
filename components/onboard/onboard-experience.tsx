"use client";

import * as React from "react";
import {
  Anchor,
  CheckCircle2,
  CreditCard,
  FileText,
  Lock,
  Ship,
  ShieldCheck,
  Smartphone,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SignaturePad, capturePadDataUrl } from "@/components/sign/signature-pad";
import {
  BOATERS,
  MARINA_PROFILES_BY_TENANT,
  SEED_TENANT_ID,
  SLIPS,
  VESSELS,
} from "@/lib/mock-data";
import {
  addCardForBoater,
  getContractByToken as getContractByTokenFromStore,
  markContractOnboardingStep,
  nextVesselId,
  upsertBoater,
  upsertContract,
  upsertVessel,
  useContractTemplates,
  useStore,
} from "@/lib/client-store";
import { resolveContractTokens } from "@/lib/contract-tokens";
import type { CardOnFile } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { Boater, Contract, Slip, Vessel } from "@/lib/types";
import { ContractMarkdown } from "@/components/contracts/contract-markdown";

/*
 * Boater-facing onboarding wizard. Resolves a Contract by its
 * signature_token and walks the holder through three steps:
 *
 *   1. PERSONAL INFO  — confirm / complete boater profile (name, contact,
 *                       address, emergency contact, insurance, paperless)
 *   2. VESSEL INFO    — pre-filled if a vessel is already on file;
 *                       otherwise a blank add-vessel form. Saves via
 *                       upsertVessel on submit so it's visible in staff UI.
 *   3. REVIEW & SIGN  — rendered contract body (with merge tokens filled
 *                       from live boater + vessel + slip + contract data)
 *                       + canvas signature pad + "I agree" checkbox.
 *                       On sign: upsertContract with status=executed.
 *
 * After signing a "signed" success screen is shown (no further steps).
 *
 * Token resolution and the "already signed" guard from the prior flow
 * are both preserved.
 */

type Step = 0 | 1 | 2 | 3;

const STEPS = [
  { id: "personal", label: "Personal Info", icon: User },
  { id: "vessel", label: "Vessel", icon: Ship },
  { id: "payment", label: "Payment", icon: CreditCard },
  { id: "sign", label: "Review & Sign", icon: ShieldCheck },
] as const;

// ────────────────────────────────────────────────────────────────────────────
// Root component
// ────────────────────────────────────────────────────────────────────────────

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
  // Subscribe to the live store so freshly-minted in-session tokens
  // resolve correctly even if they didn't make it into SSR mock data.
  const store = useStore();

  const liveContract = React.useMemo(
    () =>
      getContractByTokenFromStore(token) ??
      store.contracts.find((c) => c.signature_token === token) ??
      ssrContract,
    [store.contracts, token, ssrContract]
  );

  const baseBoater = React.useMemo(() => {
    if (!liveContract) return ssrBoater;
    return (
      store.boaters.find((b) => b.id === liveContract.boater_id) ??
      BOATERS.find((b) => b.id === liveContract.boater_id) ??
      ssrBoater
    );
  }, [liveContract, store.boaters, ssrBoater]);

  const baseVessel = React.useMemo(() => {
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
  const [signed, setSigned] = React.useState(false);

  // Boater edits accumulate here across steps 0 → 2.
  const [boaterDraft, setBoaterDraft] = React.useState<Boater | null>(null);
  // Vessel edits accumulate here across steps 1 → 2.
  const [vesselDraft, setVesselDraft] = React.useState<Vessel | null>(null);

  // Hydration guard — SSR renders with the SSR-passed props (which may be
  // null for freshly-minted in-session tokens). The client store resolves
  // the contract after hydration. Without this flag the two renders disagree
  // and React throws a hydration mismatch.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);

  // Mark link viewed on mount.
  React.useEffect(() => {
    if (liveContract?.id && !liveContract.onboarding?.link_viewed_at) {
      markContractOnboardingStep(liveContract.id, "link_viewed_at");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveContract?.id]);

  // ── Pre-hydration loading state ──────────────────────────────────────────
  // Before the client store hydrates we can't reliably know if the token
  // resolves — render a neutral shell so SSR and first client paint agree.
  if (!mounted) {
    return (
      <main className="min-h-screen bg-canvas">
        <div className="mx-auto w-full max-w-lg px-4 py-8" />
      </main>
    );
  }

  // ── Invalid link guard ───────────────────────────────────────────────────
  if (!liveContract || !baseBoater) {
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

  // ── Already-signed guard ─────────────────────────────────────────────────
  const alreadySigned =
    !signed &&
    (liveContract.status === "executed" ||
      liveContract.status === "active" ||
      !!liveContract.onboarding?.signed_at);

  if (alreadySigned) {
    return (
      <main className="min-h-screen bg-canvas">
        <div className="mx-auto flex max-w-xl flex-col items-center px-6 py-24 text-center">
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-status-ok/10 text-status-ok">
            <CheckCircle2 className="size-6" />
          </span>
          <h1 className="text-[20px] font-semibold text-fg">
            Already signed
          </h1>
          <p className="mt-2 text-[13px] text-fg-subtle">
            This contract has already been executed. If you need a copy,
            reply to the email or message you received from your marina.
          </p>
          {baseBoater.portal_token && (
            <a
              href={`/portal/${baseBoater.portal_token}`}
              className="mt-6 inline-flex items-center justify-center rounded-[10px] bg-primary px-5 py-2.5 text-[14px] font-medium text-on-primary hover:opacity-90"
            >
              Open your portal
            </a>
          )}
        </div>
      </main>
    );
  }

  const activeBoater = boaterDraft ?? baseBoater;
  const activeVessel = vesselDraft ?? baseVessel;

  // ── Signed success screen ────────────────────────────────────────────────
  if (signed) {
    return (
      <main className="min-h-screen bg-canvas">
        <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-24 text-center">
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-status-ok/10 text-status-ok">
            <CheckCircle2 className="size-6" />
          </span>
          <h2 className="text-[22px] font-semibold text-fg">
            Your contract has been signed.
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-[13px] text-fg-subtle">
            We&apos;ll be in touch shortly. A signed copy will be sent to the
            email on file.
          </p>
          {activeBoater.portal_token && (
            <a
              href={`/portal/${activeBoater.portal_token}`}
              className="mt-6 inline-flex items-center justify-center rounded-[10px] bg-primary px-5 py-2.5 text-[14px] font-medium text-on-primary hover:opacity-90"
            >
              Open your portal
            </a>
          )}
        </div>
      </main>
    );
  }

  // ── Main wizard shell ────────────────────────────────────────────────────
  // Widen the shell on the Review & Sign step so the contract renders
  // with letter-style margins instead of a cramped mobile column.
  const shellMaxW = step === 3 ? "max-w-3xl" : "max-w-lg";
  return (
    <main className="min-h-screen bg-canvas">
      <div className={cn("mx-auto w-full px-4 py-8 transition-[max-width] duration-200", shellMaxW)}>
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

        {/* Progress stepper */}
        <Stepper currentIdx={step} />

        {/* Step body */}
        <div className="mt-6 rounded-[14px] border border-hairline bg-surface-1 shadow-sm">
          {step === 0 && (
            <PersonalInfoStep
              boater={activeBoater}
              onNext={(updated) => {
                setBoaterDraft(updated);
                upsertBoater(updated);
                setStep(1);
              }}
            />
          )}
          {step === 1 && (
            <VesselInfoStep
              boater={activeBoater}
              vessel={activeVessel}
              contract={liveContract}
              onNext={(v) => {
                setVesselDraft(v);
                upsertVessel(v);
                // If the contract doesn't already link this vessel, patch it.
                if (liveContract.vessel_id !== v.id) {
                  upsertContract({ ...liveContract, vessel_id: v.id });
                }
                setStep(2);
              }}
              onBack={() => setStep(0)}
            />
          )}
          {step === 2 && (
            <PaymentStep
              boater={activeBoater}
              onDone={() => setStep(3)}
              onBack={() => setStep(1)}
            />
          )}
          {step === 3 && (
            <ReviewSignStep
              contract={liveContract}
              boater={activeBoater}
              vessel={activeVessel}
              slip={slip}
              onSigned={() => setSigned(true)}
              onBack={() => setStep(2)}
            />
          )}
        </div>

        <footer className="mt-6 flex items-center justify-between text-[11px] text-fg-tertiary">
          <span>
            Contract{" "}
            <span className="font-mono">{liveContract.number}</span>
            {" · "}Token{" "}
            <span className="font-mono">{token.slice(0, 12)}…</span>
          </span>
          <span>Questions? Reply to the message from your marina.</span>
        </footer>
      </div>
    </main>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Progress stepper
// ────────────────────────────────────────────────────────────────────────────

function Stepper({ currentIdx }: { currentIdx: Step }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {STEPS.map((_, idx) => (
          <div
            key={idx}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-300",
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
              {done ? (
                <CheckCircle2 className="size-3 text-status-ok" />
              ) : (
                <Icon className="size-3" />
              )}
              <span className="hidden sm:inline">{s.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Shared field component
// ────────────────────────────────────────────────────────────────────────────

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium text-fg-subtle">
        {label}
        {required && <span className="ml-0.5 text-status-danger">*</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputCls =
  "block h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none";

// ────────────────────────────────────────────────────────────────────────────
// Address autocomplete component
// ────────────────────────────────────────────────────────────────────────────
//
// Street address field with Google Places suggestions (address type).
// When the user selects a suggestion, city/state/zip auto-fill.
// Degrades gracefully when GOOGLE_PLACES_API_KEY is not set — the field
// works as a plain text input with no suggestions.

type AddressFields = { line1: string; city: string; state: string; zip: string };

function AddressAutocomplete({
  line1,
  city,
  state,
  zip,
  onLine1Change,
  onCityChange,
  onStateChange,
  onZipChange,
  onAutofill,
}: AddressFields & {
  onLine1Change: (v: string) => void;
  onCityChange: (v: string) => void;
  onStateChange: (v: string) => void;
  onZipChange: (v: string) => void;
  onAutofill: (a: AddressFields) => void;
}) {
  type Prediction = { placeId: string; description: string; mainText: string; secondaryText: string };
  const [predictions, setPredictions] = React.useState<Prediction[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const sessionTokenRef = React.useRef(Math.random().toString(36).slice(2));
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleStreetChange(v: string) {
    onLine1Change(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (v.length < 3) { setPredictions([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/places/autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: v, sessionToken: sessionTokenRef.current }),
        });
        if (res.ok) {
          const data = await res.json() as { predictions: Prediction[] };
          setPredictions(data.predictions ?? []);
          setOpen((data.predictions ?? []).length > 0);
        }
      } finally {
        setLoading(false);
      }
    }, 280);
  }

  async function selectPrediction(p: Prediction) {
    // Fill street immediately for responsiveness.
    onLine1Change(p.mainText);
    setOpen(false);
    setPredictions([]);

    // Fetch details to fill city/state/zip.
    try {
      const res = await fetch(
        `/api/places/details?placeId=${encodeURIComponent(p.placeId)}&sessionToken=${sessionTokenRef.current}`
      );
      if (res.ok) {
        const d = await res.json() as AddressFields;
        onAutofill(d);
        // Rotate session token — this session is spent.
        sessionTokenRef.current = Math.random().toString(36).slice(2);
      }
    } catch {
      // Details failed — street is still filled, user manually completes city/state/zip.
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Street address">
        <div className="relative">
          <input
            type="text"
            value={line1}
            onChange={(e) => handleStreetChange(e.target.value)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onFocus={() => predictions.length > 0 && setOpen(true)}
            placeholder="101 Main St"
            className={cn(inputCls, loading && "pr-8")}
            autoComplete="off"
          />
          {loading && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              <span className="block size-4 animate-spin rounded-full border-2 border-hairline border-t-primary" />
            </span>
          )}
          {open && predictions.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-[10px] border border-hairline bg-surface-1 shadow-xl">
              {predictions.map((p) => (
                <li key={p.placeId}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); void selectPrediction(p); }}
                    className="flex w-full flex-col px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className="text-[13px] font-medium text-fg">{p.mainText}</span>
                    <span className="text-[11px] text-fg-tertiary">{p.secondaryText}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Field>

      <div className="grid grid-cols-[1fr_80px_90px] gap-3">
        <Field label="City">
          <input
            type="text"
            value={city}
            onChange={(e) => onCityChange(e.target.value)}
            placeholder="Elephant Butte"
            className={inputCls}
            autoComplete="address-level2"
          />
        </Field>
        <Field label="State">
          <input
            type="text"
            value={state}
            onChange={(e) => onStateChange(e.target.value.toUpperCase().slice(0, 2))}
            placeholder="NM"
            className={inputCls}
            autoComplete="address-level1"
            maxLength={2}
          />
        </Field>
        <Field label="ZIP">
          <input
            type="text"
            value={zip}
            onChange={(e) => onZipChange(e.target.value.replace(/\D/g, "").slice(0, 5))}
            placeholder="87935"
            className={inputCls}
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={5}
          />
        </Field>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Step 0: Personal Info
// ────────────────────────────────────────────────────────────────────────────

function PersonalInfoStep({
  boater,
  onNext,
}: {
  boater: Boater;
  onNext: (updated: Boater) => void;
}) {
  const addr = boater.address;

  const [firstName, setFirstName] = React.useState(boater.first_name);
  const [lastName, setLastName] = React.useState(boater.last_name);
  const [email, setEmail] = React.useState(boater.primary_contact.email ?? "");
  const [phone, setPhone] = React.useState(boater.primary_contact.phone ?? "");

  // Additional contacts — we surface up to 3 meaningful contact fields
  const emergencyContact = boater.additional_contacts.find(
    (c) => c.role === "other" || c.role === "spouse"
  );
  const [emergencyName, setEmergencyName] = React.useState(
    emergencyContact?.name ?? ""
  );
  const [emergencyPhone, setEmergencyPhone] = React.useState(
    emergencyContact?.phone ?? ""
  );

  const [addrLine1, setAddrLine1] = React.useState(addr.line1 ?? "");
  const [addrCity, setAddrCity] = React.useState(addr.city ?? "");
  const [addrState, setAddrState] = React.useState(addr.state ?? "");
  const [addrZip, setAddrZip] = React.useState(addr.zip ?? "");

  const [paperless, setPaperless] = React.useState(
    boater.communication_prefs.preferred_channel === "email"
  );

  const canContinue =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    email.trim().length > 0 &&
    phone.trim().length > 0;

  function handleNext() {
    if (!canContinue) return;
    const updated: Boater = {
      ...boater,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      display_name: `${lastName.trim()}, ${firstName.trim()}`,
      primary_contact: {
        ...boater.primary_contact,
        email: email.trim(),
        phone: phone.trim(),
      },
      address: {
        ...boater.address,
        line1: addrLine1.trim(),
        city: addrCity.trim(),
        state: addrState.trim(),
        zip: addrZip.trim(),
      },
      communication_prefs: {
        ...boater.communication_prefs,
        preferred_channel: paperless ? "email" : boater.communication_prefs.preferred_channel,
      },
      additional_contacts: emergencyName.trim()
        ? [
            ...boater.additional_contacts.filter(
              (c) => c.role !== "other" && c.role !== "spouse"
            ),
            {
              id: emergencyContact?.id ?? `ec_${Date.now()}`,
              name: emergencyName.trim(),
              role: "other" as const,
              phone: emergencyPhone.trim() || undefined,
              preferred_channel: "sms" as const,
              can_be_billed: false,
            },
          ]
        : boater.additional_contacts,
    };
    onNext(updated);
  }

  return (
    <div className="px-5 py-6">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        Step 1 of 4
      </div>
      <h2 className="text-[20px] font-semibold text-fg">
        Confirm your details
      </h2>
      <p className="mt-1 text-[13px] text-fg-subtle">
        We pre-filled this from what the marina has on file. Review and
        update anything that&apos;s out of date before continuing.
      </p>

      <div className="mt-5 space-y-3.5">
        {/* Name row */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" required>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={inputCls}
              autoComplete="given-name"
            />
          </Field>
          <Field label="Last name" required>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={inputCls}
              autoComplete="family-name"
            />
          </Field>
        </div>

        {/* Contact */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Email address" required>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              autoComplete="email"
              inputMode="email"
            />
          </Field>
          <Field label="Phone (primary)" required>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputCls}
              autoComplete="tel"
              inputMode="tel"
            />
          </Field>
        </div>

        {/* Address — street uses Google Places autocomplete */}
        <AddressAutocomplete
          line1={addrLine1}
          city={addrCity}
          state={addrState}
          zip={addrZip}
          onLine1Change={setAddrLine1}
          onCityChange={setAddrCity}
          onStateChange={setAddrState}
          onZipChange={setAddrZip}
          onAutofill={(a) => {
            setAddrLine1(a.line1);
            setAddrCity(a.city);
            setAddrState(a.state);
            setAddrZip(a.zip);
          }}
        />

        {/* Emergency contact — flat fields, no nested box */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Emergency contact name">
            <input
              type="text"
              value={emergencyName}
              onChange={(e) => setEmergencyName(e.target.value)}
              placeholder="Jane Smith"
              className={inputCls}
              autoComplete="off"
            />
          </Field>
          <Field label="Emergency contact phone">
            <input
              type="tel"
              value={emergencyPhone}
              onChange={(e) => setEmergencyPhone(e.target.value)}
              placeholder="(555) 555-0100"
              className={inputCls}
              autoComplete="tel"
              inputMode="tel"
            />
          </Field>
        </div>

        {/* Paperless billing */}
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={paperless}
            onChange={(e) => setPaperless(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span className="text-[13px] text-fg-subtle">
            <span className="font-medium text-fg">Paperless billing</span>
            {" — "}
            Send invoices and receipts by email instead of mail.
          </span>
        </label>
      </div>

      <div className="mt-6 flex justify-end border-t border-hairline pt-4">
        <Button
          variant="primary"
          size="md"
          onClick={handleNext}
          disabled={!canContinue}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Step 1: Vessel Info
// ────────────────────────────────────────────────────────────────────────────

function VesselInfoStep({
  boater,
  vessel,
  contract,
  onNext,
  onBack,
}: {
  boater: Boater;
  vessel: Vessel | null | undefined;
  contract: Contract;
  onNext: (v: Vessel) => void;
  onBack: () => void;
}) {
  const [name, setName] = React.useState(vessel?.name ?? "");
  const [year, setYear] = React.useState(
    vessel?.year != null ? String(vessel.year) : ""
  );
  const [make, setMake] = React.useState(vessel?.make ?? "");
  const [model, setModel] = React.useState(vessel?.model ?? "");
  const [registration, setRegistration] = React.useState(
    vessel?.registration ?? ""
  );
  // loa_inches stored internally; we show/collect in feet
  const [lengthFt, setLengthFt] = React.useState(
    vessel?.loa_inches != null ? String(Math.round(vessel.loa_inches / 12)) : ""
  );

  const canContinue = name.trim().length > 0;

  function handleNext() {
    if (!canContinue) return;
    const yearNum = year.trim() ? parseInt(year.trim(), 10) : undefined;
    const loaInches = lengthFt.trim()
      ? parseFloat(lengthFt.trim()) * 12
      : undefined;

    const v: Vessel = vessel
      ? {
          ...vessel,
          name: name.trim(),
          year: yearNum,
          make: make.trim() || undefined,
          model: model.trim() || undefined,
          registration: registration.trim() || undefined,
          loa_inches: loaInches,
        }
      : {
          id: nextVesselId(),
          boater_id: boater.id,
          co_owner_ids: [],
          name: name.trim(),
          year: yearNum,
          make: make.trim() || undefined,
          model: model.trim() || undefined,
          registration: registration.trim() || undefined,
          loa_inches: loaInches,
          active: true,
        };
    onNext(v);
  }

  return (
    <div className="px-5 py-6">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        Step 2 of 4
      </div>
      <h2 className="text-[20px] font-semibold text-fg">
        {vessel ? "Confirm your vessel" : "Add your vessel"}
      </h2>
      <p className="mt-1 text-[13px] text-fg-subtle">
        {vessel
          ? "We have this on file — update anything that has changed."
          : "Enter your boat details so they're reflected in your contract."}
      </p>

      <div className="mt-5 space-y-3.5">
        <Field label="Boat name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sea Breeze"
            className={inputCls}
          />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Year">
            <input
              type="text"
              value={year}
              onChange={(e) =>
                setYear(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              placeholder="2022"
              className={inputCls}
              inputMode="numeric"
            />
          </Field>
          <Field label="Make">
            <input
              type="text"
              value={make}
              onChange={(e) => setMake(e.target.value)}
              placeholder="Sea Ray"
              className={inputCls}
            />
          </Field>
          <Field label="Model">
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="SPX 190"
              className={inputCls}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Registration #">
            <input
              type="text"
              value={registration}
              onChange={(e) => setRegistration(e.target.value.toUpperCase())}
              placeholder="MI-1234-AB"
              className={cn(inputCls, "font-mono uppercase")}
            />
          </Field>
          <Field label="Length (feet)">
            <input
              type="text"
              value={lengthFt}
              onChange={(e) =>
                setLengthFt(e.target.value.replace(/[^\d.]/g, ""))
              }
              placeholder="21"
              className={inputCls}
              inputMode="decimal"
            />
          </Field>
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
          onClick={handleNext}
          disabled={!canContinue}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Step 2: Review + Sign
// ────────────────────────────────────────────────────────────────────────────

function ReviewSignStep({
  contract,
  boater,
  vessel,
  slip,
  onSigned,
  onBack,
}: {
  contract: Contract;
  boater: Boater;
  vessel: Vessel | null | undefined;
  slip: Slip | null | undefined;
  onSigned: () => void;
  onBack: () => void;
}) {
  const [signerName, setSignerName] = React.useState(
    `${boater.first_name} ${boater.last_name}`
  );
  const [hasSignature, setHasSignature] = React.useState(false);
  const [agreed, setAgreed] = React.useState(false);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  // Look up the contract template so we can fall back to its body_markdown
  // when the contract itself hasn't been individually drafted yet (the
  // common case in the prototype where staff just sends the standard template).
  const templates = useContractTemplates();
  const template = templates.find((t) => t.id === contract.template_id);

  // Holder onboarding is unauthenticated — the operator's marina profile
  // is looked up by the boater's tenant_id directly from the seed table
  // (no Clerk session is in scope here). Falls back to the seed tenant
  // when the boater predates per-row tenant scoping. {{marina.*}} tokens
  // render as literal placeholders if no profile matches.
  const tenantId = boater.tenant_id ?? SEED_TENANT_ID;
  const marina = MARINA_PROFILES_BY_TENANT[tenantId];

  const resolvedBody = React.useMemo(
    () =>
      resolveContractTokens(
        contract,
        boater,
        vessel,
        slip,
        template?.body_markdown,
        marina,
      ),
    [contract, boater, vessel, slip, template?.body_markdown, marina],
  );

  const canSign =
    signerName.trim().length > 0 && hasSignature && agreed;

  function commit() {
    if (!canSign) return;
    const dataUrl = capturePadDataUrl(canvasRef.current);
    const now = new Date().toISOString();

    upsertContract({
      ...contract,
      status: "executed",
      signed_at: now,
      signer_name: signerName.trim(),
      signature_data_url: dataUrl,
      signer_ip: "client",
      onboarding: {
        ...(contract.onboarding ?? {}),
        signed_at: now,
      },
    });

    onSigned();
  }

  return (
    <div className="px-5 py-6">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        Step 4 of 4
      </div>
      <h2 className="text-[20px] font-semibold text-fg">
        Review &amp; sign
      </h2>
      <p className="mt-1 text-[13px] text-fg-subtle">
        Read your contract below, then sign and confirm.
      </p>

      {/* Contract body — rendered as a real document on a white page
          with letter-style margins. Wider than the rest of the wizard so
          it reads professionally. Scroll inside, not page-scroll. */}
      <div className="mt-4 max-h-[60vh] overflow-y-auto rounded-[12px] border border-hairline bg-white shadow-inner">
        {/* Contract document ink — intentionally hard-coded #3C4E63
            (Soft Navy) regardless of the operator's app theme so the
            printed/scanned signed copy looks the same as the holder's
            on-screen render. NOT a brand token because contract bodies
            must be theme-independent. */}
        <div className="mx-auto max-w-[680px] px-10 py-12 text-[13.5px] leading-[1.65] text-[#3C4E63]">
          {resolvedBody ? (
            <ContractMarkdown body={resolvedBody} variant="compact" />
          ) : (
            <ContractSummaryFallback
              contract={contract}
              vessel={vessel}
              slip={slip}
            />
          )}
        </div>
      </div>

      {/* Signature capture */}
      <div className="mt-5 space-y-3.5">
        <Field label="Signer name" required>
          <input
            type="text"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            className={inputCls}
          />
        </Field>

        <div>
          <span className="text-[12px] font-medium text-fg-subtle">
            Signature<span className="ml-0.5 text-status-danger">*</span>
          </span>
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

        {/* Agreement checkbox */}
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span className="text-[13px] text-fg-subtle">
            <span className="font-medium text-fg">
              I have read and agree to all terms
            </span>{" "}
            in this contract (
            <span className="font-mono text-[12px]">{contract.number}</span>
            ). I understand this constitutes a legally binding agreement.
          </span>
        </label>
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
          disabled={!canSign}
        >
          Sign contract
        </Button>
      </div>
    </div>
  );
}

// Markdown rendering lives in components/contracts/contract-markdown.tsx —
// shared with the operator-side Contract Preview Sheet so both surfaces
// see identical structure + numbering.

// ────────────────────────────────────────────────────────────────────────────
// Fallback summary when no body_markdown is set on the contract/template
// ────────────────────────────────────────────────────────────────────────────

function ContractSummaryFallback({
  contract,
  vessel,
  slip,
}: {
  contract: Contract;
  vessel: Vessel | null | undefined;
  slip: Slip | null | undefined;
}) {
  return (
    <div className="space-y-2 text-[13px] text-fg">
      <p className="font-medium">
        Slip Lease Agreement — {contract.number}
      </p>
      <div className="rounded-[8px] border border-hairline bg-surface-1 px-3 py-2 text-[12px] space-y-1 text-fg-subtle">
        <div>
          <span className="font-medium text-fg">Slip: </span>
          {slip ? `${slip.dock} · ${slip.number}` : "—"}
        </div>
        <div>
          <span className="font-medium text-fg">Vessel: </span>
          {vessel ? vessel.name : "—"}
        </div>
        <div>
          <span className="font-medium text-fg">Term: </span>
          {contract.effective_start} → {contract.effective_end}
        </div>
        {contract.annual_rate && (
          <div>
            <span className="font-medium text-fg">Rate: </span>
            ${contract.annual_rate.toLocaleString()} / year ·{" "}
            {contract.billing_cadence} billing
          </div>
        )}
      </div>
      <p className="text-[12px] text-fg-subtle">
        By signing below you agree to occupy the assigned slip under the
        marina&apos;s standard terms and conditions, and to pay all fees
        when due. You may request a copy of the full agreement from your
        marina at any time.
      </p>
    </div>
  );
}

// ── Step 3 — Payment method ──────────────────────────────────────────────────
//
// Collects a payment method after the contract is signed.
// In production this mounts Stripe Elements (or equivalent).
// In the prototype we mock the card tokenization — the UI is complete
// including Apple Pay / Google Pay button, card form, and ACH option.

type PayMethod = "card" | "ach" | "wallet";

function PaymentStep({
  boater,
  onDone,
  onBack,
}: {
  boater: Boater;
  onDone: () => void;
  onBack: () => void;
}) {
  const [method, setMethod] = React.useState<PayMethod>("card");

  // Card fields
  const [cardNumber, setCardNumber] = React.useState("");
  const [expiry, setExpiry] = React.useState("");
  const [cvv, setCvv] = React.useState("");
  const [zip, setZip] = React.useState("");
  const [nameOnCard, setNameOnCard] = React.useState(boater.display_name ?? "");

  // ACH fields
  const [routingNum, setRoutingNum] = React.useState("");
  const [accountNum, setAccountNum] = React.useState("");
  const [accountType, setAccountType] = React.useState<"checking" | "savings">("checking");

  const [saving, setSaving] = React.useState(false);
  const [walletDone, setWalletDone] = React.useState(false);

  // Validate card form completeness (prototype-level only — no Luhn check)
  const cardReady =
    cardNumber.replace(/\s/g, "").length >= 15 &&
    expiry.length === 5 &&
    cvv.length >= 3 &&
    zip.length === 5 &&
    nameOnCard.trim().length > 0;

  const achReady =
    routingNum.length === 9 &&
    accountNum.length >= 4;

  function formatCardNumber(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 16);
    return digits.replace(/(.{4})/g, "$1 ").trim();
  }

  function formatExpiry(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 4);
    if (digits.length >= 3) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return digits;
  }

  function saveCard() {
    if (!cardReady || saving) return;
    setSaving(true);
    // Prototype: mock tokenization — store last4 + brand heuristic
    const last4 = cardNumber.replace(/\s/g, "").slice(-4);
    const first = cardNumber.replace(/\s/g, "")[0];
    const brand: CardOnFile["brand"] =
      first === "4" ? "visa" : first === "5" ? "mastercard" : first === "3" ? "amex" : "other";
    const [expM, expY] = expiry.split("/");
    const card: CardOnFile = {
      id: `card_onboard_${Date.now()}`,
      brand,
      last4,
      exp_month: parseInt(expM, 10),
      exp_year: 2000 + parseInt(expY, 10),
      is_default: true,
      processor_token: `tok_prototype_${last4}`,
    };
    addCardForBoater(boater.id, card);
    setSaving(false);
    onDone();
  }

  function saveAch() {
    if (!achReady || saving) return;
    setSaving(true);
    const card: CardOnFile = {
      id: `ach_onboard_${Date.now()}`,
      brand: "other",
      last4: accountNum.slice(-4),
      exp_month: 12,
      exp_year: 2099,
      nickname: `${accountType === "checking" ? "Checking" : "Savings"} ···${accountNum.slice(-4)}`,
      is_default: true,
      processor_token: `tok_ach_prototype_${routingNum.slice(-4)}`,
    };
    addCardForBoater(boater.id, card);
    setSaving(false);
    onDone();
  }

  function simulateWalletPay() {
    // In production: window.PaymentRequest / Stripe's paymentRequest button
    setWalletDone(true);
    const card: CardOnFile = {
      id: `wallet_onboard_${Date.now()}`,
      brand: "visa",
      last4: "0000",
      exp_month: 12,
      exp_year: 2099,
      nickname: "Apple Pay",
      is_default: true,
      processor_token: "tok_wallet_prototype",
    };
    addCardForBoater(boater.id, card);
    setTimeout(onDone, 600);
  }

  return (
    <div className="space-y-5 p-6">
      <div>
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          Step 3 of 4
        </div>
        <h2 className="text-[20px] font-semibold text-fg">Add a payment method</h2>
        <p className="mt-1 text-[13px] text-fg-subtle">
          We&apos;ll save this securely for your future invoices. Nothing is
          charged today — your card kicks in once you sign and your slip
          term begins.
        </p>
      </div>

      {/* Method picker */}
      <div className="grid grid-cols-3 gap-2">
        {(["card", "ach", "wallet"] as PayMethod[]).map((m) => {
          const labels: Record<PayMethod, string> = {
            card: "Credit / Debit",
            ach: "Bank account",
            wallet: "Apple / Google Pay",
          };
          const icons: Record<PayMethod, React.ReactNode> = {
            card: <CreditCard className="size-4" />,
            ach: <FileText className="size-4" />,
            wallet: <Smartphone className="size-4" />,
          };
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-[10px] border px-2 py-3 text-[11px] font-medium transition-colors",
                method === m
                  ? "border-primary bg-primary/[0.05] text-primary"
                  : "border-hairline bg-surface-2 text-fg-subtle hover:border-hairline-strong hover:text-fg"
              )}
            >
              {icons[m]}
              {labels[m]}
            </button>
          );
        })}
      </div>

      {/* Card form */}
      {method === "card" && (
        <div className="space-y-3">
          <PayField label="Name on card">
            <input
              value={nameOnCard}
              onChange={(e) => setNameOnCard(e.target.value)}
              placeholder="Jane Smith"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2.5 text-[14px] text-fg focus:border-primary focus:outline-none"
            />
          </PayField>
          <PayField label="Card number">
            <input
              value={cardNumber}
              onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
              inputMode="numeric"
              placeholder="4242 4242 4242 4242"
              maxLength={19}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2.5 font-mono text-[14px] tracking-wider text-fg focus:border-primary focus:outline-none"
            />
          </PayField>
          <div className="grid grid-cols-2 gap-3">
            <PayField label="Expiry">
              <input
                value={expiry}
                onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                inputMode="numeric"
                placeholder="MM/YY"
                maxLength={5}
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2.5 font-mono text-[14px] text-fg focus:border-primary focus:outline-none"
              />
            </PayField>
            <PayField label="CVV">
              <input
                value={cvv}
                onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                inputMode="numeric"
                placeholder="123"
                maxLength={4}
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2.5 font-mono text-[14px] text-fg focus:border-primary focus:outline-none"
              />
            </PayField>
          </div>
          <PayField label="Billing ZIP">
            <input
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
              inputMode="numeric"
              placeholder="87935"
              maxLength={5}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2.5 font-mono text-[14px] text-fg focus:border-primary focus:outline-none"
            />
          </PayField>
        </div>
      )}

      {/* ACH form */}
      {method === "ach" && (
        <div className="space-y-3">
          <div className="rounded-[8px] border border-status-info/30 bg-status-info/[0.05] px-3 py-2 text-[12px] text-status-info">
            Bank transfers take 3–5 business days to verify. Marina staff will confirm once active.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <PayField label="Account type" col={2}>
              <div className="flex gap-2">
                {(["checking", "savings"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setAccountType(t)}
                    className={cn(
                      "flex-1 rounded-[8px] border py-2 text-[13px] font-medium capitalize transition-colors",
                      accountType === t
                        ? "border-primary bg-primary/[0.05] text-primary"
                        : "border-hairline text-fg-subtle hover:border-hairline-strong"
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </PayField>
          </div>
          <PayField label="Routing number (9 digits)">
            <input
              value={routingNum}
              onChange={(e) => setRoutingNum(e.target.value.replace(/\D/g, "").slice(0, 9))}
              inputMode="numeric"
              placeholder="021000021"
              maxLength={9}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2.5 font-mono text-[14px] text-fg focus:border-primary focus:outline-none"
            />
          </PayField>
          <PayField label="Account number">
            <input
              value={accountNum}
              onChange={(e) => setAccountNum(e.target.value.replace(/\D/g, "").slice(0, 17))}
              inputMode="numeric"
              placeholder="000123456789"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2.5 font-mono text-[14px] text-fg focus:border-primary focus:outline-none"
            />
          </PayField>
        </div>
      )}

      {/* Wallet */}
      {method === "wallet" && (
        <div className="flex flex-col items-center gap-3 py-4">
          {walletDone ? (
            <span className="flex size-10 items-center justify-center rounded-full bg-status-ok/15 text-status-ok">
              <CheckCircle2 className="size-6" />
            </span>
          ) : (
            <button
              type="button"
              onClick={simulateWalletPay}
              className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-fg px-5 py-3.5 text-[15px] font-medium text-canvas transition-opacity hover:opacity-90"
            >
              <Smartphone className="size-4" />
              Pay with Apple / Google Pay
            </button>
          )}
          <p className="text-center text-[11px] text-fg-tertiary">
            Your device&apos;s native payment sheet will open. Nothing is charged today.
          </p>
        </div>
      )}

      {/* Security note */}
      <div className="flex items-center gap-2 text-[11px] text-fg-tertiary">
        <Lock className="size-3.5 shrink-0" />
        Your payment info is encrypted and stored securely. Marina Stee never stores raw card numbers.
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between border-t border-hairline pt-4">
        <button
          type="button"
          onClick={onBack}
          className="text-[13px] text-fg-subtle hover:text-fg"
        >
          ← Back
        </button>
        {method === "card" && (
          <button
            type="button"
            onClick={saveCard}
            disabled={!cardReady || saving}
            className={cn(
              "rounded-[10px] px-5 py-2.5 text-[14px] font-medium transition-colors",
              cardReady
                ? "bg-primary text-on-primary hover:bg-primary-hover"
                : "cursor-not-allowed bg-surface-3 text-fg-tertiary"
            )}
          >
            {saving ? "Saving…" : "Save card →"}
          </button>
        )}
        {method === "ach" && (
          <button
            type="button"
            onClick={saveAch}
            disabled={!achReady || saving}
            className={cn(
              "rounded-[10px] px-5 py-2.5 text-[14px] font-medium transition-colors",
              achReady
                ? "bg-primary text-on-primary hover:bg-primary-hover"
                : "cursor-not-allowed bg-surface-3 text-fg-tertiary"
            )}
          >
            {saving ? "Saving…" : "Save account →"}
          </button>
        )}
        {method === "wallet" && !walletDone && (
          <span className="text-[12px] text-fg-tertiary">Use the button above</span>
        )}
      </div>
    </div>
  );
}

function PayField({
  label,
  col,
  children,
}: {
  label: string;
  col?: number;
  children: React.ReactNode;
}) {
  return (
    <div className={col === 2 ? "col-span-2" : ""}>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </label>
      {children}
    </div>
  );
}
