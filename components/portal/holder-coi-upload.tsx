"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronLeft,
  FileText,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  submitRenewedCoi,
  useStore,
} from "@/lib/client-store";
import {
  classifyCoiStatus,
  coiStatusLabel,
  coiStatusTone,
} from "@/lib/coi";
import { localIsoDate } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { CoiExtractPreview } from "@/components/insurance/coi-extract-preview";
import type { CoiExtraction } from "@/lib/pdf-extract";
import type { Boater, InsuranceCertificate, Vessel } from "@/lib/types";

/*
 * Holder-portal COI upload — drop a renewed PDF, confirm the dates,
 * and the marina sees the new policy. v1 fakes the parsing client-side
 * (the agent can call `ingest_coi_pdf` afterward to actually persist
 * the extracted values via the operator-side workflow); here we just
 * carry the boater's typed-in dates to the mock store.
 *
 * UX patterns:
 *   - HolderShell-style top bar (Marina Stee mark + theme toggle)
 *   - safe-area-padded canvas
 *   - warm hero copy ("Hi, {first_name}")
 *   - large hit targets (drop zone, submit button)
 *   - explicit success state so the member knows it landed
 */

type Step = "review" | "upload" | "preview" | "done";

export function HolderCoiUpload({
  boater,
  token,
  coi,
  vessel,
}: {
  boater: Boater;
  token: string;
  coi: InsuranceCertificate | null;
  vessel: Vessel | null;
}) {
  const store = useStore();
  // Re-resolve from live store so a freshly-uploaded cert (created
  // mid-session) is reflected without a server round-trip.
  const liveCoi = React.useMemo(() => {
    if (!coi) return null;
    return store.insurance.find((c) => c.id === coi.id) ?? coi;
  }, [coi, store.insurance]);

  const [step, setStep] = React.useState<Step>("review");
  const [extraction, setExtraction] = React.useState<CoiExtraction | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  if (!liveCoi) {
    // Edge case — boater landed here but has no COI on file. Send them
    // back to the portal with a soft message rather than a 404.
    return (
      <main
        className="min-h-screen bg-canvas"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <PortalTopBar boater={boater} token={token} />
        <div className="mx-auto max-w-xl px-6 py-24 text-center">
          <ShieldCheck className="mx-auto mb-3 size-8 text-fg-tertiary" />
          <h1 className="text-[20px] font-semibold text-fg">
            Nothing to renew right now
          </h1>
          <p className="mt-2 text-[13px] text-fg-subtle">
            We don&apos;t have a certificate on file for you yet. Drop the
            marina a message and we&apos;ll get it set up.
          </p>
          <Link
            href={`/portal/${token}`}
            className="mt-6 inline-block text-[13px] text-primary hover:underline"
          >
            Back to your portal →
          </Link>
        </div>
      </main>
    );
  }

  const todayIso = localIsoDate();
  const status = classifyCoiStatus(liveCoi, todayIso);

  return (
    <main
      className="min-h-screen bg-canvas"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <PortalTopBar boater={boater} token={token} />
      <div className="mx-auto w-full max-w-[640px] px-4 pb-24 pt-6">
        <Link
          href={`/portal/${token}`}
          className="mb-3 inline-flex items-center gap-1 text-[12px] text-fg-subtle transition-colors hover:text-fg"
        >
          <ChevronLeft className="size-3.5" />
          Back to portal
        </Link>

        {step === "review" && (
          <ReviewStep
            coi={liveCoi}
            vessel={vessel}
            boater={boater}
            status={status}
            onContinue={() => setStep("upload")}
          />
        )}
        {step === "upload" && (
          <UploadStep
            coi={liveCoi}
            boater={boater}
            onBack={() => setStep("review")}
            onExtracted={(result) => {
              setExtraction(result);
              setStep("preview");
            }}
            onSkipParse={() => setStep("preview")}
          />
        )}
        {step === "preview" && (
          <CoiExtractPreview
            extraction={
              extraction ?? {
                // Caller skipped the parse (no file) — render the preview
                // form in stub mode so the holder can still confirm/edit
                // the existing values + the dates they typed.
                stub: true,
                confidence: { per_field: {} },
              }
            }
            defaults={{
              carrier: liveCoi.carrier,
              policy_number: liveCoi.policy_number,
              effective_start: liveCoi.effective_start,
              effective_end: liveCoi.effective_end,
              liability_limit: liveCoi.liability_limit,
            }}
            submitting={submitting}
            onCancel={() => setStep("upload")}
            onConfirm={(values) => {
              setSubmitting(true);
              submitRenewedCoi(liveCoi.id, {
                carrier: values.carrier,
                policy_number: values.policy_number,
                liability_limit: values.liability_limit,
                hull_value: liveCoi.hull_value,
                effective_start: values.effective_start,
                effective_end: values.effective_end,
                pdf_url: `/mock/coi-${liveCoi.boater_id}-${Date.now()}.pdf`,
              });
              setSubmitting(false);
              setStep("done");
            }}
          />
        )}
        {step === "done" && (
          <DoneStep boater={boater} token={token} />
        )}
      </div>
    </main>
  );
}

