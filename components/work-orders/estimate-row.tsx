import { Clock, Wallet } from "lucide-react";
import { formatMoney } from "@/lib/mock-data";
import type { WorkOrder } from "@/lib/types";

// Server-rendered ballpark estimate row — shown above the QuoteSection
// so the operator's pre-quote intent frames the formal quote. Gated
// to either `estimated_hours` or `estimated_total` being present; the
// wizard makes both optional so a WO can carry one without the other.
//
// Identity-bar shape on purpose: matches the rounded card pattern used
// by the QuoteSection / RentalsAsk / LinkedEntitiesRail so the left
// column reads as a vertical stack of equal-weight cards.

export function EstimateRow({ wo }: { wo: WorkOrder }) {
  const hasHours = wo.estimated_hours != null;
  const hasTotal = wo.estimated_total != null;
  if (!hasHours && !hasTotal) return null;

  const parts: string[] = [];
  if (hasHours) parts.push(`Est. ${wo.estimated_hours}h`);
  if (hasTotal) parts.push(formatMoney(wo.estimated_total!));

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          {hasHours ? <Clock className="size-3.5" /> : <Wallet className="size-3.5" />}
          Estimate
        </div>
        <div className="money-display text-[14px] text-fg">
          {parts.join(" · ")}
        </div>
      </div>
    </div>
  );
}
