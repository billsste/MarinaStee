"use client";

import * as React from "react";
import { Sparkles, Layers, CheckCircle2, ChevronDown } from "lucide-react";
import { anyApi } from "convex/server";
import {
  useAuditLogSearch,
  useCurrentTenant,
  type AuditSearchArgs,
} from "@/lib/client-store";
import type { AuditLogEntry } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import { cn } from "@/lib/utils";
import { useTenantQuery } from "@/lib/use-tenant-query";
import { AuditSearchBar } from "./audit-search-bar";
import {
  AuditFilterSidebar,
  EMPTY_FILTER_STATE,
  type AuditFilterState,
} from "./audit-filter-sidebar";
import { AuditRowDrawer } from "./audit-row-drawer";

/*
 * Settings → Audit Log — Explorer.
 *
 * Layout:
 *   - Top header bar:
 *       • Free-text search bar (debounced)
 *       • Date-scope toggle: Last 24h / 7d / 30d / All / Custom
 *       • Result count + provenance summary
 *   - Left column (240px):
 *       • AuditFilterSidebar — actor / entity / action-type / date /
 *         provenance facets, with adaptive option counts derived from
 *         the visible result window.
 *   - Main column (flex-1):
 *       • Audit row list. Paginated client-side at 50 rows per page
 *         so we never mount more than ~50 DOM nodes at once; "Load
 *         more" expands the displayed window. Clicking a row opens
 *         the drawer.
 *   - Right side drawer:
 *       • AuditRowDrawer — slides in when a row is selected, mounted
 *         alongside the page tree so its `<aside>` overlays cleanly.
 *
 * Source-routing pattern matches every other migrated surface: the
 * mock-store hook (`useAuditLogSearch`) is called unconditionally so
 * React's hook order stays stable; `useTenantQuery` chooses between
 * mock + Convex (`api.audit.search`) at the read seam.
 */

// Shape returned by `convex/audit.ts:search`. Matches the doc fields on
// the Convex auditLog table; the adapter reshapes back to the mock
// `AuditLogEntry` shape the explorer consumes.
interface ConvexAuditRow {
  _id: string;
  tenantId: string;
  actor_user_id?: string;
  actor_label: string;
  ip?: string;
  action_type: string;
  target_entity: string;
  target_id?: string;
  payload_delta?: string;
  via_agent?: boolean;
  agent_prompt?: string;
  created_at: string;
}

interface ConvexAuditSearchResult {
  rows: ConvexAuditRow[];
  hasMore: boolean;
  nextCursor?: string;
}

interface MockSearchShape {
  rows: AuditLogEntry[];
  hasMore: boolean;
  nextCursor?: string;
}

function convexSearchToMock(r: ConvexAuditSearchResult): MockSearchShape {
  return {
    rows: r.rows.map((row) => ({
      id: row._id,
      tenant_id: row.tenantId,
      actor_user_id: row.actor_user_id,
      actor_label: row.actor_label,
      ip: row.ip,
      action_type: row.action_type,
      target_entity: row.target_entity,
      target_id: row.target_id,
      payload_delta: row.payload_delta,
      via_agent: row.via_agent,
      agent_prompt: row.agent_prompt,
      created_at: row.created_at,
    })),
    hasMore: r.hasMore,
    nextCursor: r.nextCursor,
  };
}

// ────────────────────────────────────────────────────────────
// Date scope presets — header toggle. Values are computed at render
// time; "all" omits both bounds so the data layer falls back to the
// full visible window.
// ────────────────────────────────────────────────────────────

type Scope = "24h" | "7d" | "30d" | "all" | "custom";

function scopeBounds(scope: Scope): {
  fromIso?: string;
  toIso?: string;
} {
  const now = Date.now();
  switch (scope) {
    case "24h":
      return { fromIso: new Date(now - 24 * 3_600_000).toISOString() };
    case "7d":
      return { fromIso: new Date(now - 7 * 86_400_000).toISOString() };
    case "30d":
      return { fromIso: new Date(now - 30 * 86_400_000).toISOString() };
    case "all":
    case "custom":
      return {};
  }
}

