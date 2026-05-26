"use client";

import * as React from "react";
import Link from "next/link";
import { FilePlus2, FileText, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import { BOATERS, formatMoney } from "@/lib/mock-data";
import {
  deleteContract,
  deleteTemplate,
  nextContractId,
  nextContractNumber,
  nextTemplateId,
  upsertContract,
  upsertTemplate,
  useContractTemplates,
  useContracts,
} from "@/lib/client-store";
import type {
  Contract,
  ContractStatus,
  ContractTemplate,
  ContractTemplateType,
} from "@/lib/types";

/*
 * Templates library + flat contracts table. Both rows are now clickable
 * into RecordEditDialog (per user mandate). Add/Edit/Remove flows for both.
 */

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

const STATUS_OPTIONS: ContractStatus[] = [
  "draft", "sent", "partially_signed", "executed", "active",
  "expired", "terminated", "renewed",
];

const CONTRACT_FIELDS: FieldSpec<Contract>[] = [
  { key: "number", label: "Contract number", kind: "text", required: true, placeholder: "C-1054" },
  {
    key: "boater_id",
    label: "Boater",
    kind: "select",
    required: true,
    options: [], // populated dynamically per render
  },
  { key: "template_id", label: "Template", kind: "select", required: true, options: [], col: 2 },
  { key: "status", label: "Status", kind: "select", required: true, col: 2, options: STATUS_OPTIONS.map((s) => ({ value: s, label: s })) },
  { key: "effective_start", label: "Effective start", kind: "date", required: true, col: 2 },
  { key: "effective_end", label: "Effective end", kind: "date", required: true, col: 2 },
  { key: "annual_rate", label: "Annual rate ($)", kind: "money", step: "1", col: 2 },
  {
    key: "billing_cadence",
    label: "Billing cadence",
    kind: "select",
    required: true,
    col: 2,
    options: [
      { value: "monthly", label: "monthly" },
      { value: "annual", label: "annual" },
      { value: "seasonal", label: "seasonal" },
      { value: "transient", label: "transient" },
    ],
  },
  { key: "slip_id", label: "Slip", kind: "text", placeholder: "A29" },
];

const TEMPLATE_TYPE_OPTIONS: ContractTemplateType[] = [
  "annual_slip", "seasonal_slip", "transient_slip", "dry_storage",
  "mooring", "rental", "winterization", "service",
];

const TEMPLATE_FIELDS: FieldSpec<ContractTemplate>[] = [
  { key: "name", label: "Template name", kind: "text", required: true, placeholder: "Annual Slip Lease" },
  {
    key: "type", label: "Type", kind: "select", required: true, col: 2,
    options: TEMPLATE_TYPE_OPTIONS.map((t) => ({ value: t, label: t.replace("_", " ") })),
  },
  { key: "version", label: "Version", kind: "number", step: "1", col: 2 },
  { key: "default_term_months", label: "Default term (months)", kind: "number", step: "1", col: 2 },
  {
    key: "default_billing_cadence", label: "Default cadence", kind: "select", required: true, col: 2,
    options: [
      { value: "monthly", label: "monthly" },
      { value: "annual", label: "annual" },
      { value: "seasonal", label: "seasonal" },
      { value: "transient", label: "transient" },
    ],
  },
  { key: "default_annual_rate", label: "Default annual rate ($)", kind: "money", step: "1" },
  { key: "auto_renew", label: "Auto-renew", kind: "boolean", placeholder: "Auto-renew at term end" },
  { key: "body_preview", label: "Body preview", kind: "textarea", placeholder: "Opening paragraph — used in agent drafting." },
];

export function ContractsView() {
  const contracts = useContracts();
  const templates = useContractTemplates();
  const active = contracts.filter((c) => c.status === "active");
  const expiringSoon = contracts.filter((c) => {
    if (c.status !== "active" || !c.effective_end) return false;
    const days = (new Date(c.effective_end).getTime() - Date.now()) / 86_400_000;
    return days <= 90 && days >= 0;
  });
  const totalAnnualValue = active.reduce((sum, c) => sum + (c.annual_rate ?? 0), 0);

  // Dialog state
  const [contractOpen, setContractOpen] = React.useState(false);
  const [editingContract, setEditingContract] = React.useState<Contract | undefined>();
  const [templateOpen, setTemplateOpen] = React.useState(false);
  const [editingTemplate, setEditingTemplate] = React.useState<ContractTemplate | undefined>();

  // Inject dynamic options into the contract field schema
  const contractFields = React.useMemo<FieldSpec<Contract>[]>(() => {
    return CONTRACT_FIELDS.map((f) => {
      if (f.key === "boater_id") {
        return { ...f, options: BOATERS.map((b) => ({ value: b.id, label: b.display_name })) };
      }
      if (f.key === "template_id") {
        return { ...f, options: templates.map((t) => ({ value: t.id, label: t.name })) };
      }
      return f;
    });
  }, [templates]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-4">
        <KpiCard label="Active contracts" value={`${active.length}`} sub="Across all groups" />
        <KpiCard
          label="Expiring (90d)"
          value={`${expiringSoon.length}`}
          sub="Ready for renewal flow"
          tone={expiringSoon.length > 0 ? "warn" : "ok"}
        />
        <KpiCard
          label="Annual contract value"
          value={formatMoney(totalAnnualValue)}
          sub="Sum of active annual rates"
          tone="info"
        />
        <KpiCard
          label="Templates"
          value={`${templates.length}`}
          sub={`${templates.filter((t) => t.auto_renew).length} auto-renew`}
        />
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[14px] font-medium text-fg">Template library</h2>
          <Button variant="ghost" size="sm" onClick={() => { setEditingTemplate(undefined); setTemplateOpen(true); }}>
            <FilePlus2 className="size-3.5" />
            New template
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              t={t}
              onClick={() => { setEditingTemplate(t); setTemplateOpen(true); }}
            />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[14px] font-medium text-fg">Contracts ({contracts.length})</h2>
          <Button variant="primary" size="sm" onClick={() => { setEditingContract(undefined); setContractOpen(true); }}>
            <Plus className="size-3.5" />
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
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <ContractRow
                    key={c.id}
                    c={c}
                    templates={templates}
                    onClick={() => { setEditingContract(c); setContractOpen(true); }}
                  />
                ))}
                {contracts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-fg-subtle">
                      No contracts yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <RecordEditDialog<Contract>
        open={contractOpen}
        onOpenChange={setContractOpen}
        title={editingContract ? `Edit contract — ${editingContract.number}` : "New contract"}
        description="Existing reservations + ledger entries stay linked. Status changes (e.g. terminated) propagate to Notifications."
        record={editingContract}
        fields={contractFields}
        entity="contract"
        onSave={(values) => {
          const final: Contract = {
            ...values,
            id: values.id || nextContractId(),
            number: values.number || nextContractNumber(),
            annual_rate: values.annual_rate ? Number(values.annual_rate) : undefined,
            template_version: values.template_version ?? 1,
            rsvp_boater_ids: undefined as never, // not used here
          } as Contract;
          upsertContract(final);
        }}
        onDelete={editingContract ? (c) => deleteContract(c.id) : undefined}
      />

      <RecordEditDialog<ContractTemplate>
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        title={editingTemplate ? `Edit template — ${editingTemplate.name}` : "New template"}
        description="Templates seed new contract drafts. Changing a template doesn't affect already-signed contracts."
        record={editingTemplate}
        fields={TEMPLATE_FIELDS}
        entity="template"
        onSave={(values) => {
          const final: ContractTemplate = {
            ...values,
            id: values.id || nextTemplateId(),
            version: Number(values.version) || 1,
            default_term_months: Number(values.default_term_months) || 12,
            default_annual_rate: values.default_annual_rate ? Number(values.default_annual_rate) : undefined,
            required_signers: values.required_signers ?? ["boater"],
            auto_renew: Boolean(values.auto_renew),
          } as ContractTemplate;
          upsertTemplate(final);
        }}
        onDelete={editingTemplate ? (t) => deleteTemplate(t.id) : undefined}
      />
    </div>
  );
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
  const valueTone = tone === "ok" ? "text-status-ok" : tone === "warn" ? "text-status-warn" : "text-fg";
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <div className="mb-1.5 text-[12px] font-medium text-fg-subtle">{label}</div>
      <div className={"money-display text-[24px] " + valueTone}>{value}</div>
      <div className="mt-1 text-[11px] text-fg-tertiary">{sub}</div>
    </div>
  );
}

function TemplateCard({ t, onClick }: { t: ContractTemplate; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-[12px] border border-hairline bg-surface-1 p-4 text-left transition-colors hover:border-hairline-strong hover:bg-surface-2"
    >
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
      <div className="mt-3 text-[11px] text-fg-tertiary">Click to edit →</div>
    </button>
  );
}

function ContractRow({
  c,
  templates,
  onClick,
}: {
  c: Contract;
  templates: ContractTemplate[];
  onClick: () => void;
}) {
  const boater = BOATERS.find((b) => b.id === c.boater_id);
  const tpl = templates.find((t) => t.id === c.template_id);
  return (
    <tr
      onClick={onClick}
      className="cursor-pointer border-b border-hairline last:border-b-0 transition-colors hover:bg-surface-2"
    >
      <Td className="font-mono text-[12px] font-medium text-fg">{c.number}</Td>
      <Td>
        {boater ? (
          // stopPropagation so clicking the boater link doesn't also open the edit dialog
          <Link
            href={`/boaters/${boater.id}`}
            className="text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
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
        <Badge tone={STATUS_TONE[c.status]} size="sm">{c.status}</Badge>
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
