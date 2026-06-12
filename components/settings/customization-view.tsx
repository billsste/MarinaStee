"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  Anchor,
  ChevronDown,
  ChevronUp,
  Plus,
  Archive,
  ArchiveRestore,
  Pencil,
  Check,
  X,
  Tag,
  Sparkles,
  Sailboat,
  Lock,
} from "lucide-react";
import { anyApi } from "convex/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabButton, TabStrip } from "@/components/ui/tab-button";
import {
  addPicklistValue,
  archivePicklistValue,
  movePicklistValue,
  restorePicklistValue,
  switchTenant,
  updateMarinaProfile,
  updatePicklistValue,
  useCurrentTenant,
  useMarinaProfile,
  usePicklists,
  usePicklistUsage,
  useTenants,
} from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type {
  Picklist,
  PicklistFieldKey,
  PicklistValue,
  RetentionOfferVariant,
} from "@/lib/types";
import { DocksView } from "@/components/settings/docks-view";
import { useTenantQuery } from "@/lib/use-tenant-query";

/*
 * Customization surface for the active tenant.
 *
 * Picklists tab: one collapsible panel per editable picklist with the
 * standard CRUD + archive + reorder controls. Custom fields + layout
 * tabs are scaffolded so the IA holds when those phases land, but
 * marked as future work for now.
 */
const VALID_TABS = ["picklists", "docks", "club"] as const;
type CustomizationTab = (typeof VALID_TABS)[number];

// Convex picklist shape (`convex/picklists.ts:list`). Values store
// `code`+`active`; mock stores `value`+`archived` — the adapter flips
// the field names. `editable` and `description` aren't in the Convex
// schema yet; we default `editable` to true (system picklists were a
// reserved future case in the mock anyway) and leave `description`
// blank — the panel still renders cleanly without it.
interface ConvexPicklist {
  _id: string;
  tenantId: string;
  field_key: string;
  label: string;
  values: {
    id: string;
    label: string;
    code: string;
    sort_order: number;
    active: boolean;
  }[];
}

function convexPicklistsToMock(rows: ConvexPicklist[]): Picklist[] {
  return rows.map((r) => ({
    id: r._id,
    tenant_id: r.tenantId,
    field_key: r.field_key as PicklistFieldKey,
    label: r.label,
    editable: true,
    values: r.values.map((v) => ({
      id: v.id,
      value: v.code,
      label: v.label,
      sort_order: v.sort_order,
      archived: !v.active,
    })),
  }));
}

const EMPTY_ARGS = {} as const;

