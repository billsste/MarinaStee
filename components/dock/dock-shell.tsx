"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Note: the StormAlertBanner is mounted by AppShell, which wraps /dock
// — adding a second instance here would render the banner twice. If
// /dock ever moves to the `isPublic` allowlist in app-shell.tsx, mount
// the banner here to keep weather signal on the dock.

/*
 * DockShell — mobile dock-view chrome.
 *
 * Owns:
 *   - The sticky header (status-bar-aware via safe-area-inset-top)
 *   - The mobile-first max-w-[480px] column
 *   - Canonical content padding (px-5 pt-6 pb-32) — matches
 *     /members, /bookings, /services, /work-orders
 *   - Header typography (display-tight text-[26px] font-semibold)
 *     so a dock sub-view's title matches operator-page headers
 *
 * Does NOT own:
 *   - The VoiceFab (lives in DockPage to keep agent wiring close to
 *     the data hooks it submits against)
 *   - Navigation state — pages pass `onBack` for the back button
 *
 * Why the header pads with safe-area-inset instead of the layout
 * wrapper: a wrapper paddingTop pushes the sticky header DOWN from the
 * top of the screen on iOS standalone, which looks broken (status bar
 * floats over a strip of canvas). Pad the inside of the header instead.
 */
export function DockShell({
  brand,
  staffLabel,
  showBack,
  onBack,
  rightSlot,
  children,
}: {
  /** Top-left brand square contents — defaults to "M". */
  brand?: React.ReactNode;
  /** Subtitle under brand — e.g. "Dock view · J. Reyes". */
  staffLabel: string;
  /** When true, replaces brand with a Back affordance. */
  showBack: boolean;
  onBack: () => void;
  /**
   * Top-right slot — typically the "Admin ↗" link. The shell sizes
   * the hit area to ≥ 44pt, the consumer just supplies content.
   */
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // Mobile: narrow 480px column — this is the PWA install target and
    // must stay tap-sized for boaters running it from the iOS home
    // screen. Desktop (lg+): widen the shell to 1280px so a marina
    // owner on an iMac doesn't see a 480px sliver floating in the
    // middle of a 1440px viewport — looks broken, undermines trust.
    // Sub-views still constrain their inner content to a readable
    // column; only the Home view (in page.tsx) opts into the 2-col
    // grid that fills the wider shell.
    <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-canvas lg:max-w-[1280px]">
      <header
        className="sticky top-0 z-10 border-b border-hairline bg-surface-1/90 backdrop-blur"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex items-center justify-between px-5 py-3 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            {showBack ? (
              <button
                type="button"
                onClick={onBack}
                className="-ml-2 inline-flex h-11 items-center gap-1 rounded-[8px] px-2 text-[13px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
                aria-label="Back"
              >
                <ArrowLeft className="size-4" />
                Back
              </button>
            ) : (
              <>
                <div className="flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-primary text-on-primary">
                  {brand ?? <span className="text-[13px] font-semibold">M</span>}
                </div>
                <div className="min-w-0 text-[13px]">
                  <div className="truncate font-medium text-fg">Marina Stee</div>
                  <div className="truncate text-[10px] text-fg-tertiary">
                    {staffLabel}
                  </div>
                </div>
              </>
            )}
          </div>
          {rightSlot ?? (
            <Link
              href="/"
              className="inline-flex h-11 items-center rounded-[8px] px-2 text-[12px] text-fg-tertiary hover:bg-surface-2 hover:text-fg"
              aria-label="Switch to admin"
            >
              Admin ↗
            </Link>
          )}
        </div>
      </header>

      {/* Content column — padding matches the canonical operator pages
          (px-5 pt-6 pb-32). pb-32 leaves clearance for the Voice FAB
          plus iOS home indicator without the FAB clipping the last tile.
          On desktop the shell expands to 1280px (above) — bump horizontal
          padding so the inner content has breathing room from the edges. */}
      <main className="flex-1 px-5 pt-6 pb-32 lg:px-8 lg:pt-8">{children}</main>
    </div>
  );
}

/**
 * DockH1 — page heading for a dock sub-view. Matches the canonical
 * operator-page heading from `page-shell.tsx`:
 *   display-tight text-[26px] font-semibold
 *
 * Sub-headings on /dock previously used text-[20px] which read smaller
 * than the operator pages and felt visually disconnected when an admin
 * jumped from /services to /dock.
 */
export function DockH1({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="mb-5">
      <h1 className="display-tight text-[26px] font-semibold text-fg">
        {title}
      </h1>
      {description && (
        <p className="mt-1 text-[13px] leading-5 text-fg-subtle">
          {description}
        </p>
      )}
    </header>
  );
}
