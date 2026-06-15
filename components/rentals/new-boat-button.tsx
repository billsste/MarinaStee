"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RentalBoatWizard } from "@/components/rentals/rental-boat-wizard";

/*
 * Shared "+ New boat" affordance. Used by:
 *   - Services → Rental Club (club-catalog-manager.tsx Fleet section)
 *   - /boat-rentals (fleet grid header)
 *
 * Opens the multi-step RentalBoatWizard modal — same primitives + right-
 * rail rollup + agent affordance as the slip-assignment and reservation
 * wizards. The wizard itself owns the available_for_club default (true)
 * + status default; the caller-supplied defaultAvailableForClub prop is
 * retained for API compatibility but the wizard surfaces the toggle on
 * step 1 so the operator confirms each time anyway.
 */
export function NewBoatButton({
  defaultAvailableForClub: _defaultAvailableForClub = true,
  size = "sm",
}: {
  /**
   * Reserved for future use — the wizard currently always defaults
   * available_for_club=true and shows the toggle on step 1 so the
   * operator confirms in-context. Kept on the signature so callers don't
   * break.
   */
  defaultAvailableForClub?: boolean;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button variant="secondary" size={size} onClick={() => setOpen(true)}>
        <Plus className="size-3.5" />
        New boat
      </Button>
      <RentalBoatWizard open={open} onOpenChange={setOpen} />
    </>
  );
}
