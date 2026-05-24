import { Fuel, TrendingUp, Truck, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import {
  FUEL_DELIVERIES,
  FUEL_INVENTORY,
  FUEL_SALES,
  formatMoney,
  fuelMargin,
  fuelPct,
} from "@/lib/mock-data";
import type { FuelInventory } from "@/lib/types";

export const metadata = { title: "Gas Tracking — Marina Stee Rentals" };

export default function GasPage() {
  const recentSales = [...FUEL_SALES].sort((a, b) => (a.sold_at < b.sold_at ? 1 : -1));
  const todayGallons = recentSales
    .filter((s) => s.sold_at.startsWith("2026-05-23"))
    .reduce((sum, s) => sum + s.gallons, 0);
  const monthRevenue = recentSales.reduce((sum, s) => sum + s.total, 0);

  return (
    <div className="space-y-5">
      <RentalsAsk
        placeholder="Ask about fuel — e.g. 'what's our margin this month?'"
        suggestions={[
          "What's our margin this month?",
          "Reorder when gasoline hits 25%",
          "Top fuel customers in May",
        ]}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {FUEL_INVENTORY.map((inv) => (
          <TankCard key={inv.id} inv={inv} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiCard label="Gallons sold today" value={`${todayGallons.toFixed(1)}`} sub="Across both fuels" icon={<TrendingUp className="size-4" />} />
        <KpiCard label="Fuel revenue (last 5 sales)" value={formatMoney(monthRevenue)} sub="Real-time POS feed" icon={<Fuel className="size-4" />} />
        <KpiCard label="Charged to account" value={`${recentSales.filter((s) => s.payment_method === "charge_to_account").length}`} sub="Of last 5 sales" icon={<Fuel className="size-4" />} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent sales feed */}
        <div className="rounded-[12px] border border-hairline bg-surface-1">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
            <h3 className="text-[13px] font-medium text-fg">Recent fuel sales</h3>
            <span className="text-[11px] text-fg-tertiary">Live from POS</span>
          </div>
          <ul className="divide-y divide-hairline">
            {recentSales.slice(0, 8).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                <div className="flex min-w-0 items-center gap-3">
                  <Badge tone={s.fuel_type === "gasoline" ? "warn" : "info"} size="sm">
                    {s.fuel_type === "gasoline" ? "GAS" : "DSL"}
                  </Badge>
                  <div className="min-w-0">
                    <div className="truncate text-fg">{s.gallons.toFixed(1)} gal @ {formatMoney(s.price_per_gallon)}/gal</div>
                    <div className="text-[11px] text-fg-tertiary">
                      {new Date(s.sold_at).toLocaleString()} · {s.payment_method.replace("_", " ")}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium text-fg">{formatMoney(s.total)}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Recent deliveries */}
        <div className="rounded-[12px] border border-hairline bg-surface-1">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
            <h3 className="text-[13px] font-medium text-fg">Recent deliveries</h3>
            <Button variant="secondary" size="sm">
              <Truck className="size-3.5" />
              Log delivery
            </Button>
          </div>
          <ul className="divide-y divide-hairline">
            {FUEL_DELIVERIES.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                <div className="min-w-0">
                  <div className="text-fg">
                    {d.gallons_delivered.toLocaleString()} gal {d.fuel_type}
                  </div>
                  <div className="text-[11px] text-fg-tertiary">
                    {d.delivery_date} · {d.supplier}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-fg">{formatMoney(d.total_cost)}</div>
                  <div className="text-[11px] text-fg-tertiary">{formatMoney(d.cost_per_gallon)}/gal</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function TankCard({ inv }: { inv: FuelInventory }) {
  const pct = fuelPct(inv);
  const margin = fuelMargin(inv);
  const lowFuel = pct <= inv.reorder_threshold_pct;
  const barTone = lowFuel ? "bg-status-danger" : pct < 50 ? "bg-status-warn" : "bg-status-ok";

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-5">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-[15px] font-medium capitalize text-fg">{inv.fuel_type}</h3>
          <p className="text-[11px] text-fg-tertiary">
            Last updated {new Date(inv.last_updated_at).toLocaleString()}
          </p>
        </div>
        {lowFuel && (
          <Badge tone="danger">
            <AlertTriangle className="size-3" />
            Reorder
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">Price / gal</div>
          <div className="money-display text-[22px] text-fg">
            {formatMoney(inv.current_price_per_gallon)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">Cost / gal</div>
          <div className="money-display text-[22px] text-fg-subtle">
            {formatMoney(inv.cost_per_gallon)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">Margin</div>
          <div className="money-display text-[22px] text-status-ok">
            {formatMoney(margin)}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-[11px] text-fg-subtle">
          <span>Tank level</span>
          <span>
            {inv.current_level_gallons.toLocaleString()} / {inv.tank_capacity_gallons.toLocaleString()} gal
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-3">
          <div className={"h-full transition-all " + barTone} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-fg-tertiary">
          <span>{Math.round(pct)}%</span>
          <span>Reorder at {inv.reorder_threshold_pct}%</span>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <div className="mb-1 inline-flex items-center gap-1.5 text-[12px] font-medium text-fg-subtle">
        {icon}
        {label}
      </div>
      <div className="money-display text-[24px] text-fg">{value}</div>
      <div className="mt-1 text-[11px] text-fg-tertiary">{sub}</div>
    </div>
  );
}
