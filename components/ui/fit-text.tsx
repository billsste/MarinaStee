"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Renders text that auto-shrinks its font-size to fit the parent's
 * available width — used when truncation isn't acceptable (e.g.
 * the sidebar tenant label, where the operator needs to see the
 * full marina name, not "Marina Stee — D…").
 *
 * How it works:
 *   1. Wrapping span is `block overflow-hidden` so we have a
 *      well-defined container width.
 *   2. Inner span is `inline-block whitespace-nowrap` at the
 *      starting font size.
 *   3. A layout effect measures inner.scrollWidth vs container
 *      .clientWidth and decrements the font-size until either
 *      the text fits OR we hit minPx.
 *   4. A ResizeObserver re-runs the fit pass if the container
 *      width changes (sidebar collapse/expand, viewport resize).
 *
 * Why not CSS clamp + container queries:
 *   The tenant label is one row in a tight header; container
 *   queries don't give per-character precision without picking
 *   arbitrary breakpoints. Measurement is exact and the cost is
 *   one read per resize.
 *
 * Why not scaleX transform:
 *   Distorts glyphs, looks cheap. Decrementing font-size keeps
 *   the type proper at every step.
 */
export function FitText({
  text,
  className,
  maxPx = 13,
  minPx = 9,
  step = 0.5,
}: {
  text: string;
  className?: string;
  /** Starting (preferred) font-size in px. */
  maxPx?: number;
  /** Floor — won't shrink below this. */
  minPx?: number;
  /** Decrement step. Smaller = smoother fit, more layout passes. */
  step?: number;
}) {
  const containerRef = React.useRef<HTMLSpanElement>(null);
  const innerRef = React.useRef<HTMLSpanElement>(null);
  const [fontPx, setFontPx] = React.useState(maxPx);

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;

    function fit() {
      // Re-pull refs inside the closure so React's useLayoutEffect
      // closure is stable for the ResizeObserver callback.
      const c = containerRef.current;
      const t = innerRef.current;
      if (!c || !t) return;

      // Reset to max and walk down. Bias toward fitting in one pass
      // by checking the obvious case first.
      let current = maxPx;
      t.style.fontSize = `${current}px`;
      // Guard against an infinite loop if the container has zero
      // width (initial paint, hidden parent). Fall back to maxPx.
      if (c.clientWidth === 0) {
        setFontPx(maxPx);
        return;
      }
      while (t.scrollWidth > c.clientWidth && current > minPx) {
        current = Math.max(minPx, current - step);
        t.style.fontSize = `${current}px`;
      }
      setFontPx(current);
    }

    fit();

    // Re-fit when the container width changes — sidebar collapse,
    // viewport resize, theme switch (font shift), etc.
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => ro.disconnect();
  }, [text, maxPx, minPx, step]);

  return (
    <span
      ref={containerRef}
      className={cn("block overflow-hidden leading-[1.2]", className)}
    >
      <span
        ref={innerRef}
        className="inline-block whitespace-nowrap"
        style={{ fontSize: `${fontPx}px` }}
      >
        {text}
      </span>
    </span>
  );
}
