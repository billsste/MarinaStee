"use client";

import { MessageSquarePlus, Wrench, CalendarPlus, MoreHorizontal } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney, initialsOf } from "@/lib/mock-data";
import { useLedgerForBoater } from "@/lib/client-store";
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
              <Badge tone={boater.billing_cadence === "transient" ? "info" : "primary"}>
                {cadenceLabel}
              </Badge>
              {currentReservation && (
                <Badge tone="neutral">Slip {currentReservation.slip_id}</Badge>
              )}
              <Badge tone={balanceTone}>
                Balance <span className="tabular ml-0.5">{formatMoney(openBalance)}</span>
              </Badge>
              {boater.trust_score !== undefined && (
                <Badge tone={boater.trust_score >= 90 ? "ok" : "neutral"}>
                  Trust {boater.trust_score}
                </Badge>
              )}
              {boater.tags.map((t) => (
                <Badge key={t} tone="outline" size="sm">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="md">
            <MessageSquarePlus className="size-4" /> Message
          </Button>
          <Button variant="secondary" size="md">
            <Wrench className="size-4" /> Work Order
          </Button>
          <Button variant="primary" size="md">
            <CalendarPlus className="size-4" /> Reservation
          </Button>
          <Button variant="ghost" size="icon" aria-label="More actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
