"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Anchor,
  Calendar,
  User,
  Sailboat,
  Receipt,
  FileText,
  CheckCircle2,
  Send,
  Copy,
  ExternalLink,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/mock-data";
import {
  addCommunication,
  mintContractSignatureToken,
  updateContract,
  useCommunicationsForBoater,
  useLedgerForBoater,
  useStore,
} from "@/lib/client-store";
import type {
  Boater,
  Communication,
  Contract,
  ContractStatus,
  ContractTemplate,
  Slip,
  Vessel,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * Renewal-pipeline-friendly contract detail.
 *
 * Layout: identity header → status-aware "Next step" card → details
 * grid (term, pricing, parties, links) → related comms timeline. Every
 * stage of the renewal funnel resolves to an action surface here so
 * staff can finish the workflow without bouncing to the holder page.
 */
export function ContractDetail({
  ssrContract,
  ssrBoater,
  ssrVessel,
  ssrSlip,
  ssrTemplate,
}: {
  ssrContract: Contract;
  ssrBoater: Boater | null;
  ssrVessel: Vessel | null;
  ssrSlip: Slip | null;
  ssrTemplate: ContractTemplate | null;
}) {
  const store = useStore();
  const contract =
    store.contracts.find((c) => c.id === ssrContract.id) ?? ssrContract;
  const boater =
    (contract.boater_id && store.boaters.find((b) => b.id === contract.boater_id)) ||
    ssrBoater;
  const vessel =
    (contract.vessel_id && store.vessels.find((v) => v.id === contract.vessel_id)) ||
    ssrVessel;
  const slip = ssrSlip; // SLIPS is static seed; no live mutation
  const template = ssrTemplate;

  // Comms + linked ledger items, scoped to the contract
  const boaterComms = useCommunicationsForBoater(contract.boater_id);
  const linkedComms = boaterComms.filter(
    (c) => c.related_entity?.type === "contract" && c.related_entity.id === contract.id
  );
  const ledger = useLedgerForBoater(contract.boater_id);
  // Match invoices that reference this contract's slip — the closest
  // we get without a contract_id back-reference on LedgerEntry.
  const linkedInvoices = ledger.filter(
    (l) => l.type === "invoice" && (l.line_items ?? []).some((li) => li.description.includes(slip?.id ?? "___"))
  );

  return (
    <div className="mx-auto w-full max-w-[1080px] px-6 pt-6 pb-12">
      {/* Top bar */}
      <div className="mb-4 flex items-center justify-between">
        <Link
          href="/slips/contracts"
          className="inline-flex items-center gap-1 text-[12px] text-fg-subtle hover:text-fg"
        >
          <ArrowLeft className="size-3.5" />
          Contracts
        </Link>
        <StatusBadge status={contract.status} />
      </div>

      {/* Header */}
      <header className="mb-5">
        <div className="flex items-baseline gap-2">
          <h1 className="display-tight font-mono text-[26px] font-semibold text-fg">
            {contract.number}
          </h1>
          {template && (
            <span className="text-[14px] text-fg-subtle">· {template.name}</span>
          )}
        </div>
        <p className="mt-1 text-[13px] text-fg-subtle">
          {boater ? (
            <Link href={`/holders/${boater.id}`} className="hover:text-primary">
              {boater.display_name}
            </Link>
          ) : (
            "—"
          )}
          {slip && (
            <>
              {" · "}
              <span className="font-mono">{slip.id}</span> · {slip.dock}
            </>
          )}
          {" · "}
          {contract.effective_start} → {contract.effective_end}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left rail — Next step + Comms history */}
        <div className="space-y-4 lg:col-span-7">
          <NextStepCard contract={contract} boater={boater} slip={slip} />

          {/* Linked invoices */}
          {linkedInvoices.length > 0 && (
            <section className="rounded-[12px] border border-hairline bg-surface-1">
              <div className="border-b border-hairline px-4 py-2.5">
                <h2 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
                  <Receipt className="size-3.5 text-fg-subtle" />
                  Linked invoices
                </h2>
              </div>
              <ul className="divide-y divide-hairline">
                {linkedInvoices.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div>
                      <div className="font-mono text-[12px] font-medium text-primary">
                        {inv.number ?? inv.id.slice(-6)}
                      </div>
                      <div className="text-[11px] text-fg-tertiary">{inv.date}</div>
                    </div>
                    <div className="text-right">
                      <div className="tabular text-[13px] text-fg">{formatMoney(inv.amount)}</div>
                      <Badge tone={inv.status === "paid" ? "ok" : "warn"} size="sm">
                        {inv.status}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Communications timeline */}
          <section className="rounded-[12px] border border-hairline bg-surface-1">
            <div className="border-b border-hairline px-4 py-2.5">
              <h2 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
                <FileText className="size-3.5 text-fg-subtle" />
                Communications
                {linkedComms.length > 0 && (
                  <Badge tone="neutral" size="sm">
                    {linkedComms.length}
                  </Badge>
                )}
              </h2>
            </div>
            {linkedComms.length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-fg-subtle">
                No outbound messages on this contract yet.
              </p>
            ) : (
              <ul className="divide-y divide-hairline">
                {linkedComms
                  .sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1))
                  .map((c) => (
                    <li key={c.id} className="px-4 py-2.5 text-[12px]">
                      <div className="flex items-center gap-2">
                        <Badge tone={c.direction === "outbound" ? "info" : "ok"} size="sm">
                          {c.direction}
                        </Badge>
                        <span className="text-fg">{c.subject}</span>
                        <span className="ml-auto text-[10px] tabular text-fg-tertiary">
                          {new Date(c.sent_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      {c.body_preview && (
                        <p className="mt-0.5 text-[11px] text-fg-tertiary">
                          {c.body_preview}
                        </p>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </div>

        {/* Right rail — facts */}
        <div className="space-y-4 lg:col-span-5">
          <section className="rounded-[12px] border border-hairline bg-surface-1">
            <div className="border-b border-hairline px-4 py-2.5">
              <h2 className="text-[13px] font-medium text-fg">Details</h2>
            </div>
            <dl className="space-y-2 p-4 text-[13px]">
              <Field
                icon={<Calendar className="size-3.5" />}
                label="Term"
                value={`${contract.effective_start} → ${contract.effective_end}`}
              />
              {contract.annual_rate && (
                <Field
                  icon={<Receipt className="size-3.5" />}
                  label="Annual rate"
                  value={`${formatMoney(contract.annual_rate)} · billed ${contract.billing_cadence}`}
                />
              )}
              {boater && (
                <Field
                  icon={<User className="size-3.5" />}
                  label="Holder"
                  value={boater.display_name}
                  href={`/holders/${boater.id}`}
                />
              )}
              {slip && (
                <Field
                  icon={<Anchor className="size-3.5" />}
                  label="Slip"
                  value={`${slip.id} · ${slip.dock}`}
                />
              )}
              {vessel && (
                <Field
                  icon={<Sailboat className="size-3.5" />}
                  label="Vessel"
                  value={vessel.name}
                />
              )}
              {template && (
                <Field
                  icon={<FileText className="size-3.5" />}
                  label="Template"
                  value={`${template.name} · v${template.version}`}
                />
              )}
              {contract.signature_token && (
                <Field
                  icon={<ExternalLink className="size-3.5" />}
                  label="Public link"
                  value={`/onboard/${contract.signature_token}`}
                  href={`/onboard/${contract.signature_token}`}
                  monospace
                />
              )}
            </dl>
          </section>

          {/* Agent affordance */}
          <div className="rounded-[12px] border border-primary/30 bg-primary-soft/30 p-4">
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-primary">
              <Sparkles className="size-3.5" />
              Ask the agent
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-fg-subtle">
              "Resend the onboarding link." · "Bump this contract's rate by 5% and send for re-signature."
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Next step (status-aware) ─────────────────────────────────────

function NextStepCard({
  contract,
  boater,
  slip,
}: {
  contract: Contract;
  boater: Boater | null;
  slip: Slip | null;
}) {
  const [copied, setCopied] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const onboardUrl = contract.signature_token
    ? `${origin}/onboard/${contract.signature_token}`
    : null;

  function dispatchOnboard(reminder: boolean, token: string) {
    if (!boater || !slip) return;
    const url = `${origin}/onboard/${token}`;
    const channel = boater.communication_prefs.preferred_channel;
    const commType: Communication["type"] = channel;
    const recipient =
      commType === "email"
        ? (boater.primary_contact.email ?? "")
        : (boater.primary_contact.phone ?? "");
    addCommunication({
      id: `cm_contract_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      boater_id: boater.id,
      type: commType,
      direction: "outbound",
      sender_label: "Marina Stee",
      sender_is_system: true,
      recipient,
      subject: reminder
        ? `Reminder: complete onboarding for contract ${contract.number}`
        : `Please complete onboarding for contract ${contract.number}`,
      body_preview: `Sign + add a card here: ${url}`,
      full_body:
        `Hi ${boater.first_name},\n\n` +
        (reminder
          ? `Friendly reminder to finish your onboarding for contract ${contract.number}.`
          : `Your contract ${contract.number} is ready to sign.`) +
        ` Takes about 2 minutes:\n\n${url}\n\nMarina Stee`,
      sent_at: new Date().toISOString(),
      status: "delivered",
      related_entity: { type: "contract", id: contract.id },
    });
  }

  async function handleSend() {
    setBusy(true);
    try {
      const token = mintContractSignatureToken(contract.id);
      if (token) dispatchOnboard(false, token);
      // Auto-copy
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(`${origin}/onboard/${token}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } finally {
      setBusy(false);
    }
  }
  async function handleResend() {
    if (!contract.signature_token) return;
    setBusy(true);
    try {
      dispatchOnboard(true, contract.signature_token);
    } finally {
      setBusy(false);
    }
  }
  async function handleCopy() {
    if (!onboardUrl) return;
    try {
      await navigator.clipboard.writeText(onboardUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }
  function handleMarkSigned() {
    updateContract(contract.id, {
      status: "active",
      signed_at: new Date().toISOString().slice(0, 10),
    });
  }
  function handleTerminate() {
    updateContract(contract.id, { status: "terminated" });
  }

  // Status-aware copy + actions
  if (contract.status === "draft") {
    return (
      <Card tone="info" icon={<Send className="size-4 text-status-info" />} title="Ready to send">
        <p className="text-[12px] text-fg-subtle">
          This contract is drafted but hasn't been sent yet. Tap below to mint the public link and dispatch it to {boater?.first_name ?? "the holder"} via their preferred channel.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={handleSend} disabled={busy}>
            <Send className="size-3.5" />
            Send for signature
          </Button>
        </div>
      </Card>
    );
  }

  if (
    contract.status === "sent" ||
    contract.status === "partially_signed" ||
    contract.status === "executed"
  ) {
    return (
      <Card tone="info" icon={<Send className="size-4 text-status-info" />} title={contract.status === "executed" ? "Signed — awaiting card" : "Awaiting signature"}>
        <p className="text-[12px] text-fg-subtle">
          {contract.status === "executed"
            ? `${boater?.first_name ?? "The holder"} signed the contract — now waiting on a card on file before the contract goes active.`
            : `${boater?.first_name ?? "The holder"} has the link. Nudge or mark as received once they confirm.`}
        </p>
        {onboardUrl && (
          <div className="mt-3 rounded-[8px] border border-hairline bg-surface-1 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
              Onboarding link
            </div>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 truncate font-mono text-[11px] text-fg-subtle">
                {onboardUrl}
              </code>
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={handleResend} disabled={busy}>
            <Send className="size-3.5" />
            Resend
          </Button>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-[8px] border border-hairline bg-surface-1 px-2.5 py-1.5 text-[12px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            {copied ? (
              <>
                <CheckCircle2 className="size-3 text-status-ok" /> Copied
              </>
            ) : (
              <>
                <Copy className="size-3" /> Copy link
              </>
            )}
          </button>
          {onboardUrl && (
            <a
              href={onboardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-[8px] border border-hairline bg-surface-1 px-2.5 py-1.5 text-[12px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              <ExternalLink className="size-3" /> Open as boater
            </a>
          )}
          <Button variant="secondary" size="sm" onClick={handleMarkSigned}>
            Mark signed
          </Button>
        </div>
      </Card>
    );
  }

  if (contract.status === "active") {
    return (
      <Card tone="ok" icon={<CheckCircle2 className="size-4 text-status-ok" />} title="Active — locked in">
        <p className="text-[12px] text-fg-subtle">
          This contract is active. Renewal cycle will pick it up at the end of the term ({contract.effective_end}).
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleTerminate}>
            Terminate early
          </Button>
        </div>
      </Card>
    );
  }

  if (contract.status === "renewed") {
    return (
      <Card tone="ok" icon={<CheckCircle2 className="size-4 text-status-ok" />} title="Renewed">
        <p className="text-[12px] text-fg-subtle">
          Successor contract has been signed for next season. This record is closed for billing purposes.
        </p>
      </Card>
    );
  }

  if (contract.status === "expired" || contract.status === "terminated") {
    return (
      <Card tone="warn" icon={<AlertCircle className="size-4 text-status-warn" />} title={contract.status === "expired" ? "Expired" : "Terminated"}>
        <p className="text-[12px] text-fg-subtle">
          {contract.status === "expired"
            ? "Contract ended without a renewal."
            : "Contract was terminated. Slip should be marked vacant and the waitlist notified."}
        </p>
      </Card>
    );
  }

  return null;
}

function Card({
  tone,
  icon,
  title,
  children,
}: {
  tone: "info" | "ok" | "warn";
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const tint =
    tone === "ok"
      ? "border-status-ok/30 bg-status-ok/[0.05]"
      : tone === "warn"
      ? "border-status-warn/30 bg-status-warn/[0.05]"
      : "border-status-info/30 bg-status-info/[0.05]";
  return (
    <div className={cn("rounded-[12px] border p-4", tint)}>
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h2 className="text-[13px] font-medium text-fg">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: ContractStatus }) {
  const map: Record<ContractStatus, { tone: "ok" | "warn" | "danger" | "info" | "neutral"; label: string }> = {
    draft: { tone: "neutral", label: "Draft" },
    sent: { tone: "info", label: "Sent" },
    partially_signed: { tone: "info", label: "Partially signed" },
    executed: { tone: "info", label: "Executed" },
    active: { tone: "ok", label: "Active" },
    expired: { tone: "neutral", label: "Expired" },
    terminated: { tone: "danger", label: "Terminated" },
    renewed: { tone: "ok", label: "Renewed" },
  };
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

function Field({
  icon,
  label,
  value,
  href,
  monospace,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
  monospace?: boolean;
}) {
  const inner = (
    <span className={cn("truncate", monospace && "font-mono text-[11px]")}>{value}</span>
  );
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-fg-tertiary">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">{label}</div>
        <div className="text-fg">
          {href ? (
            <Link href={href} className="text-primary hover:underline">
              {inner}
            </Link>
          ) : (
            inner
          )}
        </div>
      </div>
    </div>
  );
}
