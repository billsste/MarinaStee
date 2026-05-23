import { FileText, FilePlus2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import {
  CONTRACTS,
  CONTRACT_TEMPLATES,
  BOATERS,
  formatMoney,
  getTemplate,
} from "@/lib/mock-data";
import type { Contract, ContractStatus, ContractTemplate } from "@/lib/types";

export const metadata = { title: "Contracts — Marina Stee Rentals" };

const STATUS_TONE: Record<ContractStatus, "ok" | "warn" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  sent: "info",
  partially_signed: "info",
  executed: "ok",
  active: "ok",
  expired: "neutral",
  terminated: "danger",
  renewed: "neutral",
};

export default function ContractsPage() {
  const active = CONTRACTS.filter((c) => c.status === "active");
  const expiringSoon = CONTRACTS.filter((c) => {
    if (c.status !== "active" || !c.effective_end) return false;
    const days = (new Date(c.effective_end).getTime() - Date.now()) / 86_400_000;
    return days <= 90 && days >= 0;
  });
  const totalAnnualValue = active.reduce((sum, c) => sum + (c.annual_rate ?? 0), 0);

  return (
    <div className="space-y-5">
      <RentalsAsk
        placeholder="Ask about contracts — e.g. 'draft annual contracts for slips becoming vacant in October'"
        suggestions={[
          "Draft renewals for October-expiring contracts",
          "Update the annual slip template — add pet clause",
          "Show all draft contracts pending boater signature",
        ]}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-4">
        <KpiCard label="Active contracts" value={`${active.length}`} sub="Across all groups" />
        <KpiCard label="Expiring (90d)" value={`${expiringSoon.length}`} sub="Ready for renewal flow" tone={expiringSoon.length > 0 ? "warn" : "ok"} />
        <KpiCard label="Annual contract value" value={formatMoney(totalAnnualValue)} sub="Sum of active annual rates" tone="info" />
        <KpiCard label="Templates" value={`${CONTRACT_TEMPLATES.length}`} sub={`${CONTRACT_TEMPLATES.filter((t) => t.auto_renew).length} auto-renew`} />
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[14px] font-medium text-fg">Template library</h2>
          <Button variant="ghost" size="sm">
            <FilePlus2 className="size-3.5" />
            New template
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {CONTRACT_TEMPLATES.map((t) => (
            <TemplateCard key={t.id} t={t} />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[14px] font-medium text-fg">Contracts</h2>
          <Button variant="primary" size="sm">
            <FilePlus2 className="size-3.5" />
            New contract
          </Button>
        </div>
        <div className="rounded-[12px] border border-hairline bg-surface-1">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-hairline text-[11px] uppercase tracking-wide text-fg-tertiary">
                  <Th>Number</Th>
                  <Th>Boater</Th>
                  <Th>Template</Th>
                  <Th>Effective</Th>
                  <Th className="text-right">Annual</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {CONTRACTS.map((c) => (
                  <ContractRow key={c.id} c={c} />
                ))}
                {CONTRACTS.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-fg-subtle">
                      No contracts yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function TemplateCard({ t }: { t: ContractTemplate }) {
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <div className="mb-2 flex items-start justify-between">
        <div className="flex size-9 items-center justify-center rounded-[8px] bg-surface-3 text-primary">
          <FileText className="size-4" />
        </div>
        <div className="flex items-center gap-1.5">
          <Badge tone="outline" size="sm">v{t.version}</Badge>
          {t.auto_renew && (
            <Badge tone="primary" size="sm">
              <RefreshCw className="size-3" />
              Auto
            </Badge>
          )}
        </div>
      </div>
      <h3 className="text-[14px] font-medium text-fg">{t.name}</h3>
      <p className="mt-1 line-clamp-2 text-[12px] text-fg-subtle">{t.body_preview}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <div className="text-fg-tertiary">Term</div>
          <div className="text-fg">{t.default_term_months} mo</div>
        </div>
        <div>
          <div className="text-fg-tertiary">Cadence</div>
          <div className="capitalize text-fg">{t.default_billing_cadence}</div>
        </div>
        {t.default_annual_rate && (
          <div>
            <div className="text-fg-tertiary">Default rate</div>
            <div className="text-fg">{formatMoney(t.default_annual_rate)}/yr</div>
          </div>
        )}
        <div>
          <div className="text-fg-tertiary">Signers</div>
          <div className="text-fg">{t.required_signers.join(", ")}</div>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button variant="ghost" size="sm">Preview</Button>
        <Button variant="secondary" size="sm">Draft from this</Button>
      </div>
    </div>
  );
}

function ContractRow({ c }: { c: Contract }) {
  const boater = BOATERS.find((b) => b.id === c.boater_id);
  const tpl = getTemplate(c.template_id);
  return (
    <tr className="border-b border-hairline last:border-b-0">
      <Td className="font-mono text-[12px] font-medium text-fg">{c.number}</Td>
      <Td>
        {boater ? (
          <Link href={`/boaters/${boater.id}`} className="text-primary hover:underline">
            {boater.display_name}
          </Link>
        ) : (
          <span className="text-fg-tertiary">—</span>
        )}
      </Td>
      <Td className="text-fg-subtle">{tpl?.name ?? "—"}</Td>
      <Td className="text-fg-subtle">
        {c.effective_start} → {c.effective_end}
      </Td>
      <Td className="text-right text-fg">
        {c.annual_rate ? formatMoney(c.annual_rate) : "—"}
      </Td>
      <Td>
        <Badge tone={STATUS_TONE[c.status]} size="sm">
          {c.status}
        </Badge>
      </Td>
      <Td className="text-right">
        <Button variant="ghost" size="sm">View</Button>
      </Td>
    </tr>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={"px-3 py-2 text-left font-medium " + (className ?? "")}>{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={"px-3 py-2 align-middle " + (className ?? "")}>{children}</td>;
}

function KpiCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "ok" | "warn" | "info" | "neutral";
}) {
  const valueTone = tone === "warn" ? "text-status-warn" : "text-fg";
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">{label}</div>
      <div className={"mt-1 text-[20px] font-semibold tracking-tight " + valueTone}>{value}</div>
      <div className="mt-1 text-[11px] text-fg-tertiary">{sub}</div>
    </div>
  );
}
