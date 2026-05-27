"use client";

import * as React from "react";
import { CheckCircle2, Mail, Plus, Shield, ShieldOff, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import {
  deleteStaffMember,
  nextStaffId,
  updateRole,
  upsertRole,
  upsertStaffMember,
  useRoles,
  useStaff,
} from "@/lib/client-store";
import type { PermissionKey, Role, StaffMember } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * Settings → Staff & Roles. Two side-by-side surfaces:
 *  - Staff list with invite + role assignment + MFA badge
 *  - Roles list with permission matrix toggle
 *
 * Permissions are flat action.entity keys. Toggling a permission on a
 * role updates every staff member with that role at next read.
 */

const ALL_PERMISSIONS: { key: PermissionKey; label: string; group: string }[] = [
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

const STAFF_FIELDS: FieldSpec<StaffMember>[] = [
  { key: "name", label: "Full name", kind: "text", required: true, col: 2 },
  { key: "email", label: "Email", kind: "text", required: true, col: 2 },
  { key: "phone", label: "Phone", kind: "text", col: 2, placeholder: "(555) 555-0100" },
  // role_id is filled via a select rendered in the wrapper component
  { key: "mfa_enabled", label: "MFA enabled", kind: "boolean", col: 2 },
  {
    key: "status",
    label: "Status",
    kind: "select",
    col: 2,
    options: [
      { value: "invited", label: "Invited (pending)" },
      { value: "active", label: "Active" },
      { value: "suspended", label: "Suspended" },
    ],
  },
];

export function StaffView() {
  const staff = useStaff();
  const roles = useRoles();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<StaffMember | undefined>();

  function openInvite() {
    setEditing(undefined);
    setOpen(true);
  }
  function openEdit(s: StaffMember) {
    setEditing(s);
    setOpen(true);
  }
  function handleSaveStaff(values: StaffMember) {
    const id = values.id || nextStaffId();
    upsertStaffMember({
      ...values,
      id,
      tenant_id: values.tenant_id || staff[0]?.tenant_id || "",
      mfa_enabled: values.mfa_enabled !== false,
      status: values.status || "invited",
      role_id: values.role_id || roles[0]?.id || "",
      created_at: values.created_at || new Date().toISOString(),
    });
  }

  return (
    <div className="space-y-6">
      {/* Staff */}
      <section className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <div>
            <h2 className="text-[14px] font-medium text-fg">Staff</h2>
            <p className="text-[11px] text-fg-tertiary">
              {staff.length} {staff.length === 1 ? "member" : "members"} ·{" "}
              {staff.filter((s) => s.status === "active").length} active
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={openInvite}>
            <UserPlus className="size-3.5" />
            Invite member
          </Button>
        </header>
        <ul className="divide-y divide-hairline">
          {staff.map((s) => {
            const role = roles.find((r) => r.id === s.role_id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => openEdit(s)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                >
                  <div className="flex size-9 items-center justify-center rounded-full bg-surface-3 text-[12px] font-medium text-fg-muted">
                    {s.name
                      .split(/\s+/)
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-fg">{s.name}</span>
                      {s.status === "invited" && (
                        <Badge tone="warn" size="sm">Pending</Badge>
                      )}
                      {s.status === "suspended" && (
                        <Badge tone="danger" size="sm">Suspended</Badge>
                      )}
                      {s.mfa_enabled ? (
                        <Badge tone="ok" size="sm">
                          <Shield className="size-3" />
                          MFA
                        </Badge>
                      ) : (
                        <Badge tone="warn" size="sm">
                          <ShieldOff className="size-3" />
                          No MFA
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-fg-tertiary">
                      <Mail className="mr-1 inline size-3" />
                      {s.email}
                      {" · "}
                      {role?.name ?? "No role"}
                      {s.last_login_at && (
                        <>
                          {" · last login "}
                          {new Date(s.last_login_at).toLocaleDateString()}
                        </>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Roles + permission matrix */}
      <section className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <div>
            <h2 className="text-[14px] font-medium text-fg">Roles & permissions</h2>
            <p className="text-[11px] text-fg-tertiary">
              {roles.length} roles · click a permission cell to toggle
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => {
            const id = `role_runtime_${Date.now()}`;
            upsertRole({
              id,
              tenant_id: roles[0]?.tenant_id ?? "",
              name: "New role",
              description: "Custom role",
              permissions: [],
              is_system: false,
              sort_order: roles.length,
            });
          }}>
            <Plus className="size-3.5" />
            New role
          </Button>
        </header>
        <RolePermissionMatrix roles={roles} />
      </section>

      <RecordEditDialog<StaffMember>
        open={open}
        onOpenChange={setOpen}
        title={editing ? `Edit ${editing.name}` : "Invite a staff member"}
        description="Invited staff receive an email to set their password + enable MFA. Until activated they show as Pending."
        record={editing}
        fields={[
          ...STAFF_FIELDS.slice(0, 3),
          {
            key: "role_id",
            label: "Role",
            kind: "select",
            required: true,
            col: 2,
            options: roles.map((r) => ({ value: r.id, label: r.name })),
          },
          ...STAFF_FIELDS.slice(3),
        ]}
        onSave={handleSaveStaff}
        onDelete={editing ? (s) => deleteStaffMember(s.id) : undefined}
      />
    </div>
  );
}

function RolePermissionMatrix({ roles }: { roles: Role[] }) {
  const groups = Array.from(new Set(ALL_PERMISSIONS.map((p) => p.group)));

  function togglePerm(role: Role, perm: PermissionKey) {
    const has = role.permissions.includes(perm);
    updateRole(role.id, {
      permissions: has
        ? role.permissions.filter((p) => p !== perm)
        : [...role.permissions, perm],
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
