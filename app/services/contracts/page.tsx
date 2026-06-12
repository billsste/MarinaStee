"use client";

import * as React from "react";
import { FileText, Workflow } from "lucide-react";
import { TabButton, TabStrip } from "@/components/ui/tab-button";
import { RenewalPipelineView } from "@/components/contracts/renewal-pipeline-view";
import { ContractsView } from "@/components/contracts/contracts-view";

/*
 * Contracts page — pipeline-first for the annual cadence (90% case).
 *
 *  - Renewal pipeline (default): the fall-cycle workflow
 *  - All contracts + templates: the previous secondary view
 *
 * Switched from shadcn Tabs to the canonical TabStrip + TabButton so
 * the tab chrome reads identical to /services/rates and
 * /services/waitlist. See components/ui/tab-button.tsx for the shared
 * component + CLAUDE.md §"List-page UX consistency" for the broader
 * rule (tab strips express distinct VIEWS, never filter axes).
 */

type Tab = "pipeline" | "contracts";

export default function ContractsPage() {
  const [tab, setTab] = React.useState<Tab>("pipeline");

  return (
    <section className="space-y-4">
      <TabStrip ariaLabel="Contracts view">
        <TabButton
          active={tab === "pipeline"}
          onClick={() => setTab("pipeline")}
          label="Renewal pipeline"
          icon={<Workflow className="size-3.5" />}
        />
        <TabButton
          active={tab === "contracts"}
          onClick={() => setTab("contracts")}
          label="All contracts"
          icon={<FileText className="size-3.5" />}
        />
      </TabStrip>

      {tab === "pipeline" && <RenewalPipelineView />}
      {tab === "contracts" && <ContractsView />}
    </section>
  );
}
