"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Bell,
  CheckCheck,
  CreditCard,
  FileText,
  Flame,
  Gauge,
  MessageSquare,
  Shield,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStore, useWorkOrders } from "@/lib/client-store";
// `useStore()` already exposes `insurance` — pulled inline below.
import {
  buildAlerts,
  SOURCE_LABEL,
  type Alert,
  type AlertSeverity,
  type AlertSource,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";

/*
 * Unified Notifications view. Reads the entire client-store snapshot, pipes
 * it through buildAlerts(), and renders the result in severity-sorted order
 * with filters and per-alert acknowledge/dismiss.
 *
 * Acknowledged alerts are kept in component state — they hide from the
 * default view but a "Show acknowledged" filter brings them back.
 */

const SEVERITY_TONE: Record<
  AlertSeverity,
  { dot: string; chip: string; border: string }
> = {
  danger: {
    dot: "bg-status-danger",
    chip: "bg-status-danger/15 text-status-danger border-status-danger/30",
    border: "border-l-status-danger",
  },
  warn: {
    dot: "bg-status-warn",
    chip: "bg-status-warn/15 text-status-warn border-status-warn/30",
    border: "border-l-status-warn",
  },
  info: {
    dot: "bg-status-info",
    chip: "bg-status-info/15 text-status-info border-status-info/30",
    border: "border-l-status-info",
  },
};

const SOURCE_ICON: Record<AlertSource, React.ComponentType<{ className?: string }>> = {
  overdue_payment: CreditCard,
  meter_anomaly: Gauge,
  contract_expiry: FileText,
  fuel_low: Flame,
  urgent_work_order: Wrench,
  unanswered_inbound: MessageSquare,
  insurance_expiry: Shield,
};

export function NotificationsView() {
  const { ledger, communications, insurance } = useStore();
  const workOrders = useWorkOrders();

  const alerts = React.useMemo(
    () => buildAlerts({ ledger, workOrders, communications, insurance }),
    [ledger, workOrders, communications, insurance]
  );

  const [acked, setAcked] = React.useState<Record<string, true>>({});
  const [severity, setSeverity] = React.useState<AlertSeverity | "all">("all");
  const [source, setSource] = React.useState<AlertSource | "all">("all");
  const [showAcked, setShowAcked] = React.useState(false);

  const filtered = alerts.filter((a) => {
    if (!showAcked && acked[a.id]) return false;
    if (severity !== "all" && a.severity !== severity) return false;
    if (source !== "all" && a.source !== source) return false;
    return true;
  });

  const countsBySeverity = alerts.reduce(
    (acc, a) => {
      if (acked[a.id]) return acc;
      acc[a.severity] += 1;
      return acc;
    },
    { danger: 0, warn: 0, info: 0 } as Record<AlertSeverity, number>
  );

  const countsBySource = alerts.reduce(
    (acc, a) => {
      if (acked[a.id]) return acc;
      acc[a.source] = (acc[a.source] ?? 0) + 1;
      return acc;
    },
    {} as Record<AlertSource, number>
  );

  function ack(id: string) {
    setAcked((prev) => ({ ...prev, [id]: true }));
  }
  function unack(id: string) {
    setAcked((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }
  function ackAllVisible() {
    setAcked((prev) => {
      const next = { ...prev };
      for (const a of filtered) next[a.id] = true;
      return next;
    });
  }

  const totalUnacked = alerts.filter((a) => !acked[a.id]).length;

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 300px)" }}>
      {/* ── LEFT: alerts list ───────────────────────────────── */}
      <div className="space-y-3">
        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-surface-1 p-2">
          <SegBar
            label="Severity"
            value={severity}
            options={[
              { value: "all", label: `All · ${alerts.length - Object.keys(acked).length}` },
              { value: "danger", label: `Danger · ${countsBySeverity.danger}` },
              { value: "warn", label: `Warn · ${countsBySeverity.warn}` },
              { value: "info", label: `Info · ${countsBySeverity.info}` },
            ]}
            onChange={(v) => setSeverity(v as typeof severity)}
          />
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12px] text-fg-subtle">
              <input
                type="checkbox"
                checked={showAcked}
                onChange={(e) => setShowAcked(e.target.checked)}
                className="size-3.5"
              />
              Show acknowledged
            </label>
            {filtered.length > 0 && (
              <Button variant="ghost" size="sm" onClick={ackAllVisible}>
                <CheckCheck className="size-3.5" />
                Ack all
              </Button>
            )}
          </div>
        </div>

        {/* Source chips */}
        <div className="flex flex-wrap gap-1.5">
          <SourceChip active={source === "all"} onClick={() => setSource("all")}>
            All sources
          </SourceChip>
          {(Object.keys(SOURCE_LABEL) as AlertSource[])
            .filter((s) => countsBySource[s] > 0 || source === s)
            .map((s) => (
              <SourceChip
                key={s}
                active={source === s}
                onClick={() => setSource(s)}
              >
                {SOURCE_LABEL[s]} · {countsBySource[s] ?? 0}
              </SourceChip>
            ))}
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-hairline-strong bg-surface-1 px-6 py-12 text-center">
            <Bell className="mx-auto size-5 text-fg-tertiary" />
            <p className="mt-2 text-[13px] font-medium text-fg">All clear.</p>
            <p className="text-[12px] text-fg-subtle">
              {alerts.length === 0
                ? "Nothing needs your attention right now."
                : "No alerts match these filters — toggle 'Show acknowledged' or pick another source."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                acked={Boolean(acked[alert.id])}
                onAck={() => ack(alert.id)}
                onUnack={() => unack(alert.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ── RIGHT: agent triage rail ────────────────────────── */}
      <aside className="flex flex-col gap-3">
        <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-tertiary">
            <Sparkles className="size-3 text-primary" />
            Agent triage
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Danger" value={countsBySeverity.danger.toString()} tone="danger" />
            <Stat label="Warn" value={countsBySeverity.warn.toString()} tone="warn" />
            <Stat label="Info" value={countsBySeverity.info.toString()} tone="info" />
          </div>
          <p className="mt-3 text-[12px] leading-5 text-fg-subtle">
            {totalUnacked === 0
              ? "Nothing pending. Nice work."
              : `${totalUnacked} active alert${totalUnacked === 1 ? "" : "s"}. Use the suggestions below or open the agent for a tailored triage plan.`}
          </p>
        </div>

        <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-tertiary">
            Bulk prompts
          </div>
          <ul className="space-y-1.5 text-[12px]">
            <PromptLink href="/">Send reminders to everyone overdue</PromptLink>
            <PromptLink href="/">Open work orders for every meter anomaly</PromptLink>
            <PromptLink href="/">Draft renewals for contracts expiring in 30 days</PromptLink>
            <PromptLink href="/">Place a fuel reorder if any tank is below threshold</PromptLink>
          </ul>
        </div>
      </aside>
    </div>
  );
}

function AlertRow({
  alert,
  acked,
  onAck,
  onUnack,
}: {
  alert: Alert;
  acked: boolean;
  onAck: () => void;
  onUnack: () => void;
}) {
  const tone = SEVERITY_TONE[alert.severity];
  const Icon = SOURCE_ICON[alert.source];
  return (
    <li
      className={cn(
        "group rounded-[10px] border border-l-4 bg-surface-1 p-3 transition-colors hover:bg-surface-2",
        tone.border,
        "border-y-hairline border-r-hairline",
        acked && "opacity-60"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
            "bg-surface-3 text-fg-subtle"
          )}
        >
          <Icon className="size-3.5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-medium text-fg">{alert.title}</span>
            <span
              className={cn(
                "rounded-full border px-1.5 py-px text-[10px] font-medium capitalize",
                tone.chip
              )}
            >
              {alert.severity}
            </span>
            <Badge tone="outline" size="sm">{SOURCE_LABEL[alert.source]}</Badge>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-fg-subtle">{alert.detail}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg-tertiary">
            <span>{relTime(alert.occurred_at)}</span>
            {alert.href && (
              <>
                <span>·</span>
                <Link
                  href={alert.href}
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  Open <ArrowUpRight className="size-3" />
                </Link>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          {acked ? (
            <Button variant="ghost" size="sm" onClick={onUnack}>
              Unack
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onAck}>
              <CheckCheck className="size-3.5" />
              Ack
            </Button>
          )}
        </div>
      </div>

      {alert.suggested_prompt && !acked && (
        <div className="mt-2 flex items-center gap-1.5 rounded-[8px] border border-primary/20 bg-primary-soft/30 px-2.5 py-1.5">
          <Sparkles className="size-3 shrink-0 text-primary" />
          <span className="text-[12px] text-fg-subtle italic">{alert.suggested_prompt}</span>
          <Link
            href="/"
            className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline"
          >
            Ask agent <ArrowUpRight className="size-3" />
          </Link>
        </div>
      )}
    </li>
  );
}

function SegBar<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">{label}</span>
      <div className="flex rounded-[8px] border border-hairline bg-surface-2 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-[6px] px-2 py-0.5 text-[11px] font-medium transition-colors",
              value === o.value
                ? "bg-surface-1 text-fg shadow-sm"
                : "text-fg-subtle hover:text-fg"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SourceChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary-soft text-primary"
          : "border-hairline bg-surface-1 text-fg-muted hover:border-hairline-strong hover:bg-surface-2"
      )}
    >
      {children}
    </button>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: AlertSeverity;
}) {
  const valueTone =
    tone === "danger" ? "text-status-danger"
    : tone === "warn" ? "text-status-warn"
    : "text-status-info";
  return (
    <div>
      <div className={cn("money-display text-[22px] leading-none", valueTone)}>{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-fg-tertiary">{label}</div>
    </div>
  );
}

function PromptLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="inline-flex items-center gap-1 text-primary hover:underline">
        <ArrowUpRight className="size-3" />
        &ldquo;{children}&rdquo;
      </Link>
    </li>
  );
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - t;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 0) {
    // future date (e.g. contract expiry)
    const future = Math.abs(diffMin);
    if (future < 60) return `in ${future}m`;
    const futureH = Math.round(future / 60);
    if (futureH < 24) return `in ${futureH}h`;
    const futureD = Math.round(futureH / 24);
    return `in ${futureD}d`;
  }
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return new Date(iso).toLocaleDateString();
}
