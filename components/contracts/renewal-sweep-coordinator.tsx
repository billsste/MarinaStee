"use client";

import * as React from "react";
import {
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  Send,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BOATERS, SLIPS, formatMoney } from "@/lib/mock-data";
import {
  cancelRenewalSweep,
  markRenewalSweepItemSent,
  recordRenewalSweepAcceptance,
  recordRenewalSweepDecline,
  removeContractFromRenewalSweep,
  updateRenewalSweepItem,
  useActiveRenewalSweep,
  useContracts,
  useRenewalSweep,
  useRenewalSweeps,
} from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { RenewalSweep, RenewalSweepItem } from "@/lib/types";
import { executeAgentAction } from "@/lib/agent-actions";
import type { AgentAction } from "@/lib/simulated-agent";
import {
  computeSweepStats,
  RenewalSweepProgressCard,
} from "./renewal-sweep-progress-card";
import { NewRenewalSweepWizard } from "./new-renewal-sweep-wizard";

/*
 * Renewal Sweep Coordinator — main operator surface for the annual
 * renewal workflow.
 *
 * Layout:
 *   - Top: active sweep card (or "Start a sweep" CTA when none).
 *   - When an active sweep exists: per-item table with priority chip,
 *     rate adjustment field, status chip, send button. Row click opens
 *     the per-item drawer.
 *   - Bulk actions bar: select rows → Send / Mark withdrawn / Set priority.
 *   - History rail: prior sweeps as compact progress cards.
 */

type SweepView =
  | { kind: "active" }
  | { kind: "selected"; sweepId: string }
  | { kind: "new" };

