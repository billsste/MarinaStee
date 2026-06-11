"use client";

import * as React from "react";
import { MessageSquarePlus, Wrench, CalendarPlus } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney, initialsOf } from "@/lib/mock-data";
import { useLedgerForBoater, useWaitlist } from "@/lib/client-store";
import { NewMessageSheet } from "@/components/comms/new-message-sheet";
import { NewWorkOrderWizard } from "@/components/work-orders/new-work-order-wizard";
import { NewReservationSheet } from "@/components/reservations/new-reservation-sheet";
import type { Boater, Reservation } from "@/lib/types";

export function BoaterIdentityBar({
  boater,
  currentReservation,
}: {
  boater: Boater;
  currentReservation?: Reservation;
}) {
  // Live open balance — reflects any POS sales / quote signings during the session.
  const ledger = useLedgerForBoater(boater.id);
  const openBalance = ledger
    .filter((l) => l.type === "invoice")
    .reduce((s, e) => s + e.open_balance, 0);
  const balanceTone = openBalance > 0 ? "warn" : "ok";
  const cadenceLabel =
    boater.billing_cadence.charAt(0).toUpperCase() + boater.billing_cadence.slice(1);

  // Lifecycle context — surfaced as compact badges next to the cadence
  // pill so an operator sees "Slip holder · also waiting for D-12" at
  // a glance. The Waitlist card on the Overview tab carries the full
  // detail; this is the at-a-glance signal.
  const waitlist = useWaitlist();
  const activeWaitlistEntries = React.useMemo(
    () =>
      waitlist.filter(
        (e) =>
          e.boater_id === boater.id &&
          e.status !== "converted" &&
          e.status !== "declined" &&
          e.status !== "withdrawn" &&
          e.status !== "expired" &&
          !e.archived_at,
      ),
    [waitlist, boater.id],
  );
  const isWaitlistOnly =
    activeWaitlistEntries.length > 0 &&
    (boater.tags?.includes("waitlist-only") ?? false);

  // Top-of-page action sheets (per user audit: previously all 3 were dead).
  const [msgOpen, setMsgOpen] = React.useState(false);
  const [woOpen, setWoOpen] = React.useState(false);
  const [resOpen, setResOpen] = React.useState(false);

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar className="size-14 shrink-0 text-[15px]">
            <AvatarFallback>{initialsOf(boater.display_name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="display-tight text-[24px] font-semibold text-fg">
                {boater.display_name}
              </h1>
              {boater.code && (
                <span className="text-[12px] text-fg-tertiary">{boater.code}</span>
              )}
              {!boater.active && (
                <Badge tone="outline" size="sm">
                  Inactive
                </Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {/* Lifecycle pill is the LOUDEST identifier — operators
                  scan this first. "Prospect" wins over the cadence
                  badge when this person is waitlist-only. */}
              {isWaitlistOnly ? (
                <Badge tone="info">
                  Waitlist prospect
                </Badge>
              ) : (
                <Badge tone={boater.billing_cadence === "transient" ? "info" : "primary"}>
                  {cadenceLabel}
                </Badge>
              )}
              {currentReservation && (
                <Badge tone="neutral">Slip {currentReservation.slip_id}</Badge>
              )}
              {activeWaitlistEntries.length > 0 && !isWaitlistOnly && (
                // Person has a slip AND is on the waitlist (e.g. wants
                // a second slip). Surface this so the operator notices
                // the dual relationship.
                <Badge tone="info">
                  + Waitlist
                  {activeWaitlistEntries.length > 1 &&
                    ` ×${activeWaitlistEntries.length}`}
                </Badge>
              )}
              <Badge tone={balanceTone}>
                Balance <span className="tabular ml-0.5">{formatMoney(openBalance)}</span>
              </Badge>
              {boater.trust_score !== undefined && (
                <Badge tone={boater.trust_score >= 90 ? "ok" : "neutral"}>
                  Trust {boater.trust_score}
                </Badge>
              )}
              {boater.tags
                // The "waitlist-only" tag is consumed above as the
                // lifecycle pill — don't render it twice.
                .filter((t) => t !== "waitlist-only")
                .map((t) => (
                  <Badge key={t} tone="outline" size="sm">
                    {t}
                  </Badge>
                ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="md" onClick={() => setMsgOpen(true)}>
            <MessageSquarePlus className="size-4" /> Message
          </Button>
          <Button variant="secondary" size="md" onClick={() => setWoOpen(true)}>
            <Wrench className="size-4" /> Work Order
          </Button>
          <Button variant="primary" size="md" onClick={() => setResOpen(true)}>
            <CalendarPlus className="size-4" /> Reservation
          </Button>
        </div>
      </div>

      <NewMessageSheet open={msgOpen} onOpenChange={setMsgOpen} defaultBoaterId={boater.id} />
      <NewWorkOrderWizard open={woOpen} onOpenChange={setWoOpen} defaultBoaterId={boater.id} />
      <NewReservationSheet open={resOpen} onOpenChange={setResOpen} defaultBoaterId={boater.id} />
    </div>
  );
}
