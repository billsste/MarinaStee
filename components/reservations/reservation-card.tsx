"use client";

import Link from "next/link";
import { Anchor, Ship, Sun, MoonStar, Calendar } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BOATERS,
  VESSELS,
  getSlip,
  initialsOf,
} from "@/lib/mock-data";
import { updateReservationStatus } from "@/lib/client-store";
import type { Reservation } from "@/lib/types";

export function ReservationCard({
  reservation,
  variant,
}: {
  reservation: Reservation;
  variant: "arrival" | "departure" | "upcoming";
}) {
  const boater = BOATERS.find((b) => b.id === reservation.boater_id);
  const vessel = VESSELS.find((v) => v.id === reservation.vessel_id);
  const slip = getSlip(reservation.slip_id);

  return (
    <div className="rounded-[10px] border border-hairline bg-surface-1 p-3 transition-colors hover:border-hairline-strong">
      <div className="flex items-start gap-3">
        <Avatar className="size-9 shrink-0">
          <AvatarFallback>
            {boater ? initialsOf(boater.display_name) : "??"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {boater ? (
              <Link
                href={`/holders/${boater.id}`}
                className="truncate text-[13px] font-medium text-fg hover:text-primary"
              >
                {boater.display_name}
              </Link>
            ) : (
              <span className="text-fg-tertiary">Unknown boater</span>
            )}
            <span className="text-[11px] text-fg-tertiary">· {reservation.number}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
            {vessel && (
              <span className="inline-flex items-center gap-1">
                <Ship className="size-3" />
                {vessel.name}
              </span>
            )}
            {slip && (
              <span className="inline-flex items-center gap-1">
                <Anchor className="size-3" />
                {slip.dock} · {slip.number}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={reservation.type === "transient" ? "info" : "primary"} size="sm">
              {reservation.type}
            </Badge>
            {variant === "arrival" && (
              <Badge tone="ok" size="sm">
                <Sun className="size-3" />
                Arriving
              </Badge>
            )}
            {variant === "departure" && (
              <Badge tone="warn" size="sm">
                <MoonStar className="size-3" />
                Departing
              </Badge>
            )}
            {variant === "upcoming" && (
              <Badge tone="outline" size="sm">
                <Calendar className="size-3" />
                {reservation.arrival_date}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {variant === "arrival" && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => updateReservationStatus(reservation.id, "occupied")}
              disabled={reservation.status === "occupied"}
            >
              {reservation.status === "occupied" ? "Checked in" : "Check in"}
            </Button>
          )}
          {variant === "departure" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => updateReservationStatus(reservation.id, "completed")}
              disabled={reservation.status === "completed"}
            >
              {reservation.status === "completed" ? "Checked out" : "Check out"}
            </Button>
          )}
          {variant === "upcoming" && boater && (
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/holders/${boater.id}`}>View</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
