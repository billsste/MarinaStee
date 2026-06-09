"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CoiExtraction } from "@/lib/pdf-extract";

/*
 * COI extract preview — operator/holder confirmation screen.
 *
 * Lifecycle:
 *   1. Caller (holder-coi-upload.tsx UploadStep) drops a PDF and posts
 *      to /api/pdf-extract?kind=coi.
 *   2. The response (a CoiExtraction) lands in this component as
 *      `extraction`.
 *   3. The user reviews each field with confidence shading, can edit any
 *      value, and confirms — calls `onConfirm` with the merged values.
 *
 * Confidence-driven UX:
 *   - field_confidence >= 0.85 → solid green check
 *   - 0.5–0.85               → amber "review"
 *   - < 0.5 or missing       → red "look closely"
 *
 * Stub mode (extraction.stub === true): we render the same form with
 * the sentinel values + a banner so the user can keep filling manually.
 * No PDF-side validation gate — the existing markCoiUploaded mutation
 * is the source of truth for what's persistable.
 */

export interface CoiExtractedValues {
  carrier: string;
  policy_number: string;
  effective_start: string;
  effective_end: string;
  liability_limit: number;
}

export function CoiExtractPreview({
  extraction,
  defaults,
  onConfirm,
  onCancel,
  submitting,
}: {
  extraction: CoiExtraction;
  /** Existing COI row values used to seed missing extraction fields. */
  defaults: {
    carrier: string;
    policy_number: string;
    effective_start: string;
    effective_end: string;
    liability_limit: number;
  };
  onConfirm: (values: CoiExtractedValues) => void;
  onCancel: () => void;
  submitting?: boolean;
}) {
  const isStub = extraction.stub;
  const conf = extraction.confidence.per_field;

  // Seed fields from extraction → fall back to defaults so the operator
  // doesn't lose what was already on file when a field couldn't be
  // pulled from the PDF.
  const [carrier, setCarrier] = React.useState(
    sanitizeOrFallback(extraction.carrier, defaults.carrier, isStub),
  );
  const [policyNumber, setPolicyNumber] = React.useState(
    sanitizeOrFallback(extraction.policyNumber, defaults.policy_number, isStub),
  );
  const [effectiveStart, setEffectiveStart] = React.useState(
    extraction.effective_start ?? defaults.effective_start,
  );
  const [effectiveEnd, setEffectiveEnd] = React.useState(
    extraction.effective_end ?? defaults.effective_end,
  );
  const [liabilityLimit, setLiabilityLimit] = React.useState(
    String(
      typeof extraction.liability_limit === "number" &&
        extraction.liability_limit > 0
        ? extraction.liability_limit
        : defaults.liability_limit,
    ),
  );

  const canSubmit =
    !!effectiveStart &&
    !!effectiveEnd &&
    effectiveEnd > effectiveStart &&
    carrier.trim().length > 0 &&
    policyNumber.trim().length > 0;

  function submit() {
    if (!canSubmit || submitting) return;
    onConfirm({
      carrier: carrier.trim(),
      policy_number: policyNumber.trim(),
      effective_start: effectiveStart,
      effective_end: effectiveEnd,
      liability_limit: Number(liabilityLimit) || defaults.liability_limit,
    });
  }

  return (
    <div className="space-y-4">
      <header>
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <h2 className="text-[18px] font-semibold text-fg">
            Confirm the extracted details
          </h2>
        </div>
        <p className="mt-1 text-[13px] text-fg-subtle">
          We pulled these from your PDF. Eyeball anything flagged below and tap
          confirm — we&apos;ll lock it in.
        </p>
      </header>

      {isStub && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-[12px] border border-status-warn/40 bg-status-warn/10 px-3 py-2.5 text-[12px] text-fg"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-status-warn" />
          <div>
            <strong className="font-medium">
              PDF extraction unavailable
            </strong>
            <p className="mt-0.5 text-fg-subtle">
              {extraction.error
                ? `Extraction errored: ${extraction.error}. `
                : "Anthropic API isn't configured in this environment. "}
              Enter the policy fields manually below — your existing values
              are pre-filled.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Carrier"
          confidence={conf.carrier}
          stub={isStub}
        >
          <input
            type="text"
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            className="h-11 w-full rounded-[10px] border border-hairline bg-surface-1 px-3 text-[14px] text-fg focus:border-primary focus:outline-none"
          />
        </Field>
        <Field
          label="Policy #"
          confidence={conf.policyNumber}
          stub={isStub}
        >
          <input
            type="text"
            value={policyNumber}
            onChange={(e) => setPolicyNumber(e.target.value)}
            className="h-11 w-full rounded-[10px] border border-hairline bg-surface-1 px-3 font-mono text-[14px] text-fg focus:border-primary focus:outline-none"
          />
        </Field>
        <Field
          label="Effective start"
          confidence={conf.effective_start}
          stub={isStub}
        >
          <input
            type="date"
            value={effectiveStart}
            onChange={(e) => setEffectiveStart(e.target.value)}
            className="h-11 w-full rounded-[10px] border border-hairline bg-surface-1 px-3 text-[14px] text-fg focus:border-primary focus:outline-none"
          />
        </Field>
        <Field
          label="Effective end"
          confidence={conf.effective_end}
          stub={isStub}
        >
          <input
            type="date"
            value={effectiveEnd}
            onChange={(e) => setEffectiveEnd(e.target.value)}
            className="h-11 w-full rounded-[10px] border border-hairline bg-surface-1 px-3 text-[14px] text-fg focus:border-primary focus:outline-none"
          />
        </Field>
        <Field
          label="Liability limit ($)"
          confidence={conf.liability_limit}
          stub={isStub}
        >
          <input
            type="text"
            inputMode="numeric"
            value={liabilityLimit}
            onChange={(e) =>
              setLiabilityLimit(e.target.value.replace(/[^\d]/g, ""))
            }
            className="h-11 w-full rounded-[10px] border border-hairline bg-surface-1 px-3 tabular text-[14px] text-fg focus:border-primary focus:outline-none"
          />
        </Field>
        {extraction.vessel_name && (
          <Field
            label="Vessel (from PDF)"
            confidence={conf.vessel_name}
            stub={isStub}
          >
            <input
              type="text"
              value={extraction.vessel_name}
              readOnly
              className="h-11 w-full cursor-not-allowed rounded-[10px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg-subtle"
            />
          </Field>
        )}
      </div>

      <div className="flex justify-between gap-3 pt-2">
        <Button variant="ghost" size="lg" onClick={onCancel} disabled={submitting}>
          Back
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={submit}
          disabled={!canSubmit || submitting}
          className="min-w-[180px]"
        >
          {submitting ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              Saving…
            </span>
          ) : (
            "Confirm and submit"
          )}
        </Button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Field with confidence indicator
// ────────────────────────────────────────────────────────────

function Field({
  label,
  confidence,
  stub,
  children,
}: {
  label: string;
  confidence: number | undefined;
  stub: boolean;
  children: React.ReactNode;
}) {
  const tier = confidenceTier(confidence, stub);
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        <span>{label}</span>
        {tier && <ConfidenceBadge tier={tier} />}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

type ConfTier = "high" | "medium" | "low";

function confidenceTier(
  c: number | undefined,
  stub: boolean,
): ConfTier | null {
  if (stub) return null;
  if (c === undefined) return "low";
  if (c >= 0.85) return "high";
  if (c >= 0.5) return "medium";
  return "low";
}

function ConfidenceBadge({ tier }: { tier: ConfTier }) {
  if (tier === "high") {
    return (
      <Badge tone="ok" size="sm">
        <CheckCircle2 className="-ml-0.5 mr-0.5 size-3" />
        Confident
      </Badge>
    );
  }
  if (tier === "medium") {
    return (
      <Badge tone="warn" size="sm">
        Review
      </Badge>
    );
  }
  return (
    <Badge tone="danger" size="sm">
      Look closely
    </Badge>
  );
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Use the extracted value when it's a real string; fall back to the
 * existing default. In stub mode the sentinel "[Stub: parse manually]"
 * comes through — we suppress that and show the default instead so the
 * form is immediately editable.
 */
function sanitizeOrFallback(
  extracted: string | undefined,
  fallback: string,
  stub: boolean,
): string {
  if (stub) return fallback;
  if (!extracted) return fallback;
  return extracted;
}

// Avoid an unused-variable warning when the cn() import isn't needed
// further down. Future: confidence-driven row tinting can use it.
void cn;
