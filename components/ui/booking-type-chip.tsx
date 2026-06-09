import { cn } from "@/lib/utils";

// Extracted from app/bookings/bookings-client.tsx so other surfaces
// (calendar event chips, kanban day-panel cards, dashboard live-dock,
// boater activity timelines) can land on the same primitive instead
// of re-implementing the slip/rental/club color decisions inline.
//
// NOTE: bookings-client.tsx will replace its inline copy with an
// import from this file (handled by Agent X — do not edit it here).

export type BookingType = "slip" | "rental" | "club";

// One chip primitive for every booking-type label site —
// pending queue, pending detail header, kanban day-panel cards.
// Matches the type union of every booking activity (slip/rental/club).
export const BOOKING_TYPE_CHIP_MAP = {
  slip: { label: "Slip", cls: "bg-status-warn/15 text-status-warn" },
  rental: { label: "Boat", cls: "bg-status-ok/15 text-status-ok" },
  club: { label: "Club", cls: "bg-status-info/15 text-status-info" },
} as const;

export function BookingTypeChip({ type }: { type: BookingType }) {
  const m = BOOKING_TYPE_CHIP_MAP[type];
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        m.cls
      )}
    >
      {m.label}
    </span>
  );
}
