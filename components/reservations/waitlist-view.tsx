"use client";

import * as React from "react";
import Link from "next/link";
import { ListPlus, MailCheck, Sparkles, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BOATERS, formatInches } from "@/lib/mock-data";
import {
  addReservation,
  nextReservationId,
  nextReservationNumber,
  updateWaitlistStatus,
  useWaitlist,
} from "@/lib/client-store";
import { AddWaitlistSheet } from "./add-waitlist-sheet";
import { cn } from "@/lib/utils";
import type { Reservation, WaitlistEntry, WaitlistStatus } from "@/lib/types";

/*
 * Waitlist tab on /reservations. Two columns: live queue (pending/offered)
 * and history (converted/declined/withdrawn).
 *
 * Per-row actions:
 *   - Offer (pending → offered, captures a slip pick)
 *   - Convert to reservation (offered → converted, creates a real
 *     reservation in the store so it shows up on Calendar + Today)
 *   - Withdraw (any → withdrawn)
 */

const STATUS_TONE: Record<WaitlistStatus, { tone: "ok" | "warn" | "info" | "danger" | "neutral"; label: string }> = {
  pending: { tone: "info", label: "pending" },
  offered: { tone: "warn", label: "offered" },
  converted: { tone: "ok", label: "converted" },
  declined: { tone: "danger", label: "declined" },
  withdrawn: { tone: "neutral", label: "withdrawn" },
};

export function WaitlistView() {
  const entries = useWaitlist();
  const [addOpen, setAddOpen] = React.useState(false);

  const active = entries
    .filter((e) => e.status === "pending" || e.status === "offered")
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const history = entries
    .filter((e) => e.status === "converted" || e.status === "declined" || e.status === "withdrawn")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-fg-subtle">
          When the marina is full, boaters wait here. Offer a slip when one opens, or convert
          once they confirm. Agent can also auto-match: <span className="italic">"offer A14 to the next eligible waitlist entry"</span>.
        </p>
        <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
          <ListPlus className="size-3.5" />
          Add to waitlist
        </Button>
      </div>

      <Panel
        title="Active queue"
        count={active.length}
        empty="No active waitlist entries. Marina has capacity."
      >
        {active.map((e) => (
          <WaitlistRow key={e.id} entry={e} />
        ))}
      </Panel>

      <Panel
        title="History"
        count={history.length}
        empty="Nothing in the archive."
        dim
      >
        {history.map((e) => (
          <WaitlistRow key={e.id} entry={e} />
        ))}
      </Panel>

      <AddWaitlistSheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Panel({
  title,
  count,
  empty,
  dim = false,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  dim?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-[12px] border border-hairline bg-surface-1", dim && "opacity-90")}>
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="text-[13px] font-medium text-fg">
          {title} <Badge tone="neutral" size="sm">{count}</Badge>
        </h3>
      </div>
      <div className="space-y-2 p-3">
        {count === 0 ? (
          <div className="rounded-[8px] border border-dashed border-hairline px-3 py-6 text-center text-[12px] text-fg-tertiary">
            {empty}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function WaitlistRow({ entry }: { entry: WaitlistEntry }) {
  const boater = entry.boater_id ? BOATERS.find((b) => b.id === entry.boater_id) : undefined;
  const displayName = boater?.display_name ?? entry.guest_name ?? "Unknown";
  const status = STATUS_TONE[entry.status];

  function offer() {
    // For demo, just pick the first dock name they preferred + a slot number.
    // In production this would open a slip-picker dialog.
    const slipPick = entry.preferred_dock ? `${entry.preferred_dock.split(" ")[0]}-?` : "A?";
    updateWaitlistStatus(entry.id, "offered", { offered_slip_id: slipPick });
  }

  function convert() {
    if (!entry.boater_id) {
      // Can't convert a prospect to a reservation without first creating a boater
      // record — flag it in a real impl. For demo, fall back to a generic id.
      alert("Need to onboard this prospect as a boater first. (Demo limitation.)");
      return;
    }
    const id = nextReservationId();
    const res: Reservation = {
      id,
      number: nextReservationNumber(),
      seq: "1/1",
      boater_id: entry.boater_id,
      vessel_id: "v_unknown",
      slip_id: entry.offered_slip_id ?? "A?",
      arrival_date: entry.preferred_arrival ?? new Date().toISOString().slice(0, 10),
      departure_date:
        entry.preferred_departure ??
        new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
      status: "scheduled",
      type: entry.reservation_type,
    };
    addReservation(res);
    updateWaitlistStatus(entry.id, "converted", { converted_reservation_id: id });
  }

  function withdraw() {
    updateWaitlistStatus(entry.id, "withdrawn");
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-[10px] border border-hairline bg-surface-2 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {boater ? (
            <Link
              href={`/holders/${boater.id}`}
              className="text-[13px] font-medium text-fg hover:text-primary"
            >
              {displayName}
            </Link>
          ) : (
            <span className="text-[13px] font-medium text-fg">{displayName}</span>
          )}
          {!boater && entry.guest_email && (
            <span className="text-[11px] text-fg-tertiary">{entry.guest_email}</span>
          )}
          <Badge tone={status.tone} size="sm">{status.label}</Badge>
          <Badge tone="outline" size="sm">{entry.reservation_type}</Badge>
        </div>
        <div className="mt-1 text-[12px] text-fg-subtle">
          {entry.preferred_arrival && entry.preferred_departure
            ? `${entry.preferred_arrival} → ${entry.preferred_departure}`
            : "Flexible dates"}
          {entry.loa_inches ? ` · ${formatInches(entry.loa_inches)} LOA` : ""}
          {entry.preferred_dock ? ` · ${entry.preferred_dock}` : ""}
        </div>
        {entry.notes && (
          <p className="mt-1.5 text-[12px] italic text-fg-tertiary">{entry.notes}</p>
        )}
        {entry.status === "offered" && entry.offered_slip_id && (
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-status-warn">
            <MailCheck className="size-3" /> Offered slip {entry.offered_slip_id} — awaiting confirm.
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {entry.status === "pending" && (
          <>
            <Button variant="primary" size="sm" onClick={offer}>
              <Sparkles className="size-3.5" />
              Offer
            </Button>
            <Button variant="ghost" size="sm" onClick={withdraw} aria-label="Withdraw">
              <XCircle className="size-3.5" />
            </Button>
          </>
        )}
        {entry.status === "offered" && (
          <>
            <Button variant="primary" size="sm" onClick={convert}>
              Convert
            </Button>
            <Button variant="ghost" size="sm" onClick={withdraw}>
              Withdraw
            </Button>
          </>
        )}
        {entry.status === "converted" && entry.converted_reservation_id && (
          <Badge tone="ok" size="sm">→ {entry.converted_reservation_id.slice(-6)}</Badge>
        )}
      </div>
    </div>
  );
}
