import * as React from "react";

export function PageShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[1080px] px-6 pt-8 pb-32">
      <header className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-fg">
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
