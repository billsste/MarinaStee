"use client";

import * as React from "react";
import { CheckCircle2, Plus, X } from "lucide-react";
import { anyApi } from "convex/server";
import { Button } from "@/components/ui/button";
import { updateRole, upsertRole, useRoles } from "@/lib/client-store";
import type { PermissionKey, Role } from "@/lib/types";
import { useTenantMutation } from "@/lib/use-tenant-mutation";
import { useTenantQuery } from "@/lib/use-tenant-query";
import { cn } from "@/lib/utils";

/*
 * Shared role + permission matrix surface.
 *
 * Used inside /staff → Roles. Was previously housed at /settings/staff
 * but Staff & Roles is now a single unified section on /staff. The
 * matrix lets an operator toggle individual permissions per role —
 * read-only for system roles in the future, editable for custom ones.
 */

export const ALL_PERMISSIONS: { key: PermissionKey; label: string; group: string }[] = [
  { key: "manage.settings", label: "Manage settings", group: "Admin" },
  { key: "manage.staff", label: "Manage staff", group: "Admin" },
  { key: "manage.picklists", label: "Manage picklists", group: "Admin" },
  { key: "manage.catalog", label: "Manage catalog (POS, fees, rates)", group: "Admin" },
  { key: "manage.marina_profile", label: "Edit marina profile", group: "Admin" },
  { key: "manage.qb_sync", label: "Manage QuickBooks sync", group: "Admin" },
  { key: "create.boater", label: "Create boaters", group: "Boaters" },
  { key: "update.boater", label: "Update boaters", group: "Boaters" },
  { key: "delete.boater", label: "Delete boaters", group: "Boaters" },
  { key: "create.contract", label: "Create / draft contracts", group: "Contracts" },
  { key: "terminate.contract", label: "Terminate contracts", group: "Contracts" },
  { key: "create.work_order", label: "Create work orders", group: "Work" },
  { key: "complete.work_order", label: "Complete work orders", group: "Work" },
  { key: "process.payment", label: "Process payments", group: "Money" },
  { key: "refund.payment", label: "Refund payments", group: "Money" },
  { key: "run.annual_billing", label: "Run annual billing", group: "Money" },
  { key: "view.financials", label: "View financials", group: "Visibility" },
  { key: "view.reports", label: "View reports", group: "Visibility" },
];

/*
 * Phase 3 + 4 (Wave 3) migration. The Convex `roles` table mirrors the
 * mock shape directly — `convex/roles.ts` exposes list / create /
 * update. Reads flow through `useTenantQuery`; writes (new role +
 * toggle permission) flow through `useTenantMutation` declared in the
 * parent so the matrix child can re-use both handles.
 */

interface ConvexRole {
  _id: string;
  tenantId: string;
  name: string;
  description?: string;
  permissions: string[];
  is_system: boolean;
  sort_order: number;
}

function convexRolesToMock(rows: ConvexRole[]): Role[] {
  return rows.map((r) => ({
    id: r._id,
    tenant_id: r.tenantId,
    name: r.name,
    description: r.description,
    permissions: r.permissions as PermissionKey[],
    is_system: r.is_system,
    sort_order: r.sort_order,
  }));
}

const ROLES_EMPTY_ARGS = {} as const;

export function RolesAndPermissions() {
  const mockRoles = useRoles();
  const roles = useTenantQuery<Role[], ConvexRole[]>({
    mock: mockRoles,
    convexRef: anyApi.roles.list,
    convexArgs: ROLES_EMPTY_ARGS,
    convexAdapter: convexRolesToMock,
  });

  // Phase 4 — write routing. Create gets a thin args adapter (mock fn
  // wants a full Role, Convex wants `{ name, description, permissions }`).
  // Toggle hits the role's full perm list via `update`.
  const createRole = useTenantMutation<Role, void>({
    mock: (r) => upsertRole(r),
    convexRef: anyApi.roles.create,
    convexArgsAdapter: (r) => ({
      name: r.name,
      description: r.description,
      permissions: r.permissions,
    }),
  });
  const patchRole = useTenantMutation<
    { id: string; patch: Partial<Role> },
    void
  >({
    mock: ({ id, patch }) => updateRole(id, patch),
    convexRef: anyApi.roles.update,
    convexArgsAdapter: ({ id, patch }) => ({
      id,
      patch: {
        name: patch.name,
        description: patch.description,
        permissions: patch.permissions,
        sort_order: patch.sort_order,
      },
    }),
  });

  function handleNewRole() {
    const id = `role_runtime_${Date.now()}`;
    void createRole({
      id,
      tenant_id: roles[0]?.tenant_id ?? "",
      name: "New role",
      description: "Custom role",
      permissions: [],
      is_system: false,
      sort_order: roles.length,
    });
  }

  return (
    <section className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
      <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <div>
          <h2 className="text-[14px] font-medium text-fg">Roles &amp; permissions</h2>
          <p className="text-[11px] text-fg-tertiary">
            {roles.length} roles · click a permission cell to toggle. New roles
            apply to staff once assigned in the Roster.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={handleNewRole}>
          <Plus className="size-3.5" />
          New role
        </Button>
      </header>
      <RolePermissionMatrix roles={roles} onPatch={patchRole} />
    </section>
  );
}

function RolePermissionMatrix({
  roles,
  onPatch,
}: {
  roles: Role[];
  onPatch: (args: { id: string; patch: Partial<Role> }) => Promise<void>;
}) {
  const groups = Array.from(new Set(ALL_PERMISSIONS.map((p) => p.group)));

  function togglePerm(role: Role, perm: PermissionKey) {
    const has = role.permissions.includes(perm);
    void onPatch({
      id: role.id,
      patch: {
        permissions: has
          ? role.permissions.filter((p) => p !== perm)
          : [...role.permissions, perm],
      },
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-hairline bg-surface-2 text-left">
            <th className="px-3 py-2 font-medium text-fg-tertiary">Permission</th>
            {roles.map((r) => (
              <th
                key={r.id}
                className="px-2 py-2 text-center font-medium text-fg-tertiary"
              >
                {r.name}
                {r.is_system && (
                  <div className="text-[9px] font-normal text-fg-tertiary">system</div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <React.Fragment key={g}>
              <tr className="bg-surface-2">
                <td
                  colSpan={1 + roles.length}
                  className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
                >
                  {g}
                </td>
              </tr>
              {ALL_PERMISSIONS.filter((p) => p.group === g).map((perm) => (
                <tr key={perm.key} className="border-t border-hairline">
                  <td className="px-3 py-2 text-fg">{perm.label}</td>
                  {roles.map((r) => {
                    const has = r.permissions.includes(perm.key);
                    return (
                      <td key={r.id} className="px-2 py-1 text-center">
                        <button
                          type="button"
                          onClick={() => togglePerm(r, perm.key)}
                          className={cn(
                            "inline-flex size-6 items-center justify-center rounded-md transition-colors",
                            has
                              ? "bg-status-ok/15 text-status-ok hover:bg-status-ok/25"
                              : "bg-surface-2 text-fg-tertiary hover:bg-surface-3"
                          )}
                          title={has ? "Granted — click to revoke" : "Click to grant"}
                        >
                          {has ? <CheckCircle2 className="size-4" /> : <X className="size-4" />}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
