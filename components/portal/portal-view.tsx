"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CreditCard,
  FileText,
  MessageSquare,
  Ship,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  BOATERS,
  CONTRACTS,
  formatMoney,
  getSlip,
  getTemplate,
  getVesselsForBoater,
} from "@/lib/mock-data";
import {
  upsertContract,
  useCardsForBoater,
  useContractsForBoater,
  useLedgerForBoater,
  useReservationsForBoater,
  useVesselsForBoater,
} from "@/lib/client-store";
import { PortalPaySheet } from "./portal-pay-sheet";
import { PortalRequestServiceSheet } from "./portal-request-service-sheet";
import { PortalMessageMarinaSheet } from "./portal-message-marina-sheet";
import { InsuranceCard } from "@/components/insurance/insurance-card";
import { cn } from "@/lib/utils";

/*
 * Boater self-service portal — single-page view at /portal/[boaterId].
 *
 * Sections (top-to-bottom):
 *   1. Top bar — back to portal landing, theme toggle
 *   2. Hero — greeting + open balance + Pay CTA + current slip
 *   3. Quick actions — Pay / Message marina / Request service
 *   4. Vessels
 *   5. Outstanding invoices (with per-row Pay link → opens pay sheet preset to that invoice)
 *   6. Payment history (last 12 months of payments + refunds)
 *   7. Contracts (with Sign / View links)
 *
 * Every mutation flows through the same client store the admin app reads,
 * so portal-side actions (paying, requesting service, sending a message)
 * show up immediately on the admin Notifications / Inbox / Financials views.
 */

