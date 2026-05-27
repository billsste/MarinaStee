"use client";

import * as React from "react";
import { Anchor, Coffee, Plus, ShoppingBag, Store, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import {
  deletePosLocation,
  nextPosLocationId,
  upsertPosLocation,
  usePosLocations,
} from "@/lib/client-store";
import type { PosLocation, PosLocationKey } from "@/lib/types";

/*
 * Settings → POS Locations editor. Operators add their own register
 * locations beyond the seeded 4 (e.g., "Pool deck bar", "Bait shop").
 * Each location has its own tax rate, charge-to-account allowance, and
 * sort order; inactive locations disappear from the POS Terminal tab
 * strip but historical PosOrders still resolve.
 */

const LOCATION_FIELDS: FieldSpec<PosLocation>[] = [
  { key: "name", label: "Location name", kind: "text", required: true, col: 2, placeholder: "Fuel Dock" },
  { key: "key", label: "Internal key", kind: "text", required: true, col: 2, placeholder: "fuel_dock", hint: "Snake-case. Used in POS receipts + reports. Don't change once orders exist." },
  {
    key: "icon_key",
    label: "Icon",
    kind: "select",
    col: 2,
    options: [
      { value: "fuel", label: "Fuel" },
      { value: "shop", label: "Shop" },
      { value: "restaurant", label: "Restaurant" },
      { value: "harbormaster", label: "Harbormaster" },
      { value: "marina", label: "Marina" },
    ],
  },
  {
    key: "default_tax_rate",
    label: "Tax rate",
    kind: "money",
    col: 2,
    step: "0.0001",
    hint: "Decimal (e.g., 0.0825 for 8.25%). Per-location so each register applies the right jurisdictional rate.",
  },
  {
    key: "allows_charge_to_account",
    label: "Allows charge to account",
    kind: "boolean",
    col: 2,
    hint: "If off, only card/cash/split payment methods on this register.",
  },
  { key: "active", label: "Active", kind: "boolean", col: 2, hint: "Inactive locations hide from the POS Terminal." },
  { key: "sort_order", label: "Sort order", kind: "number", col: 2, hint: "Lower numbers appear first in the tab strip." },
];

const ICONS: Record<string, React.ReactNode> = {
  fuel: <Anchor className="size-4" />,
  shop: <ShoppingBag className="size-4" />,
  restaurant: <Coffee className="size-4" />,
  harbormaster: <Anchor className="size-4" />,
  marina: <Store className="size-4" />,
};

export function PosLocationsView() {
  const locations = usePosLocations();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<PosLocation | undefined>();

  function openAdd() {
    setEditing(undefined);
    setOpen(true);
  }
  function openEdit(loc: PosLocation) {
    setEditing(loc);
    setOpen(true);
  }
  function handleSave(values: PosLocation) {
    const id = values.id || nextPosLocationId();
    upsertPosLocation({
      ...values,
      id,
      // Normalize key to snake_case for safety on new locations.
      key: ((values.key as string) || `loc_${id.slice(-6)}`)
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "") as PosLocationKey,
      name: values.name || "Untitled",
      default_tax_rate: Number(values.default_tax_rate) || 0,
      allows_charge_to_account: values.allows_charge_to_account !== false,
      active: values.active !== false,
      sort_order: Number(values.sort_order) || 0,
      icon_key: (values.icon_key as PosLocation["icon_key"]) || "shop",
    });
  }
  function handleDelete(loc: PosLocation) {
    if (
      !window.confirm(
        `Delete "${loc.name}"? Historical orders stay linked to this location id. New POS orders won't be able to use it. Continue?`
      )
    )
      return;
    deletePosLocation(loc.id);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-fg-tertiary">
          POS locations are your registers — Fuel Dock, Ship Store, Restaurant,
          Harbormaster, or whatever you call them. Each has its own tax rate
          and item catalog.
        </p>
        <Button variant="primary" size="sm" onClick={openAdd}>
          <Plus className="size-3.5" />
          New location
        </Button>
      </div>

      <ul className="divide-y divide-hairline rounded-[12px] border border-hairline bg-surface-1">
        {locations.map((loc) => (
          <li key={loc.id}>
            <button
              type="button"
              onClick={() => openEdit(loc)}
              className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
            >
              <div className="flex size-9 items-center justify-center rounded-[8px] bg-surface-3 text-primary">
                {ICONS[loc.icon_key ?? "shop"] ?? <Store className="size-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium text-fg">{loc.name}</span>
                  {!loc.active && <Badge tone="warn" size="sm">Inactive</Badge>}
                  {loc.allows_charge_to_account && (
                    <Badge tone="info" size="sm">
                      Charge to account
                    </Badge>
                  )}
                </div>
                <div className="text-[11px] text-fg-tertiary">
                  <span className="font-mono">{loc.key}</span>
                  {" · "}
                  Tax {(loc.default_tax_rate * 100).toFixed(2).replace(/\.00$/, "")}%
                  {" · "}
                  Sort #{loc.sort_order}
                </div>
              </div>
              <span
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDelete(loc);
                }}
                className="rounded-md p-1 text-fg-tertiary opacity-0 transition-opacity hover:bg-surface-3 hover:text-status-danger group-hover:opacity-100"
                role="button"
                aria-label="Delete"
              >
                <Trash2 className="size-3.5" />
              </span>
            </button>
          </li>
        ))}
      </ul>

      <RecordEditDialog<PosLocation>
        open={open}
        onOpenChange={setOpen}
        title={editing ? `Edit location — ${editing.name}` : "New POS location"}
        description="Add a register location. Items in the Catalog reference these locations."
        record={editing}
        fields={LOCATION_FIELDS}
        onSave={handleSave}
        onDelete={editing ? handleDelete : undefined}
      />
    </div>
  );
}
