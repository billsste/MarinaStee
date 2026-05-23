import { CheckCircle2, Clock, Loader2, AlertCircle, MinusCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { QbSyncStatus } from "@/lib/types";

const TONE: Record<QbSyncStatus, "ok" | "warn" | "info" | "danger" | "neutral"> = {
  synced: "ok",
  pending: "warn",
  syncing: "info",
  error: "danger",
  skipped: "neutral",
};

const LABEL: Record<QbSyncStatus, string> = {
  synced: "Synced",
  pending: "Pending",
  syncing: "Syncing…",
  error: "Error",
  skipped: "Skipped",
};

export function QbSyncBadge({ status, ref: qbRef }: { status?: QbSyncStatus; ref?: string }) {
  if (!status) return null;
  const Icon =
    status === "synced" ? CheckCircle2
    : status === "pending" ? Clock
    : status === "syncing" ? Loader2
    : status === "error" ? AlertCircle
    : MinusCircle;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={TONE[status]} size="sm">
        <Icon className={"size-3 " + (status === "syncing" ? "animate-spin" : "")} />
        QB · {LABEL[status]}
      </Badge>
      {qbRef && status === "synced" && (
        <span className="font-mono text-[10px] text-fg-tertiary">{qbRef}</span>
      )}
    </span>
  );
}
