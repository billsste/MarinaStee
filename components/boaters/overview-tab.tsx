"use client";

import Link from "next/link";
import {
  Mail,
  Phone,
  MapPin,
  Anchor,
  Receipt,
  Wrench,
  CalendarRange,
  ArrowRight,
  MessageSquare,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  formatInches,
  formatMoney,
  getSlip,
} from "@/lib/mock-data";
import {
  useCommunicationsForBoater,
  useContractsForBoater,
  useLedgerForBoater,
  useReservationsForBoater,
} from "@/lib/client-store";
import { StaffNotesCard } from "@/components/notes/staff-notes-card";
import type {
  Boater,
  Communication,
  LedgerEntry,
  Reservation,
  Vessel,
  WorkOrder,
} from "@/lib/types";

type Activity =
  | { kind: "communication"; ts: string; data: Communication }
  | { kind: "ledger"; ts: string; data: LedgerEntry }
  | { kind: "work_order"; ts: string; data: WorkOrder };

export function OverviewTab({
  boater,
  vessels,
  reservations,
  workOrders,
}: {
  boater: Boater;
  vessels: Vessel[];
  reservations: Reservation[];
  workOrders: WorkOrder[];
}) {
  // Live data — reflects POS sales / signed quotes / new comms in this session.
  const ledger = useLedgerForBoater(boater.id);
  const comms = useCommunicationsForBoater(boater.id);
  const boaterContracts = useContractsForBoater(boater.id);
  const boaterReservations = useReservationsForBoater(boater.id);

  // For annual/seasonal holders, pin contract + tenure context above the slip
  const isAnnual = boater.billing_cadence === "annual" || boater.billing_cadence === "monthly";
  const isSeasonal = boater.billing_cadence === "seasonal";
  const showContractPanel = isAnnual || isSeasonal;
  const activeContract = boaterContracts.find((c) => c.status === "active");
  const successorContract = activeContract
    ? boaterContracts.find(
        (c) =>
          c.id !== activeContract.id &&
          c.slip_id === activeContract.slip_id &&
          new Date(c.effective_start).getTime() > new Date(activeContract.effective_start).getTime()
      )
    : undefined;
  // Tenure: count unique years across this boater's completed/active reservations
  const tenureYears = new Set(
    boaterReservations
      .filter((r) => r.status === "completed" || r.status === "occupied")
      .map((r) => r.arrival_date.slice(0, 4))
  ).size;
  const openBalance = ledger
    .filter((l) => l.type === "invoice")
    .reduce((s, e) => s + e.open_balance, 0);
  const nextReservation = reservations.find((r) => r.status === "occupied" || r.status === "scheduled");
  const slip = getSlip(nextReservation?.slip_id);
  const openWO = workOrders.filter((w) =>
    ["open", "scheduled", "in_progress", "blocked"].includes(w.status)
  );

  // Unified timeline
  const activity: Activity[] = [
    ...comms.map((c) => ({ kind: "communication" as const, ts: c.sent_at, data: c })),
    ...ledger.map((l) => ({ kind: "ledger" as const, ts: l.date, data: l })),
    ...workOrders.map((w) => ({
      kind: "work_order" as const,
      ts: w.start_date || w.due_date || w.end_date || "1970-01-01",
      data: w,
    })),
  ].sort((a, b) => (a.ts < b.ts ? 1 : -1));

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {/* Left column — contact + open balance + next reservation */}
      <div className="space-y-4 xl:col-span-1">
        <Panel title="Contact" askLink={`Email or text ${boater.first_name}`}>
          <ContactRow icon={<Mail className="size-3.5" />} label="Email" value={boater.primary_contact.email} />
          <ContactRow icon={<Phone className="size-3.5" />} label="Phone" value={boater.primary_contact.phone} />
          <ContactRow
            icon={<MapPin className="size-3.5" />}
            label="Address"
            value={`${boater.address.line1}, ${boater.address.city}, ${boater.address.state} ${boater.address.zip}`}
          />
          {boater.additional_contacts.length > 0 && (
            <div className="mt-2 border-t border-hairline pt-2">
              <div className="mb-1 text-[11px] uppercase tracking-wide text-fg-tertiary">
                Additional contacts
              </div>
              {boater.additional_contacts.map((c) => (
                <div key={c.id} className="text-[12px] text-fg-muted">
                  <span className="text-fg">{c.name}</span>{" "}
                  <span className="text-fg-tertiary">· {c.role}</span>{" "}
                  <span className="text-fg-tertiary">· {c.phone ?? c.email}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {showContractPanel && activeContract && (
          <Panel
            title={isSeasonal ? "Seasonal contract" : "Annual contract"}
            askLink={
              successorContract
                ? undefined
                : `Draft a renewal for ${boater.first_name}`
            }
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[15px] font-medium text-fg">
                {activeContract.number}
              </span>
              <Badge tone="ok" size="sm">{activeContract.status}</Badge>
              {successorContract && (
                <Badge tone="primary" size="sm">
                  {successorContract.status === "draft"
                    ? "Renewal drafted"
                    : successorContract.status === "sent"
                    ? "Renewal sent"
                    : "Renewed"}
                </Badge>
              )}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
              <div>
                <dt className="text-fg-tertiary">Term</dt>
                <dd className="text-fg">{activeContract.effective_start} → {activeContract.effective_end}</dd>
              </div>
              <div>
                <dt className="text-fg-tertiary">Annual rate</dt>
                <dd className="tabular text-fg">
                  {activeContract.annual_rate
                    ? formatMoney(activeContract.annual_rate)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-fg-tertiary">Tenure</dt>
                <dd className="text-fg">
                  {tenureYears > 0 ? `${tenureYears} season${tenureYears === 1 ? "" : "s"}` : "First season"}
                  {boater.tags.includes("original_holder") && (
                    <span className="ml-1.5 text-[10px] text-status-info">★ original</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-fg-tertiary">Billing</dt>
                <dd className="capitalize text-fg">{activeContract.billing_cadence}</dd>
              </div>
            </dl>
          </Panel>
        )}

        <Panel
          title="Open balance"
          askLink={openBalance > 0 ? "Draft a payment reminder" : undefined}
        >
          <div className="flex items-baseline gap-2">
            <span
              className={
                "money-display-lg text-[32px] " +
                (openBalance > 0 ? "text-status-warn" : "text-fg")
              }
            >
              {formatMoney(openBalance)}
            </span>
            {openBalance > 0 ? (
              <Badge tone="warn">Past due risk</Badge>
            ) : (
              <Badge tone="ok">Current</Badge>
            )}
          </div>
          <p className="mt-1 text-[12px] text-fg-subtle">
            {openBalance > 0
              ? "Manager or agent can send a reminder or take payment now."
              : "All invoices paid through last cycle."}
          </p>
        </Panel>

        <StaffNotesCard boaterId={boater.id} />

        {nextReservation && slip && (
          <Panel title="Current slip" askLink={`When does the ${slip.id} reservation end?`}>
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-surface-3 text-primary">
                <Anchor className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="text-fg">
                  <span className="font-medium">{slip.dock}</span>
                  <span className="text-fg-tertiary"> · Slip {slip.number}</span>
                </div>
                <div className="text-[12px] text-fg-subtle">
                  {nextReservation.arrival_date} → {nextReservation.departure_date}
                </div>
                <div className="mt-1 text-[11px] text-fg-tertiary">
                  Max LOA {formatInches(slip.max_loa_inches)} · Power {slip.has_power ? "yes" : "no"} · Water {slip.has_water ? "yes" : "no"}
                </div>
              </div>
            </div>
          </Panel>
        )}
      </div>

      {/* Center column — vessels + open work orders */}
      <div className="space-y-4 xl:col-span-1">
        <Panel title={`Vessels (${vessels.length})`} askLink={`Schedule winterization for the fleet`}>
          {vessels.length === 0 ? (
            <EmptyInline text="No vessels on file." />
          ) : (
            <div className="space-y-3">
              {vessels.map((v) => (
                <div key={v.id} className="rounded-[8px] border border-hairline bg-surface-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-medium text-fg">{v.name}</div>
                      <div className="text-[12px] text-fg-subtle">
                        {v.make} {v.model} · {v.color}
                      </div>
                    </div>
                    {v.active && <Badge tone="ok" size="sm">Active</Badge>}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-fg-tertiary">
                    <Stat label="LOA" value={formatInches(v.loa_inches)} />
                    <Stat label="Beam" value={formatInches(v.beam_inches)} />
                    <Stat label="Draft" value={formatInches(v.draft_inches)} />
                    <Stat label="Year" value={v.year ? String(v.year) : "—"} />
                    <Stat label="Fuel" value={v.fuel_type ?? "—"} />
                    <Stat label="Reg" value={v.registration ?? "—"} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title={`Open work orders (${openWO.length})`}
          askLink={openWO.length > 0 ? "Reassign these to another dockhand" : undefined}
        >
          {openWO.length === 0 ? (
            <EmptyInline text="No open work orders." />
          ) : (
            <ul className="divide-y divide-hairline">
              {openWO.map((w) => (
                <li key={w.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-surface-3 text-fg-subtle">
                    <Wrench className="size-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-fg">{w.subject}</div>
                    <div className="text-[11px] text-fg-tertiary">
                      {w.status.replace("_", " ")} · priority {w.priority}
                      {w.start_date ? ` · starts ${w.start_date}` : ""}
                    </div>
                  </div>
                  <Badge
                    tone={
                      w.priority === "urgent"
                        ? "danger"
                        : w.priority === "high"
                          ? "warn"
                          : "neutral"
                    }
                    size="sm"
                  >
                    {w.priority}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Right column — unified activity timeline */}
      <div className="xl:col-span-1">
        <Panel
          title="Recent activity"
          askLink={`What happened with ${boater.first_name} this month?`}
        >
          {activity.length === 0 ? (
            <EmptyInline text="No recent activity." />
          ) : (
            <ol className="relative border-l border-hairline pl-4">
              {activity.slice(0, 10).map((a) => (
                <TimelineItem key={`${a.kind}-${a.kind === "communication" ? a.data.id : a.kind === "ledger" ? a.data.id : a.data.id}`} a={a} />
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
  askLink,
}: {
  title: string;
  children: React.ReactNode;
  askLink?: string;
}) {
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="text-[13px] font-medium text-fg">{title}</h3>
        {askLink && (
          <Link
            href={`#ask-${encodeURIComponent(askLink)}`}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Ask <ArrowRight className="size-3" />
          </Link>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ContactRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
}) {
  return (
    <div className="flex items-start gap-2 py-1 text-[13px]">
      <span className="mt-0.5 text-fg-tertiary">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-fg-tertiary">{label}</div>
        <div className="truncate text-fg">{value ?? "—"}</div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">{label}</div>
      <div className="text-[12px] text-fg">{value}</div>
    </div>
  );
}

function EmptyInline({ text }: { text: string }) {
  return <p className="text-[13px] text-fg-subtle">{text}</p>;
}

function TimelineItem({ a }: { a: Activity }) {
  const icon =
    a.kind === "communication" ? (
      <MessageSquare className="size-3" />
    ) : a.kind === "ledger" ? (
      <Receipt className="size-3" />
    ) : (
      <Wrench className="size-3" />
    );

  let title = "";
  let subtitle = "";
  let tone: "ok" | "warn" | "danger" | "info" | "neutral" = "neutral";

  if (a.kind === "communication") {
    title = a.data.subject ?? a.data.body_preview.slice(0, 60);
    subtitle = `${a.data.sender_label} · ${a.data.direction} · ${a.data.status}`;
    tone = a.data.status === "bounced" || a.data.status === "failed" ? "danger" : "info";
  } else if (a.kind === "ledger") {
    if (a.data.type === "refund") {
      title = `Refund ${formatMoney(a.data.amount)}`;
      subtitle = `${a.data.refund_reason?.replace("_", " ") ?? ""} · ${a.data.method ?? ""}`;
      tone = "warn";
    } else if (a.data.type === "payment") {
      title = `Payment ${formatMoney(a.data.amount)}`;
      subtitle = `Applied to ${(a.data.applied_to_invoice_ids ?? []).length} invoice(s) · ${a.data.method ?? ""}`;
      tone = "ok";
    } else {
      title = `Invoice ${a.data.number} ${formatMoney(a.data.amount)}`;
      subtitle = `${a.data.status}`;
      tone = a.data.status === "open" ? "warn" : "neutral";
    }
  } else {
    title = a.data.subject;
    subtitle = `${a.data.status.replace("_", " ")} · ${a.data.priority}`;
    tone = a.data.priority === "urgent" ? "danger" : a.data.priority === "high" ? "warn" : "neutral";
  }

  return (
    <li className="relative mb-3 last:mb-0">
      <span className="absolute -left-[19px] flex size-5 items-center justify-center rounded-full border border-hairline bg-surface-2 text-fg-subtle">
        {icon}
      </span>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-fg">{title}</div>
          <div className="text-[11px] text-fg-tertiary">{subtitle}</div>
        </div>
        <span className="shrink-0 text-[11px] text-fg-tertiary">
          {new Date(a.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
      </div>
      <span className="hidden">{tone}</span>
    </li>
  );
}
