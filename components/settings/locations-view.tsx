"use client";

import * as React from "react";
import { Anchor, Coffee, Plus, ShoppingBag, Store, Trash2 } from "lucide-react";
import { anyApi } from "convex/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import {
  deletePosLocation,
  nextPosLocationId,
  updatePosLocation,
  upsertPosLocation,
  usePosLocations,
} from "@/lib/client-store";
import type { PosLocation, PosLocationKey } from "@/lib/types";
import { useTenantMutation } from "@/lib/use-tenant-mutation";
import { useTenantQuery } from "@/lib/use-tenant-query";

/*
 * Settings → POS Locations editor. Row-click opens the edit dialog;
 * same UX as /services Roster and /services/rates. One affordance per row,
 * not per cell.
 *
 * Phase 3 migration target (see docs/architecture-convex.md +
 * docs/migration-page-recipe.md). Reads route through `useTenantQuery`,
 * which transparently falls back to the mock store when Convex isn't
 * online (NEXT_PUBLIC_CONVEX_URL unset). Writes still go to the mock
 * store until Phase 4 — the matching Convex mutations
 * (`pos.createLocation` / `pos.updateLocation` / `pos.archiveLocation`)
 * are already wired and ready in `convex/pos.ts`.
 */

// Shape returned by `convex/pos.ts:listLocations`. Differs from the
// mock `PosLocation` only in the id field names (Convex doc convention
// uses `_id` + `tenantId`). The adapter below reshapes Convex rows
// back to the mock-friendly shape the component already consumes.
interface ConvexPosLocation {
  _id: string;
  tenantId: string;
  key: PosLocation["key"];
  name: string;
  icon_key?: PosLocation["icon_key"];
  default_tax_rate: number;
  allows_charge_to_account: boolean;
  active: boolean;
  sort_order: number;
}

function convexLocationToMock(rows: ConvexPosLocation[]): PosLocation[] {
  return rows.map((r) => ({
    id: r._id,
    tenant_id: r.tenantId,
    key: r.key,
    name: r.name,
    icon_key: r.icon_key,
    default_tax_rate: r.default_tax_rate,
    allows_charge_to_account: r.allows_charge_to_account,
    active: r.active,
    sort_order: r.sort_order,
  }));
}

// Inlined grid template — Tailwind v4 JIT can silently drop arbitrary
// `grid-cols-[…]` with mixed units, which collapses the rows.
const LOCATIONS_COLS =
  "28px minmax(0, 1.4fr) 120px 90px 140px 70px 36px";

const NEW_LOCATION_FIELDS: FieldSpec<PosLocation>[] = [
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
    hint: "Decimal (e.g., 0.0825 for 8.25%).",
  },
  {
    key: "allows_charge_to_account",
    label: "Allows charge to account",
    kind: "boolean",
    col: 2,
  },
  { key: "active", label: "Active", kind: "boolean", col: 2 },
  { key: "sort_order", label: "Sort order", kind: "number", col: 2 },
];

const ICONS: Record<string, React.ReactNode> = {
  fuel: <Anchor className="size-3.5" />,
  shop: <ShoppingBag className="size-3.5" />,
  restaurant: <Coffee className="size-3.5" />,
  harbormaster: <Anchor className="size-3.5" />,
  marina: <Store className="size-3.5" />,
};

