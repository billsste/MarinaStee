import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-hairline bg-surface-2 text-fg-muted",
        primary: "border-primary/30 bg-primary-soft text-primary",
        ok: "border-status-ok/30 bg-status-ok/10 text-status-ok",
        warn: "border-status-warn/30 bg-status-warn/15 text-status-warn",
        danger: "border-status-danger/30 bg-status-danger/10 text-status-danger",
        info: "border-status-info/30 bg-status-info/10 text-status-info",
        outline: "border-hairline-strong bg-transparent text-fg-muted",
      },
      size: {
        sm: "h-[18px] px-1.5 text-[10px]",
        md: "h-[20px] px-2 text-[11px]",
      },
    },
    defaultVariants: { tone: "neutral", size: "md" },
  }
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}
