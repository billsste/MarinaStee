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

const ITEM_FIELDS: FieldSpec<PosCatalogItem>[] = [
  { key: "name", label: "Item name", kind: "text", required: true, col: 2, placeholder: "Marina burger" },
  { key: "sku", label: "SKU", kind: "text", required: true, col: 2, placeholder: "BURGER", hint: "Shown on receipts. Stable — renaming is OK; historical orders keep the old SKU." },
  { key: "category", label: "Category", kind: "text", required: true, col: 2, placeholder: "Mains", hint: "Free-text; items group by this on the POS palette." },
  { key: "price", label: "Price ($)", kind: "money", required: true, col: 2, step: "0.01" },
  { key: "cost", label: "Cost of goods ($)", kind: "money", col: 2, step: "0.01", hint: "Optional. Enables margin reports." },
  { key: "taxable", label: "Taxable", kind: "boolean", col: 2 },
  { key: "active", label: "Active in catalog", kind: "boolean", col: 2, hint: "Inactive items are hidden from the POS Terminal palette but historical orders still resolve." },
];

export function CatalogManager() {
  const items = usePosCatalog();
  const locations = usePosLocations();

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
