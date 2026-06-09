"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Searchable combobox primitive — replaces native <select> for any list
 * with more than ~10 entries. Renders a trigger button showing the
 * selected value, opens a popover with a search input + keyboard-
 * navigable filtered options. Optional "+ Create new…" footer action
 * lets the consumer wire an inline create flow without leaving the
 * parent form.
 *
 * Used by: holder selector, vessel selector, slip selector, template
 * selector, and anywhere else a long list needs a typeahead.
 */

export type ComboboxOption = {
  value: string;
  label: string;
  hint?: string; // e.g. boater code shown in muted text after the label
};

export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches.",
  onCreateNew,
  createNewLabel = "Create new",
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Optional callback fired when the user clicks the "+ Create new" footer. */
  onCreateNew?: () => void;
  createNewLabel?: string;
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
        o.value.toLowerCase().includes(q) ||
        (o.hint?.toLowerCase().includes(q) ?? false)
    );
  }, [options, query]);

  const selected = options.find((o) => o.value === value);

  // Reset query + highlight when opening/closing
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightIdx(0);
      // Focus the search box after the popover mounts
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  React.useEffect(() => {
    // Keep highlight in bounds as filter changes
    if (highlightIdx >= filtered.length) {
      setHighlightIdx(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, highlightIdx]);

  function handleSelect(v: string) {
    onChange(v);
    setOpen(false);
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
      if (o) handleSelect(o.value);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-10 w-full items-center justify-between gap-2 rounded-[8px] border border-hairline bg-surface-2 px-3 text-left text-[14px] text-fg focus:border-hairline-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-60",
            !selected && "text-fg-tertiary"
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            {selected ? (
              <>
                {selected.label}
                {selected.hint && (
                  <span className="ml-1.5 text-fg-tertiary">{selected.hint}</span>
                )}
              </>
            ) : (
              placeholder
            )}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-fg-tertiary" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={2}
          /*
           * Width: exactly the trigger's width — no separate min-width
           * that can leak past on narrow forms. Radius matches the
           * trigger (8px) so when the popover opens it reads as one
           * continuous surface, not a separate panel. shadow-xl is the
           * only elevation cue.
           */
          style={{ width: "var(--radix-popover-trigger-width)" }}
          className="z-50 overflow-hidden rounded-[8px] border border-hairline bg-surface-1 shadow-xl outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Flush search bar — no border, no rounded inset, no focus
              ring. The bottom hairline becomes the only divider so it
              feels like part of the same surface as the option list. */}
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
                const isSelected = o.value === value;
                const isHighlight = idx === highlightIdx;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => handleSelect(o.value)}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] transition-colors",
                      isHighlight ? "bg-surface-2" : "hover:bg-surface-2"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-fg">
                      {o.label}
                      {o.hint && (
                        <span className="ml-1.5 text-fg-tertiary">{o.hint}</span>
                      )}
                    </span>
                    {isSelected && <Check className="size-3.5 text-primary" />}
                  </button>
                );
              })
            )}
          </div>
          {onCreateNew && (
            <div className="border-t border-hairline">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onCreateNew();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-medium text-primary hover:bg-primary-soft"
              >
                <Plus className="size-3.5" />
                {createNewLabel}
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
