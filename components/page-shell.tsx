import * as React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function PageShell({
  title,
  description,
  backHref,
  backLabel,
  children,
  width = "default",
  hideHeader = false,
}: {
  title: string;
  description?: string;
  /**
   * When set, renders a "← Back" link above the title that navigates
   * to this href via soft-nav (keeps store state). Use for nested
   * sub-pages (e.g. Settings → Marina Profile → backHref="/settings").
   */
  backHref?: string;
  /** Optional label override — defaults to "Back". */
  backLabel?: string;
  children?: React.ReactNode;
  /**
   * "default" → 1080px (most pages — single column or 2-up grids).
   * "wide" → 1400px (three-column views like Inbox / Notifications).
   * "full" → no max, just gutters (rare).
   */
  width?: "default" | "wide" | "full";
  /**
   * Suppress the visible `<h1>` + description block. Use for SECTION
   * landing pages where the AppShell breadcrumb + left rail already
   * identify the page — a duplicate h1 just eats vertical real estate.
   * Detail pages (specific vendor / staff / asset / reservation) leave
   * this off because their title IS the identifier (the entity name).
   *
   * `title` is still required — it sets aria-label on the wrapper
   * for screen readers and matches what's in the `metadata` export.
   *
   * When hidden, the wrapper drops to `pt-4` so content sits where the
   * header used to start (per CLAUDE.md §"List-page UX consistency"
   * rule #10 — no decorative header above the toolbar).
   */
  hideHeader?: boolean;
}) {
  const maxW =
    width === "wide" ? "max-w-[1400px]" : width === "full" ? "max-w-none" : "max-w-[1080px]";
  const pt = hideHeader ? "pt-4" : "pt-6";
  return (
    <div
      className={`mx-auto w-full ${maxW} px-5 ${pt} pb-32`}
      aria-label={title}
    >
      {!hideHeader && (
        <header className="mb-6">
          {backHref && (
            <Link
              href={backHref}
              className="mb-2 inline-flex items-center gap-1 text-[12px] text-fg-subtle transition-colors hover:text-fg"
            >
              <ChevronLeft className="size-3.5" />
              {backLabel ?? "Back"}
            </Link>
          )}
          <h1 className="display-tight text-[26px] font-semibold text-fg">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-[13px] text-fg-subtle">{description}</p>
          )}
        </header>
      )}
      {/* Back link still renders when header is hidden — preserves
          nested flow navigation (bulk-send, bulk-run, bulk-renewals)
          without the decorative title block. */}
      {hideHeader && backHref && (
        <Link
          href={backHref}
          className="mb-3 inline-flex items-center gap-1 text-[12px] text-fg-subtle transition-colors hover:text-fg"
        >
          <ChevronLeft className="size-3.5" />
          {backLabel ?? "Back"}
        </Link>
      )}
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: React.ReactNode;
}) {
  return (
    <div className="rounded-[12px] border border-dashed border-hairline-strong bg-surface-1 px-6 py-12 text-center">
      <h2 className="text-[15px] font-medium text-fg">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-5 text-fg-subtle">
        {body}
      </p>
      {cta && <div className="mt-4 inline-flex">{cta}</div>}
    </div>
  );
}
