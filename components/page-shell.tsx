import * as React from "react";

export function PageShell({
  title,
  description,
  children,
  width = "default",
}: {
  title: string;
  description?: string;
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
  return (
    <div className={`mx-auto w-full ${maxW} px-6 pt-8 pb-12`}>
      <header className="mb-6">
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
