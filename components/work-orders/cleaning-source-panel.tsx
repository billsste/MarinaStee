import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { parseCleaningSource } from "@/lib/recurring-cleaning";
import type { WorkOrder } from "@/lib/types";

// Cleaning back-reference card. Every cleaning WO is tied to either a
// club booking or a paid boat rental. The source kind/id now live in
// the structured `wo.cleaning_source_kind` / `wo.cleaning_source_id`
// columns (preferred) — we fall back to parsing `Source: <label> <id>`
// out of internal_notes only for legacy WOs that pre-date the column
// migration. Reading the structured columns first means an operator
// can edit internal_notes freely without severing the back-ref.

const SOURCE_META = {
  club_booking: {
    label: "Club booking",
    href: (id: string) => `/bookings?focus=${encodeURIComponent(id)}`,
  },
  paid_rental: {
    label: "Paid rental",
    href: (id: string) => `/boat-rentals?focus=${encodeURIComponent(id)}`,
  },
} as const;

export function CleaningSourcePanel({ wo }: { wo: WorkOrder }) {
  if (wo.work_class !== "cleaning") return null;
  // Prefer structured fields; fall back to the legacy notes-prefix
  // parser for WOs created before the columns existed.
  const source =
    wo.cleaning_source_kind && wo.cleaning_source_id
      ? { kind: wo.cleaning_source_kind, id: wo.cleaning_source_id }
      : parseCleaningSource(wo.internal_notes);
  if (!source) return null;
  const meta = SOURCE_META[source.kind];

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        <Sparkles className="size-3.5" />
        Source
      </div>
      <Link
        href={meta.href(source.id)}
        className="flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-surface-2"
      >
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-fg">{meta.label}</div>
          <div className="truncate font-mono text-[11px] text-fg-tertiary">
            {source.id}
          </div>
        </div>
        <ArrowUpRight className="size-4 text-fg-tertiary" />
      </Link>
    </div>
  );
}
