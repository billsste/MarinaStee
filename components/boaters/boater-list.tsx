"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { BoaterSearch } from "./boater-search";
import { BoaterRow } from "./boater-row";
import { NewBoaterSheet } from "./new-boater-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCurrentReservation, getOpenBalance } from "@/lib/mock-data";
import { useBoaters, useStore } from "@/lib/client-store";

export function BoaterList() {
  const boaters = useBoaters();
  const { reservations, ledger } = useStore();
  const [query, setQuery] = React.useState("");
  const [newOpen, setNewOpen] = React.useState(false);

  // Compute rows live from the store so runtime-created boaters appear immediately.
  // Open-balance + reservation lookups still use the static helpers — they fall back
  // gracefully (0 balance / no current res) for boaters that don't exist in those
  // static maps yet, which is fine for the demo.
  const rows = React.useMemo(() => {
    return boaters.map((boater) => {
      // Prefer live reservation from store if present
      const liveRes = reservations.find(
        (r) => r.boater_id === boater.id && r.status === "occupied"
      );
      const currentReservation = liveRes ?? getCurrentReservation(boater.id);
      const liveBalance = ledger
        .filter((l) => l.boater_id === boater.id && l.type === "invoice")
        .reduce((s, l) => s + l.open_balance, 0);
      const openBalance = liveBalance > 0 ? liveBalance : getOpenBalance(boater.id);
      return { boater, currentReservation, openBalance };
    });
  }, [boaters, reservations, ledger]);

  type QuickFilter = "all" | "annual" | "seasonal" | "transient" | "past_due" | "expiring";
  const [quickFilter, setQuickFilter] = React.useState<QuickFilter>("all");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    const ninetyDays = 90 * 86_400_000;
    let out = rows;

    // Apply quick filter first
    if (quickFilter !== "all") {
      out = out.filter((r) => {
        switch (quickFilter) {
          case "annual":
            return r.boater.billing_cadence === "annual" || r.boater.billing_cadence === "monthly";
          case "seasonal":
            return r.boater.billing_cadence === "seasonal";
          case "transient":
            return r.boater.billing_cadence === "transient";
          case "past_due":
            return r.openBalance > 0;
          case "expiring": {
            // Boater has an active contract ending in the next 90 days
            const hasExpiring = ledger.length >= 0 && reservations.some((res) => {
              if (res.boater_id !== r.boater.id) return false;
              if (res.status !== "occupied") return false;
              const end = new Date(res.departure_date).getTime();
              return end > now && end - now <= ninetyDays;
            });
            return hasExpiring;
          }
        }
        return true;
      });
    }

    if (!q) return out;
    if (/^(add|create|new|register|sign up)\b/i.test(q)) return out;
    return out.filter((r) => {
      const b = r.boater;
      return (
        b.display_name.toLowerCase().includes(q) ||
        b.code?.toLowerCase().includes(q) ||
        b.primary_contact.email?.toLowerCase().includes(q) ||
        b.primary_contact.phone?.includes(q) ||
        r.currentReservation?.slip_id.toLowerCase().includes(q)
      );
    });
  }, [rows, query, quickFilter, ledger, reservations]);

  return (
    <div className="space-y-4">
      <BoaterSearch value={query} onChange={setQuery} />

      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-tertiary">
          <span>Quick filters:</span>
          <FilterChip label="All" value="all" current={quickFilter} onClick={setQuickFilter} />
          <FilterChip label="Annual" value="annual" current={quickFilter} onClick={setQuickFilter} />
          <FilterChip label="Seasonal" value="seasonal" current={quickFilter} onClick={setQuickFilter} />
          <FilterChip label="Transient" value="transient" current={quickFilter} onClick={setQuickFilter} />
          <FilterChip label="Past due" value="past_due" current={quickFilter} onClick={setQuickFilter} />
          <FilterChip label="Contract expiring" value="expiring" current={quickFilter} onClick={setQuickFilter} />
        </div>
        <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}>
          <Plus className="size-3.5" />
          New boater
        </Button>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.7fr)] gap-3 border-b border-hairline px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          <span>Boater</span>
          <span>Slip</span>
          <span>Cadence</span>
          <span>Balance</span>
          <span>Trust</span>
          <span className="text-right">Last seen</span>
        </div>
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-fg-subtle">
            No boaters match{" "}
            <span className="font-medium text-fg">&ldquo;{query}&rdquo;</span>.
            Try a different name, or click{" "}
            <span className="font-medium text-primary">+ New boater</span> to add one.
          </div>
        ) : (
          filtered.map((r) => (
            <BoaterRow
              key={r.boater.id}
              boater={r.boater}
              currentReservation={r.currentReservation}
              openBalance={r.openBalance}
            />
          ))
        )}
      </div>

      <div className="flex items-center justify-between text-[11px] text-fg-tertiary">
        <span>
          {filtered.length} of {rows.length} boaters
        </span>
        <span>
          <Badge tone="primary" size="sm">
            Agent
          </Badge>{" "}
          can also bulk-message, filter, or open a contract from this list — just ask.
        </span>
      </div>

      <NewBoaterSheet open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}

function FilterChip<V extends string>({
  label,
  value,
  current,
  onClick,
}: {
  label: string;
  value: V;
  current: V;
  onClick: (v: V) => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={
        "rounded-full border px-2.5 py-1 text-[11px] transition-colors " +
        (active
          ? "border-primary/40 bg-primary-soft text-primary"
          : "border-hairline bg-surface-1 text-fg-muted hover:border-hairline-strong hover:bg-surface-2")
      }
    >
      {label}
    </button>
  );
}
