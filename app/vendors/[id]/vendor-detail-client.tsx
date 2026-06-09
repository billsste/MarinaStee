"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Mail, Phone, MapPin, FileText, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { formatMoney } from "@/lib/mock-data";
import { useBillsForVendor, useVendors } from "@/lib/client-store";
import { NewBillDialog } from "@/components/vendors/new-bill-dialog";
import { PayBillSheet } from "@/components/vendors/pay-bill-sheet";
import type { Bill } from "@/lib/types";

export function VendorDetailClient({ id }: { id: string }) {
  const vendors = useVendors();
  const vendor = vendors.find((v) => v.id === id);
  const bills = useBillsForVendor(id);
  const [creating, setCreating] = React.useState(false);
  const [paying, setPaying] = React.useState<Bill | null>(null);

  if (!vendor) {
    return (
      <PageShell title="Vendor" description="">
        <div className="rounded-[12px] border border-hairline bg-surface-1 p-6 text-center text-[13px] text-fg-tertiary">
          Vendor not found.{" "}
          <Link href="/vendors" className="text-primary hover:underline">
            Back to vendors
          </Link>
        </div>
      </PageShell>
    );
  }

  const openAR = bills
    .filter((b) => b.status !== "paid")
    .reduce((s, b) => s + (b.amount - b.amount_paid), 0);
  const totalPaid = bills.reduce((s, b) => s + b.amount_paid, 0);

  return (
    <PageShell
      title={vendor.display_name ?? vendor.name}
      description={vendor.contact_name ?? ""}
      width="wide"
    >
      <Link
        href="/vendors"
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-fg-subtle hover:text-fg"
      >
        <ArrowLeft className="size-3.5" /> Back to vendors
      </Link>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Contact */}
        <Panel title="Contact">
          <div className="space-y-1.5 text-[13px]">
            {vendor.contact_name && (
              <div className="text-fg">{vendor.contact_name}</div>
            )}
            {vendor.email && (
              <div className="inline-flex items-center gap-1.5 text-fg-subtle">
                <Mail className="size-3.5" /> {vendor.email}
              </div>
            )}
            {vendor.phone && (
              <div className="inline-flex items-center gap-1.5 text-fg-subtle">
                <Phone className="size-3.5" /> {vendor.phone}
              </div>
            )}
            {(vendor.address_line1 || vendor.city) && (
              <div className="inline-flex items-start gap-1.5 text-fg-subtle">
                <MapPin className="size-3.5 mt-0.5" />
                <div>
                  {vendor.address_line1 && <div>{vendor.address_line1}</div>}
                  {vendor.address_line2 && <div>{vendor.address_line2}</div>}
                  <div>
                    {vendor.city}
                    {vendor.state ? `, ${vendor.state}` : ""}{" "}
                    {vendor.postal_code ?? ""}
                  </div>
                </div>
              </div>
            )}
          </div>
        </Panel>

        {/* Settings */}
        <Panel title="Billing settings">
          <div className="space-y-1.5 text-[13px]">
            <Row label="Terms" value={vendor.payment_terms.replace("_", " ")} />
            <Row label="Default GL" value={vendor.default_gl_account ?? "—"} />
            {vendor.tax_id_last4 && (
              <Row label="Tax ID" value={`••••${vendor.tax_id_last4}`} />
            )}
            <Row
              label="1099-NEC"
              value={
                vendor.issue_1099 ? (
                  <Badge tone="info" size="sm">
                    Yes
                  </Badge>
                ) : (
                  <span className="text-fg-tertiary">No</span>
                )
              }
            />
            <Row
              label="Status"
              value={
                <Badge tone={vendor.active ? "ok" : "neutral"} size="sm">
                  {vendor.active ? "Active" : "Inactive"}
                </Badge>
              }
            />
          </div>
        </Panel>

        {/* AR snapshot */}
        <Panel title="AR snapshot">
          <div className="space-y-2">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
                Open AR
              </div>
              <div
                className={
                  openAR > 0
                    ? "money-display text-[24px] text-status-warn"
                    : "money-display text-[24px] text-status-ok"
                }
              >
                {formatMoney(openAR)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
                Lifetime paid
              </div>
              <div className="money-display text-[16px] text-fg">
                {formatMoney(totalPaid)}
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* Bills */}
      <div className="rounded-[12px] border border-hairline bg-surface-1">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
          <div className="inline-flex items-center gap-1.5 text-[13px] font-medium text-fg">
            <FileText className="size-3.5" />
            Bills ({bills.length})
          </div>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            New bill
          </Button>
        </div>
        {bills.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-fg-tertiary">
            No bills yet for this vendor.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {[...bills]
              .sort((a, b) => (a.bill_date < b.bill_date ? 1 : -1))
              .map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-fg">
                      {b.number} · {formatMoney(b.amount)}
                    </div>
                    <div className="text-[11px] text-fg-tertiary">
                      Bill {b.bill_date} · due {b.due_date}
                      {b.amount_paid > 0
                        ? ` · paid ${formatMoney(b.amount_paid)}`
                        : ""}
                    </div>
                  </div>
                  <Badge
                    tone={
                      b.status === "paid"
                        ? "ok"
                        : b.status === "partial"
                        ? "info"
                        : "warn"
                    }
                    size="sm"
                  >
                    {b.status}
                  </Badge>
                  {b.status !== "paid" && b.status !== "void" && (
                    <button
                      type="button"
                      onClick={() => setPaying(b)}
                      className="rounded-[8px] bg-primary px-2 py-1 text-[11px] font-medium text-on-primary hover:bg-primary-hover"
                    >
                      Pay
                    </button>
                  )}
                </li>
              ))}
          </ul>
        )}
      </div>

      {creating && (
        <NewBillDialog onClose={() => setCreating(false)} vendors={vendors} />
      )}
      {paying && <PayBillSheet bill={paying} onClose={() => setPaying(null)} />}
    </PageShell>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <h2 className="mb-3 text-[12px] font-medium uppercase tracking-wide text-fg-tertiary">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-fg-tertiary">{label}</span>
      <span className="text-right text-[13px] text-fg">{value}</span>
    </div>
  );
}
