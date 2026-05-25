"use client";

import * as React from "react";
import { Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NewReservationSheet } from "@/components/reservations/new-reservation-sheet";

/*
 * Thin client-side header above the (server-rendered) spaces table.
 *
 * "+ Day pass" reuses the existing NewReservationSheet — visitor day-passes
 * ARE just transient reservations (type=transient, today → today). No new
 * day-pass flow, just a faster entry point into the existing reservation
 * creation path.
 */
export function SpacesToolbar() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-fg-tertiary">
          {/* Slim helper text — the heavy lifting is the spaces table below. */}
          Walk-up dock visitor? Issue a day pass and the slip becomes occupied for today.
        </p>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          <Ticket className="size-3.5" />
          + Day pass
        </Button>
      </div>

      <NewReservationSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
