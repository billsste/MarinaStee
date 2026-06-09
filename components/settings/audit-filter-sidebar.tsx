"use client";

import * as React from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Audit Log Explorer — left filter sidebar.
 *
 * Filter dimensions:
 *  - Actor          : single-select (distinct actor_label observed in
 *                     the visible window)
 *  - Entity         : multi-select checkbox list (target_entity values)
 *  - Action type    : free-text contains
 *  - Date range     : from / to ISO date pickers
 *  - Provenance     : via_agent / via_bulk / via_closeout checkboxes
 *
 * The "Last 24h / 7d / 30d / Custom" date scope is owned by the parent
 * page header, not this sidebar — the sidebar just consumes the
 * resulting `fromIso`/`toIso` and lets the user override via the Custom
 * range pickers.
 *
 * The sidebar is uncontrolled wrt to facet expansion (open/closed
 * collapsible sections) but fully controlled wrt the actual filter
 * state — the parent owns `state` and we call `onChange` on every
 * mutation. This keeps the filter state serializable (so deep links
 * could ship later) and keeps the sidebar trivially mock-able in tests.
 */

export interface AuditFilterState {
  actorUserId?: string;
  // actorLabel is purely a UI display field — the data layer keys on
  // actorUserId. Kept here so the dropdown can show "Bills, Steven"
  // even when the underlying id is a long Clerk subject.
  actorLabel?: string;
  entities: string[];
  actionTypeContains: string;
  fromIso?: string;
  toIso?: string;
  viaAgent: boolean;
  viaBulk: boolean;
  viaCloseout: boolean;
}

export const EMPTY_FILTER_STATE: AuditFilterState = {
  entities: [],
  actionTypeContains: "",
  viaAgent: false,
  viaBulk: false,
  viaCloseout: false,
};

interface AuditFilterSidebarProps {
  state: AuditFilterState;
  onChange: (next: AuditFilterState) => void;
  // Distinct actor + entity values observed in the visible result set
  // — keeps the sidebar adaptive (you only filter by what you can
  // actually see). Parent computes these from the search result.
  actorOptions: { id: string; label: string; count: number }[];
  entityOptions: { name: string; count: number }[];
  className?: string;
}

