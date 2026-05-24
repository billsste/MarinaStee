"use client";

import Link from "next/link";
import { Anchor, Receipt, Users, AlertTriangle } from "lucide-react";
import {
  BOATERS,
  RESERVATIONS,
  formatMoney,
  totalOccupancy,
} from "@/lib/mock-data";
import { useStore } from "@/lib/client-store";

type Tone = "ok" | "warn" | "danger" | "info";

const TONE_DOT: Record<Tone, string> = {
  ok: "bg-status-ok",
  warn: "bg-status-warn",
  danger: "bg-status-danger",
  info: "bg-status-info",
};

export function KpiStrip() {
  const { ledger } = useStore();

  const occ = totalOccupancy();

  // Arrivals today — count reservations with arrival today
  const today = new Date().toISOString().slice(0, 10);
  const arrivingToday = RESERVATIONS.filter(
    (r) => r.arrival_date === today && r.status !== "cancelled"
  ).length;

  // LIVE: Open ledger across all boaters
  const openLedgerTotal = ledger
    .filter((l) => l.type === "invoice" && l.open_balance > 0)
    .reduce((s, l) => s + l.open_balance, 0);
  const pastDueAccounts = BOATERS.filter((b) =>
    ledger.some(
      (l) => l.boater_id === b.id && l.type === "invoice" && l.open_balance > 0
    )
  ).length;

  // Storm watch — mock
  const storm = { active: true, slipsAffected: occ.occupied };

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
      <Kpi
        icon={<Anchor className="size-4" strokeWidth={1.75} />}
        label="Slip occupancy"
        value={`${occ.occupied} / ${occ.total}`}
        sub={`${Math.round(occ.pct)}% across all groups`}
        tone={occ.pct >= 85 ? "danger" : occ.pct >= 60 ? "warn" : "ok"}
        href="/rentals"
      />
      <Kpi
        icon={<Users className="size-4" strokeWidth={1.75} />}
        label="Arriving today"
        value={`${arrivingToday} boater${arrivingToday === 1 ? "" : "s"}`}
        sub="Reservations starting today"
        tone="info"
        href="/reservations"
      />
      <Kpi
        icon={<Receipt className="size-4" strokeWidth={1.75} />}
        label="Open ledger balance"
        value={formatMoney(openLedgerTotal)}
        sub={`${pastDueAccounts} account${pastDueAccounts === 1 ? "" : "s"} past due`}
        tone={openLedgerTotal > 0 ? "warn" : "ok"}
        href="/ledger"
      />
      <Kpi
        icon={<AlertTriangle className="size-4" strokeWidth={1.75} />}
        label="Storm watch"
        value={storm.active ? "Active" : "Clear"}
        sub={storm.active ? `Auto-text drafted for ${storm.slipsAffected} slips` : "No advisories"}
        tone={storm.active ? "danger" : "ok"}
      />
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  tone,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: Tone;
  href?: string;
}) {
  const inner = (
    <>
      <div className="mb-2 flex items-center justify-between text-fg-subtle">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium">
          {icon}
          {label}
        </span>
        <span className={`size-1.5 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
      </div>
      <div className="money-display text-[26px] text-fg">{value}</div>
      <div className="mt-1 text-[12px] text-fg-subtle">{sub}</div>
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="rounded-[12px] border border-hairline bg-surface-1 p-4 transition-colors hover:border-hairline-strong hover:bg-surface-2"
      >
        {inner}
      </Link>
    );
  }
  return <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">{inner}</div>;
}
