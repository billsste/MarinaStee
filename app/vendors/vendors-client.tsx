"use client";

import * as React from "react";
import Link from "next/link";
import { useTabUrlState } from "@/lib/use-tab-url-state";
import { anyApi } from "convex/server";
import { Briefcase, Receipt, Plus, Inbox, Sparkles, Settings as SettingsIcon, Mail, ExternalLink, FileText, MailOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { formatMoney } from "@/lib/mock-data";
import {
  deleteBill,
  deleteVendor,
  nextVendorId,
  upsertBill,
  upsertVendor,
  useAiSettings,
  useBills,
  useExtractionDrafts,
  useInboundEmails,
  useVendorBills,
  useVendors,
} from "@/lib/client-store";
import {
  approveDraft,
  persistFreshDraft,
  rejectDraft,
} from "@/lib/ai-extract-executor";
import { useTenantMutation } from "@/lib/use-tenant-mutation";
import { useTenantQuery } from "@/lib/use-tenant-query";
import { cn } from "@/lib/utils";
import type { Bill, ExtractionDraft, Vendor, VendorBill, VendorPaymentTerms } from "@/lib/types";
import { NewBillDialog } from "@/components/vendors/new-bill-dialog";
import { PayBillSheet } from "@/components/vendors/pay-bill-sheet";
import { NewBillWizard } from "@/components/vendors/new-bill-wizard";
import { BillsTable, type BillsFilterStatus } from "@/components/vendors/bills-table";
import { BillDetailModal } from "@/components/vendors/bill-detail-modal";
import { ApprovalQueueSection } from "@/components/vendors/approval-queue-section";
import { InboundEmailFeed } from "@/components/vendors/inbound-email-feed";
import { DropZone } from "@/components/ai/drop-zone";
import { DraftCard, type DraftField } from "@/components/ai/draft-card";
import { RentalsAsk } from "@/components/rentals/rentals-ask";

/*
 * /vendors — Vendor list + Bills aging. Same shell pattern as
 * /staff and /members: left rail + content. Deep-links via
 * `?section=bills` (used by the dashboard back-office KPIs).
 */

type SectionKey = "inbox" | "inbound_email" | "vendors" | "bills" | "ap_workflow";

const NAV: {
  key: SectionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}[] = [
  {
    key: "inbox",
    label: "AP Inbox",
    icon: Inbox,
    description: "Drop a vendor invoice — we parse it into a draft bill for review.",
  },
  {
    key: "inbound_email",
    label: "Inbound",
    icon: MailOpen,
    description:
      "Vendor invoices forwarded to bills@<marina>.marinastee.com — parsed into draft bills automatically.",
  },
  {
    key: "vendors",
    label: "Vendors",
    icon: Briefcase,
    description: "Suppliers, service providers, and 1099 contractors.",
  },
  {
    key: "ap_workflow",
    label: "Bills",
    icon: FileText,
    description: "Approve, schedule, and pay vendor bills — with aging buckets so nothing slips past due.",
  },
  {
    key: "bills",
    label: "Manual bills",
    icon: Receipt,
    description: "Bills you keyed in directly (no email-in or PDF drop). Pay, partial-pay, or write off.",
  },
];

function isVendorSection(v: string | null | undefined): v is SectionKey {
  return (
    v === "inbox" ||
    v === "inbound_email" ||
    v === "vendors" ||
    v === "bills" ||
    v === "ap_workflow"
  );
}

export function VendorsClient() {
  // ?tab= is the canonical deep-link param across the app. Old
  // ?section=inbound and ?section=ap aliases are not supported on the
  // new shape — operator quick-links would have used the dashboard
  // CTA which we'll update separately.
  const [section, setSection] = useTabUrlState<SectionKey>(
    "tab",
    isVendorSection,
    "inbox",
  );
  const active = NAV.find((n) => n.key === section) ?? NAV[0];

  return (
    <PageShell title="Vendors" description={active.description} width="wide">
      <div className="mb-5">
        <RentalsAsk
          placeholder="Ask the agent — e.g. 'pay the Pinon Petroleum bill' or 'who has bills past 30 days?'"
          suggestions={[
            "Who has bills past 30 days?",
            "Pay the Pinon Petroleum bill",
            "Show me top vendors by YTD spend",
            "Add Sandia Marine as a vendor on Net 30",
          ]}
        />
      </div>
      <div
        className="grid gap-6"
        style={{ gridTemplateColumns: "200px minmax(0, 1fr)" }}
      >
        <nav
          aria-label="Vendor sections"
          className="space-y-0.5 md:sticky md:top-20 md:self-start"
        >
          {NAV.map((item) => {
            const Icon = item.icon;
            const isActive = section === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSection(item.key)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] transition-colors",
                  isActive
                    ? "bg-surface-3 font-medium text-fg"
                    : "text-fg-subtle hover:bg-surface-2 hover:text-fg"
                )}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          {section === "inbox" && <InboxView />}
          {section === "inbound_email" && <InboundEmailView />}
          {section === "vendors" && <VendorListView />}
          {section === "ap_workflow" && <VendorBillsView />}
          {section === "bills" && <BillsView />}
        </div>
      </div>
    </PageShell>
  );
}

// ── Vendors ──────────────────────────────────────────────────

// Convex shape of `vendors` rows. Fields mirror schema.ts. Adapter
// folds `_id` / `tenantId` / `_creationTime` into the mock-shape
// Vendor the rest of the page already consumes.
interface ConvexVendor {
  _id: string;
  tenantId: string;
  _creationTime?: number;
  name: string;
  display_name?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  payment_terms: VendorPaymentTerms;
  default_gl_account?: string;
  tax_id_last4?: string;
  issue_1099: boolean;
  notes?: string;
  active: boolean;
}

function convexVendorsToMock(rows: ConvexVendor[]): Vendor[] {
  return rows.map((r) => ({
    id: r._id,
    tenant_id: r.tenantId,
    name: r.name,
    display_name: r.display_name,
    contact_name: r.contact_name,
    email: r.email,
    phone: r.phone,
    address_line1: r.address_line1,
    address_line2: r.address_line2,
    city: r.city,
    state: r.state,
    postal_code: r.postal_code,
    country: r.country,
    payment_terms: r.payment_terms,
    default_gl_account: r.default_gl_account,
    tax_id_last4: r.tax_id_last4,
    issue_1099: r.issue_1099,
    notes: r.notes,
    active: r.active,
    created_at: r._creationTime
      ? new Date(r._creationTime).toISOString()
      : new Date().toISOString(),
  }));
}

const VENDORS_EMPTY_ARGS = {} as const;

function VendorListView() {
  // Mock subscription is unconditional. `useTenantQuery` returns mock
  // when Convex is offline; otherwise the live (tenant-scoped) row
  // set from `vendors.list`.
  const mockVendors = useVendors();
  const vendors = useTenantQuery<Vendor[], ConvexVendor[]>({
    mock: mockVendors,
    convexRef: anyApi.vendors.list,
    convexArgs: VENDORS_EMPTY_ARGS,
    convexAdapter: convexVendorsToMock,
  });
  const bills = useBills();
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Vendor | null>(null);

  function openAR(vendorId: string): number {
    return bills
      .filter((b) => b.vendor_id === vendorId && b.status !== "paid")
      .reduce((s, b) => s + (b.amount - b.amount_paid), 0);
  }

  const sorted = [...vendors].sort((a, b) => {
    const arA = openAR(a.id);
    const arB = openAR(b.id);
    if (arA !== arB) return arB - arA;   // most open AR first
    return (a.display_name ?? a.name).localeCompare(b.display_name ?? b.name);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <p className="text-[12px] text-fg-tertiary">
          Click a row to edit vendor terms, GL, contact. Hover for the full profile.
        </p>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" />
          New vendor
        </Button>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{
            gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.5fr) 110px 110px 60px",
          }}
        >
          <span>Vendor</span>
          <span>Contact</span>
          <span>Terms</span>
          <span>Open AR</span>
          <span>1099</span>
        </div>
        {sorted.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-fg-tertiary">
            No vendors yet. Click <span className="font-medium text-fg-subtle">New vendor</span> to add one.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {sorted.map((v) => {
              const ar = openAR(v.id);
              return (
                <li key={v.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setEditing(v)}
                    style={{
                      gridTemplateColumns:
                        "minmax(0, 2fr) minmax(0, 1.5fr) 110px 110px 60px",
                    }}
                    className="grid w-full cursor-pointer items-center gap-x-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-fg">
                        {v.display_name ?? v.name}
                      </div>
                      <div className="truncate text-[11px] text-fg-tertiary">
                        {v.email ?? v.phone ?? "—"}
                      </div>
                    </div>
                    <span className="truncate text-[12px] text-fg-subtle">
                      {v.contact_name ?? "—"}
                    </span>
                    <span className="text-[11px] uppercase text-fg-subtle">
                      {labelForTerms(v.payment_terms)}
                    </span>
                    <span
                      className={cn(
                        "money-display text-[13px]",
                        ar > 0 ? "text-status-warn" : "text-fg-tertiary"
                      )}
                    >
                      {ar > 0 ? formatMoney(ar) : "—"}
                    </span>
                    <span className="text-[11px]">
                      {v.issue_1099 ? (
                        <Badge tone="info" size="sm">
                          1099
                        </Badge>
                      ) : (
                        <span className="text-fg-tertiary">—</span>
                      )}
                    </span>
                  </button>
                  <Link
                    href={`/vendors/${v.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-[6px] p-1.5 text-fg-tertiary opacity-0 transition-opacity hover:bg-surface-3 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label="Open vendor profile"
                    title="Open profile"
                  >
                    <ExternalLink className="size-3" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {(creating || editing) && (
        <NewVendorSheet
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          vendor={editing}
        />
      )}
    </div>
  );
}

function labelForTerms(t: VendorPaymentTerms) {
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

/** New + edit. When `vendor` is passed in, the form pre-fills + upserts the same id. */
function NewVendorSheet({
  onClose,
  vendor,
}: {
  onClose: () => void;
  vendor?: Vendor | null;
}) {
  const [name, setName] = React.useState(vendor?.name ?? "");
  const [displayName, setDisplayName] = React.useState(vendor?.display_name ?? "");
  const [contactName, setContactName] = React.useState(vendor?.contact_name ?? "");
  const [email, setEmail] = React.useState(vendor?.email ?? "");
  const [phone, setPhone] = React.useState(vendor?.phone ?? "");
  const [terms, setTerms] = React.useState<VendorPaymentTerms>(vendor?.payment_terms ?? "net_30");
  const [defaultGl, setDefaultGl] = React.useState(vendor?.default_gl_account ?? "");
  const [tax4, setTax4] = React.useState(vendor?.tax_id_last4 ?? "");
  const [issue1099, setIssue1099] = React.useState(vendor?.issue_1099 ?? false);

  // Phase 4 — Convex-or-mock writes. Mock fn = upsertVendor for both
  // create + edit; Convex separates them, so the callsite branches
  // on `vendor` presence. Delete is hard-remove (mock semantics).
  const createVendor = useTenantMutation<Vendor, void>({
    mock: (v) => upsertVendor(v),
    convexRef: anyApi.vendors.create,
    convexArgsAdapter: (v) => ({
      name: v.name,
      display_name: v.display_name,
      contact_name: v.contact_name,
      email: v.email,
      phone: v.phone,
      address_line1: v.address_line1,
      address_line2: v.address_line2,
      city: v.city,
      state: v.state,
      postal_code: v.postal_code,
      country: v.country,
      payment_terms: v.payment_terms,
      default_gl_account: v.default_gl_account,
      tax_id_last4: v.tax_id_last4,
      issue_1099: v.issue_1099,
      notes: v.notes,
      active: v.active,
    }),
  });
  const updateVendor = useTenantMutation<Vendor, void>({
    mock: (v) => upsertVendor(v),
    convexRef: anyApi.vendors.update,
    convexArgsAdapter: (v) => ({
      id: v.id,
      patch: {
        name: v.name,
        display_name: v.display_name,
        contact_name: v.contact_name,
        email: v.email,
        phone: v.phone,
        address_line1: v.address_line1,
        address_line2: v.address_line2,
        city: v.city,
        state: v.state,
        postal_code: v.postal_code,
        country: v.country,
        payment_terms: v.payment_terms,
        default_gl_account: v.default_gl_account,
        tax_id_last4: v.tax_id_last4,
        issue_1099: v.issue_1099,
        notes: v.notes,
        active: v.active,
      },
    }),
  });
  const removeVendor = useTenantMutation<string, void>({
    mock: (id) => deleteVendor(id),
    convexRef: anyApi.vendors.remove,
    convexArgsAdapter: (id) => ({ id }),
  });

  function save() {
    if (!name.trim()) return;
    const stamped: Vendor = {
      id: vendor?.id ?? nextVendorId(),
      tenant_id: vendor?.tenant_id ?? "",
      name: name.trim(),
      display_name: displayName.trim() || undefined,
      contact_name: contactName.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      address_line1: vendor?.address_line1,
      address_line2: vendor?.address_line2,
      city: vendor?.city,
      state: vendor?.state,
      postal_code: vendor?.postal_code,
      country: vendor?.country,
      payment_terms: terms,
      default_gl_account: defaultGl.trim() || undefined,
      tax_id_last4: tax4.trim() || undefined,
      issue_1099: issue1099,
      notes: vendor?.notes,
      active: vendor?.active ?? true,
      created_at: vendor?.created_at ?? new Date().toISOString(),
      attachment_ids: vendor?.attachment_ids,
      extracted_from_draft_id: vendor?.extracted_from_draft_id,
    };
    if (vendor) {
      void updateVendor(stamped);
    } else {
      void createVendor(stamped);
    }
    onClose();
  }

  function remove() {
    if (!vendor) return;
    if (!window.confirm(`Delete ${vendor.display_name ?? vendor.name}? All bills stay; only the vendor record is removed.`)) return;
    void removeVendor(vendor.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[520px] rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-fg">{vendor ? `Edit ${vendor.display_name ?? vendor.name}` : "New vendor"}</h3>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <SheetField label="Legal name *" col={2}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Pinon Petroleum LLC"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </SheetField>
          <SheetField label="Display name" col={2}>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Pinon Petroleum"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </SheetField>
          <SheetField label="Contact">
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </SheetField>
          <SheetField label="Phone">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </SheetField>
          <SheetField label="Email" col={2}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </SheetField>
          <SheetField label="Payment terms">
            <select
              value={terms}
              onChange={(e) => setTerms(e.target.value as VendorPaymentTerms)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            >
              <option value="due_on_receipt">Due on receipt</option>
              <option value="net_7">Net 7</option>
              <option value="net_15">Net 15</option>
              <option value="net_30">Net 30</option>
              <option value="net_60">Net 60</option>
            </select>
          </SheetField>
          <SheetField label="Default GL account">
            <input
              value={defaultGl}
              onChange={(e) => setDefaultGl(e.target.value)}
              placeholder="Fuel — Cost of Goods"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </SheetField>
          <SheetField label="Tax ID (last 4)">
            <input
              value={tax4}
              onChange={(e) => setTax4(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] font-mono text-fg focus:border-primary focus:outline-none"
            />
          </SheetField>
          <SheetField label="">
            <label className="mt-2 flex items-center gap-2 text-[12px] text-fg">
              <input
                type="checkbox"
                checked={issue1099}
                onChange={(e) => setIssue1099(e.target.checked)}
              />
              Issue 1099-NEC year-end
            </label>
          </SheetField>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          {vendor ? (
            <button
              type="button"
              onClick={remove}
              className="rounded-[8px] px-3 py-1.5 text-[12px] text-status-danger hover:bg-status-danger/10"
            >
              Delete vendor
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[8px] px-3 py-1.5 text-[13px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!name.trim()}
              className={cn(
                "rounded-[10px] px-3 py-2 text-[13px] font-medium transition-colors",
                name.trim()
                  ? "bg-primary text-on-primary hover:bg-primary-hover"
                  : "cursor-not-allowed bg-surface-3 text-fg-tertiary"
              )}
            >
              {vendor ? "Save changes" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SheetField({
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
      {label && (
        <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          {label}
        </label>
      )}
      <div className="mt-1">{children}</div>
    </div>
  );
}

// ── Bills (AP aging) ─────────────────────────────────────────

type AgingBucket = "all" | "current" | "due_soon" | "past_due" | "paid";

function BillsView() {
  const bills = useBills();
  const vendors = useVendors();
  const vendorById = React.useMemo(
    () => new Map(vendors.map((v) => [v.id, v])),
    [vendors]
  );
  const [bucket, setBucket] = React.useState<AgingBucket>("all");
  const [creating, setCreating] = React.useState(false);
  const [payingBill, setPayingBill] = React.useState<Bill | null>(null);
  const [editingBill, setEditingBill] = React.useState<Bill | null>(null);

  function bucketOf(b: Bill): AgingBucket {
    if (b.status === "paid") return "paid";
    const today = new Date().toISOString().slice(0, 10);
    if (b.due_date < today) return "past_due";
    const days = Math.round(
      (new Date(b.due_date).getTime() - Date.now()) / 86_400_000
    );
    if (days <= 7) return "due_soon";
    return "current";
  }

  const counts = {
    all: bills.length,
    current: bills.filter((b) => bucketOf(b) === "current").length,
    due_soon: bills.filter((b) => bucketOf(b) === "due_soon").length,
    past_due: bills.filter((b) => bucketOf(b) === "past_due").length,
    paid: bills.filter((b) => bucketOf(b) === "paid").length,
  };

  const filtered =
    bucket === "all"
      ? bills.filter((b) => b.status !== "paid")
      : bills.filter((b) => bucketOf(b) === bucket);

  const sorted = [...filtered].sort((a, b) =>
    a.due_date < b.due_date ? -1 : 1
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          <BucketChip
            label={`Open (${counts.all - counts.paid})`}
            active={bucket === "all"}
            onClick={() => setBucket("all")}
          />
          <BucketChip
            label={`Current (${counts.current})`}
            active={bucket === "current"}
            onClick={() => setBucket("current")}
          />
          <BucketChip
            label={`Due ≤7d (${counts.due_soon})`}
            active={bucket === "due_soon"}
            onClick={() => setBucket("due_soon")}
            tone="warn"
          />
          <BucketChip
            label={`Past due (${counts.past_due})`}
            active={bucket === "past_due"}
            onClick={() => setBucket("past_due")}
            tone="danger"
          />
          <BucketChip
            label={`Paid (${counts.paid})`}
            active={bucket === "paid"}
            onClick={() => setBucket("paid")}
            tone="ok"
          />
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" />
          New bill
        </Button>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{
            gridTemplateColumns: "minmax(0, 2fr) 130px 110px 110px 110px 100px 90px",
          }}
        >
          <span>Vendor / number</span>
          <span>Bill date</span>
          <span>Due date</span>
          <span>Amount</span>
          <span>Paid</span>
          <span>Status</span>
          <span></span>
        </div>
        {sorted.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-fg-tertiary">
            Nothing in this bucket.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {sorted.map((b) => {
              const v = vendorById.get(b.vendor_id);
              const buc = bucketOf(b);
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => setEditingBill(b)}
                    style={{
                      gridTemplateColumns:
                        "minmax(0, 2fr) 130px 110px 110px 110px 100px 90px",
                    }}
                    className="grid w-full cursor-pointer items-center gap-x-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-fg">
                        {v?.display_name ?? v?.name ?? b.vendor_id}
                      </div>
                      <div className="truncate text-[11px] text-fg-tertiary">
                        {b.number}
                      </div>
                    </div>
                    <span className="text-[12px] text-fg-subtle">{b.bill_date}</span>
                    <span
                      className={cn(
                        "text-[12px]",
                        buc === "past_due"
                          ? "text-status-danger"
                          : buc === "due_soon"
                          ? "text-status-warn"
                          : "text-fg-subtle"
                      )}
                    >
                      {b.due_date}
                    </span>
                    <span className="money-display text-[13px] text-fg">
                      {formatMoney(b.amount)}
                    </span>
                    <span className="money-display text-[13px] text-fg-subtle">
                      {formatMoney(b.amount_paid)}
                    </span>
                    <Badge
                      tone={
                        b.status === "paid"
                          ? "ok"
                          : b.status === "partial"
                          ? "info"
                          : buc === "past_due"
                          ? "danger"
                          : "warn"
                      }
                      size="sm"
                    >
                      {b.status}
                    </Badge>
                    {b.status !== "paid" && b.status !== "void" ? (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPayingBill(b);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            setPayingBill(b);
                          }
                        }}
                        className="cursor-pointer rounded-[8px] bg-primary px-2 py-1 text-center text-[11px] font-medium text-on-primary hover:bg-primary-hover"
                      >
                        Pay
                      </span>
                    ) : (
                      <span />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {creating && (
        <NewBillDialog
          onClose={() => setCreating(false)}
          vendors={vendors}
        />
      )}
      {payingBill && (
        <PayBillSheet bill={payingBill} onClose={() => setPayingBill(null)} />
      )}
      {editingBill && (
        <BillEditSheet
          bill={editingBill}
          vendor={vendorById.get(editingBill.vendor_id)}
          onClose={() => setEditingBill(null)}
        />
      )}
    </div>
  );
}

/**
 * Quick-edit a bill — correct amount, dates, notes before paying.
 * Lockable fields when status='paid' (amount_paid > 0 → can still
 * tweak metadata but not core amount). Includes void + delete.
 */
function BillEditSheet({
  bill,
  vendor,
  onClose,
}: {
  bill: Bill;
  vendor: Vendor | undefined;
  onClose: () => void;
}) {
  const partiallyOrFullyPaid = bill.amount_paid > 0;
  const [number, setNumber] = React.useState(bill.number);
  const [billDate, setBillDate] = React.useState(bill.bill_date);
  const [dueDate, setDueDate] = React.useState(bill.due_date);
  const [amount, setAmount] = React.useState(String(bill.amount));
  const [notes, setNotes] = React.useState(bill.notes ?? "");

  function save() {
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) return;
    upsertBill({
      ...bill,
      number: number.trim() || bill.number,
      bill_date: billDate,
      due_date: dueDate,
      amount: numAmount,
      notes: notes.trim() || undefined,
      // Re-derive status from amount + amount_paid.
      status:
        bill.amount_paid >= numAmount
          ? "paid"
          : bill.amount_paid > 0
          ? "partial"
          : "open",
    });
    onClose();
  }

  function markVoid() {
    if (!window.confirm("Mark this bill void? It will be excluded from AP totals.")) return;
    upsertBill({ ...bill, status: "void" });
    onClose();
  }

  function remove() {
    if (!window.confirm(`Delete bill ${bill.number}? This cannot be undone.`)) return;
    deleteBill(bill.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[480px] rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-fg">
          Edit bill — {vendor?.display_name ?? vendor?.name ?? bill.vendor_id}
        </h3>
        {partiallyOrFullyPaid && (
          <p className="mt-1 text-[11px] text-status-warn">
            Already paid {formatMoney(bill.amount_paid)}. Editing amount may create a credit/refund downstream.
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <SheetField label="Invoice #" col={2}>
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] font-mono text-fg focus:border-primary focus:outline-none"
            />
          </SheetField>
          <SheetField label="Bill date">
            <input
              type="date"
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </SheetField>
          <SheetField label="Due date">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </SheetField>
          <SheetField label="Amount ($)" col={2}>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </SheetField>
          <SheetField label="Notes" col={2}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </SheetField>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={remove}
              className="rounded-[8px] px-2 py-1.5 text-[12px] text-status-danger hover:bg-status-danger/10"
            >
              Delete
            </button>
            {bill.status !== "void" && bill.status !== "paid" && (
              <button
                type="button"
                onClick={markVoid}
                className="rounded-[8px] px-2 py-1.5 text-[12px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
              >
                Mark void
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[8px] px-3 py-1.5 text-[13px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="rounded-[10px] bg-primary px-3 py-2 text-[13px] font-medium text-on-primary hover:bg-primary-hover"
            >
              Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Vendor Bills (operator AP workflow) ─────────────────────────
//
// Pairs the approval queue widget + the bills table + the wizard launcher
// + the bill detail modal. State machine flows from draft →
// pending_approval → approved → scheduled → paid; disputed sits on the
// side and blocks payment until cleared.
function VendorBillsView() {
  const bills = useVendorBills();
  const vendors = useVendors();
  const [filter, setFilter] = React.useState<BillsFilterStatus>("all");
  const [creating, setCreating] = React.useState(false);
  const [openBill, setOpenBill] = React.useState<VendorBill | null>(null);

  const vendorById = React.useMemo(
    () => new Map(vendors.map((v) => [v.id, v])),
    [vendors],
  );

  return (
    <div className="space-y-4">
      <ApprovalQueueSection
        bills={bills}
        vendors={vendors}
        onRowClick={(b) => setOpenBill(b)}
      />

      <BillsTable
        bills={bills}
        vendors={vendors}
        filter={filter}
        onFilterChange={setFilter}
        onRowClick={(b) => setOpenBill(b)}
        rightAction={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            New bill
          </Button>
        }
      />

      {creating && (
        <NewBillWizard
          vendors={vendors}
          onClose={() => setCreating(false)}
        />
      )}

      {openBill && (
        <BillDetailModal
          bill={openBill}
          vendor={vendorById.get(openBill.vendor_id)}
          onClose={() => setOpenBill(null)}
        />
      )}
    </div>
  );
}

function BucketChip({
  label,
  active,
  onClick,
  tone,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: "ok" | "warn" | "danger";
}) {
  const toneClass = active
    ? tone === "ok"
      ? "bg-status-ok/15 text-status-ok"
      : tone === "warn"
      ? "bg-status-warn/15 text-status-warn"
      : tone === "danger"
      ? "bg-status-danger/15 text-status-danger"
      : "bg-surface-3 text-fg"
    : "bg-surface-1 text-fg-subtle hover:bg-surface-2";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border border-hairline px-2.5 py-1 text-[11px] font-medium transition-colors",
        toneClass
      )}
    >
      {label}
    </button>
  );
}

// ────────────────────────────────────────────────────────────
// AP Inbox — drop zone + draft queue + auto-approved log
// ────────────────────────────────────────────────────────────

// ── Inbound — feed of forwarded vendor invoices ────────────────
//
// Surfaces every email Postmark forwarded to bills@<marina>.marinastee.com.
// The feed component renders the table; here we wire up the live data
// + the bill-open handler so clicking "Open" on a drafted-row pops the
// BillDetailModal (same as the approval queue's row click).

function InboundEmailView() {
  const emails = useInboundEmails();
  const vendors = useVendors();
  const bills = useVendorBills();
  const [openBill, setOpenBill] = React.useState<VendorBill | null>(null);

  const vendorById = React.useMemo(
    () => new Map(vendors.map((v) => [v.id, v])),
    [vendors],
  );

  // Live counters by status — feed header gives the operator the
  // "what should I look at" answer at a glance.
  const counts = React.useMemo(() => {
    let drafted = 0;
    let pending = 0;
    let failed = 0;
    for (const e of emails) {
      if (e.status === "created_draft") drafted += 1;
      else if (e.status === "failed") failed += 1;
      else pending += 1;
    }
    return { drafted, pending, failed };
  }, [emails]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-hairline bg-surface-1 px-4 py-3">
        <div>
          <div className="text-[13px] font-medium text-fg">
            Email-driven AP inbox
          </div>
          <p className="mt-0.5 text-[11.5px] text-fg-tertiary">
            Each marina has a private address — forward a vendor PDF + we
            parse it, match the vendor, and draft a bill in the approval
            queue.
          </p>
        </div>
        <div className="flex gap-3 text-[11px] text-fg-subtle">
          <span>
            <span className="font-mono text-status-ok">{counts.drafted}</span> drafted
          </span>
          <span>
            <span className="font-mono text-fg">{counts.pending}</span> logged
          </span>
          <span>
            <span className="font-mono text-status-danger">{counts.failed}</span> failed
          </span>
        </div>
      </div>

      <InboundEmailFeed
        emails={emails}
        vendors={vendors}
        bills={bills}
        onOpenBill={(b) => setOpenBill(b)}
      />

      {openBill && (
        <BillDetailModal
          bill={openBill}
          vendor={vendorById.get(openBill.vendor_id)}
          onClose={() => setOpenBill(null)}
        />
      )}
    </div>
  );
}

function InboxView() {
  const settings = useAiSettings();
  const drafts = useExtractionDrafts("bill");
  const vendorDrafts = useExtractionDrafts("vendor");
  const all = [...drafts, ...vendorDrafts].sort(
    (a, b) => (b.created_at < a.created_at ? -1 : 1)
  );

  const pending = all.filter((d) => d.status === "pending");
  const auto = all.filter((d) => d.status === "auto_approved");
  const decided = all.filter(
    (d) => d.status === "approved" || d.status === "rejected"
  );

  if (!settings.bills_inbox_enabled) {
    return (
      <div className="rounded-[12px] border border-hairline bg-surface-1 p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-status-warn/15 p-2 text-status-warn">
            <SettingsIcon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-fg">
              AP Inbox isn&apos;t enabled yet
            </div>
            <p className="mt-1 text-[12px] text-fg-subtle">
              Turn it on from the onboarding checklist and we&apos;ll auto-provision
              an email address for vendors to send invoices to.
            </p>
            <Link
              href="/onboarding"
              className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
            >
              Open onboarding →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  function onDraftsCreated(
    results: Array<{ draft: ExtractionDraft; file: { name: string; mime: string; size_bytes: number; data_url: string } }>
  ) {
    for (const { draft, file } of results) {
      persistFreshDraft(draft, file);
    }
  }

  return (
    <div className="space-y-6">
      {/* Email + drop zone */}
      <div>
        <DropZone module="bill" onDraftsCreated={onDraftsCreated} />
        {settings.bills_email_address && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-2 px-2.5 py-1 text-[11px] text-fg-subtle">
            <Mail className="size-3" />
            Vendors can also email bills to{" "}
            <span className="font-mono text-fg">
              {settings.bills_email_address}
            </span>
          </div>
        )}
        {settings.bills_auto_approve_enabled && (
          <div className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-2 px-2.5 py-1 text-[11px] text-fg-subtle ml-2">
            <Sparkles className="size-3 text-status-ok" />
            Auto-approving bills under{" "}
            {formatMoney(settings.bills_auto_approve_threshold_cents / 100)} from
            familiar vendors.
          </div>
        )}
      </div>

      {/* Pending review */}
      <DraftSection
        title="Awaiting review"
        emptyText="Nothing to review. Drop an invoice above or wait for one to arrive."
        drafts={pending}
      />

      {/* Auto-approved (audit) */}
      {auto.length > 0 && (
        <DraftSection
          title="Auto-approved — audit trail"
          emptyText=""
          drafts={auto}
          compact
        />
      )}

      {/* Decided history (collapsed) */}
      {decided.length > 0 && (
        <details className="rounded-[12px] border border-hairline bg-surface-1">
          <summary className="cursor-pointer px-4 py-2.5 text-[12px] font-medium text-fg-subtle hover:text-fg">
            History — {decided.length} reviewed
          </summary>
          <div className="space-y-3 border-t border-hairline p-3">
            {decided.map((d) => (
              <BillDraftCard key={d.id} draft={d} compact />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function DraftSection({
  title,
  emptyText,
  drafts,
  compact,
}: {
  title: string;
  emptyText: string;
  drafts: ExtractionDraft[];
  compact?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {title}
        {drafts.length > 0 && (
          <span className="ml-2 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-normal text-fg-subtle">
            {drafts.length}
          </span>
        )}
      </div>
      {drafts.length === 0 ? (
        emptyText ? (
          <div className="rounded-[10px] border border-dashed border-hairline px-4 py-6 text-center text-[12px] text-fg-tertiary">
            {emptyText}
          </div>
        ) : null
      ) : (
        <div className="space-y-3">
          {drafts.map((d) => (
            <BillDraftCard key={d.id} draft={d} compact={compact} />
          ))}
        </div>
      )}
    </div>
  );
}

function BillDraftCard({
  draft,
  compact,
}: {
  draft: ExtractionDraft;
  compact?: boolean;
}) {
  const a = draft.staged_actions[0] as Record<string, unknown>;
  const isBill = draft.module === "bill";
  const fields: DraftField[] = isBill
    ? [
        { key: "vendor_name", label: "Vendor", value: String(a.vendor_name ?? "—"), editable: true },
        { key: "number", label: "Invoice #", value: String(a.number ?? "—"), mono: true, editable: true },
        { key: "amount", label: "Total", value: Number(a.amount ?? 0), money: true, editable: true, confidence: draft.field_confidences?.amount },
        { key: "bill_date", label: "Bill date", value: String(a.bill_date ?? "—"), editable: true },
        { key: "due_date", label: "Due date", value: String(a.due_date ?? "—"), editable: true, confidence: draft.field_confidences?.due_date },
        { key: "payment_terms_hint", label: "Terms", value: String(a.payment_terms_hint ?? "—") },
      ]
    : [
        { key: "name", label: "Vendor name", value: String(a.name ?? "—"), editable: true },
        { key: "payment_terms", label: "Payment terms", value: String(a.payment_terms ?? "—") },
        { key: "email", label: "Email", value: String(a.email ?? "—"), editable: true, confidence: draft.field_confidences?.email },
        { key: "default_gl_account_hint", label: "Default GL", value: String(a.default_gl_account_hint ?? "—") },
        { key: "tax_id_last4", label: "Tax ID (last4)", value: String(a.tax_id_last4 ?? "—") },
      ];

  if (compact) {
    return (
      <div className="rounded-[10px] border border-hairline bg-surface-2/40 px-3 py-2 text-[12px]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="truncate font-medium text-fg">
              {isBill ? String(a.vendor_name ?? "—") : String(a.name ?? "—")}
            </span>
            <span className="ml-2 text-fg-subtle">
              {isBill
                ? `${String(a.number ?? "")} · ${formatMoney(Number(a.amount ?? 0))}`
                : "Vendor"}
            </span>
          </div>
          <Badge tone={draft.status === "auto_approved" ? "info" : draft.status === "approved" ? "ok" : draft.status === "rejected" ? "danger" : "neutral"} size="sm">
            {draft.status === "auto_approved" ? "Auto" : draft.status}
          </Badge>
        </div>
      </div>
    );
  }

  return (
    <DraftCard
      draft={draft}
      title={
        isBill
          ? `${String(a.vendor_name ?? "Unknown vendor")} — ${String(a.number ?? "")}`
          : `New vendor: ${String(a.name ?? "")}`
      }
      subtitle={
        isBill
          ? "Drop generated draft bill — review and approve to post."
          : "Drop generated draft vendor profile."
      }
      fields={fields}
      onApprove={() => approveDraft(draft.id)}
      onReject={() => rejectDraft(draft.id)}
      primaryActionLabel={isBill ? "Approve & post bill" : "Approve & create vendor"}
    />
  );
}
