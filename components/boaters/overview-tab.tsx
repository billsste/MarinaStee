"use client";

import * as React from "react";
import {
  Mail,
  Phone,
  MapPin,
  Anchor,
  Receipt,
  Wrench,
  MessageSquare,
  Pencil,
  Check,
  Copy,
  Send,
  ExternalLink,
  Eye,
  CreditCard,
  Signature,
  Link as LinkIcon,
  Sailboat,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn, formatPhone } from "@/lib/utils";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import {
  formatInches,
  formatMoney,
  getSlip,
  rentalDurationLabel,
} from "@/lib/mock-data";
import {
  addCommunication,
  mintContractSignatureToken,
  upsertBoater,
  upsertContract,
  useBoatRentalsForBoater,
  useCommunicationsForBoater,
  useContractsForBoater,
  useLedgerForBoater,
  usePicklistLabelMap,
  useRentalBoats,
  useReservationsForBoater,
} from "@/lib/client-store";
import { StaffNotesCard } from "@/components/notes/staff-notes-card";
import type {
  BoatRental,
  Boater,
  Communication,
  Contract,
  LedgerEntry,
  RentalBoat,
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
  const boaterRentals = useBoatRentalsForBoater(boater.id);
  const rentalFleet = useRentalBoats();
  const contactRoleLabels = usePicklistLabelMap("contact_role");
  // Active rentals are anything not closed/cancelled — appears at the
  // top so staff can see "is this customer currently on the water?" at
  // a glance. Past closed rentals fall to a compact history strip.
  const activeRentals = boaterRentals.filter(
    (r) => r.status !== "closed" && r.status !== "cancelled" && r.status !== "no_show"
  );
  const closedRentals = boaterRentals
    .filter((r) => r.status === "closed")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  // For annual/seasonal holders, pin contract + tenure context above the slip
  const isAnnual = boater.billing_cadence === "annual" || boater.billing_cadence === "monthly";
  const isSeasonal = boater.billing_cadence === "seasonal";
  const showContractPanel = isAnnual || isSeasonal;
  const activeContract = boaterContracts.find((c) => c.status === "active");
  // Onboarding-in-flight: any contract that's been sent/signed but isn't
  // active yet. Drives the live progress rail so staff sees what step
  // the holder is on.
  const onboardingContract = boaterContracts.find(
    (c) =>
      c.signature_token !== undefined &&
      (c.status === "sent" || c.status === "partially_signed" || c.status === "executed")
  );
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

  // Edit dialogs for the Contact + Contract panels. Vessels link to the
  // Vessels & Slips tab (which has its own edit affordances).
  const [editContactOpen, setEditContactOpen] = React.useState(false);
  const [editContractOpen, setEditContractOpen] = React.useState(false);

  function handleSaveContact(values: BoaterContactForm) {
    upsertBoater({
      ...boater,
      first_name: values.first_name || boater.first_name,
      last_name: values.last_name || boater.last_name,
      display_name: `${values.last_name || boater.last_name}, ${values.first_name || boater.first_name}`,
      billing_cadence: values.billing_cadence || boater.billing_cadence,
      primary_contact: {
        ...boater.primary_contact,
        email: values.email || "",
        phone: values.phone || "",
      },
      address: {
        ...boater.address,
        line1: values.address_line1 || boater.address.line1,
        city: values.address_city || boater.address.city,
        state: values.address_state || boater.address.state,
        zip: values.address_zip || boater.address.zip,
      },
      communication_prefs: {
        ...boater.communication_prefs,
        preferred_channel: values.preferred_channel || boater.communication_prefs.preferred_channel,
        language: values.language || boater.communication_prefs.language,
      },
    });
  }

  function handleSaveContract(values: Contract) {
    if (!activeContract) return;
    upsertContract({
      ...activeContract,
      ...values,
      annual_rate: values.annual_rate ? Number(values.annual_rate) : activeContract.annual_rate,
    });
  }

  // Open balance + current slip live in the IdentityBar at the top of the page,
  // so they're omitted from Overview to avoid duplication. Overview focuses on
  // identity context (contact, contract, slip detail) on the left + activity
  // and operational lists on the right.
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Identity rail — narrower left column on desktop */}
      <div className="space-y-4 lg:col-span-5">
        {onboardingContract && (
          <OnboardingProgressPanel contract={onboardingContract} boater={boater} />
        )}
        {(activeRentals.length > 0 || closedRentals.length > 0) && (
          <BoatRentalsStrip
            active={activeRentals}
            closed={closedRentals.slice(0, 3)}
            fleet={rentalFleet}
          />
        )}
        <Panel title="Contact" onEdit={() => setEditContactOpen(true)}>
          <div className="space-y-1">
            <ContactRow icon={<Mail className="size-3.5" />} label="Email" value={boater.primary_contact.email} />
            <ContactRow icon={<Phone className="size-3.5" />} label="Phone" value={formatPhone(boater.primary_contact.phone)} />
            <ContactRow
              icon={<MapPin className="size-3.5" />}
              label="Address"
              value={`${boater.address.line1}, ${boater.address.city}, ${boater.address.state} ${boater.address.zip}`}
            />
          </div>
          {boater.additional_contacts.length > 0 && (
            <div className="mt-3 border-t border-hairline pt-2.5">
              <div className="mb-1.5 text-[10px] uppercase tracking-wide text-fg-tertiary">
                Additional contacts
              </div>
              <ul className="space-y-0.5">
                {boater.additional_contacts.map((c) => (
                  <li key={c.id} className="text-[12px] text-fg-muted">
                    <span className="text-fg">{c.name}</span>
                    <span className="text-fg-tertiary"> · {contactRoleLabels.get(c.role) ?? c.role}</span>
                    <span className="text-fg-tertiary"> · {c.phone ? formatPhone(c.phone) : c.email}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 border-t border-hairline pt-2.5 text-[11px] text-fg-tertiary">
            Prefers <span className="font-medium capitalize text-fg-subtle">{boater.communication_prefs.preferred_channel}</span>
            {boater.communication_prefs.do_not_contact_after && (
              <> · Quiet after {boater.communication_prefs.do_not_contact_after}</>
            )}
            <> · Language <span className="uppercase text-fg-subtle">{boater.communication_prefs.language}</span></>
          </div>
        </Panel>

        {showContractPanel && activeContract && (
          <Panel
            title={isSeasonal ? "Seasonal contract" : "Annual contract"}
            onEdit={() => setEditContractOpen(true)}
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <Link
                href={`/slips/contracts/${activeContract.id}`}
                className="font-mono text-[15px] font-medium text-primary hover:underline"
              >
                {activeContract.number}
              </Link>
              <Badge tone="ok" size="sm">{activeContract.status}</Badge>
              {successorContract && (
                <Link
                  href={`/slips/contracts/${successorContract.id}`}
                  className="inline-flex"
                >
                  <Badge tone="primary" size="sm">
                    {successorContract.status === "draft"
                      ? "Renewal drafted"
                      : successorContract.status === "sent"
                      ? "Renewal sent"
                      : "Renewed"}
                  </Badge>
                </Link>
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
                  {activeContract.annual_rate ? formatMoney(activeContract.annual_rate) : "—"}
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

        {nextReservation && slip && (
          <Panel title="Current slip">
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

        {/* Vessels moved here from the right column so the left doesn't end
            while the right keeps scrolling. Layout #161 rebalance. */}
        <Panel title={`Vessels (${vessels.length})`}>
          {vessels.length === 0 ? (
            <EmptyInline text="No vessels on file." />
          ) : (
            <ul className="divide-y divide-hairline">
              {vessels.map((v) => (
                <li key={v.id} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-fg">{v.name}</div>
                    <div className="text-[12px] text-fg-subtle">
                      {[v.year, v.make, v.model].filter(Boolean).join(" ")}
                    </div>
                    <div className="mt-0.5 text-[11px] text-fg-tertiary">
                      {formatInches(v.loa_inches)} LOA · {v.fuel_type ?? "—"}
                    </div>
                  </div>
                  {v.active && <Badge tone="ok" size="sm">Active</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Action rail — wider right column */}
      <div className="space-y-4 lg:col-span-7">
        <Panel title="Recent activity">
          {activity.length === 0 ? (
            <EmptyInline text="No recent activity." />
          ) : (
            <ol className="relative border-l border-hairline pl-4">
              {activity.slice(0, 8).map((a) => (
                <TimelineItem
                  key={`${a.kind}-${a.kind === "communication" ? a.data.id : a.kind === "ledger" ? a.data.id : a.data.id}`}
                  a={a}
                />
              ))}
            </ol>
          )}
        </Panel>

        {openWO.length > 0 && (
          <Panel title={`Open work orders (${openWO.length})`}>
            <ul className="divide-y divide-hairline">
              {openWO.slice(0, 5).map((w) => (
                <li key={w.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-surface-3 text-fg-subtle">
                    <Wrench className="size-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-fg">{w.subject}</div>
                    <div className="text-[11px] text-fg-tertiary">
                      {w.status.replace("_", " ")}
                      {w.start_date ? ` · starts ${w.start_date}` : w.due_date ? ` · due ${w.due_date}` : ""}
                    </div>
                  </div>
                  <Badge
                    tone={w.priority === "urgent" ? "danger" : w.priority === "high" ? "warn" : "neutral"}
                    size="sm"
                  >
                    {w.priority}
                  </Badge>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <StaffNotesCard boaterId={boater.id} />
      </div>

      <RecordEditDialog<BoaterContactForm>
        open={editContactOpen}
        onOpenChange={setEditContactOpen}
        title={`Edit contact — ${boater.display_name}`}
        description="Updates the holder's primary contact, address, and communication preferences."
        record={{
          id: boater.id,
          first_name: boater.first_name,
          last_name: boater.last_name,
          email: boater.primary_contact.email,
          phone: boater.primary_contact.phone,
          address_line1: boater.address.line1,
          address_city: boater.address.city,
          address_state: boater.address.state,
          address_zip: boater.address.zip,
          preferred_channel: boater.communication_prefs.preferred_channel,
          language: boater.communication_prefs.language,
          billing_cadence: boater.billing_cadence,
        }}
        fields={CONTACT_FIELDS}
        onSave={handleSaveContact}
        entity="boater"
      />

      {activeContract && (
        <RecordEditDialog<Contract>
          open={editContractOpen}
          onOpenChange={setEditContractOpen}
          title={`Edit contract — ${activeContract.number}`}
          description="Adjust term, rate, or cadence. Generates a new version on save."
          record={activeContract}
          fields={CONTRACT_FIELDS}
          onSave={handleSaveContract}
          entity="contract"
        />
      )}
    </div>
  );
}

// Flat shape used by the Contact dialog. We unpack/re-pack into the
// nested Boater structure on save.
type BoaterContactForm = {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  address_line1: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  preferred_channel: "email" | "sms" | "voice";
  language: string;
  billing_cadence: "annual" | "seasonal" | "monthly" | "transient";
};

const CONTACT_FIELDS: FieldSpec<BoaterContactForm>[] = [
  { key: "first_name", label: "First name", kind: "text", col: 2 },
  { key: "last_name", label: "Last name", kind: "text", col: 2 },
  { key: "email", label: "Email", kind: "text", col: 2 },
  { key: "phone", label: "Phone", kind: "text", col: 2 },
  { key: "address_line1", label: "Address", kind: "text" },
  { key: "address_city", label: "City", kind: "text", col: 2 },
  { key: "address_state", label: "State", kind: "text", col: 2 },
  { key: "address_zip", label: "Zip", kind: "text", col: 2 },
  {
    key: "preferred_channel",
    label: "Prefers",
    kind: "select",
    col: 2,
    options: [
      { value: "email", label: "Email" },
      { value: "sms", label: "SMS" },
      { value: "voice", label: "Voice" },
    ],
  },
  { key: "language", label: "Language (EN/ES/...)", kind: "text", col: 2 },
  {
    key: "billing_cadence",
    label: "Billing cadence",
    kind: "select",
    col: 2,
    options: [
      { value: "annual", label: "Annual" },
      { value: "seasonal", label: "Seasonal" },
      { value: "monthly", label: "Monthly" },
      { value: "transient", label: "Transient" },
    ],
  },
];

const CONTRACT_FIELDS: FieldSpec<Contract>[] = [
  { key: "number", label: "Contract #", kind: "text", col: 2 },
  {
    key: "status",
    label: "Status",
    kind: "select",
    col: 2,
    options: [
      { value: "draft", label: "Draft" },
      { value: "sent", label: "Sent" },
      { value: "active", label: "Active" },
      { value: "expired", label: "Expired" },
      { value: "cancelled", label: "Cancelled" },
    ],
  },
  { key: "effective_start", label: "Start", kind: "date", col: 2 },
  { key: "effective_end", label: "End", kind: "date", col: 2 },
  { key: "annual_rate", label: "Annual rate ($)", kind: "money", col: 2, step: "0.01" },
  {
    key: "billing_cadence",
    label: "Billing cadence",
    kind: "select",
    col: 2,
    options: [
      { value: "annual", label: "Annual" },
      { value: "seasonal", label: "Seasonal" },
      { value: "monthly", label: "Monthly" },
      { value: "transient", label: "Transient" },
    ],
  },
];

function Panel({
  title,
  children,
  onEdit,
}: {
  title: string;
  children: React.ReactNode;
  onEdit?: () => void;
}) {
  return (
    <div className="group rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="text-[13px] font-medium text-fg">{title}</h3>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${title}`}
            className="inline-flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-1.5 py-0.5 text-[10px] text-fg-subtle opacity-0 transition-opacity hover:bg-surface-2 group-hover:opacity-100"
          >
            <Pencil className="size-3" />
            Edit
          </button>
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

function EmptyInline({ text }: { text: string }) {
  return <p className="text-[13px] text-fg-subtle">{text}</p>;
}

/*
 * OnboardingProgressPanel — live rail for in-flight slip-holder onboarding.
 *
 * Slip-assignment wizard mints a signature_token + dispatches a Communication;
 * Contract.onboarding.{link_sent_at,link_viewed_at,signed_at,card_added_at}
 * fill in as the holder advances through /onboard/[token]. This panel mirrors
 * the staff side: status badge, 4-step checklist with timestamps, and the
 * three actions every marina staffer asks for — copy the link, resend the
 * invite, or "open as boater" to see exactly what they see.
 *
 * Replaces the old workflow of "draft a contract → wait → ask the boater to
 * mail back a signed PDF + a check / call in their card." Self-service +
 * fully observable.
 */
function OnboardingProgressPanel({
  contract,
  boater,
}: {
  contract: Contract;
  boater: Boater;
}) {
  const [copied, setCopied] = React.useState(false);
  const [resentAt, setResentAt] = React.useState<string | null>(null);

  const onb = contract.onboarding ?? {};
  const steps: { key: keyof NonNullable<Contract["onboarding"]>; label: string; icon: React.ReactNode; ts?: string }[] = [
    { key: "link_sent_at", label: "Invite sent", icon: <Send className="size-3" />, ts: onb.link_sent_at },
    { key: "link_viewed_at", label: "Boater opened link", icon: <Eye className="size-3" />, ts: onb.link_viewed_at },
    { key: "signed_at", label: "Contract signed", icon: <Signature className="size-3" />, ts: onb.signed_at },
    { key: "card_added_at", label: "Payment method added", icon: <CreditCard className="size-3" />, ts: onb.card_added_at },
  ];
  const completed = steps.filter((s) => !!s.ts).length;
  const pct = Math.round((completed / steps.length) * 100);

  // Headline status: what's the staff member waiting on?
  let waitingOn: { label: string; tone: "info" | "warn" | "ok" } = {
    label: "Awaiting boater",
    tone: "info",
  };
  if (!onb.link_viewed_at && onb.link_sent_at) waitingOn = { label: "Awaiting boater", tone: "info" };
  if (onb.link_viewed_at && !onb.signed_at) waitingOn = { label: "Reading agreement", tone: "info" };
  if (onb.signed_at && !onb.card_added_at) waitingOn = { label: "Awaiting payment method", tone: "warn" };
  if (onb.signed_at && onb.card_added_at) waitingOn = { label: "Ready to activate", tone: "ok" };

  // Build the public URL — fall back to a relative path on SSR.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const token = contract.signature_token ?? "";
  const onboardUrl = token ? `${origin}/onboard/${token}` : "";

  async function copyLink() {
    if (!onboardUrl) return;
    try {
      await navigator.clipboard.writeText(onboardUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  function resend() {
    // Idempotent — mintContractSignatureToken returns the existing token if
    // there is one. Re-stamps onboarding.link_sent_at so the rail updates.
    const t = mintContractSignatureToken(contract.id);
    if (!t) return;
    const url = `${origin}/onboard/${t}`;
    const channel = boater.communication_prefs.preferred_channel;
    const commType: Communication["type"] = channel;
    const recipient =
      commType === "email"
        ? (boater.primary_contact.email ?? "")
        : (boater.primary_contact.phone ?? "");
    addCommunication({
      id: `cm_resend_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      boater_id: boater.id,
      type: commType,
      direction: "outbound",
      sender_label: "Marina Stee",
      sender_is_system: true,
      recipient,
      subject: `Reminder: complete your onboarding for contract ${contract.number}`,
      body_preview: `Sign and add a payment method here: ${url}`,
      full_body:
        `Hi ${boater.first_name},\n\n` +
        `Just a friendly reminder to complete your slip onboarding for contract ${contract.number}. ` +
        `It only takes a couple of minutes:\n\n${url}\n\n` +
        `Reply to this message if you'd like a hand.`,
      sent_at: new Date().toISOString(),
      status: "delivered",
      related_entity: { type: "contract", id: contract.id },
    });
    setResentAt(new Date().toISOString());
    setTimeout(() => setResentAt(null), 2500);
  }

  return (
    <div className="rounded-[12px] border border-primary/30 bg-primary-soft/30">
      <div className="flex items-center justify-between border-b border-primary/20 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-medium text-fg">Onboarding in flight</h3>
          <Badge tone={waitingOn.tone} size="sm">
            {waitingOn.label}
          </Badge>
        </div>
        <span className="text-[11px] tabular text-fg-subtle">
          {completed} of {steps.length}
        </span>
      </div>

      <div className="space-y-3 p-4">
        {/* Progress bar */}
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Step list */}
        <ul className="space-y-1.5">
          {steps.map((s) => {
            const done = !!s.ts;
            return (
              <li key={s.key} className="flex items-center gap-2.5 text-[12px]">
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border",
                    done
                      ? "border-status-ok bg-status-ok/10 text-status-ok"
                      : "border-hairline bg-surface-2 text-fg-tertiary"
                  )}
                >
                  {done ? <Check className="size-3" /> : s.icon}
                </span>
                <span
                  className={cn(
                    "flex-1",
                    done ? "text-fg" : "text-fg-subtle"
                  )}
                >
                  {s.label}
                </span>
                {done && s.ts && (
                  <span className="text-[10px] tabular text-fg-tertiary">
                    {new Date(s.ts).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {/* Contract reference */}
        <Link
          href={`/slips/contracts/${contract.id}`}
          className="block rounded-[8px] border border-hairline bg-surface-1 px-2.5 py-1.5 text-[11px] transition-colors hover:border-hairline-strong hover:bg-surface-2"
        >
          <span className="text-fg-tertiary">Contract </span>
          <span className="font-mono text-primary hover:underline">{contract.number}</span>
          {contract.annual_rate && (
            <>
              <span className="text-fg-tertiary"> · </span>
              <span className="tabular text-fg">{formatMoney(contract.annual_rate)}</span>
              <span className="text-fg-tertiary">/{contract.billing_cadence}</span>
            </>
          )}
        </Link>

        {/* Action row */}
        {onboardUrl && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              {copied ? (
                <>
                  <Check className="size-3 text-status-ok" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="size-3" />
                  Copy link
                </>
              )}
            </button>
            <button
              type="button"
              onClick={resend}
              className="inline-flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              {resentAt ? (
                <>
                  <Check className="size-3 text-status-ok" />
                  Sent
                </>
              ) : (
                <>
                  <Send className="size-3" />
                  Resend
                </>
              )}
            </button>
            <a
              href={onboardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              <ExternalLink className="size-3" />
              Open as boater
            </a>
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-fg-tertiary">
              <LinkIcon className="size-3" />
              <span className="hidden truncate sm:inline">{onboardUrl.replace(/^https?:\/\//, "")}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/*
 * Boat Rentals strip — surfaces this holder's marina-owned-fleet
 * rentals on their detail page. Active rentals up top with a "currently
 * on the water" cue + per-status badge; recent closed history below.
 *
 * Connects the Boat Rentals domain back into the holder's Overview so
 * staff sees the full picture: contract + slip + active rental in one
 * place.
 */
function BoatRentalsStrip({
  active,
  closed,
  fleet,
}: {
  active: BoatRental[];
  closed: BoatRental[];
  fleet: RentalBoat[];
}) {
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="inline-flex items-center gap-1.5 text-[13px] font-medium text-fg">
          <Sailboat className="size-3.5 text-fg-subtle" />
          Boat rentals
        </h3>
        {active.length > 0 && (
          <Badge tone="info" size="sm">
            {active.filter((r) => r.status === "checked_out").length > 0
              ? "On the water"
              : `${active.length} in flight`}
          </Badge>
        )}
      </div>
      <div className="divide-y divide-hairline">
        {active.map((r) => {
          const boat = fleet.find((b) => b.id === r.boat_id);
          return (
            <Link
              key={r.id}
              href={`/boat-rentals/${r.id}`}
              className="block cursor-pointer px-4 py-2.5 transition-colors hover:bg-surface-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] font-medium text-primary">
                      {r.number}
                    </span>
                    <span className="text-[13px] text-fg">{boat?.name ?? "—"}</span>
                  </div>
                  <div className="text-[11px] text-fg-tertiary">
                    {new Date(r.start_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    →{" "}
                    {new Date(r.end_at).toLocaleString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    · {rentalDurationLabel(r)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="tabular text-[12px] text-fg">
                    {formatMoney(r.final_total ?? r.base_amount)}
                  </div>
                  <Badge
                    tone={
                      r.status === "checked_out"
                        ? "info"
                        : r.status === "confirmed"
                        ? "ok"
                        : r.status === "returned"
                        ? "warn"
                        : "neutral"
                    }
                    size="sm"
                  >
                    {r.status === "checked_out" ? "on water" : r.status}
                  </Badge>
                </div>
              </div>
            </Link>
          );
        })}
        {closed.length > 0 && (
          <>
            <div className="bg-surface-2 px-4 py-1 text-[10px] uppercase tracking-wide text-fg-tertiary">
              Recent
            </div>
            {closed.map((r) => {
              const boat = fleet.find((b) => b.id === r.boat_id);
              return (
                <Link
                  key={r.id}
                  href={`/boat-rentals/${r.id}`}
                  className="block cursor-pointer px-4 py-2 transition-colors hover:bg-surface-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-mono text-[11px] text-primary">{r.number}</span>
                      <span className="text-[11px] text-fg-tertiary"> · </span>
                      <span className="text-[12px] text-fg">{boat?.name ?? "—"}</span>
                    </div>
                    <span className="tabular text-[11px] text-fg-subtle">
                      {formatMoney(r.final_total ?? r.base_amount)}
                    </span>
                  </div>
                </Link>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
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
