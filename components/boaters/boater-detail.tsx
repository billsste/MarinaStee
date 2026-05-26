"use client";

import * as React from "react";
import { LayoutGrid, Anchor, Receipt, Wrench, MessageSquare } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OverviewTab } from "./overview-tab";
import { VesselsTab } from "./vessels-tab";
import { FinancialsTab } from "./financials-tab";
import { WorkOrdersTab } from "./work-orders-tab";
import { CommsTab } from "./comms-tab";
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
  return (
    <Tabs defaultValue="overview" className="w-full">
      <TabsList>
        <TabsTrigger value="overview">
          <LayoutGrid className="size-3.5" />
          Overview
        </TabsTrigger>
        <TabsTrigger value="vessels">
          <Anchor className="size-3.5" />
          Vessels &amp; Slips
        </TabsTrigger>
        <TabsTrigger value="financials">
          <Receipt className="size-3.5" />
          Financials
        </TabsTrigger>
        <TabsTrigger value="work-orders">
          <Wrench className="size-3.5" />
          Work Orders
        </TabsTrigger>
        <TabsTrigger value="comms">
          <MessageSquare className="size-3.5" />
          Comms
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <OverviewTab
          boater={boater}
          vessels={vessels}
          reservations={reservations}
          workOrders={workOrders}
        />
      </TabsContent>
      <TabsContent value="vessels">
        <VesselsTab vessels={vessels} reservations={reservations} boaterId={boater.id} />
      </TabsContent>
      <TabsContent value="financials">
        <FinancialsTab boater={boater} cards={cards} contracts={contracts} />
      </TabsContent>
      <TabsContent value="work-orders">
        <WorkOrdersTab workOrders={workOrders} boaterId={boater.id} />
      </TabsContent>
      <TabsContent value="comms">
        <CommsTab boaterId={boater.id} />
      </TabsContent>
    </Tabs>
  );
}
