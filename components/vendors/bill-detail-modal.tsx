"use client";

/*
 * Bill detail modal — shows everything about a VendorBill on one
 * screen + the operator actions valid for the current status:
 *   draft           → edit + delete + submit_for_approval
 *   pending_approval → approve + dispute + edit
 *   approved        → schedule_payment + dispute
 *   scheduled       → mark_paid + reschedule
 *   paid            → read-only (back-reference to ledger entry)
 *   disputed        → clear_dispute (returns to pending)
 *   void            → read-only
 *
 * Conversation thread = internal_notes for now; future versions wire
 * a real comments table. Attachments list resolves to the AP inbox PDF
 * the bill was extracted from.
 */

import * as React from "react";
import { anyApi } from "convex/server";
import { X, Check, CalendarClock, AlertTriangle, RotateCcw, Ban, FileText, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/mock-data";
import {
  approveVendorBill as mockApprove,
  clearVendorBillDispute as mockClearDispute,
  deleteVendorBill as mockDelete,
  disputeVendorBill as mockDispute,
  markVendorBillPaid as mockMarkPaid,
  scheduleVendorBillPayment as mockSchedule,
  updateVendorBill as mockUpdate,
  useInboundEmailForBill,
  voidVendorBill as mockVoid,
} from "@/lib/client-store";
import { useTenantMutation } from "@/lib/use-tenant-mutation";
import { cn } from "@/lib/utils";
import type {
  Vendor,
  VendorBill,
  VendorBillPaymentMethod,
  VendorBillStatus,
} from "@/lib/types";

function badgeTone(s: VendorBillStatus): "ok" | "warn" | "danger" | "info" | "neutral" {
  switch (s) {
    case "paid":
      return "ok";
    case "pending_approval":
      return "warn";
    case "approved":
    case "scheduled":
      return "info";
    case "disputed":
      return "danger";
    default:
      return "neutral";
  }
}

export function BillDetailModal({
  bill,
  vendor,
  onClose,
}: {
  bill: VendorBill;
  vendor: Vendor | undefined;
  onClose: () => void;
}) {
  const [pane, setPane] = React.useState<"overview" | "schedule" | "pay" | "dispute">(
    "overview",
  );
  const [schedDate, setSchedDate] = React.useState(
    bill.scheduled_payment_date ?? bill.due_date,
  );
  const [schedMethod, setSchedMethod] = React.useState<VendorBillPaymentMethod>(
    bill.scheduled_payment_method ?? "ach",
  );
  const [paidVia, setPaidVia] = React.useState("");
  const [disputeReason, setDisputeReason] = React.useState(bill.dispute_reason ?? "");
  const [notesDraft, setNotesDraft] = React.useState(bill.internal_notes ?? "");

  // Provenance — when this draft came from a forwarded vendor email,
  // surface a chip in the header so the operator knows the audit chain.
  // Falsy on operator-keyed drafts + on bills migrated from the legacy
  // path; the chip only renders for inbound-email originated rows.
  const inboundEmail = useInboundEmailForBill(bill.id);

  // ── Mutations: tenant-aware (mock OR Convex) ────────────────────

  const approve = useTenantMutation<{ id: string }, void>({
    mock: ({ id }) => {
      mockApprove({ id });
    },
    convexRef: anyApi.vendorBills.approve,
    convexArgsAdapter: ({ id }) => ({ id }),
  });
  const schedule = useTenantMutation<
    {
      id: string;
      scheduled_payment_date: string;
      scheduled_payment_method: VendorBillPaymentMethod;
    },
    void
  >({
    mock: (args) => {
      mockSchedule(args);
    },
    convexRef: anyApi.vendorBills.schedulePayment,
    convexArgsAdapter: (args) => args,
  });
  const markPaid = useTenantMutation<
    {
      id: string;
      paid_at?: string;
      paid_via?: string;
      payment_method?: VendorBillPaymentMethod;
    },
    void
  >({
    mock: (args) => {
      mockMarkPaid(args);
    },
    convexRef: anyApi.vendorBills.markPaid,
    convexArgsAdapter: (args) => args,
  });
  const dispute = useTenantMutation<{ id: string; reason: string }, void>({
    mock: ({ id, reason }) => {
      mockDispute({ id, reason });
    },
    convexRef: anyApi.vendorBills.dispute,
    convexArgsAdapter: ({ id, reason }) => ({ id, reason }),
  });
  const clearDispute = useTenantMutation<{ id: string }, void>({
    mock: ({ id }) => {
      mockClearDispute(id);
    },
    convexRef: anyApi.vendorBills.clearDispute,
    convexArgsAdapter: ({ id }) => ({ id }),
  });
  const voidBill = useTenantMutation<{ id: string }, void>({
    mock: ({ id }) => {
      mockVoid(id);
    },
    convexRef: anyApi.vendorBills.voidBill,
    convexArgsAdapter: ({ id }) => ({ id }),
  });
  const deleteBill = useTenantMutation<{ id: string }, void>({
    mock: ({ id }) => {
      mockDelete(id);
    },
    convexRef: anyApi.vendorBills.remove,
    convexArgsAdapter: ({ id }) => ({ id }),
  });
  const updateNotes = useTenantMutation<
    { id: string; internal_notes: string },
    void
  >({
    mock: ({ id, internal_notes }) => {
      mockUpdate(id, { internal_notes });
    },
    convexRef: anyApi.vendorBills.update,
    convexArgsAdapter: ({ id, internal_notes }) => ({
      id,
      patch: { internal_notes },
    }),
  });

  function onApprove() {
    void approve({ id: bill.id });
    onClose();
  }
  function onSchedule() {
    void schedule({
      id: bill.id,
      scheduled_payment_date: schedDate,
      scheduled_payment_method: schedMethod,
    });
    onClose();
  }
  function onMarkPaid() {
    void markPaid({
      id: bill.id,
      paid_via: paidVia.trim() || undefined,
      payment_method: schedMethod,
    });
    onClose();
  }
  function onDispute() {
    if (!disputeReason.trim()) return;
    void dispute({ id: bill.id, reason: disputeReason.trim() });
    onClose();
  }
  function onClearDispute() {
    void clearDispute({ id: bill.id });
    onClose();
  }
  function onVoid() {
    if (!window.confirm("Mark this bill void? It can't be paid afterwards.")) return;
    void voidBill({ id: bill.id });
    onClose();
  }
  function onDelete() {
    if (!window.confirm(`Delete draft ${bill.number}? This cannot be undone.`)) return;
    void deleteBill({ id: bill.id });
    onClose();
  }
  function onSaveNotes() {
    if (notesDraft === (bill.internal_notes ?? "")) return;
    void updateNotes({ id: bill.id, internal_notes: notesDraft });
  }

  // ── Action availability ─────────────────────────────────────────

  const canApprove =
    bill.status === "pending_approval" || (bill.status === "draft" && bill.amount > 0);
  const canSchedule = bill.status === "approved" || bill.status === "scheduled";
  const canMarkPaid = bill.status === "approved" || bill.status === "scheduled";
  const canDispute =
    bill.status === "pending_approval" ||
    bill.status === "approved" ||
    bill.status === "scheduled";
  const isReadOnly = bill.status === "paid" || bill.status === "void";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[720px] max-h-[90vh] overflow-auto rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold text-fg">
                {bill.number}
              </h3>
              <Badge tone={badgeTone(bill.status)} size="sm">
                {bill.status.replace("_", " ")}
              </Badge>
            </div>
            <p className="mt-0.5 text-[12px] text-fg-subtle">
              {vendor?.display_name ?? vendor?.name ?? bill.vendor_id}
              {bill.vendor_invoice_number && (
                <>
                  {" · "}
                  <span className="font-mono">{bill.vendor_invoice_number}</span>
                </>
              )}
            </p>
            {inboundEmail && (
              <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-2 px-2 py-0.5 text-[10.5px] text-fg-tertiary">
                <Mail className="size-3" />
                From inbound email ·{" "}
                <span className="font-mono text-fg-subtle">
                  {inboundEmail.from_email}
                </span>
              </div>
            )}
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

        {/* Disputed banner */}
        {bill.status === "disputed" && (
          <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-status-danger/30 bg-status-danger/10 p-3 text-[12px] text-status-danger">
            <AlertTriangle className="size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">Disputed — blocked from payment</div>
              <div className="mt-0.5">{bill.dispute_reason}</div>
            </div>
          </div>
        )}

        {/* Pane tabs */}
        {!isReadOnly && (
          <div className="mt-4 flex gap-1 border-b border-hairline">
            <PaneTab label="Overview" active={pane === "overview"} onClick={() => setPane("overview")} />
            {canSchedule && (
              <PaneTab label="Schedule payment" active={pane === "schedule"} onClick={() => setPane("schedule")} />
            )}
            {canMarkPaid && (
              <PaneTab label="Mark paid" active={pane === "pay"} onClick={() => setPane("pay")} />
            )}
            {canDispute && (
              <PaneTab label="Dispute" active={pane === "dispute"} onClick={() => setPane("dispute")} />
            )}
          </div>
        )}

        <div className="mt-4">
          {pane === "overview" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bill date" value={bill.bill_date} />
              <Field label="Due date" value={bill.due_date} />
              <Field label="Total" value={formatMoney(bill.amount)} money />
              {bill.tax_amount !== undefined && (
                <Field label="Tax" value={formatMoney(bill.tax_amount)} money />
              )}
              {bill.scheduled_payment_date && (
                <>
                  <Field label="Scheduled" value={bill.scheduled_payment_date} />
                  <Field
                    label="Method"
                    value={bill.scheduled_payment_method?.toUpperCase() ?? "—"}
                  />
                </>
              )}
              {bill.paid_at && (
                <>
                  <Field label="Paid on" value={bill.paid_at} />
                  <Field label="Paid via" value={bill.paid_via ?? "—"} />
                </>
              )}
              {bill.approved_at && (
                <>
                  <Field label="Approved by" value={bill.approved_by ?? "—"} />
                  <Field label="Approved at" value={bill.approved_at.slice(0, 10)} />
                </>
              )}
              {bill.description && (
                <Field label="Description" value={bill.description} col={2} />
              )}

              {/* Line items */}
              {bill.line_items && bill.line_items.length > 0 && (
                <div className="col-span-2 mt-2">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
                    Line items
                  </div>
                  <div className="mt-1 overflow-hidden rounded-[8px] border border-hairline">
                    {bill.line_items.map((l, i) => (
                      <div
                        key={i}
                        className="grid items-center gap-2 border-b border-hairline px-2.5 py-1.5 text-[12px] last:border-b-0"
                        style={{ gridTemplateColumns: "minmax(0, 2fr) 90px minmax(0, 1.5fr)" }}
                      >
                        <span className="truncate text-fg">{l.description}</span>
                        <span className="money-display text-fg-subtle">{formatMoney(l.amount)}</span>
                        <span className="truncate text-[11px] text-fg-tertiary">
                          {l.gl_account ?? "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Attachments */}
              {bill.attachment_ids && bill.attachment_ids.length > 0 && (
                <div className="col-span-2">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
                    Attachments
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {bill.attachment_ids.map((a) => (
                      <span
                        key={a}
                        className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-2 px-2 py-0.5 text-[11px] text-fg-subtle"
                      >
                        <FileText className="size-3" />
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Conversation / notes */}
              <div className="col-span-2 mt-1">
                <div className="text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
                  Internal notes
                </div>
                {isReadOnly ? (
                  <p className="mt-1 whitespace-pre-line text-[12px] text-fg-subtle">
                    {bill.internal_notes ?? "—"}
                  </p>
                ) : (
                  <>
                    <textarea
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      onBlur={onSaveNotes}
                      rows={2}
                      className="mt-1 block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[12px] text-fg focus:border-primary focus:outline-none"
                      placeholder="Add a note for the approver / file"
                    />
                    <p className="mt-0.5 text-[10px] text-fg-tertiary">
                      Saved on blur.
                    </p>
                  </>
                )}
              </div>

              {bill.payment_ledger_entry_id && (
                <div className="col-span-2 rounded-[8px] border border-hairline bg-surface-2 p-2 text-[11px] text-fg-tertiary">
                  Linked ledger entry:{" "}
                  <span className="font-mono">{bill.payment_ledger_entry_id}</span>
                </div>
              )}
            </div>
          )}

          {pane === "schedule" && canSchedule && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pay date" col={2}>
                <input
                  type="date"
                  value={schedDate}
                  onChange={(e) => setSchedDate(e.target.value)}
                  className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
                />
              </Field>
              <Field label="Payment method" col={2}>
                <div className="flex gap-2">
                  {(["ach", "check", "card", "wire"] as const).map((m) => (
                    <MethodChip
                      key={m}
                      label={m.toUpperCase()}
                      active={schedMethod === m}
                      onClick={() => setSchedMethod(m)}
                    />
                  ))}
                </div>
              </Field>
              <div className="col-span-2 flex justify-end">
                <Button variant="primary" size="sm" onClick={onSchedule}>
                  <CalendarClock className="size-3.5" />
                  Schedule for {schedDate}
                </Button>
              </div>
            </div>
          )}

          {pane === "pay" && canMarkPaid && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Payment method" col={2}>
                <div className="flex gap-2">
                  {(["ach", "check", "card", "wire"] as const).map((m) => (
                    <MethodChip
                      key={m}
                      label={m.toUpperCase()}
                      active={schedMethod === m}
                      onClick={() => setSchedMethod(m)}
                    />
                  ))}
                </div>
              </Field>
              <Field label="Reference / check #" col={2}>
                <input
                  value={paidVia}
                  onChange={(e) => setPaidVia(e.target.value)}
                  placeholder="ACH-12345 / check #1042"
                  className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
                />
              </Field>
              <div className="col-span-2 flex justify-end">
                <Button variant="primary" size="sm" onClick={onMarkPaid}>
                  <Check className="size-3.5" />
                  Mark {formatMoney(bill.amount)} paid
                </Button>
              </div>
            </div>
          )}

          {pane === "dispute" && canDispute && (
            <div className="space-y-3">
              <Field label="Dispute reason" col={2}>
                <textarea
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  rows={3}
                  placeholder="Duplicate billing / wrong amount / never received goods…"
                  className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[12px] text-fg focus:border-primary focus:outline-none"
                />
              </Field>
              <div className="flex justify-end">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!disputeReason.trim()}
                  onClick={onDispute}
                >
                  <AlertTriangle className="size-3.5" />
                  Mark disputed
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer action row */}
        <div className="mt-5 flex items-center justify-between gap-2 border-t border-hairline pt-3">
          <div className="flex gap-1.5">
            {bill.status === "draft" && (
              <button
                type="button"
                onClick={onDelete}
                className="rounded-[8px] px-2 py-1.5 text-[12px] text-status-danger hover:bg-status-danger/10"
              >
                Delete draft
              </button>
            )}
            {(bill.status === "approved" ||
              bill.status === "scheduled" ||
              bill.status === "pending_approval") && (
              <button
                type="button"
                onClick={onVoid}
                className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1.5 text-[12px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
              >
                <Ban className="size-3" />
                Void bill
              </button>
            )}
            {bill.status === "disputed" && (
              <Button variant="secondary" size="sm" onClick={onClearDispute}>
                <RotateCcw className="size-3.5" />
                Clear dispute
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {canApprove && pane === "overview" && (
              <Button variant="primary" size="sm" onClick={onApprove}>
                <Check className="size-3.5" />
                Approve
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  money,
  col = 1,
  children,
}: {
  label: string;
  value?: string;
  money?: boolean;
  col?: 1 | 2;
  children?: React.ReactNode;
}) {
  return (
    <div className={col === 2 ? "col-span-2" : ""}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </div>
      {children ?? (
        <div className={cn("mt-0.5 text-[12px] text-fg", money && "money-display")}>
          {value}
        </div>
      )}
    </div>
  );
}

function PaneTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border-b-2 px-2.5 py-1.5 text-[12px] transition-colors",
        active
          ? "border-primary text-fg"
          : "border-transparent text-fg-subtle hover:text-fg",
      )}
    >
      {label}
    </button>
  );
}

function MethodChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-fg"
          : "border-hairline bg-surface-2 text-fg-subtle hover:bg-surface-3",
      )}
    >
      {label}
    </button>
  );
}
