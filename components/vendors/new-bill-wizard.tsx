"use client";

/*
 * 4-step new VendorBill wizard:
 *   1. Vendor           — search-as-you-type combobox over the vendor list
 *   2. Bill details     — invoice #, bill_date, due_date (auto-rolled from
 *                          vendor.terms), total amount
 *   3. Line items + GL — split-by-account line items with running subtotal
 *   4. Review & submit  — confirm + decide submit_as (draft vs pending)
 *
 * Steps are gated: 1 needs a vendor; 2 needs a positive total; 3 has no
 * gate (operator can submit with zero line items); 4 is the final commit.
 *
 * Writes through the client store (mock path) or the Convex mutation
 * (live path) via useTenantMutation. The wizard always closes after a
 * successful save; failures broadcast through the global error event.
 */

import * as React from "react";
import { Plus, X, ArrowLeft, ArrowRight, Check } from "lucide-react";
import { anyApi } from "convex/server";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  NewBillFromPdfDropzone,
  type BillPrefillPayload,
} from "@/components/vendors/new-bill-from-pdf-dropzone";
import {
  computeVendorBillDueDate,
  nextVendorBillId,
  nextVendorBillNumber,
  upsertVendorBill,
} from "@/lib/client-store";
import { formatMoney } from "@/lib/mock-data";
import { useTenantMutation } from "@/lib/use-tenant-mutation";
import { cn } from "@/lib/utils";
import type {
  Vendor,
  VendorBill,
  VendorBillLineItem,
  VendorPaymentTerms,
} from "@/lib/types";

type Step = 1 | 2 | 3 | 4;

interface WizardArgs {
  vendor_id: string;
  vendor_invoice_number?: string;
  bill_date: string;
  due_date: string;
  amount: number;
  tax_amount?: number;
  description?: string;
  line_items?: VendorBillLineItem[];
  submit_as: "draft" | "pending_approval";
  internal_notes?: string;
}

