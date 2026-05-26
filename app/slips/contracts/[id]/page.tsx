import { notFound } from "next/navigation";
import {
  BOATERS,
  CONTRACTS,
  SLIPS,
  VESSELS,
  getTemplate,
} from "@/lib/mock-data";
import { ContractDetail } from "@/components/contracts/contract-detail";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const c = CONTRACTS.find((x) => x.id === id);
  return { title: c ? `${c.number} — Contract` : "Contract — Marina Stee" };
}

/*
 * Contract detail page. Reached from the renewal pipeline tabs (and
 * from the holder Overview rail). Surfaces the full renewal workflow
 * inline: status-aware CTAs, signature link, ledger linkage, comm
 * history — staff finishes the renewal here without bouncing through
 * the holder profile.
 */
export default async function ContractDetailPage({ params }: Props) {
  const { id } = await params;
  const contract = CONTRACTS.find((c) => c.id === id);
  if (!contract) notFound();
  const boater = BOATERS.find((b) => b.id === contract.boater_id) ?? null;
  const vessel = contract.vessel_id
    ? (VESSELS.find((v) => v.id === contract.vessel_id) ?? null)
    : null;
  const slip = contract.slip_id
    ? (SLIPS.find((s) => s.id === contract.slip_id) ?? null)
    : null;
  const template = getTemplate(contract.template_id) ?? null;
  return (
    <ContractDetail
      ssrContract={contract}
      ssrBoater={boater}
      ssrVessel={vessel}
      ssrSlip={slip}
      ssrTemplate={template}
    />
  );
}
