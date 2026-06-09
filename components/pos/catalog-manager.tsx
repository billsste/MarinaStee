"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import {
  deletePosItem,
  nextPosItemId,
  upsertPosItem,
  usePosCatalog,
  usePosLocations,
  useVendors,
} from "@/lib/client-store";
import { formatMoney } from "@/lib/mock-data";
import type { PosCatalogItem, PosLocation } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * /ledger → Catalog tab. Full CRUD over POS_CATALOG.
 *
 * Items grouped by location, then by category. Click any item → edit
 * dialog. "+ New item" per location, with the new item's location_keys
 * pre-filled. Soft-archive via `active: false` so historical PosOrders
 * still resolve their line item.
 *
 * Cost is optional; when present, the margin column renders. Empty cost
 * is fine — many small marinas don't track COGS at the SKU level.
 */

/**
 * Static field set — boater-side info (name, sku, price, etc.). The
 * stock fields below get appended dynamically in the component so
 * the supplier dropdown can pull live vendor options.
 */
const ITEM_STATIC_FIELDS: FieldSpec<PosCatalogItem>[] = [
  { key: "name", label: "Item name", kind: "text", required: true, col: 2, placeholder: "Marina burger" },
  { key: "sku", label: "SKU", kind: "text", required: true, col: 2, placeholder: "BURGER", hint: "Shown on receipts. Stable — renaming is OK; historical orders keep the old SKU." },
  { key: "category", label: "Category", kind: "text", required: true, col: 2, placeholder: "Mains", hint: "Free-text; items group by this on the POS palette." },
  { key: "price", label: "Price ($)", kind: "money", required: true, col: 2, step: "0.01" },
  { key: "cost", label: "Cost of goods ($)", kind: "money", col: 2, step: "0.01", hint: "Optional. Enables margin reports." },
  { key: "taxable", label: "Taxable", kind: "boolean", col: 2 },
  { key: "active", label: "Active in catalog", kind: "boolean", col: 2, hint: "Inactive items are hidden from the POS Terminal palette but historical orders still resolve." },
  // ── Stock tracking (inventory) ──
  // Toggle `tracked` on for items the marina counts in stock (lines,
  // fenders, ice, sunscreen, etc.). When on, POS sales auto-decrement
  // `stock_on_hand`, and the item surfaces in /inventory with low-stock
  // alerts when stock falls to or below `reorder_point`. Untracked
  // items skip silently — that's the right default for services
  // (pump-out) and bottomless products (fuel by the gallon).
  { key: "tracked", label: "Track stock", kind: "boolean", col: 2, hint: "When on, POS sales auto-decrement stock_on_hand and the item shows up under /inventory with low-stock alerts." },
  { key: "stock_on_hand", label: "Stock on hand", kind: "number", col: 2, step: "1", hint: "Current count. Only meaningful when tracked." },
  { key: "reorder_point", label: "Reorder point", kind: "number", col: 2, step: "1", hint: "Stock at or below this triggers a low-stock alert." },
  { key: "reorder_quantity", label: "Suggested order qty", kind: "number", col: 2, step: "1", hint: "Default qty pre-filled when reordering from the low-stock view." },
];

