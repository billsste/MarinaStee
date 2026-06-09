"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Searchable multi-select combobox primitive — the multi-pick sibling
 * of `Combobox`. Same Radix Popover.Portal foundation so the popover
 * escapes overflow:auto containers (modal scroll wells, etc.) and
 * Radix handles collision detection (renders upward when there's no
 * room below).
 *
 * Usage: replaces native <select multiple> or hand-rolled toggle-card
 * lists anywhere the operator picks zero-or-more items from a catalog.
 * Slip service rates, fee attachments on bookings, role assignments
 * for staff — all use this same primitive.
 */

export type MultiComboboxOption = {
  value: string;
  label: string;
  /** Right-aligned secondary text (price, cadence, etc.). */
  trailing?: string;
  /** Small text under the label (cadence, category). */
  sub?: string;
};

export function MultiCombobox({
  value,
  onChange,
  options,
  placeholder = "Click to pick · type to filter",
  searchPlaceholder = "Search…",
  emptyText = "No matches.",
  disabled = false,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  options: MultiComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [highlightIdx, setHighlightIdx] = React.useState(0);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sub?.toLowerCase().includes(q) ?? false) ||
        (o.trailing?.toLowerCase().includes(q) ?? false)
    );
  }, [options, query]);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightIdx(0);
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  React.useEffect(() => {
    if (highlightIdx >= filtered.length) {
      setHighlightIdx(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, highlightIdx]);

  function toggle(v: string) {
    if (value.includes(v)) {
      onChange(value.filter((x) => x !== v));
    } else {
      onChange([...value, v]);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = filtered[highlightIdx];
      if (o) toggle(o.value);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const selectedOptions = value
    .map((v) => options.find((o) => o.value === v))
    .filter((o): o is MultiComboboxOption => Boolean(o));

  return (
    <div className="space-y-2">
      {/* Selected chips above the trigger — always visible. */}
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedOptions.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => toggle(o.value)}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded-[6px] border border-primary/40 bg-primary-soft/50 px-2 py-1 text-[11px] text-fg transition-colors hover:bg-primary-soft/70 disabled:opacity-60"
            >
              <span className="font-medium">{o.label}</span>
              {o.trailing && (
                <span className="text-fg-tertiary">{o.trailing}</span>
              )}
              <X className="size-3 text-fg-subtle" />
            </button>
          ))}
        </div>
      )}

      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "flex h-10 w-full items-center justify-between gap-2 rounded-[8px] border border-hairline bg-surface-2 px-3 text-left text-[14px] focus:border-hairline-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-60",
              value.length === 0 ? "text-fg-tertiary" : "text-fg"
            )}
          >
            <span className="min-w-0 flex-1 truncate">
              {value.length === 0
                ? placeholder
                : `${value.length} selected · click to pick more`}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-fg-tertiary" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={2}
            collisionPadding={8}
            style={{ width: "var(--radix-popover-trigger-width)" }}
            className="z-50 overflow-hidden rounded-[8px] border border-hairline bg-surface-1 shadow-xl outline-none"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
              <Search className="size-3.5 shrink-0 text-fg-tertiary" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKey}
                placeholder={searchPlaceholder}
                className="flex-1 border-0 bg-transparent text-[13px] text-fg outline-none ring-0 placeholder:text-fg-tertiary focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
              />
            </div>
            <div className="max-h-72 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-[12px] text-fg-tertiary">
                  {emptyText}
                </div>
              ) : (
                filtered.map((o, idx) => {
                  const isSelected = value.includes(o.value);
                  const isHighlight = idx === highlightIdx;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => toggle(o.value)}
                      onMouseEnter={() => setHighlightIdx(idx)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[13px] transition-colors",
                        isHighlight ? "bg-surface-2" : "hover:bg-surface-2"
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-fg">
                          {o.label}
                          {o.sub && (
                            <span className="ml-1.5 text-[11px] capitalize text-fg-tertiary">
                              {o.sub}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        {o.trailing && (
                          <span className="money-display tabular text-[13px] text-fg">
                            {o.trailing}
                          </span>
                        )}
                        {isSelected && (
                          <Check className="size-3.5 text-primary" />
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
