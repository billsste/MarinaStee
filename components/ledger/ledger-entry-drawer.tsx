"use client";

import * as React from "react";
import Link from "next/link";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  X,
  Receipt,
  CreditCard,
  RotateCcw,
  FileText,
  Wrench,
  Anchor,
  Mail,
  Printer,
  ShoppingBag,
  User as UserIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QbSyncBadge } from "@/components/pos/qb-sync-badge";
import {
  BOATERS,
  WORK_ORDERS,
  formatMoney,
} from "@/lib/mock-data";
import { usePicklistLabel, usePosLocations, useStore } from "@/lib/client-store";
import { EnterPaymentSheet } from "@/components/financials/enter-payment-sheet";
import type { LedgerEntry, LedgerEntryType, PosOrder } from "@/lib/types";

type DrawerCtx = {
  openLedgerEntry: (id: string) => void;
};

const Ctx = React.createContext<DrawerCtx | null>(null);

export function useLedgerDrawer() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useLedgerDrawer must be used inside <LedgerDrawerProvider>");
  return ctx;
}

export function LedgerDrawerProvider({ children }: { children: React.ReactNode }) {
  const [openId, setOpenId] = React.useState<string | null>(null);

  return (
    <Ctx.Provider value={{ openLedgerEntry: (id) => setOpenId(id) }}>
      {children}
      <LedgerEntryDrawerInner
        entryId={openId}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      />
    </Ctx.Provider>
  );
}

const TYPE_ICON: Record<LedgerEntryType, React.ComponentType<{ className?: string }>> = {
  invoice: Receipt,
  payment: CreditCard,
  refund: RotateCcw,
  credit: RotateCcw,
  adjustment: FileText,
};

const TYPE_LABEL: Record<LedgerEntryType, string> = {
  invoice: "Invoice",
  payment: "Payment",
  refund: "Refund",
  credit: "Credit",
  adjustment: "Adjustment",
};

