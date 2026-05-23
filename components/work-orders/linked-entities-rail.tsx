import Link from "next/link";
import { Anchor, Ship, FileText, MessageSquare, Receipt, User as UserIcon } from "lucide-react";
import {
  BOATERS,
  CONTRACTS,
  VESSELS,
  USERS,
  formatMoney,
  getCommunicationsForWorkOrder,
  getLedgerEntriesForWorkOrder,
  getSlip,
} from "@/lib/mock-data";
import type { WorkOrder } from "@/lib/types";

export function LinkedEntitiesRail({ wo }: { wo: WorkOrder }) {
  const boater = BOATERS.find((b) => b.id === wo.boater_id);
  const vessel = VESSELS.find((v) => v.id === wo.vessel_id);
  const slip = getSlip(wo.slip_id);
  const assignee = USERS.find((u) => u.id === wo.assignee_user_id);
  const contract = boater
    ? CONTRACTS.find((c) => c.boater_id === boater.id && c.status === "active")
    : undefined;
  const ledgerEntries = getLedgerEntriesForWorkOrder(wo.id);
  const comms = getCommunicationsForWorkOrder(wo.id);

  return (
    <aside className="hidden w-[300px] shrink-0 lg:block">
      <div className="sticky top-4 space-y-3">
        <Section title="People">
          {boater && (
            <RowLink
              icon={<UserIcon className="size-3.5" />}
              href={`/boaters/${boater.id}`}
              primary={boater.display_name}
              secondary={`${boater.code ?? ""}${boater.billing_cadence ? ` · ${boater.billing_cadence}` : ""}`}
            />
          )}
          {assignee && (
            <RowStatic
              icon={<UserIcon className="size-3.5" />}
              primary={assignee.name}
              secondary={`assigned · ${assignee.role}`}
            />
          )}
        </Section>

        <Section title="Assets">
          {vessel && (
            <RowLink
              icon={<Ship className="size-3.5" />}
              href={`/boaters/${vessel.boater_id}?tab=vessels`}
              primary={vessel.name}
              secondary={`${vessel.year ?? ""} ${vessel.make ?? ""} ${vessel.model ?? ""}`.trim()}
            />
          )}
          {slip && (
            <RowLink
              icon={<Anchor className="size-3.5" />}
              href={`/rentals/spaces`}
              primary={`${slip.dock} · ${slip.number}`}
              secondary={`${slip.invoice_category}`}
            />
          )}
        </Section>

        {contract && (
          <Section title="Contract">
            <RowLink
              icon={<FileText className="size-3.5" />}
              href={`/rentals/contracts`}
              primary={contract.number}
              secondary={`${contract.effective_start} → ${contract.effective_end}`}
            />
          </Section>
        )}

        {ledgerEntries.length > 0 && (
          <Section title="Ledger entries">
            {ledgerEntries.map((le) => (
              <RowLink
                key={le.id}
                icon={<Receipt className="size-3.5" />}
                href={`/boaters/${le.boater_id}?tab=financials`}
                primary={`${le.type === "invoice" ? "Invoice" : le.type === "payment" ? "Payment" : le.type}${le.number ? ` ${le.number}` : ""}`}
                secondary={`${le.date} · ${formatMoney(le.amount)}`}
              />
            ))}
          </Section>
        )}

        {comms.length > 0 && (
          <Section title="Communications">
            {comms.map((c) => (
              <RowStatic
                key={c.id}
                icon={<MessageSquare className="size-3.5" />}
                primary={c.subject ?? c.body_preview.slice(0, 40)}
                secondary={`${c.sender_label} · ${c.status}`}
              />
            ))}
          </Section>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="border-b border-hairline px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {title}
      </div>
      <div className="divide-y divide-hairline">{children}</div>
    </div>
  );
}

function RowLink({
  icon,
  href,
  primary,
  secondary,
}: {
  icon: React.ReactNode;
  href: string;
  primary: string;
  secondary?: string;
}) {
  return (
    <Link
      href={href}
      className="block px-3 py-2 transition-colors hover:bg-surface-2"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-fg-tertiary">{icon}</span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-fg">{primary}</div>
          {secondary && (
            <div className="truncate text-[11px] text-fg-tertiary">{secondary}</div>
          )}
        </div>
      </div>
    </Link>
  );
}

function RowStatic({
  icon,
  primary,
  secondary,
}: {
  icon: React.ReactNode;
  primary: string;
  secondary?: string;
}) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-fg-tertiary">{icon}</span>
        <div className="min-w-0">
          <div className="truncate text-[13px] text-fg">{primary}</div>
          {secondary && (
            <div className="truncate text-[11px] text-fg-tertiary">{secondary}</div>
          )}
        </div>
      </div>
    </div>
  );
}
