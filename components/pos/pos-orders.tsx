"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  BOATERS,
  POS_LOCATIONS,
  formatMoney,
} from "@/lib/mock-data";
import { usePosOrders } from "@/lib/client-store";
import { useLedgerDrawer } from "@/components/ledger/ledger-entry-drawer";
import { QbSyncBadge } from "./qb-sync-badge";

export function PosOrders() {
  const orders = usePosOrders();
  const { openLedgerEntry } = useLedgerDrawer();
  const sorted = [...orders].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="border-b border-hairline px-4 py-2.5">
        <h3 className="text-[13px] font-medium text-fg">Recent POS orders</h3>
        <p className="text-[11px] text-fg-tertiary">
          Charge-to-account orders also appear on each boater&apos;s Transactions tab.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-hairline text-[11px] uppercase tracking-wide text-fg-tertiary">
              <Th>Number</Th>
              <Th>Location</Th>
              <Th>Customer</Th>
              <Th>Items</Th>
              <Th className="text-right">Total</Th>
              <Th>Method</Th>
              <Th>Status</Th>
              <Th>QuickBooks</Th>
              <Th>When</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((o) => {
              const loc = POS_LOCATIONS.find((l) => l.id === o.location_id);
              const boater = o.boater_id ? BOATERS.find((b) => b.id === o.boater_id) : null;
              const hasLinkedLedger = !!o.linked_ledger_entry_id;
              return (
                <tr
                  key={o.id}
                  onClick={(e) => {
                    if (!hasLinkedLedger) return;
                    if ((e.target as HTMLElement).closest("a, button")) return;
                    openLedgerEntry(o.linked_ledger_entry_id!);
                  }}
                  className={
                    "border-b border-hairline last:border-b-0 hover:bg-surface-2 " +
                    (hasLinkedLedger ? "cursor-pointer" : "")
                  }
                >
                  <Td className="font-mono text-[12px] font-medium text-fg">{o.number}</Td>
                  <Td className="text-fg-subtle">{loc?.name ?? "—"}</Td>
                  <Td>
                    {boater ? (
                      <Link href={`/holders/${boater.id}`} className="text-primary hover:underline">
                        {boater.display_name}
                      </Link>
                    ) : (
                      <span className="text-fg-tertiary italic">walk-in</span>
                    )}
                  </Td>
                  <Td className="text-fg-subtle">
                    {o.line_items.length} item{o.line_items.length === 1 ? "" : "s"}
                  </Td>
                  <Td className="tabular text-right font-medium text-fg">{formatMoney(o.total)}</Td>
                  <Td>
                    <Badge tone={o.payment_method === "charge_to_account" ? "primary" : "neutral"} size="sm">
                      {o.payment_method.replace("_", " ")}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone="ok" size="sm">
                      {o.status}
                    </Badge>
                  </Td>
                  <Td>
                    <QbSyncBadge status={o.qb_sync_status} ref={o.qb_ref} />
                  </Td>
                  <Td className="text-fg-tertiary">
                    {new Date(o.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={"px-3 py-2 text-left font-medium " + (className ?? "")}>{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={"px-3 py-2 align-middle " + (className ?? "")}>{children}</td>;
}