// How many rows to render in the main list at once. We mount one
// `<li>` per row, so this is the upper bound on DOM nodes at any
// given moment regardless of how many rows the backend returns. The
// "Load more" affordance expands by another `PAGE_SIZE` rather than
// fetching a new server page — search results already come back at
// 50 rows; expanding the displayed window asks the data layer for
// `pageSize: PAGE_SIZE * pages`.
const PAGE_SIZE = 50;

export function AuditLogView() {
  const tenant = useCurrentTenant();

  // ── Filter + search state ──────────────────────────────────────────
  const [filterState, setFilterState] =
    React.useState<AuditFilterState>(EMPTY_FILTER_STATE);
  const [searchText, setSearchText] = React.useState("");
  const [committedSearch, setCommittedSearch] = React.useState("");
  // Default to "all" so new operators land on a populated view. Once a
  // marina has months of history they'll scope down themselves; an
  // empty 7d window on a fresh tenant just makes the page look broken.
  const [scope, setScope] = React.useState<Scope>("all");
  const [pages, setPages] = React.useState(1);
  const [selected, setSelected] = React.useState<AuditLogEntry | null>(null);

  // Reset visible window when a filter / search changes — operators
  // shouldn't have to scroll back to the top after every facet click.
  React.useEffect(() => {
    setPages(1);
  }, [filterState, committedSearch, scope]);

  // The scope's date bounds override the sidebar's custom bounds
  // unless the user is in "custom" mode — at which point the
  // sidebar's `fromIso`/`toIso` win. This keeps the chips + the
  // pickers in sync without fighting each other.
  const scopeWindow = scopeBounds(scope);
  const effectiveFrom =
    scope === "custom" ? filterState.fromIso : scopeWindow.fromIso;
  const effectiveTo =
    scope === "custom" ? filterState.toIso : scopeWindow.toIso;

  // Convex args — memoized to keep useQuery's subscription stable.
  const searchArgs: AuditSearchArgs = React.useMemo(
    () => ({
      text: committedSearch || undefined,
      actorUserId: filterState.actorUserId,
      entities:
        filterState.entities.length > 0 ? filterState.entities : undefined,
      actionTypeContains: filterState.actionTypeContains || undefined,
      fromIso: effectiveFrom,
      toIso: effectiveTo,
      viaAgent: filterState.viaAgent ? true : undefined,
      viaBulk: filterState.viaBulk ? true : undefined,
      viaCloseout: filterState.viaCloseout ? true : undefined,
      pageSize: PAGE_SIZE * pages,
    }),
    [
      committedSearch,
      filterState.actorUserId,
      filterState.entities,
      filterState.actionTypeContains,
      filterState.viaAgent,
      filterState.viaBulk,
      filterState.viaCloseout,
      effectiveFrom,
      effectiveTo,
      pages,
    ],
  );

  // Mock subscription — runs unconditionally for hook-order stability.
  const mockResult = useAuditLogSearch(searchArgs);

  const result = useTenantQuery<MockSearchShape, ConvexAuditSearchResult>({
    mock: mockResult,
    convexRef: anyApi.audit.search,
    convexArgs: searchArgs as unknown as Record<string, unknown>,
    convexAdapter: convexSearchToMock,
  });

  // Derive actor + entity facets from the result window. The sidebar
  // adapts to whatever's currently visible so the operator sees real
  // options instead of a stale union of every actor that ever existed.
  const { actorOptions, entityOptions } = React.useMemo(() => {
    const actorMap = new Map<
      string,
      { id: string; label: string; count: number }
    >();
    const entityMap = new Map<string, number>();
    for (const r of result.rows) {
      const aid = r.actor_user_id ?? r.actor_label;
      const existing = actorMap.get(aid);
      if (existing) existing.count += 1;
      else actorMap.set(aid, { id: aid, label: r.actor_label, count: 1 });
      entityMap.set(
        r.target_entity,
        (entityMap.get(r.target_entity) ?? 0) + 1,
      );
    }
    return {
      actorOptions: Array.from(actorMap.values()).sort((a, b) =>
        a.label.localeCompare(b.label),
      ),
      entityOptions: Array.from(entityMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    };
  }, [result.rows]);

  // Provenance summary — count rows by provenance bucket so the
  // header can render an at-a-glance distribution.
  const provenanceSummary = React.useMemo(() => {
    let agent = 0;
    let bulk = 0;
    let closeout = 0;
    let manual = 0;
    for (const r of result.rows) {
      if (r.via_agent) agent += 1;
      else if (r.action_type.includes("_via_bulk")) bulk += 1;
      else if (r.action_type.includes(".closeout.")) closeout += 1;
      else manual += 1;
    }
    return { agent, bulk, closeout, manual };
  }, [result.rows]);

  return (
    <div className="space-y-4">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <AuditSearchBar
            value={searchText}
            onChange={setSearchText}
            onCommit={setCommittedSearch}
            className="sm:flex-1"
          />
          <ScopeToggle scope={scope} onChange={setScope} />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-tertiary">
          {tenant && (
            <>
              <span>Scoped to</span>
              <Badge tone="info" size="sm">
                {tenant.name}
              </Badge>
              <span>·</span>
            </>
          )}
          <span className="tabular">
            {result.rows.length} {result.rows.length === 1 ? "row" : "rows"}
            {result.hasMore && " (more available)"}
          </span>
          <span>·</span>
          <ProvenancePip
            icon={<Sparkles className="size-3" />}
            label="agent"
            count={provenanceSummary.agent}
            tone="primary"
          />
          <ProvenancePip
            icon={<Layers className="size-3" />}
            label="bulk"
            count={provenanceSummary.bulk}
            tone="info"
          />
          <ProvenancePip
            icon={<CheckCircle2 className="size-3" />}
            label="closeout"
            count={provenanceSummary.closeout}
            tone="neutral"
          />
          <ProvenancePip
            label="manual"
            count={provenanceSummary.manual}
            tone="muted"
          />
        </div>
      </div>

      {/* ── Body: sidebar + list ─────────────────────────────────── */}
      <div className="flex gap-4">
        <AuditFilterSidebar
          state={filterState}
          onChange={setFilterState}
          actorOptions={actorOptions}
          entityOptions={entityOptions}
        />

        <div className="min-w-0 flex-1">
          {result.rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-[12px] border border-hairline bg-surface-1 px-6 py-16 text-center">
              <p className="text-[13px] text-fg-subtle">
                No audit rows match the current filters.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilterState(EMPTY_FILTER_STATE);
                  setSearchText("");
                  setCommittedSearch("");
                  setScope("all");
                }}
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-hairline rounded-[12px] border border-hairline bg-surface-1">
              {result.rows.map((r) => (
                <AuditRow
                  key={r.id}
                  row={r}
                  active={selected?.id === r.id}
                  onSelect={() => setSelected(r)}
                />
              ))}
              {result.hasMore && (
                <li className="px-4 py-3 text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPages((p) => p + 1)}
                  >
                    Load {PAGE_SIZE} more
                  </Button>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      {/* ── Drawer ───────────────────────────────────────────────── */}
      <AuditRowDrawer row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Row card
// ────────────────────────────────────────────────────────────

function AuditRow({
  row,
  active,
  onSelect,
}: {
  row: AuditLogEntry;
  active: boolean;
  onSelect: () => void;
}) {
  const provenance = describeProvenance(row);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "block w-full px-4 py-3 text-left transition-colors hover:bg-surface-2/60",
          active && "bg-surface-2/60",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ProvenanceIcon provenance={provenance} />
              <span className="text-[13px] font-medium text-fg">
                {row.action_type}
              </span>
              <span className="text-[11px] text-fg-tertiary">·</span>
              <span className="font-mono text-[11px] text-fg-tertiary">
                {row.target_entity}
                {row.target_id && (
                  <>
                    {":"}
                    <span className="text-fg-muted">
                      {shortId(row.target_id)}
                    </span>
                  </>
                )}
              </span>
            </div>
            <div className="mt-0.5 text-[12px] text-fg-subtle">
              {row.actor_label}
              {row.via_agent && row.agent_prompt && (
                <>
                  {" · "}
                  <span className="italic">&ldquo;{row.agent_prompt}&rdquo;</span>
                </>
              )}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[11px] text-fg-subtle tabular">
              <LocalTime iso={row.created_at} fmt="short_datetime" />
            </div>
            <ProvenanceChip provenance={provenance} />
          </div>
        </div>
      </button>
    </li>
  );
}

// ────────────────────────────────────────────────────────────
// Header sub-components
// ────────────────────────────────────────────────────────────

function ScopeToggle({
  scope,
  onChange,
}: {
  scope: Scope;
  onChange: (s: Scope) => void;
}) {
  const opts: { key: Scope; label: string }[] = [
    { key: "24h", label: "24h" },
    { key: "7d", label: "7d" },
    { key: "30d", label: "30d" },
    { key: "all", label: "All" },
    { key: "custom", label: "Custom" },
  ];
  return (
    <div className="inline-flex shrink-0 rounded-[8px] border border-hairline bg-surface-2 p-0.5">
      {opts.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={cn(
            "rounded-[6px] px-2.5 py-1 text-[12px] font-medium transition-colors",
            scope === opt.key
              ? "bg-surface-1 text-fg shadow-sm"
              : "text-fg-subtle hover:text-fg",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ProvenancePip({
  icon,
  label,
  count,
  tone,
}: {
  icon?: React.ReactNode;
  label: string;
  count: number;
  tone: "primary" | "info" | "neutral" | "muted";
}) {
  if (count === 0) return null;
  const toneClass =
    tone === "primary"
      ? "text-primary"
      : tone === "info"
        ? "text-[var(--status-info)]"
        : tone === "neutral"
          ? "text-fg-muted"
          : "text-fg-subtle";
  return (
    <span className={cn("inline-flex items-center gap-1", toneClass)}>
      {icon}
      <span className="tabular">{count}</span>
      <span>{label}</span>
    </span>
  );
}

// ────────────────────────────────────────────────────────────
// Provenance helpers — shared with the drawer (kept inline to avoid a
// micro-lib + the explorer + drawer ship as one feature, so they're
// allowed to share these small helpers).
// ────────────────────────────────────────────────────────────

type Provenance = "agent" | "bulk" | "closeout" | "manual";

function describeProvenance(row: AuditLogEntry): Provenance {
  if (row.via_agent) return "agent";
  if (row.action_type.includes("_via_bulk")) return "bulk";
  if (row.action_type.includes(".closeout.")) return "closeout";
  return "manual";
}

function ProvenanceIcon({ provenance }: { provenance: Provenance }) {
  switch (provenance) {
    case "agent":
      return <Sparkles className="size-3.5 shrink-0 text-primary" />;
    case "bulk":
      return (
        <Layers className="size-3.5 shrink-0 text-[var(--status-info)]" />
      );
    case "closeout":
      return <CheckCircle2 className="size-3.5 shrink-0 text-fg-subtle" />;
    case "manual":
      return <ChevronDown className="size-3.5 shrink-0 text-transparent" />;
  }
}

function ProvenanceChip({ provenance }: { provenance: Provenance }) {
  switch (provenance) {
    case "agent":
      return (
        <Badge tone="primary" size="sm" className="mt-1">
          agent
        </Badge>
      );
    case "bulk":
      return (
        <Badge tone="info" size="sm" className="mt-1">
          bulk
        </Badge>
      );
    case "closeout":
      return (
        <Badge tone="neutral" size="sm" className="mt-1">
          closeout
        </Badge>
      );
    case "manual":
      return null;
  }
}

function shortId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 10)}…${id.slice(-3)}`;
}
