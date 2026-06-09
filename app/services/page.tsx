import { Anchor, CalendarRange, DollarSign, FileText } from "lucide-react";
import { DockMap } from "@/components/rentals/dock-map";
import {
  CONTRACTS,
  RATES,
  formatMoney,
  totalOccupancy,
} from "@/lib/mock-data";
import { isExpiringWithin, localIsoDate } from "@/lib/contracts";

export const metadata = { title: "Rentals — Marina Stee" };

// 60-day cutoff (in ms) for the Rentals overview "expiring" KPI.
//
// NOTE: this is intentionally DIFFERENT from the canonical 90-day
// window everywhere else in the app (Boaters / Rentals roster /
// Contracts KPI / Reports portfolio / agent /query_contract_expiry
// default). The scout report flagged this as probable drift — the KPI
// sub-label ("Next 60 days") matches the value, but there's no product
// reason 60 vs 90. If 60 is intentional, leave; if not, change BOTH
// this constant AND the KPI sub-label below.
const SIXTY_DAYS_MS = 60 * 86_400_000;

export default function RentalsOverviewPage() {
  const occ = totalOccupancy();
  // Mock revenue MTD = sum of monthly rate × occupied slips (very rough)
  const monthlyRate = RATES.find((r) => r.cadence === "monthly" && r.occupancy_type === "Standard")?.amount ?? 325;
  const revenueMTD = occ.occupied * monthlyRate;

  const todayIso = localIsoDate();
  const sixtyDaysOutIso = localIsoDate(new Date(Date.now() + SIXTY_DAYS_MS));
  // Preserves the `c.status === "active"` narrowing — see migration
  // report C3. Widening to isLiveContract would add executed contracts
  // to the KPI count and shouldn't ship without product sign-off.
  const expiringSoon = CONTRACTS.filter(
    (c) =>
      c.status === "active" && isExpiringWithin(c, todayIso, sixtyDaysOutIso),
  ).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={<Anchor className="size-4" />}
          label="Slips"
          value={`${occ.occupied} / ${occ.total}`}
          sub={`${Math.round(occ.pct)}% occupied`}
          tone={occ.pct >= 85 ? "danger" : occ.pct >= 60 ? "warn" : "ok"}
        />
        <Kpi
          icon={<DollarSign className="size-4" />}
          label="Slip revenue MTD"
          value={formatMoney(revenueMTD)}
          sub="Standard slip occupancy × monthly rate"
          tone="neutral"
        />
        <Kpi
          icon={<CalendarRange className="size-4" />}
          label="Contracts expiring"
          value={`${expiringSoon}`}
          sub="Next 60 days"
          tone={expiringSoon > 0 ? "warn" : "ok"}
        />
        <Kpi
          icon={<FileText className="size-4" />}
          label="Active pricing plans"
          value={`${RATES.length}`}
          sub="Across all occupancy types"
          tone="neutral"
        />
      </div>

      <DockMap />
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: "ok" | "warn" | "danger" | "neutral";
}) {
  const dot =
    tone === "danger" ? "bg-status-danger"
    : tone === "warn" ? "bg-status-warn"
    : tone === "ok" ? "bg-status-ok"
    : "bg-fg-tertiary/40";
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <div className="mb-2 flex items-center justify-between text-fg-subtle">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium">
          {icon}
          {label}
        </span>
        <span className={"size-1.5 rounded-full " + dot} aria-hidden />
      </div>
      <div className="text-[22px] font-semibold tracking-tight text-fg">{value}</div>
      <div className="mt-1 text-[12px] text-fg-subtle">{sub}</div>
    </div>
  );
}