export function CatalogManager() {
  const items = usePosCatalog();
  const locations = usePosLocations();
  const vendors = useVendors();

  // Compose the full field spec — static fields plus the supplier
  // dropdown built from the active tenant's vendors. Memoized so it
  // doesn't recreate on every render.
  const ITEM_FIELDS = React.useMemo<FieldSpec<PosCatalogItem>[]>(
    () => [
      ...ITEM_STATIC_FIELDS,
      {
        key: "supplier_vendor_id",
        label: "Supplier",
        kind: "select",
        col: 2,
        options: [
          { value: "", label: "— None —" },
          ...vendors.map((v) => ({
            value: v.id,
            label: v.display_name ?? v.name,
          })),
        ],
        hint: "Vendor the item is reordered from. Used by /inventory low-stock reorder.",
      },
    ],
    [vendors]
  );

  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<PosCatalogItem | undefined>();
  // Pre-fill which location this item belongs to when adding from a
  // per-location "+ New item" button. Editing an existing item ignores
  // this — it keeps the item's existing location_keys.
  const [addingToLocationKey, setAddingToLocationKey] = React.useState<
    PosLocation["key"] | null
  >(null);
  // Active-location filter. "all" shows everything grouped by location.
  const [filterKey, setFilterKey] = React.useState<PosLocation["key"] | "all">(
    "all"
  );
  const [showInactive, setShowInactive] = React.useState(false);

  function openAdd(locationKey: PosLocation["key"] | null = null) {
    setEditing(undefined);
    setAddingToLocationKey(locationKey);
    setOpen(true);
  }
  function openEdit(item: PosCatalogItem) {
    setEditing(item);
    setAddingToLocationKey(null);
    setOpen(true);
  }
  function handleSave(values: PosCatalogItem) {
    const id = values.id || nextPosItemId();
    const location_keys =
      values.location_keys && values.location_keys.length > 0
        ? values.location_keys
        : addingToLocationKey
        ? [addingToLocationKey]
        : editing?.location_keys ?? [];
    upsertPosItem({
      ...values,
      id,
      price: Number(values.price) || 0,
      cost: values.cost !== undefined && values.cost !== null && String(values.cost) !== ""
        ? Number(values.cost)
        : undefined,
      sku: values.sku || `SKU-${id.slice(-6).toUpperCase()}`,
      category: values.category || "Uncategorized",
      taxable: values.taxable !== false,
      active: values.active !== false,
      location_keys,
      // Stock tracking fields — preserve undefined when blank so the
      // store doesn't end up storing 0 / false for items that just
      // weren't filled in. Tracked = true is the only field that
      // changes downstream behavior (POS auto-decrement).
      tracked: Boolean(values.tracked),
      stock_on_hand:
        values.stock_on_hand !== undefined && String(values.stock_on_hand) !== ""
          ? Number(values.stock_on_hand)
          : undefined,
      reorder_point:
        values.reorder_point !== undefined && String(values.reorder_point) !== ""
          ? Number(values.reorder_point)
          : undefined,
      reorder_quantity:
        values.reorder_quantity !== undefined &&
        String(values.reorder_quantity) !== ""
          ? Number(values.reorder_quantity)
          : undefined,
      supplier_vendor_id:
        values.supplier_vendor_id && values.supplier_vendor_id !== ""
          ? values.supplier_vendor_id
          : undefined,
    });
  }
  function handleDelete(item: PosCatalogItem) {
    deletePosItem(item.id);
  }

  // Build grouped view: location → category → items
  const filtered = items.filter((i) => (showInactive ? true : i.active));
  const locationsToShow = locations.filter(
    (l) => filterKey === "all" || l.key === filterKey
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-hairline bg-surface-1 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilterKey("all")}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              filterKey === "all"
                ? "border-primary/40 bg-primary-soft text-primary"
                : "border-hairline bg-surface-2 text-fg-muted hover:bg-surface-3"
            )}
          >
            All locations · {items.filter((i) => i.active).length}
          </button>
          {locations.map((l) => {
            const count = items.filter(
              (i) => i.active && i.location_keys.includes(l.key)
            ).length;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => setFilterKey(l.key)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  filterKey === l.key
                    ? "border-primary/40 bg-primary-soft text-primary"
                    : "border-hairline bg-surface-2 text-fg-muted hover:bg-surface-3"
                )}
              >
                {l.name} · {count}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-[12px] text-fg-subtle">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="size-3.5"
            />
            Show inactive
          </label>
          <Button variant="primary" size="sm" onClick={() => openAdd(null)}>
            <Plus className="size-3.5" />
            New item
          </Button>
        </div>
      </div>

      {/* Grouped by location → category */}
      <div className="space-y-5">
        {locationsToShow.map((loc) => {
          const locItems = filtered.filter((i) => i.location_keys.includes(loc.key));
          const byCategory = locItems.reduce<Record<string, PosCatalogItem[]>>(
            (acc, i) => {
              (acc[i.category] ||= []).push(i);
              return acc;
            },
            {}
          );
          const categories = Object.keys(byCategory).sort();
          return (
            <section
              key={loc.id}
              className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1"
            >
              <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-[14px] font-medium text-fg">{loc.name}</h2>
                  {!loc.active && (
                    <Badge tone="warn" size="sm">
                      Inactive
                    </Badge>
                  )}
                  <span className="text-[11px] text-fg-tertiary">
                    {locItems.length} {locItems.length === 1 ? "item" : "items"}
                  </span>
                </div>
                <Button variant="secondary" size="sm" onClick={() => openAdd(loc.key)}>
                  <Plus className="size-3.5" />
                  Add to {loc.name}
                </Button>
              </header>
              {categories.length === 0 ? (
                <div className="px-4 py-10 text-center text-[12px] text-fg-subtle">
                  No items in this location yet.{" "}
                  <button
                    type="button"
                    onClick={() => openAdd(loc.key)}
                    className="text-primary hover:underline"
                  >
                    Add the first one
                  </button>
                  .
                </div>
              ) : (
                <div className="divide-y divide-hairline">
                  {categories.map((cat) => (
                    <CategoryBlock
                      key={cat}
                      name={cat}
                      items={byCategory[cat]}
                      onEdit={openEdit}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <RecordEditDialog<PosCatalogItem>
        open={open}
        onOpenChange={setOpen}
        title={editing ? `Edit item — ${editing.name}` : "New POS item"}
        description="Items appear on the POS Terminal palette at the locations checked here. Service fees flow in automatically from the Fees catalog."
        record={editing}
        fields={ITEM_FIELDS}
        onSave={handleSave}
        onDelete={editing ? handleDelete : undefined}
      />
    </div>
  );
}

function CategoryBlock({
  name,
  items,
  onEdit,
}: {
  name: string;
  items: PosCatalogItem[];
  onEdit: (item: PosCatalogItem) => void;
}) {
  return (
    <div className="px-4 py-3">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {name}
      </h3>
      <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
        {items.map((item) => {
          const margin = item.cost != null && item.price > 0
            ? (((item.price - item.cost) / item.price) * 100).toFixed(0)
            : null;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onEdit(item)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-left transition-colors hover:border-hairline-strong hover:bg-surface-3",
                  !item.active && "opacity-60"
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-fg">
                      {item.name}
                    </span>
                    {!item.active && <Badge tone="warn" size="sm">Inactive</Badge>}
                    {!item.taxable && (
                      <span className="text-[10px] text-fg-tertiary">no-tax</span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-fg-tertiary">
                    {item.sku}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <div className="money-display text-[13px] text-fg">
                      {formatMoney(item.price)}
                    </div>
                    {margin !== null && (
                      <div className="text-[10px] text-fg-tertiary">
                        {margin}% margin
                      </div>
                    )}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
