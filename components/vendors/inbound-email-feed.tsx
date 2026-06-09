"use client";

/*
 * Inbound email feed — surfaces every email Postmark forwarded into the
 * AP inbox (bills@<marina>.marinastee.com → /api/inbound/postmark).
 *
 * One row per InboundEmail. Status walks the ingest pipeline:
 *
 *   ingested        — neutral chip, no PDF / no parse action taken
 *   matched_vendor  — info chip, vendor matched but no usable amount
 *   created_draft   — ok chip + "Open bill →" link to the approval queue
 *   failed          — danger chip + error_reason tooltip
 *
 * The feed is sorted newest first. When an email maps to a vendor bill,
 * clicking the row opens that bill via `onOpenBill` (passed from the
 * parent so the BillDetailModal continues to live in vendors-client.tsx).
 *
 * Empty state nudges the operator to forward an invoice — most marinas
 * get their first inbound bill within a day of going live.
 */

import * as React from "react";
import { Mail, ExternalLink, AlertTriangle, CheckCircle2, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { InboundEmail, InboundEmailStatus, Vendor, VendorBill } from "@/lib/types";

interface Props {
  emails: InboundEmail[];
  vendors: Vendor[];
  bills: VendorBill[];
  /** Open the BillDetailModal in the parent. Falsy when the bill_id is unknown. */
  onOpenBill?: (bill: VendorBill) => void;
}

export function InboundEmailFeed({ emails, vendors, bills, onOpenBill }: Props) {
  const vendorById = React.useMemo(
    () => new Map(vendors.map((v) => [v.id, v])),
    [vendors],
  );
  const billById = React.useMemo(
    () => new Map(bills.map((b) => [b.id, b])),
    [bills],
  );

  if (emails.length === 0) {
    return (
      <div className="rounded-[12px] border border-dashed border-hairline bg-surface-1 p-8 text-center">
        <Inbox className="mx-auto size-6 text-fg-tertiary" />
        <div className="mt-3 text-[13px] font-medium text-fg">
          Inbox is quiet
        </div>
        <p className="mt-1 text-[12px] text-fg-tertiary">
          Forward a vendor invoice to{" "}
          <span className="font-mono text-fg-subtle">
            bills@&lt;your-marina&gt;.marinastee.com
          </span>{" "}
          to see it land here.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
      <div
        className="grid gap-x-3 border-b border-hairline bg-surface-2 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
        style={{
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 2fr) 130px 130px 90px",
        }}
      >
        <span>From</span>
        <span>Subject</span>
        <span>Received</span>
        <span>Status</span>
        <span></span>
      </div>
      <ul className="divide-y divide-hairline">
        {emails.map((e) => {
          const vendor = e.vendor_id ? vendorById.get(e.vendor_id) : undefined;
          const bill = e.vendor_bill_id ? billById.get(e.vendor_bill_id) : undefined;
          const tone = toneFor(e.status);
          const label = labelFor(e.status);
          const Icon = iconFor(e.status);
          return (
            <li
              key={e.id}
              className="group grid gap-x-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
              style={{
                gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 2fr) 130px 130px 90px",
              }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Mail className="size-3 shrink-0 text-fg-tertiary" />
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-medium text-fg">
                    {e.from_name ?? e.from_email}
                  </div>
                  <div className="truncate text-[11px] text-fg-tertiary">
                    {vendor ? (vendor.display_name ?? vendor.name) : e.from_email}
                  </div>
                </div>
              </div>
              <div className="min-w-0 self-center">
                <div className="truncate text-[12.5px] text-fg">
                  {e.subject ?? <span className="text-fg-tertiary">(no subject)</span>}
                </div>
                {e.error_reason && (
                  <div className="truncate text-[11px] text-status-danger">
                    {humanizeError(e.error_reason)}
                  </div>
                )}
              </div>
              <span className="self-center text-[11.5px] text-fg-subtle">
                {formatRelative(e.received_at)}
              </span>
              <span className="self-center">
                <Badge tone={tone} size="sm">
                  <Icon className="size-3" />
                  {label}
                </Badge>
              </span>
              <span className="self-center">
                {bill && onOpenBill ? (
                  <button
                    type="button"
                    onClick={() => onOpenBill(bill)}
                    className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
                  >
                    Open
                    <ExternalLink className="size-3" />
                  </button>
                ) : (
                  <span className="text-[11px] text-fg-tertiary">—</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Status display
// ────────────────────────────────────────────────────────────

function toneFor(s: InboundEmailStatus): "ok" | "warn" | "danger" | "info" | "neutral" {
  switch (s) {
    case "created_draft":
      return "ok";
    case "matched_vendor":
      return "info";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

function labelFor(s: InboundEmailStatus): string {
  switch (s) {
    case "created_draft":
      return "Drafted";
    case "matched_vendor":
      return "Matched";
    case "failed":
      return "Failed";
    default:
      return "Logged";
  }
}

function iconFor(
  s: InboundEmailStatus,
): React.ComponentType<{ className?: string }> {
  switch (s) {
    case "created_draft":
      return CheckCircle2;
    case "failed":
      return AlertTriangle;
    default:
      return Mail;
  }
}

function humanizeError(code: string): string {
  switch (code) {
    case "no_pdf_attachment":
      return "No PDF attached";
    case "extraction_failed":
      return "Couldn't parse the PDF";
    case "vendor_not_matched":
      return "No matching vendor — add the vendor first";
    case "duplicate_invoice":
      return "Already booked under that invoice number";
    case "no_amount_extracted":
      return "Vendor matched but amount couldn't be read";
    case "pdf_too_large":
      return "PDF too large (>20MB) — re-send compressed";
    case "not_a_pdf":
      return "Attachment wasn't a valid PDF";
    case "attachment_decode_failed":
      return "Attachment couldn't be decoded";
    default:
      return code.replace(/_/g, " ");
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso.slice(0, 10);
  const deltaMs = Date.now() - then;
  const mins = Math.round(deltaMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return iso.slice(0, 10);
}
