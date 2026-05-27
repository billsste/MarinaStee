"use client";

import * as React from "react";
import {
  Fuel,
  ShoppingBag,
  UtensilsCrossed,
  Anchor,
  X,
  Trash2,
  CreditCard,
  Banknote,
  Building2,
  Sparkles,
  Search,
  Plus,
  Minus,
  CheckCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  BOATERS,
  formatMoney,
  getOpenBalance,
  initialsOf,
} from "@/lib/mock-data";
import type { PosCatalogItem } from "@/lib/types";
import {
  addCommunication,
  addLedgerEntry,
  addPosOrder,
  nextInvoiceNumber,
  nextLedgerId,
  nextPosOrderId,
  nextPosOrderNumber,
  useActivePosLocations,
  useFeesByScope,
  usePosCatalogForLocation,
} from "@/lib/client-store";
import type {
  Boater,
  Communication,
  LedgerEntry,
  PosLocationKey,
  PosOrder,
  PosPaymentMethod,
} from "@/lib/types";

type LineItem = {
  sku: string;
  name: string;
  qty: number;
  unit_price: number;
  total: number;
  taxable: boolean;
};

type CustomerSelection =
  | { kind: "boater"; boater: Boater }
  | { kind: "patron"; name: string }
  | { kind: "anonymous" };

const LOCATION_ICON: Record<PosLocationKey, React.ComponentType<{ className?: string }>> = {
  fuel_dock: Fuel,
  ship_store: ShoppingBag,
  restaurant: UtensilsCrossed,
  harbormaster: Anchor,
};

