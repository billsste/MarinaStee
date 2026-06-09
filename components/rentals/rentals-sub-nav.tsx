"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  List,
  Tag,
  Plus,
  Fuel,
  Gauge,
  FileText,
  Sailboat,
  RefreshCw,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Services left-rail nav. Mirrors the Settings + Member portal + Boater
 * detail pattern: persistent left-rail with the active section
 * highlighted, content fills the rest. usePathname drives the active
 * state since each tab is its own route under /services.
 *
 * "Services" is the umbrella for everything the marina sells: slips,
 * rates (incl. Rental Club plans), fees, gas, meters, contracts, and
 * the Rental Club fleet. The catalog-driven Rental Club plans show up
 * under /services/rates filtered by Rental Club; the boat fleet lives
 * on its own sub-tab so operators can flag which boats rotate into
 * the club rotation vs walk-up only.
 */

const NAV = [
  { href: "/services", label: "Overview", icon: LayoutGrid, exact: true },
  { href: "/services/roster", label: "Slips", icon: List },
  // Waitlist promoted to its own route so the slip roster doesn't
  // share scroll real estate with a 4-tab waitlist operator surface.
  // Operators reach the waitlist directly from the agent / dashboard
  // ("Who's up for an offer this week?") + this rail entry.
  { href: "/services/waitlist", label: "Slip Waitlist", icon: Users },
  { href: "/services/rental-club", label: "Rental Boats", icon: Sailboat },
  { href: "/services/rates", label: "Service rates", icon: Tag },
  { href: "/services/fees", label: "Fees", icon: Plus },
  { href: "/services/gas", label: "Gas", icon: Fuel },
  { href: "/services/meters", label: "Meters", icon: Gauge },
  { href: "/services/contracts", label: "Contracts", icon: FileText },
  { href: "/services/renewals", label: "Renewals", icon: RefreshCw },
];

export function RentalsSubNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Services sections"
      className="space-y-0.5 md:sticky md:top-20 md:self-start"
    >
      {NAV.map((n) => {
        const Icon = n.icon;
        const active = n.exact
          ? pathname === n.href
          : pathname.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            className={cn(
              "flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] transition-colors",
              active
                ? "bg-surface-3 font-medium text-fg"
                : "text-fg-subtle hover:bg-surface-2 hover:text-fg"
            )}
          >
            <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate">{n.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