export function CustomizationView() {
  // Tenant moved into TenantContextBar so the switcher and label stay
  // co-located. CustomizationView only needs the picklist data here.
  // Phase 3 — reads flow through the seam. Writes (add / update /
  // archive / restore / move) stay on the mock store for this wave;
  // they reach into multi-field state (`value` ↔ `code`, `archived`
  // ↔ `active`) and the Convex side replaces the whole `values[]`
  // array, so a dedicated Phase 4 pass is warranted.
  const mockPicklists = usePicklists();
  const picklists = useTenantQuery<Picklist[], ConvexPicklist[]>({
    mock: mockPicklists,
    convexRef: anyApi.picklists.list,
    convexArgs: EMPTY_ARGS,
    convexAdapter: convexPicklistsToMock,
  });
  const searchParams = useSearchParams();
  // Allow deep-linking via ?tab=docks (used by the redirect from
  // the legacy /settings/docks route).
  const requestedTab = searchParams.get("tab");
  const initialTab: CustomizationTab =
    requestedTab && (VALID_TABS as readonly string[]).includes(requestedTab)
      ? (requestedTab as CustomizationTab)
      : "picklists";
  const [tab, setTab] = React.useState<CustomizationTab>(initialTab);

  return (
    <div className="space-y-4">
      {/* Tenant context bar */}
      <TenantContextBar />

      {/* Canonical TabStrip + TabButton — matches /services/rates,
          /services/waitlist, /services/contracts. */}
      <TabStrip ariaLabel="Customization area">
        <TabButton
          active={tab === "picklists"}
          onClick={() => setTab("picklists")}
          label="Picklists"
          icon={<Tag className="size-3.5" />}
        />
        <TabButton
          active={tab === "docks"}
          onClick={() => setTab("docks")}
          label="Docks"
          icon={<Anchor className="size-3.5" />}
        />
        <TabButton
          active={tab === "club"}
          onClick={() => setTab("club")}
          label="Rental Club"
          icon={<Sailboat className="size-3.5" />}
        />
      </TabStrip>

      {tab === "picklists" && (
        <div className="space-y-3">
          <p className="text-[12px] text-fg-subtle">
            Each picklist controls the dropdown values used somewhere in the
            app. Renaming a label updates every existing record's display;
            archiving a value hides it from new selections but keeps
            historical records readable. Reordering changes the dropdown
            order app-wide.
          </p>
          {picklists
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((p) => (
              <PicklistPanel key={p.id} picklist={p} />
            ))}
        </div>
      )}

      {tab === "docks" && (
        <div className="space-y-3">
          <p className="text-[12px] text-fg-subtle">
            Docks group your slips and drive auto-generated slip ids. They
            behave like a picklist with extra fields — short name, prefix,
            sort order, and an active flag. Renaming a dock updates every
            slip on it.
          </p>
          <DocksView />
        </div>
      )}

      {tab === "club" && <RetentionVariantsPanel />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tenant context bar — current tenant + switcher dropdown
//
// Picklists, marina profile, retention variants, and other tenant-
// scoped data flip as soon as the switcher fires.
// ─────────────────────────────────────────────────────────────────────

function TenantContextBar() {
  const tenant = useCurrentTenant();
  const tenants = useTenants();

  return (
    <div className="flex items-center justify-between rounded-[12px] border border-hairline bg-surface-1 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">
          Tenant
        </div>
        {tenants.length > 1 ? (
          <select
            value={tenant?.id ?? ""}
            onChange={(e) => switchTenant(e.target.value)}
            className="mt-0.5 cursor-pointer rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[14px] font-medium text-fg focus:border-primary focus:outline-none"
            aria-label="Switch tenant"
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="text-[14px] font-medium text-fg">
            {tenant?.name ?? "—"}
          </div>
        )}
      </div>
      <div className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft/50 px-2.5 py-1 text-[11px] font-medium text-primary">
        <Sparkles className="size-3" />
        Super-user only
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Retention variants — Rental Club save offer config
//
// Toggle which variants the portal cancel sheet picks from. All-off
// is allowed (sheet falls back to half_off in that case to never
// leave a member without an offer). Live preview of estimated math
// helps the operator see what each variant means before enabling it.
// ─────────────────────────────────────────────────────────────────────

function RetentionVariantsPanel() {
  const profile = useMarinaProfile();
  const enabled: RetentionOfferVariant[] =
    profile.enabled_retention_variants ?? ["half_off", "free_month", "downgrade"];

  function toggle(v: RetentionOfferVariant) {
    const next = enabled.includes(v)
      ? enabled.filter((x) => x !== v)
      : ([...enabled, v] as RetentionOfferVariant[]);
    updateMarinaProfile({ enabled_retention_variants: next });
  }

  const variants: {
    key: RetentionOfferVariant;
    label: string;
    description: string;
  }[] = [
    {
      key: "half_off",
      label: "50% off next month",
      description:
        "Knocks 50% off the next monthly invoice. Lowest CAC, member stays at the same tier.",
    },
    {
      key: "free_month",
      label: "One free month",
      description:
        "Comp the next monthly invoice entirely. Higher cost; tends to convert well for cost-conscious members.",
    },
    {
      key: "downgrade",
      label: "Downgrade tier",
      description:
        "Step the member down to a lower-tier plan (premium → plus, plus → basic). Permanent price reduction.",
    },
  ];

  return (
    <div className="mt-4 space-y-3">
      <p className="text-[12px] text-fg-subtle">
        These offers appear in the member portal when a holder tries to
        cancel their Rental Club membership. The cancel sheet picks one
        at random from the active variants. See conversion-per-variant
        on the Reports tab.
      </p>
      <ul className="space-y-2">
        {variants.map((v) => {
          const isOn = enabled.includes(v.key);
          return (
            <li
              key={v.key}
              className={cn(
                "flex items-start gap-3 rounded-[10px] border p-3 transition-colors",
                isOn
                  ? "border-primary/40 bg-primary-soft/30"
                  : "border-hairline bg-surface-1"
              )}
            >
              <button
                type="button"
                onClick={() => toggle(v.key)}
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                  isOn
                    ? "border-primary bg-primary text-on-primary"
                    : "border-hairline bg-surface-2"
                )}
                aria-label={isOn ? `Disable ${v.label}` : `Enable ${v.label}`}
              >
                {isOn && <Check className="size-3" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-fg">{v.label}</div>
                <p className="mt-0.5 text-[11px] text-fg-tertiary">
                  {v.description}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {enabled.length === 0 && (
        <p className="rounded-[8px] border border-status-warn/30 bg-status-warn/10 px-3 py-2 text-[11px] text-status-warn">
          All variants disabled — the portal will fall back to &quot;50% off&quot;
          so members never see an empty cancel sheet.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────

function PicklistPanel({ picklist }: { picklist: Picklist }) {
  const [open, setOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [newLabel, setNewLabel] = React.useState("");
  const usage = usePicklistUsage(picklist.field_key);

  // Sort with archived values pushed to the bottom regardless of sort_order
  // so the active set reads cleanly.
  const sorted = [...picklist.values].sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    return a.sort_order - b.sort_order;
  });
  const activeCount = picklist.values.filter((v) => !v.archived).length;
  const archivedCount = picklist.values.length - activeCount;

  function submitAdd() {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    addPicklistValue(picklist.field_key, trimmed);
    setNewLabel("");
    setAddOpen(false);
  }

  return (
    <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 border-b border-hairline px-4 py-3 text-left transition-colors hover:bg-surface-2"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-medium text-fg">{picklist.label}</h3>
            <Badge tone="neutral" size="sm">
              {activeCount}
            </Badge>
            {archivedCount > 0 && (
              <Badge tone="outline" size="sm">
                {archivedCount} archived
              </Badge>
            )}
            <code className="rounded-[4px] bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-fg-tertiary">
              {picklist.field_key}
            </code>
            {!picklist.editable && (
              <span className="inline-flex items-center gap-1 text-[10px] text-fg-tertiary">
                <Lock className="size-3" />
                System
              </span>
            )}
          </div>
          {picklist.description && (
            <p className="mt-0.5 text-[12px] text-fg-subtle">
              {picklist.description}
            </p>
          )}
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-fg-subtle transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="space-y-2 p-3">
          {sorted.map((v, idx) => (
            <PicklistValueRow
              key={v.id}
              value={v}
              fieldKey={picklist.field_key}
              isFirst={idx === 0 || sorted[idx - 1]?.archived !== v.archived}
              isLast={
                idx === sorted.length - 1 ||
                sorted[idx + 1]?.archived !== v.archived
              }
              editable={picklist.editable}
              usageCount={usage.get(v.value) ?? 0}
              isLastActive={!v.archived && activeCount <= 1}
            />
          ))}

          {picklist.editable && (
            <>
              {addOpen ? (
                <div className="flex items-center gap-2 rounded-[8px] border border-primary/40 bg-primary-soft/30 px-2 py-1.5">
                  <input
                    autoFocus
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitAdd();
                      if (e.key === "Escape") {
                        setAddOpen(false);
                        setNewLabel("");
                      }
                    }}
                    placeholder="New value label…"
                    className="flex-1 bg-transparent text-[13px] text-fg placeholder:text-fg-tertiary focus:outline-none"
                  />
                  <Button variant="primary" size="sm" onClick={submitAdd}>
                    Add
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddOpen(false);
                      setNewLabel("");
                    }}
                    className="rounded-[6px] p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
                    aria-label="Cancel"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className="inline-flex items-center gap-1 rounded-[6px] border border-dashed border-hairline-strong bg-surface-2 px-2.5 py-1 text-[11px] text-fg-subtle hover:bg-surface-3 hover:text-fg"
                >
                  <Plus className="size-3" />
                  Add value
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PicklistValueRow({
  value,
  fieldKey,
  isFirst,
  isLast,
  editable,
  usageCount,
  isLastActive,
}: {
  value: PicklistValue;
  fieldKey: PicklistFieldKey;
  isFirst: boolean;
  isLast: boolean;
  editable: boolean;
  /** How many records currently reference this value. Shown next to
   *  the value + used to warn before archive. */
  usageCount: number;
  /** True when this is the only non-archived value left — archiving
   *  would leave the picklist empty, which breaks new-selection
   *  dropdowns. Guards against the footgun. */
  isLastActive: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draftLabel, setDraftLabel] = React.useState(value.label);

  function saveLabel() {
    const trimmed = draftLabel.trim();
    if (!trimmed || trimmed === value.label) {
      setDraftLabel(value.label);
      setEditing(false);
      return;
    }
    updatePicklistValue(fieldKey, value.id, { label: trimmed });
    setEditing(false);
  }

  function attemptArchive() {
    if (isLastActive) {
      // Block with an explanation — keep at least one active value.
      window.alert(
        `Can't archive "${value.label}" — it's the only active value left in this picklist. Add another value first, then come back.`
      );
      return;
    }
    if (usageCount > 0) {
      const ok = window.confirm(
        `Archive "${value.label}"?\n\n` +
          `${usageCount} record${usageCount === 1 ? " currently uses" : "s currently use"} ` +
          `this value. They'll keep displaying it as "${value.label} (archived)" — but it won't ` +
          `appear in new-selection dropdowns going forward.`
      );
      if (!ok) return;
    }
    archivePicklistValue(fieldKey, value.id);
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-[8px] border bg-surface-2 px-2.5 py-1.5",
        value.archived
          ? "border-dashed border-hairline opacity-60"
          : "border-hairline"
      )}
    >
      {/* Reorder controls — only on non-archived rows */}
      {!value.archived && editable && (
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            disabled={isFirst}
            onClick={() => movePicklistValue(fieldKey, value.id, "up")}
            className={cn(
              "rounded-[4px] p-0.5 text-fg-tertiary",
              isFirst
                ? "cursor-not-allowed opacity-30"
                : "hover:bg-surface-3 hover:text-fg"
            )}
            aria-label="Move up"
          >
            <ChevronUp className="size-3" />
          </button>
          <button
            type="button"
            disabled={isLast}
            onClick={() => movePicklistValue(fieldKey, value.id, "down")}
            className={cn(
              "rounded-[4px] p-0.5 text-fg-tertiary",
              isLast
                ? "cursor-not-allowed opacity-30"
                : "hover:bg-surface-3 hover:text-fg"
            )}
            aria-label="Move down"
          >
            <ChevronDown className="size-3" />
          </button>
        </div>
      )}
      {value.archived && (
        <span className="inline-block size-3" aria-hidden />
      )}

      {/* Label (inline-edit) */}
      {editing ? (
        <input
          autoFocus
          type="text"
          value={draftLabel}
          onChange={(e) => setDraftLabel(e.target.value)}
          onBlur={saveLabel}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveLabel();
            if (e.key === "Escape") {
              setDraftLabel(value.label);
              setEditing(false);
            }
          }}
          className="flex-1 rounded-[4px] border border-hairline-strong bg-surface-1 px-2 py-0.5 text-[13px] text-fg focus:border-primary/40 focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => editable && setEditing(true)}
          className={cn(
            "flex flex-1 min-w-0 items-baseline gap-1.5 text-left",
            editable && "cursor-pointer"
          )}
        >
          <span className="text-[13px] text-fg">{value.label}</span>
          <code className="font-mono text-[10px] text-fg-tertiary">
            {value.value}
          </code>
          {usageCount > 0 && (
            <span
              className="text-[10px] tabular text-fg-tertiary"
              title={`${usageCount} record${usageCount === 1 ? "" : "s"} use this value`}
            >
              · {usageCount} in use
            </span>
          )}
          {value.archived && (
            <span className="text-[10px] text-fg-tertiary italic">archived</span>
          )}
          {editable && (
            <Pencil className="size-3 text-fg-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </button>
      )}

      {/* Save indicator while editing */}
      {editing && (
        <Check className="size-3 text-status-ok" aria-hidden />
      )}

      {/* Archive / Restore */}
      {!editing && editable && (
        <button
          type="button"
          onClick={() =>
            value.archived
              ? restorePicklistValue(fieldKey, value.id)
              : attemptArchive()
          }
          disabled={isLastActive && !value.archived}
          className={cn(
            "rounded-[4px] p-1",
            isLastActive && !value.archived
              ? "cursor-not-allowed text-fg-tertiary opacity-40"
              : "text-fg-tertiary hover:bg-surface-3 hover:text-fg"
          )}
          aria-label={value.archived ? "Restore" : "Archive"}
          title={
            isLastActive && !value.archived
              ? "Can't archive — last active value in this picklist"
              : value.archived
              ? "Restore value"
              : usageCount > 0
              ? `Archive (${usageCount} in use — will prompt for confirmation)`
              : "Archive value"
          }
        >
          {value.archived ? (
            <ArchiveRestore className="size-3.5" />
          ) : (
            <Archive className="size-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

