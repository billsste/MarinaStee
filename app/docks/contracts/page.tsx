import { FilePlus2, FileText, Workflow } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { RenewalPipelineView } from "@/components/contracts/renewal-pipeline-view";
import { ContractsView } from "@/components/contracts/contracts-view";

export const metadata = { title: "Contracts — Marina Stee Docks" };

/*
 * Contracts page — pipeline-first for the annual cadence (90% case).
 *  - Renewal pipeline (default): the fall-cycle workflow
 *  - All contracts + templates: the previous secondary view
 */
export default function ContractsPage() {
  return (
    <div className="space-y-5">
      <RentalsAsk
        placeholder="Ask the renewal pipeline — e.g. 'draft 2027 renewals for everyone on D Dock at +5%'"
        suggestions={[
          "Draft 2027 renewals for everyone expiring this fall",
          "Who hasn't returned a signed 2027 contract yet?",
          "Update the annual slip template — add pet clause",
          "Send a friendly nudge to all sent-but-unsigned",
        ]}
      />

      <Tabs defaultValue="pipeline" className="w-full">
        <TabsList>
          <TabsTrigger value="pipeline">
            <Workflow className="size-3.5" />
            Renewal pipeline
          </TabsTrigger>
          <TabsTrigger value="contracts">
            <FileText className="size-3.5" />
            All contracts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline">
          <RenewalPipelineView />
        </TabsContent>
        <TabsContent value="contracts">
          <ContractsView />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Used implicitly by ContractsView "New contract" button — keep import live
void FilePlus2;
