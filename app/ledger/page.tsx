"use client";

import * as React from "react";
import {
  Banknote,
  CloudUpload,
  CreditCard,
  FileText,
  Package,
  ScrollText,
} from "lucide-react";
import { PosTerminal } from "@/components/pos/pos-terminal";
import { PosOrders } from "@/components/pos/pos-orders";
import { ArAging } from "@/components/pos/ar-aging";
import { BillingRuns } from "@/components/pos/billing-runs";
import { CatalogManager } from "@/components/pos/catalog-manager";
import { QbSync } from "@/components/pos/qb-sync";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { useTabUrlState } from "@/lib/use-tab-url-state";
import { cn } from "@/lib/utils";

type SectionKey = "billing" | "terminal" | "orders" | "ar" | "catalog" | "qb";

function isLedgerSection(v: string | null | undefined): v is SectionKey {
  return (
    v === "billing" ||
    v === "terminal" ||
    v === "orders" ||
    v === "ar" ||
    v === "catalog" ||
    v === "qb"
  );
}

const NAV_ITEMS: {
  key: SectionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "billing", label: "Billing runs", icon: FileText },
  { key: "terminal", label: "POS Terminal", icon: CreditCard },
  { key: "orders", label: "Orders", icon: ScrollText },
  { key: "ar", label: "Money owed", icon: Banknote },
  { key: "catalog", label: "Catalog", icon: Package },
  { key: "qb", label: "QuickBooks Sync", icon: CloudUpload },
];

export default function LedgerPage() {
  // Suspense wrapper so useSearchParams (via useTabUrlState) doesn't
  // bomb during Next 16 static prerender. Same pattern as /members.
  return (
    <React.Suspense fallback={null}>
      <LedgerPageInner />
    </React.Suspense>
  );
}

function LedgerPageInner() {
  // ?tab=billing | terminal | orders | ar | catalog | qb — deep-link
  // shape shared across /members, /staff, /ledger so agent navigation
  // and bookmarks land on the right sub-section every time.
  const [section, setSection] = useTabUrlState<SectionKey>(
    "tab",
    isLedgerSection,
    "billing",
  );

  return (
    // No section h1 — the AppShell breadcrumb ("Marina Stee / Ledger / POS")
    // identifies the page and the left rail tells you which sub-area
    // you're in. See CLAUDE.md §"List-page UX consistency" rule #10.
    <div className="mx-auto w-full max-w-[1400px] px-5 pt-4 pb-32">
      {/* Agent nests inside the content column (right of rail) so the chat
          box, suggestion chips, and section content all share the same left
          edge. Same pattern as /services and /settings — keeps the agent +
          content visually paired as one block. */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_1fr]">
        <nav
          aria-label="Ledger sections"
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

        <div className="min-w-0 space-y-5">
          <RentalsAsk
            placeholder="Ask the agent — e.g. 'charge a hoist fee to David Emmons' or 'add a $4 hot dog'"
            suggestions={[
              "Charge a hoist fee to David Emmons",
              "Who has the largest open balance?",
              "Add a $4 hot dog to the restaurant menu",
              "Bump pretzel price to $5",
            ]}
          />
          {section === "billing" && <BillingRuns />}
          {section === "terminal" && <PosTerminal />}
          {section === "orders" && <PosOrders />}
          {section === "ar" && <ArAging />}
          {section === "catalog" && <CatalogManager />}
          {section === "qb" && <QbSync />}
        </div>
      </div>
    </div>
  );
}
