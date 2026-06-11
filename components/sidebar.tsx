"use client";

import * as React from "react";
import Image from "next/image";
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
  ShieldCheck,
  UserCog,
  Briefcase,
  Boxes,
  HardHat,
  LifeBuoy,
  MessageCircleQuestion,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  switchTenant,
  useCurrentTenant,
  useMarinaProfile,
  useStore,
  useTenants,
  useWorkOrders,
} from "@/lib/client-store";
import { buildAlerts } from "@/lib/notifications";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

// Sidebar is grouped: business objects first (the things you manage), then
// comms (signal about those objects), then meta (mobile + settings). Visual
// dividers between groups give structure regardless of collapsed/expanded.
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  // Group 1: Dashboard + core operational entities
  {
    label: "Daily ops",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Services", href: "/services", icon: Anchor },
      { label: "Members", href: "/members", icon: Users },
      { label: "Bookings", href: "/bookings", icon: CalendarRange },
      { label: "Work Orders", href: "/work-orders", icon: Wrench },
      { label: "Ledger / POS", href: "/ledger", icon: Receipt },
      { label: "Insurance / COIs", href: "/insurance", icon: ShieldCheck },
      { label: "Reports", href: "/reports", icon: BarChart3 },
    ],
  },
  // Group 2: Back office — labor, money, things, equipment
  {
    label: "Back office",
    items: [
      { label: "Staff", href: "/staff", icon: UserCog },
      { label: "Vendors", href: "/vendors", icon: Briefcase },
      { label: "Inventory", href: "/inventory", icon: Boxes },
      { label: "Assets & PM", href: "/assets", icon: HardHat },
    ],
  },
  // Group 3: Communications + alerts (signal about the above)
  {
    label: "Comms",
    items: [
      { label: "Inbox", href: "/inbox", icon: Inbox },
      { label: "Support", href: "/support", icon: LifeBuoy },
      { label: "Notifications", href: "/notifications", icon: Bell },
    ],
  },
  // Group 4: Auxiliary surfaces
  {
    label: "Tools",
    items: [
      { label: "Dock view (mobile)", href: "/dock", icon: Smartphone },
      { label: "Onboarding", href: "/onboarding", icon: Sparkles },
      { label: "Help & feedback", href: "/help", icon: MessageCircleQuestion },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

// Persist the expand/collapse preference per browser. Default is EXPANDED
// because the marina-owner walkthrough found that non-technical operators
// couldn't identify what icon-only nav items meant.
const EXPAND_PREF_KEY = "marina.sidebar.expanded";

function readExpandedPref(): boolean {
  if (typeof window === "undefined") return true; // SSR: default expanded
  const raw = window.localStorage.getItem(EXPAND_PREF_KEY);
  // Treat missing key as "first run" → default to expanded. Only an
  // explicit "0" collapses.
  if (raw == null) return true;
  return raw !== "0";
}

export function Sidebar() {
  const pathname = usePathname();
  const { ledger, communications, insurance } = useStore();
  const workOrders = useWorkOrders();
  const alertCount = React.useMemo(
    () => buildAlerts({ ledger, workOrders, communications, insurance }).length,
    [ledger, workOrders, communications, insurance]
  );

  // Expanded vs collapsed. Hydration-safe pattern: render the collapsed
  // (narrow) shell on SSR + first client paint, then read the stored
  // preference in an effect and apply it. Avoids layout-shift hydration
  // mismatch when the user previously expanded.
  const [expanded, setExpanded] = React.useState(false);
  React.useEffect(() => {
    setExpanded(readExpandedPref());
  }, []);
  const toggleExpanded = React.useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(EXPAND_PREF_KEY, next ? "1" : "0");
      }
      return next;
    });
  }, []);

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-hairline bg-surface-1 transition-[width] duration-150",
        // Expanded width bumped from w-56 → w-60 so FitText has room
        // for full tenant names like "Marina Stee — Damsite Cove"
        // without dropping below ~9px font. Collapsed width unchanged.
        expanded ? "w-60 items-stretch" : "w-14 items-center"
      )}
      aria-label="Primary"
    >
      {/* Brand mark / tenant switcher row. Expanded shows the marina
          name beside the brand letter; collapsed shows just the
          letter.

          Note: this row INTENTIONALLY does not have `overflow-hidden`.
          An earlier revision added it to constrain the label, but
          FitText (used inside TenantSwitcher) now scopes its own
          overflow internally — and adding overflow-hidden HERE
          clipped the multi-tenant popover when it tried to render
          to the right of the sidebar. */}
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-hairline",
          expanded ? "justify-between gap-2 px-3" : "w-full flex-col justify-center gap-1"
        )}
      >
        <div className={cn("min-w-0", expanded && "flex-1")}>
          <TenantSwitcher expanded={expanded} />
        </div>
        {/* Toggle. Both states keep the toggle in the SAME spot —
            top-right of the header when expanded, just below the
            brand square when collapsed. Earlier revision put the
            expand affordance at the bottom of the nav and it ended
            up below the fold on shorter viewports, so operators
            couldn't get back.
            Plain chevron glyph (no panel outline) keeps it visually
            quiet next to the M tenant square — earlier
            PanelLeftOpen icon read as a bordered card. */}
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleExpanded}
              aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
              className={cn(
                "flex shrink-0 items-center justify-center rounded-[6px] text-fg-tertiary transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
                expanded ? "size-7" : "size-5"
              )}
            >
              {expanded ? (
                <ChevronLeft className="size-4" strokeWidth={2} />
              ) : (
                <ChevronRight className="size-3.5" strokeWidth={2} />
              )}
            </button>
          </TooltipTrigger>
          {!expanded && (
            <TooltipContent side="right">Show labels</TooltipContent>
          )}
        </Tooltip>
      </div>

      {/* Nav */}
      <nav
        className={cn(
          "flex flex-1 flex-col gap-1 overflow-y-auto py-3",
          expanded ? "items-stretch px-2" : "items-center px-2"
        )}
      >
        {NAV_GROUPS.map((group, groupIdx) => (
          <React.Fragment key={group.label}>
            {groupIdx > 0 && (
              <div
                aria-hidden
                className={cn(
                  "my-2 h-px bg-hairline",
                  expanded ? "mx-2 w-auto" : "w-7"
                )}
              />
            )}
            {expanded && (
              <div
                aria-hidden
                className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-fg-tertiary"
              >
                {group.label}
              </div>
            )}
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);
              const showBadge = item.href === "/notifications" && alertCount > 0;
              const linkClass = cn(
                "relative flex items-center rounded-[8px] transition-colors",
                expanded
                  ? "gap-2.5 px-2 py-1.5 text-[13px]"
                  : "size-9 justify-center",
                active
                  ? "bg-surface-3 text-fg"
                  : "text-fg-subtle hover:bg-surface-2 hover:text-fg"
              );
              const linkInner = (
                <Link
                  href={item.href}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  className={linkClass}
                >
                  <Icon
                    className={cn("shrink-0", expanded ? "size-4" : "size-[18px]")}
                    strokeWidth={1.75}
                  />
                  {expanded && (
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {item.label}
                    </span>
                  )}
                  {showBadge && (
                    <span
                      aria-hidden
                      className={cn(
                        "inline-flex min-w-[16px] items-center justify-center rounded-full bg-status-danger px-1 text-[9px] font-semibold leading-[14px] text-white tabular",
                        expanded ? "ml-auto" : "absolute -right-0.5 -top-0.5"
                      )}
                    >
                      {alertCount > 9 ? "9+" : alertCount}
                    </span>
                  )}
                </Link>
              );
              // When collapsed, wrap in tooltip so the label is still
              // discoverable. When expanded, label is on-screen so the
              // tooltip is redundant.
              return expanded ? (
                <React.Fragment key={item.href}>{linkInner}</React.Fragment>
              ) : (
                <Tooltip key={item.href} delayDuration={150}>
                  <TooltipTrigger asChild>{linkInner}</TooltipTrigger>
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

      {/* Toggle now lives in the sidebar header (next to the brand
          square in collapsed mode, opposite the brand label in
          expanded mode). The earlier bottom-of-rail placement put
          the expand affordance below the nav fold on shorter
          viewports — operators couldn't get back from collapsed
          mode without scrolling. */}
    </aside>
  );
}

/*
 * Tenant switcher / indicator. Single-tenant deployments see a static
 * brand mark linking back to /. Multi-tenant deployments see a button
 * that opens a popover with the tenant list. The brand letter mirrors
 * the active marina so cross-tenant mistakes get caught visually
 * before they get caught by the executor guard.
 *
 * When the sidebar is expanded, we additionally surface the marina's
 * short name beside the brand letter so the operator gets a literal
 * label, not just a glyph.
 */
function TenantSwitcher({ expanded }: { expanded: boolean }) {
  const tenant = useCurrentTenant();
  const tenants = useTenants();
  const profile = useMarinaProfile();
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Close on outside click — small popover, no need for a full
  // dropdown primitive.
  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const letter = (profile.short_name || tenant?.name || "M").charAt(0).toUpperCase();
  const label = tenant?.name ?? profile.short_name ?? "Marina Stee";

  // Single-tenant: keep the historical brand-link behavior so nothing
  // changes visually for deployments that aren't multi-tenant.
  //
  // EXPANDED: full Marina Shores at Dune Harbor wordmark from
  //   /ms-logo.png — the horizontal lockup that fits the sidebar's
  //   wider header.
  // COLLAPSED: the circular MS badge from /ms-logo-mark.png — same
  //   brand at 32px in a round chip. Replaces the generic M
  //   letterform.
  if (tenants.length <= 1) {
    return (
      <Link
        href="/"
        aria-label={`${label} — home`}
        className={cn(
          "flex items-center rounded-[8px]",
          expanded ? "w-full min-w-0 px-1 py-1 hover:bg-surface-2" : ""
        )}
      >
        {expanded ? (
          <Image
            src="/ms-logo.png"
            alt={label}
            width={400}
            height={120}
            priority
            className="h-9 w-auto max-w-full object-contain"
          />
        ) : (
          <Image
            src="/ms-logo-mark.png"
            alt={label}
            width={64}
            height={64}
            priority
            className="size-8 shrink-0 rounded-full object-cover"
          />
        )}
      </Link>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <Tooltip delayDuration={150}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={`Switch tenant — currently ${label}`}
            aria-haspopup="menu"
            aria-expanded={open}
            className={cn(
              "flex items-center rounded-[8px] transition-colors",
              expanded ? "w-full min-w-0 px-1 py-1 hover:bg-surface-2" : ""
            )}
          >
            {expanded ? (
              <Image
                src="/ms-logo.png"
                alt={label}
                width={400}
                height={120}
                priority
                className="h-9 w-auto max-w-full object-contain"
              />
            ) : (
              <Image
                src="/ms-logo-mark.png"
                alt={label}
                width={64}
                height={64}
                priority
                className="size-8 shrink-0 rounded-full object-cover transition-opacity hover:opacity-90"
              />
            )}
          </button>
        </TooltipTrigger>
        {!expanded && (
          <TooltipContent side="right">{label} · click to switch</TooltipContent>
        )}
      </Tooltip>
      {open && (
        <div
          role="menu"
          className="absolute left-full top-0 z-50 ml-2 w-[200px] rounded-[10px] border border-hairline bg-surface-1 p-1 shadow-lg"
        >
          <div className="border-b border-hairline px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
            Tenants
          </div>
          {tenants.map((t) => {
            const isActive = t.id === tenant?.id;
            return (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  switchTenant(t.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-left text-[12px] transition-colors",
                  isActive
                    ? "bg-primary-soft/50 text-primary"
                    : "text-fg-subtle hover:bg-surface-2 hover:text-fg"
                )}
              >
                <span className="truncate">{t.name}</span>
                {isActive && (
                  <span aria-hidden className="text-[10px]">
                    ●
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
