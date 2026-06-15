"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CreditCard,
  FileText,
  RotateCcw,
  Send,
  Copy,
  Check,
  ExternalLink,
  CheckCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import { formatMoney, getTemplate } from "@/lib/mock-data";
import {
  addCommunication,
  mintContractSignatureToken,
  useCardsForBoater,
  useContractsForBoater,
  useLedgerForBoater,
  upsertCardForBoater,
  deleteCardForBoater,
} from "@/lib/client-store";
import { useLedgerDrawer } from "@/components/ledger/ledger-entry-drawer";
import { EnterPaymentSheet } from "@/components/financials/enter-payment-sheet";
import { AddCardSheet } from "@/components/financials/add-card-sheet";
import { ContractWizard } from "@/components/financials/contract-wizard";
import type { Boater, CardOnFile, Communication, Contract, LedgerEntry } from "@/lib/types";

const CARD_FIELDS: FieldSpec<CardOnFile>[] = [
  {
    key: "brand",
    label: "Brand",
    kind: "select",
    col: 2,
    options: [
      { value: "visa", label: "Visa" },
      { value: "mastercard", label: "Mastercard" },
      { value: "amex", label: "Amex" },
      { value: "discover", label: "Discover" },
    ],
  },
  { key: "last4", label: "Last 4", kind: "text", col: 2, required: true },
  { key: "exp_month", label: "Exp month (1-12)", kind: "number", col: 2 },
  { key: "exp_year", label: "Exp year (YYYY)", kind: "number", col: 2 },
  { key: "nickname", label: "Label (Personal / Business)", kind: "text" },
  { key: "is_default", label: "Default card", kind: "boolean" },
];

type FilterKey = "all" | "invoices" | "payments" | "refunds";

