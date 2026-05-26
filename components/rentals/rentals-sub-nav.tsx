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
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/docks", label: "Overview", icon: LayoutGrid, exact: true },
  { href: "/docks/slips", label: "Slips", icon: List },
  { href: "/docks/rates", label: "Rates", icon: Tag },
  { href: "/docks/fees", label: "Fees", icon: Plus },
  { href: "/docks/gas", label: "Gas", icon: Fuel },
  { href: "/docks/meters", label: "Meters", icon: Gauge },
  { href: "/docks/contracts", label: "Contracts", icon: FileText },
];

export function RentalsSubNav() {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex flex-wrap items-center gap-1 border-b border-hairline pb-2">
      {NAV.map((n) => {
        const Icon = n.icon;
        const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[13px] font-medium transition-colors",
              active
                ? "bg-surface-3 text-fg"
                : "text-fg-subtle hover:bg-surface-2 hover:text-fg"
            )}
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
