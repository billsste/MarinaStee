"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Audit Log Explorer — free-text search bar.
 *
 * The search is a substring filter (case-insensitive) over six fields on
 * each row: action_type, target_entity, target_id, actor_label,
 * agent_prompt, and the raw payload_delta JSON. The actual filtering
 * lives in `convex/audit.ts:search` (live) + `lib/client-store.ts:
 * useAuditLogSearch` (mock) so the bar itself just owns the input
 * affordance + debounce.
 *
 * Why debounce at the input: each keystroke would otherwise re-run the
 * search query on every keystroke. 180ms is the Superhuman / linear
 * sweet spot — long enough that fast typists don't fire 10 searches,
 * short enough that the results feel live.
 */

interface AuditSearchBarProps {
  value: string;
  onChange: (next: string) => void;
  // Debounced "fire the query" callback. Distinct from onChange so the
  // bar can render the live typed text while the data layer waits.
  onCommit?: (committed: string) => void;
  placeholder?: string;
  className?: string;
}

export function AuditSearchBar({
  value,
  onChange,
  onCommit,
  placeholder = "Search action, target, actor, payload…",
  className,
}: AuditSearchBarProps) {
  // Debounce — fires `onCommit` 180ms after the user stops typing.
  // We keep the local typed text reactive via `value` (controlled by
  // the parent) so the input still feels immediate.
  React.useEffect(() => {
    if (!onCommit) return;
    const handle = window.setTimeout(() => onCommit(value), 180);
    return () => window.clearTimeout(handle);
  }, [value, onCommit]);

  return (
    <div
      className={cn(
        "relative flex items-center rounded-[10px] border border-hairline bg-surface-1 focus-within:border-hairline-strong",
        className,
      )}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent px-9 py-2 text-[13px] text-fg placeholder:text-fg-subtle focus:outline-none"
        // Esc clears — common operator shortcut for "back out of search"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onChange("");
          }
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
