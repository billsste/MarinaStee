import { ClipboardList, LayoutGrid } from "lucide-react";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RosterView } from "@/components/rentals/roster-view";
import { InventoryView } from "@/components/rentals/inventory-view";

export const metadata = { title: "Slips — Marina Stee Docks" };

/*
 * Spaces is now ROSTER-first for the annual-holder marina.
 * Default view = who occupies every slip this season (the harbormaster's
 * morning screen). Inventory (the physical slip table by dock) becomes a
 * sub-view.
 */
export default function SpacesPage() {
  return (
    <div className="space-y-5">
      <RentalsAsk
        placeholder="Ask the roster — e.g. 'who expires in the next 60 days?' or 'draft 2027 renewals for D Dock'"
        suggestions={[
          "Expiring in the next 90 days",
          "Show me everyone on A Dock",
          "Vacant slips > 30 ft",
          "Lapsed contracts — who needs to renew?",
        ]}
      />

      <Tabs defaultValue="roster" className="w-full">
        <TabsList>
          <TabsTrigger value="roster">
            <ClipboardList className="size-3.5" />
            Roster
          </TabsTrigger>
          <TabsTrigger value="inventory">
            <LayoutGrid className="size-3.5" />
            Inventory
          </TabsTrigger>
        </TabsList>

        <TabsContent value="roster">
          <RosterView />
        </TabsContent>
        <TabsContent value="inventory">
          <InventoryView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
