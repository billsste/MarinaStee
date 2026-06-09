"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  HardHat,
  Inbox,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  useAiSettings,
  useBills,
  useBoaters,
  useExtractionDrafts,
  useMarinaAssets,
  usePmSchedules,
  usePosCatalog,
  useStore,
} from "@/lib/client-store";
import { cn } from "@/lib/utils";

/*
 * QuietList — right-rail of small action items.
 *
 * Replaces the urgent-tile grid with a single compact list. Each row is
 * one thing that needs an eye but doesn't justify hero space. Tones are
 * subtle (a left bar) instead of full coloured panels.
 *
 * Only renders rows that have a count > 0 OR cleanly says "all clear"
 * when there's nothing on the list.
 */

type Tone = "danger" | "warn" | "info" | "ok";

const TONE_BAR: Record<Tone, string> = {
  danger: "bg-status-danger",
  warn: "bg-status-warn",
  info: "bg-status-info",
  ok: "bg-status-ok",
};

const TONE_TEXT: Record<Tone, string> = {
  danger: "text-status-danger",
  warn: "text-status-warn",
  info: "text-status-info",
  ok: "text-status-ok",
};

type Item = {
  key: string;
  icon: React.ReactNode;
  label: string;
  sub?: string;
  tone: Tone;
  href: string;
};

export function QuietList() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);

  const { insurance } = useStore();
  const bills = useBills();
  const boaters = useBoaters();
  const catalog = usePosCatalog();
  const pms = usePmSchedules();
  const assets = useMarinaAssets();
  const ai = useAiSettings();
  const allDrafts = useExtractionDrafts();

  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const thirtyDays = 30 * 86_400_000;
  const boaterIds = new Set(boaters.map((b) => b.id));

  // ── Compute counts ────────────────────────────────────────────
  const pastDueBills = bills.filter(
    (b) => b.status !== "paid" && b.due_date < today
  );
  const coiAtRisk = insurance.filter((c) => {
    if (!boaterIds.has(c.boater_id)) return false;
    const endMs = new Date(c.effective_end).getTime();
    return endMs - now <= thirtyDays && endMs - now >= 0;
  });
  const lowStock = catalog.filter(
    (i) => i.tracked && (i.stock_on_hand ?? 0) <= (i.reorder_point ?? 0)
  );
  const pmDue = pms.filter((p) => {
    if (!p.active) return false;
    const days = Math.round((new Date(p.next_due_at).getTime() - now) / 86_400_000);
    return days <= 30;
  });
  const inboxesEnabled =
    ai.bills_inbox_enabled ||
    ai.staff_onboarding_doc_intake_enabled ||
    ai.certs_photo_intake_enabled;
  const pendingDrafts = allDrafts.filter((d) => d.status === "pending");

  const items: Item[] = [];

  if (inboxesEnabled && pendingDrafts.length > 0) {
    items.push({
      key: "drafts",
      icon: <Inbox className="size-3.5" />,
      label: `${pendingDrafts.length} AI draft${pendingDrafts.length === 1 ? "" : "s"} ready`,
      sub: "Awaiting approval",
      tone: "info",
      href: "/vendors?section=inbox",
    });
  }
  if (coiAtRisk.length > 0) {
    items.push({
      key: "coi",
      icon: <ShieldCheck className="size-3.5" />,
      label: `${coiAtRisk.length} COI${coiAtRisk.length === 1 ? "" : "s"} at risk`,
      sub: "Expiring ≤ 30 days",
      tone: "warn",
      href: "/insurance",
    });
  }
  if (lowStock.length > 0) {
    items.push({
      key: "stock",
      icon: <Boxes className="size-3.5" />,
      label: `${lowStock.length} low-stock item${lowStock.length === 1 ? "" : "s"}`,
      sub: "At or below reorder",
      tone: "warn",
      href: "/inventory?section=low-stock",
    });
  }
  if (pmDue.length > 0) {
    items.push({
      key: "pm",
      icon: <HardHat className="size-3.5" />,
      label: `${pmDue.length} PM due ≤30d`,
      sub: `${assets.length} asset${assets.length === 1 ? "" : "s"} tracked`,
      tone: "warn",
      href: "/assets?section=pm-due",
    });
  }
  if (pastDueBills.length > 0) {
    items.push({
      key: "bills",
      icon: <AlertTriangle className="size-3.5" />,
      label: `${pastDueBills.length} past-due bill${pastDueBills.length === 1 ? "" : "s"}`,
      sub: "Vendor AP",
      tone: "danger",
      href: "/vendors?section=bills",
    });
  }

  // SSR-stable skeleton
  if (!mounted) {
    return (
      <div className="space-y-1">
        <div className="h-3 w-20 rounded bg-surface-2" />
        <div className="mt-2 h-12 w-full rounded bg-surface-2/60" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        <Sparkles className="size-3" />
        Watch list
      </div>

      {items.length === 0 ? (
        <div className="flex items-center gap-2 rounded-[8px] border border-hairline bg-surface-1 px-3 py-2.5">
          <CheckCircle2 className="size-3.5 text-status-ok" />
          <span className="text-[12px] text-fg-subtle">All clear.</span>
        </div>
      ) : (
        <ul className="space-y-1">
          {items.map((it) => (
            <li key={it.key}>
              <Link
                href={it.href}
                className={cn(
                  "group flex items-center gap-2 rounded-[8px] border border-hairline bg-surface-1 py-2 pr-2.5 transition-colors hover:border-hairline-strong hover:bg-surface-2"
                )}
              >
                <span className={cn("h-9 w-0.5 shrink-0 rounded-r", TONE_BAR[it.tone])} />
                <span className={cn("flex size-5 shrink-0 items-center justify-center", TONE_TEXT[it.tone])}>
                  {it.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-fg">
                    {it.label}
                  </div>
                  {it.sub && (
                    <div className="truncate text-[11px] text-fg-tertiary">
                      {it.sub}
                    </div>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