function LedgerEntryDrawerInner({
  entryId,
  onOpenChange,
}: {
  entryId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { ledger, posOrders } = useStore();
  const open = entryId !== null;
  const entry = entryId ? ledger.find((l) => l.id === entryId) : undefined;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed right-0 top-0 z-50 h-full w-full max-w-[560px] overflow-y-auto border-l border-hairline bg-surface-1 shadow-2xl focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <DialogPrimitive.Title className="sr-only">
            {entry
              ? `${entry.type} ${entry.number ?? entry.id}`
              : "Ledger entry"}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Ledger entry detail with linked work order, POS order, and applied payments.
          </DialogPrimitive.Description>
          {entry ? <Body entry={entry} posOrders={posOrders} ledger={ledger} /> : <Empty />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Empty() {
  return (
    <div className="flex h-full items-center justify-center text-[13px] text-fg-subtle">
      No entry selected
    </div>
  );
}

function Body({
  entry,
  posOrders,
  ledger,
}: {
  entry: LedgerEntry;
  posOrders: PosOrder[];
  ledger: LedgerEntry[];
}) {
  const Icon = TYPE_ICON[entry.type];
  const boater = BOATERS.find((b) => b.id === entry.boater_id);
  const [paymentOpen, setPaymentOpen] = React.useState(false);
  const locations = usePosLocations();

  function handlePrint() {
    // Browser's native print — uses the page's print stylesheet. Production
    // would render a server-generated PDF instead, this is a demo affordance.
    window.print();
  }

  function handleEmail() {
    if (!boater?.primary_contact.email) return;
    const subj = encodeURIComponent(
      `${entry.type === "invoice" ? "Invoice" : "Receipt"} ${entry.number ?? entry.id.slice(-6)} — Marina Stee`
    );
    const body = encodeURIComponent(
      `Hi ${boater.first_name},\n\nA copy of your ${entry.type} (${entry.number ?? entry.id.slice(-6)}) for ${formatMoney(entry.amount)} dated ${entry.date} is attached.\n\nMarina Stee`
    );
    window.location.href = `mailto:${boater.primary_contact.email}?subject=${subj}&body=${body}`;
  }
  const wo = entry.linked_work_order_id
    ? WORK_ORDERS.find((w) => w.id === entry.linked_work_order_id)
    : undefined;
  const posOrder = entry.linked_pos_order_id
    ? posOrders.find((o) => o.id === entry.linked_pos_order_id)
    : undefined;
  const posLocation = posOrder
    ? locations.find((l) => l.id === posOrder.location_id)
    : undefined;
  const appliedTo = (entry.applied_to_invoice_ids ?? [])
    .map((id) => ledger.find((l) => l.id === id))
    .filter(Boolean) as LedgerEntry[];

  const headerTone =
    entry.type === "refund" ? "bg-status-danger/10 text-status-danger"
    : entry.type === "payment" ? "bg-status-ok/10 text-status-ok"
    : entry.status === "open" ? "bg-status-warn/15 text-status-warn"
    : "bg-surface-3 text-fg-muted";

  return (
    <>
      <header className="border-b border-hairline px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={"flex size-9 items-center justify-center rounded-[8px] " + headerTone}>
              <Icon className="size-4" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
                {TYPE_LABEL[entry.type]}{entry.number ? ` · ${entry.number}` : ""}
              </div>
              <div className="mt-0.5 text-[20px] font-semibold tracking-tight text-fg tabular-nums">
                {formatMoney(entry.amount)}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone={entry.status === "open" ? "warn" : entry.status === "paid" ? "ok" : "neutral"} size="sm">
                  {entry.status}
                </Badge>
                <QbSyncBadge status={entry.qb_sync_status} ref={entry.qb_ref} />
                {entry.gl_account && (
                  <Badge tone="outline" size="sm">GL: {entry.gl_account}</Badge>
                )}
              </div>
            </div>
          </div>
          <DialogPrimitive.Close
            aria-label="Close"
            className="rounded-md p-1.5 text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
          <Field label="Date" value={entry.date} />
          <Field label="Method" value={entry.method?.replace("_", " ") ?? "—"} />
          {entry.type === "invoice" && (
            <Field label="Open balance" value={formatMoney(entry.open_balance)} tone={entry.open_balance > 0 ? "warn" : undefined} />
          )}
          {entry.processor_ref && (
            <Field label="Processor ref" value={entry.processor_ref} mono />
          )}
          {entry.qb_synced_at && (
            <Field label="QB synced" value={new Date(entry.qb_synced_at).toLocaleString()} />
          )}
        </div>
      </header>

      <div className="space-y-4 px-5 py-4">
        {boater && (
          <Section title="Holder">
            <Link
              href={`/holders/${boater.id}`}
              className="flex items-center gap-2 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 transition-colors hover:border-hairline-strong"
            >
              <UserIcon className="size-4 text-fg-subtle" />
              <div className="flex-1">
                <div className="text-[13px] font-medium text-fg">{boater.display_name}</div>
                <div className="text-[11px] text-fg-tertiary">
                  {boater.code} · {boater.billing_cadence}
                </div>
              </div>
            </Link>
          </Section>
        )}

        {entry.line_items && entry.line_items.length > 0 && (
          <Section title="Line items">
            <ul className="divide-y divide-hairline rounded-[8px] border border-hairline bg-surface-2 px-3">
              {entry.line_items.map((li, i) => (
                <li key={i} className="flex items-start justify-between gap-2 py-2 text-[13px]">
                  <span className="min-w-0 text-fg">{li.description}</span>
                  <span className="shrink-0 font-mono tabular-nums text-fg-muted">
                    {formatMoney(li.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {appliedTo.length > 0 && (
          <Section title={entry.type === "payment" ? "Applied to invoices" : "Linked entries"}>
            <ul className="space-y-1.5">
              {appliedTo.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2"
                >
                  <span className="font-mono text-[12px] text-fg">{a.number ?? a.id.slice(-6)}</span>
                  <span className="font-mono tabular-nums text-[13px] text-fg-muted">
                    {formatMoney(a.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {(wo || posOrder) && (
          <Section title="Source">
            {wo && (
              <Link
                href={`/work-orders/${wo.id}`}
                className="flex items-center gap-2 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 transition-colors hover:border-hairline-strong"
              >
                <Wrench className="size-4 text-fg-subtle" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-fg">
                    {wo.number} {wo.subject}
                  </div>
                  <div className="text-[11px] text-fg-tertiary">
                    {wo.status.replace("_", " ")} · {wo.priority}
                  </div>
                </div>
              </Link>
            )}
            {posOrder && (
              <div className="mt-2 flex items-center gap-2 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2">
                <ShoppingBag className="size-4 text-fg-subtle" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-fg">POS {posOrder.number}</div>
                  <div className="text-[11px] text-fg-tertiary">
                    {posLocation?.name ?? posOrder.location_id} · {posOrder.payment_method.replace("_", " ")}
                  </div>
                </div>
                <Badge tone="ok" size="sm">{posOrder.status}</Badge>
              </div>
            )}
          </Section>
        )}

        {entry.refund_reason && (
          <Section title="Refund details">
            <div className="rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[13px]">
              <div className="text-fg">
                <span className="text-fg-tertiary">Reason:</span>{" "}
                <RefundReasonLabel value={entry.refund_reason} />
              </div>
              {entry.refund_notes && (
                <p className="mt-1 text-[12px] text-fg-subtle">{entry.refund_notes}</p>
              )}
            </div>
          </Section>
        )}
      </div>

      <footer className="sticky bottom-0 border-t border-hairline bg-surface-1 px-5 py-3">
        <div className="flex items-center justify-end gap-2">
          {boater?.primary_contact.email && (
            <Button variant="ghost" size="md" onClick={handleEmail}>
              <Mail className="size-3.5" />
              Email
            </Button>
          )}
          <Button variant="ghost" size="md" onClick={handlePrint}>
            <Printer className="size-3.5" />
            Print
          </Button>
          {entry.type === "payment" && entry.status !== "refunded" && (
            <Button variant="secondary" size="md">
              <RotateCcw className="size-3.5" />
              Refund
            </Button>
          )}
          {entry.type === "invoice" && entry.open_balance > 0 && (
            <Button variant="primary" size="md" onClick={() => setPaymentOpen(true)}>
              Take payment
            </Button>
          )}
        </div>
      </footer>

      <EnterPaymentSheet
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        defaultBoaterId={entry.boater_id}
      />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "warn";
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-fg-tertiary">{label}</span>
      <span
        className={
          (mono ? "font-mono text-[11px] " : "") +
          (tone === "warn" ? "text-status-warn font-medium" : "text-fg")
        }
      >
        {value}
      </span>
    </div>
  );
}

// Small helper — must live in a component so the picklist hook can run.
function RefundReasonLabel({ value }: { value: string }) {
  const label = usePicklistLabel("refund_reason", value);
  // Fall back to humanized raw code if the value isn't in the picklist.
  return <span className="capitalize">{label !== value ? label : value.replace("_", " ")}</span>;
}

// Re-export icon for unused-warning suppression
export { Anchor };