export function PortalView({ boaterId }: { boaterId: string }) {
  const boater = BOATERS.find((b) => b.id === boaterId);
  // Live data
  const ledger = useLedgerForBoater(boaterId);
  const liveVessels = useVesselsForBoater(boaterId);
  const reservations = useReservationsForBoater(boaterId);
  const liveContracts = useContractsForBoater(boaterId);
  const cards = useCardsForBoater(boaterId);

  // Fall back to static if store hasn't seeded yet
  const vessels = liveVessels.length > 0 ? liveVessels : getVesselsForBoater(boaterId);
  const contracts = liveContracts.length > 0 ? liveContracts : CONTRACTS.filter((c) => c.boater_id === boaterId);

  const [payOpen, setPayOpen] = React.useState(false);
  const [payInvoiceId, setPayInvoiceId] = React.useState<string | undefined>();
  const [requestOpen, setRequestOpen] = React.useState(false);
  const [messageOpen, setMessageOpen] = React.useState(false);

  if (!boater) {
    return (
      <main className="grid min-h-screen place-items-center">
        <p className="text-fg-subtle">Holder not found.</p>
      </main>
    );
  }

  const openInvoices = ledger
    .filter((l) => l.type === "invoice" && l.open_balance > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const openBalance = openInvoices.reduce((s, l) => s + l.open_balance, 0);
  const payments = ledger
    .filter((l) => l.type === "payment" || l.type === "refund")
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const today = new Date().toISOString().slice(0, 10);
  const currentRes = reservations.find(
    (r) => r.arrival_date <= today && r.departure_date >= today
  );
  const nextRes = reservations
    .filter((r) => r.arrival_date > today)
    .sort((a, b) => (a.arrival_date < b.arrival_date ? -1 : 1))[0];
  const slip = currentRes ? getSlip(currentRes.slip_id) : null;

  function openPay(invoiceId?: string) {
    setPayInvoiceId(invoiceId);
    setPayOpen(true);
  }

  return (
    <main className="min-h-screen bg-canvas">
      {/* Top bar */}
      <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-hairline bg-surface-1/95 px-4 backdrop-blur">
        <Link
          href="/portal"
          className="inline-flex items-center gap-1.5 text-[12px] text-fg-subtle hover:text-fg"
        >
          <ArrowLeft className="size-3.5" />
          Switch profile
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-fg">Marina Stee Portal</span>
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-[820px] px-5 pb-24">
        {/* Hero */}
        <section className="pt-8 pb-6">
          <p className="text-[13px] text-fg-subtle">Welcome back,</p>
          <h1 className="display-tight mt-1 text-[32px] font-semibold text-fg">
            {boater.first_name}.
          </h1>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-[14px] border border-hairline bg-surface-1 p-5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
                Account balance
              </div>
              <div
                className={cn(
                  "money-display-lg mt-1 text-[40px]",
                  openBalance > 0 ? "text-status-warn" : "text-status-ok"
                )}
              >
                {formatMoney(openBalance)}
              </div>
              <div className="mt-1 text-[12px] text-fg-subtle">
                {openBalance > 0
                  ? `${openInvoices.length} open invoice${openInvoices.length === 1 ? "" : "s"}.`
                  : "All caught up."}
              </div>
              {openBalance > 0 && (
                <Button
                  variant="primary"
                  size="md"
                  className="mt-4 w-full"
                  onClick={() => openPay()}
                >
                  Pay {formatMoney(openBalance)}
                </Button>
              )}
            </div>

            <div className="rounded-[14px] border border-hairline bg-surface-1 p-5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
                {currentRes ? "Currently at" : nextRes ? "Next reservation" : "No upcoming"}
              </div>
              {currentRes ? (
                <>
                  <div className="display-tight mt-1 text-[24px] font-semibold text-fg">
                    {slip ? `${slip.dock} · ${slip.number}` : `Slip ${currentRes.slip_id}`}
                  </div>
                  <div className="mt-1 text-[12px] text-fg-subtle">
                    Stay through {currentRes.departure_date}.
                  </div>
                </>
              ) : nextRes ? (
                <>
                  <div className="display-tight mt-1 text-[24px] font-semibold text-fg">
                    {nextRes.arrival_date}
                  </div>
                  <div className="mt-1 text-[12px] text-fg-subtle">
                    Arriving in slip {nextRes.slip_id}.
                  </div>
                </>
              ) : (
                <p className="mt-2 text-[13px] text-fg-subtle">
                  Use the buttons below to request a slip for an upcoming trip.
                </p>
              )}
              {currentRes && (
                <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-fg-tertiary">
                  {slip?.has_power && <Badge tone="ok" size="sm">Power</Badge>}
                  {slip?.has_water && <Badge tone="ok" size="sm">Water</Badge>}
                  <Badge tone="outline" size="sm">{currentRes.type}</Badge>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Quick actions */}
        <section className="mb-8 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <QuickAction
            icon={<CreditCard className="size-4" />}
            label="Pay balance"
            sub={openBalance > 0 ? formatMoney(openBalance) : "All clear"}
            disabled={openBalance === 0}
            onClick={() => openPay()}
          />
          <QuickAction
            icon={<MessageSquare className="size-4" />}
            label="Message the marina"
            sub="We usually reply within an hour."
            onClick={() => setMessageOpen(true)}
          />
          <QuickAction
            icon={<Wrench className="size-4" />}
            label="Request a service"
            sub="Winterization, haul-out, repair…"
            onClick={() => setRequestOpen(true)}
          />
        </section>

        {/* Vessels */}
        <Section title="Your vessels" icon={<Ship className="size-3.5" />}>
          {vessels.length === 0 ? (
            <Empty text="No vessels on file. Contact the marina to register one." />
          ) : (
            <ul className="space-y-2">
              {vessels.map((v) => {
                const cover = (v.photos && v.photos[0]) ?? v.photo_url;
                return (
                  <li
                    key={v.id}
                    className="flex items-center gap-3 rounded-[10px] border border-hairline bg-surface-2 px-3 py-2.5"
                  >
                    {cover ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={cover}
                        alt={v.name}
                        loading="lazy"
                        className="size-14 shrink-0 rounded-[8px] border border-hairline object-cover"
                      />
                    ) : (
                      <div className="flex size-14 shrink-0 items-center justify-center rounded-[8px] border border-dashed border-hairline-strong bg-surface-3 text-[9px] uppercase tracking-wide text-fg-tertiary">
                        no photo
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium text-fg">{v.name}</div>
                      <div className="text-[12px] text-fg-subtle">
                        {[v.year, v.make, v.model].filter(Boolean).join(" ") || "—"}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {v.vessel_type && <Badge tone="neutral" size="sm">{v.vessel_type}</Badge>}
                      {v.fuel_type && <Badge tone="outline" size="sm">{v.fuel_type}</Badge>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {/* Outstanding invoices */}
        <Section title="Outstanding invoices" icon={<CreditCard className="size-3.5" />}>
          {openInvoices.length === 0 ? (
            <Empty text="No outstanding invoices. You're current." />
          ) : (
            <ul className="divide-y divide-hairline overflow-hidden rounded-[10px] border border-hairline">
              {openInvoices.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center justify-between gap-3 bg-surface-2 px-4 py-3"
                >
                  <div>
                    <div className="font-mono text-[12px] font-medium text-fg">
                      {inv.number ?? inv.id.slice(-6)}
                    </div>
                    <div className="text-[12px] text-fg-subtle">
                      Invoiced {inv.date} · {inv.line_items?.[0]?.description ?? "Marina services"}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="money-display text-[16px] text-fg">
                      {formatMoney(inv.open_balance)}
                    </span>
                    <Button variant="primary" size="sm" onClick={() => openPay(inv.id)}>
                      Pay
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Payment history */}
        <Section title="Payment history" icon={<CreditCard className="size-3.5" />}>
          {payments.length === 0 ? (
            <Empty text="No payments yet." />
          ) : (
            <ul className="divide-y divide-hairline overflow-hidden rounded-[10px] border border-hairline">
              {payments.slice(0, 8).map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 bg-surface-2 px-4 py-3"
                >
                  <div>
                    <div className="text-[13px] text-fg">
                      {p.type === "refund" ? "Refund" : "Payment"}{" "}
                      <span className="text-fg-tertiary">
                        · {p.method ?? "—"} · {p.date}
                      </span>
                    </div>
                    {p.refund_notes && (
                      <div className="text-[12px] text-fg-tertiary">{p.refund_notes}</div>
                    )}
                  </div>
                  <span
                    className={cn(
                      "money-display text-[14px]",
                      p.type === "refund" ? "text-status-danger" : "text-fg"
                    )}
                  >
                    {p.type === "refund" ? "−" : ""}
                    {formatMoney(Math.abs(p.amount))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Contracts */}
        <Section title="Contracts" icon={<FileText className="size-3.5" />}>
          {contracts.length === 0 ? (
            <Empty text="No contracts on file." />
          ) : (
            <ul className="space-y-2">
              {contracts.map((c) => {
                const tpl = getTemplate(c.template_id);
                const isDraft = c.status === "draft" || c.status === "sent" || c.status === "partially_signed";
                return (
                  <li
                    key={c.id}
                    className="flex items-start justify-between gap-3 rounded-[10px] border border-hairline bg-surface-2 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] font-medium text-fg">{c.number}</span>
                        <Badge tone={c.status === "active" ? "ok" : isDraft ? "warn" : "neutral"} size="sm">
                          {c.status}
                        </Badge>
                      </div>
                      <div className="mt-0.5 text-[12px] text-fg-subtle">
                        {tpl?.name ?? "Contract"} · {c.effective_start} → {c.effective_end}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {isDraft ? (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            // Demo flow: marks the contract executed + active.
                            // Production swap-in: navigate to a dedicated
                            // contract-signing variant of /sign/[token].
                            upsertContract({
                              ...c,
                              status: "active",
                              signed_at: new Date().toISOString(),
                            });
                          }}
                        >
                          Sign now
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (c.signed_pdf_url) {
                              window.open(c.signed_pdf_url, "_blank", "noopener");
                            } else {
                              // No PDF on file — silently no-op rather than error
                              // (production would fetch + render the signed PDF here).
                            }
                          }}
                        >
                          View PDF
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {/* Insurance */}
        <Section title="Insurance" icon={<FileText className="size-3.5" />}>
          <InsuranceCard boaterId={boaterId} uploadedBy="boater" />
        </Section>

        {/* Card on file note */}
        {cards.length > 0 && (
          <p className="mt-6 inline-flex items-center gap-1.5 text-[11px] text-fg-tertiary">
            <Sparkles className="size-3 text-primary" />
            We'll auto-charge {cards[0].brand} ····{cards[0].last4} for your monthly bill unless you tell us otherwise.
          </p>
        )}

        <footer className="mt-12 text-center text-[11px] text-fg-tertiary">
          Marina Stee · {boater.primary_contact.email ?? "support@marinastee.com"}
        </footer>
      </div>

      {/* Sheets */}
      <PortalPaySheet
        open={payOpen}
        onOpenChange={setPayOpen}
        boaterId={boaterId}
        invoiceId={payInvoiceId}
      />
      <PortalRequestServiceSheet
        open={requestOpen}
        onOpenChange={setRequestOpen}
        boaterId={boaterId}
      />
      <PortalMessageMarinaSheet
        open={messageOpen}
        onOpenChange={setMessageOpen}
        boaterId={boaterId}
      />
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-fg-tertiary">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-[10px] border border-dashed border-hairline px-4 py-6 text-center text-[12px] text-fg-subtle">
      {text}
    </div>
  );
}

function QuickAction({
  icon,
  label,
  sub,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "tap-scale flex flex-col items-start gap-2 rounded-[12px] border border-hairline bg-surface-1 p-4 text-left transition-colors",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:border-hairline-strong hover:bg-surface-2"
      )}
    >
      <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary-soft text-primary">
        {icon}
      </span>
      <span className="text-[14px] font-medium text-fg">{label}</span>
      <span className="text-[12px] text-fg-subtle">{sub}</span>
    </button>
  );
}