export function RenewalSweepCoordinator() {
  const allSweeps = useRenewalSweeps();
  const active = useActiveRenewalSweep();

  const [view, setView] = React.useState<SweepView>(() =>
    active ? { kind: "active" } : allSweeps.length > 0 ? { kind: "active" } : { kind: "new" },
  );

  const selectedSweepId =
    view.kind === "active"
      ? active?.id
      : view.kind === "selected"
        ? view.sweepId
        : undefined;

  const { sweep, items } = useRenewalSweep(selectedSweepId ?? null);

  const closedSweeps = allSweeps.filter((s) => s.status === "closed");

  if (view.kind === "new") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-medium text-fg">Start a renewal sweep</h2>
          {allSweeps.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setView(active ? { kind: "active" } : { kind: "selected", sweepId: allSweeps[0].id })
              }
            >
              Cancel
            </Button>
          )}
        </div>
        <NewRenewalSweepWizard
          onLaunched={(sweepId) => setView({ kind: "selected", sweepId })}
          onCancel={
            allSweeps.length > 0
              ? () =>
                  setView(
                    active
                      ? { kind: "active" }
                      : { kind: "selected", sweepId: allSweeps[0].id },
                  )
              : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header — active sweep banner or empty-state CTA */}
      {sweep ? (
        <SweepHeader
          sweep={sweep}
          items={items}
          onStartNew={() => setView({ kind: "new" })}
        />
      ) : (
        <EmptyState onStartNew={() => setView({ kind: "new" })} />
      )}

      {/* Per-item table for the selected sweep */}
      {sweep && items.length > 0 && (
        <SweepItemsTable sweep={sweep} items={items} />
      )}

      {/* History rail — closed sweeps with the same compact card */}
      {closedSweeps.length > 0 && (
        <section className="space-y-3">
          <header className="flex items-center justify-between">
            <h3 className="text-[14px] font-medium text-fg">Prior sweeps</h3>
            <p className="text-[11px] text-fg-tertiary">
              Acceptance history — click a card to inspect.
            </p>
          </header>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {closedSweeps.map((s) => (
              <ClosedSweepCard
                key={s.id}
                sweep={s}
                onSelect={() =>
                  setView({ kind: "selected", sweepId: s.id })
                }
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function EmptyState({ onStartNew }: { onStartNew: () => void }) {
  return (
    <section className="rounded-[12px] border border-dashed border-hairline-strong bg-surface-1 p-8 text-center">
      <Sparkles className="mx-auto mb-3 size-6 text-fg-tertiary" />
      <h3 className="text-[15px] font-medium text-fg">
        No active renewal sweep
      </h3>
      <p className="mx-auto mt-1 max-w-[400px] text-[12px] text-fg-subtle">
        Start a coordinated sweep to draft + send renewals for every
        contract expiring in the chosen window, then track acceptance %
        over time.
      </p>
      <Button
        variant="primary"
        size="md"
        className="mt-4"
        onClick={onStartNew}
      >
        <Sparkles className="size-3.5" />
        Start a sweep
      </Button>
    </section>
  );
}

function SweepHeader({
  sweep,
  items,
  onStartNew,
}: {
  sweep: RenewalSweep;
  items: RenewalSweepItem[];
  onStartNew: () => void;
}) {
  const [cancelling, setCancelling] = React.useState(false);
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[18px] font-medium text-fg">Active sweep</h2>
        <div className="flex items-center gap-2">
          {sweep.status === "in_progress" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (cancelling) return;
                setCancelling(true);
                cancelRenewalSweep(sweep.id, "withdrawn");
                setCancelling(false);
              }}
            >
              <X className="size-3.5" />
              Cancel sweep
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onStartNew}>
            <Sparkles className="size-3.5" />
            New sweep
          </Button>
        </div>
      </div>
      <RenewalSweepProgressCard sweep={sweep} items={items} />
      {sweep.notes && (
        <p className="mt-2 rounded-[6px] border border-hairline bg-surface-2 px-3 py-2 text-[12px] text-fg-subtle">
          {sweep.notes}
        </p>
      )}
    </section>
  );
}

function ClosedSweepCard({
  sweep,
  onSelect,
}: {
  sweep: RenewalSweep;
  onSelect: () => void;
}) {
  const { items } = useRenewalSweep(sweep.id);
  return (
    <button
      type="button"
      onClick={onSelect}
      className="block w-full text-left"
    >
      <RenewalSweepProgressCard sweep={sweep} items={items} compact />
    </button>
  );
}

// ────────────────────────────────────────────────────────────
// Per-item table
// ────────────────────────────────────────────────────────────

type SortKey = "priority" | "boater" | "status" | "rate";

const PRIORITY_RANK: Record<RenewalSweepItem["priority"], number> = {
  high: 0,
  normal: 1,
  low: 2,
};

const STATUS_RANK: Record<RenewalSweepItem["status"], number> = {
  pending: 0,
  renewal_sent: 1,
  accepted: 2,
  declined: 3,
  no_response: 4,
  withdrawn: 5,
};

function SweepItemsTable({
  sweep,
  items,
}: {
  sweep: RenewalSweep;
  items: RenewalSweepItem[];
}) {
  const contracts = useContracts();
  const [sortKey, setSortKey] = React.useState<SortKey>("priority");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [openItemId, setOpenItemId] = React.useState<string | null>(null);

  const sortedItems = React.useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      if (sortKey === "priority") {
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      }
      if (sortKey === "status") {
        return STATUS_RANK[a.status] - STATUS_RANK[b.status];
      }
      if (sortKey === "boater") {
        const an = BOATERS.find((x) => x.id === a.boater_id)?.display_name ?? "";
        const bn = BOATERS.find((x) => x.id === b.boater_id)?.display_name ?? "";
        return an.localeCompare(bn);
      }
      if (sortKey === "rate") {
        const ar = contracts.find((c) => c.id === a.source_contract_id)?.annual_rate ?? 0;
        const br = contracts.find((c) => c.id === b.source_contract_id)?.annual_rate ?? 0;
        return br - ar;
      }
      return 0;
    });
    return arr;
  }, [items, sortKey, contracts]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === sortedItems.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sortedItems.map((i) => i.id)));
    }
  }

  function bulkSend() {
    for (const id of selected) {
      const item = items.find((i) => i.id === id);
      if (!item) continue;
      if (item.status !== "pending" && item.status !== "renewal_sent") continue;
      markRenewalSweepItemSent(id);
    }
    setSelected(new Set());
  }

  function bulkWithdraw() {
    for (const id of selected) {
      const action: AgentAction = {
        kind: "update_renewal_sweep_item",
        label: `Withdraw item ${id} from "${sweep.name}"`,
        item_id: id,
        patch: { status: "withdrawn" },
      };
      executeAgentAction(action);
    }
    setSelected(new Set());
  }

  function bulkSetPriority(priority: "high" | "normal" | "low") {
    for (const id of selected) {
      const action: AgentAction = {
        kind: "update_renewal_sweep_item",
        label: `Set ${priority} priority on item ${id}`,
        item_id: id,
        patch: { priority },
      };
      executeAgentAction(action);
    }
    setSelected(new Set());
  }

  const closed = sweep.status === "closed";
  const stats = computeSweepStats(items);

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="text-[14px] font-medium text-fg">
          Items
          <span className="ml-2 text-[12px] font-normal text-fg-tertiary">
            {stats.total} total · {stats.pending} pending · {stats.sent} sent ·{" "}
            {stats.accepted} accepted · {stats.declined} declined
          </span>
        </h3>
      </header>

      {/* Bulk action bar */}
      {selected.size > 0 && !closed && (
        <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-primary/30 bg-primary-soft/40 px-3 py-2 text-[12px]">
          <span className="font-medium text-fg">
            {selected.size} selected
          </span>
          <span className="text-fg-tertiary">·</span>
          <Button variant="primary" size="sm" onClick={bulkSend}>
            <Send className="size-3.5" />
            Send renewal links
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => bulkSetPriority("high")}
          >
            High priority
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => bulkSetPriority("normal")}
          >
            Normal
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => bulkSetPriority("low")}
          >
            Low
          </Button>
          <Button variant="ghost" size="sm" onClick={bulkWithdraw}>
            <X className="size-3.5" />
            Withdraw
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-[8px] border border-hairline bg-surface-1">
        <table className="w-full text-[12px]">
          <thead className="bg-surface-2 text-[10px] uppercase tracking-wide text-fg-tertiary">
            <tr>
              <th className="px-2 py-2 text-left">
                {!closed && (
                  <input
                    type="checkbox"
                    checked={
                      selected.size > 0 &&
                      selected.size === sortedItems.length
                    }
                    onChange={selectAll}
                    aria-label="Select all"
                  />
                )}
              </th>
              <SortHeader
                label="Priority"
                col="priority"
                active={sortKey}
                onSelect={setSortKey}
              />
              <SortHeader
                label="Boater"
                col="boater"
                active={sortKey}
                onSelect={setSortKey}
              />
              <th className="px-3 py-2 text-left">Slip</th>
              <th className="px-3 py-2 text-left">Source contract</th>
              <th className="px-3 py-2 text-right">Source rate</th>
              <th className="px-3 py-2 text-right">Rate adjust</th>
              <th className="px-3 py-2 text-right">Successor rate</th>
              <SortHeader
                label="Status"
                col="status"
                active={sortKey}
                onSelect={setSortKey}
                align="left"
              />
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((item) => (
              <ItemRow
                key={item.id}
                sweep={sweep}
                item={item}
                isSelected={selected.has(item.id)}
                onToggle={() => toggleSelect(item.id)}
                onOpen={() => setOpenItemId(item.id)}
                disabled={closed}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Per-item drawer (inline expansion below the table) */}
      {openItemId && (
        <ItemDrawer
          itemId={openItemId}
          sweep={sweep}
          onClose={() => setOpenItemId(null)}
        />
      )}
    </section>
  );
}

