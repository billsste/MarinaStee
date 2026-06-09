"use client";

import * as React from "react";
import { LayoutGrid, Anchor, Receipt, Wrench, MessageSquare } from "lucide-react";
import { OverviewTab } from "./overview-tab";
import { VesselsTab } from "./vessels-tab";
import { FinancialsTab } from "./financials-tab";
import { WorkOrdersTab } from "./work-orders-tab";
import { CommsTab } from "./comms-tab";
import { useTabUrlState } from "@/lib/use-tab-url-state";
import { cn } from "@/lib/utils";
import type {
  Boater,
  CardOnFile,
  Communication,
  Contract,
  LedgerEntry,
  Reservation,
  Vessel,
  WorkOrder,
} from "@/lib/types";

/*
 * Boater detail shell — canonical Marina Stee UX:
 *   sticky page header (identity bar, rendered by the parent) +
 *   left-rail nav + content. Same pattern as Settings + Holder portal.
 *
 * Tab state is URL-synced via `?tab=` so the operator can deep-link
 * (agent prompt "open the financials tab for b_jones" or external
 * Slack/email links land on the right sub-section).
 */

type SectionKey = "overview" | "vessels" | "financials" | "work-orders" | "comms";

function isBoaterSection(v: string | null | undefined): v is SectionKey {
  return (
    v === "overview" ||
    v === "vessels" ||
    v === "financials" ||
    v === "work-orders" ||
    v === "comms"
  );
}

const NAV_ITEMS: {
  key: SectionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "vessels", label: "Vessels & Slips", icon: Anchor },
  { key: "financials", label: "Financials", icon: Receipt },
  { key: "work-orders", label: "Work Orders", icon: Wrench },
  { key: "comms", label: "Comms", icon: MessageSquare },
];

export function BoaterDetail({
  boater,
  vessels,
  reservations,
  ledger,
  workOrders,
  comms,
  contracts,
  cards,
  openBalance,
}: {
  boater: Boater;
  vessels: Vessel[];
  reservations: Reservation[];
  ledger: LedgerEntry[];
  workOrders: WorkOrder[];
  comms: Communication[];
  contracts: Contract[];
  cards: CardOnFile[];
  openBalance: number;
}) {
  // Silence unused-args without forcing call-site changes — these props
  // are kept on the contract because higher-level pages already pass
  // them; the underlying tab components fetch via store hooks.
  void ledger;
  void comms;
  void openBalance;

  const [section, setSection] = useTabUrlState<SectionKey>(
    "tab",
    isBoaterSection,
    "overview",
  );

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_1fr]">
      {/* Left rail */}
      <nav
        aria-label="Boater sections"
        className="space-y-0.5 md:sticky md:top-20 md:self-start"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = section === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setSection(item.key)}
              className={cn(
                "flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] transition-colors",
                isActive
                  ? "bg-surface-3 font-medium text-fg"
                  : "text-fg-subtle hover:bg-surface-2 hover:text-fg"
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Content */}
      <div className="min-w-0">
        {section === "overview" && (
          <OverviewTab
            boater={boater}
            vessels={vessels}
            reservations={reservations}
            workOrders={workOrders}
          />
        )}
        {section === "vessels" && (
          <VesselsTab vessels={vessels} reservations={reservations} boaterId={boater.id} />
        )}
        {section === "financials" && (
          <FinancialsTab boater={boater} cards={cards} contracts={contracts} />
        )}
        {section === "work-orders" && (
          <WorkOrdersTab workOrders={workOrders} boaterId={boater.id} />
        )}
        {section === "comms" && <CommsTab boaterId={boater.id} />}
      </div>
    </div>
  );
}
