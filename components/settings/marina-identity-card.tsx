"use client";

import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import { useMarinaProfile } from "@/lib/client-store";

/**
 * Settings → Marina identity card. Shows a live preview of the current
 * MarinaProfile and acts as a clickable entry to the full editor at
 * `/settings/marina-profile`. The settings landing page composes this
 * inside its grid so the rest of the cards (staff, payment, etc.) stay
 * server-rendered.
 */
export function MarinaIdentityCard() {
  const profile = useMarinaProfile();
  const taxPct = (profile.default_tax_rate * 100).toFixed(2).replace(/\.00$/, "");
  const accountingClose =
    profile.accounting_close === "monthly_eom"
      ? "Monthly · last day of month"
      : profile.accounting_close === "monthly_15th"
      ? "Monthly · 15th"
      : "Weekly · Friday";

  return (
    <Link
      href="/settings/marina-profile"
      className="group block rounded-[12px] border border-hairline bg-surface-1 transition-colors hover:border-hairline-strong hover:bg-surface-2"
    >
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-[6px] bg-surface-3 text-primary">
            <Building2 className="size-4" />
          </div>
          <div>
            <h3 className="text-[14px] font-medium text-fg">Marina identity</h3>
            <p className="text-[11px] text-fg-tertiary">
              Branding, address, hours, tax + accounting defaults
            </p>
          </div>
        </div>
        <ChevronRight className="size-4 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
      </header>
      <div className="space-y-1.5 p-4 text-[13px]">
        <FieldRow label="Marina name" value={profile.display_name} />
        <FieldRow label="Time zone" value={profile.timezone} />
        <FieldRow label="Tax rate (default)" value={`${taxPct}%`} />
        <FieldRow label="Accounting close" value={accountingClose} />
      </div>
    </Link>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-fg-tertiary">{label}</span>
      <span className="text-fg">{value}</span>
    </div>
  );
}
