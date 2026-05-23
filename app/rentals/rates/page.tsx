import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { RATES, formatMoney } from "@/lib/mock-data";
import type { Rate, RateCadence } from "@/lib/types";

export const metadata = { title: "Rates — Marina Stee Rentals" };

const CADENCE_ORDER: RateCadence[] = ["annual", "seasonal", "monthly", "weekly", "daily"];

export default function RatesPage() {
  const byType = RATES.reduce<Record<string, Rate[]>>((acc, r) => {
    (acc[r.occupancy_type] ||= []).push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <RentalsAsk
        placeholder="Ask about rates — e.g. 'raise all annual rates 5% for 2027'"
        suggestions={[
          "Raise all annual rates 5% for 2027",
          "Compare jet ski rates vs last year",
          "Add a winter discount for buoys",
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Object.entries(byType).map(([type, rates]) => {
          const sorted = [...rates].sort(
            (a, b) => CADENCE_ORDER.indexOf(a.cadence) - CADENCE_ORDER.indexOf(b.cadence)
          );
          return (
            <div key={type} className="rounded-[12px] border border-hairline bg-surface-1">
              <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
                <h3 className="text-[14px] font-medium text-fg">{type}</h3>
                <Button variant="ghost" size="sm">Edit all</Button>
              </div>
              <ul className="divide-y divide-hairline">
                {sorted.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-fg">{r.name}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-tertiary">
                        <Badge tone="outline" size="sm">{r.cadence}</Badge>
                        {r.effective_start && r.effective_end && (
                          <span>
                            {r.effective_start} → {r.effective_end}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[16px] font-semibold tracking-tight text-fg">
                        {formatMoney(r.amount)}
                      </div>
                      <div className="text-[11px] text-fg-tertiary">/ {r.cadence}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
