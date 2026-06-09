"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Sparkles,
  X,
  Layers,
  CheckCircle2,
} from "lucide-react";
import { anyApi } from "convex/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import { useTenantQuery } from "@/lib/use-tenant-query";
import { useAuditLogByTarget } from "@/lib/client-store";
import type { AuditLogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * Audit Log Explorer — slide-in drawer with full row detail.
 *
 * Drawer contents:
 *   1. Header   — action_type + provenance chip + close affordance
 *   2. Target   — target_entity:target_id with an "Open target" CTA
 *                  routed to the corresponding detail page
 *   3. Metadata — actor, IP, timestamp (absolute + relative)
 *   4. Provenance context — when via_agent, the verbatim agent prompt;
 *                  when via_bulk, the batch reference
 *   5. Payload  — pretty-printed key/value table. When the delta has
 *                  both "before" + "after" fields, render side-by-side.
 *   6. Related  — every other audit row touching the same target,
 *                  chronological — the "what else happened to this
 *                  entity" view
 *
 * Source-routing follows the same pattern as the list: live Convex
 * reads via useTenantQuery, mock-side via useAuditLogByTarget. The
 * drawer never owns its own state — the parent controls visibility +
 * which row is selected.
 */

// Convex doc shape — mirrors components/settings/audit-log-view.tsx.
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

function convexRowsToMock(rows: ConvexAuditRow[]): AuditLogEntry[] {
  return rows.map((r) => ({
    id: r._id,
    tenant_id: r.tenantId,
    actor_user_id: r.actor_user_id,
    actor_label: r.actor_label,
    ip: r.ip,
    action_type: r.action_type,
    target_entity: r.target_entity,
    target_id: r.target_id,
    payload_delta: r.payload_delta,
    via_agent: r.via_agent,
    agent_prompt: r.agent_prompt,
    created_at: r.created_at,
  }));
}

interface AuditRowDrawerProps {
  row: AuditLogEntry | null;
  onClose: () => void;
}

export function AuditRowDrawer({ row, onClose }: AuditRowDrawerProps) {
  // Esc closes drawer — standard right-rail affordance.
  React.useEffect(() => {
    if (!row) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [row, onClose]);

  // Related-history read. Hooks must run on every render, even when
  // `row` is null — pass undefined and the hook short-circuits.
  const mockRelated = useAuditLogByTarget(row?.target_entity, row?.target_id);
  const relatedArgs = React.useMemo(
    () =>
      row?.target_entity && row?.target_id
        ? { targetEntity: row.target_entity, targetId: row.target_id }
        : undefined,
    [row?.target_entity, row?.target_id],
  );
  const related = useTenantQuery<AuditLogEntry[], ConvexAuditRow[]>({
    mock: mockRelated,
    convexRef: relatedArgs ? anyApi.audit.listByTarget : undefined,
    convexArgs: relatedArgs,
    convexAdapter: convexRowsToMock,
  });

  if (!row) return null;

  const provenance = describeProvenance(row);
  const targetHref = targetLink(row.target_entity, row.target_id);
  const delta = parseDelta(row.payload_delta);
  const beforeAfter = extractBeforeAfter(delta);

  // Related view — exclude the current row + sort newest → oldest so
  // "previous + next" framing is intuitive when scanning top-down.
  const relatedSorted = [...related]
    .filter((r) => r.id !== row.id)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return (
    <>
      {/* Scrim — clicking it dismisses, matches Apple HIG sheet
          conventions referenced in app/globals.css. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
      />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[520px] flex-col overflow-y-auto border-l border-hairline bg-surface-1 shadow-[var(--shadow-xl)]"
        role="dialog"
        aria-label="Audit entry detail"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-hairline bg-surface-1 px-5 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wider text-fg-subtle">
                {row.target_entity}
                {row.target_id && (
                  <>
                    {" · "}
                    <span className="font-mono normal-case text-fg-tertiary">
                      {row.target_id}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="truncate text-[15px] font-semibold text-fg">
                  {row.action_type}
                </span>
                <ProvenanceChip provenance={provenance} />
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid size-7 shrink-0 place-items-center rounded-full text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
              aria-label="Close drawer"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-5 px-5 py-4">
          {/* Target CTA */}
          {targetHref && (
            <Link
              href={targetHref}
              className="inline-flex"
            >
              <Button variant="primary" size="sm">
                Open {prettyEntity(row.target_entity)}
                <ExternalLink className="size-3.5" />
              </Button>
            </Link>
          )}

          {/* Metadata */}
          <DetailBlock title="Actor">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[13px] font-medium text-fg">
                  {row.actor_label}
                </div>
                {row.actor_user_id && (
                  <div className="font-mono text-[10px] text-fg-tertiary">
                    {row.actor_user_id}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="text-[11px] text-fg-subtle tabular">
                  <LocalTime iso={row.created_at} fmt="short_datetime" />
                </div>
                <div className="text-[10px] text-fg-tertiary tabular">
                  {relativeTime(row.created_at)}
                </div>
              </div>
            </div>
            {row.ip && (
              <div className="mt-1 text-[10px] font-mono text-fg-tertiary">
                IP {row.ip}
              </div>
            )}
          </DetailBlock>

          {/* Provenance context */}
          {row.via_agent && row.agent_prompt ? (
            <DetailBlock
              title={
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-primary" /> Agent prompt
                </span>
              }
            >
              <blockquote className="border-l-2 border-primary/40 pl-3 text-[13px] italic text-fg">
                &ldquo;{row.agent_prompt}&rdquo;
              </blockquote>
            </DetailBlock>
          ) : null}

          {provenance === "bulk" && (
            <DetailBlock
              title={
                <span className="inline-flex items-center gap-1.5">
                  <Layers className="size-3.5 text-[var(--status-info)]" />{" "}
                  Bulk batch
                </span>
              }
            >
              <BulkBatchSummary delta={delta} />
            </DetailBlock>
          )}

          {provenance === "closeout" && (
            <DetailBlock
              title={
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5 text-fg-subtle" /> Closeout
                  chain step
                </span>
              }
            >
              <p className="text-[12px] text-fg-subtle">
                Emitted by the Work Order closeout orchestrator. The full
                chain is visible in the Related history below.
              </p>
            </DetailBlock>
          )}

          {/* Payload — before/after split when available, otherwise
              a flat key/value table. Raw JSON tucked under a disclosure
              for the operator who needs the wire shape. */}
          {delta != null ? (
            <DetailBlock title="Payload">
              {beforeAfter ? (
                <BeforeAfterTable
                  before={beforeAfter.before}
                  after={beforeAfter.after}
                />
              ) : (
                <KeyValueTable obj={delta} />
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] text-fg-tertiary hover:text-fg-subtle">
                  Raw JSON
                </summary>
                <pre className="mt-1 max-h-[200px] overflow-auto rounded-[6px] bg-surface-2 px-2 py-1.5 text-[11px] text-fg-subtle">
                  {JSON.stringify(delta, null, 2)}
                </pre>
              </details>
            </DetailBlock>
          ) : null}

          {/* Related — chase this target's audit trail */}
          <DetailBlock
            title={`Related history (${relatedSorted.length})`}
          >
            {relatedSorted.length === 0 ? (
              <p className="text-[12px] text-fg-subtle">
                No other audit rows on this {prettyEntity(row.target_entity)}.
              </p>
            ) : (
              <ul className="divide-y divide-hairline/60 rounded-[8px] border border-hairline">
                {relatedSorted.slice(0, 50).map((r) => {
                  const isBefore = r.created_at < row.created_at;
                  return (
                    <li
                      key={r.id}
                      className="flex items-start gap-2 px-3 py-2"
                    >
                      <div className="mt-0.5 shrink-0 text-fg-subtle">
                        {isBefore ? (
                          <ArrowLeft className="size-3" />
                        ) : (
                          <ArrowRight className="size-3" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-fg">
                          {r.action_type}
                        </div>
                        <div className="mt-0.5 text-[10px] text-fg-subtle">
                          {r.actor_label} ·{" "}
                          <LocalTime
                            iso={r.created_at}
                            fmt="short_datetime"
                          />
                        </div>
                      </div>
                      {r.via_agent && (
                        <Sparkles className="size-3 shrink-0 text-primary" />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </DetailBlock>
        </div>
      </aside>
    </>
  );
}

// ────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────

function DetailBlock({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        {title}
      </div>
      {children}
    </section>
  );
}

function ProvenanceChip({
  provenance,
}: {
  provenance: Provenance;
}) {
  switch (provenance) {
    case "agent":
      return (
        <Badge tone="primary" size="sm">
          <Sparkles className="size-2.5" /> agent
        </Badge>
      );
    case "bulk":
      return (
        <Badge tone="info" size="sm">
          bulk
        </Badge>
      );
    case "closeout":
      return (
        <Badge tone="neutral" size="sm">
          closeout
        </Badge>
      );
    case "manual":
      return (
        <Badge tone="outline" size="sm">
          manual
        </Badge>
      );
  }
}

function KeyValueTable({ obj }: { obj: unknown }) {
  if (obj === null || typeof obj !== "object") {
    return (
      <pre className="rounded-[6px] bg-surface-2 px-2 py-1.5 text-[11px] text-fg-muted">
        {JSON.stringify(obj)}
      </pre>
    );
  }
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) {
    return <p className="text-[12px] text-fg-subtle">No payload data.</p>;
  }
  return (
    <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 rounded-[8px] border border-hairline bg-surface-2/40 p-3">
      {entries.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="break-words text-[11px] font-medium text-fg-subtle">
            {k}
          </dt>
          <dd className="break-words font-mono text-[11px] text-fg">
            {formatValue(v)}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function BeforeAfterTable({
  before,
  after,
}: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  // Union of keys so we don't drop fields that were added or removed.
  const keys = Array.from(
    new Set([...Object.keys(before), ...Object.keys(after)]),
  );
  return (
    <div className="overflow-hidden rounded-[8px] border border-hairline">
      <div className="grid grid-cols-[120px_1fr_1fr] gap-x-3 bg-surface-2/60 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
        <span>Field</span>
        <span>Before</span>
        <span>After</span>
      </div>
      <div className="divide-y divide-hairline/60">
        {keys.map((k) => {
          const b = before[k];
          const a = after[k];
          const changed = JSON.stringify(b) !== JSON.stringify(a);
          return (
            <div
              key={k}
              className={cn(
                "grid grid-cols-[120px_1fr_1fr] gap-x-3 px-3 py-1.5",
                changed && "bg-status-warn/5",
              )}
            >
              <span className="break-words text-[11px] font-medium text-fg-subtle">
                {k}
              </span>
              <span className="break-words font-mono text-[11px] text-fg-muted line-through">
                {b === undefined ? "—" : formatValue(b)}
              </span>
              <span
                className={cn(
                  "break-words font-mono text-[11px]",
                  changed ? "text-fg" : "text-fg-muted",
                )}
              >
                {a === undefined ? "—" : formatValue(a)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BulkBatchSummary({ delta }: { delta: unknown }) {
  if (!delta || typeof delta !== "object") {
    return (
      <p className="text-[12px] text-fg-subtle">No batch metadata recorded.</p>
    );
  }
  const d = delta as Record<string, unknown>;
  const count = d.count ?? d.total ?? d.affected;
  return (
    <div className="rounded-[8px] border border-hairline bg-surface-2/40 p-3 text-[12px] text-fg">
      Batch touched{" "}
      <span className="font-semibold tabular">
        {typeof count === "number" ? count : "?"}
      </span>{" "}
      record(s). Provenance is encoded in the action_type suffix
      <span className="ml-1 font-mono text-[11px]">_via_bulk</span>.
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

type Provenance = "agent" | "bulk" | "closeout" | "manual";

function describeProvenance(row: AuditLogEntry): Provenance {
  // Order matters — agent + closeout can coexist on a row; we want
  // "agent" to dominate the chip color because that's the most
  // operationally important signal (who initiated the action).
  if (row.via_agent) return "agent";
  if (row.action_type.includes("_via_bulk")) return "bulk";
  if (row.action_type.includes(".closeout.")) return "closeout";
  return "manual";
}

function parseDelta(s: string | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function extractBeforeAfter(
  delta: unknown,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  if (!delta || typeof delta !== "object") return null;
  const d = delta as Record<string, unknown>;
  // Two encodings show up in the codebase:
  //   1) { before: {...}, after: {...} } — explicit, used by withAudit
  //   2) { field: { from, to } } — used by some hand-written deltas
  // We handle #1 here; #2 stays as a flat key/value table since the
  // before/after split is per-field rather than per-row.
  if (
    d.before &&
    d.after &&
    typeof d.before === "object" &&
    typeof d.after === "object"
  ) {
    return {
      before: d.before as Record<string, unknown>,
      after: d.after as Record<string, unknown>,
    };
  }
  return null;
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function prettyEntity(entity: string): string {
  // "work_order" → "Work Order" — for the CTA + headers
  return entity
    .split(/[._]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function targetLink(entity: string, id: string | undefined): string | null {
  if (!id) return null;
  // Whitelist mapping — only entities with a real detail page get a
  // CTA. Unknown entities just render the id verbatim in the header.
  const routes: Record<string, (id: string) => string> = {
    work_order: (i) => `/work-orders/${i}`,
    workOrders: (i) => `/work-orders/${i}`,
    boater: (i) => `/members/${i}`,
    boaters: (i) => `/members/${i}`,
    vessel: (i) => `/members?vessel=${i}`,
    vessels: (i) => `/members?vessel=${i}`,
    quote: (i) => `/work-orders?quote=${i}`,
    quotes: (i) => `/work-orders?quote=${i}`,
    ledger: () => `/ledger`,
    ledger_entry: () => `/ledger`,
    communication: () => `/comms`,
    comms: () => `/comms`,
    contracts: (i) => `/members?contract=${i}`,
    contract: (i) => `/members?contract=${i}`,
    bills: () => `/billing`,
    bill: () => `/billing`,
    vendors: (i) => `/vendors/${i}`,
    vendor: (i) => `/vendors/${i}`,
    insurance: () => `/insurance`,
    waitlist: () => `/apply`,
    applications: () => `/apply`,
    application: () => `/apply`,
    reservation: () => `/reservations`,
    reservations: () => `/reservations`,
    time_entry: () => `/staff`,
    payroll_period: () => `/staff`,
  };
  const fn = routes[entity];
  return fn ? fn(id) : null;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 7 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}
