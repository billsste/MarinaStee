"use client";

import * as React from "react";
import { CreditCard, ScrollText, Banknote, CloudUpload } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PosTerminal } from "@/components/pos/pos-terminal";
import { PosOrders } from "@/components/pos/pos-orders";
import { ArAging } from "@/components/pos/ar-aging";
import { QbSync } from "@/components/pos/qb-sync";
import { RentalsAsk } from "@/components/rentals/rentals-ask";

export default function LedgerPage() {
  return (
    <PageShell
      title="Ledger / POS"
      description="Unified financial surface — every retail sale, slip fee, and refund flows through one ledger. Charge-to-account links walk-up sales back to the boater."
    >
      <RentalsAsk
        placeholder="Ask the agent — e.g. 'charge a hoist fee to David Emmons' or 'who has the largest open balance?'"
        suggestions={[
          "Charge a hoist fee to David Emmons",
          "Who has the largest open balance?",
          "Daily close-out by location",
          "Run end-of-day reconciliation",
        ]}
      />

      <div className="mt-5">
        <Tabs defaultValue="terminal" className="w-full">
          <TabsList>
            <TabsTrigger value="terminal">
              <CreditCard className="size-3.5" />
              POS Terminal
            </TabsTrigger>
            <TabsTrigger value="orders">
              <ScrollText className="size-3.5" />
              Orders
            </TabsTrigger>
            <TabsTrigger value="ar">
              <Banknote className="size-3.5" />
              A/R
            </TabsTrigger>
            <TabsTrigger value="qb">
              <CloudUpload className="size-3.5" />
              QuickBooks Sync
            </TabsTrigger>
          </TabsList>

          <TabsContent value="terminal">
            <PosTerminal />
          </TabsContent>
          <TabsContent value="orders">
            <PosOrders />
          </TabsContent>
          <TabsContent value="ar">
            <ArAging />
          </TabsContent>
          <TabsContent value="qb">
            <QbSync />
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}
