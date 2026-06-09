"use client";

import * as React from "react";
import Link from "next/link";
import { useTabUrlState } from "@/lib/use-tab-url-state";
import { anyApi } from "convex/server";
import {
  Users,
  CalendarRange,
  Clock,
  Clock4,
  DollarSign,
  ShieldCheck,
  Plus,
  AlertTriangle,
  UserPlus,
  Settings as SettingsIcon,
  ExternalLink,
  Lock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { ListFilterSelect } from "@/components/ui/list-filter-select";
import { PageShell } from "@/components/page-shell";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { RolesAndPermissions } from "@/components/staff/roles-matrix";
import { TimeClockSection } from "@/components/staff/time-clock-section";
import { PayrollSection } from "@/components/staff/payroll-section";
import { formatMoney } from "@/lib/mock-data";
import {
  approveTimeEntry,
  deleteShift,
  deleteTimeEntry,
  nextCertificationId,
  nextShiftId,
  nextStaffId,
  runPayroll,
  updateTimeEntry,
  upsertCertification,
  upsertShift,
  upsertStaffMember,
  useAiSettings,
  useCertifications,
  useExtractionDrafts,
  usePayrollRuns,
  usePaystubs,
  useRoles,
  useShifts,
  useStaff,
  useTimeEntries,
} from "@/lib/client-store";
import { useTenantMutation } from "@/lib/use-tenant-mutation";
import { useTenantQuery } from "@/lib/use-tenant-query";
import {
  approveDraft,
  persistFreshDraft,
  rejectDraft,
} from "@/lib/ai-extract-executor";
import { DropZone } from "@/components/ai/drop-zone";
import { DraftCard, type DraftField } from "@/components/ai/draft-card";
import { cn } from "@/lib/utils";
import type {
  Certification,
  ExtractionDraft,
  Shift,
  StaffMember,
  TimeEntry,
} from "@/lib/types";

/*
 * /staff — operational staffing surface. Same shell pattern as
 * /members and /services: left rail + content panel. 4 sections:
 *
 *   - Roster: staff list + click-to-edit detail
 *   - Schedule: this-week grid (days × staff)
 *   - Time cards: pending approval + run payroll
 *   - Certifications: tracked expirations with bucket chips
 *
 * Section state hydrates from `?section=` for deep-linking from the
 * dashboard Back-office KPIs.
 */

type SectionKey =
  | "onboarding"
  | "roster"
  | "schedule"
  | "timecards"
  | "time-clock"
  | "payroll"
  | "certifications"
  | "roles";

const NAV: {
  key: SectionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}[] = [
  {
    key: "onboarding",
    label: "Onboarding",
    icon: UserPlus,
    description:
      "Drop a new hire's DL + W-4 + offer letter — we parse the staff record.",
  },
  {
    key: "roster",
    label: "Roster",
    icon: Users,
    description: "Wage profiles, hire dates, mobile clock PIN.",
  },
  {
    key: "schedule",
    label: "Schedule",
    icon: CalendarRange,
    description: "This week's shifts by day + staff member.",
  },
  {
    key: "timecards",
    label: "Time cards",
    icon: Clock,
    description: "Pending approvals + run payroll.",
  },
  {
    key: "time-clock",
    label: "Time Clock",
    icon: Clock4,
    description:
      "Today's roster + recent entries. Audit-tracked manual adjust.",
  },
  {
    key: "payroll",
    label: "Payroll",
    icon: DollarSign,
    description:
      "Current period + paystub preview + close-and-export to your provider.",
  },
  {
    key: "certifications",
    label: "Certifications",
    icon: ShieldCheck,
    description: "First Aid, OSHA, marine safety — track expirations.",
  },
  {
    key: "roles",
    label: "Roles & access",
    icon: Lock,
    description: "Permissions matrix — what each role can do in the app.",
  },
];

function isStaffSection(v: string | null | undefined): v is SectionKey {
  return (
    v === "onboarding" ||
    v === "schedule" ||
    v === "timecards" ||
    v === "time-clock" ||
    v === "payroll" ||
    v === "certifications" ||
    v === "roster" ||
    v === "roles"
  );
}

export function StaffClient() {
  // `?tab=` is the canonical deep-link param across /members, /staff,
  // /ledger so external links (email, agent, Slack) hit the right
  // sub-section. Migrated from `?section=` — old link shapes degrade
  // to the default "roster" rather than crashing.
  const [section, setSection] = useTabUrlState<SectionKey>(
    "tab",
    isStaffSection,
    "roster",
  );
  const active = NAV.find((n) => n.key === section) ?? NAV[0];

  return (
    <PageShell title="Staff" description={active.description} width="wide">
      <div className="mb-5">
        <RentalsAsk
          placeholder="Ask the agent — e.g. 'who's clocked in?' or 'add Jamie Reyes as a dockhand at $22/hr'"
          suggestions={[
            "Who's clocked in right now?",
            "Add Jamie Reyes as a Dockhand at $22/hr",
            "Whose cert expires this month?",
            "Run payroll for the last 14 days",
          ]}
        />
      </div>
      <div
        className="grid gap-6"
        style={{ gridTemplateColumns: "200px minmax(0, 1fr)" }}
      >
        <nav
          aria-label="Staff sections"
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
          {section === "onboarding" && <OnboardingView />}
          {section === "roster" && <RosterView />}
          {section === "schedule" && <ScheduleView />}
          {section === "timecards" && <TimecardsView />}
          {section === "time-clock" && <TimeClockSection />}
          {section === "payroll" && <PayrollSection />}
          {section === "certifications" && <CertificationsView />}
          {section === "roles" && <RolesAndPermissions />}
        </div>
      </div>
    </PageShell>
  );
}

// ── Roster ────────────────────────────────────────────────────

// Convex shape of a staffMembers row — same field set as the mock
// `StaffMember` minus the wire-side renaming (`_id`/`tenantId`). The
// adapter below reshapes Convex docs back to the mock-friendly type so
// the rest of the view (Schedule, Timecards, Certifications) doesn't
// have to branch on data source. Optional fields mirror the schema
// extension shipped in this Phase 3+4 batch.
interface ConvexStaff {
  _id: string;
  tenantId: string;
  _creationTime?: number;
  clerkUserId?: string;
  name: string;
  email: string;
  phone?: string;
  role_id: string;
  status: StaffMember["status"];
  mfa_enabled: boolean;
  last_login_at?: string;
  default_position?: string;
  employment_type?: string;
  hourly_rate?: number;
  salary_annual?: number;
  mobile_clock_pin?: string;
  pto_hours_balance?: number;
}

function convexStaffToMock(rows: ConvexStaff[]): StaffMember[] {
  return rows.map((r) => ({
    id: r._id,
    tenant_id: r.tenantId,
    name: r.name,
    email: r.email,
    phone: r.phone,
    role_id: r.role_id,
    status: r.status,
    mfa_enabled: r.mfa_enabled,
    last_login_at: r.last_login_at,
    created_at: r._creationTime
      ? new Date(r._creationTime).toISOString()
      : new Date().toISOString(),
    default_position: r.default_position,
    employment_type:
      r.employment_type === "1099" ? "1099" : r.employment_type === "w2" ? "w2" : undefined,
    hourly_rate: r.hourly_rate,
    salary_annual: r.salary_annual,
    mobile_clock_pin: r.mobile_clock_pin,
    pto_hours_balance: r.pto_hours_balance,
  }));
}

const STAFF_EMPTY_ARGS = {} as const;

function RosterView() {
  // Mock subscription is unconditional so React's hook-order invariant
  // holds. `useTenantQuery` returns mock when Convex is offline, and
  // the live (tenant-scoped) doc list otherwise.
  const mockStaff = useStaff();
  const staff = useTenantQuery<StaffMember[], ConvexStaff[]>({
    mock: mockStaff,
    convexRef: anyApi.staff.list,
    convexArgs: STAFF_EMPTY_ARGS,
    convexAdapter: convexStaffToMock,
  });
  const roles = useRoles();
  const roleById = React.useMemo(
    () => new Map(roles.map((r) => [r.id, r])),
    [roles]
  );
  const [editing, setEditing] = React.useState<StaffMember | null>(null);
  const [creating, setCreating] = React.useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <p className="text-[12px] text-fg-tertiary">
          Click a row to edit wage profile, app role, and mobile clock PIN.
        </p>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" />
          New staff
        </Button>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        {/* Canonical header band: bg-surface-2 px-3 py-2 text-[10px]
            uppercase tracking-wide. Status badge sits last per column
            order convention. */}
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{
            gridTemplateColumns: "minmax(0, 2fr) 110px 110px 80px 90px 90px 80px",
          }}
        >
          <span>Name</span>
          <span>Position</span>
          <span>App role</span>
          <span title="W-2 (employee on payroll) or 1099 (contractor)">Type</span>
          <span>Pay rate</span>
          <span title="Paid time off — hours available">Time off</span>
          <span>Status</span>
        </div>
        {staff.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-fg-tertiary">
            No staff yet. Click <span className="font-medium text-fg-subtle">New staff</span> to add the first.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {staff.map((s) => (
              <li key={s.id} className="group relative">
                {/* Row click opens the inline editor (primary action). */}
                <button
                  type="button"
                  onClick={() => setEditing(s)}
                  className="grid w-full cursor-pointer items-center gap-x-3 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-2"
                  style={{
                    gridTemplateColumns: "minmax(0, 2fr) 110px 110px 80px 90px 90px 80px",
                  }}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-fg">{s.name}</div>
                    <div className="truncate text-[11px] text-fg-tertiary">{s.email}</div>
                  </div>
                  <span className="text-[12px] text-fg-subtle truncate">
                    {s.default_position ?? "—"}
                  </span>
                  <span className="text-[12px] text-fg-subtle truncate">
                    {roleById.get(s.role_id)?.name ?? "—"}
                  </span>
                  <span className="text-[11px] text-fg-subtle uppercase">
                    {s.employment_type ?? "—"}
                  </span>
                  <span className="money-display text-[13px] text-fg">
                    {s.salary_annual
                      ? `${formatMoney(s.salary_annual)}/yr`
                      : s.hourly_rate
                      ? `${formatMoney(s.hourly_rate)}/hr`
                      : "—"}
                  </span>
                  <span className="tabular text-[12px] text-fg-subtle">
                    {s.pto_hours_balance ?? 0}h
                  </span>
                  <Badge
                    tone={s.status === "active" ? "ok" : s.status === "invited" ? "info" : "neutral"}
                    size="sm"
                  >
                    {s.status}
                  </Badge>
                </button>
                {/* Secondary affordance — full profile detail page. */}
                <Link
                  href={`/staff/${s.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-[6px] p-1.5 text-fg-tertiary opacity-0 transition-opacity hover:bg-surface-3 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label="Open profile"
                  title="Open profile"
                >
                  <ExternalLink className="size-3" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(editing || creating) && (
        <StaffEditSheet
          staff={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

// Payload shape the StaffEditSheet's save handler emits — a fully
// stamped StaffMember (mock-shape) for create, or a (id, patch)
// envelope for edit. `useTenantMutation` routes each to mock or
// Convex via the args adapter. Edit and create branch on `editing`.
type StaffCreatePayload = StaffMember;
type StaffUpdatePayload = { id: string; patch: Partial<StaffMember> };

// Inline edit sheet — small enough that we don't use RecordEditDialog here
function StaffEditSheet({
  staff,
  onClose,
}: {
  staff: StaffMember | null;
  onClose: () => void;
}) {
  const [name, setName] = React.useState(staff?.name ?? "");
  const [email, setEmail] = React.useState(staff?.email ?? "");
  const [phone, setPhone] = React.useState(staff?.phone ?? "");
  const [position, setPosition] = React.useState(staff?.default_position ?? "");
  const [employmentType, setEmploymentType] = React.useState(
    staff?.employment_type ?? "w2"
  );
  const [hourlyRate, setHourlyRate] = React.useState(
    staff?.hourly_rate ? String(staff.hourly_rate) : ""
  );
  const [salaryAnnual, setSalaryAnnual] = React.useState(
    staff?.salary_annual ? String(staff.salary_annual) : ""
  );
  const [pin, setPin] = React.useState(staff?.mobile_clock_pin ?? "");
  const [ptoBalance, setPtoBalance] = React.useState(
    staff?.pto_hours_balance ? String(staff.pto_hours_balance) : "0"
  );
  const roles = useRoles();
  const [roleId, setRoleId] = React.useState(staff?.role_id ?? roles[0]?.id ?? "");
  const [staffStatus, setStaffStatus] = React.useState<StaffMember["status"]>(
    staff?.status ?? "invited"
  );
  const [mfa, setMfa] = React.useState(staff?.mfa_enabled ?? false);

  // Phase 4 — write routing. Mock fn calls `upsertStaffMember`
  // (the local store handles both create + edit by id presence).
  // Convex side splits create vs update — we branch on `editing`
  // (i.e. the `staff` prop) at the callsite. The args adapter maps
  // the mock shape onto each resolver's args.
  const createStaff = useTenantMutation<StaffCreatePayload, void>({
    mock: (s) => upsertStaffMember(s),
    convexRef: anyApi.staff.create,
    convexArgsAdapter: (s) => ({
      name: s.name,
      email: s.email,
      phone: s.phone,
      // role_id is a Convex Id<"roles"> on the resolver — when the
      // operator skips role pick the local mock string id is also
      // empty; convex/staff.ts auto-picks the first role for the
      // tenant in that case.
      ...(s.role_id ? { role_id: s.role_id } : {}),
      status: s.status,
      mfa_enabled: s.mfa_enabled,
      default_position: s.default_position,
      employment_type: s.employment_type,
      hourly_rate: s.hourly_rate,
      salary_annual: s.salary_annual,
      mobile_clock_pin: s.mobile_clock_pin,
      pto_hours_balance: s.pto_hours_balance,
    }),
  });
  const updateStaff = useTenantMutation<StaffUpdatePayload, void>({
    mock: ({ id, patch }) => {
      // Mock-side: replicate upsert semantics by reconstructing the
      // record. The caller passes the full record in `patch` since the
      // sheet collects every field on save.
      upsertStaffMember({ ...(staff as StaffMember), ...patch, id });
    },
    convexRef: anyApi.staff.update,
    convexArgsAdapter: ({ id, patch }) => ({ id, patch }),
  });

  function save() {
    if (!name.trim() || !email.trim()) return;
    const now = new Date().toISOString();
    const stamped: StaffMember = {
      id: staff?.id ?? nextStaffId(),
      tenant_id: staff?.tenant_id ?? "",   // mutator stamps if empty
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      role_id: roleId || staff?.role_id || "",
      status: staffStatus,
      mfa_enabled: mfa,
      created_at: staff?.created_at ?? now,
      default_position: position.trim() || undefined,
      employment_type: employmentType as "w2" | "1099",
      hourly_rate: hourlyRate ? Number(hourlyRate) : undefined,
      salary_annual: salaryAnnual ? Number(salaryAnnual) : undefined,
      mobile_clock_pin: pin || undefined,
      pto_hours_balance: Number(ptoBalance) || 0,
      ot_multiplier: staff?.ot_multiplier ?? 1.5,
      payment_method: staff?.payment_method ?? "direct_deposit",
      bank_account_last4: staff?.bank_account_last4,
      bank_routing_last4: staff?.bank_routing_last4,
      hire_date: staff?.hire_date,
      pto_accrual_hours_per_period: staff?.pto_accrual_hours_per_period,
      last_login_at: staff?.last_login_at,
    };
    // Fire-and-forget — read hook picks up the update on next sync.
    if (staff) {
      const { id: _id, tenant_id: _t, created_at: _c, ...patch } = stamped;
      void _id; void _t; void _c;
      void updateStaff({ id: stamped.id, patch });
    } else {
      void createStaff(stamped);
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[520px] rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-fg">
          {staff ? `Edit ${staff.name}` : "New staff member"}
        </h3>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Name *" col={2}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Email *" col={2}>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Phone">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Position">
            <input
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="Dockhand"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="App role (permissions)">
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            >
              <option value="">— No app access —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Login status">
            <select
              value={staffStatus}
              onChange={(e) => setStaffStatus(e.target.value as StaffMember["status"])}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            >
              <option value="invited">Invited (pending)</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </Field>
          <Field label="Employment type">
            <select
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value as "w2" | "1099")}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            >
              <option value="w2">W-2 Employee</option>
              <option value="1099">1099 Contractor</option>
            </select>
          </Field>
          <Field label="Mobile clock PIN (4 digits)">
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              maxLength={4}
              placeholder="1234"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] font-mono tracking-widest text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Hourly rate ($)">
            <input
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              inputMode="decimal"
              placeholder="22"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Annual salary ($)">
            <input
              value={salaryAnnual}
              onChange={(e) => setSalaryAnnual(e.target.value)}
              inputMode="decimal"
              placeholder="68000"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="PTO balance (hrs)">
            <input
              value={ptoBalance}
              onChange={(e) => setPtoBalance(e.target.value)}
              inputMode="numeric"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="" col={2}>
            <label className="mt-1 flex items-center gap-2 text-[12px] text-fg">
              <input
                type="checkbox"
                checked={mfa}
                onChange={(e) => setMfa(e.target.checked)}
              />
              MFA enabled — require 2-factor at login
            </label>
          </Field>
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
            disabled={!name.trim() || !email.trim()}
            className={cn(
              "rounded-[10px] px-3 py-2 text-[13px] font-medium transition-colors",
              name.trim() && email.trim()
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

function Field({
  label,
  col = 1,
  children,
}: {
  label: string;
  col?: 1 | 2;
  children: React.ReactNode;
}) {
  return (
    <div className={col === 2 ? "col-span-2" : ""}>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// ── Schedule (weekly grid) ───────────────────────────────────

function ScheduleView() {
  const staff = useStaff();
  const shifts = useShifts();
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Shift | null>(null);

  // Build days of current week (Mon → Sun)
  const days = React.useMemo(() => {
    const now = new Date();
    const day = now.getDay(); // 0 = Sun
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  }, []);

  function shiftsFor(staffId: string, day: Date) {
    const key = day.toISOString().slice(0, 10);
    return shifts.filter(
      (sh) => sh.staff_id === staffId && sh.start_at.slice(0, 10) === key
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <p className="text-[12px] text-fg-tertiary">
          This week. Click a cell to add a shift, click an existing shift to edit.
        </p>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" />
          New shift
        </Button>
      </div>

      <div className="overflow-x-auto rounded-[12px] border border-hairline bg-surface-1">
        <table className="w-full min-w-[760px] text-[12px]">
          <thead className="bg-surface-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
            <tr>
              <th className="px-3 py-2 text-left">Staff</th>
              {days.map((d) => (
                <th key={d.toISOString()} className="px-2 py-2 text-left">
                  {d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-t border-hairline">
                <td className="px-3 py-2 align-top">
                  <div className="text-[12px] font-medium text-fg">{s.name}</div>
                  <div className="text-[10px] text-fg-tertiary">{s.default_position ?? ""}</div>
                </td>
                {days.map((d) => {
                  const cellShifts = shiftsFor(s.id, d);
                  return (
                    <td key={d.toISOString()} className="px-2 py-2 align-top">
                      {cellShifts.length === 0 ? (
                        <span className="text-fg-tertiary">—</span>
                      ) : (
                        <div className="space-y-1">
                          {cellShifts.map((sh) => (
                            <ShiftCard
                              key={sh.id}
                              shift={sh}
                              onClick={() => setEditing(sh)}
                            />
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <NewShiftSheet
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          staff={staff}
          shift={editing}
        />
      )}
    </div>
  );
}

function ShiftCard({ shift, onClick }: { shift: Shift; onClick?: () => void }) {
  const tone =
    shift.status === "in_progress"
      ? "border-status-info/40 bg-status-info/10 text-status-info"
      : shift.status === "completed"
      ? "border-status-ok/30 bg-status-ok/10 text-status-ok"
      : shift.status === "missed"
      ? "border-status-danger/30 bg-status-danger/10 text-status-danger"
      : "border-hairline bg-surface-2 text-fg-subtle";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-[6px] border px-1.5 py-1 text-left text-[10px] transition-opacity hover:opacity-80",
        tone
      )}
    >
      <div className="font-medium">
        {new Date(shift.start_at).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })}
        {" – "}
        {new Date(shift.end_at).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })}
      </div>
      <div className="truncate opacity-80">{shift.position}</div>
    </button>
  );
}

/** New + edit. When `shift` is non-null, the form pre-fills and upserts back into the same id. */
function NewShiftSheet({
  onClose,
  staff,
  shift,
}: {
  onClose: () => void;
  staff: StaffMember[];
  shift?: Shift | null;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const initDate = shift ? shift.start_at.slice(0, 10) : today;
  const initStart = shift
    ? new Date(shift.start_at).toTimeString().slice(0, 5)
    : "08:00";
  const initEnd = shift
    ? new Date(shift.end_at).toTimeString().slice(0, 5)
    : "17:00";

  const [staffId, setStaffId] = React.useState(shift?.staff_id ?? staff[0]?.id ?? "");
  const [date, setDate] = React.useState(initDate);
  const [startHHMM, setStartHHMM] = React.useState(initStart);
  const [endHHMM, setEndHHMM] = React.useState(initEnd);
  const [position, setPosition] = React.useState(shift?.position ?? "Dockhand");

  const staffOptions: ComboboxOption[] = staff.map((s) => ({
    value: s.id,
    label: s.name,
    hint: s.default_position ?? undefined,
  }));

  function save() {
    if (!staffId || !date) return;
    const start_at = `${date}T${startHHMM}:00`;
    const end_at = `${date}T${endHHMM}:00`;
    const now = new Date().toISOString();
    upsertShift({
      id: shift?.id ?? nextShiftId(),
      tenant_id: shift?.tenant_id ?? "",
      staff_id: staffId,
      start_at: new Date(start_at).toISOString(),
      end_at: new Date(end_at).toISOString(),
      position: position.trim() || "Dockhand",
      status: shift?.status ?? "scheduled",
      notes: shift?.notes,
      created_at: shift?.created_at ?? now,
      updated_at: now,
    });
    onClose();
  }

  function remove() {
    if (!shift) return;
    if (!window.confirm("Delete this shift?")) return;
    deleteShift(shift.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[440px] rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-fg">{shift ? "Edit shift" : "New shift"}</h3>
        <div className="mt-4 space-y-3">
          <Field label="Staff *">
            <Combobox
              value={staffId}
              onChange={setStaffId}
              options={staffOptions}
              placeholder="Pick a staff member"
              searchPlaceholder="Search staff…"
            />
          </Field>
          <Field label="Date *">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <input
                type="time"
                value={startHHMM}
                onChange={(e) => setStartHHMM(e.target.value)}
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
              />
            </Field>
            <Field label="End">
              <input
                type="time"
                value={endHHMM}
                onChange={(e) => setEndHHMM(e.target.value)}
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
              />
            </Field>
          </div>
          <Field label="Position">
            <input
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          {shift ? (
            <button
              type="button"
              onClick={remove}
              className="rounded-[8px] px-3 py-1.5 text-[12px] text-status-danger hover:bg-status-danger/10"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
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
              disabled={!staffId || !date}
              className={cn(
                "rounded-[10px] px-3 py-2 text-[13px] font-medium transition-colors",
                staffId && date
                  ? "bg-primary text-on-primary hover:bg-primary-hover"
                  : "cursor-not-allowed bg-surface-3 text-fg-tertiary"
              )}
            >
              {shift ? "Save changes" : "Add shift"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Time cards ───────────────────────────────────────────────

function TimecardsView() {
  const allEntries = useTimeEntries();
  const staff = useStaff();
  const settings = useAiSettings();
  const staffById = React.useMemo(
    () => new Map(staff.map((s) => [s.id, s])),
    [staff]
  );

  const pending = allEntries.filter(
    (t) => t.clock_out_at && !t.approved_at
  );

  // Anomaly classifier — only used when settings.timecard_anomalies_only.
  function reasonsFor(t: TimeEntry): string[] {
    const reasons: string[] = [];
    const hrs = t.calculated_hours ?? 0;
    if (hrs > settings.timecard_max_shift_hours) {
      reasons.push(
        `Shift > ${settings.timecard_max_shift_hours} hrs (${hrs.toFixed(2)})`
      );
    }
    if (
      hrs > settings.timecard_require_break_after_hours &&
      // No break-tracking column in the prototype — we approximate by
      // flagging any shift >= the threshold for review when the rule
      // is on.
      hrs >= settings.timecard_require_break_after_hours + 0.5
    ) {
      reasons.push(`No break logged on a ${hrs.toFixed(2)}-hr shift`);
    }
    if (!t.clock_out_at) {
      reasons.push("Open shift — never clocked out");
    }
    return reasons;
  }

  const { anomalies, clean } = React.useMemo(() => {
    if (!settings.timecard_anomalies_only) {
      return { anomalies: pending, clean: [] as TimeEntry[] };
    }
    const a: TimeEntry[] = [];
    const c: TimeEntry[] = [];
    for (const t of pending) {
      if (reasonsFor(t).length > 0) a.push(t);
      else c.push(t);
    }
    return { anomalies: a, clean: c };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, settings.timecard_anomalies_only, settings.timecard_max_shift_hours, settings.timecard_require_break_after_hours]);

  function autoApproveClean() {
    const approverId = staff[0]?.id ?? "";
    if (!approverId) return;
    for (const t of clean) approveTimeEntry(t.id, approverId);
  }

  const [editingEntry, setEditingEntry] = React.useState<TimeEntry | null>(null);
  const approvedUnpaid = allEntries.filter(
    (t) => t.approved_at && !t.payroll_run_id
  );
  const totalsByStaff = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const t of approvedUnpaid) {
      m.set(t.staff_id, (m.get(t.staff_id) ?? 0) + (t.calculated_hours ?? 0));
    }
    return m;
  }, [approvedUnpaid]);

  const [running, setRunning] = React.useState(false);

  function doRunPayroll() {
    // Default period: last 14 days
    const now = new Date();
    const periodEnd = now.toISOString().slice(0, 10);
    const start = new Date(now);
    start.setDate(start.getDate() - 14);
    const periodStart = start.toISOString().slice(0, 10);
    if (!window.confirm(`Run payroll for ${periodStart} → ${periodEnd}? Approved time cards in this window will be locked.`)) return;
    setRunning(true);
    const result = runPayroll({ period_start: periodStart, period_end: periodEnd });
    setRunning(false);
    window.alert(
      `Posted payroll run ${result.runId.slice(-6)} — ${formatMoney(result.totalGross)} gross.`
    );
  }

  return (
    <div className="space-y-6">
      {/* Pending approval — when anomalies_only is on, split */}
      <section>
        <div className="mb-2 flex items-end justify-between">
          <h2 className="text-[14px] font-medium text-fg">
            {settings.timecard_anomalies_only
              ? `Needs review — ${anomalies.length} ${anomalies.length === 1 ? "anomaly" : "anomalies"}`
              : "Pending approval"}
          </h2>
          {settings.timecard_anomalies_only && clean.length > 0 && (
            <Button variant="primary" size="sm" onClick={autoApproveClean}>
              Auto-approve {clean.length} clean
            </Button>
          )}
          {!settings.timecard_anomalies_only && (
            <span className="text-[11px] text-fg-tertiary">
              {pending.length} entr{pending.length === 1 ? "y" : "ies"}
            </span>
          )}
        </div>

        {anomalies.length === 0 ? (
          <EmptyCard
            body={
              settings.timecard_anomalies_only
                ? "No anomalies. Clean cards can be auto-approved."
                : "No pending time cards. Everything's been approved."
            }
          />
        ) : (
          <ul className="divide-y divide-hairline rounded-[12px] border border-hairline bg-surface-1">
            {anomalies.map((t) => {
              const reasons = reasonsFor(t);
              return (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
                >
                  <button
                    type="button"
                    onClick={() => setEditingEntry(t)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <div className="text-[13px] font-medium text-fg">
                        {staffById.get(t.staff_id)?.name ?? t.staff_id}
                      </div>
                      {reasons.length > 0 && (
                        <Badge tone="warn" size="sm">
                          {reasons.length} flag{reasons.length === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-fg-tertiary">
                      {new Date(t.clock_in_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}{" "}
                      →{" "}
                      {t.clock_out_at &&
                        new Date(t.clock_out_at).toLocaleString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      {" · "}
                      {t.calculated_hours?.toFixed(2)}h
                      {" · "}
                      <span className="uppercase tracking-wide">{t.source}</span>
                    </div>
                    {reasons.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-[11px] text-status-warn">
                        {reasons.map((r) => (
                          <li key={r}>• {r}</li>
                        ))}
                      </ul>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const approverId = staff[0]?.id ?? "";
                      if (approverId) approveTimeEntry(t.id, approverId);
                    }}
                    className="rounded-[8px] bg-primary px-3 py-1.5 text-[12px] font-medium text-on-primary hover:bg-primary-hover"
                  >
                    Approve anyway
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {settings.timecard_anomalies_only && clean.length > 0 && (
          <details className="mt-3 rounded-[12px] border border-hairline bg-surface-1">
            <summary className="cursor-pointer px-4 py-2.5 text-[12px] font-medium text-fg-subtle hover:text-fg">
              Clean cards — {clean.length} waiting for auto-approve
            </summary>
            <ul className="divide-y divide-hairline border-t border-hairline">
              {clean.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setEditingEntry(t)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[12px] transition-colors hover:bg-surface-2"
                  >
                    <span className="text-fg">
                      {staffById.get(t.staff_id)?.name ?? t.staff_id}
                    </span>
                    <span className="tabular-nums text-fg-subtle">
                      {t.calculated_hours?.toFixed(2)}h
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* Approved + ready for payroll */}
      <section>
        <div className="mb-2 flex items-end justify-between">
          <h2 className="text-[14px] font-medium text-fg">Approved, ready for payroll</h2>
          <Button
            variant="primary"
            size="sm"
            onClick={doRunPayroll}
            disabled={running || (totalsByStaff.size === 0 && staff.every((s) => !s.salary_annual))}
          >
            <Clock className="size-3.5" />
            Run payroll (last 14 days)
          </Button>
        </div>
        {totalsByStaff.size === 0 ? (
          <EmptyCard body="No approved unpaid hours. (Salaried staff still appear on the next run.)" />
        ) : (
          <ul className="divide-y divide-hairline rounded-[12px] border border-hairline bg-surface-1">
            {Array.from(totalsByStaff.entries()).map(([sid, hours]) => {
              const s = staffById.get(sid);
              const rate = s?.hourly_rate ?? 0;
              return (
                <li
                  key={sid}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-fg">{s?.name ?? sid}</div>
                    <div className="text-[11px] text-fg-tertiary">
                      {hours.toFixed(2)}h × {formatMoney(rate)}/hr
                    </div>
                  </div>
                  <span className="money-display text-[14px] text-fg">
                    {formatMoney(hours * rate)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <RecentPayrollRuns />

      {editingEntry && (
        <TimeEntryEditSheet
          entry={editingEntry}
          staffName={staffById.get(editingEntry.staff_id)?.name ?? editingEntry.staff_id}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </div>
  );
}

/**
 * Edit a time entry inline. Lets the operator correct a missed punch
 * or fix miscounted hours before approval. Locked if the entry has
 * already been picked up by a payroll run (read-only summary then).
 */
function TimeEntryEditSheet({
  entry,
  staffName,
  onClose,
}: {
  entry: TimeEntry;
  staffName: string;
  onClose: () => void;
}) {
  const locked = Boolean(entry.payroll_run_id);
  const [clockIn, setClockIn] = React.useState(
    new Date(entry.clock_in_at).toISOString().slice(0, 16)
  );
  const [clockOut, setClockOut] = React.useState(
    entry.clock_out_at ? new Date(entry.clock_out_at).toISOString().slice(0, 16) : ""
  );
  const [notes, setNotes] = React.useState(entry.notes ?? "");

  function save() {
    if (locked) return;
    const patch: Partial<TimeEntry> = {
      clock_in_at: new Date(clockIn).toISOString(),
      notes: notes.trim() || undefined,
    };
    if (clockOut) patch.clock_out_at = new Date(clockOut).toISOString();
    updateTimeEntry(entry.id, patch);
    onClose();
  }

  function remove() {
    if (locked) return;
    if (!window.confirm("Delete this time entry?")) return;
    deleteTimeEntry(entry.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[440px] rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-fg">Edit time entry</h3>
        <p className="mt-0.5 text-[12px] text-fg-subtle">
          {staffName}
          {locked && (
            <span className="ml-2 inline-flex items-center rounded-full bg-status-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-status-warn">
              Locked — paid via payroll
            </span>
          )}
        </p>

        <div className="mt-4 space-y-3">
          <Field label="Clock in">
            <input
              type="datetime-local"
              value={clockIn}
              onChange={(e) => setClockIn(e.target.value)}
              disabled={locked}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none disabled:opacity-60"
            />
          </Field>
          <Field label="Clock out">
            <input
              type="datetime-local"
              value={clockOut}
              onChange={(e) => setClockOut(e.target.value)}
              disabled={locked}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none disabled:opacity-60"
            />
          </Field>
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={locked}
              rows={2}
              placeholder="e.g. Corrected missed punch."
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none disabled:opacity-60"
            />
          </Field>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          {!locked ? (
            <button
              type="button"
              onClick={remove}
              className="rounded-[8px] px-3 py-1.5 text-[12px] text-status-danger hover:bg-status-danger/10"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[8px] px-3 py-1.5 text-[13px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              {locked ? "Close" : "Cancel"}
            </button>
            {!locked && (
              <button
                type="button"
                onClick={save}
                className="rounded-[10px] bg-primary px-3 py-2 text-[13px] font-medium text-on-primary hover:bg-primary-hover"
              >
                Save changes
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecentPayrollRuns() {
  const runs = usePayrollRuns();
  const stubs = usePaystubs();
  const staff = useStaff();
  const staffById = React.useMemo(
    () => new Map(staff.map((s) => [s.id, s])),
    [staff]
  );
  if (runs.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-[14px] font-medium text-fg">Recent runs</h2>
      <ul className="space-y-2">
        {runs
          .slice()
          .sort((a, b) => (a.pay_date < b.pay_date ? 1 : -1))
          .slice(0, 3)
          .map((r) => {
            const runStubs = stubs.filter((p) => p.payroll_run_id === r.id);
            return (
              <li key={r.id} className="rounded-[12px] border border-hairline bg-surface-1 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12px] text-fg-subtle">
                    Run {r.id.slice(-6)} · {r.period_start} → {r.period_end} · paid {r.pay_date}
                  </div>
                  <div className="money-display text-[14px] text-fg">
                    {formatMoney(r.total_gross)}
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-fg-tertiary">
                  {runStubs.length} paystub{runStubs.length === 1 ? "" : "s"}:{" "}
                  {runStubs
                    .map((p) => `${staffById.get(p.staff_id)?.name ?? p.staff_id} ${formatMoney(p.gross)}`)
                    .join(" · ")}
                </div>
              </li>
            );
          })}
      </ul>
    </section>
  );
}

// ── Certifications ───────────────────────────────────────────

type CertBucket = "all" | "current" | "expiring" | "expired";

function CertificationsView() {
  const certs = useCertifications();
  const staff = useStaff();
  const settings = useAiSettings();
  const certDrafts = useExtractionDrafts("certification");
  const pendingCertDrafts = certDrafts.filter((d) => d.status === "pending");
  const staffById = React.useMemo(
    () => new Map(staff.map((s) => [s.id, s])),
    [staff]
  );
  const [bucket, setBucket] = React.useState<CertBucket>("all");
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Certification | null>(null);

  function bucketOf(c: Certification): CertBucket {
    if (!c.expires_at) return "current";
    const expiresMs = new Date(c.expires_at).getTime();
    const days = Math.round((expiresMs - Date.now()) / 86_400_000);
    if (days < 0) return "expired";
    if (days <= 30) return "expiring";
    return "current";
  }

  const filtered = bucket === "all" ? certs : certs.filter((c) => bucketOf(c) === bucket);
  const counts = {
    all: certs.length,
    current: certs.filter((c) => bucketOf(c) === "current").length,
    expiring: certs.filter((c) => bucketOf(c) === "expiring").length,
    expired: certs.filter((c) => bucketOf(c) === "expired").length,
  };

  return (
    <div className="space-y-4">
      {settings.certs_photo_intake_enabled && (
        <div className="space-y-3">
          <DropZone
            module="certification"
            onDraftsCreated={(results) => {
              for (const { draft, file } of results) {
                persistFreshDraft(draft, file);
              }
            }}
          />
          {pendingCertDrafts.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
                Awaiting review — {pendingCertDrafts.length}
              </div>
              {pendingCertDrafts.map((d) => (
                <CertDraftCard key={d.id} draft={d} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Canonical toolbar pill — ListFilterSelect with live counts in
          the labels matches the Bookings / Members / Rentals pattern. */}
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-surface-1 p-2">
        <ListFilterSelect
          value={bucket}
          onChange={(v) => setBucket(v as CertBucket)}
          label="Status"
          options={[
            { value: "all", label: `All · ${counts.all}` },
            { value: "current", label: `Current · ${counts.current}` },
            { value: "expiring", label: `Expiring · ${counts.expiring}` },
            { value: "expired", label: `Expired · ${counts.expired}` },
          ]}
        />
        <Button variant="primary" size="sm" className="ml-auto" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" />
          New cert
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyCard body="Nothing in this bucket." />
      ) : (
        <ul className="divide-y divide-hairline rounded-[12px] border border-hairline bg-surface-1">
          {filtered.map((c) => {
            const b = bucketOf(c);
            const tone: "ok" | "warn" | "danger" =
              b === "current" ? "ok" : b === "expiring" ? "warn" : "danger";
            const days = c.expires_at
              ? Math.round((new Date(c.expires_at).getTime() - Date.now()) / 86_400_000)
              : null;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setEditing(c)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-fg">{c.name}</span>
                      <Badge tone={tone} size="sm">
                        {b === "current"
                          ? "Current"
                          : b === "expiring"
                          ? `Expiring · ${days}d`
                          : `Expired · ${Math.abs(days ?? 0)}d ago`}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-fg-tertiary">
                      {staffById.get(c.staff_id)?.name ?? c.staff_id}
                      {c.issuer ? ` · ${c.issuer}` : ""}
                      {c.expires_at ? ` · expires ${c.expires_at}` : " · no expiration"}
                    </div>
                  </div>
                  {b !== "current" && <AlertTriangle className="size-3.5 text-status-warn" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {(creating || editing) && (
        <NewCertSheet
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          staff={staff}
          cert={editing}
        />
      )}
    </div>
  );
}

/**
 * Used for both new + edit. When `cert` is non-null, the sheet
 * pre-fills from it and upserts back into the same id; when null,
 * we mint a new id.
 */
function NewCertSheet({
  onClose,
  staff,
  cert,
}: {
  onClose: () => void;
  staff: StaffMember[];
  cert?: Certification | null;
}) {
  const [staffId, setStaffId] = React.useState(cert?.staff_id ?? staff[0]?.id ?? "");
  const [name, setName] = React.useState(cert?.name ?? "");
  const [issuer, setIssuer] = React.useState(cert?.issuer ?? "");
  const [issuedAt, setIssuedAt] = React.useState(cert?.issued_at ?? new Date().toISOString().slice(0, 10));
  const [expiresAt, setExpiresAt] = React.useState(cert?.expires_at ?? "");
  const [docUrl, setDocUrl] = React.useState(cert?.document_url ?? "");

  const staffOptions: ComboboxOption[] = staff.map((s) => ({
    value: s.id,
    label: s.name,
    hint: s.default_position ?? undefined,
  }));

  function save() {
    if (!staffId || !name.trim() || !issuedAt) return;
    upsertCertification({
      id: cert?.id ?? nextCertificationId(),
      tenant_id: cert?.tenant_id ?? "",
      staff_id: staffId,
      name: name.trim(),
      issuer: issuer.trim() || undefined,
      issued_at: issuedAt,
      expires_at: expiresAt || undefined,
      document_url: docUrl.trim() || undefined,
      attachment_ids: cert?.attachment_ids,
      extracted_from_draft_id: cert?.extracted_from_draft_id,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[440px] rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-fg">{cert ? "Edit certification" : "New certification"}</h3>
        <div className="mt-4 space-y-3">
          <Field label="Staff *">
            <Combobox value={staffId} onChange={setStaffId} options={staffOptions} placeholder="Pick a staff member" />
          </Field>
          <Field label="Name *">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="First Aid / CPR"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Issuer">
            <input
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder="American Red Cross"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Issued *">
              <input
                type="date"
                value={issuedAt}
                onChange={(e) => setIssuedAt(e.target.value)}
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
              />
            </Field>
            <Field label="Expires">
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
              />
            </Field>
          </div>
          <Field label="Document URL">
            <input
              value={docUrl}
              onChange={(e) => setDocUrl(e.target.value)}
              placeholder="https://…"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
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
            disabled={!staffId || !name.trim() || !issuedAt}
            className={cn(
              "rounded-[10px] px-3 py-2 text-[13px] font-medium transition-colors",
              staffId && name.trim() && issuedAt
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

function EmptyCard({ body }: { body: string }) {
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 px-4 py-8 text-center text-[12px] text-fg-tertiary">
      {body}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Onboarding — drop the new hire's doc pack, get a staff draft
// ────────────────────────────────────────────────────────────

function OnboardingView() {
  const settings = useAiSettings();
  const drafts = useExtractionDrafts("staff_onboarding");
  const pending = drafts.filter((d) => d.status === "pending");
  const decided = drafts.filter(
    (d) => d.status === "approved" || d.status === "rejected"
  );

  if (!settings.staff_onboarding_doc_intake_enabled) {
    return (
      <div className="rounded-[12px] border border-hairline bg-surface-1 p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-status-warn/15 p-2 text-status-warn">
            <SettingsIcon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-fg">
              Doc-pack onboarding isn&apos;t enabled yet
            </div>
            <p className="mt-1 text-[12px] text-fg-subtle">
              Enable it from the onboarding checklist to drop a new hire&apos;s
              DL + W-4 + offer letter and have the staff record + wage profile
              created automatically.
            </p>
            <Link
              href="/onboarding"
              className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
            >
              Open onboarding →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DropZone
        module="staff_onboarding"
        onDraftsCreated={(results) => {
          for (const { draft, file } of results) {
            persistFreshDraft(draft, file);
          }
        }}
      />

      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          Awaiting review
          {pending.length > 0 && (
            <span className="ml-2 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-normal text-fg-subtle">
              {pending.length}
            </span>
          )}
        </div>
        {pending.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-hairline px-4 py-6 text-center text-[12px] text-fg-tertiary">
            Drop a doc pack above and we&apos;ll stage the staff record here.
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((d) => (
              <StaffDraftCard key={d.id} draft={d} />
            ))}
          </div>
        )}
      </div>

      {decided.length > 0 && (
        <details className="rounded-[12px] border border-hairline bg-surface-1">
          <summary className="cursor-pointer px-4 py-2.5 text-[12px] font-medium text-fg-subtle hover:text-fg">
            History — {decided.length} reviewed
          </summary>
          <div className="space-y-3 border-t border-hairline p-3">
            {decided.map((d) => {
              const a = d.staged_actions[0] as Record<string, unknown>;
              return (
                <div
                  key={d.id}
                  className="rounded-[10px] border border-hairline bg-surface-2/40 px-3 py-2 text-[12px]"
                >
                  <span className="font-medium text-fg">
                    {String(a.name ?? "—")}
                  </span>
                  <span className="ml-2 text-fg-subtle">
                    {String(a.position ?? "")}
                  </span>
                  <Badge
                    tone={d.status === "approved" ? "ok" : "danger"}
                    size="sm"
                    className="ml-2"
                  >
                    {d.status}
                  </Badge>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

function StaffDraftCard({ draft }: { draft: ExtractionDraft }) {
  const a = draft.staged_actions[0] as Record<string, unknown>;
  const isHourly = typeof a.hourly_rate === "number";

  const fields: DraftField[] = [
    { key: "name", label: "Name", value: String(a.name ?? "—"), editable: true },
    { key: "position", label: "Position", value: String(a.position ?? "—"), editable: true },
    { key: "employment_type", label: "Employment", value: String(a.employment_type ?? "w2") },
    isHourly
      ? { key: "hourly_rate", label: "Hourly rate", value: Number(a.hourly_rate ?? 0), money: true, editable: true }
      : { key: "salary_annual", label: "Salary", value: Number(a.salary_annual ?? 0), money: true, editable: true },
    { key: "email", label: "Email", value: String(a.email ?? "—"), editable: true },
    { key: "phone", label: "Phone", value: String(a.phone ?? "—"), editable: true },
    { key: "hire_date", label: "Hire date", value: String(a.hire_date ?? "—"), editable: true },
    { key: "address_line1", label: "Address", value: String(a.address_line1 ?? "—") },
  ];

  return (
    <DraftCard
      draft={draft}
      title={`New hire — ${String(a.name ?? "(unnamed)")}`}
      subtitle={`${String(a.position ?? "Dockhand")} · ${String(a.employment_type ?? "w2").toUpperCase()}`}
      fields={fields}
      onApprove={() => approveDraft(draft.id)}
      onReject={() => rejectDraft(draft.id)}
      primaryActionLabel="Approve & create staff"
    />
  );
}

function CertDraftCard({ draft }: { draft: ExtractionDraft }) {
  const a = draft.staged_actions[0] as Record<string, unknown>;
  const fields: DraftField[] = [
    { key: "holder_name", label: "Holder", value: String(a.holder_name ?? "—"), editable: true },
    { key: "cert_name", label: "Cert", value: String(a.cert_name ?? "—"), editable: true },
    { key: "issuer", label: "Issuer", value: String(a.issuer ?? "—") },
    { key: "issued_at", label: "Issued", value: String(a.issued_at ?? "—") },
    { key: "expires_at", label: "Expires", value: String(a.expires_at ?? "—"), editable: true },
  ];
  return (
    <DraftCard
      draft={draft}
      title={`${String(a.cert_name ?? "Certification")} — ${String(a.holder_name ?? "")}`}
      fields={fields}
      onApprove={() => approveDraft(draft.id)}
      onReject={() => rejectDraft(draft.id)}
      primaryActionLabel="Approve & log cert"
    />
  );
}
