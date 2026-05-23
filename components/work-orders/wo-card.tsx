"use client";

import Link from "next/link";
import {
  Wrench,
  Droplets,
  Snowflake,
  Search,
  Ship,
  ClipboardList,
  Clock,
  Flag,
  CheckCheck,
  DollarSign,
  Calendar,
  User as UserIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  BOATERS,
  USERS,
  formatMoney,
  getQuoteForWorkOrder,
} from "@/lib/mock-data";
import type { WorkOrder, WorkOrderActivityType } from "@/lib/types";

const ACTIVITY_ICON: Record<WorkOrderActivityType, LucideIcon> = {
  winterization: Snowflake,
  bottom_paint: Droplets,
  service: Wrench,
  inspection: Search,
  haul_out: Ship,
  other: ClipboardList,
};

const ACTIVITY_LABEL: Record<WorkOrderActivityType, string> = {
  winterization: "Winterization",
  bottom_paint: "Bottom paint",
  service: "Service",
  inspection: "Inspection",
  haul_out: "Haul-out",
  other: "Other",
};

const PRIORITY_TONE = {
  urgent: "danger",
  high: "warn",
  normal: "neutral",
  low: "outline",
} as const;

function fmtDuration(minutes?: number) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

export function WoCard({
  wo,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  wo: WorkOrder;
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const boater = BOATERS.find((b) => b.id === wo.boater_id);
  const assignee = USERS.find((u) => u.id === wo.assignee_user_id);
  const quote = getQuoteForWorkOrder(wo.id);
  const Icon = ACTIVITY_ICON[wo.activity_type ?? "other"];
  const duration = fmtDuration(wo.billable_minutes);

  return (
    <Link
      href={`/work-orders/${wo.id}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "block cursor-grab rounded-[10px] border bg-surface-1 p-3 transition-all hover:border-hairline-strong",
        dragging ? "opacity-40 scale-[0.97]" : "",
        wo.flagged ? "border-status-warn/40" : "border-hairline"
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <Badge tone="outline" size="sm">
          <Icon className="size-3" strokeWidth={2} />
          {ACTIVITY_LABEL[wo.activity_type ?? "other"]}
        </Badge>
        {quote?.signed_at && (
          <Badge tone="ok" size="sm">
            <CheckCheck className="size-3" />
            Signed
          </Badge>
        )}
        {quote?.status === "invoiced" && (
          <Badge tone="primary" size="sm">
            Billed
          </Badge>
        )}
        {wo.flagged && (
          <Badge tone="warn" size="sm">
            <Flag className="size-3" />
            Flagged
          </Badge>
        )}
        <Badge tone={PRIORITY_TONE[wo.priority]} size="sm" className="ml-auto">
          {wo.priority}
        </Badge>
      </div>

      <div className="flex items-center gap-1.5 text-[10px] font-mono text-fg-tertiary">
        {wo.number}
      </div>
      <p className="mt-0.5 line-clamp-2 text-[13px] font-medium leading-snug text-fg">
        {wo.subject}
      </p>
      {boater && (
        <p className="mt-1 truncate text-[11px] text-fg-subtle">
          {boater.display_name}
          {wo.slip_id && <span className="text-fg-tertiary"> · slip {wo.slip_id}</span>}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-fg-tertiary">
        {quote && (
          <span className="inline-flex items-center gap-0.5">
            <DollarSign className="size-3" />
            {formatMoney(quote.total)}
          </span>
        )}
        {duration && (
          <span className="inline-flex items-center gap-0.5 text-status-info">
            <Clock className="size-3" />
            {duration}
          </span>
        )}
        {assignee && (
          <span className="inline-flex items-center gap-0.5">
            <UserIcon className="size-3" />
            {assignee.name.split(",")[0]}
          </span>
        )}
        {(wo.start_date || wo.due_date) && (
          <span className="inline-flex items-center gap-0.5">
            <Calendar className="size-3" />
            {new Date(wo.start_date ?? wo.due_date!).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
      </div>
    </Link>
  );
}