export function FinancialsTab({
  boater,
  cards,
  contracts,
}: {
  boater: Boater;
  cards: CardOnFile[];
  contracts: Contract[];
}) {
  const boaterId = boater.id;
  // Live ledger from client store — reflects POS sales completed this session.
  const ledger = useLedgerForBoater(boaterId);
  const liveCards = useCardsForBoater(boaterId);
  const liveContracts = useContractsForBoater(boaterId);
  // Fall back to server-rendered props on first paint, then take over from store.
  const allCards = liveCards.length > 0 ? liveCards : cards;
  const allContracts = liveContracts.length > 0 ? liveContracts : contracts;

  const [filter, setFilter] = React.useState<FilterKey>("all");
  const [paymentOpen, setPaymentOpen] = React.useState(false);
  const [cardOpen, setCardOpen] = React.useState(false);
  const [contractOpen, setContractOpen] = React.useState(false);
  const [editCard, setEditCard] = React.useState<CardOnFile | undefined>();
  const [editCardOpen, setEditCardOpen] = React.useState(false);

  function openEditCard(c: CardOnFile) {
    setEditCard(c);
    setEditCardOpen(true);
  }
  function handleSaveCard(values: CardOnFile) {
    upsertCardForBoater(boaterId, {
      ...values,
      exp_month: Number(values.exp_month) || 1,
      exp_year: Number(values.exp_year) || new Date().getFullYear(),
      is_default: Boolean(values.is_default),
    });
  }
  function handleDeleteCard(c: CardOnFile) {
    deleteCardForBoater(boaterId, c.id);
  }

  const filtered = ledger
    .filter((l) => {
      if (filter === "all") return true;
      if (filter === "invoices") return l.type === "invoice";
      if (filter === "payments") return l.type === "payment";
      if (filter === "refunds") return l.type === "refund" || l.type === "credit";
      return true;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const totals = {
    open: ledger.filter((l) => l.type === "invoice" && l.open_balance > 0).reduce((s, l) => s + l.open_balance, 0),
    paidYTD: ledger
      .filter((l) => l.type === "payment" && new Date(l.date).getFullYear() === new Date().getFullYear())
      .reduce((s, l) => s + l.amount, 0),
    refundedYTD: ledger
      .filter((l) => l.type === "refund" && new Date(l.date).getFullYear() === new Date().getFullYear())
      .reduce((s, l) => s + Math.abs(l.amount), 0),
  };

  return (
    <div className="space-y-4">
      {/* Top stat strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Open balance" value={formatMoney(totals.open)} tone={totals.open > 0 ? "warn" : "ok"} />
        <SummaryCard label="Paid YTD" value={formatMoney(totals.paidYTD)} tone="neutral" />
        <SummaryCard label="Refunded YTD" value={formatMoney(totals.refundedYTD)} tone="neutral" />
      </div>

      {/* Cards on file */}
      <div className="rounded-[12px] border border-hairline bg-surface-1">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
          <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
            <CreditCard className="size-3.5 text-fg-subtle" />
            Cards on file
          </h3>
          <Button variant="ghost" size="sm" onClick={() => setCardOpen(true)}>+ Add card</Button>
        </div>
        <div className="p-3">
          {allCards.length === 0 ? (
            <p className="px-1 text-[13px] text-fg-subtle">
              No cards on file. Add one to enable auto-pay and one-click charges.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {allCards.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => openEditCard(c)}
                    className="flex items-center gap-3 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 transition-colors hover:border-hairline-strong hover:bg-surface-3"
                  >
                    <div className="text-[12px] font-medium uppercase text-fg-subtle">{c.brand}</div>
                    <div className="font-mono text-[13px] text-fg">•••• {c.last4}</div>
                    <div className="text-[11px] text-fg-tertiary">
                      {String(c.exp_month).padStart(2, "0")}/{String(c.exp_year).slice(-2)}
                    </div>
                    {c.nickname && <span className="text-[11px] text-fg-tertiary">· {c.nickname}</span>}
                    {c.is_default && <Badge tone="primary" size="sm">Default</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Contracts */}
      <div className="rounded-[12px] border border-hairline bg-surface-1">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
          <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
            <FileText className="size-3.5 text-fg-subtle" />
            Contracts
          </h3>
          <Button variant="ghost" size="sm" onClick={() => setContractOpen(true)}>+ New contract</Button>
        </div>
        <div className="p-3">
          {allContracts.length === 0 ? (
            <p className="px-1 text-[13px] text-fg-subtle">No contracts on file.</p>
          ) : (
            <ul className="space-y-2">
              {allContracts.map((c) => {
                const tpl = getTemplate(c.template_id);
                return (
                  <li
                    key={c.id}
                    className="flex items-start justify-between gap-3 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2.5 transition-colors hover:bg-surface-3"
                  >
                    <Link
                      href={`/services/contracts/${c.id}`}
                      className="min-w-0 flex-1 cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-primary hover:underline">
                          {c.number}
                        </span>
                        <Badge tone={c.status === "active" ? "ok" : "neutral"} size="sm">
                          {c.status}
                        </Badge>
                        <span className="text-[11px] text-fg-tertiary">v{c.template_version}</span>
                      </div>
                      <div className="text-[12px] text-fg-subtle">
                        {tpl?.name ?? "Contract"} · {c.effective_start} → {c.effective_end}
                      </div>
                      {c.annual_rate && (
                        <div className="text-[11px] text-fg-tertiary">
                          {formatMoney(c.annual_rate)} / yr · billed {c.billing_cadence}
                        </div>
                      )}
                    </Link>
                    {/* Action cluster — stopPropagation so the row link
                        doesn't fire when staff hits Send / Resend / etc. */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <ContractRowActions contract={c} boater={boater} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Transaction history */}
      <div className="rounded-[12px] border border-hairline bg-surface-1">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
          <h3 className="text-[13px] font-medium text-fg">Transaction history</h3>
          <div className="flex items-center gap-2">
            <FilterPill label="All" active={filter === "all"} onClick={() => setFilter("all")} />
            <FilterPill label="Invoices" active={filter === "invoices"} onClick={() => setFilter("invoices")} />
            <FilterPill label="Payments" active={filter === "payments"} onClick={() => setFilter("payments")} />
            <FilterPill label="Refunds" active={filter === "refunds"} onClick={() => setFilter("refunds")} />
            <Button variant="secondary" size="sm" onClick={() => setPaymentOpen(true)}>
              + Enter payment
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-hairline text-[11px] uppercase tracking-wide text-fg-tertiary">
                <Th>Type</Th>
                <Th>Number</Th>
                <Th>Date</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Open Bal</Th>
                <Th>Method</Th>
                <Th>Applied to</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <LedgerRow key={e.id} entry={e} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-hairline px-4 py-2 text-[11px] text-fg-tertiary">
          All postings flow to a single A/R ledger for this boater.
        </div>
      </div>

      <EnterPaymentSheet
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        defaultBoaterId={boaterId}
      />
      <AddCardSheet
        open={cardOpen}
        onOpenChange={setCardOpen}
        defaultBoaterId={boaterId}
      />
      <ContractWizard
        open={contractOpen}
        onOpenChange={setContractOpen}
        defaultBoaterId={boaterId}
      />

      <RecordEditDialog<CardOnFile>
        open={editCardOpen}
        onOpenChange={setEditCardOpen}
        title={editCard ? `Edit card — •••• ${editCard.last4}` : "Edit card"}
        description="Toggling Default automatically removes the default flag from any other card on file."
        record={editCard}
        fields={CARD_FIELDS}
        onSave={handleSaveCard}
        onDelete={editCard ? handleDeleteCard : undefined}
        entity="boater"
      />
    </div>
  );
}

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const isRefund = entry.type === "refund";
  const isOpen = entry.type === "invoice" && entry.open_balance > 0;
  const { openLedgerEntry } = useLedgerDrawer();

  return (
    <tr
      className={
        "cursor-pointer border-b border-hairline transition-colors hover:bg-surface-2 last:border-b-0 " +
        (isRefund ? "bg-status-danger/[0.04]" : "")
      }
      onClick={(e) => {
        // Avoid triggering when the row's action buttons are clicked
        if ((e.target as HTMLElement).closest("button, a")) return;
        openLedgerEntry(entry.id);
      }}
    >
      <Td>
        <span
          className={
            "inline-flex items-center gap-1.5 capitalize " +
            (isRefund ? "text-status-danger" : "text-fg")
          }
        >
          {isRefund && <RotateCcw className="size-3" />}
          {entry.type}
        </span>
      </Td>
      <Td className="font-mono text-[12px] font-medium text-primary">{entry.number ?? "—"}</Td>
      <Td className="text-fg-subtle">{entry.date}</Td>
      <Td className={"tabular text-right " + (isRefund ? "text-status-danger" : "text-fg")}>
        {formatMoney(entry.amount)}
      </Td>
      <Td className="tabular text-right text-fg-subtle">
        {entry.open_balance ? formatMoney(entry.open_balance) : "—"}
      </Td>
      <Td className="capitalize text-fg-subtle">
        {entry.method ? entry.method.replace("_", " ") : "—"}
      </Td>
      <Td className="text-fg-subtle">
        {entry.applied_to_invoice_ids?.length
          ? entry.applied_to_invoice_ids.length === 1
            ? "1 invoice"
            : `${entry.applied_to_invoice_ids.length} invoices`
          : entry.applied_payment_id
            ? "1 payment"
            : "—"}
      </Td>
      <Td>
        {isOpen ? (
          <Badge tone="warn" size="sm">Open</Badge>
        ) : entry.status === "partial_refund" ? (
          <Badge tone="warn" size="sm">Partial refund</Badge>
        ) : entry.status === "paid" ? (
          <Badge tone="ok" size="sm">Paid</Badge>
        ) : (
          <Badge tone="neutral" size="sm">{entry.status}</Badge>
        )}
      </Td>
      <Td>
        {entry.type === "payment" && entry.status !== "refunded" ? (
          <button className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
            <RotateCcw className="size-3" /> Refund
          </button>
        ) : isOpen ? (
          <button className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
            Pay
          </button>
        ) : null}
      </Td>
    </tr>
  );
}

/*
 * Status-aware contract action cluster.
 *
 * draft           → "Send for signature" (mints token + dispatches Communication)
 * sent / partial  → Copy link / Resend / Open as boater
 * executed        → Copy link / Open as boater (still awaiting card-on-file)
 * active / signed → "Signed" badge + Renew
 *
 * Mirrors components/work-orders/signature-panel.tsx for the Contract entity.
 * Lets staff trigger / re-trigger onboarding from outside the wizard
 * (e.g., a contract created via the New Contract sheet or via bulk renewal
 * still needs to be sent).
 */
function ContractRowActions({
  contract,
  boater,
}: {
  contract: Contract;
  boater: Boater;
}) {
  const [copied, setCopied] = React.useState(false);
  const [resentAt, setResentAt] = React.useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const onboardUrl = contract.signature_token
    ? `${origin}/onboard/${contract.signature_token}`
    : null;

  function dispatchOnboardComm(token: string, reminder: boolean) {
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
      body_preview: `Sign and add a payment method here: ${url}`,
      full_body:
        `Hi ${boater.first_name},\n\n` +
        (reminder
          ? `Just a friendly reminder to complete your onboarding for contract ${contract.number}.`
          : `Your contract ${contract.number} is ready to sign.`) +
        ` It only takes a couple of minutes:\n\n${url}\n\n` +
        `Reply to this message if you'd like a hand.`,
      sent_at: new Date().toISOString(),
      status: "delivered",
      related_entity: { type: "contract", id: contract.id },
    });
  }

  function handleSend() {
    const token = mintContractSignatureToken(contract.id);
    if (!token) return;
    dispatchOnboardComm(token, false);
    // Auto-copy so staff can paste into a chat if they want.
    setTimeout(() => {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard.writeText(`${origin}/onboard/${token}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    }, 0);
  }

  function handleResend() {
    if (!onboardUrl || !contract.signature_token) return;
    dispatchOnboardComm(contract.signature_token, true);
    setResentAt(new Date().toISOString());
    setTimeout(() => setResentAt(null), 2000);
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

  // Signed (executed or active): show a checkmark + Renew
  if (contract.signed_at || contract.status === "active" || contract.status === "executed") {
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        {contract.signed_at && (
          <span className="inline-flex items-center gap-1 text-[11px] text-status-ok">
            <CheckCheck className="size-3" />
            Signed
          </span>
        )}
        {onboardUrl && contract.status === "executed" && (
          <a
            href={onboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
            title="Open as boater (still awaiting payment method)"
          >
            <ExternalLink className="size-3" />
            Open
          </a>
        )}
        <Button variant="secondary" size="sm">Renew</Button>
      </div>
    );
  }

  // Sent / partially_signed: link is live, show the action cluster
  if (onboardUrl) {
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
        >
          {copied ? (
            <>
              <Check className="size-3 text-status-ok" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3" />
              Copy link
            </>
          )}
        </button>
        <button
          type="button"
          onClick={handleResend}
          className="inline-flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
        >
          {resentAt ? (
            <>
              <Check className="size-3 text-status-ok" />
              Sent
            </>
          ) : (
            <>
              <Send className="size-3" />
              Resend
            </>
          )}
        </button>
        <a
          href={onboardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
        >
          <ExternalLink className="size-3" />
          Open as boater
        </a>
      </div>
    );
  }

  // Draft, never sent → primary CTA to send
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button variant="primary" size="sm" onClick={handleSend}>
        <Send className="size-3.5" />
        Send for signature
      </Button>
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={"px-3 py-2 text-left font-medium " + (className ?? "")}>{children}</th>;
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={"px-3 py-2 align-middle " + (className ?? "")}>{children}</td>;
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors " +
        (active
          ? "border-primary/40 bg-primary-soft text-primary"
          : "border-hairline bg-surface-1 text-fg-muted hover:bg-surface-2")
      }
    >
      {label}
    </button>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "danger" | "neutral";
}) {
  const valueTone =
    tone === "warn" ? "text-status-warn" : tone === "danger" ? "text-status-danger" : "text-fg";
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">{label}</div>
      <div className={"money-display mt-1 text-[26px] " + valueTone}>{value}</div>
    </div>
  );
}
