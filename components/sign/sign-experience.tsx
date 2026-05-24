"use client";

import * as React from "react";
import {
  CheckCircle2,
  CreditCard,
  Building2,
  Mail,
  Eraser,
  Sparkles,
  ShieldCheck,
  Ship,
  Anchor,
  FileText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/mock-data";
import type { Boater, Quote, Vessel, Slip } from "@/lib/types";

type Step = "review" | "sign" | "pay" | "done";
type PayMethod = "card" | "charge_to_account" | "check";

const KIND_LABEL = {
  part: "Part",
  labor: "Labor",
  fee: "Fee",
  discount: "Discount",
} as const;

const KIND_TONE = {
  part: "info",
  labor: "primary",
  fee: "warn",
  discount: "ok",
} as const;

export function SignExperience({
  quote: initial,
  boater,
  vessel,
  slip,
  workOrderSubject,
}: {
  quote: Quote;
  boater: Boater | undefined;
  vessel: Vessel | undefined;
  slip: Slip | undefined;
  workOrderSubject: string;
}) {
  const [step, setStep] = React.useState<Step>(
    initial.signed_at ? "done" : "review"
  );
  const [signerName, setSignerName] = React.useState(
    boater?.display_name?.split(", ").reverse().join(" ") ?? ""
  );
  const [hasSignature, setHasSignature] = React.useState(false);
  const [payMethod, setPayMethod] = React.useState<PayMethod | null>(null);
  const [signedAt, setSignedAt] = React.useState<string | null>(
    initial.signed_at ?? null
  );

  return (
    <div className="mx-auto w-full max-w-[640px] px-5 pb-24 pt-8">
      <Header boater={boater} />

      <main className="mt-6 space-y-4">
        {/* Quote summary card — always visible */}
        <section className="rounded-[12px] border border-hairline bg-surface-1 p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">
                Quote {initial.number}
              </div>
              <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-fg">
                {workOrderSubject}
              </h2>
              {boater && (
                <p className="mt-1 text-[13px] text-fg-subtle">
                  For {boater.display_name}
                  {boater.code ? ` · ${boater.code}` : ""}
                </p>
              )}
            </div>
            {signedAt ? (
              <Badge tone="ok">
                <CheckCircle2 className="size-3" />
                Signed
              </Badge>
            ) : (
              <Badge tone="info">Awaiting signature</Badge>
            )}
          </div>

          {(vessel || slip) && (
            <div className="mt-3 grid grid-cols-2 gap-3 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[12px]">
              {vessel && (
                <div className="inline-flex items-center gap-2">
                  <Ship className="size-3.5 text-fg-tertiary" />
                  <span className="text-fg-subtle">Vessel</span>
                  <span className="font-medium text-fg">{vessel.name}</span>
                </div>
              )}
              {slip && (
                <div className="inline-flex items-center gap-2">
                  <Anchor className="size-3.5 text-fg-tertiary" />
                  <span className="text-fg-subtle">Slip</span>
                  <span className="font-medium text-fg">{slip.dock} · {slip.number}</span>
                </div>
              )}
            </div>
          )}

          <ul className="mt-4 divide-y divide-hairline">
            {initial.line_items.map((li) => (
              <li key={li.id} className="flex items-start justify-between gap-3 py-2 text-[13px]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Badge tone={KIND_TONE[li.kind]} size="sm">{KIND_LABEL[li.kind]}</Badge>
                    <span className="font-medium text-fg">{li.name}</span>
                  </div>
                  {li.description && (
                    <p className="mt-0.5 text-[11px] text-fg-subtle">{li.description}</p>
                  )}
                  <p className="mt-0.5 text-[11px] text-fg-tertiary tabular-nums">
                    {li.qty} × {formatMoney(li.unit_price)}
                  </p>
                </div>
                <div className="text-right text-[13px] font-medium tabular-nums text-fg">
                  {formatMoney(li.total)}
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-3 space-y-1 border-t border-hairline pt-3 text-[12px] text-fg-subtle">
            <Row label="Parts">{formatMoney(initial.parts_subtotal)}</Row>
            <Row label="Labor">{formatMoney(initial.labor_subtotal)}</Row>
            {initial.fees_subtotal > 0 && (
              <Row label="Fees">{formatMoney(initial.fees_subtotal)}</Row>
            )}
            <Row label={`Tax (${(initial.tax_rate * 100).toFixed(2)}%)`}>
              {formatMoney(initial.tax_amount)}
            </Row>
          </div>
          <div className="mt-3 flex items-baseline justify-between border-t border-hairline pt-3">
            <span className="text-[11px] uppercase tracking-wide text-fg-tertiary">
              Total to authorize
            </span>
            <span className="money-display-lg text-[40px] text-fg">
              {formatMoney(initial.total)}
            </span>
          </div>
        </section>

        {/* Signed state — show signature + done */}
        {step === "done" && signedAt && (
          <SignedReceipt
            signerName={initial.signer_name ?? signerName}
            signedAt={signedAt}
            payMethod={payMethod ?? (initial.payment_method as PayMethod) ?? null}
          />
        )}

        {/* Sign step */}
        {step === "review" && (
          <section className="rounded-[12px] border border-hairline bg-surface-1 p-5">
            <h3 className="text-[15px] font-medium text-fg">Authorize the work</h3>
            <p className="mt-1 text-[12px] text-fg-subtle">
              By signing below, you authorize Marina Stee to perform the work described above
              and bill the total shown.
            </p>

            <label className="mt-4 block text-[12px] font-medium text-fg-subtle">
              Your full name
              <input
                type="text"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="As it should appear on the contract"
                className="mt-1.5 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
              />
            </label>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12px] font-medium text-fg-subtle">Signature</span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  onClick={() => setHasSignature(true)}
                  disabled={!signerName.trim()}
                >
                  <Sparkles className="size-3" />
                  Auto-sign
                </button>
              </div>
              <SignaturePad
                hasSignature={hasSignature}
                onChange={setHasSignature}
                signerName={signerName}
              />
            </div>

            <div className="mt-5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStep("pay")}
                disabled={!signerName.trim() || !hasSignature}
                className="tap-scale pill inline-flex h-12 items-center justify-center gap-2 bg-primary px-6 text-[15px] font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:bg-surface-3 disabled:text-fg-tertiary"
              >
                <ShieldCheck className="size-4" />
                Sign &amp; continue to payment
              </button>
            </div>
          </section>
        )}

        {/* Pay step */}
        {step === "pay" && (
          <section className="rounded-[12px] border border-hairline bg-surface-1 p-5">
            <h3 className="text-[15px] font-medium text-fg">How would you like to pay?</h3>
            <p className="mt-1 text-[12px] text-fg-subtle">
              You can also pay later — your slip balance will reflect the charge.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <PayOption
                label="Pay now with card"
                sub="Charged today"
                icon={<CreditCard className="size-4" />}
                active={payMethod === "card"}
                onClick={() => setPayMethod("card")}
              />
              <PayOption
                label="Charge to account"
                sub={`Added to your next statement${boater ? ` (${boater.code ?? boater.display_name})` : ""}`}
                icon={<Building2 className="size-4" />}
                active={payMethod === "charge_to_account"}
                onClick={() => setPayMethod("charge_to_account")}
                highlight
              />
              <PayOption
                label="Mail a check"
                sub="Pay manually in 30 days"
                icon={<Mail className="size-4" />}
                active={payMethod === "check"}
                onClick={() => setPayMethod("check")}
              />
            </div>

            <div className="mt-5 flex items-center gap-2">
              <Button
                variant="ghost"
                size="md"
                onClick={() => setStep("review")}
              >
                Back
              </Button>
              <button
                type="button"
                disabled={!payMethod}
                onClick={() => {
                  setSignedAt(new Date().toISOString());
                  setStep("done");
                }}
                className="tap-scale pill inline-flex h-12 items-center justify-center gap-2 bg-primary px-6 text-[15px] font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:bg-surface-3 disabled:text-fg-tertiary"
              >
                Confirm and submit
              </button>
            </div>
          </section>
        )}

        <footer className="mt-6 text-center text-[11px] text-fg-tertiary">
          <FileText className="mx-auto mb-1 size-3.5" />
          Signing this quote is a binding authorization. A copy will be emailed to you.
        </footer>
      </main>
    </div>
  );
}

function Header({ boater }: { boater: Boater | undefined }) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="flex size-9 items-center justify-center rounded-[8px] bg-primary text-on-primary">
          <span className="text-[15px] font-semibold tracking-tight">M</span>
        </div>
        <div>
          <div className="text-[14px] font-medium text-fg">Marina Stee</div>
          <div className="text-[11px] text-fg-tertiary">Secure quote signing</div>
        </div>
      </div>
      {boater && (
        <div className="text-right text-[11px] text-fg-tertiary">
          For {boater.first_name}
        </div>
      )}
    </header>
  );
}

function SignedReceipt({
  signerName,
  signedAt,
  payMethod,
}: {
  signerName: string;
  signedAt: string;
  payMethod: PayMethod | null;
}) {
  return (
    <section className="rounded-[12px] border border-status-ok/30 bg-status-ok/[0.06] p-5 text-center">
      <CheckCircle2 className="mx-auto size-8 text-status-ok" />
      <h3 className="mt-2 text-[18px] font-semibold tracking-tight text-fg">
        Thanks, {signerName.split(" ")[0]} — you&apos;re all set
      </h3>
      <p className="mt-1 text-[13px] text-fg-subtle">
        Signed {new Date(signedAt).toLocaleString()}.{" "}
        {payMethod === "card" && "Your card has been charged."}
        {payMethod === "charge_to_account" && "We've added the charge to your account."}
        {payMethod === "check" && "Please mail your check to the marina office within 30 days."}
        {!payMethod && "A copy of your signed quote has been emailed."}
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <Button variant="secondary" size="md">Download PDF</Button>
        <Button variant="ghost" size="md">Email me a copy</Button>
      </div>
    </section>
  );
}

function PayOption({
  label,
  sub,
  icon,
  active,
  onClick,
  highlight = false,
}: {
  label: string;
  sub: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1.5 rounded-[10px] border p-3 text-left transition-all",
        active
          ? "border-primary bg-primary-soft ring-2 ring-primary/30"
          : highlight
            ? "border-primary/40 bg-primary-soft/40 hover:border-primary"
            : "border-hairline bg-surface-2 hover:border-hairline-strong"
      )}
    >
      <span className="text-primary">{icon}</span>
      <span className="text-[13px] font-medium text-fg">{label}</span>
      <span className="text-[11px] text-fg-subtle">{sub}</span>
    </button>
  );
}