export function AuditFilterSidebar({
  state,
  onChange,
  actorOptions,
  entityOptions,
  className,
}: AuditFilterSidebarProps) {
  const update = React.useCallback(
    (patch: Partial<AuditFilterState>) => onChange({ ...state, ...patch }),
    [state, onChange],
  );

  const isDirty =
    !!state.actorUserId ||
    state.entities.length > 0 ||
    state.actionTypeContains.length > 0 ||
    !!state.fromIso ||
    !!state.toIso ||
    state.viaAgent ||
    state.viaBulk ||
    state.viaCloseout;

  return (
    <aside
      className={cn(
        "flex w-[240px] shrink-0 flex-col gap-1 rounded-[12px] border border-hairline bg-surface-1 p-3",
        className,
      )}
    >
      <div className="flex items-center justify-between px-1 pb-2">
        <div className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
          Filters
        </div>
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTER_STATE)}
          disabled={!isDirty}
          className={cn(
            "inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium transition-colors",
            isDirty
              ? "text-primary hover:bg-surface-2"
              : "cursor-not-allowed text-fg-subtle/50",
          )}
        >
          <RotateCcw className="size-3" /> Clear
        </button>
      </div>

      {/* Actor */}
      <FilterSection title="Actor" defaultOpen>
        <select
          value={state.actorUserId ?? ""}
          onChange={(e) => {
            const id = e.target.value || undefined;
            const label = id
              ? actorOptions.find((a) => a.id === id)?.label
              : undefined;
            update({ actorUserId: id, actorLabel: label });
          }}
          className="w-full appearance-none rounded-[6px] border border-hairline bg-surface-2 px-2 py-1 text-[12px] text-fg focus:outline-none"
        >
          <option value="">Anyone</option>
          {actorOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label} ({opt.count})
            </option>
          ))}
        </select>
      </FilterSection>

      {/* Entity — surfaced to operators as "What changed" because
          "entity" is internal data-model language a marina owner won't
          parse. The underlying field stays target_entity. */}
      <FilterSection title="What changed" defaultOpen>
        {entityOptions.length === 0 ? (
          <div className="text-[11px] text-fg-subtle">Nothing in scope yet</div>
        ) : (
          <div className="flex flex-col gap-1">
            {entityOptions.map((opt) => {
              const checked = state.entities.includes(opt.name);
              return (
                <label
                  key={opt.name}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-[4px] px-1 py-0.5 hover:bg-surface-2"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...state.entities, opt.name]
                          : state.entities.filter((s) => s !== opt.name);
                        update({ entities: next });
                      }}
                      className="size-3.5 accent-primary"
                    />
                    <span className="font-mono text-[11px] text-fg">
                      {opt.name}
                    </span>
                  </span>
                  <span className="tabular text-[10px] text-fg-subtle">
                    {opt.count}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </FilterSection>

      {/* Action — operator-facing label. The underlying field is still
          action_type (dotted-code enum like `boater.update`), but the
          placeholder now shows human verbs the owner can actually type. */}
      <FilterSection title="Action" defaultOpen>
        <input
          type="text"
          value={state.actionTypeContains}
          onChange={(e) => update({ actionTypeContains: e.target.value })}
          placeholder="e.g. updated boater, sent contract, paid bill"
          className="w-full rounded-[6px] border border-hairline bg-surface-2 px-2 py-1 text-[12px] text-fg placeholder:text-fg-subtle focus:outline-none"
        />
      </FilterSection>

      {/* Date range — these are the *custom* overrides; the parent
          header's preset chips (24h/7d/30d) write into the same state. */}
      <FilterSection title="Date range">
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
              From
            </span>
            <input
              type="date"
              value={state.fromIso ? state.fromIso.slice(0, 10) : ""}
              onChange={(e) =>
                update({
                  fromIso: e.target.value
                    ? `${e.target.value}T00:00:00.000Z`
                    : undefined,
                })
              }
              className="rounded-[6px] border border-hairline bg-surface-2 px-2 py-1 text-[12px] text-fg focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
              To
            </span>
            <input
              type="date"
              value={state.toIso ? state.toIso.slice(0, 10) : ""}
              onChange={(e) =>
                update({
                  toIso: e.target.value
                    ? `${e.target.value}T23:59:59.999Z`
                    : undefined,
                })
              }
              className="rounded-[6px] border border-hairline bg-surface-2 px-2 py-1 text-[12px] text-fg focus:outline-none"
            />
          </label>
        </div>
      </FilterSection>

      {/* Provenance — surfaced as "Triggered by" because marina owners
          don't think of agent vs bulk vs closeout as a "provenance" axis.
          They think "who or what kicked this off." Underlying via_agent /
          via_bulk / via_closeout fields unchanged. */}
      <FilterSection title="Triggered by" defaultOpen>
        <div className="flex flex-col gap-1">
          <CheckboxRow
            label="The agent"
            checked={state.viaAgent}
            onChange={(b) => update({ viaAgent: b })}
            tone="primary"
          />
          <CheckboxRow
            label="A scheduled job"
            checked={state.viaBulk}
            onChange={(b) => update({ viaBulk: b })}
            tone="info"
          />
          <CheckboxRow
            label="A day-end closeout"
            checked={state.viaCloseout}
            onChange={(b) => update({ viaCloseout: b })}
            tone="neutral"
          />
        </div>
      </FilterSection>
    </aside>
  );
}

function FilterSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="border-t border-hairline/60 first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-1 py-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted hover:text-fg"
      >
        <span>{title}</span>
        <ChevronDown
          className={cn(
            "size-3.5 text-fg-subtle transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="px-1 pb-3">{children}</div>}
    </div>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange,
  tone,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  tone: "primary" | "info" | "neutral";
}) {
  const toneClass =
    tone === "primary"
      ? "accent-primary"
      : tone === "info"
        ? "accent-[var(--status-info)]"
        : "accent-fg-subtle";
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-[4px] px-1 py-0.5 hover:bg-surface-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={cn("size-3.5", toneClass)}
      />
      <span className="text-[12px] text-fg">{label}</span>
    </label>
  );
}
