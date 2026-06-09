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
  Paperclip,
  ScrollText,
  Signature as SignatureIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import { AttachedFeesList } from "@/components/financials/attached-fees-list";
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
          href="/services/contracts"
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
            <Link href={`/members/${boater.id}`} className="hover:text-primary">
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
        {/* Left rail — Next step + Document + Comms history */}
        <div className="space-y-4 lg:col-span-7">
          <NextStepCard contract={contract} boater={boater} slip={slip} />

          <DocumentSection contract={contract} template={template} />

          {/* Attached service fees — one-time / monthly / annual roll-up */}
          {(contract.attached_fee_ids?.length ?? 0) > 0 && (
            <section className="rounded-[12px] border border-hairline bg-surface-1">
              <div className="border-b border-hairline px-4 py-2.5">
                <h2 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
                  <Receipt className="size-3.5 text-fg-subtle" />
                  Attached fees
                </h2>
              </div>
              <div className="p-4">
                <AttachedFeesList
                  feeIds={contract.attached_fee_ids ?? []}
                  termMonths={contractTermMonths(
                    contract.effective_start,
                    contract.effective_end,
                  )}
                />
              </div>
            </section>
          )}

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
                        <LocalTime
                          iso={c.sent_at}
                          fmt="short_datetime"
                          className="ml-auto text-[10px] tabular text-fg-tertiary"
                        />
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
                  href={`/members/${boater.id}`}
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

// ── Document section ─────────────────────────────────────────────
//
// The actual contract artifact. Three layers:
//   1. Blank template — the marina's standard lease that this
//      contract is based on (always present once a template exists).
//   2. Signed contract — produced after the boater signs via
//      /onboard/[token]; combines the template + signature image +
//      audit trail (signer name, timestamp, IP).
//   3. Attachments — supporting docs (addenda, signed copies the
//      holder mailed back, COI snapshots).

