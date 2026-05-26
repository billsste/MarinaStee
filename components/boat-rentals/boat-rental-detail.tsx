"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Sailboat,
  Clock,
  MapPin,
  CreditCard,
  Mail,
  Phone,
  User,
  Send,
  CheckCircle2,
  Fuel,
  Gauge,
  Receipt,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney, rentalDurationLabel } from "@/lib/mock-data";
import {
  addCommunication,
  closeBoatRental,
  markBookingCheckinStep,
  mintBookingPickupToken,
  useStore,
} from "@/lib/client-store";
import { BookingProgressPanel } from "./booking-progress-panel";
import type {
  BoatRental,
  BoatRentalStatus,
  Boater,
  Communication,
  RentalBoat,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * Booking detail page. The center of the Boat Rentals chain — staff
 * lands here from the landing-page table or from a comm's
 * related_entity, and from here they can advance the booking through
 * every state.
 */
export function BoatRentalDetail({
  ssrRental,
  ssrBoat,
  ssrBoater,
}: {
  ssrRental: BoatRental;
  ssrBoat: RentalBoat | null;
  ssrBoater: Boater | null;
}) {
  const router = useRouter();
  const store = useStore();

  // Always read the live booking so we reflect the freshest state.
  const rental =
    store.boatRentals.find((r) => r.id === ssrRental.id) ?? ssrRental;
  const boat =
    (rental.boat_id && store.rentalBoats.find((b) => b.id === rental.boat_id)) ||
    ssrBoat;
  const boater =
    (rental.boater_id && store.boaters.find((b) => b.id === rental.boater_id)) ||
    ssrBoater;

  if (!boat) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12 text-center">
        <p className="text-fg-subtle">Boat not found.</p>
      </main>
    );
  }

  function handleSendInvite() {
    const token = mintBookingPickupToken(rental.id);
    if (!token || !boat) return;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/pickup/${token}`;

    let commType: Communication["type"] = "email";
    let recipient = "";
    let displayFirst = "";
    if (boater) {
      commType = boater.communication_prefs.preferred_channel;
      recipient =
        commType === "email"
          ? (boater.primary_contact.email ?? "")
          : (boater.primary_contact.phone ?? "");
      displayFirst = boater.first_name;
    } else if (rental.patron_email) {
      commType = "email";
      recipient = rental.patron_email;
      displayFirst = (rental.patron_name ?? "").split(/\s+/)[0] ?? "there";
    } else if (rental.patron_phone) {
      commType = "sms";
      recipient = rental.patron_phone;
      displayFirst = (rental.patron_name ?? "").split(/\s+/)[0] ?? "there";
    }

    addCommunication({
      id: `cm_pickup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      boater_id: boater?.id ?? `walk_in:${rental.id}`,
      type: commType,
      direction: "outbound",
      sender_label: "Marina Stee",
      sender_is_system: true,
      recipient,
      subject: `Your ${boat.name} rental — complete pickup`,
      body_preview: `Sign + add a card here: ${url}`,
      full_body:
        `Hi ${displayFirst},\n\nFinish your pickup steps here: ${url}\n\nMarina Stee`,
      sent_at: new Date().toISOString(),
      status: "delivered",
      related_entity: { type: "work_order", id: rental.id },
    });
  }

  function handleCheckOut() {
    markBookingCheckinStep(rental.id, "checked_out_at", {
      fuel_out_pct: boat?.current_fuel_pct,
      hours_out: boat?.hour_meter_reading,
    });
  }

  function handleStartReturn() {
    router.push(`/dock?return=${rental.id}`);
  }

  // Walk-in "pseudo-boater" — synthesize a Boater-shape for the
  // progress panel so we can resend without rewriting the component.
  const panelBoater: Boater | null =
    boater ??
    (rental.patron_email || rental.patron_phone
      ? ({
          id: `walk_in:${rental.id}`,
          first_name: (rental.patron_name ?? "").split(/\s+/)[0] ?? "Guest",
          last_name: "",
          display_name: rental.patron_name ?? "Walk-in customer",
          primary_contact: {
            email: rental.patron_email,
            phone: rental.patron_phone,
          },
          communication_prefs: {
            preferred_channel: rental.patron_email ? "email" : "sms",
          },
        } as unknown as Boater)
      : null);

  return (
    <div className="mx-auto w-full max-w-[1080px] px-6 pt-6 pb-12">
      {/* Top bar */}
      <div className="mb-4 flex items-center justify-between">
        <Link
          href="/boat-rentals"
          className="inline-flex items-center gap-1 text-[12px] text-fg-subtle hover:text-fg"
        >
          <ArrowLeft className="size-3.5" />
          Boat Rentals
        </Link>
        <StatusBadge status={rental.status} />
      </div>

      {/* Header */}
      <header className="mb-5">
        <div className="flex items-center gap-2">
          <h1 className="display-tight text-[26px] font-semibold text-fg">
            {rental.number}
          </h1>
          <span className="text-[15px] text-fg-subtle">·</span>
          <span className="text-[15px] text-fg">{boat.name}</span>
        </div>
        <p className="mt-1 text-[13px] text-fg-subtle">
          {customerLabel(rental, boater)} · {formatRange(rental.start_at, rental.end_at)} · {rentalDurationLabel(rental)}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left rail — progress + customer + actions */}
        <div className="space-y-4 lg:col-span-5">
          {panelBoater !== null && rental.status !== "closed" && (
            <BookingProgressPanel
              booking={rental}
              boat={boat}
              boater={boater}
            />
          )}

          {/* Customer card */}
          <section className="rounded-[12px] border border-hairline bg-surface-1">
            <div className="border-b border-hairline px-4 py-2.5">
              <h2 className="text-[13px] font-medium text-fg">Customer</h2>
            </div>
            <div className="space-y-2 p-4 text-[13px]">
              <div className="flex items-center gap-2">
                <User className="size-3.5 text-fg-subtle" />
                <span className="text-fg">{customerLabel(rental, boater)}</span>
                {boater ? (
                  <Badge tone="info" size="sm">{boater.billing_cadence}</Badge>
                ) : (
                  <Badge tone="neutral" size="sm">walk-in</Badge>
                )}
              </div>
              {(boater?.primary_contact.email ?? rental.patron_email) && (
                <ContactRow
                  icon={<Mail className="size-3.5" />}
                  value={boater?.primary_contact.email ?? rental.patron_email ?? ""}
                />
              )}
              {(boater?.primary_contact.phone ?? rental.patron_phone) && (
                <ContactRow
                  icon={<Phone className="size-3.5" />}
                  value={boater?.primary_contact.phone ?? rental.patron_phone ?? ""}
                />
              )}
              {rental.patron_id_last4 && (
                <ContactRow
                  icon={<CreditCard className="size-3.5" />}
                  value={`ID ending ****${rental.patron_id_last4}`}
                />
              )}
              {boater && (
                <Link
                  href={`/holders/${boater.id}`}
                  className="inline-block text-[11px] text-primary hover:underline"
                >
                  Open holder profile →
                </Link>
              )}
            </div>
          </section>

          {/* Boat */}
          <section className="rounded-[12px] border border-hairline bg-surface-1">
            <div className="border-b border-hairline px-4 py-2.5">
              <h2 className="text-[13px] font-medium text-fg">Boat</h2>
            </div>
            <div className="space-y-2 p-4 text-[13px]">
              <div className="flex items-center gap-2">
                <Sailboat className="size-3.5 text-fg-subtle" />
                <span className="text-fg">{boat.name}</span>
                <Badge tone={boat.status === "available" ? "ok" : "info"} size="sm">
                  {boat.status === "rented" ? "on water" : boat.status}
                </Badge>
              </div>
              <div className="text-[12px] capitalize text-fg-subtle">
                {boat.type.replace("_", " ")} · {boat.capacity} pax
              </div>
              <ContactRow icon={<MapPin className="size-3.5" />} value={boat.home_dock} />
              {boat.current_fuel_pct != null && (
                <ContactRow
                  icon={<Fuel className="size-3.5" />}
                  value={`${boat.current_fuel_pct}% fuel · ${boat.hour_meter_reading ?? "—"} hrs`}
                />
              )}
            </div>
          </section>
        </div>

        {/* Right rail — booking + charges + actions */}
        <div className="space-y-4 lg:col-span-7">
          {/* Booking + financials */}
          <section className="rounded-[12px] border border-hairline bg-surface-1">
            <div className="border-b border-hairline px-4 py-2.5">
              <h2 className="text-[13px] font-medium text-fg">Booking</h2>
            </div>
            <div className="p-4">
              <dl className="grid grid-cols-2 gap-3 text-[13px]">
                <Field label="Pickup" value={formatLocal(rental.start_at)} />
                <Field label="Return" value={formatLocal(rental.end_at)} />
                <Field label="Duration" value={rentalDurationLabel(rental)} />
                <Field label="Rate kind" value={rental.rate_kind === "hourly" ? "Hourly" : rental.rate_kind === "half_day" ? "Half day" : "Full day"} />
              </dl>

              <div className="mt-4 rounded-[10px] border border-hairline bg-surface-2 p-3 text-[13px]">
                <Row label="Base rental" value={formatMoney(rental.base_amount)} />
                {(rental.fuel_charge ?? 0) > 0 && (
                  <Row label="Fuel" value={formatMoney(rental.fuel_charge!)} />
                )}
                {(rental.damage_charge ?? 0) > 0 && (
                  <Row label="Damage" value={formatMoney(rental.damage_charge!)} />
                )}
                {(rental.late_fee ?? 0) > 0 && (
                  <Row label="Late fee" value={formatMoney(rental.late_fee!)} />
                )}
                {rental.final_total != null ? (
                  <div className="mt-2 border-t border-hairline pt-2">
                    <Row
                      label="Final total"
                      value={formatMoney(rental.final_total)}
                      bold
                    />
                  </div>
                ) : (
                  <div className="mt-1 flex items-baseline justify-between text-fg-tertiary">
                    <span>Refundable deposit hold</span>
                    <span className="tabular">{formatMoney(rental.deposit_hold)}</span>
                  </div>
                )}
              </div>

              {/* Final charge details when returned/closed */}
              {(rental.fuel_in_pct != null || rental.damage_notes) && (
                <div className="mt-3 rounded-[10px] border border-hairline bg-surface-2 p-3 text-[12px]">
                  <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">Return report</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                    {rental.fuel_out_pct != null && (
                      <Field label="Fuel out" value={`${rental.fuel_out_pct}%`} dense />
                    )}
                    {rental.fuel_in_pct != null && (
                      <Field label="Fuel in" value={`${rental.fuel_in_pct}%`} dense />
                    )}
                    {rental.hours_out != null && (
                      <Field label="Hours out" value={String(rental.hours_out)} dense />
                    )}
                    {rental.hours_in != null && (
                      <Field label="Hours in" value={String(rental.hours_in)} dense />
                    )}
                  </div>
                  {rental.damage_notes && (
                    <div className="mt-2">
                      <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">Damage notes</div>
                      <p className="mt-0.5 text-[12px] text-fg">{rental.damage_notes}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Linked invoice */}
              {rental.related_ledger_entry_id && (
                <div className="mt-3 flex items-center justify-between rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[12px]">
                  <span className="inline-flex items-center gap-1.5 text-fg-subtle">
                    <Receipt className="size-3.5" />
                    Invoice posted to ledger
                  </span>
                  <span className="font-mono text-[11px] text-primary">
                    {rental.related_ledger_entry_id}
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Staff actions */}
          <StaffActions
            rental={rental}
            onSend={handleSendInvite}
            onCheckOut={handleCheckOut}
            onStartReturn={handleStartReturn}
          />

          {/* Agent affordance */}
          <div className="rounded-[12px] border border-primary/30 bg-primary-soft/30 p-4">
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-primary">
              <Sparkles className="size-3.5" />
              Ask the agent
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-fg-subtle">
              "Resend the pickup link." · "Mark {rental.number} returned, fuel at 45%, no damage."
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Status-aware staff actions ──────────────────────────────────

function StaffActions({
  rental,
  onSend,
  onCheckOut,
  onStartReturn,
}: {
  rental: BoatRental;
  onSend: () => void;
  onCheckOut: () => void;
  onStartReturn: () => void;
}) {
  return (
    <section className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="border-b border-hairline px-4 py-2.5">
        <h2 className="text-[13px] font-medium text-fg">Next step</h2>
      </div>
      <div className="p-4">
        {rental.status === "reserved" && (
          <ActionRow
            icon={<Send className="size-4 text-primary" />}
            title={rental.checkin.link_sent_at ? "Pickup link sent — resend if needed" : "Send pickup link to customer"}
            body="Customer signs the agreement + puts a card on file via /pickup/[token]."
            cta="Send pickup link"
            onClick={onSend}
          />
        )}
        {rental.status === "confirmed" && (
          <ActionRow
            icon={<CheckCircle2 className="size-4 text-status-ok" />}
            title="Ready for pickup"
            body="When the customer arrives at the dock, verify ID and hand over the keys. Tap below or do it from /dock."
            cta="Mark checked out"
            onClick={onCheckOut}
            tone="ok"
          />
        )}
        {rental.status === "checked_out" && (
          <ActionRow
            icon={<Gauge className="size-4 text-status-info" />}
            title="On the water"
            body="When the boat returns, record fuel level + hours + any damage. Triggers final charges to the card on file."
            cta="Record return"
            onClick={onStartReturn}
            tone="info"
          />
        )}
        {rental.status === "returned" && (
          <ActionRow
            icon={<Receipt className="size-4 text-status-warn" />}
            title="Returned — finalize charges"
            body="Posted to /dock returns. Close from here if you've already settled the deposit."
            cta="Go to dock returns"
            onClick={onStartReturn}
            tone="warn"
          />
        )}
        {rental.status === "closed" && (
          <ActionRow
            icon={<CheckCircle2 className="size-4 text-status-ok" />}
            title="Closed"
            body={`Final total ${formatMoney(rental.final_total ?? rental.base_amount)} posted to the ledger. Deposit released.`}
            cta=""
            tone="ok"
          />
        )}
        {(rental.status === "cancelled" || rental.status === "no_show") && (
          <ActionRow
            icon={<AlertCircle className="size-4 text-status-danger" />}
            title={rental.status === "cancelled" ? "Cancelled" : "No-show"}
            body="Booking is terminal — no further actions."
            cta=""
            tone="danger"
          />
        )}
      </div>
    </section>
  );
}

function ActionRow({
  icon,
  title,
  body,
  cta,
  onClick,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  cta: string;
  onClick?: () => void;
  tone?: "neutral" | "ok" | "warn" | "info" | "danger";
}) {
  const tint =
    tone === "ok"
      ? "border-status-ok/30 bg-status-ok/[0.05]"
      : tone === "warn"
      ? "border-status-warn/30 bg-status-warn/[0.05]"
      : tone === "info"
      ? "border-status-info/30 bg-status-info/[0.05]"
      : tone === "danger"
      ? "border-status-danger/30 bg-status-danger/[0.05]"
      : "border-hairline bg-surface-2";
  return (
    <div className={cn("rounded-[10px] border p-3", tint)}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-fg">{title}</div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-fg-subtle">{body}</p>
        </div>
      </div>
      {cta && onClick && (
        <div className="mt-3 flex justify-end">
          <Button variant="primary" size="sm" onClick={onClick}>
            {cta}
          </Button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: BoatRentalStatus }) {
  const map: Record<BoatRentalStatus, { tone: "ok" | "warn" | "danger" | "info" | "neutral"; label: string }> = {
    reserved: { tone: "neutral", label: "Reserved" },
    confirmed: { tone: "info", label: "Confirmed" },
    checked_out: { tone: "info", label: "On the water" },
    returned: { tone: "warn", label: "Returned" },
    closed: { tone: "ok", label: "Closed" },
    cancelled: { tone: "danger", label: "Cancelled" },
    no_show: { tone: "danger", label: "No-show" },
  };
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

function Field({
  label,
  value,
  dense,
}: {
  label: string;
  value: string;
  dense?: boolean;
}) {
  return (
    <div>
      <div className={dense ? "text-[10px] text-fg-tertiary" : "text-[11px] text-fg-tertiary"}>
        {label}
      </div>
      <div className={dense ? "text-[12px] text-fg" : "text-[13px] text-fg"}>{value}</div>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={bold ? "text-[14px] font-medium text-fg" : "text-fg-subtle"}>
        {label}
      </span>
      <span
        className={cn(
          "tabular",
          bold ? "money-display text-[18px] text-fg" : "text-fg"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function ContactRow({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-2 text-fg">
      <span className="text-fg-tertiary">{icon}</span>
      <span className="truncate text-[12px]">{value}</span>
    </div>
  );
}

function formatLocal(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
function formatRange(s: string, e: string) {
  return `${formatLocal(s)} → ${formatLocal(e)}`;
}
function customerLabel(b: BoatRental, boater: Boater | null) {
  if (boater) return boater.display_name;
  return b.patron_name ?? "Walk-in customer";
}
