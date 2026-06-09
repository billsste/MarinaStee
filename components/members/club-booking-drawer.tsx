"use client";

/*
 * ClubBookingDrawer — the connection-layer surface for a Rental Club
 * day. Triggered from the calendar chip, today's-club panel, and the
 * boater Overview timeline. Shows the full chain inline:
 *
 *   ClubSubscription → Member (Boater)
 *                   ↘ Rate (plan name, tier, monthly fee, days/mo)
 *                   ↘ ClubBooking (date, status, notes)
 *                        ↘ RentalBoat (when assigned)
 *                            ↘ BoatRental (when checked in)
 *                                ↘ LedgerEntry (closeout invoice)
 *                            ↘ Communications (confirm + check-in)
 *
 * Mirrors the LedgerDrawerProvider pattern so any descendant component
 * can open the drawer via `useClubBookingDrawer().openBooking(id)`.
 */

import * as React from "react";
import Link from "next/link";
import {
  Anchor,
  CalendarRange,
  MessageSquare,
  Receipt,
  Sailboat,
  Tag,
  User as UserIcon,
  X,
} from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Badge } from "@/components/ui/badge";
import { AttachedFeesList } from "@/components/financials/attached-fees-list";
import {
  useBoatRentals,
  useClubBookings,
  useClubSubscriptions,
  useCommunicationsForBoater,
  useEffectivePlanFor,
  useLedgerForBoater,
} from "@/lib/client-store";
import { BOATERS, formatMoney } from "@/lib/mock-data";
import type {
  Boater,
  ClubBooking,
  ClubSubscription,
} from "@/lib/types";

// ─── Provider + hook ──────────────────────────────────────────────

type Ctx = {
  openBooking: (id: string) => void;
};
const DrawerCtx = React.createContext<Ctx | null>(null);

export function useClubBookingDrawer() {
  const ctx = React.useContext(DrawerCtx);
  if (!ctx) {
    throw new Error(
      "useClubBookingDrawer must be used inside <ClubBookingDrawerProvider>"
    );
  }
  return ctx;
}

export function ClubBookingDrawerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  return (
    <DrawerCtx.Provider value={{ openBooking: (id) => setOpenId(id) }}>
      {children}
      <DrawerInner
        bookingId={openId}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      />
    </DrawerCtx.Provider>
  );
}

// ─── Drawer body ──────────────────────────────────────────────────

function DrawerInner({
  bookingId,
  onOpenChange,
}: {
  bookingId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const bookings = useClubBookings();
  const open = bookingId !== null;
  const booking = bookingId ? bookings.find((b) => b.id === bookingId) : undefined;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed right-0 top-0 z-50 h-full w-full max-w-[520px] overflow-y-auto border-l border-hairline bg-surface-1 shadow-2xl focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <DialogPrimitive.Title className="sr-only">
            {booking ? `Club day ${booking.date}` : "Club booking"}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Rental Club booking detail with member, plan, boat, rental, ledger, and comms.
          </DialogPrimitive.Description>
          {booking ? <Body booking={booking} /> : <Empty />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Empty() {
  return (
    <div className="flex h-full items-center justify-center text-[13px] text-fg-subtle">
      No booking selected
    </div>
  );
}

const STATUS_TONE: Record<ClubBooking["status"], "ok" | "warn" | "neutral" | "danger"> = {
  requested: "warn",
  confirmed: "ok",
  checked_in: "ok",
  completed: "neutral",
  cancelled: "danger",
  no_show: "danger",
};

function Body({ booking }: { booking: ClubBooking }) {
  const subs = useClubSubscriptions();
  const subscription = subs.find((s) => s.id === booking.subscription_id);
  const boater = BOATERS.find((b) => b.id === booking.boater_id);
  const plan = useEffectivePlanFor(subscription);
  // Cross-entity links — every hook below joins by id so they're
  // unaffected by tenant scope on the consumer.
  const boatRentals = useBoatRentals();
  const ledger = useLedgerForBoater(booking.boater_id);
  const comms = useCommunicationsForBoater(booking.boater_id);

  const boatRental = boatRentals.find((r) => r.club_booking_id === booking.id);
  const linkedInvoice = ledger.find(
    (l) =>
      l.linked_club_booking_ids?.includes(booking.id) ||
      l.linked_boat_rental_id === boatRental?.id
  );
  const linkedComms = comms.filter(
    (c) => c.related_entity?.type === "club_booking" && c.related_entity.id === booking.id
  );

  const friendlyDate = new Date(booking.date).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <>
      <header className="border-b border-hairline px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
              Club day
            </div>
            <h2 className="mt-0.5 text-[20px] font-semibold tracking-tight text-fg">
              {friendlyDate}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone={STATUS_TONE[booking.status]} size="sm">
                {booking.status.replace("_", " ")}
              </Badge>
              {plan?.plan_name && (
                <Badge tone="outline" size="sm">
                  {plan.plan_name}
                </Badge>
              )}
            </div>
          </div>
          <DialogPrimitive.Close
            aria-label="Close"
            className="rounded-md p-1.5 text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        {booking.notes && (
          <p className="mt-3 text-[12px] text-fg-subtle">{booking.notes}</p>
        )}
      </header>

      <div className="space-y-4 px-5 py-4">
        {boater && <MemberSection boater={boater} />}
        {plan && <PlanSection plan={plan} />}
        {(booking.attached_fee_ids?.length ?? 0) > 0 && (
          <Section title="Add-on fees">
            <AttachedFeesList
              feeIds={booking.attached_fee_ids ?? []}
              termMonths={1}
              dense
            />
          </Section>
        )}
        {boatRental && <BoatRentalSection rentalId={boatRental.id} rentalNumber={boatRental.number} status={boatRental.status} />}
        {linkedInvoice && <InvoiceSection invoiceId={linkedInvoice.id} amount={linkedInvoice.amount} status={linkedInvoice.status} />}
        {linkedComms.length > 0 && <CommsSection comms={linkedComms} />}
      </div>
    </>
  );
}

