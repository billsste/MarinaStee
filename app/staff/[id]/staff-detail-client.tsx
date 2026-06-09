"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Mail, Phone, Calendar, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/page-shell";
import { formatMoney } from "@/lib/mock-data";
import {
  useCertificationsForStaff,
  usePaystubs,
  useShiftsForStaff,
  useStaff,
  useTimeEntriesForStaff,
} from "@/lib/client-store";

/*
 * Staff detail — read-only profile view + recent activity. Editing
 * wage profile happens via the roster's edit sheet so we don't
 * duplicate the form here.
 */
export function StaffDetailClient({ id }: { id: string }) {
  const staff = useStaff();
  const member = staff.find((s) => s.id === id);
  const shifts = useShiftsForStaff(id);
  const timeEntries = useTimeEntriesForStaff(id);
  const certs = useCertificationsForStaff(id);
  const allStubs = usePaystubs();
  const myStubs = allStubs.filter((p) => p.staff_id === id);

  if (!member) {
    return (
      <PageShell title="Staff member" description="">
        <div className="rounded-[12px] border border-hairline bg-surface-1 p-6 text-center text-[13px] text-fg-tertiary">
          Staff member not found.{" "}
          <Link href="/staff" className="text-primary hover:underline">
            Back to roster
          </Link>
        </div>
      </PageShell>
    );
  }

  // Today's shift, if any
  const today = new Date().toISOString().slice(0, 10);
  const todayShift = shifts.find((sh) => sh.start_at.slice(0, 10) === today);

  // Active clock-in
  const activeEntry = timeEntries.find((t) => !t.clock_out_at);

  return (
    <PageShell title={member.name} description={member.default_position ?? ""} width="wide">
      <Link
        href="/staff"
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-fg-subtle hover:text-fg"
      >
        <ArrowLeft className="size-3.5" /> Back to roster
      </Link>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Identity */}
        <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
          <h2 className="mb-3 text-[12px] font-medium uppercase tracking-wide text-fg-tertiary">
            Identity
          </h2>
          <div className="space-y-1.5 text-[13px]">
            <Row icon={<Mail className="size-3.5" />} label="Email" value={member.email} />
            {member.phone && (
              <Row icon={<Phone className="size-3.5" />} label="Phone" value={member.phone} />
            )}
            {member.hire_date && (
              <Row
                icon={<Calendar className="size-3.5" />}
                label="Hired"
                value={member.hire_date}
              />
            )}
            <Row
              icon={<Sparkles className="size-3.5" />}
              label="Status"
              value={
                <Badge tone={member.status === "active" ? "ok" : "neutral"} size="sm">
                  {member.status}
                </Badge>
              }
            />
          </div>
        </div>

        {/* Wage profile */}
        <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
          <h2 className="mb-3 text-[12px] font-medium uppercase tracking-wide text-fg-tertiary">
            Wage profile
          </h2>
          <div className="space-y-1.5 text-[13px]">
            <Row
              label="Type"
              value={
                <Badge tone="neutral" size="sm">
                  {(member.employment_type ?? "—").toUpperCase()}
                </Badge>
              }
            />
            <Row
              label="Pay rate"
              value={
                <span className="money-display text-[14px] text-fg">
                  {member.salary_annual
                    ? `${formatMoney(member.salary_annual)}/yr`
                    : member.hourly_rate
                    ? `${formatMoney(member.hourly_rate)}/hr`
                    : "—"}
                </span>
              }
            />
            {member.ot_multiplier && member.hourly_rate && (
              <Row label="OT rate" value={`${member.ot_multiplier}× = ${formatMoney(member.hourly_rate * member.ot_multiplier)}/hr`} />
            )}
            <Row label="Method" value={member.payment_method ?? "—"} />
            {member.bank_account_last4 && (
              <Row
                label="Bank"
                value={`••••${member.bank_account_last4}`}
              />
            )}
            <Row label="PTO balance" value={`${member.pto_hours_balance ?? 0} hrs`} />
            {member.pto_accrual_hours_per_period && (
              <Row
                label="PTO accrual"
                value={`+${member.pto_accrual_hours_per_period} hrs/period`}
              />
            )}
          </div>
        </div>

        {/* Mobile clock + today */}
        <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
          <h2 className="mb-3 text-[12px] font-medium uppercase tracking-wide text-fg-tertiary">
            Today
          </h2>
          <div className="space-y-1.5 text-[13px]">
            {todayShift ? (
              <Row
                label="Scheduled"
                value={
                  <>
                    {new Date(todayShift.start_at).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    – {new Date(todayShift.end_at).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </>
                }
              />
            ) : (
              <Row label="Scheduled" value="No shift today" />
            )}
            <Row
              label="Mobile PIN"
              value={
                member.mobile_clock_pin ? (
                  <span className="font-mono tracking-widest text-fg">
                    ••••
                  </span>
                ) : (
                  <span className="text-fg-tertiary">Not set</span>
                )
              }
            />
            <Row
              label="On the clock"
              value={
                activeEntry ? (
                  <Badge tone="info" size="sm">
                    Since{" "}
                    {new Date(activeEntry.clock_in_at).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </Badge>
                ) : (
                  <span className="text-fg-tertiary">No</span>
                )
              }
            />
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent paystubs */}
        <Panel title={`Paystubs (${myStubs.length})`}>
          {myStubs.length === 0 ? (
            <Empty body="No paystubs yet." />
          ) : (
            <ul className="divide-y divide-hairline">
              {myStubs.slice(0, 6).map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <div>
                    <div className="text-[12px] font-medium text-fg">
                      {p.hours_regular + p.hours_ot}h
                      {p.hours_ot > 0 ? ` (incl. ${p.hours_ot}h OT)` : ""}
                    </div>
                    <div className="text-[10px] text-fg-tertiary">
                      Run {p.payroll_run_id.slice(-6)}
                    </div>
                  </div>
                  <span className="money-display text-[13px] text-fg">
                    {formatMoney(p.gross)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Certifications */}
        <Panel title={`Certifications (${certs.length})`}>
          {certs.length === 0 ? (
            <Empty body="No certifications on file." />
          ) : (
            <ul className="divide-y divide-hairline">
              {certs.map((c) => {
                const days = c.expires_at
                  ? Math.round((new Date(c.expires_at).getTime() - Date.now()) / 86_400_000)
                  : null;
                const tone: "ok" | "warn" | "danger" =
                  days === null || days > 30 ? "ok" : days >= 0 ? "warn" : "danger";
                return (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div>
                      <div className="text-[12px] font-medium text-fg">{c.name}</div>
                      <div className="text-[10px] text-fg-tertiary">
                        {c.issuer ?? "—"}
                        {c.expires_at ? ` · expires ${c.expires_at}` : " · no exp."}
                      </div>
                    </div>
                    <Badge tone={tone} size="sm">
                      {days === null ? "Current" : days >= 0 ? `${days}d left` : "Expired"}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {/* Recent time entries */}
      <div className="mt-4">
        <Panel title={`Recent time entries (${timeEntries.length})`}>
          {timeEntries.length === 0 ? (
            <Empty body="No clock-in history yet." />
          ) : (
            <ul className="divide-y divide-hairline">
              {timeEntries.slice(0, 8).map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <div>
                    <div className="text-[12px] text-fg">
                      {new Date(t.clock_in_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {t.clock_out_at
                        ? ` → ${new Date(t.clock_out_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
                        : " · ON THE CLOCK"}
                    </div>
                    <div className="text-[10px] text-fg-tertiary">
                      {(t.calculated_hours ?? 0).toFixed(2)}h · {t.source}
                      {t.approved_at ? " · approved" : t.clock_out_at ? " · awaiting approval" : ""}
                      {t.payroll_run_id ? ` · paid (${t.payroll_run_id.slice(-6)})` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </PageShell>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-tertiary">
        {icon}
        {label}
      </span>
      <span className="min-w-0 truncate text-right">{value}</span>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="border-b border-hairline px-4 py-2 text-[12px] font-medium text-fg">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Empty({ body }: { body: string }) {
  return <div className="px-4 py-6 text-center text-[12px] text-fg-tertiary">{body}</div>;
}
