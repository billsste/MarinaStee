"use client";

import Link from "next/link";
import {
  Receipt,
  Wrench,
  MessageSquare,
  ArrowRight,
} from "lucide-react";
import {
  BOATERS,
  WORK_ORDERS,
  formatMoney,
} from "@/lib/mock-data";
import { useStore } from "@/lib/client-store";
import { useLedgerDrawer } from "@/components/ledger/ledger-entry-drawer";

type Kind = "comm" | "ledger" | "wo";

type Activity = {
  kind: Kind;
  ts: string;
  id: string;
  boater_id: string;
  title: string;
  subtitle: string;
};

export function ActivityFeed() {
  // Live ledger + comms from store; work orders are static for now.
  const { ledger, communications } = useStore();
  const { openLedgerEntry } = useLedgerDrawer();

  const activity: Activity[] = [
    ...communications.map((c) => ({
      kind: "comm" as const,
      ts: c.sent_at,
      id: c.id,
      boater_id: c.boater_id,
      title: c.subject ?? c.body_preview.slice(0, 50),
      subtitle: `${c.sender_label} · ${c.type.toUpperCase()} · ${c.status}`,
    })),
    ...ledger.map((l) => ({
      kind: "ledger" as const,
      ts: l.date,
      id: l.id,
      boater_id: l.boater_id,
      title:
        l.type === "refund"
          ? `Refund · ${formatMoney(l.amount)}`
          : l.type === "payment"
            ? `Payment · ${formatMoney(l.amount)}`
            : `Invoice ${l.number ?? ""} · ${formatMoney(l.amount)}`,
      subtitle:
        l.status +
        (l.linked_work_order_id ? ` · from work order` : "") +
        (l.linked_pos_order_id ? ` · from POS` : ""),
    })),
    ...WORK_ORDERS.map((w) => ({
      kind: "wo" as const,
      ts: w.start_date || w.due_date || w.end_date || "1970-01-01",
      id: w.id,
      boater_id: w.boater_id,
      title: `${w.number} ${w.subject}`,
      subtitle: `${w.status.replace("_", " ")} · ${w.priority}`,
    })),
  ].sort((a, b) => (a.ts < b.ts ? 1 : -1));

  return (
    <ul className="divide-y divide-hairline text-[13px]">
      {activity.slice(0, 10).map((a) => {
        const boater = BOATERS.find((b) => b.id === a.boater_id);
        const ts = new Date(a.ts);
        const diffMs = Date.now() - ts.getTime();
        const when =
          diffMs < 0
            ? ts.toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : diffMs < 3_600_000
              ? `${Math.max(1, Math.round(diffMs / 60_000))}m`
              : diffMs < 86_400_000
                ? `${Math.round(diffMs / 3_600_000)}h`
                : ts.toLocaleDateString(undefined, { month: "short", day: "numeric" });

        const icon =
          a.kind === "comm" ? <MessageSquare className="size-3" />
          : a.kind === "ledger" ? <Receipt className="size-3" />
          : <Wrench className="size-3" />;

        const rowInner = (
          <>
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-2 text-fg-subtle">
              {icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-fg-subtle">
                {boater?.display_name ?? a.subtitle}
              </div>
              <div className="truncate text-fg group-hover:text-primary">{a.title}</div>
            </div>
          </>
        );

        return (
          <li key={`${a.kind}-${a.id}`} className="flex items-start justify-between gap-4 px-2 py-2.5">
            {a.kind === "ledger" ? (
              <button
                type="button"
                onClick={() => openLedgerEntry(a.id)}
                className="group flex min-w-0 flex-1 items-start gap-2.5 text-left"
              >
                {rowInner}
              </button>
            ) : (
              <Link
                href={a.kind === "wo" ? `/work-orders/${a.id}` : boater ? `/boaters/${boater.id}` : "#"}
                className="group flex min-w-0 flex-1 items-start gap-2.5"
              >
                {rowInner}
              </Link>
            )}
            <div className="shrink-0 text-[11px] text-fg-tertiary">{when}</div>
          </li>
        );
      })}
    </ul>
  );
}

export { ArrowRight };
