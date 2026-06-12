"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/*
 * Canonical tab strip + tab button — Marina Stee uses ONE tab pattern
 * everywhere: a chip-pill style strip that lives inside a rounded
 * surface-1 container, with each tab as a soft pill. Active state
 * gets `bg-surface-3` + full `text-fg`, inactive tabs sit in
 * `text-fg-subtle`.
 *
 * Used by:
 *   - /services/rates       (Slip pricing / Other rates / Fees)
 *   - /services/waitlist    (Queue / Offers / Stale / Archive)
 *   - /services/contracts   (Renewal pipeline / All contracts)
 *
 * Replaces three prior implementations (two custom inline TabButtons +
 * shadcn Tabs on the contracts page) so the operator sees ONE tab
 * vocabulary across the app. See CLAUDE.md §"List-page UX consistency"
 * for the broader rule (tab strips above the toolbar express distinct
 * VIEWS; they are not filter axes — those go in ListFilterSelect).
 */

export function TabStrip({
  ariaLabel,
  children,
  className,
}: {
  ariaLabel: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-[10px] border border-hairline bg-surface-1 p-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabButton({
  active,
  onClick,
  label,
  icon,
  count,
  badge,
  severity,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  /** Optional leading icon. Use sparingly — most tab strips read fine
   *  with just a label. */
  icon?: React.ReactNode;
  /** Optional trailing count badge ("Queue · 34"-style). Renders as
   *  a neutral Badge. */
  count?: number;
  /** Optional trailing secondary badge ("1 pending"-style). Renders
   *  as a warn-tone Badge. */
  badge?: string;
  /** Tints the icon when count > 0 and tab is inactive — surfaces
   *  attention-worthy tabs without forcing the operator to mouse over.
   *  Only `warn` is supported today. */
  severity?: "warn";
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12px] font-medium transition-colors",
        active
          ? "bg-surface-3 text-fg shadow-sm"
          : "text-fg-subtle hover:bg-surface-2 hover:text-fg",
      )}
    >
      {icon && (
        <span
          className={cn(
            severity === "warn" &&
              count !== undefined &&
              count > 0 &&
              !active &&
              "text-status-warn",
          )}
        >
          {icon}
        </span>
      )}
      <span>{label}</span>
      {count !== undefined && (
        <Badge tone="neutral" size="sm">
          {count}
        </Badge>
      )}
      {badge && (
        <Badge tone="warn" size="sm">
          {badge}
        </Badge>
      )}
    </button>
  );
}
