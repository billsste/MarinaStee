"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Anchor,
  Users,
  Receipt,
  Settings,
  Wrench,
  CalendarRange,
  Smartphone,
  Inbox,
  Bell,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useStore, useWorkOrders } from "@/lib/client-store";
import { buildAlerts } from "@/lib/notifications";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

// Sidebar is grouped: business objects first (the things you manage), then
// comms (signal about those objects), then meta (mobile + settings). Visual
// dividers between groups give structure without labels.
const NAV_GROUPS: NavItem[][] = [
  // Group 1: Dashboard + core operational entities
  [
    { label: "Dashboard", href: "/", icon: LayoutDashboard },
    { label: "Rentals", href: "/rentals", icon: Anchor },
    { label: "Boaters", href: "/boaters", icon: Users },
    { label: "Reservations", href: "/reservations", icon: CalendarRange },
    { label: "Work Orders", href: "/work-orders", icon: Wrench },
    { label: "Ledger / POS", href: "/ledger", icon: Receipt },
    { label: "Reports", href: "/reports", icon: BarChart3 },
  ],
  // Group 2: Communications + alerts (signal about the above)
  [
    { label: "Inbox", href: "/inbox", icon: Inbox },
    { label: "Notifications", href: "/notifications", icon: Bell },
  ],
  // Group 3: Auxiliary surfaces
  [
    { label: "Dock view (mobile)", href: "/dock", icon: Smartphone },
    { label: "Settings", href: "/settings", icon: Settings },
  ],
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar() {
  const pathname = usePathname();
  const { ledger, communications, insurance } = useStore();
  const workOrders = useWorkOrders();
  const alertCount = React.useMemo(
    () => buildAlerts({ ledger, workOrders, communications, insurance }).length,
    [ledger, workOrders, communications, insurance]
  );

  return (
    <aside
      className="flex h-full w-14 shrink-0 flex-col items-center border-r border-hairline bg-surface-1"
      aria-label="Primary"
    >
      {/* Brand mark */}
      <div className="flex h-14 w-full items-center justify-center border-b border-hairline">
        <Link
          href="/"
          aria-label="Marina Stee home"
          className="flex size-8 items-center justify-center rounded-[8px] bg-primary text-on-primary"
        >
          <span className="font-semibold text-[13px] tracking-tight">M</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col items-center gap-1 px-2 py-3">
        {NAV_GROUPS.map((group, groupIdx) => (
          <React.Fragment key={groupIdx}>
            {groupIdx > 0 && (
              <div
                aria-hidden
                className="my-2 h-px w-7 bg-hairline"
              />
            )}
            {group.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);
              const showBadge = item.href === "/notifications" && alertCount > 0;
              return (
                <Tooltip key={item.href} delayDuration={150}>
                  <TooltipTrigger asChild>
                    <Link
                      href={item.href}
                      aria-label={item.label}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex size-9 items-center justify-center rounded-[8px] transition-colors",
                        active
                          ? "bg-surface-3 text-fg"
                          : "text-fg-subtle hover:bg-surface-2 hover:text-fg"
                      )}
                    >
                      <Icon className="size-[18px]" strokeWidth={1.75} />
                      {showBadge && (
                        <span
                          aria-hidden
                          className="absolute -right-0.5 -top-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-status-danger px-1 text-[9px] font-semibold leading-[14px] text-white tabular"
                        >
                          {alertCount > 9 ? "9+" : alertCount}
                        </span>
                      )}
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {item.label}
                    {showBadge ? ` (${alertCount})` : ""}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </React.Fragment>
        ))}
      </nav>
    </aside>
  );
}