function DocumentSection({
  contract,
  template,
}: {
  contract: Contract;
  template: ContractTemplate | null;
}) {
  const signed = !!contract.signed_at;
  const hasSignaturePng = !!contract.signature_data_url;
  const hasSignedPdf = !!contract.signed_pdf_url;
  const attachments = contract.attachments ?? [];
  const hasAiDraft = !!contract.drafted_body_markdown;

  return (
    <section className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h2 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
          <ScrollText className="size-3.5 text-fg-subtle" />
          Contract document
        </h2>
        {signed && <Badge tone="ok" size="sm">Signed</Badge>}
      </div>

      <div className="space-y-3 p-4">
        {/* Layer 1: blank template */}
        <DocRow
          icon={<FileText className="size-4 text-fg-subtle" />}
          title={
            template
              ? `${template.name} · v${template.version}`
              : "Template missing"
          }
          subtitle="Blank template — what this contract is based on"
          href={template?.source_file_url}
          downloadName={template?.source_file_name}
          mimeBadge={template?.source_file_type?.toUpperCase()}
        />

        {/* Layer 1.5: AI-drafted body (when the wizard filled the merge tokens) */}
        {hasAiDraft && (
          <AiDraftedBody
            body={contract.drafted_body_markdown!}
            draftedAt={contract.drafted_at}
          />
        )}

        {/* Layer 2: signed contract */}
        {signed ? (
          <div className="rounded-[10px] border border-status-ok/30 bg-status-ok/[0.04] p-3">
            <div className="flex items-start gap-2">
              <SignatureIcon className="mt-0.5 size-4 text-status-ok" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-fg">
                  Signed contract
                </div>
                <div className="mt-0.5 text-[12px] text-fg-subtle">
                  {contract.signer_name ?? "—"} ·{" "}
                  {contract.signed_at
                    ? <LocalTime iso={contract.signed_at} fmt="datetime" />
                    : "—"}
                  {contract.signer_ip && (
                    <span className="text-fg-tertiary"> · {contract.signer_ip}</span>
                  )}
                </div>
                {hasSignaturePng && contract.signature_data_url && (
                  <div className="mt-2 inline-block rounded-[6px] border border-hairline bg-surface-1 p-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={contract.signature_data_url}
                      alt={`Signature — ${contract.signer_name ?? "holder"}`}
                      className="max-h-16 object-contain"
                    />
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {hasSignedPdf ? (
                    <a
                      href={contract.signed_pdf_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
                    >
                      <ExternalLink className="size-3" />
                      View signed PDF
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-[6px] border border-dashed border-hairline px-2 py-1 text-[11px] text-fg-tertiary italic">
                      Merged PDF will generate once the backend lands
                    </span>
                  )}
                  <span className="text-[10px] text-fg-tertiary">
                    Audit token{" "}
                    <span className="font-mono">
                      {contract.signature_token ?? "—"}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-[10px] border border-dashed border-hairline bg-surface-2 px-3 py-2.5 text-[12px] text-fg-tertiary">
            <div className="flex items-center gap-2 text-fg-subtle">
              <SignatureIcon className="size-3.5" />
              <span>Signed contract</span>
            </div>
            <p className="mt-0.5 text-[11px]">
              Not signed yet. Once the holder completes /onboard, the
              signature image + audit details land here.
            </p>
          </div>
        )}

        {/* Layer 3: attachments */}
        {attachments.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wide text-fg-tertiary">
              Attachments ({attachments.length})
            </div>
            <ul className="space-y-1.5">
              {attachments.map((a) => (
                <li key={a.id}>
                  <DocRow
                    icon={<Paperclip className="size-3.5 text-fg-subtle" />}
                    title={a.name}
                    subtitle={
                      <>
                        {a.type.replace("_", " ")} · uploaded{" "}
                        <LocalTime iso={a.uploaded_at} fmt="date" />
                      </>
                    }
                    href={a.url}
                    downloadName={a.name}
                    mimeBadge={mimeShorthand(a.mime_type)}
                    sizeBytes={a.size_bytes}
                    dense
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function DocRow({
  icon,
  title,
  subtitle,
  href,
  downloadName,
  mimeBadge,
  sizeBytes,
  dense,
}: {
  icon: React.ReactNode;
  title: string;
  // ReactNode so callers can embed <LocalTime> in the subtitle without
  // collapsing it to a string.
  subtitle?: React.ReactNode;
  href?: string;
  downloadName?: string;
  mimeBadge?: string;
  sizeBytes?: number;
  dense?: boolean;
}) {
  const inner = (
    <div className={cn("flex items-start gap-2", dense ? "py-1" : "")}>
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className={cn("font-medium text-fg", dense ? "text-[12px]" : "text-[13px]")}>
          {title}
        </div>
        {subtitle && (
          <div className="text-[11px] text-fg-tertiary">
            {subtitle}
            {sizeBytes && ` · ${formatBytes(sizeBytes)}`}
          </div>
        )}
      </div>
      {mimeBadge && (
        <Badge tone="outline" size="sm">
          {mimeBadge}
        </Badge>
      )}
      {href && <ExternalLink className="size-3.5 shrink-0 text-fg-tertiary" />}
    </div>
  );
  if (!href) {
    return (
      <div className="rounded-[8px] border border-dashed border-hairline px-3 py-2">
        {inner}
      </div>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      download={downloadName}
      className="block rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 transition-colors hover:border-hairline-strong hover:bg-surface-3"
    >
      {inner}
    </a>
  );
}

// Contract term -> months for the fee roll-up. Floors at 1 so a same-day
// contract still prorates fairly.
function contractTermMonths(start: string, end: string): number {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 1;
  const days = (b - a) / (1000 * 60 * 60 * 24);
  return Math.max(1, Math.round(days / 30));
}

function mimeShorthand(mime: string): string {
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("wordprocessing")) return "DOCX";
  if (mime.includes("image")) return mime.split("/")[1]?.toUpperCase() ?? "IMG";
  return mime.split("/")[1]?.toUpperCase() ?? "FILE";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
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

// ── AI-drafted body ───────────────────────────────────────────────
//
// Renders the contract body Claude (or the local-fill fallback)
// produced from the template + this contract's context. Collapsible —
// shows a teaser by default with an Expand affordance so the detail
// page doesn't blow up vertically for long lease docs.

function AiDraftedBody({
  body,
  draftedAt,
}: {
  body: string;
  draftedAt?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const previewLineCount = 8;
  const lines = body.split("\n");
  const preview = lines.slice(0, previewLineCount).join("\n");
  const isTruncated = lines.length > previewLineCount;

  return (
    <div className="rounded-[10px] border border-primary/30 bg-primary-soft/20 p-3">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[13px] font-medium text-fg">
              AI-drafted contract body
            </div>
            {draftedAt && (
              <LocalTime
                iso={draftedAt}
                fmt="datetime"
                className="text-[11px] text-fg-tertiary"
              />
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-fg-subtle">
            Generated from the template by Claude when the contract was drafted.
            The boater reads this on /onboard before signing.
          </p>
          <pre className="mt-2 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-[6px] border border-hairline bg-surface-1 p-3 text-[12px] leading-5 text-fg font-sans">
            {expanded || !isTruncated ? body : preview}
          </pre>
          {isTruncated && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1.5 text-[11px] font-medium text-primary hover:underline"
            >
              {expanded
                ? "Collapse"
                : `Show full document (${lines.length - previewLineCount} more lines)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
