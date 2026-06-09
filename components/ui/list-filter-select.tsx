"use client";

import * as React from "react";

/*
 * Compact filter dropdown — the standardized control used in every
 * list-page toolbar across the Services nav (Slips, Rental Boats,
 * Service rates, Fees, Meters, Contracts, etc.). Renders as a chip-
 * style label + native <select> with a chevron background-image, so
 * the active filter value is always visible inline ("Dock: All docks ▾")
 * and the operator reads the entire toolbar at a glance.
 *
 * Stays a native select rather than upgrading to a Combobox because
 * filter dropdowns rarely have >10 options and the chip layout reads
 * better than a full Combobox trigger for a one-word filter.
 *
 * Reference: app/services/roster (Slips) was the first user of this
 * pattern; every other list page now follows it for cross-page UX
 * consistency.
 */
export function ListFilterSelect<T extends string>({
  value,
  onChange,
  label,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  label: string;
  options: { value: T; label: string }[];
}) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-[8px] border border-hairline bg-surface-2 px-2 py-1 text-[12px] text-fg-subtle transition-colors hover:border-hairline-strong">
      <span className="text-fg-tertiary">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="cursor-pointer appearance-none bg-transparent pr-4 text-fg focus:outline-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 0 center",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
