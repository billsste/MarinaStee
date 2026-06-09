/*
 * Status + type + priority pills for support tickets.
 *
 * Maps each domain value to a Marina Stee token tone (status-ok /
 * warn / danger / info / neutral) per the global §5 rule: "Use the
 * product's own status colors, not generic gray."
 */

import { Badge } from "@/components/ui/badge";
import type {
  SupportTicketPriority,
  SupportTicketStatus,
  SupportTicketType,
} from "@/lib/types";

type Size = "sm" | "md";

export function SupportStatusBadge({
  status,
  size = "md",
}: {
  status: SupportTicketStatus;
  size?: Size;
}) {
  switch (status) {
    case "open":
      return (
        <Badge tone="warn" size={size}>
          Open
        </Badge>
      );
    case "in_progress":
      return (
        <Badge tone="info" size={size}>
          In progress
        </Badge>
      );
    case "awaiting_boater":
      return (
        <Badge tone="primary" size={size}>
          Waiting on you
        </Badge>
      );
    case "resolved":
      return (
        <Badge tone="ok" size={size}>
          Resolved
        </Badge>
      );
    case "cancelled":
      return (
        <Badge tone="neutral" size={size}>
          Cancelled
        </Badge>
      );
  }
}

/**
 * Operator-side variant of the status label — phrased from the staff
 * point of view (e.g. "Awaiting boater" instead of "Waiting on you").
 */
export function SupportStatusBadgeOps({
  status,
  size = "md",
}: {
  status: SupportTicketStatus;
  size?: Size;
}) {
  if (status === "awaiting_boater") {
    return (
      <Badge tone="primary" size={size}>
        Awaiting boater
      </Badge>
    );
  }
  return <SupportStatusBadge status={status} size={size} />;
}

export function SupportPriorityBadge({
  priority,
  size = "sm",
}: {
  priority: SupportTicketPriority;
  size?: Size;
}) {
  switch (priority) {
    case "urgent":
      return (
        <Badge tone="danger" size={size}>
          Urgent
        </Badge>
      );
    case "high":
      return (
        <Badge tone="warn" size={size}>
          High
        </Badge>
      );
    case "normal":
      return (
        <Badge tone="neutral" size={size}>
          Normal
        </Badge>
      );
    case "low":
      return (
        <Badge tone="outline" size={size}>
          Low
        </Badge>
      );
  }
}

export function SupportTypeBadge({
  type,
  size = "sm",
}: {
  type: SupportTicketType;
  size?: Size;
}) {
  const label = TYPE_LABEL[type];
  // Type is informational only — keep it tonal-neutral so it doesn't
  // compete with status/priority for attention.
  return (
    <Badge tone="outline" size={size}>
      {label}
    </Badge>
  );
}

export const TYPE_LABEL: Record<SupportTicketType, string> = {
  bug: "Bug",
  question: "Question",
  feature_request: "Feature request",
  billing: "Billing",
  other: "Other",
};

export const PRIORITY_LABEL: Record<SupportTicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const STATUS_LABEL: Record<SupportTicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  awaiting_boater: "Awaiting boater",
  resolved: "Resolved",
  cancelled: "Cancelled",
};
