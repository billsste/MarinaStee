"use client";

import * as React from "react";
import { Anchor, Plus, Trash2 } from "lucide-react";
import { anyApi } from "convex/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import {
  deleteDock,
  nextDockId,
  updateDock,
  upsertDock,
  useDocks,
  useSlips,
} from "@/lib/client-store";
import type { Dock } from "@/lib/types";
import { useTenantMutation } from "@/lib/use-tenant-mutation";
import { useTenantQuery } from "@/lib/use-tenant-query";

/*
 * Settings → Docks. Operator manages the dock list: name, short_name,
 * slip-id prefix, sort order, active. Slip records reference a dock
 * via dock_id — renames here propagate to every slip on next render.
 *
 * Deleting a dock is blocked if any slip still references it (the
 * store mutation throws and we catch + alert).
 *
 * Phase 3 migration target (see docs/architecture-convex.md +
 * docs/migration-page-recipe.md). Reads route through `useTenantQuery`,
 * which transparently falls back to the mock store when Convex isn't
 * online (NEXT_PUBLIC_CONVEX_URL unset). Writes still go to the mock
 * store until Phase 4 — `convex/docks.ts` already exposes `create`,
 * `update`, and `archive` mutations ready to wire.
 */

// Shape returned by `convex/docks.ts:list`. Differs from the mock
// `Dock` only in the id field names (Convex doc convention uses `_id`
// + `tenantId`). The adapter below reshapes Convex rows back to the
// mock-friendly shape the component already consumes.
interface ConvexDock {
  _id: string;
  tenantId: string;
  name: string;
  short_name: string;
  prefix?: string;
  sort_order: number;
  active: boolean;
  notes?: string;
}

function convexDocksToMock(rows: ConvexDock[]): Dock[] {
  return rows.map((r) => ({
    id: r._id,
    tenant_id: r.tenantId,
    name: r.name,
    short_name: r.short_name,
    prefix: r.prefix,
    sort_order: r.sort_order,
    active: r.active,
    notes: r.notes,
  }));
}

// Stable empty args — referential identity matters to Convex's
// useQuery dedupe.
const EMPTY_ARGS = {} as const;

const DOCK_FIELDS: FieldSpec<Dock>[] = [
  { key: "name", label: "Dock name", kind: "text", required: true, col: 2, placeholder: "Damsite A Dock" },
  { key: "short_name", label: "Short name", kind: "text", required: true, col: 2, placeholder: "A Dock", hint: "Used on roster chips and compact rows." },
  { key: "prefix", label: "Slip-id prefix", kind: "text", col: 2, placeholder: "A", hint: "1–3 letters. Drives auto-generated slip ids like A01, A02." },
  { key: "sort_order", label: "Sort order", kind: "number", col: 2, hint: "Lower numbers appear first on the roster filter strip." },
  { key: "active", label: "Active", kind: "boolean", col: 2, hint: "Inactive docks hide from the roster filter; existing slips still show." },
  { key: "notes", label: "Notes", kind: "textarea" },
];

export function DocksView() {
  // Mock subscription stays unconditional so React's hook order is
  // stable regardless of whether Convex is online. `useTenantQuery`
  // picks between the two sources at return time.
  const mockDocks = useDocks();
  const docks = useTenantQuery<Dock[], ConvexDock[]>({
    mock: mockDocks,
    convexRef: anyApi.docks.list,
    convexArgs: EMPTY_ARGS,
    convexAdapter: convexDocksToMock,
  });
  const slips = useSlips();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Dock | undefined>();

  // Phase 4 — write routing. Create / edit / delete each branch
  // between Convex and the mock store via `useTenantMutation`. Mock
  // semantics preserved: `upsertDock` cascades to `slips.dock` and
  // `updateDock` does the same, so we keep both as separate callsites
  // (mirroring the original branching on `editing`).
  const createDock = useTenantMutation<Dock, void>({
    mock: (d) => upsertDock(d),
    convexRef: anyApi.docks.create,
    convexArgsAdapter: (d) => ({
      name: d.name,
      short_name: d.short_name,
      prefix: d.prefix,
      sort_order: d.sort_order,
      active: d.active,
    }),
  });
  const editDock = useTenantMutation<Dock, void>({
    mock: (d) => updateDock(d.id, d),
    convexRef: anyApi.docks.update,
    convexArgsAdapter: (d) => ({
      id: d.id,
      patch: {
        name: d.name,
        short_name: d.short_name,
        prefix: d.prefix,
        sort_order: d.sort_order,
        active: d.active,
        notes: d.notes,
      },
    }),
  });
  const removeDock = useTenantMutation<string, void>({
    mock: (id) => deleteDock(id),
    convexRef: anyApi.docks.remove,
    convexArgsAdapter: (id) => ({ id }),
  });

  function openAdd() {
    setEditing(undefined);
    setOpen(true);
  }
  function openEdit(d: Dock) {
    setEditing(d);
    setOpen(true);
  }
  function handleSave(values: Dock) {
    const id = values.id || nextDockId();
    if (editing) {
      // Edit existing — flow through updateDock so it cascades the
      // denormalized slip.dock string update.
      void editDock({ ...values, id });
    } else {
      void createDock({
        ...values,
        id,
        tenant_id: values.tenant_id || docks[0]?.tenant_id || "",
        active: values.active !== false,
        sort_order: Number(values.sort_order) || docks.length,
        prefix: (values.prefix || "").toUpperCase().slice(0, 3),
      });
    }
  }
  function handleDelete(d: Dock) {
    const onDock = slips.filter((s) => s.dock_id === d.id).length;
    if (onDock > 0) {
      window.alert(
        `Can't delete "${d.name}" — ${onDock} slip(s) still reference it. Move or delete those slips first.`
      );
      return;
    }
    // `removeDock` throws on the same condition server-side when on
    // Convex; the local guard above keeps the mock path's UX nice
    // (alert beats a console error).
    void removeDock(d.id);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button variant="primary" size="sm" onClick={openAdd}>
          <Plus className="size-3.5" />
          New dock
        </Button>
      </div>

      <ul className="divide-y divide-hairline rounded-[12px] border border-hairline bg-surface-1">
        {docks.map((d) => {
          const count = slips.filter((s) => s.dock_id === d.id).length;
          return (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => openEdit(d)}
                className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
              >
                <div className="flex size-9 items-center justify-center rounded-[8px] bg-surface-3 text-primary">
                  <Anchor className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-fg">{d.name}</span>
                    {!d.active && <Badge tone="warn" size="sm">Inactive</Badge>}
                  </div>
                  <div className="text-[11px] text-fg-tertiary">
                    {d.short_name}
                    {d.prefix && <> · prefix <span className="font-mono">{d.prefix}</span></>}
                    {" · "}
                    {count} {count === 1 ? "slip" : "slips"}
                    {" · "}sort #{d.sort_order}
                  </div>
                </div>
                <span
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDelete(d);
                  }}
                  className="rounded-md p-1 text-fg-tertiary opacity-0 transition-opacity hover:bg-surface-3 hover:text-status-danger group-hover:opacity-100"
                  role="button"
                  aria-label="Delete"
                >
                  <Trash2 className="size-3.5" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <RecordEditDialog<Dock>
        open={open}
        onOpenChange={setOpen}
        title={editing ? `Edit ${editing.name}` : "New dock"}
        description="Docks group slips. Renames cascade to every slip on this dock."
        record={editing}
        fields={DOCK_FIELDS}
        onSave={handleSave}
        onDelete={editing ? handleDelete : undefined}
      />
    </div>
  );
}