function SignaturePad({
  hasSignature,
  onChange,
  signerName,
}: {
  hasSignature: boolean;
  onChange: (b: boolean) => void;
  signerName: string;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);
  const last = React.useRef<{ x: number; y: number } | null>(null);

  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    // Set up high-DPI canvas
    const rect = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = getComputedStyle(c).getPropertyValue("color");
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  // When "Auto-sign" clicked (hasSignature toggled true and canvas is empty), write the name
  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    if (hasSignature && !drawing.current && !last.current && signerName.trim()) {
      const rect = c.getBoundingClientRect();
      ctx.font = "italic 32px 'Segoe Script', 'Bradley Hand', cursive";
      ctx.fillStyle = getComputedStyle(c).getPropertyValue("color");
      ctx.fillText(signerName, 20, rect.height / 2 + 12);
    }
  }, [hasSignature, signerName]);

  function pointer(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    last.current = pointer(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx || !last.current) return;
    const p = pointer(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasSignature) onChange(true);
  }

  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = false;
    last.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function clear() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    onChange(false);
  }

  return (
    <div>
      <div className="relative rounded-[8px] border border-hairline bg-surface-2">
        <canvas
          ref={canvasRef}
          className="block h-[140px] w-full touch-none rounded-[8px] text-fg"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
        {!hasSignature && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] italic text-fg-tertiary">
            Draw your signature here
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-fg-tertiary">Sign with mouse, trackpad, or finger</span>
        {hasSignature && (
          <button
            type="button"
            onClick={clear}
            className="inline-flex items-center gap-1 text-[11px] text-fg-subtle hover:text-fg"
          >
            <Eraser className="size-3" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className="font-mono text-fg">{children}</span>
    </div>
  );
}
