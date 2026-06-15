"use client";

import * as React from "react";
import { formatMoney } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

/*
 * Shared wizard field primitives — used by every multi-step wizard
 * (slip assignment, reservation booking, future flows). Centralized so
 * tone, spacing, and a11y stay consistent everywhere wizards appear.
 */

/**
 * Labeled form field with optional required marker and hint text. Copied
 * verbatim from the original local component in assign-slip-client.tsx
 * so all wizards share the same label tone.
 */
export function FieldLabel({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-fg-subtle">
          {label}
          {required && <span className="ml-1 text-status-danger">*</span>}
        </span>
      </div>
      {children}
      {hint && (
        <p className="mt-1 text-[11px] text-fg-tertiary">{hint}</p>
      )}
    </label>
  );
}

/**
 * Right-rail dt/dd pair used in wizard summaries. Uses the reservation-
 * wizard's truncating variant so long values (boater names, slip ids)
 * don't blow out the rail width.
 */
export function RailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-fg-tertiary">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-right text-fg">{value}</dd>
    </div>
  );
}

/**
 * Container for ReviewBlock rows on the final step of a wizard. ONE
 * bordered card, rows separated by a divider — beats N bordered cards
 * stacked with gaps. Use as: `<ReviewList><ReviewBlock ... /></ReviewList>`.
 *
 * Why this shape: the per-row bordered Card pattern bloated review
 * steps (~380px on a 6-row review) compared to other wizard steps
 * (~280px). Wrapping flat rows in one container brings the review
 * step back to ~36px per row + 1px dividers.
 */
export function ReviewList({ children }: { children: React.ReactNode }) {
  return (
    <dl className="divide-y divide-hairline overflow-hidden rounded-[10px] border border-hairline bg-surface-1">
      {children}
    </dl>
  );
}

/**
 * Review-step row with Edit jump-back. `capitalize` opts in to capitalizing
 * the value text — useful for enum-like values ("transient", "monthly")
 * where the source data is lowercase.
 *
 * Designed to sit inside a `<ReviewList>` — the row carries no border
 * of its own; the parent provides the container border + dividers.
 */
export function ReviewBlock({
  label,
  value,
  onEdit,
  capitalize = false,
}: {
  label: string;
  value: string;
  onEdit: () => void;
  capitalize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        <dt className="w-20 shrink-0 text-[10.5px] font-medium uppercase tracking-wide text-fg-tertiary">
          {label}
        </dt>
        <dd
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] text-fg",
            capitalize && "capitalize"
          )}
        >
          {value}
        </dd>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="shrink-0 text-[12px] font-medium text-primary hover:underline"
      >
        Edit
      </button>
    </div>
  );
}

/**
 * Selectable card with a money amount + per-period label. Used by the
 * pricing/cadence steps. Pre-formats the amount via formatMoney so callers
 * pass a raw number.
 */
export function CadenceCard({
  label,
  amount,
  per,
  hint,
  selected,
  onClick,
}: {
  label: string;
  amount: number;
  per: string;
  hint?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1 rounded-[10px] border px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-primary bg-primary-soft/40 ring-1 ring-primary/30"
          : "border-hairline bg-surface-1 hover:border-hairline-strong hover:bg-surface-2"
      )}
    >
      <div className="text-[12px] font-medium text-fg">{label}</div>
      <div className="money-display text-[18px] text-fg">{formatMoney(amount)}</div>
      <div className="text-[10px] text-fg-tertiary">
        {per}
        {hint && <span className="ml-1">· {hint}</span>}
      </div>
    </button>
  );
}
