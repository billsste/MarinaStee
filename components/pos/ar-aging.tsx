"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { BOATERS, formatMoney } from "@/lib/mock-data";
import { useStore } from "@/lib/client-store";

export function ArAging() {
  const { ledger } = useStore();
  const rows = BOATERS.map((b) => ({
    boater: b,
    balance: ledger
      .filter((l) => l.boater_id === b.id && l.type === "invoice")
      .reduce((s, e) => s + e.open_balance, 0),
  }))
    .filter((r) => r.balance > 0)
    .sort((a, b) => b.balance - a.balance);

  const total = rows.reduce((s, r) => s + r.balance, 0);

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <div>
          <h3 className="text-[13px] font-medium text-fg">Accounts Receivable</h3>
          <p className="text-[11px] text-fg-tertiary">Open invoices across all boaters</p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">Total open</div>
          <div className="money-display text-[24px] text-status-warn">
            {formatMoney(total)}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-fg-subtle">All accounts current.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-hairline text-[11px] uppercase tracking-wide text-fg-tertiary">
                <th className="px-3 py-2 text-left font-medium">Boater</th>
                <th className="px-3 py-2 text-left font-medium">Cadence</th>
                <th className="px-3 py-2 text-right font-medium">Open balance</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.boater.id} className="border-b border-hairline last:border-b-0 hover:bg-surface-2">
                  <td className="px-3 py-2">
                    <Link href={`/boaters/${r.boater.id}`} className="text-primary hover:underline">
                      {r.boater.display_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 capitalize text-fg-subtle">{r.boater.billing_cadence}</td>
                  <td className="tabular px-3 py-2 text-right font-medium text-status-warn">
                    {formatMoney(r.balance)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone="warn" size="sm">Past due risk</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
