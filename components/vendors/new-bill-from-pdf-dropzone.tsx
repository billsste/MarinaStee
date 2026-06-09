"use client";

import * as React from "react";
import { AlertCircle, FileText, Loader2, Sparkles, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMarinaProfile } from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { BillExtraction } from "@/lib/pdf-extract";
import type { Vendor, VendorBillLineItem } from "@/lib/types";

/*
 * New-bill-wizard dropzone — drop a vendor invoice PDF here and the
 * wizard's step-1 form gets pre-filled from the Claude vision extract.
 *
 * Integration:
 *   - Hosted inside the wizard's step 1 (above the vendor picker).
 *   - Calls /api/pdf-extract?kind=bill.
 *   - Fuzzy-matches vendor_name_hint against the supplied vendor list
 *     (simple lowercase substring; ties go to the first match). When
 *     no match, we leave vendor_id blank + emit a "Create new vendor"
 *     hint that the parent renders.
 *   - On success: pre-fills bill_date, due_date, amount, tax,
 *     line_items via onPrefill — the wizard advances to step 2.
 *
 * Confidence handling: per-field confidences land on the prefill
 * callback so the wizard's review screen can flag low-conf rows. The
 * dropzone itself doesn't render them — that's the next step's job.
 *
 * Graceful degradation:
 *   - When extraction.stub === true (no API key) we still call
 *     onPrefill with the partial values so the operator can manually
 *     finish, plus surface a banner here so they know what happened.
 *   - Network/HTTP errors surface inline + don't advance the wizard.
 */

export interface BillPrefillPayload {
  /** Resolved vendor id when fuzzy-match found one; undefined otherwise. */
  vendor_id?: string;
  /** Raw vendor name from the PDF — operator can still create-new-vendor. */
  vendor_name_hint?: string;
  vendor_invoice_number?: string;
  bill_date?: string;
  due_date?: string;
  amount?: number;
  tax_amount?: number;
  line_items?: VendorBillLineItem[];
  /** Per-field confidence scores so downstream UI can flag low-confidence rows. */
  field_confidences: Record<string, number>;
  /** True when extraction was stubbed — UI should show a manual-entry banner. */
  stub: boolean;
}

export function NewBillFromPdfDropzone({
  vendors,
  onPrefill,
}: {
  vendors: Vendor[];
  onPrefill: (payload: BillPrefillPayload) => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [parsing, setParsing] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  // Active marina's tenant id — passed to /api/pdf-extract for the
  // per-tenant rate-limit bucket (`pdf_extract.requests`, 100/day cap).
  const marina = useMarinaProfile();
  const tenantId = marina.tenant_id;

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) {
      setFile(dropped);
      setErrorMessage(null);
    }
  }

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (picked) {
      setFile(picked);
      setErrorMessage(null);
    }
  }

  async function parsePdf() {
    if (!file || parsing) return;
    setParsing(true);
    setErrorMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "bill");
      // Pass the tenant_id so /api/pdf-extract can rate-limit per tenant
      // against the pdf_extract.requests bucket (100/day cap). Without
      // this, the L3 gate is structurally bypassed — an operator (or
      // attacker with a stolen DEV_TOKEN) could drain the platform
      // Anthropic budget unbounded.
      if (tenantId) {
        form.append("tenant_id", tenantId);
      }
      const res = await fetch("/api/pdf-extract", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `extract returned HTTP ${res.status}`);
      }
      const body = (await res.json()) as { result: BillExtraction };
      const result = body.result;
      const matched = fuzzyMatchVendor(result.vendor_name_hint, vendors);
      onPrefill({
        vendor_id: matched?.id,
        vendor_name_hint: result.vendor_name_hint,
        vendor_invoice_number: result.vendor_invoice_number,
        bill_date: result.bill_date,
        due_date: result.due_date,
        amount: result.amount,
        tax_amount: result.tax_amount,
        line_items: result.line_items?.map((l) => ({
          description: l.description,
          amount: l.amount,
        })),
        field_confidences: result.confidence.per_field,
        stub: result.stub,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setErrorMessage(message);
    } finally {
      setParsing(false);
    }
  }

  return (
    <div className="space-y-2">
      <label
        htmlFor="new-bill-pdf-input"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className={cn(
          "flex min-h-[112px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[12px] border-2 border-dashed border-hairline bg-surface-2 px-4 py-4 text-center transition-colors hover:border-primary/40 hover:bg-primary-soft/30",
          file && "border-primary/40 bg-primary-soft/30",
        )}
      >
        {file ? (
          <>
            <FileText className="size-5 text-primary" />
            <div className="text-[12px] font-medium text-fg">{file.name}</div>
            <div className="text-[10px] text-fg-tertiary">
              {(file.size / 1024).toFixed(0)} KB
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setFile(null);
              }}
              className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-fg-subtle hover:text-status-danger"
            >
              <X className="size-3" />
              Remove
            </button>
          </>
        ) : (
          <>
            <Upload className="size-5 text-fg-tertiary" />
            <div className="text-[12px] font-medium text-fg">
              Drop a vendor invoice PDF
            </div>
            <div className="text-[10px] text-fg-tertiary">
              We&apos;ll pre-fill the wizard from the parse — or skip and
              enter manually.
            </div>
          </>
        )}
        <input
          id="new-bill-pdf-input"
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={handlePick}
        />
      </label>

      {errorMessage && (
        <div className="flex items-start gap-2 rounded-[8px] border border-status-warn/40 bg-status-warn/10 px-2.5 py-2 text-[11px] text-fg">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-status-warn" />
          <span>
            Couldn&apos;t read this PDF — {errorMessage}. Fill the wizard
            manually below.
          </span>
        </div>
      )}

      {file && !errorMessage && (
        <Button
          variant="primary"
          size="sm"
          onClick={parsePdf}
          disabled={parsing}
          className="w-full"
        >
          {parsing ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" />
              Reading PDF…
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="size-3.5" />
              Pre-fill from PDF
            </span>
          )}
        </Button>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Vendor fuzzy match — simple substring against display_name / name.
// Production: replace with a Levenshtein or token-sort ratio when the
// vendor table gets big enough that substring collisions matter.
// ────────────────────────────────────────────────────────────

function fuzzyMatchVendor(
  hint: string | undefined,
  vendors: Vendor[],
): Vendor | undefined {
  if (!hint) return undefined;
  const needle = hint.toLowerCase().trim();
  if (needle.length < 3) return undefined;
  // Prefer exact display_name / name; fall back to substring; fall back
  // to "first token of the hint matches a token in any vendor name".
  const exact = vendors.find(
    (v) =>
      v.name.toLowerCase() === needle ||
      (v.display_name?.toLowerCase() ?? "") === needle,
  );
  if (exact) return exact;
  const substring = vendors.find(
    (v) =>
      v.name.toLowerCase().includes(needle) ||
      (v.display_name?.toLowerCase() ?? "").includes(needle) ||
      needle.includes(v.name.toLowerCase()),
  );
  if (substring) return substring;
  const firstToken = needle.split(/\s+/)[0];
  if (firstToken && firstToken.length >= 3) {
    return vendors.find(
      (v) =>
        v.name.toLowerCase().includes(firstToken) ||
        (v.display_name?.toLowerCase() ?? "").includes(firstToken),
    );
  }
  return undefined;
}
