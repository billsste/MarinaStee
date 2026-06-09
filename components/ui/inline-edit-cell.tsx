"use client";

import * as React from "react";
import { Check, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Reusable click-cell inline editor.
 *
 * Display state: renders `value` as plain text. Pencil affordance fades
 * in on row hover (uses `group-hover` on a `.group` ancestor — so always
 * wrap the row in `className="group"` if you want the affordance).
 *
 * Edit state: swaps to an input. Enter or blur saves, Escape cancels.
 *
 * The component is uncontrolled in edit mode — it owns the draft value
 * during editing and only calls onSave when the operator commits. Empty
 * + required is blocked at the call site (the onSave handler can reject
 * and the cell will revert to the prior value on blur).
 *
 * Supports text / number / money / select kinds. For boolean toggles use
 * a plain <input type="checkbox"> — inline-edit-cell is overkill there.
 */

type InlineEditKind = "text" | "number" | "money" | "select";

type InlineEditCellProps = {
  value: string | number;
  onSave: (next: string | number) => void;
  kind?: InlineEditKind;
  /** Options for kind="select". */
  options?: { value: string; label: string }[];
  /** Format the display string (e.g. money formatter). */
  format?: (v: string | number) => string;
  /** Placeholder shown when value is empty / missing. */
  placeholder?: string;
  /** Override the className on the display element. */
  className?: string;
  /** Width hint for the inline input (e.g. "w-32"). */
  inputClassName?: string;
  /** Whether the cell is editable. Defaults to true. */
  editable?: boolean;
  /** Show pencil icon on hover. Defaults to true when editable. */
  affordance?: boolean;
  /** Stop click propagation so row-click handlers don't fire. */
  stopPropagation?: boolean;
};

export function InlineEditCell({
  value,
  onSave,
  kind = "text",
  options,
  format,
  placeholder = "—",
  className,
  inputClassName,
  editable = true,
  affordance = true,
  stopPropagation = true,
}: InlineEditCellProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<string>(String(value ?? ""));

  // Sync incoming value updates while not editing
  React.useEffect(() => {
    if (!editing) setDraft(String(value ?? ""));
  }, [value, editing]);

  const displayed =
    format != null
      ? format(value)
      : value === "" || value == null
      ? placeholder
      : String(value);

  function commit() {
    const trimmed = draft.trim();
    if (kind === "number" || kind === "money") {
      const n = Number(trimmed);
      if (Number.isFinite(n)) {
        onSave(n);
      }
    } else {
      onSave(trimmed);
    }
    setEditing(false);
  }
  function cancel() {
    setDraft(String(value ?? ""));
    setEditing(false);
  }

  if (!editable) {
    return <span className={className}>{displayed}</span>;
  }

  if (editing) {
    if (kind === "select" && options) {
      return (
        <select
          autoFocus
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            // commit immediately on select change for snappier UX
            const next = e.target.value;
            onSave(next);
            setEditing(false);
          }}
          onBlur={() => setEditing(false)}
          onClick={(e) => stopPropagation && e.stopPropagation()}
          className={cn(
            "rounded-[6px] border border-primary/40 bg-surface-1 px-2 py-0.5 text-[13px] text-fg focus:outline-none",
            inputClassName
          )}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        autoFocus
        type="text"
        inputMode={kind === "number" || kind === "money" ? "decimal" : "text"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={(e) => stopPropagation && e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        className={cn(
          "rounded-[6px] border border-primary/40 bg-surface-1 px-2 py-0.5 text-[13px] text-fg focus:outline-none",
          inputClassName
        )}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        setEditing(true);
      }}
      className={cn(
        // `peer/cell` lets the row know which cell is being targeted directly
        // so siblings can react. `max-w-full min-w-0 overflow-hidden` lets
        // the wrapping span's `truncate` actually clip long values inside
        // the cell instead of letting the button overflow its grid track.
        "peer/cell inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden rounded-[6px] px-1 py-0.5 text-left transition-colors hover:bg-surface-3",
        className
      )}
      title="Click to edit"
    >
      <span
        className={cn(
          "min-w-0 truncate",
          value === "" || value == null ? "text-fg-tertiary italic" : ""
        )}
      >
        {displayed}
      </span>
      {affordance && (
        // Clearly visible at rest so a non-technical operator knows the
        // cell is editable; brightens on row hover, full on direct cell
        // hover. Single rule that propagates to every InlineEditCell in
        // the app. Previous opacity-25 was too subtle — the marina-owner
        // walkthrough flagged that a 55-year-old would miss the pencil
        // entirely on contact-edit rows.
        <Pencil className="size-3 shrink-0 text-fg-tertiary opacity-60 transition-opacity group-hover:opacity-90 hover:opacity-100" />
      )}
    </button>
  );
}

/**
 * Inline boolean toggle. Click flips. No "edit mode" — just renders the
 * current state as a pill with a clear on/off affordance.
 */
export function InlineToggle({
  value,
  onSave,
  onLabel = "On",
  offLabel = "Off",
  stopPropagation = true,
}: {
  value: boolean;
  onSave: (next: boolean) => void;
  onLabel?: string;
  offLabel?: string;
  stopPropagation?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        onSave(!value);
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
        value
          ? "border-status-ok/30 bg-status-ok/10 text-status-ok hover:bg-status-ok/20"
          : "border-hairline bg-surface-2 text-fg-subtle hover:bg-surface-3"
      )}
      title={`Click to toggle ${value ? "off" : "on"}`}
    >
      {value && <Check className="size-3" />}
      {value ? onLabel : offLabel}
    </button>
  );
}