function PortalTopBar({ boater, token }: { boater: Boater; token: string }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-hairline bg-surface-1/95 px-4 backdrop-blur">
      <Link href={`/portal/${token}`} className="flex items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-[8px] bg-primary text-on-primary">
          <span className="text-[12px] font-semibold">M</span>
        </div>
        <div className="leading-tight">
          <div className="text-[12px] font-medium text-fg">Marina Stee</div>
          <div className="text-[10px] text-fg-tertiary">
            Hi, {boater.first_name}
          </div>
        </div>
      </Link>
      <ThemeToggle />
    </header>
  );
}

// ── Step 1: review the policy on file ──────────────────────────────

function ReviewStep({
  coi,
  vessel,
  boater,
  status,
  onContinue,
}: {
  coi: InsuranceCertificate;
  vessel: Vessel | null;
  boater: Boater;
  status: ReturnType<typeof classifyCoiStatus>;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="display-tight text-[26px] font-semibold leading-tight text-fg">
          Hi {boater.first_name}, let&apos;s renew your insurance.
        </h1>
        <p className="mt-1 text-[14px] text-fg-subtle">
          We&apos;ve got your current policy on file. Drop the renewed PDF and
          we&apos;ll update your record — takes about a minute.
        </p>
      </div>

      <section className="rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <span className="text-[15px] font-medium text-fg">
              {coi.carrier}
            </span>
          </div>
          {status && (
            <Badge tone={coiStatusTone(status)} size="sm">
              {coiStatusLabel(status)}
            </Badge>
          )}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-fg-tertiary">
              Vessel
            </dt>
            <dd className="mt-0.5 text-fg">{vessel?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-fg-tertiary">
              Policy #
            </dt>
            <dd className="mt-0.5 font-mono text-fg">{coi.policy_number}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-fg-tertiary">
              Effective
            </dt>
            <dd className="mt-0.5 tabular text-fg">
              {coi.effective_start} → {coi.effective_end}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-fg-tertiary">
              Liability
            </dt>
            <dd className="mt-0.5 tabular text-fg">
              ${coi.liability_limit.toLocaleString()}
            </dd>
          </div>
        </dl>
      </section>

      <div className="rounded-[12px] border border-hairline bg-surface-2 px-4 py-3 text-[12px] leading-relaxed text-fg-subtle">
        <strong className="text-fg">What you&apos;ll need:</strong> the renewed
        policy PDF from your insurer plus the new effective dates. Once you
        upload, we&apos;ll re-check coverage against your slip requirements
        automatically.
      </div>

      <div className="flex justify-end pt-2">
        <Button
          variant="primary"
          size="lg"
          onClick={onContinue}
          className="min-w-[180px]"
        >
          Upload renewed COI
        </Button>
      </div>
    </div>
  );
}

// ── Step 2: upload PDF + new dates ─────────────────────────────────

function UploadStep({
  coi,
  boater,
  onBack,
  onExtracted,
  onSkipParse,
}: {
  coi: InsuranceCertificate;
  boater: Boater;
  onBack: () => void;
  /** Called with the parsed result once /api/pdf-extract returns. */
  onExtracted: (result: CoiExtraction) => void;
  /** Called when the user wants to skip parsing and go straight to manual entry. */
  onSkipParse: () => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [parsing, setParsing] = React.useState(false);
  const [parseError, setParseError] = React.useState<string | null>(null);

  // Avoid unused-binding lint; the boater is passed in for future
  // copy/personalization that the agent surface might add.
  void boater;

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (picked) setFile(picked);
  }

  async function handleParse() {
    if (!file || parsing) return;
    setParsing(true);
    setParseError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "coi");
      // Pass the holder's tenant_id so /api/pdf-extract can rate-limit
      // per tenant (pdf_extract.requests bucket, 100/day cap). Without
      // this the L3 gate is structurally bypassed for the public
      // holder upload path — an attacker who scrapes a magic-link
      // could drain the platform Anthropic budget.
      if (boater.tenant_id) {
        form.append("tenant_id", boater.tenant_id);
      }
      const res = await fetch("/api/pdf-extract", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `extract returned HTTP ${res.status}`);
      }
      const body = (await res.json()) as { result: CoiExtraction };
      onExtracted(body.result);
    } catch (err) {
      // Graceful degradation: emit a stub extraction so the preview
      // form renders with the existing values + a manual-entry banner.
      const message = err instanceof Error ? err.message : "Unknown error";
      setParseError(message);
      onExtracted({
        stub: true,
        error: message,
        confidence: { per_field: {} },
      });
    } finally {
      setParsing(false);
    }
  }

  const canParse = !!file && !parsing;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="display-tight text-[24px] font-semibold text-fg">
          Drop the renewed PDF
        </h1>
        <p className="mt-1 text-[14px] text-fg-subtle">
          We&apos;ll read the carrier, dates, and limits straight from your
          PDF — you&apos;ll confirm before we file it.
        </p>
      </div>

      {/* Drop zone */}
      <label
        htmlFor="coi-file-input"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className={cn(
          "flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[16px] border-2 border-dashed border-hairline bg-surface-1 px-6 py-10 text-center transition-colors hover:border-primary/40 hover:bg-primary-soft/30",
          file && "border-primary/40 bg-primary-soft/30",
        )}
      >
        {file ? (
          <>
            <FileText className="size-6 text-primary" />
            <div className="text-[13px] font-medium text-fg">{file.name}</div>
            <div className="text-[11px] text-fg-tertiary">
              {(file.size / 1024).toFixed(0)} KB · ready to read
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setFile(null);
              }}
              className="mt-1 inline-flex items-center gap-1 text-[11px] text-fg-subtle hover:text-status-danger"
            >
              <X className="size-3" />
              Choose a different file
            </button>
          </>
        ) : (
          <>
            <Upload className="size-6 text-fg-tertiary" />
            <div className="text-[13px] font-medium text-fg">
              Drop your COI PDF here
            </div>
            <div className="text-[11px] text-fg-tertiary">
              or tap to browse files
            </div>
          </>
        )}
        <input
          id="coi-file-input"
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={handlePick}
        />
      </label>

      {parseError && (
        <div className="rounded-[10px] border border-status-warn/40 bg-status-warn/10 px-3 py-2 text-[12px] text-fg">
          Couldn&apos;t auto-read this PDF — you&apos;ll be able to enter the
          fields manually on the next screen.
        </div>
      )}

      {/* PRIVACY DISCLOSURE: PDF bytes flow to Anthropic's Claude vision
          API to extract carrier / policy / expiry. Required so the
          uploading boater knows what happens to their document. The
          "Enter manually" button bypasses this path entirely. */}
      <div className="rounded-[10px] border border-hairline-strong bg-surface-2/60 px-3 py-2.5 text-[11px] leading-relaxed text-fg-subtle">
        <strong className="font-medium text-fg">Heads up:</strong> when
        you tap &ldquo;Read &amp; confirm&rdquo;, your PDF is sent to
        our extraction provider (Anthropic) to pull the carrier, policy
        number, vessel name, and expiry date. We don&apos;t store the
        document beyond your COI record. Prefer not to share? Use{" "}
        <span className="font-medium text-fg">Enter manually</span>{" "}
        instead — same outcome, just typed in.
      </div>

      <div className="flex justify-between gap-3 pt-2">
        <Button variant="ghost" size="lg" onClick={onBack}>
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="lg"
            onClick={onSkipParse}
          >
            Enter manually
          </Button>
          <Button
            variant="primary"
            size="lg"
            onClick={handleParse}
            disabled={!canParse}
            className="min-w-[160px]"
          >
            {parsing ? "Reading PDF…" : "Read & confirm →"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Step 3: done ────────────────────────────────────────────────────

function DoneStep({ boater, token }: { boater: Boater; token: string }) {
  return (
    <div className="space-y-4 py-6 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-status-ok/10 text-status-ok">
        <CheckCircle2 className="size-7" />
      </div>
      <h1 className="display-tight text-[24px] font-semibold text-fg">
        Thanks, {boater.first_name} — we&apos;ll update your record.
      </h1>
      <p className="mx-auto max-w-md text-[14px] text-fg-subtle">
        The marina just got your renewed COI. You&apos;ll get a confirmation
        when we&apos;ve filed it and re-verified your coverage. No further
        action needed from you.
      </p>
      <div className="pt-2">
        <Button asChild variant="primary" size="lg">
          <Link href={`/portal/${token}`}>Back to your portal</Link>
        </Button>
      </div>
    </div>
  );
}
