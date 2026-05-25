"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LedgerDrawerProvider } from "@/components/ledger/ledger-entry-drawer";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Truly public routes — the boater signing portal + boater self-service.
  // /dock used to live here, but losing the sidebar trapped admins on the
  // mobile view. The dock page is still styled mobile-first (max-w-[480px]
  // mx-auto) so it works fine inside the shell on desktop AND in standalone
  // PWA mode on a phone (browser chrome hides itself when installed).
  const isPublic =
    pathname.startsWith("/sign") ||
    pathname.startsWith("/portal");
  if (isPublic) return <>{children}</>;

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={300}>
      <LedgerDrawerProvider>
        <div className="flex h-screen w-screen overflow-hidden bg-canvas">
          <Sidebar />
          <div className="relative flex h-full min-w-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-hairline bg-surface-1 px-5">
              <div className="flex items-center gap-2 text-[13px] text-fg-muted">
                <span className="font-medium text-fg">Marina Stee</span>
                <span className="text-fg-tertiary">/</span>
                <Breadcrumb pathname={pathname} />
              </div>
              <ThemeToggle />
            </header>

            <main className="relative flex-1 overflow-y-auto">
              {children}
            </main>
          </div>
        </div>
      </LedgerDrawerProvider>
    </TooltipProvider>
  );
}

function Breadcrumb({ pathname }: { pathname: string }) {
  const label = (() => {
    if (pathname === "/") return "Dashboard";
    if (pathname.startsWith("/rentals")) return "Rentals";
    if (pathname.startsWith("/boaters")) return "Boaters";
    if (pathname.startsWith("/work-orders")) return "Work Orders";
    if (pathname.startsWith("/reservations")) return "Reservations";
    if (pathname.startsWith("/ledger")) return "Ledger / POS";
    if (pathname.startsWith("/reports")) return "Reports";
    if (pathname.startsWith("/notifications")) return "Notifications";
    if (pathname.startsWith("/inbox")) return "Inbox";
    if (pathname.startsWith("/settings")) return "Settings";
    return pathname.slice(1);
  })();
  return <span className="text-fg">{label}</span>;
}