// ─── Sections ─────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
        {title}
      </div>
      {children}
    </section>
  );
}

function MemberSection({ boater }: { boater: Boater }) {
  return (
    <Section title="Member">
      <Link
        href={`/members/${boater.id}`}
        className="flex items-center gap-2 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 transition-colors hover:border-hairline-strong"
      >
        <UserIcon className="size-4 text-fg-subtle" />
        <div className="flex-1">
          <div className="text-[13px] font-medium text-fg">{boater.display_name}</div>
          <div className="text-[11px] text-fg-tertiary">
            {boater.code ?? "—"} · {boater.billing_cadence}
          </div>
        </div>
      </Link>
    </Section>
  );
}

function PlanSection({
  plan,
}: {
  plan: NonNullable<ReturnType<typeof useEffectivePlanFor>>;
}) {
  return (
    <Section title="Plan">
      <div className="flex items-center gap-2 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2">
        <Tag className="size-4 text-fg-subtle" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-fg">
            {plan.plan_name ?? "Membership"}
          </div>
          <div className="text-[11px] text-fg-tertiary">
            {formatMoney(plan.monthly_fee)}/mo · {plan.days_per_month} days
            {plan.plan_tier ? ` · ${plan.plan_tier}` : ""}
          </div>
        </div>
      </div>
    </Section>
  );
}

function BoatRentalSection({
  rentalId,
  rentalNumber,
  status,
}: {
  rentalId: string;
  rentalNumber: string;
  status: string;
}) {
  return (
    <Section title="Boat rental">
      <Link
        href={`/boat-rentals/${rentalId}`}
        className="flex items-center gap-2 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 transition-colors hover:border-hairline-strong"
      >
        <Anchor className="size-4 text-fg-subtle" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-fg">{rentalNumber}</div>
          <div className="text-[11px] text-fg-tertiary capitalize">
            {status.replace("_", " ")}
          </div>
        </div>
      </Link>
    </Section>
  );
}

function InvoiceSection({
  invoiceId,
  amount,
  status,
}: {
  invoiceId: string;
  amount: number;
  status: string;
}) {
  return (
    <Section title="Invoice">
      <Link
        href={`/ledger#${invoiceId}`}
        className="flex items-center gap-2 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 transition-colors hover:border-hairline-strong"
      >
        <Receipt className="size-4 text-fg-subtle" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-fg">
            {formatMoney(amount)}
          </div>
          <div className="text-[11px] text-fg-tertiary capitalize">{status}</div>
        </div>
      </Link>
    </Section>
  );
}

function CommsSection({
  comms,
}: {
  comms: import("@/lib/types").Communication[];
}) {
  return (
    <Section title={`Messages (${comms.length})`}>
      <ul className="space-y-1.5">
        {comms.slice(0, 5).map((c) => (
          <li
            key={c.id}
            className="flex items-start gap-2 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2"
          >
            <MessageSquare className="mt-0.5 size-3.5 text-fg-subtle" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium text-fg">
                {c.subject ?? "(no subject)"}
              </div>
              <div className="truncate text-[11px] text-fg-tertiary">
                {c.body_preview ?? c.full_body?.slice(0, 80) ?? "—"}
              </div>
            </div>
            <Badge tone="outline" size="sm">
              {c.type}
            </Badge>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// Re-export Sailboat icon so the import isn't an unused warning when
// callers (e.g. the calendar) want to render a header chip.
export { Sailboat as ClubBookingIcon, CalendarRange as ClubBookingDateIcon };
