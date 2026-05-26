"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Shared Radix Dialog wrapper for "+ New X" creation sheets.
 * Each create sheet (WO / Reservation / Payment / etc.) wraps its fields
 * with this and provides the form body + submit handler.
 */

export function CreateSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  size?: "md" | "lg";
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-[14px] border border-hairline bg-surface-1 shadow-xl focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "max-h-[92vh] w-full overflow-hidden",
            size === "lg" ? "max-w-[640px]" : "max-w-[520px]"
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-4">
            <div>
              <DialogPrimitive.Title className="display-tight text-[16px] font-semibold text-fg">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-0.5 text-[12px] text-fg-subtle">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="rounded-md p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>

          <div className="max-h-[60vh] overflow-y-auto px-5 py-4">{children}</div>

          <footer className="flex items-center justify-end gap-2 border-t border-hairline bg-surface-1 px-5 py-3">
            {footer}
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ── Reusable form atoms — keep create sheets visually consistent

export function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
        {required && <span className="text-status-danger">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-fg-tertiary">{hint}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none",
        props.className
      )}
    />
  );
}

export function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="number"
      inputMode="decimal"
      {...props}
      className={cn(
        "tabular h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-left text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none",
        props.className
      )}
    />
  );
}

export function Select({
  value,
  onChange,
  children,
  className,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cn(
        "h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
    >
      {children}
    </select>
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={3}
      {...props}
      className={cn(
        "block w-full resize-y rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[14px] leading-5 text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none",
        props.className
      )}
    />
  );
}