export function PosTerminal() {
  const [locationKey, setLocationKey] = React.useState<PosLocationKey>("ship_store");
  const [items, setItems] = React.useState<LineItem[]>([]);
  const [customer, setCustomer] = React.useState<CustomerSelection>({ kind: "anonymous" });
  const [paymentMethod, setPaymentMethod] = React.useState<PosPaymentMethod | null>(null);
  const [completedAt, setCompletedAt] = React.useState<string | null>(null);

  const locations = useActivePosLocations();
  const location = locations.find((l) => l.key === locationKey)!;
  // POS catalog is now store-backed (operator-editable). Falls back to
  // an empty array if the location has no items — UI shows the empty
  // state so staff knows to add items via Settings → POS Catalog.
  const catalog = usePosCatalogForLocation(locationKey);
  // Service fees that are available at POS — show as their own category
  // in the palette so staff can ring them up from any register without
  // hunting through the Fees page.
  const posFees = useFeesByScope("pos");

  // Group catalog by category for the palette
  const grouped = catalog.reduce<Record<string, PosCatalogItem[]>>((acc, c) => {
    (acc[c.category] ||= []).push(c);
    return acc;
  }, {});
  // Inject service fees as a virtual "Service Fees" category at the
  // bottom of the palette. They're shaped as PosCatalogItem so the rest
  // of the rendering / addItem flow doesn't need to fork.
  if (posFees.length > 0) {
    grouped["Service Fees"] = posFees.map((f) => ({
      id: `pos_fee_${f.id}`,
      sku: `FEE-${f.id}`,
      name: f.name,
      category: "Service Fees",
      price: f.amount,
      location_keys: [locationKey],
      taxable: false,
      active: true,
    }));
  }

  const subtotal = items.reduce((s, l) => s + l.total, 0);
  const taxableSubtotal = items.filter((l) => l.taxable).reduce((s, l) => s + l.total, 0);
  const tax = taxableSubtotal * location.default_tax_rate;
  const total = subtotal + tax;

  function addItem(c: PosCatalogItem) {
    setItems((prev) => {
      const existing = prev.find((l) => l.sku === c.sku);
      if (existing) {
        return prev.map((l) =>
          l.sku === c.sku ? { ...l, qty: l.qty + 1, total: (l.qty + 1) * l.unit_price } : l
        );
      }
      return [...prev, { sku: c.sku, name: c.name, qty: 1, unit_price: c.price, total: c.price, taxable: c.taxable }];
    });
    setCompletedAt(null);
  }

  function changeQty(sku: string, delta: number) {
    setItems((prev) =>
      prev
        .map((l) =>
          l.sku === sku
            ? { ...l, qty: l.qty + delta, total: (l.qty + delta) * l.unit_price }
            : l
        )
        .filter((l) => l.qty > 0)
    );
  }

  function removeItem(sku: string) {
    setItems((prev) => prev.filter((l) => l.sku !== sku));
  }

  function resetOrder() {
    setItems([]);
    setCustomer({ kind: "anonymous" });
    setPaymentMethod(null);
    setCompletedAt(null);
  }

  function complete(method: PosPaymentMethod) {
    const now = new Date().toISOString();
    const orderId = nextPosOrderId();
    const orderNumber = nextPosOrderNumber();
    const isBoater = customer.kind === "boater";
    const boaterId = isBoater ? customer.boater.id : undefined;

    // Build the POS order
    const order: PosOrder = {
      id: orderId,
      number: orderNumber,
      location_id: location.id,
      customer_kind: isBoater ? "boater" : customer.kind === "patron" ? "patron" : "anonymous",
      boater_id: boaterId,
      line_items: items.map((l) => ({
        sku: l.sku,
        name: l.name,
        qty: l.qty,
        unit_price: l.unit_price,
        total: l.total,
      })),
      subtotal,
      tax,
      total,
      payment_method: method,
      status: "paid",
      created_at: now,
      closed_at: now,
    };

    // If charged to a boater account, also create a ledger invoice on that boater.
    if (isBoater && boaterId) {
      const invoiceId = nextLedgerId();
      const invoiceNum = nextInvoiceNumber();
      const isChargeToAcct = method === "charge_to_account";
      const invoice: LedgerEntry = {
        id: invoiceId,
        boater_id: boaterId,
        type: "invoice",
        number: invoiceNum,
        date: now.slice(0, 10),
        amount: total,
        open_balance: isChargeToAcct ? total : 0,
        method: null,
        status: isChargeToAcct ? "open" : "paid",
        line_items: items.map((l) => ({
          description: `${l.qty} × ${l.name}`,
          amount: l.total,
        })),
        linked_pos_order_id: orderId,
      };
      addLedgerEntry(invoice);
      order.linked_ledger_entry_id = invoiceId;

      // For card/cash, post a matching payment that settles the invoice
      if (!isChargeToAcct) {
        const payment: LedgerEntry = {
          id: nextLedgerId(),
          boater_id: boaterId,
          type: "payment",
          date: now.slice(0, 10),
          amount: total,
          open_balance: 0,
          method: method === "card" ? "card" : "cash",
          applied_to_invoice_ids: [invoiceId],
          status: "paid",
          linked_pos_order_id: orderId,
          processor_ref: method === "card" ? `pi_runtime_${Math.random().toString(36).slice(2, 8)}` : undefined,
        };
        addLedgerEntry(payment);
      }
    }

    addPosOrder(order);

    // Auto-receipt communication on every boater sale (system-sent)
    if (isBoater && boaterId && customer.kind === "boater") {
      const verb =
        method === "charge_to_account"
          ? "charged to your account"
          : method === "card"
            ? "charged to your card"
            : "paid in cash";
      const receipt: Communication = {
        id: `cm_runtime_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        boater_id: boaterId,
        type: customer.boater.communication_prefs.preferred_channel,
        direction: "outbound",
        subject: `Marina Stee Receipt — ${location.name}`,
        body_preview: `Your ${formatMoney(total)} purchase at ${location.name} has been ${verb}.`,
        sender_label: "Sync, Service",
        sender_is_system: true,
        recipient:
          customer.boater.communication_prefs.preferred_channel === "email"
            ? customer.boater.primary_contact.email ?? "—"
            : customer.boater.primary_contact.phone ?? "—",
        sent_at: now,
        status: "delivered",
        related_entity: { type: "invoice", id: orderId },
      };
      addCommunication(receipt);
    }

    setPaymentMethod(method);
    setCompletedAt(now);
  }

  const canChargeAccount =
    location.allows_charge_to_account && customer.kind === "boater";

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr_1fr] xl:grid-cols-[1.4fr_1fr_1fr]">
      {/* LEFT — item palette */}
      <div className="order-2 rounded-[12px] border border-hairline bg-surface-1 lg:order-1">
        <div className="flex flex-wrap items-center gap-1 border-b border-hairline px-3 py-2">
          {locations.map((l) => {
            const Icon = LOCATION_ICON[l.key];
            const active = l.key === locationKey;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => setLocationKey(l.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                  active
                    ? "bg-surface-3 text-fg"
                    : "text-fg-subtle hover:bg-surface-2 hover:text-fg"
                )}
              >
                <Icon className="size-3.5" />
                {l.name}
              </button>
            );
          })}
        </div>

        <div className="space-y-3 p-3">
          {Object.entries(grouped).map(([cat, list]) => (
            <div key={cat}>
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
                {cat}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {list.map((c) => (
                  <button
                    key={c.sku}
                    type="button"
                    onClick={() => addItem(c)}
                    className="flex flex-col items-start rounded-[8px] border border-hairline bg-surface-2 p-2 text-left transition-colors hover:border-primary/40 hover:bg-primary-soft/40"
                  >
                    <div className="text-[12px] font-medium leading-tight text-fg">{c.name}</div>
                    <div className="money-display mt-1 text-[15px] text-fg">
                      {formatMoney(c.price)}
                    </div>
                    <div className="mt-0.5 text-[9px] font-mono uppercase text-fg-tertiary">
                      {c.sku}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* MIDDLE — order cart */}
      <div className="order-3 flex min-h-[280px] flex-col rounded-[12px] border border-hairline bg-surface-1 lg:order-2">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
          <h3 className="text-[13px] font-medium text-fg">Current order</h3>
          {items.length > 0 && (
            <button
              type="button"
              onClick={resetOrder}
              className="inline-flex items-center gap-1 text-[11px] text-fg-tertiary hover:text-status-danger"
            >
              <Trash2 className="size-3" /> Clear
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed border-hairline py-10 text-center">
              <Sparkles className="size-4 text-fg-tertiary" />
              <p className="text-[12px] text-fg-subtle">
                Tap items, or ask the agent —<br />
                <span className="font-medium text-fg">"add 38 gal gas for Emmons"</span>
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {items.map((l) => (
                <li key={l.sku} className="rounded-[8px] border border-hairline bg-surface-2 p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-fg">{l.name}</div>
                      <div className="text-[11px] text-fg-tertiary">
                        {formatMoney(l.unit_price)} ea
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[13px] font-medium text-fg">{formatMoney(l.total)}</div>
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => changeQty(l.sku, -1)}
                        className="inline-flex size-6 items-center justify-center rounded-[6px] border border-hairline bg-surface-1 text-fg-muted hover:bg-surface-3"
                      >
                        <Minus className="size-3" />
                      </button>
                      <span className="min-w-[2ch] text-center text-[12px] font-medium tabular-nums text-fg">
                        {l.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => changeQty(l.sku, 1)}
                        className="inline-flex size-6 items-center justify-center rounded-[6px] border border-hairline bg-surface-1 text-fg-muted hover:bg-surface-3"
                      >
                        <Plus className="size-3" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(l.sku)}
                      className="text-[11px] text-fg-tertiary hover:text-status-danger"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="space-y-2 border-t border-hairline px-5 py-4 text-[13px]">
            <div className="flex justify-between text-fg-subtle">
              <span>Subtotal</span>
              <span className="tabular text-fg">{formatMoney(subtotal)}</span>
            </div>
            <div className="flex justify-between text-fg-subtle">
              <span>Tax ({(location.default_tax_rate * 100).toFixed(2)}%)</span>
              <span className="tabular text-fg">{formatMoney(tax)}</span>
            </div>
            <div className="mt-3 flex flex-col gap-0.5 border-t border-hairline pt-3">
              <span className="text-[11px] uppercase tracking-wide text-fg-tertiary">Total</span>
              <span className="money-display-lg text-[36px] text-fg">
                {formatMoney(total)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT — customer + payment (renders FIRST on mobile so picker is visible immediately) */}
      <div className="order-1 rounded-[12px] border border-hairline bg-surface-1 lg:order-3">
        <div className="border-b border-hairline px-4 py-2.5">
          <h3 className="text-[13px] font-medium text-fg">Customer &amp; payment</h3>
        </div>

        <div className="space-y-4 p-3">
          <CustomerPicker selection={customer} onSelect={setCustomer} />

          {completedAt ? (
            <div className="rounded-[12px] border border-status-ok/30 bg-status-ok/[0.06] p-5">
              <div className="mb-3 flex items-center gap-2">
                <CheckCheck className="size-4 text-status-ok" />
                <h4 className="text-[13px] font-medium text-fg">Sale complete</h4>
              </div>
              <div className="money-display-lg text-[32px] text-fg">{formatMoney(total)}</div>
              <div className="mt-1 space-y-0.5 text-[12px] text-fg-subtle">
                <div className="capitalize">{paymentMethod?.replace("_", " ")} · {new Date(completedAt).toLocaleTimeString()}</div>
                {paymentMethod === "charge_to_account" && customer.kind === "boater" && (
                  <div className="text-status-ok">
                    Ledger entry created on {customer.boater.display_name}&apos;s account.
                  </div>
                )}
                <div className="text-status-info">Queued for QuickBooks sync.</div>
              </div>
              <button
                type="button"
                onClick={resetOrder}
                className="tap-scale pill mt-4 inline-flex h-11 items-center justify-center gap-2 bg-primary px-5 text-[14px] font-medium text-on-primary hover:bg-primary-hover"
              >
                New order
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
                Payment
              </div>
              <div className="grid grid-cols-2 gap-2">
                <PayButton
                  label="Card"
                  icon={<CreditCard className="size-4" />}
                  onClick={() => complete("card")}
                  disabled={items.length === 0}
                />
                <PayButton
                  label="Cash"
                  icon={<Banknote className="size-4" />}
                  onClick={() => complete("cash")}
                  disabled={items.length === 0}
                />
                <PayButton
                  label="Charge to account"
                  icon={<Building2 className="size-4" />}
                  onClick={() => complete("charge_to_account")}
                  disabled={items.length === 0 || !canChargeAccount}
                  hint={
                    !canChargeAccount && items.length > 0
                      ? customer.kind !== "boater"
                        ? "Select a Boater"
                        : "Not allowed here"
                      : undefined
                  }
                  highlight
                />
                <PayButton
                  label="Split"
                  icon={<Sparkles className="size-4" />}
                  onClick={() => {}}
                  disabled
                  hint="Coming soon"
                />
              </div>
              <p className="text-[11px] leading-5 text-fg-tertiary">
                Charge-to-account posts a <span className="tabular text-fg-muted">{formatMoney(total)}</span>{" "}
                invoice to the boater&apos;s ledger; it rolls into next month&apos;s statement.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CustomerPicker({
  selection,
  onSelect,
}: {
  selection: CustomerSelection;
  onSelect: (s: CustomerSelection) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BOATERS.slice(0, 5);
    return BOATERS.filter(
      (b) =>
        b.display_name.toLowerCase().includes(q) ||
        b.code?.toLowerCase().includes(q) ||
        b.primary_contact.phone?.includes(q)
    );
  }, [query]);

  if (selection.kind === "boater") {
    const b = selection.boater;
    const balance = getOpenBalance(b.id);
    return (
      <div className="rounded-[10px] border border-primary/30 bg-primary-soft/40 p-3">
        <div className="flex items-start gap-3">
          <Avatar className="size-9 shrink-0">
            <AvatarFallback>{initialsOf(b.display_name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-fg">{b.display_name}</div>
            <div className="text-[11px] text-fg-subtle">
              {b.code} · {b.billing_cadence}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
              <Badge tone={balance > 0 ? "warn" : "ok"} size="sm">
                {balance > 0 ? `${formatMoney(balance)} open` : "Current"}
              </Badge>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSelect({ kind: "anonymous" })}
            aria-label="Clear customer"
            className="text-fg-tertiary hover:text-fg"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  if (selection.kind === "patron") {
    return (
      <div className="rounded-[10px] border border-hairline bg-surface-2 p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-medium text-fg">{selection.name}</div>
            <div className="text-[11px] text-fg-tertiary">Walk-in · card or cash only</div>
          </div>
          <button
            type="button"
            onClick={() => onSelect({ kind: "anonymous" })}
            className="text-fg-tertiary hover:text-fg"
            aria-label="Clear"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        Customer
      </div>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search boater by name, slip, phone…"
          className="w-full rounded-[8px] border border-hairline bg-surface-2 py-1.5 pl-8 pr-3 text-[13px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
        />
      </div>
      {open && results.length > 0 && (
        <ul className="max-h-56 overflow-y-auto rounded-[8px] border border-hairline bg-surface-1">
          {results.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect({ kind: "boater", boater: b });
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-2"
              >
                <Avatar className="size-6">
                  <AvatarFallback>{initialsOf(b.display_name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-fg">{b.display_name}</div>
                  <div className="text-[10px] text-fg-tertiary">{b.code}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const name = prompt("Walk-in name (optional)");
            onSelect(name ? { kind: "patron", name } : { kind: "patron", name: "Walk-in" });
          }}
        >
          Walk-in
        </Button>
        <span className="text-[11px] text-fg-tertiary">
          {query ? "" : "or pick a boater above to enable charge-to-account"}
        </span>
      </div>
    </div>
  );
}

function PayButton({
  label,
  icon,
  onClick,
  disabled,
  hint,
  highlight = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={cn(
        "tap-scale flex h-[88px] flex-col items-center justify-center gap-1.5 rounded-[14px] border text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        highlight && !disabled
          ? "border-primary bg-primary text-on-primary hover:bg-primary-hover"
          : "border-hairline bg-surface-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
      )}
    >
      <span className={cn("flex size-7 items-center justify-center rounded-full", highlight && !disabled ? "bg-white/15" : "bg-surface-2")}>
        {icon}
      </span>
      {label}
    </button>
  );
}
