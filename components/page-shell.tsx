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
}) {
  const maxW =
    width === "wide" ? "max-w-[1400px]" : width === "full" ? "max-w-none" : "max-w-[1080px]";
  // Padding matches the canonical hand-rolled wrappers used by
  // /members (app/members/members-client.tsx) and /services
  // (app/services/layout.tsx) so the header sits in the SAME spot
  // across every top-level page — no matter whether the page uses
  // PageShell or rolled its own wrapper.
  return (
    <div className={`mx-auto w-full ${maxW} px-5 pt-6 pb-32`}>
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
