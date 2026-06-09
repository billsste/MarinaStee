"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { CurrentUserSwitcher } from "@/components/current-user-switcher";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LedgerDrawerProvider } from "@/components/ledger/ledger-entry-drawer";
import { ClubBookingDrawerProvider } from "@/components/members/club-booking-drawer";
import { GlobalDropFab } from "@/components/ai/global-drop-fab";
import { StormAlertBanner } from "@/components/storm-alert-banner";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Truly public routes — boater + holder self-service surfaces hit
  // directly from email links / marina marketing pages. Must NEVER
  // render with operator chrome.
  //
  //   /apply          — prospective boater applies for a slip
  //   /portal         — existing holder self-service portal
  //   /sign           — generic signature flow (contracts, waivers)
  //   /onboard        — new-holder contract signing wizard
  //   /coi-upload     — insurance certificate upload (boater-facing)
  //
  // /dock used to live here, but losing the sidebar trapped admins on
  // the mobile view. The dock page is styled mobile-first
  // (max-w-[480px] mx-auto on mobile, two-column at lg) so it works
  // inside the shell on desktop AND in standalone PWA mode on phone.
  //
  // The allowlist must mirror the 5 public routes called out in
  // CLAUDE.md §2 (Referrer-Policy: no-referrer applies to the same
  // five). If you add a public route here, add it there too.
  const isPublic =
    pathname.startsWith("/sign") ||
    pathname.startsWith("/portal") ||
    pathname.startsWith("/apply") ||
    pathname.startsWith("/onboard") ||
    pathname.startsWith("/coi-upload");
  if (isPublic) return <>{children}</>;

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={300}>
      <LedgerDrawerProvider>
        <ClubBookingDrawerProvider>
        <div className="flex h-screen w-screen overflow-hidden bg-canvas">
          <Sidebar />
          <div className="relative flex h-full min-w-0 flex-1 flex-col">
            {/* Marine-safety banner — wraps the operator app shell so
                weather signal follows the operator across every page.
                Hidden automatically when no active alert exists or
                the operator dismissed it this session. */}
            <StormAlertBanner />
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-hairline bg-surface-1 px-5">
              <div className="flex items-center gap-2 text-[13px] text-fg-muted">
                <span className="font-medium text-fg">Marina Stee</span>
                <span className="text-fg-tertiary">/</span>
                <Breadcrumb pathname={pathname} />
              </div>
              <div className="flex items-center gap-2">
                <CurrentUserSwitcher />
                <ThemeToggle />
              </div>
            </header>

            <main className="relative flex-1 overflow-y-auto">
              {children}
            </main>
            <GlobalDropFab />
          </div>
        </div>
        </ClubBookingDrawerProvider>
      </LedgerDrawerProvider>
    </TooltipProvider>
  );
}

function Breadcrumb({ pathname }: { pathname: string }) {
  const label = (() => {
    if (pathname === "/") return "Dashboard";
    if (pathname.startsWith("/services")) return "Services";
    if (pathname.startsWith("/members")) return "Members";
    if (pathname.startsWith("/work-orders")) return "Work Orders";
    if (pathname.startsWith("/bookings")) return "Bookings";
    if (pathname.startsWith("/reservations")) return "Bookings";
    if (pathname.startsWith("/boat-rentals")) return "Bookings";
    if (pathname.startsWith("/ledger")) return "Ledger / POS";
    if (pathname.startsWith("/reports")) return "Reports";
    if (pathname.startsWith("/notifications")) return "Notifications";
    if (pathname.startsWith("/inbox")) return "Inbox";
    if (pathname.startsWith("/settings")) return "Settings";
    return pathname.slice(1);
  })();
  return <span className="text-fg">{label}</span>;
}
