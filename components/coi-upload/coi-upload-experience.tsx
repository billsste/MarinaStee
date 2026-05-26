"use client";

import * as React from "react";
import {
  ShieldCheck,
  CheckCircle2,
  FileText,
  CalendarRange,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getInsuranceByUploadToken,
  markCoiUploadStep,
  submitRenewedCoi,
  useStore,
} from "@/lib/client-store";
import type { Boater, InsuranceCertificate, Vessel } from "@/lib/types";

/*
 * Boater COI renewal experience.
 *
 *   1. REVIEW — see expiring policy on file
 *   2. UPLOAD — drop new PDF + fill new fields
 *   3. DONE   — confirmation, staff inbound comm fires
 */
type Step = 0 | 1 | 2;

export function CoiUploadExperience({
  token,
  ssrCoi,
  ssrBoater,
  ssrVessel,
}: {
  token: string;
  ssrCoi: InsuranceCertificate | null;
  ssrBoater: Boater | null;
  ssrVessel: Vessel | null;
}) {
  const store = useStore();
  const liveCoi = React.useMemo(
    () =>
      getInsuranceByUploadToken(token) ??
      store.insurance.find((c) => c.upload_token === token) ??
      ssrCoi,
    [store.insurance, token, ssrCoi]
  );
  const boater = React.useMemo(() => {
    if (!liveCoi) return ssrBoater;
    return store.boaters.find((b) => b.id === liveCoi.boater_id) ?? ssrBoater;
  }, [liveCoi, store.boaters, ssrBoater]);
  const vessel = React.useMemo(() => {
    if (!liveCoi) return ssrVessel;
    return store.vessels.find((v) => v.id === liveCoi.vessel_id) ?? ssrVessel;
  }, [liveCoi, store.vessels, ssrVessel]);

  const [step, setStep] = React.useState<Step>(0);

  React.useEffect(() => {
    if (liveCoi?.id && !liveCoi.upload_link_viewed_at) {
      markCoiUploadStep(liveCoi.id, "viewed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveCoi?.id]);

  if (!liveCoi) {
    return (
      <main className="min-h-screen bg-canvas">
        <div className="mx-auto max-w-xl px-6 py-24 text-center">
          <ShieldCheck className="mx-auto mb-3 size-8 text-fg-tertiary" />
          <h1 className="text-[20px] font-semibold text-fg">
            This upload link isn&apos;t valid
          </h1>
          <p className="mt-2 text-[13px] text-fg-subtle">
            The link may have expired or already been used. Please reach out to
            the marina if you think this is a mistake.
          </p>
        </div>
      </main>
    );
  }

  const customerFirst = boater?.first_name ?? "there";
  const expired = new Date(liveCoi.effective_end).getTime() < Date.now();

  return (
    <main className="min-h-screen bg-canvas">
      {/* Top bar */}
      <header className="border-b border-hairline bg-surface-1">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-[6px] bg-primary text-on-primary">
              <span className="font-semibold text-[12px]">M</span>
            </div>
            <span className="text-[13px] font-medium text-fg">Marina Stee</span>
          </div>
          <Badge tone={expired ? "danger" : "warn"} size="sm">
            {expired ? "Expired" : "Expiring"}
          </Badge>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-5 py-6">
        {step === 0 && (
          <ReviewStep
            coi={liveCoi}
            vessel={vessel}
            customerFirst={customerFirst}
            onContinue={() => setStep(1)}
          />
        )}
        {step === 1 && (
          <UploadStep
            coi={liveCoi}
            onBack={() => setStep(0)}
            onSubmitted={() => setStep(2)}
          />
        )}
        {step === 2 && <DoneStep customerFirst={customerFirst} />}
      </div>
    </main>
  );
}

// ── Step 0 — Review existing policy ──────────────────────────────

function ReviewStep({
  coi,
  vessel,
  customerFirst,
  onContinue,
}: {
  coi: InsuranceCertificate;
  vessel: Vessel | null;
  customerFirst: string;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="display-tight text-[24px] font-semibold text-fg">
          Hi {customerFirst}, time to renew your COI.
        </h1>
        <p className="mt-1 text-[14px] text-fg-subtle">
          Your insurance certificate is expiring. Upload the renewed policy
          here — it should take about a minute.
        </p>
      </div>

      <section className="rounded-[12px] border border-hairline bg-surface-1">
        <div className="border-b border-hairline bg-surface-2 px-4 py-2.5 text-[13px] font-medium text-fg">
          On file
        </div>
        <div className="p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <span className="text-[15px] font-medium text-fg">{coi.carrier}</span>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
            <div>
              <dt className="text-fg-tertiary">Vessel</dt>
              <dd className="text-fg">{vessel?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-fg-tertiary">Policy #</dt>
              <dd className="font-mono text-fg">{coi.policy_number}</dd>
            </div>
            <div>
              <dt className="text-fg-tertiary">Effective</dt>
              <dd className="text-fg">
                {coi.effective_start} → {coi.effective_end}
              </dd>
            </div>
            <div>
              <dt className="text-fg-tertiary">Liability</dt>
              <dd className="tabular text-fg">
                ${coi.liability_limit.toLocaleString()}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <div className="rounded-[12px] border border-status-info/30 bg-status-info/[0.05] px-4 py-3 text-[12px] leading-relaxed text-fg-subtle">
        <strong className="text-fg">What you&apos;ll need:</strong> the renewed
        policy PDF from your insurer, plus the new effective dates and
        liability limit. We&apos;ll re-check coverage against your slip
        requirements automatically.
      </div>

      <div className="flex justify-end">
        <Button variant="primary" onClick={onContinue}>
          Upload renewed COI →
        </Button>
      </div>
    </div>
  );
}

// ── Step 1 — Upload form ─────────────────────────────────────────

function UploadStep({
  coi,
  onBack,
  onSubmitted,
}: {
  coi: InsuranceCertificate;
  onBack: () => void;
  onSubmitted: () => void;
}) {
  const [carrier, setCarrier] = React.useState(coi.carrier);
  const [policyNumber, setPolicyNumber] = React.useState(coi.policy_number);
  const [liability, setLiability] = React.useState(String(coi.liability_limit));
  const [hullValue, setHullValue] = React.useState(
    coi.hull_value != null ? String(coi.hull_value) : ""
  );
  const [effectiveStart, setEffectiveStart] = React.useState(coi.effective_end);
  const [effectiveEnd, setEffectiveEnd] = React.useState(() => {
    const d = new Date(coi.effective_end);
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [file, setFile] = React.useState<{ name: string; dataUrl: string; size: number } | null>(
    null
  );
  const [submitting, setSubmitting] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(f);
    });
    setFile({ name: f.name, dataUrl, size: f.size });
  }

  const liabilityNum = Number(liability);
  const hullValueNum = hullValue ? Number(hullValue) : undefined;
  const canSubmit =
    carrier.trim().length > 0 &&
    policyNumber.trim().length > 0 &&
    liabilityNum > 0 &&
    effectiveStart.length > 0 &&
    effectiveEnd.length > 0 &&
    effectiveStart <= effectiveEnd &&
    !!file;

  function submit() {
    if (!canSubmit || !file) return;
    setSubmitting(true);
    try {
      submitRenewedCoi(coi.id, {
        carrier: carrier.trim(),
        policy_number: policyNumber.trim(),
        liability_limit: liabilityNum,
        hull_value: hullValueNum,
        effective_start: effectiveStart,
        effective_end: effectiveEnd,
        pdf_url: file.dataUrl,
      });
      onSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="display-tight text-[22px] font-semibold text-fg">
          New policy details
        </h1>
        <p className="mt-1 text-[13px] text-fg-subtle">
          Most fields pre-filled from your old policy — adjust where the new
          one differs.
        </p>
      </div>

      {/* File upload */}
      <section className="rounded-[12px] border border-hairline bg-surface-1 p-4">
        <div className="text-[12px] font-medium text-fg-subtle">
          Policy PDF <span className="text-status-danger">*</span>
        </div>
        {!file ? (
          <label className="mt-2 flex cursor-pointer flex-col items-center gap-2 rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 px-4 py-8 text-center hover:bg-surface-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={handleFile}
              className="hidden"
            />
            <Upload className="size-5 text-fg-tertiary" />
            <span className="text-[13px] text-fg-subtle">
              Drop the renewed policy PDF here
            </span>
            <span className="text-[11px] text-fg-tertiary">PDF, up to 10MB</span>
          </label>
        ) : (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <FileText className="size-4 text-primary" />
              <div className="min-w-0">
                <div className="truncate text-[13px] text-fg">{file.name}</div>
                <div className="text-[11px] text-fg-tertiary">
                  {(file.size / 1024).toFixed(0)} KB
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFile(null)}
              className="text-fg-subtle hover:text-status-danger"
              aria-label="Remove file"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
      </section>

      {/* Carrier + policy */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldLabel label="Carrier">
          <Input value={carrier} onChange={setCarrier} placeholder="BoatU.S. Insurance" />
        </FieldLabel>
        <FieldLabel label="Policy #">
          <Input
            value={policyNumber}
            onChange={setPolicyNumber}
            placeholder="POL-12345"
          />
        </FieldLabel>
      </div>

      {/* Effective range */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldLabel label="Effective start">
          <input
            type="date"
            value={effectiveStart}
            onChange={(e) => setEffectiveStart(e.target.value)}
            className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
          />
        </FieldLabel>
        <FieldLabel label="Effective end">
          <input
            type="date"
            value={effectiveEnd}
            onChange={(e) => setEffectiveEnd(e.target.value)}
            className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
          />
        </FieldLabel>
      </div>
      {effectiveStart && effectiveEnd && effectiveStart > effectiveEnd && (
        <p className="text-[12px] text-status-danger">
          End date must be after start.
        </p>
      )}

      {/* Limits */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldLabel label="Liability limit ($)">
          <Input
            value={liability}
            onChange={setLiability}
            placeholder="500000"
            inputMode="numeric"
          />
        </FieldLabel>
        <FieldLabel label="Hull value (optional, $)">
          <Input
            value={hullValue}
            onChange={setHullValue}
            placeholder="75000"
            inputMode="numeric"
          />
        </FieldLabel>
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          className="text-[12px] text-fg-subtle hover:text-fg"
        >
          ← Back
        </button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={!canSubmit || submitting}
        >
          {submitting ? "Uploading…" : "Submit renewed COI →"}
        </Button>
      </div>
    </div>
  );
}

// ── Step 2 — Done ────────────────────────────────────────────────

function DoneStep({ customerFirst }: { customerFirst: string }) {
  return (
    <div className="space-y-4">
      <div className="rounded-[14px] border border-status-ok/30 bg-status-ok/[0.05] px-5 py-6 text-center">
        <CheckCircle2 className="mx-auto size-8 text-status-ok" />
        <h1 className="display-tight mt-2 text-[24px] font-semibold text-fg">
          Got it, {customerFirst}. Thank you.
        </h1>
        <p className="mt-1 text-[13px] text-fg-subtle">
          We&apos;ve received your renewed certificate. Marina staff will verify
          coverage and let you know if anything else is needed.
        </p>
      </div>

      <section className="rounded-[12px] border border-hairline bg-surface-1 p-4 text-[12px] text-fg-subtle">
        <div className="flex items-center gap-2 text-fg">
          <CalendarRange className="size-4 text-primary" />
          <span className="font-medium">What happens next</span>
        </div>
        <ul className="mt-2 ml-5 list-disc space-y-1">
          <li>Staff reviews the new policy (usually within 1 business day)</li>
          <li>If coverage meets slip requirements, you&apos;re good for the season</li>
          <li>If anything&apos;s off, we&apos;ll reach out</li>
        </ul>
      </section>
    </div>
  );
}

// ── Inline helpers ──────────────────────────────────────────────

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[12px] font-medium text-fg-subtle">{label}</div>
      {children}
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
