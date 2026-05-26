import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatMoney, initialsOf } from "@/lib/mock-data";
import type { Boater, Reservation } from "@/lib/types";

function relativeTime(iso?: string) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function trustTone(score?: number) {
  if (score === undefined) return "neutral" as const;
  if (score >= 90) return "ok" as const;
  if (score >= 75) return "info" as const;
  if (score >= 60) return "warn" as const;
  return "danger" as const;
}

function cadenceLabel(c: Boater["billing_cadence"]) {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

export function BoaterRow({
  boater,
  currentReservation,
  openBalance,
}: {
  boater: Boater;
  currentReservation?: Reservation;
  openBalance: number;
}) {
  const balanceTone = openBalance > 0 ? "warn" : "ok";

  return (
    <Link
      href={`/boaters/${boater.id}`}
      className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.7fr)] items-center gap-3 border-b border-hairline px-4 py-3 text-[13px] transition-colors hover:bg-surface-2"
    >
      {/* Identity */}
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="size-9 shrink-0">
          <AvatarFallback>{initialsOf(boater.display_name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate font-medium text-fg">
            {boater.display_name}
            {!boater.active && (
              <Badge tone="outline" size="sm">
                Inactive
              </Badge>
            )}
          </div>
          {boater.code && (
            <div className="truncate text-[11px] text-fg-tertiary">
              {boater.code}
            </div>
          )}
        </div>
      </div>

      {/* Slip / current reservation */}
      <div className="min-w-0">
        {currentReservation ? (
          <div className="text-fg">
            <span className="font-medium">{currentReservation.slip_id}</span>
            <span className="ml-1 text-[11px] text-fg-tertiary">
              · {currentReservation.status}
            </span>
          </div>
        ) : (
          <span className="text-fg-tertiary">—</span>
        )}
      </div>

      {/* Cadence */}
      <div className="min-w-0">
        <Badge tone={boater.billing_cadence === "transient" ? "info" : "neutral"} size="sm">
          {cadenceLabel(boater.billing_cadence)}
        </Badge>
      </div>

      {/* Balance */}
      <div className="min-w-0">
        <span
          className={
            balanceTone === "warn" ? "font-medium text-status-warn" : "text-fg-subtle"
          }
        >
          {formatMoney(openBalance)}
        </span>
      </div>

      {/* Trust score */}
      <div className="min-w-0">
        <Badge tone={trustTone(boater.trust_score)} size="sm">
          {boater.trust_score ?? "—"}
        </Badge>
      </div>

      {/* Last seen */}
      {/* suppressHydrationWarning: relative time depends on Date.now(), so
          server + client values can drift by a minute. The display is
          cosmetic — accept the warning to avoid a mount-guard remount. */}
      <div className="min-w-0 text-right text-[12px] text-fg-tertiary" suppressHydrationWarning>
        {relativeTime(boater.last_seen_at)}
      </div>
    </Link>
  );
}
