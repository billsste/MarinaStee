"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  Building2,
  CreditCard,
  ExternalLink,
  Mail,
  Package,
  Sparkles,
  Store,
  Tag,
  Upload,
  Users,
} from "lucide-react";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { cn } from "@/lib/utils";

/*
 * Settings shell — persistent left-rail nav + content area on the right.
 *
 * Replaces the old tile grid. Operators don't have to drill through doors
 * + a Back button to hop between Marina Profile, Staff, Connections, etc.
 * Every sub-area is one click away.
 *
 * Each sub-page renders only its View component — this shell owns the
 * H1, description, and agent ask. Sub-pages should NOT use PageShell.
 */

type NavSection = "Tenant" | "Operations" | "Customers" | "Connections" | "Tools";

type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  section: NavSection;
  external?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  // Tenant
  {
    href: "/settings/marina-profile",
    label: "Marina Profile",
    description:
      "The marina's identity — receipts, contracts, the boater portal, and every outbound message read from this profile. Changes save automatically when you leave a field.",
    icon: Building2,
    section: "Tenant",
  },
  {
    href: "/settings/customization",
    label: "Picklists & Docks",
    description:
      "Tune dropdown values and dock inventory across the app. Changes apply tenant-wide and update every dropdown immediately.",
    icon: Tag,
    section: "Tenant",
  },

  // Operations
  {
    href: "/settings/pos-locations",
    label: "POS Locations",
    description:
      "Your registers — Fuel Dock, Ship Store, Restaurant, Harbormaster, or whatever you call them. Items in the Catalog map to these locations.",
    icon: Store,
    section: "Operations",
  },
  {
    href: "/ledger?tab=catalog",
    label: "POS Catalog",
    description: "Edit items, prices, costs and category groupings.",
    icon: Package,
    section: "Operations",
    external: true,
  },
  {
    href: "/settings/comm-templates",
    label: "Comm Templates",
    description:
      "Edit the copy of every system-generated message — receipts, contract sends, COI reminders, payment failures. Merge tokens fill at send time.",
    icon: Mail,
    section: "Operations",
  },
  {
    href: "/notifications",
    label: "Notification Rules",
    description: "Quiet hours, channel defaults, storm triggers, reminders.",
    icon: Bell,
    section: "Operations",
    external: true,
  },

  // Connections
  {
    href: "/settings/connections",
    label: "Connections",
    description:
      "Connect your payment processor, email + SMS providers, and accounting system. Credentials are stored encrypted in your tenant.",
    icon: CreditCard,
    section: "Connections",
  },

  // Tools
  {
    href: "/settings/import",
    label: "Data Import",
    description:
      "Bulk-import slips, boaters, and vessels from CSV files. Use this once at onboarding or any time you onboard a new dock / acquire a new property.",
    icon: Upload,
    section: "Tools",
  },
  {
    href: "/settings/audit-log",
    label: "Audit Log",
    description:
      "Every change the agent and staff made — timestamped, with the prompt that triggered each agent action.",
    icon: Activity,
    section: "Tools",
  },
  {
    href: "/onboarding",
    label: "Re-run Setup Wizard",
    description: "Step through the first-run flow again.",
    icon: Sparkles,
    section: "Tools",
    external: true,
  },
];

const SECTION_ORDER: NavSection[] = [
  "Tenant",
  "Operations",
  "Connections",
  "Tools",
];

const DEFAULT_ITEM = NAV_ITEMS[0];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Match against the longest prefix so /settings/customization wins over
  // /settings/ when both could match. External items never match — they
  // navigate away.
  const active =
    NAV_ITEMS.filter((n) => !n.external)
      .filter((n) => pathname.startsWith(n.href))
      .sort((a, b) => b.href.length - a.href.length)[0] ?? DEFAULT_ITEM;

  return (
    // No section-title header — the AppShell breadcrumb ("Marina Stee /
    // Settings") identifies the page and the contextual h2 inside the
    // content column (below) names the active sub-area. Removing the
    // duplicate top "Settings" h1 reclaims ~80px on every settings page.
    <div className="mx-auto w-full max-w-[1280px] px-6 pt-4 pb-12">
      {/* Agent nests inside the content column (right of rail) so the chat
          box, suggestion chips, and section heading all share the same left
          edge. Same pattern as /services and /ledger — agent + content stack
          as one block beside the rail. */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
        {/* Left rail */}
        <nav aria-label="Settings sections" className="space-y-4">
          {SECTION_ORDER.map((section) => {
            const items = NAV_ITEMS.filter((n) => n.section === section);
            if (items.length === 0) return null;
            return (
              <div key={section}>
                <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
                  {section}
                </div>
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const isActive =
                      !item.external && pathname.startsWith(item.href);
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={cn(
                            "group flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-[13px] transition-colors",
                            isActive
                              ? "bg-surface-3 font-medium text-fg"
                              : "text-fg-subtle hover:bg-surface-2 hover:text-fg"
                          )}
                        >
                          <Icon className="size-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">
                            {item.label}
                          </span>
                          {item.external && (
                            <ExternalLink className="size-3 text-fg-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        {/* Content */}
        <div className="min-w-0 space-y-5">
          <RentalsAsk
            placeholder="Ask the agent — e.g. 'set marina phone to 555-1234' or 'add D Dock with prefix D'"
            suggestions={[
              "Add Tiffany as Manager",
              "Change marina phone to 231-555-9012",
              "Add D Dock with prefix D",
              "Bump default tax rate to 6.25%",
            ]}
          />
          <header>
            <h2 className="display-tight text-[20px] font-semibold text-fg">
              {active.label}
            </h2>
            <p className="mt-1 text-[13px] text-fg-subtle">
              {active.description}
            </p>
          </header>
          {children}
        </div>
      </div>
    </div>
  );
}