export function PosLocationsView() {
  // Mock subscription stays unconditional so React's hook order is
  // stable regardless of whether Convex is online. `useTenantQuery`
  // picks between the two sources at return time.
  const mockLocations = usePosLocations();
  const locations = useTenantQuery<PosLocation[], ConvexPosLocation[]>({
    mock: mockLocations,
    convexRef: anyApi.pos.listLocations,
    convexArgs: React.useMemo(() => ({}), []),
    convexAdapter: convexLocationToMock,
  });

  // Phase 4 — write routing. Each callsite picks Convex vs mock at
  // invocation time. Edit/create branch on whether `editing` is set;
  // delete is a hard-remove (Convex `removeLocation` matches the
  // mock's `deletePosLocation` semantics — operator can also flip
  // `active` from the dialog to soft-archive without removing).
  const createLocation = useTenantMutation<PosLocation, void>({
    mock: (loc) => upsertPosLocation(loc),
    convexRef: anyApi.pos.createLocation,
    convexArgsAdapter: (loc) => ({
      key: loc.key,
      name: loc.name,
      icon_key: loc.icon_key,
      default_tax_rate: loc.default_tax_rate,
      allows_charge_to_account: loc.allows_charge_to_account,
      active: loc.active,
      sort_order: loc.sort_order,
    }),
  });
  const editLocation = useTenantMutation<PosLocation, void>({
    mock: (loc) => upsertPosLocation(loc),
    convexRef: anyApi.pos.updateLocation,
    convexArgsAdapter: (loc) => ({
      id: loc.id,
      patch: {
        name: loc.name,
        icon_key: loc.icon_key,
        default_tax_rate: loc.default_tax_rate,
        allows_charge_to_account: loc.allows_charge_to_account,
        active: loc.active,
        sort_order: loc.sort_order,
      },
    }),
  });
  // `updatePosLocation` is the partial-patch path on the mock side —
  // referenced indirectly via the editLocation upsert above when only
  // a subset of fields changes. Kept in the import surface so future
  // callers can reach for it without re-wiring.
  void updatePosLocation;
  const removeLocation = useTenantMutation<string, void>({
    mock: (id) => deletePosLocation(id),
    convexRef: anyApi.pos.removeLocation,
    convexArgsAdapter: (id) => ({ id }),
  });

  // Single dialog handles both create and edit. `editing` is the
  // record when set, otherwise create mode.
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<PosLocation | undefined>();

  function openCreate() {
    setEditing(undefined);
    setDialogOpen(true);
  }
  function openEdit(loc: PosLocation) {
    setEditing(loc);
    setDialogOpen(true);
  }

  function handleSave(values: PosLocation) {
    const id = values.id || editing?.id || nextPosLocationId();
    const stamped: PosLocation = {
      ...values,
      id,
      key: ((values.key as string) || `loc_${id.slice(-6)}`)
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "") as PosLocationKey,
      name: values.name || "Untitled",
      default_tax_rate: Number(values.default_tax_rate) || 0,
      allows_charge_to_account: values.allows_charge_to_account !== false,
      active: values.active !== false,
      sort_order: Number(values.sort_order) || locations.length,
      icon_key: (values.icon_key as PosLocation["icon_key"]) || "shop",
    };
    // Fire-and-forget — the dialog has already closed and the read
    // hook will pick up the change on its next sync (mock store
    // notifies synchronously; Convex pushes via subscription).
    if (editing) {
      void editLocation(stamped);
    } else {
      void createLocation(stamped);
    }
  }

  function handleDelete(loc: PosLocation) {
    if (
      !window.confirm(
        `Delete "${loc.name}"? Historical orders stay linked, but new POS orders won't be able to use it.`
      )
    )
      return;
    void removeLocation(loc.id);
  }

  const sorted = [...locations].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-fg-tertiary">
          Click a row to edit. Locations show up in the POS Terminal and on
          receipts; items in the Catalog reference these.
        </p>
        <Button variant="primary" size="sm" onClick={openCreate}>
          <Plus className="size-3.5" />
          New location
        </Button>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{ gridTemplateColumns: LOCATIONS_COLS }}
        >
          <span></span>
          <span>Location</span>
          <span>Key</span>
          <span>Tax rate</span>
          <span>Charge to acct</span>
          <span>Active</span>
          <span></span>
        </div>
        {sorted.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-fg-tertiary">
            No registers configured. Click <span className="font-medium text-fg-subtle">New location</span> to add one.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {sorted.map((loc) => (
              <li key={loc.id} className="group relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDelete(loc);
                  }}
                  className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-md p-1 text-fg-tertiary opacity-0 transition-opacity hover:bg-surface-3 hover:text-status-danger group-hover:opacity-100"
                  aria-label={`Delete ${loc.name}`}
                  title="Delete location"
                >
                  <Trash2 className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(loc)}
                  style={{ gridTemplateColumns: LOCATIONS_COLS }}
                  className="grid w-full cursor-pointer items-center gap-x-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
                  title="Edit location"
                >
                  <span className="text-fg-subtle">
                    {ICONS[loc.icon_key ?? "shop"] ?? <Store className="size-3.5" />}
                  </span>
                  <span className="min-w-0 truncate text-[13px] font-medium text-fg">
                    {loc.name}
                  </span>
                  <span className="font-mono text-[11px] text-fg-tertiary">
                    {loc.key}
                  </span>
                  <span className="tabular text-[13px] text-fg">
                    {`${(loc.default_tax_rate * 100).toFixed(2).replace(/\.00$/, "")}%`}
                  </span>
                  <span>
                    <Badge
                      tone={loc.allows_charge_to_account ? "ok" : "neutral"}
                      size="sm"
                    >
                      {loc.allows_charge_to_account
                        ? "Allowed"
                        : "Card / cash only"}
                    </Badge>
                  </span>
                  <span>
                    <Badge tone={loc.active ? "ok" : "neutral"} size="sm">
                      {loc.active ? "Active" : "Inactive"}
                    </Badge>
                  </span>
                  <span />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <RecordEditDialog<PosLocation>
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? `Edit location — ${editing.name}` : "New POS location"}
        description="Locations show up in the POS Terminal and on receipts. Items in the Catalog reference these locations."
        record={editing}
        fields={NEW_LOCATION_FIELDS}
        onSave={handleSave}
        onDelete={editing ? handleDelete : undefined}
      />
    </div>
  );
}
