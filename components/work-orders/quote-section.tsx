"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Snowflake, Droplets, Wrench, Sparkles, X, FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuoteBuilder } from "./quote-builder";
import { SignaturePanel } from "./signature-panel";
import { PaymentPanel } from "./payment-panel";
import { cn } from "@/lib/utils";
import type { Quote, QuoteLineItem, WorkOrder } from "@/lib/types";

type Template = {
  key: string;
  label: string;
  icon: React.ReactNode;
  blurb: string;
  lines: Omit<QuoteLineItem, "id">[];
  tax_rate: number;
};

const TEMPLATES: Template[] = [
  {
    key: "winterization",
    label: "Winterization",
    icon: <Snowflake className="size-4" />,
    blurb: "Engine drain + freshwater antifreeze + fuel stabilizer",
    lines: [
      { kind: "labor", name: "Engine winterization", description: "Drain coolant, fog cylinders, stabilizer", qty: 2, unit_price: 95, total: 190 },
      { kind: "labor", name: "Freshwater system winterization", description: "Antifreeze head + water heater", qty: 1, unit_price: 65, total: 65 },
      { kind: "part", name: "Propylene glycol antifreeze (gallon)", qty: 3, unit_price: 12.5, total: 37.5 },
      { kind: "part", name: "Fuel stabilizer", qty: 1, unit_price: 18, total: 18 },
    ],
    tax_rate: 0.0825,
  },
  {
    key: "bottom_paint",
    label: "Bottom paint",
    icon: <Droplets className="size-4" />,
    blurb: "Hull strip + 2 coats of antifouling + haul-out",
    lines: [
      { kind: "labor", name: "Bottom strip", qty: 8, unit_price: 95, total: 760 },
      { kind: "labor", name: "Paint application — 2 coats", qty: 12, unit_price: 95, total: 1140 },
      { kind: "part", name: "Antifouling paint (gallon)", qty: 3, unit_price: 285, total: 855 },
      { kind: "fee", name: "Haul-out & blocking", qty: 1, unit_price: 220, total: 220 },
    ],
    tax_rate: 0.0825,
  },
  {
    key: "pump_out",
    label: "Pump-out + service",
    icon: <Wrench className="size-4" />,
    blurb: "Holding tank pump-out + sanitation rinse",
    lines: [
      { kind: "fee", name: "Pump-out service", qty: 1, unit_price: 25, total: 25 },
      { kind: "labor", name: "Sanitation rinse", qty: 0.5, unit_price: 65, total: 32.5 },
    ],
    tax_rate: 0.0825,
  },
  {
    key: "blank",
    label: "Blank quote",
    icon: <Sparkles className="size-4" />,
    blurb: "Start empty; ask the agent or add lines manually",
    lines: [],
    tax_rate: 0.0825,
  },
];

function quoteFromTemplate(wo: WorkOrder, t: Template): Quote {
  const line_items: QuoteLineItem[] = t.lines.map((l, i) => ({
    ...l,
    id: `qd_${wo.id}_${i}`,
  }));
  const parts_subtotal = line_items.filter((l) => l.kind === "part").reduce((s, l) => s + l.total, 0);
  const labor_subtotal = line_items.filter((l) => l.kind === "labor").reduce((s, l) => s + l.total, 0);
  const fees_subtotal = line_items.filter((l) => l.kind === "fee").reduce((s, l) => s + l.total, 0);
  const discount_subtotal = line_items.filter((l) => l.kind === "discount").reduce((s, l) => s + l.total, 0);
  const taxable = parts_subtotal + fees_subtotal; // labor typically not taxed in this jurisdiction
  const tax_amount = taxable * t.tax_rate;
  const total = parts_subtotal + labor_subtotal + fees_subtotal + discount_subtotal + tax_amount;
  return {
    id: `qd_${wo.id}`,
    number: `Q-${wo.number.replace("WO-", "")}`,
    work_order_id: wo.id,
    boater_id: wo.boater_id,
    status: "draft",
    line_items,
    tax_rate: t.tax_rate,
    parts_subtotal,
    labor_subtotal,
    fees_subtotal,
    discount_subtotal,
    tax_amount,
    total,
  };
}

export function QuoteSection({
  wo,
  initialQuote,
}: {
  wo: WorkOrder;
  initialQuote: Quote | undefined;
}) {
  const [quote, setQuote] = React.useState<Quote | undefined>(initialQuote);
  const [drafting, setDrafting] = React.useState(false);

  if (quote) {
    return (
      <div className="space-y-4">
        <QuoteBuilder quote={quote} onChange={setQuote} />
        <SignaturePanel quote={quote} />
        <PaymentPanel quote={quote} />
      </div>
    );
  }

  return (
    <>
      <div className="rounded-[12px] border border-dashed border-hairline-strong bg-surface-1 p-8 text-center">
        <h3 className="text-[15px] font-medium text-fg">No quote yet</h3>
        <p className="mt-1 text-[13px] text-fg-subtle">
          Draft a quote to send to the boater for signature. Pick a template or ask the agent
          to populate line items from a standard package.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button variant="primary" size="md" onClick={() => setDrafting(true)}>
            <FilePlus2 className="size-3.5" />
            Draft quote
          </Button>
        </div>
      </div>

      <DialogPrimitive.Root open={drafting} onOpenChange={setDrafting}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-[14px] border border-hairline bg-surface-1 p-5 shadow-xl focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <DialogPrimitive.Title className="text-[16px] font-semibold tracking-tight text-fg">
                  Draft a quote for {wo.number}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-1 text-[12px] text-fg-subtle">
                  Pick a template to pre-fill line items. You can edit anything after.
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close
                aria-label="Close"
                className="rounded-md p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
              >
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    const q = quoteFromTemplate(wo, t);
                    setQuote(q);
                    setDrafting(false);
                  }}
                  className={cn(
                    "flex flex-col items-start gap-2 rounded-[10px] border border-hairline bg-surface-2 p-3 text-left transition-colors",
                    "hover:border-primary/40 hover:bg-primary-soft/40"
                  )}
                >
                  <div className="flex size-8 items-center justify-center rounded-[6px] bg-surface-3 text-primary">
                    {t.icon}
                  </div>
                  <div>
                    <div className="text-[13px] font-medium text-fg">{t.label}</div>
                    <div className="mt-0.5 text-[11px] text-fg-subtle">{t.blurb}</div>
                  </div>
                  {t.lines.length > 0 && (
                    <div className="mt-1 text-[10px] text-fg-tertiary">
                      {t.lines.length} line item{t.lines.length === 1 ? "" : "s"}
                    </div>
                  )}
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-[8px] border border-hairline bg-surface-2 p-2.5">
              <p className="text-[11px] text-fg-subtle">
                <span className="font-medium text-fg">Tip:</span>{" "}
                Ask the agent: <span className="font-mono">&ldquo;draft a quote for {wo.subject.toLowerCase()}&rdquo;</span>
              </p>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