export function NewBillWizard({
  vendors,
  onClose,
  initialVendorId,
}: {
  vendors: Vendor[];
  onClose: () => void;
  initialVendorId?: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [step, setStep] = React.useState<Step>(1);
  const [vendorId, setVendorId] = React.useState(initialVendorId ?? "");
  const [vendorInvoiceNumber, setVendorInvoiceNumber] = React.useState("");
  const [billDate, setBillDate] = React.useState(today);
  const [dueDate, setDueDate] = React.useState(today);
  const [amount, setAmount] = React.useState("");
  const [taxAmount, setTaxAmount] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [lines, setLines] = React.useState<VendorBillLineItem[]>([]);
  const [submitAs, setSubmitAs] = React.useState<"draft" | "pending_approval">(
    "pending_approval",
  );
  const [internalNotes, setInternalNotes] = React.useState("");
  // PDF prefill state — set when the operator drops an invoice on
  // step 1 and the parse returns. Carries the vendor-name hint when
  // fuzzy match missed (so step 1 can suggest "Create vendor" with
  // the hint) + a stub flag for the "extraction unavailable" banner.
  const [pdfHint, setPdfHint] = React.useState<{
    vendor_name_hint?: string;
    stub: boolean;
    field_confidences: Record<string, number>;
  } | null>(null);

  function applyPdfPrefill(p: BillPrefillPayload) {
    if (p.vendor_id) setVendorId(p.vendor_id);
    if (p.vendor_invoice_number) setVendorInvoiceNumber(p.vendor_invoice_number);
    if (p.bill_date) setBillDate(p.bill_date);
    if (p.due_date) setDueDate(p.due_date);
    if (typeof p.amount === "number" && p.amount > 0) {
      setAmount(p.amount.toFixed(2));
    }
    if (typeof p.tax_amount === "number" && p.tax_amount >= 0) {
      setTaxAmount(p.tax_amount.toFixed(2));
    }
    if (p.line_items && p.line_items.length > 0) {
      setLines(p.line_items);
    }
    setPdfHint({
      vendor_name_hint: p.vendor_id ? undefined : p.vendor_name_hint,
      stub: p.stub,
      field_confidences: p.field_confidences,
    });
    // If we matched a vendor, advance to step 2 so the operator sees
    // the prefilled values immediately. Otherwise stay on step 1 so
    // they can pick / create the vendor.
    if (p.vendor_id) {
      setStep(2);
    }
  }

  const vendor = vendors.find((v) => v.id === vendorId);
  const numTotal = Number(amount);
  const numTax = Number(taxAmount);
  const validTotal = Number.isFinite(numTotal) && numTotal > 0;

  // Auto-roll due_date from vendor terms when vendor or billDate changes.
  React.useEffect(() => {
    if (!vendor) return;
    setDueDate(computeVendorBillDueDate(billDate, vendor.payment_terms));
  }, [vendor, billDate]);

  // Default-seed a single empty line item once we land in step 3 so the
  // operator has something to fill in.
  React.useEffect(() => {
    if (step === 3 && lines.length === 0) {
      setLines([
        {
          description: description || "",
          amount: validTotal ? numTotal - (Number.isFinite(numTax) ? numTax : 0) : 0,
          gl_account: vendor?.default_gl_account ?? "",
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const vendorOptions: ComboboxOption[] = vendors.map((v) => ({
    value: v.id,
    label: v.display_name ?? v.name,
    hint: v.contact_name ?? undefined,
  }));

  const linesSubtotal = lines.reduce(
    (s, l) => s + (Number(l.amount) || 0),
    0,
  );
  const linesMatchTotal =
    lines.length === 0 ||
    Math.abs(
      linesSubtotal -
        (validTotal
          ? numTotal - (Number.isFinite(numTax) ? numTax : 0)
          : linesSubtotal),
    ) < 0.01;

  function canAdvance(): boolean {
    if (step === 1) return !!vendorId;
    if (step === 2) return validTotal;
    if (step === 3) return true; // line items optional
    return true;
  }

  const createVendorBill = useTenantMutation<WizardArgs, string>({
    mock: async (args) => {
      const id = nextVendorBillId();
      const number = nextVendorBillNumber();
      const bill: VendorBill = {
        id,
        tenant_id: "",
        number,
        vendor_id: args.vendor_id,
        vendor_invoice_number: args.vendor_invoice_number,
        status: args.submit_as,
        bill_date: args.bill_date,
        due_date: args.due_date,
        amount: args.amount,
        tax_amount: args.tax_amount,
        subtotal:
          args.tax_amount !== undefined
            ? args.amount - args.tax_amount
            : undefined,
        description: args.description,
        line_items: args.line_items,
        internal_notes: args.internal_notes,
        created_at: new Date().toISOString(),
        created_by: "u_steven",
      };
      upsertVendorBill(bill);
      return id;
    },
    convexRef: anyApi.vendorBills.create,
    convexArgsAdapter: (args) => ({
      vendor_id: args.vendor_id,
      vendor_invoice_number: args.vendor_invoice_number,
      bill_date: args.bill_date,
      due_date: args.due_date,
      amount: args.amount,
      tax_amount: args.tax_amount,
      description: args.description,
      line_items: args.line_items,
      status: args.submit_as,
      internal_notes: args.internal_notes,
    }),
  });

  function submit() {
    if (!validTotal) {
      // Allow zero-amount drafts only when explicitly opted in.
      if (submitAs !== "draft") return;
    }
    if (!vendorId) return;
    const cleanLines = lines
      .filter((l) => l.description.trim() && Number(l.amount) > 0)
      .map((l) => ({
        description: l.description.trim(),
        amount: Number(l.amount),
        gl_account: l.gl_account?.trim() || undefined,
      }));
    void createVendorBill({
      vendor_id: vendorId,
      vendor_invoice_number: vendorInvoiceNumber.trim() || undefined,
      bill_date: billDate,
      due_date: dueDate,
      amount: validTotal ? numTotal : 0,
      tax_amount: Number.isFinite(numTax) && numTax > 0 ? numTax : undefined,
      description: description.trim() || undefined,
      line_items: cleanLines.length > 0 ? cleanLines : undefined,
      submit_as: submitAs,
      internal_notes: internalNotes.trim() || undefined,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[680px] rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-fg">
              New vendor bill
            </h3>
            <p className="mt-0.5 text-[11px] text-fg-tertiary">
              Step {step} of 4
              {" · "}
              {step === 1
                ? "Pick vendor"
                : step === 2
                  ? "Bill details"
                  : step === 3
                    ? "Line items + GL"
                    : "Review & submit"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1 text-fg-tertiary hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Step progress strip */}
        <div className="mt-4 grid grid-cols-4 gap-1">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={cn(
                "h-1 rounded-full",
                s <= step ? "bg-primary" : "bg-surface-3",
              )}
            />
          ))}
        </div>

        <div className="mt-5 min-h-[260px]">
          {step === 1 && (
            <div className="space-y-3">
              <NewBillFromPdfDropzone
                vendors={vendors}
                onPrefill={applyPdfPrefill}
              />
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-hairline" />
                <span className="text-[10px] uppercase tracking-wide text-fg-tertiary">
                  or pick manually
                </span>
                <div className="h-px flex-1 bg-hairline" />
              </div>
              <Field label="Vendor *" col={2}>
                <Combobox
                  value={vendorId}
                  onChange={setVendorId}
                  options={vendorOptions}
                  placeholder="Pick a vendor"
                  searchPlaceholder="Search vendors…"
                />
              </Field>
              {pdfHint?.stub && (
                <div className="rounded-[8px] border border-status-warn/40 bg-status-warn/10 px-2.5 py-1.5 text-[11px] text-fg">
                  PDF extraction unavailable — enter fields manually.
                </div>
              )}
              {pdfHint?.vendor_name_hint && !vendor && (
                <div className="rounded-[8px] border border-status-info/40 bg-status-info/10 px-2.5 py-1.5 text-[11px] text-fg">
                  We read <strong>{pdfHint.vendor_name_hint}</strong> from
                  the PDF but no vendor matched. Pick an existing vendor
                  above or create one first.
                </div>
              )}
              {vendor && (
                <div className="rounded-[10px] border border-hairline bg-surface-2 p-3 text-[12px] text-fg-subtle">
                  <div className="grid grid-cols-2 gap-1.5">
                    <span className="text-fg-tertiary">Terms</span>
                    <span className="text-fg">{termsLabel(vendor.payment_terms)}</span>
                    <span className="text-fg-tertiary">Default GL</span>
                    <span className="text-fg">
                      {vendor.default_gl_account ?? "—"}
                    </span>
                    <span className="text-fg-tertiary">1099</span>
                    <span className="text-fg">
                      {vendor.issue_1099 ? "Yes" : "No"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vendor invoice #" col={2}>
                <input
                  value={vendorInvoiceNumber}
                  onChange={(e) => setVendorInvoiceNumber(e.target.value)}
                  placeholder="PP-19421"
                  className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] font-mono text-fg focus:border-primary focus:outline-none"
                />
              </Field>
              <Field label="Bill date">
                <input
                  type="date"
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                  className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
                />
              </Field>
              <Field label="Due date">
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
                />
              </Field>
              <Field label="Total amount ($) *">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
                />
              </Field>
              <Field label="Tax ($)">
                <input
                  value={taxAmount}
                  onChange={(e) => setTaxAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
                />
              </Field>
              <Field label="Description" col={2}>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What was this bill for?"
                  className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
                />
              </Field>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="text-[11px] text-fg-tertiary">
                Split the bill across GL accounts. Subtotal must match
                (Total − Tax) before submit.
              </div>
              {lines.map((line, idx) => (
                <div
                  key={idx}
                  className="grid items-end gap-2"
                  style={{
                    gridTemplateColumns: "minmax(0, 2fr) 110px minmax(0, 1.5fr) 28px",
                  }}
                >
                  <input
                    value={line.description}
                    onChange={(e) =>
                      updateLine(idx, { description: e.target.value })
                    }
                    placeholder="Description"
                    className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[12px] text-fg focus:border-primary focus:outline-none"
                  />
                  <input
                    value={String(line.amount)}
                    onChange={(e) =>
                      updateLine(idx, { amount: Number(e.target.value) || 0 })
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                    className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[12px] text-fg focus:border-primary focus:outline-none"
                  />
                  <input
                    value={line.gl_account ?? ""}
                    onChange={(e) =>
                      updateLine(idx, { gl_account: e.target.value })
                    }
                    placeholder="GL account"
                    className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[12px] text-fg focus:border-primary focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeLine(idx)}
                    className="rounded-[6px] p-1 text-fg-tertiary hover:bg-status-danger/10 hover:text-status-danger"
                    aria-label="Remove line"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addLine}
                className="flex items-center gap-1 rounded-[8px] border border-dashed border-hairline px-2.5 py-1.5 text-[11px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
              >
                <Plus className="size-3" />
                Add line
              </button>
              <div className="flex justify-between rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[12px]">
                <span className="text-fg-tertiary">Line subtotal</span>
                <span
                  className={cn(
                    "money-display text-fg",
                    !linesMatchTotal && "text-status-warn",
                  )}
                >
                  {formatMoney(linesSubtotal)}
                </span>
              </div>
              {validTotal && (
                <div className="flex justify-between text-[11px] text-fg-tertiary">
                  <span>
                    Expected (Total − Tax):{" "}
                    {formatMoney(numTotal - (Number.isFinite(numTax) ? numTax : 0))}
                  </span>
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <div className="rounded-[10px] border border-hairline bg-surface-2 p-3">
                <ReviewRow label="Vendor" value={vendor?.display_name ?? vendor?.name ?? "—"} />
                <ReviewRow label="Vendor invoice #" value={vendorInvoiceNumber || "—"} mono />
                <ReviewRow label="Bill date" value={billDate} />
                <ReviewRow label="Due date" value={dueDate} />
                <ReviewRow label="Total" value={formatMoney(validTotal ? numTotal : 0)} money />
                {Number.isFinite(numTax) && numTax > 0 && (
                  <ReviewRow label="Tax" value={formatMoney(numTax)} money />
                )}
                <ReviewRow label="Description" value={description || "—"} />
                <ReviewRow
                  label="Line items"
                  value={
                    lines.filter((l) => l.description && l.amount > 0).length === 0
                      ? "No lines"
                      : `${lines.filter((l) => l.description && l.amount > 0).length} lines`
                  }
                />
              </div>
              <Field label="Internal notes" col={2}>
                <textarea
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  rows={2}
                  placeholder="Anything the approver should see — e.g. duplicate check pending"
                  className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[12px] text-fg focus:border-primary focus:outline-none"
                />
              </Field>
              <Field label="Submit as" col={2}>
                <div className="flex gap-2">
                  <SubmitChoice
                    label="Pending approval"
                    description="Routes to the approval queue (default)"
                    active={submitAs === "pending_approval"}
                    onClick={() => setSubmitAs("pending_approval")}
                    disabled={!validTotal}
                  />
                  <SubmitChoice
                    label="Draft"
                    description="Save without routing — finish later"
                    active={submitAs === "draft"}
                    onClick={() => setSubmitAs("draft")}
                  />
                </div>
              </Field>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          {step > 1 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep((s) => (s - 1) as Step)}
            >
              <ArrowLeft className="size-3.5" />
              Back
            </Button>
          ) : (
            <span />
          )}
          {step < 4 ? (
            <Button
              variant="primary"
              size="sm"
              disabled={!canAdvance()}
              onClick={() => setStep((s) => (s + 1) as Step)}
            >
              Next
              <ArrowRight className="size-3.5" />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              disabled={!vendorId || (submitAs === "pending_approval" && !validTotal)}
              onClick={submit}
            >
              <Check className="size-3.5" />
              {submitAs === "draft" ? "Save draft" : "Submit for approval"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  function updateLine(idx: number, patch: Partial<VendorBillLineItem>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [
      ...prev,
      { description: "", amount: 0, gl_account: vendor?.default_gl_account ?? "" },
    ]);
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }
}

function termsLabel(t: VendorPaymentTerms): string {
  switch (t) {
    case "due_on_receipt":
      return "Due on receipt";
    case "net_7":
      return "Net 7";
    case "net_15":
      return "Net 15";
    case "net_30":
      return "Net 30";
    case "net_60":
      return "Net 60";
  }
}

function Field({
  label,
  col = 1,
  children,
}: {
  label: string;
  col?: 1 | 2;
  children: React.ReactNode;
}) {
  return (
    <div className={col === 2 ? "col-span-2" : ""}>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  money,
  mono,
}: {
  label: string;
  value: string;
  money?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2 border-b border-hairline py-1 last:border-b-0">
      <span className="text-[11px] text-fg-tertiary">{label}</span>
      <span
        className={cn(
          "text-[12px] text-fg",
          money && "money-display",
          mono && "font-mono",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function SubmitChoice({
  label,
  description,
  active,
  onClick,
  disabled,
}: {
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex-1 rounded-[10px] border px-3 py-2 text-left transition-colors",
        active
          ? "border-primary bg-primary/5"
          : "border-hairline bg-surface-2 hover:bg-surface-3",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <div className="text-[12px] font-medium text-fg">{label}</div>
      <div className="text-[10px] text-fg-tertiary">{description}</div>
    </button>
  );
}
