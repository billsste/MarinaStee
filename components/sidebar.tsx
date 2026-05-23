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
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Rentals", href: "/rentals", icon: Anchor },
  { label: "Boaters", href: "/boaters", icon: Users },
  { label: "Reservations", href: "/reservations", icon: CalendarRange },
  { label: "Work Orders", href: "/work-orders", icon: Wrench },
  { label: "Ledger / POS", href: "/ledger", icon: Receipt },
  { label: "Settings", href: "/settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar() {
  const pathname = usePathname();

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
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <Tooltip key={item.href} delayDuration={150}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-[8px] transition-colors",
                    active
                      ? "bg-surface-3 text-fg"
                      : "text-fg-subtle hover:bg-surface-2 hover:text-fg"
                  )}
                >
                  <Icon className="size-[18px]" strokeWidth={1.75} />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </aside>
  );
}
