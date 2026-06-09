"use client";

import * as React from "react";
import Link from "next/link";
import { useTabUrlState } from "@/lib/use-tab-url-state";
import { Boxes, AlertTriangle, History, PackageOpen, ShoppingCart, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilterSelect } from "@/components/ui/list-filter-select";
import { PageShell } from "@/components/page-shell";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { formatMoney } from "@/lib/mock-data";
import {
  nextBillId,
  recordStockMovement,
  upsertBill,
  upsertPosItem,
  useAiSettings,
  useBills,
  useExtractionDrafts,
  usePosCatalog,
  useStaff,
  useStockMovements,
  useVendors,
} from "@/lib/client-store";
import {
  approveDraft,
  persistFreshDraft,
  rejectDraft,
} from "@/lib/ai-extract-executor";
import { DropZone } from "@/components/ai/drop-zone";
import { DraftCard, type DraftField } from "@/components/ai/draft-card";
import { cn } from "@/lib/utils";
import type {
  ExtractionDraft,
  PosCatalogItem,
  StockMovement,
  StockMovementKind,
} from "@/lib/types";

/*
 * /inventory — Stock levels for tracked POS items, low-stock
 * alerts, and the movement log. Deep-links via `?section=low-stock`
 * for the dashboard back-office Quick Action.
 */

type SectionKey =
  | "receive"
  | "reorder"
  | "stock"
  | "low_stock"
  | "movements";

const NAV: {
  key: SectionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}[] = [
  {
    key: "receive",
    label: "Receive",
    icon: PackageOpen,
    description: "Drop a supplier packing slip — we match lines and stage receives.",
  },
  {
    key: "reorder",
    label: "Reorder cart",
    icon: ShoppingCart,
    description: "Agent-staged reorder bills, grouped by supplier. Approve to send.",
  },
  {
    key: "stock",
    label: "Stock levels",
    icon: Boxes,
    description: "Every tracked POS item with current stock + reorder point.",
  },
  {
    key: "low_stock",
    label: "Low stock",
    icon: AlertTriangle,
    description: "Items at or below their reorder point. Reorder now.",
  },
  {
    key: "movements",
    label: "Movement log",
    icon: History,
    description: "Every receive, sale, adjustment, and loss — chronological.",
  },
];

function isInventorySection(v: string | null | undefined): v is SectionKey {
  // Accept the kebab-case variant `low-stock` as an alias for
  // `low_stock` — dashboard quick actions and external links may use
  // either shape. Normalize on the canonical underscore form by
  // returning false here and rewriting below.
  return (
    v === "receive" ||
    v === "reorder" ||
    v === "stock" ||
    v === "low_stock" ||
    v === "movements"
  );
}

export function InventoryClient() {
  // ?tab= is the canonical deep-link param across /members /staff
  // /ledger /vendors /work-orders / this page so external links and
  // agent navigation land on the right sub-section every time.
  const [section, setSection] = useTabUrlState<SectionKey>(
    "tab",
    isInventorySection,
    "stock",
  );
  const active = NAV.find((n) => n.key === section) ?? NAV[0];

  return (
    <PageShell title="Inventory" description={active.description} width="wide">
      <div className="mb-5">
        <RentalsAsk
          placeholder="Ask the agent — e.g. 'what's low?' or 'received 24 dock lines from Sandia Marine'"
          suggestions={[
            "What's at or below reorder point?",
            "Received 24 dock lines from Sandia Marine",
            "Log a stock loss of 6 sunscreen — expired",
            "Show me last week's stock movements",
          ]}
        />
      </div>
      <div
        className="grid gap-6"
        style={{ gridTemplateColumns: "200px minmax(0, 1fr)" }}
      >
        <nav
          aria-label="Inventory sections"
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
          {section === "receive" && <ReceiveInbox />}
          {section === "reorder" && <ReorderCart />}
          {section === "stock" && <StockLevels />}
          {section === "low_stock" && <LowStock />}
          {section === "movements" && <MovementLog />}
        </div>
      </div>
    </PageShell>
  );
}

// ── Stock levels ───────────────────────────────────────────

