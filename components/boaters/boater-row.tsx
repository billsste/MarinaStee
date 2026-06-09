import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatMoney, initialsOf } from "@/lib/mock-data";
import type { Boater, Reservation } from "@/lib/types";

// Derived service-type label rendered in the Service column. Computed
// once in BoaterList from (club subscription ?? slip class) and passed
// here so the row stays a pure render.
export type ServiceLabel =
  | "Rental Club"
  | "Standard"
  | "Buoy"
  | "Dry Storage"
  | "Jet Ski"
  | "Mooring"
  | null; // null = no recognized service yet (account-only / transient walk-in)

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

function serviceTone(s: ServiceLabel) {
  if (s === "Rental Club") return "info" as const;
  if (s === "Jet Ski") return "warn" as const;
  if (s === "Buoy" || s === "Mooring") return "neutral" as const;
  if (s === "Dry Storage") return "neutral" as const;
  return "outline" as const;
}

export function BoaterRow({
  boater,
  currentReservation,
  contractSlipId,
  contractStatus,
  openBalance,
  service,
}: {
  boater: Boater;
  currentReservation?: Reservation;
  /** Fallback slip when no reservation exists — comes from the
      boater's contract. Set together with contractStatus. */
  contractSlipId?: string;
  contractStatus?: import("@/lib/types").ContractStatus;
  openBalance: number;
  service: ServiceLabel;
}) {
  const balanceTone = openBalance > 0 ? "warn" : "ok";

  return (
    <Link
      href={`/members/${boater.id}`}
      className="grid items-center gap-3 border-b border-hairline px-4 py-3 text-[13px] transition-colors hover:bg-surface-2"
      style={{
        gridTemplateColumns:
          "minmax(0, 1.8fr) minmax(0, 0.9fr) minmax(0, 0.9fr) minmax(0, 0.9fr) minmax(0, 0.9fr) minmax(0, 0.7fr)",
      }}
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

      {/* Slip / current reservation. Falls back to the boater's contract
          slip when no reservation exists yet (e.g. pending approval). */}
      <div className="min-w-0">
        {currentReservation ? (
          <div className="text-fg">
            <span className="font-medium">{currentReservation.slip_id}</span>
            <span className="ml-1 text-[11px] text-fg-tertiary">
              · {currentReservation.status}
            </span>
          </div>
        ) : contractSlipId ? (
          <div className="text-fg">
            <span className="font-medium">{contractSlipId}</span>
            <span className="ml-1 text-[11px] text-fg-tertiary">
              · {contractStatusLabel(contractStatus)}
            </span>
          </div>
        ) : (
          <span className="text-fg-tertiary">—</span>
        )}
      </div>

      {/* Service type — derived from active subscription / slip class.
          Replaces the old Cadence column (cadence is still in the
          filter chip row at the top of the list). */}
      <div className="min-w-0">
        {service ? (
          <Badge tone={serviceTone(service)} size="sm">
            {service}
          </Badge>
        ) : (
          <span className="text-fg-tertiary">—</span>
        )}
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

/**
 * Friendly labels for contract statuses when shown as a sub-line next
 * to the slip number on the members list. "Pending" covers any in-flight
 * draft / sent / partially_signed states — operator just needs to know
 * the slip is claimed but not yet live.
 */
function contractStatusLabel(s?: import("@/lib/types").ContractStatus): string {
  switch (s) {
    case "active":
      return "active";
    case "executed":
      return "executed";
    case "draft":
    case "sent":
    case "partially_signed":
      return "pending approval";
    default:
      return s ?? "";
  }
}