function SortHeader({
  label,
  col,
  active,
  onSelect,
  align = "left",
}: {
  label: string;
  col: SortKey;
  active: SortKey;
  onSelect: (s: SortKey) => void;
  align?: "left" | "right";
}) {
  return (
    <th className={cn("px-3 py-2", align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1 transition-colors",
          active === col ? "text-fg" : "hover:text-fg",
        )}
        onClick={() => onSelect(col)}
      >
        {label}
        <ArrowUpDown className="size-2.5" />
      </button>
    </th>
  );
}

function ItemRow({
  sweep,
  item,
  isSelected,
  onToggle,
  onOpen,
  disabled,
}: {
  sweep: RenewalSweep;
  item: RenewalSweepItem;
  isSelected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  disabled: boolean;
}) {
  const contracts = useContracts();
  const source = contracts.find((c) => c.id === item.source_contract_id);
  const boater = BOATERS.find((b) => b.id === item.boater_id);
  const slip = source?.slip_id
    ? SLIPS.find((s) => s.id === source.slip_id)
    : undefined;
  const pctApplied =
    item.rate_adjustment_pct ?? sweep.default_rate_adjustment_pct;
  const successorRate = source?.annual_rate
    ? Math.round(source.annual_rate * (1 + pctApplied / 100))
    : 0;

  function send() {
    markRenewalSweepItemSent(item.id);
  }

  function recordAccepted() {
    // Mirrors the mark_signed → recordAcceptance path used in production.
    if (item.renewal_contract_id) {
      recordRenewalSweepAcceptance(item.renewal_contract_id);
    } else {
      updateRenewalSweepItem(item.id, { status: "accepted" });
    }
  }

  function recordDeclined() {
    recordRenewalSweepDecline(item.id);
  }

  function changePriority(p: "high" | "normal" | "low") {
    updateRenewalSweepItem(item.id, { priority: p });
  }

  function changeRate(raw: string) {
    if (raw.trim() === "") {
      updateRenewalSweepItem(item.id, { rate_adjustment_pct: null });
      return;
    }
    const num = Number(raw);
    if (Number.isNaN(num)) return;
    updateRenewalSweepItem(item.id, { rate_adjustment_pct: num });
  }

  function withdraw() {
    removeContractFromRenewalSweep(item.id);
  }

  const showSendButton =
    !disabled &&
    (item.status === "pending" || item.status === "renewal_sent");

  return (
    <tr
      className={cn(
        "border-t border-hairline transition-colors hover:bg-surface-2/40",
        isSelected && "bg-primary-soft/30",
      )}
    >
      <td className="px-2 py-2">
        {!disabled && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggle}
            aria-label={`Select ${boater?.display_name ?? item.id}`}
          />
        )}
      </td>
      <td className="px-3 py-2">
        <PriorityChip
          priority={item.priority}
          disabled={disabled}
          onChange={changePriority}
        />
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={onOpen}
          className="text-left font-medium text-fg hover:text-primary"
        >
          {boater?.display_name ?? item.boater_id}
        </button>
      </td>
      <td className="px-3 py-2 text-fg-subtle">{slip?.id ?? "—"}</td>
      <td className="px-3 py-2 text-fg-subtle tabular">
        {source?.number ?? item.source_contract_id}
      </td>
      <td className="px-3 py-2 text-right tabular">
        {source?.annual_rate ? formatMoney(source.annual_rate) : "—"}
      </td>
      <td className="px-3 py-2 text-right">
        <RateAdjustInput
          valueOverride={item.rate_adjustment_pct}
          defaultPct={sweep.default_rate_adjustment_pct}
          onChange={changeRate}
          disabled={disabled}
        />
      </td>
      <td className="px-3 py-2 text-right tabular text-status-ok">
        {source?.annual_rate ? formatMoney(successorRate) : "—"}
      </td>
      <td className="px-3 py-2">
        <ItemStatusChip status={item.status} />
      </td>
      <td className="px-3 py-2 text-right">
        <div className="inline-flex items-center gap-1">
          {showSendButton && (
            <Button variant="secondary" size="sm" onClick={send}>
              <Send className="size-3" />
              {item.status === "renewal_sent" ? "Resend" : "Send"}
            </Button>
          )}
          {item.status === "renewal_sent" && (
            <>
              <Button variant="ghost" size="sm" onClick={recordAccepted}>
                <CheckCircle2 className="size-3" />
              </Button>
              <Button variant="ghost" size="sm" onClick={recordDeclined}>
                <XCircle className="size-3" />
              </Button>
            </>
          )}
          {!disabled && item.status === "pending" && (
            <Button variant="ghost" size="sm" onClick={withdraw}>
              <X className="size-3" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function ItemDrawer({
  itemId,
  sweep,
  onClose,
}: {
  itemId: string;
  sweep: RenewalSweep;
  onClose: () => void;
}) {
  const { items } = useRenewalSweep(sweep.id);
  const contracts = useContracts();
  const item = items.find((i) => i.id === itemId);
  if (!item) return null;
  const source = contracts.find((c) => c.id === item.source_contract_id);
  const successor = item.renewal_contract_id
    ? contracts.find((c) => c.id === item.renewal_contract_id)
    : undefined;
  const boater = BOATERS.find((b) => b.id === item.boater_id);
  const [notes, setNotes] = React.useState(item.internal_notes ?? "");

  function saveNotes() {
    updateRenewalSweepItem(itemId, { internal_notes: notes });
  }

  return (
    <section className="rounded-[12px] border border-primary/30 bg-primary-soft/20 p-4">
      <header className="mb-3 flex items-start justify-between">
        <div>
          <h4 className="text-[14px] font-medium text-fg">
            {boater?.display_name ?? item.boater_id}
          </h4>
          <p className="text-[11px] text-fg-subtle">
            Source: {source?.number ?? "—"} · Successor:{" "}
            {successor?.number ?? "not yet drafted"}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </header>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2 text-[12px]">
          <DetailRow
            label="Status"
            value={<ItemStatusChip status={item.status} />}
          />
          <DetailRow
            label="Priority"
            value={
              <Badge tone={priorityTone(item.priority)} size="sm">
                {item.priority}
              </Badge>
            }
          />
          <DetailRow
            label="Rate adjustment"
            value={`${item.rate_adjustment_pct ?? sweep.default_rate_adjustment_pct}%${item.rate_adjustment_pct === undefined ? " (sweep default)" : ""}`}
          />
          <DetailRow label="Sent" value={item.sent_at?.slice(0, 10) ?? "—"} />
          <DetailRow
            label="Responded"
            value={item.responded_at?.slice(0, 10) ?? "—"}
          />
          <DetailRow
            label="Renewal link"
            value={
              item.renewal_link_token ? (
                <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px]">
                  /onboard/{item.renewal_link_token.slice(0, 16)}…
                </code>
              ) : (
                "—"
              )
            }
          />
        </div>
        <div className="space-y-2">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
            Internal notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className="w-full rounded-[6px] border border-hairline bg-surface-1 p-2 text-[12px] text-fg outline-none focus:border-primary"
            placeholder="Why this item is flagged…"
          />
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={saveNotes}>
              Save notes
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wide text-fg-tertiary">
        {label}
      </span>
      <span className="text-right text-fg">{value}</span>
    </div>
  );
}

function priorityTone(p: "high" | "normal" | "low") {
  if (p === "high") return "danger" as const;
  if (p === "low") return "neutral" as const;
  return "info" as const;
}

function PriorityChip({
  priority,
  disabled,
  onChange,
}: {
  priority: "high" | "normal" | "low";
  disabled: boolean;
  onChange: (p: "high" | "normal" | "low") => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="inline-flex items-center gap-1"
      >
        <Badge tone={priorityTone(priority)} size="sm">
          {priority}
        </Badge>
        {!disabled && <ChevronDown className="size-2.5 text-fg-tertiary" />}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-[120px] overflow-hidden rounded-[6px] border border-hairline bg-surface-1 shadow-md">
          {(["high", "normal", "low"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                onChange(p);
                setOpen(false);
              }}
              className={cn(
                "block w-full px-3 py-1.5 text-left text-[12px] hover:bg-surface-2",
                priority === p && "bg-surface-2 font-medium",
              )}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RateAdjustInput({
  valueOverride,
  defaultPct,
  onChange,
  disabled,
}: {
  valueOverride: number | undefined;
  defaultPct: number;
  onChange: (raw: string) => void;
  disabled: boolean;
}) {
  const [local, setLocal] = React.useState<string>(
    valueOverride === undefined ? "" : String(valueOverride),
  );
  React.useEffect(() => {
    setLocal(valueOverride === undefined ? "" : String(valueOverride));
  }, [valueOverride]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={local}
      placeholder={`${defaultPct}%`}
      disabled={disabled}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onChange(local)}
      className="w-[60px] rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-right text-[12px] outline-none focus:border-primary"
    />
  );
}

function ItemStatusChip({
  status,
}: {
  status: RenewalSweepItem["status"];
}) {
  switch (status) {
    case "pending":
      return (
        <Badge tone="warn" size="sm">
          Pending
        </Badge>
      );
    case "renewal_sent":
      return (
        <Badge tone="info" size="sm">
          Sent
        </Badge>
      );
    case "accepted":
      return (
        <Badge tone="ok" size="sm">
          Accepted
        </Badge>
      );
    case "declined":
      return (
        <Badge tone="danger" size="sm">
          Declined
        </Badge>
      );
    case "withdrawn":
      return (
        <Badge tone="neutral" size="sm">
          Withdrawn
        </Badge>
      );
    case "no_response":
      return (
        <Badge tone="outline" size="sm">
          No response
        </Badge>
      );
  }
}