function StockLevels() {
  const catalog = usePosCatalog();
  const vendors = useVendors();
  const vendorById = React.useMemo(
    () => new Map(vendors.map((v) => [v.id, v])),
    [vendors]
  );
  const [sheet, setSheet] = React.useState<{
    kind: "receive" | "adjust" | "loss";
    item: PosCatalogItem;
  } | null>(null);
  const [editing, setEditing] = React.useState<PosCatalogItem | null>(null);

  const tracked = catalog.filter((i) => i.tracked);

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-fg-tertiary">
        Only items marked &quot;tracked&quot; show stock counts. Untracked items
        (fuel by the gallon, services) hide their stock column.
      </p>

      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{
            gridTemplateColumns:
              "100px minmax(0, 1.6fr) 100px 80px 80px minmax(0, 1.2fr) 220px",
          }}
        >
          <span>SKU</span>
          <span>Item</span>
          <span>Stock</span>
          <span>Reorder</span>
          <span>Qty</span>
          <span>Supplier</span>
          <span></span>
        </div>
        {tracked.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-fg-tertiary">
            No tracked items yet. Flip an item to &quot;tracked&quot; in the
            POS catalog manager.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {tracked.map((item) => {
              const stock = item.stock_on_hand ?? 0;
              const rp = item.reorder_point ?? 0;
              const low = stock <= rp;
              const out = stock === 0;
              return (
                <li key={item.id}>
                  {/* Row wrapper used to be a <button>, which made the
                      nested <ActionBtn> children (Receive / Adjust /
                      Loss) emit "button-in-button" hydration warnings
                      and got the HTML auto-fixed by the browser. Now
                      a div with role="button" + keyboard handler, so
                      the actions can stay as proper <button>s. */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setEditing(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setEditing(item);
                      }
                    }}
                    style={{
                      gridTemplateColumns:
                        "100px minmax(0, 1.6fr) 100px 80px 80px minmax(0, 1.2fr) 220px",
                    }}
                    className="grid w-full cursor-pointer items-center gap-x-3 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  >
                    <span className="font-mono text-[11px] text-fg-subtle">
                      {item.sku}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-fg">
                        {item.name}
                      </div>
                      <div className="text-[11px] text-fg-tertiary">
                        {item.category} · {formatMoney(item.price)}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "money-display text-[16px]",
                        out
                          ? "text-status-danger"
                          : low
                          ? "text-status-warn"
                          : "text-fg"
                      )}
                    >
                      {stock}
                    </span>
                    <span className="tabular text-[13px] text-fg-subtle">
                      {item.reorder_point ?? "—"}
                    </span>
                    <span className="tabular text-[13px] text-fg-subtle">
                      {item.reorder_quantity ?? "—"}
                    </span>
                    <span className="truncate text-[12px] text-fg-subtle">
                      {item.supplier_vendor_id
                        ? vendorById.get(item.supplier_vendor_id)?.display_name ??
                          vendorById.get(item.supplier_vendor_id)?.name ??
                          "—"
                        : "—"}
                    </span>
                    <div
                      className="flex items-center justify-end gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <ActionBtn
                        label="Receive"
                        tone="primary"
                        onClick={() => setSheet({ kind: "receive", item })}
                      />
                      <ActionBtn
                        label="Adjust"
                        tone="ghost"
                        onClick={() => setSheet({ kind: "adjust", item })}
                      />
                      <ActionBtn
                        label="Loss"
                        tone="danger"
                        onClick={() => setSheet({ kind: "loss", item })}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {sheet && (
        <MovementSheet
          kind={sheet.kind}
          item={sheet.item}
          onClose={() => setSheet(null)}
        />
      )}
      {editing && (
        <ItemEditSheet item={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/**
 * Edit the inventory-relevant fields on a POS item: price/cost,
 * reorder thresholds, supplier, tracked flag. Full catalog edit
 * (categories, modifiers, etc.) lives on /ledger?section=catalog —
 * this sheet stays narrow so it's quick to fix a stockroom typo.
 */
function ItemEditSheet({
  item,
  onClose,
}: {
  item: PosCatalogItem;
  onClose: () => void;
}) {
  const vendors = useVendors();
  const [name, setName] = React.useState(item.name);
  const [price, setPrice] = React.useState(String(item.price));
  const [cost, setCost] = React.useState(item.cost ? String(item.cost) : "");
  const [tracked, setTracked] = React.useState(item.tracked ?? false);
  const [stockOnHand, setStockOnHand] = React.useState(
    item.stock_on_hand !== undefined ? String(item.stock_on_hand) : ""
  );
  const [reorderPoint, setReorderPoint] = React.useState(
    item.reorder_point !== undefined ? String(item.reorder_point) : ""
  );
  const [reorderQty, setReorderQty] = React.useState(
    item.reorder_quantity !== undefined ? String(item.reorder_quantity) : ""
  );
  const [supplierId, setSupplierId] = React.useState(item.supplier_vendor_id ?? "");

  function save() {
    if (!name.trim()) return;
    upsertPosItem({
      ...item,
      name: name.trim(),
      price: Number(price) || item.price,
      cost: cost ? Number(cost) : undefined,
      tracked,
      stock_on_hand:
        stockOnHand !== "" ? Number(stockOnHand) : item.stock_on_hand,
      reorder_point: reorderPoint !== "" ? Number(reorderPoint) : undefined,
      reorder_quantity: reorderQty !== "" ? Number(reorderQty) : undefined,
      supplier_vendor_id: supplierId || undefined,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[480px] rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-fg">Edit item</h3>
        <p className="mt-0.5 font-mono text-[11px] text-fg-tertiary">{item.sku}</p>

        <div className="mt-4 space-y-3">
          <ItemField label="Name *">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </ItemField>
          <div className="grid grid-cols-2 gap-3">
            <ItemField label="Sell price ($)">
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                inputMode="decimal"
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
              />
            </ItemField>
            <ItemField label="Unit cost ($)">
              <input
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                inputMode="decimal"
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
              />
            </ItemField>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-fg">
            <input
              type="checkbox"
              checked={tracked}
              onChange={(e) => setTracked(e.target.checked)}
            />
            Tracked — count stock and surface low-stock alerts
          </label>
          {tracked && (
            <div className="grid grid-cols-3 gap-3">
              <ItemField label="On hand">
                <input
                  value={stockOnHand}
                  onChange={(e) => setStockOnHand(e.target.value)}
                  inputMode="numeric"
                  className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
                />
              </ItemField>
              <ItemField label="Reorder point">
                <input
                  value={reorderPoint}
                  onChange={(e) => setReorderPoint(e.target.value)}
                  inputMode="numeric"
                  className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
                />
              </ItemField>
              <ItemField label="Reorder qty">
                <input
                  value={reorderQty}
                  onChange={(e) => setReorderQty(e.target.value)}
                  inputMode="numeric"
                  className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
                />
              </ItemField>
            </div>
          )}
          <ItemField label="Supplier">
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            >
              <option value="">None</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.display_name ?? v.name}
                </option>
              ))}
            </select>
          </ItemField>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <Link
            href="/ledger?section=catalog"
            className="text-[11px] text-fg-tertiary hover:text-fg-subtle"
          >
            Full catalog editor →
          </Link>
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

function ItemField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function ActionBtn({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: "primary" | "ghost" | "danger";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[6px] px-2 py-1 text-[11px] font-medium transition-colors",
        tone === "primary"
          ? "bg-primary text-on-primary hover:bg-primary-hover"
          : tone === "danger"
          ? "border border-status-danger/40 text-status-danger hover:bg-status-danger/10"
          : "border border-hairline text-fg-subtle hover:bg-surface-2 hover:text-fg"
      )}
    >
      {label}
    </button>
  );
}

// ── Low stock ─────────────────────────────────────────────

function LowStock() {
  const catalog = usePosCatalog();
  const vendors = useVendors();
  const vendorById = React.useMemo(
    () => new Map(vendors.map((v) => [v.id, v])),
    [vendors]
  );
  const tracked = catalog.filter((i) => {
    if (!i.tracked) return false;
    return (i.stock_on_hand ?? 0) <= (i.reorder_point ?? 0);
  });
  const [receivingItem, setReceivingItem] = React.useState<PosCatalogItem | null>(null);
  const [reorderingItem, setReorderingItem] = React.useState<PosCatalogItem | null>(null);

  return (
    <div className="space-y-4">
      <div className="rounded-[10px] border border-status-warn/30 bg-status-warn/[0.05] px-3 py-2 text-[12px] text-status-warn">
        {tracked.length === 0
          ? "Nothing at or below reorder point. Stock is healthy."
          : `${tracked.length} item${tracked.length === 1 ? " is" : "s are"} at or below reorder point.`}
      </div>

      {tracked.length > 0 && (
        <ul className="divide-y divide-hairline rounded-[12px] border border-hairline bg-surface-1">
          {tracked.map((item) => {
            const stock = item.stock_on_hand ?? 0;
            const rp = item.reorder_point ?? 0;
            const supplier = item.supplier_vendor_id
              ? vendorById.get(item.supplier_vendor_id)
              : null;
            return (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-fg">
                      {item.name}
                    </span>
                    <Badge tone={stock === 0 ? "danger" : "warn"} size="sm">
                      {stock === 0 ? "Out of stock" : `${stock} on hand`}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-fg-tertiary">
                    Reorder point {rp} · Suggested order{" "}
                    {item.reorder_quantity ?? "—"}
                    {supplier
                      ? ` · supplier ${supplier.display_name ?? supplier.name}`
                      : " · no supplier set"}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {/* Reorder — drafts a new Bill against the supplier
                      with the item + suggested qty + cost pre-filled.
                      Operator confirms terms + invoice number. */}
                  <button
                    type="button"
                    onClick={() => setReorderingItem(item)}
                    disabled={!supplier}
                    title={supplier ? "Draft a bill from the supplier" : "Set a supplier on the item first"}
                    className={cn(
                      "rounded-[8px] border px-3 py-1.5 text-[12px] font-medium transition-colors",
                      supplier
                        ? "border-primary text-primary hover:bg-primary/10"
                        : "cursor-not-allowed border-hairline text-fg-tertiary"
                    )}
                  >
                    Reorder
                  </button>
                  <button
                    type="button"
                    onClick={() => setReceivingItem(item)}
                    className="rounded-[8px] bg-primary px-3 py-1.5 text-[12px] font-medium text-on-primary hover:bg-primary-hover"
                  >
                    Receive stock
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {receivingItem && (
        <MovementSheet
          kind="receive"
          item={receivingItem}
          onClose={() => setReceivingItem(null)}
        />
      )}
      {reorderingItem && (
        <ReorderSheet
          item={reorderingItem}
          onClose={() => setReorderingItem(null)}
        />
      )}
    </div>
  );
}

/**
 * Draft a new Bill from a low-stock item. Pre-fills supplier vendor,
 * item description, qty (= reorder_quantity), unit cost (= item.cost),
 * GL account (= vendor.default_gl_account or "Ship Store — Cost of
 * Goods"). Operator just confirms invoice # + due date.
 */
function ReorderSheet({
  item,
  onClose,
}: {
  item: PosCatalogItem;
  onClose: () => void;
}) {
  const vendors = useVendors();
  const supplier = vendors.find((v) => v.id === item.supplier_vendor_id);

  const today = new Date().toISOString().slice(0, 10);
  const [number, setNumber] = React.useState("");
  const [qty, setQty] = React.useState(String(item.reorder_quantity ?? 1));
  const [unitCost, setUnitCost] = React.useState(String(item.cost ?? 0));
  const [billDate, setBillDate] = React.useState(today);
  const [dueDate, setDueDate] = React.useState(() => {
    if (!supplier) return today;
    return rollDueDate(today, supplier.payment_terms);
  });
  const [notes, setNotes] = React.useState(
    `Reorder — ${item.name} (low stock alert)`
  );

  React.useEffect(() => {
    if (supplier) setDueDate(rollDueDate(billDate, supplier.payment_terms));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billDate]);

  if (!supplier) {
    return null;
  }

  const numQty = Number(qty) || 0;
  const numUnit = Number(unitCost) || 0;
  const total = +(numQty * numUnit).toFixed(2);
  const canSave = number.trim() && numQty > 0 && total > 0;

  function save() {
    if (!canSave) return;
    upsertBill({
      id: nextBillId(),
      tenant_id: "",
      vendor_id: supplier!.id,
      number: number.trim(),
      bill_date: billDate,
      due_date: dueDate,
      amount: total,
      amount_paid: 0,
      status: "open",
      line_items: [
        {
          description: `Reorder — ${item.name} (${numQty} × ${formatMoney(numUnit)})`,
          amount: total,
          gl_account:
            supplier!.default_gl_account ?? "Ship Store — Cost of Goods",
        },
      ],
      notes: notes.trim() || undefined,
      qb_sync_status: "pending",
      created_at: new Date().toISOString(),
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[460px] rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-fg">
          Reorder {item.name}
        </h3>
        <p className="mt-1 text-[12px] text-fg-subtle">
          Drafts a bill from {supplier.display_name ?? supplier.name}. When the
          stock arrives, use Receive on the same item to bump stock_on_hand.
        </p>

        <div className="mt-4 space-y-3">
          <ReorderField label="Invoice # *">
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="SMS-99812"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] font-mono text-fg focus:border-primary focus:outline-none"
            />
          </ReorderField>
          <div className="grid grid-cols-2 gap-3">
            <ReorderField label="Qty *">
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                inputMode="numeric"
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
              />
            </ReorderField>
            <ReorderField label="Unit cost ($) *">
              <input
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                inputMode="decimal"
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
              />
            </ReorderField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ReorderField label="Bill date">
              <input
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
              />
            </ReorderField>
            <ReorderField label="Due date">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
              />
            </ReorderField>
          </div>
          <ReorderField label="Notes">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </ReorderField>

          <div className="rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-fg-subtle">Bill total</span>
              <span className="money-display text-[18px] text-fg">
                {formatMoney(total)}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
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
            disabled={!canSave}
            className={cn(
              "rounded-[10px] px-3 py-2 text-[13px] font-medium transition-colors",
              canSave
                ? "bg-primary text-on-primary hover:bg-primary-hover"
                : "cursor-not-allowed bg-surface-3 text-fg-tertiary"
            )}
          >
            Save bill
          </button>
        </div>
      </div>
    </div>
  );
}

function ReorderField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// Same helper as in new-bill-dialog; duplicated locally so this file
// stays self-contained.
function rollDueDate(billDate: string, terms: import("@/lib/types").VendorPaymentTerms): string {
  const d = new Date(billDate);
  const days =
    terms === "due_on_receipt"
      ? 0
      : terms === "net_7"
      ? 7
      : terms === "net_15"
      ? 15
      : terms === "net_30"
      ? 30
      : 60;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Movement log ─────────────────────────────────────────

function MovementLog() {
  const movements = useStockMovements();
  const catalog = usePosCatalog();
  const staff = useStaff();
  const itemById = React.useMemo(
    () => new Map(catalog.map((i) => [i.id, i])),
    [catalog]
  );
  const staffById = React.useMemo(
    () => new Map(staff.map((s) => [s.id, s])),
    [staff]
  );
  const [filter, setFilter] = React.useState<"all" | StockMovementKind>("all");

  const filtered =
    filter === "all" ? movements : movements.filter((m) => m.kind === filter);
  const sorted = [...filtered].sort((a, b) =>
    a.occurred_at < b.occurred_at ? 1 : -1
  );

  // Live per-kind counts surface inside the dropdown labels, so the
  // reader can scan distribution at a glance even when the filter
  // isn't active. Matches the canonical Bookings/Members pattern.
  const kindCounts = React.useMemo(() => {
    const c: Record<StockMovementKind, number> = {
      receive: 0,
      sale: 0,
      adjust: 0,
      loss: 0,
      transfer: 0,
    };
    for (const m of movements) c[m.kind] += 1;
    return c;
  }, [movements]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-surface-1 p-2">
        <ListFilterSelect
          value={filter}
          onChange={(v) => setFilter(v as "all" | StockMovementKind)}
          label="Kind"
          options={[
            { value: "all", label: `All · ${movements.length}` },
            { value: "receive", label: `Receives · ${kindCounts.receive}` },
            { value: "sale", label: `Sales · ${kindCounts.sale}` },
            { value: "adjust", label: `Adjustments · ${kindCounts.adjust}` },
            { value: "loss", label: `Losses · ${kindCounts.loss}` },
          ]}
        />
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-[12px] border border-hairline bg-surface-1 px-4 py-10 text-center text-[12px] text-fg-tertiary">
          No movements in this view.
        </div>
      ) : (
        <ul className="divide-y divide-hairline rounded-[12px] border border-hairline bg-surface-1">
          {sorted.map((m) => {
            const item = itemById.get(m.item_id);
            const deltaPositive = m.delta > 0;
            return (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-fg">
                    {item?.name ?? m.item_id}
                  </div>
                  <div className="text-[11px] text-fg-tertiary">
                    {new Date(m.occurred_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {m.recorded_by
                      ? ` · ${staffById.get(m.recorded_by)?.name ?? m.recorded_by}`
                      : ""}
                    {m.notes ? ` · ${m.notes}` : ""}
                  </div>
                </div>
                <Badge tone={toneFor(m.kind)} size="sm">
                  {m.kind}
                </Badge>
                <span
                  className={cn(
                    "money-display text-[14px]",
                    deltaPositive ? "text-status-ok" : "text-status-danger"
                  )}
                >
                  {deltaPositive ? "+" : ""}
                  {m.delta}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function toneFor(kind: StockMovementKind): "ok" | "warn" | "danger" | "info" | "neutral" {
  switch (kind) {
    case "receive":
      return "ok";
    case "sale":
      return "info";
    case "adjust":
      return "neutral";
    case "loss":
      return "danger";
    case "transfer":
      return "neutral";
  }
}

// ── Movement sheet (receive / adjust / loss) ─────────────

function MovementSheet({
  kind,
  item,
  onClose,
}: {
  kind: "receive" | "adjust" | "loss";
  item: PosCatalogItem;
  onClose: () => void;
}) {
  const stock = item.stock_on_hand ?? 0;
  const [qty, setQty] = React.useState(() => {
    if (kind === "receive") return String(item.reorder_quantity ?? 1);
    if (kind === "adjust") return String(stock);
    return "1";
  });
  const [notes, setNotes] = React.useState("");

  const num = Number(qty) || 0;
  const delta = kind === "receive" ? num : kind === "loss" ? -num : num - stock;
  const after = Math.max(0, stock + delta);

  function submit() {
    if (kind === "receive" && num <= 0) return;
    if (kind === "loss" && num <= 0) return;
    recordStockMovement({
      item_id: item.id,
      delta,
      kind: kind === "receive" ? "receive" : kind === "loss" ? "loss" : "adjust",
      notes: notes.trim() || undefined,
    });
    onClose();
  }

  const title =
    kind === "receive"
      ? `Receive ${item.name}`
      : kind === "adjust"
      ? `Adjust ${item.name}`
      : `Log loss — ${item.name}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[420px] rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
        <p className="mt-1 text-[12px] text-fg-subtle">Current stock: {stock}</p>

        <div className="mt-4 space-y-3">
          <Field
            label={
              kind === "receive"
                ? "Qty received *"
                : kind === "adjust"
                ? "New count *"
                : "Qty lost *"
            }
          >
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="numeric"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[14px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Notes">
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                kind === "loss" ? "Broken in transit, spoiled, etc." : ""
              }
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <div className="rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[12px]">
            <div className="text-fg-subtle">After this movement:</div>
            <div className="money-display text-[18px] text-fg">{after}</div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] px-3 py-1.5 text-[13px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={num <= 0 && kind !== "adjust"}
            className={cn(
              "rounded-[10px] px-3 py-2 text-[13px] font-medium transition-colors",
              num > 0 || kind === "adjust"
                ? "bg-primary text-on-primary hover:bg-primary-hover"
                : "cursor-not-allowed bg-surface-3 text-fg-tertiary"
            )}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Receive inbox — drop a packing slip, stage receive movements
// ────────────────────────────────────────────────────────────

function ReceiveInbox() {
  const drafts = useExtractionDrafts("packing_slip");
  const pending = drafts.filter((d) => d.status === "pending");
  const decided = drafts.filter(
    (d) => d.status === "approved" || d.status === "rejected"
  );

  return (
    <div className="space-y-6">
      <DropZone
        module="packing_slip"
        onDraftsCreated={(results) => {
          for (const { draft, file } of results) {
            persistFreshDraft(draft, file);
          }
        }}
      />

      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          Awaiting receive
          {pending.length > 0 && (
            <span className="ml-2 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-normal text-fg-subtle">
              {pending.length}
            </span>
          )}
        </div>
        {pending.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-hairline px-4 py-6 text-center text-[12px] text-fg-tertiary">
            Drop a packing slip above. We&apos;ll match lines to your POS catalog
            and stage batch-receive movements.
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((d) => (
              <PackingSlipDraftCard key={d.id} draft={d} />
            ))}
          </div>
        )}
      </div>

      {decided.length > 0 && (
        <details className="rounded-[12px] border border-hairline bg-surface-1">
          <summary className="cursor-pointer px-4 py-2.5 text-[12px] font-medium text-fg-subtle hover:text-fg">
            History — {decided.length} reviewed
          </summary>
          <div className="space-y-2 border-t border-hairline p-3">
            {decided.map((d) => (
              <div key={d.id} className="rounded-[8px] border border-hairline bg-surface-2/40 px-3 py-1.5 text-[12px] text-fg-subtle">
                {d.notes ?? "Reviewed"}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function PackingSlipDraftCard({ draft }: { draft: ExtractionDraft }) {
  const a = draft.staged_actions[0] as Record<string, unknown>;
  const lines = Array.isArray(a.line_items)
    ? (a.line_items as Array<{ description?: string; sku_hint?: string; quantity?: number; unit_cost?: number }>)
    : [];

  const fields: DraftField[] = [
    { key: "vendor_name", label: "Supplier", value: String(a.vendor_name ?? "—") },
    { key: "po_number", label: "PO #", value: String(a.po_number ?? "—"), mono: true },
    { key: "received_at", label: "Received", value: String(a.received_at ?? "—") },
    { key: "line_count", label: "Lines", value: lines.length },
  ];

  return (
    <div className="space-y-3">
      <DraftCard
        draft={draft}
        title={`Packing slip — ${String(a.vendor_name ?? "Unknown")} · ${String(a.po_number ?? "")}`}
        subtitle={`${lines.length} line${lines.length === 1 ? "" : "s"}`}
        fields={fields}
        onApprove={() => approveDraft(draft.id)}
        onReject={() => rejectDraft(draft.id)}
        primaryActionLabel="Approve & receive all"
      />
      {lines.length > 0 && (
        <div className="rounded-[10px] border border-hairline bg-surface-2/40 p-3 text-[12px]">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-fg-tertiary">
            Line preview
          </div>
          <ul className="divide-y divide-hairline">
            {lines.map((li, i) => (
              <li key={i} className="flex items-center justify-between py-1">
                <span className="truncate text-fg">{li.description}</span>
                <span className="tabular-nums text-fg-subtle">
                  qty {li.quantity ?? "—"}{li.unit_cost ? ` · ${formatMoney(li.unit_cost)}/ea` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Reorder cart — agent-staged POs grouped by supplier
// ────────────────────────────────────────────────────────────

function ReorderCart() {
  const settings = useAiSettings();
  const catalog = usePosCatalog();
  const vendors = useVendors();
  const vendorById = React.useMemo(
    () => new Map(vendors.map((v) => [v.id, v])),
    [vendors]
  );

  // What needs reordering: tracked items with stock_on_hand <=
  // reorder_point AND a supplier set. Items without a supplier surface
  // in low stock but can't be reordered automatically — they show in
  // a separate "needs supplier" bucket below.
  const needsReorder = catalog.filter(
    (i) =>
      i.tracked &&
      (i.stock_on_hand ?? 0) <= (i.reorder_point ?? 0)
  );
  const ready = needsReorder.filter((i) => i.supplier_vendor_id);
  const needsSupplier = needsReorder.filter((i) => !i.supplier_vendor_id);

  // Group ready items by supplier vendor.
  const bySupplier = React.useMemo(() => {
    const m = new Map<
      string,
      { vendor: ReturnType<typeof vendorById.get>; items: typeof ready }
    >();
    for (const i of ready) {
      const vid = i.supplier_vendor_id!;
      const cur = m.get(vid) ?? { vendor: vendorById.get(vid), items: [] };
      cur.items.push(i);
      m.set(vid, cur);
    }
    return Array.from(m.entries());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready.length]);

  if (!settings.inventory_velocity_reorder_enabled) {
    return (
      <div className="rounded-[12px] border border-hairline bg-surface-1 p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-status-warn/15 p-2 text-status-warn">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-fg">
              Velocity reorder isn&apos;t enabled yet
            </div>
            <p className="mt-1 text-[12px] text-fg-subtle">
              Turn this on from the onboarding checklist and we&apos;ll watch
              sales velocity and pre-stage reorders by supplier.
            </p>
            <a
              href="/onboarding"
              className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
            >
              Open onboarding →
            </a>
          </div>
        </div>
      </div>
    );
  }

  function reorderSupplier(vid: string, items: typeof ready) {
    const v = vendorById.get(vid);
    if (!v) return;
    const today = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + (settings.inventory_reorder_lead_time_days || 5) * 86400000)
      .toISOString()
      .slice(0, 10);
    const line_items = items.map((i) => ({
      description: `${i.name} × ${i.reorder_quantity ?? 1}`,
      amount: +((i.cost ?? 0) * (i.reorder_quantity ?? 1)).toFixed(2),
      gl_account: v.default_gl_account ?? "Ship Store — Cost of Goods",
    }));
    const total = line_items.reduce((s, li) => s + li.amount, 0);
    if (total <= 0) {
      window.alert("Cost prices not set on these items — set unit cost in the catalog before reordering.");
      return;
    }
    upsertBill({
      id: nextBillId(),
      tenant_id: "",
      vendor_id: v.id,
      number: `REORD-${Date.now().toString().slice(-6)}`,
      bill_date: today,
      due_date: due,
      amount: total,
      amount_paid: 0,
      status: "open",
      line_items,
      notes: `Auto-staged reorder — ${items.length} items.`,
      qb_sync_status: "pending",
      created_at: new Date().toISOString(),
    });
    window.alert(`Staged reorder bill for ${v.display_name ?? v.name} (${formatMoney(total)}).`);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[10px] border border-hairline bg-surface-2/40 px-3 py-2 text-[12px] text-fg-subtle">
        <Sparkles className="mr-1 inline size-3 text-status-info" />
        {ready.length === 0 && needsSupplier.length === 0
          ? "Nothing to reorder right now."
          : `${ready.length} item${ready.length === 1 ? "" : "s"} ready to reorder. Lead time ${settings.inventory_reorder_lead_time_days} day${settings.inventory_reorder_lead_time_days === 1 ? "" : "s"}.`}
      </div>

      {bySupplier.map(([vid, { vendor, items }]) => {
        const supplierTotal = items.reduce(
          (s, i) => s + (i.cost ?? 0) * (i.reorder_quantity ?? 1),
          0
        );
        return (
          <div key={vid} className="rounded-[12px] border border-hairline bg-surface-1">
            <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-fg">
                  {vendor?.display_name ?? vendor?.name ?? vid}
                </div>
                <div className="text-[11px] text-fg-tertiary">
                  {items.length} item{items.length === 1 ? "" : "s"} · {formatMoney(supplierTotal)}
                </div>
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={() => reorderSupplier(vid, items)}
              >
                Reorder all
              </Button>
            </div>
            <ul className="divide-y divide-hairline">
              {items.map((i) => (
                <li
                  key={i.id}
                  className="flex items-center justify-between gap-3 px-4 py-2 text-[12px]"
                >
                  <span className="min-w-0 flex-1 truncate text-fg">{i.name}</span>
                  <span className="tabular-nums text-fg-subtle">
                    qty {i.reorder_quantity ?? "—"} · stock {i.stock_on_hand ?? 0}
                  </span>
                  <span className="money-display text-fg">
                    {formatMoney((i.cost ?? 0) * (i.reorder_quantity ?? 1))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {needsSupplier.length > 0 && (
        <div className="rounded-[12px] border border-status-warn/30 bg-status-warn/[0.05] p-3 text-[12px]">
          <div className="flex items-center gap-2 font-medium text-status-warn">
            <AlertTriangle className="size-3.5" />
            {needsSupplier.length} low-stock item{needsSupplier.length === 1 ? "" : "s"} need a supplier set
          </div>
          <ul className="mt-1 ml-5 list-disc text-fg-subtle">
            {needsSupplier.map((i) => (
              <li key={i.id}>{i.name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
