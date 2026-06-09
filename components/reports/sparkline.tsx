"use client";

/*
 * Sparkline — minimal inline SVG trend visual for the analytics panels.
 *
 * Design rules:
 *   - No external chart library — pure SVG polyline + a single dot at
 *     the last sample so the eye lands on the most-recent value.
 *   - Width / height default to 80x24 so the component sits inline next
 *     to a label cell (fleet-utilization table rows, KPI strips).
 *   - Tone is a string — caller passes a CSS color (`var(--primary)`,
 *     `var(--status-warn)`, etc.) so the sparkline picks up the surface
 *     palette automatically. Defaults to `var(--primary)`.
 *   - Empty / single-sample data degrades gracefully: a flat baseline
 *     centered in the bounding box, no crash, no NaN coordinates.
 *
 * This is deliberately not a "real" chart — there's no axis, no tooltip,
 * no animation. It's a visual gist. Hover wiring is a follow-up wave.
 */

import * as React from "react";

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  /** Stroke color — accepts any CSS color, defaults to `var(--primary)`. */
  tone?: string;
  /** Tooltip text on the wrapping <title> — optional. */
  title?: string;
  className?: string;
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  tone = "var(--primary)",
  title,
  className,
}: SparklineProps) {
  const points = React.useMemo(() => {
    const n = data.length;
    if (n === 0) {
      // Flat baseline centered — gives the eye a "no data" feel
      // without a hard-edged null state.
      return [{ x: 0, y: height / 2 }, { x: width, y: height / 2 }];
    }
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1; // avoid /0 for flat series
    // Pad 1px top/bottom so the stroke + dot don't get clipped at edges.
    const padY = 2;
    const usableH = height - padY * 2;
    const stepX = n === 1 ? 0 : width / (n - 1);
    return data.map((v, i) => ({
      x: n === 1 ? width / 2 : i * stepX,
      // Invert Y — SVG origin is top-left, but bigger numbers should
      // be higher on the chart.
      y: padY + usableH - ((v - min) / range) * usableH,
    }));
  }, [data, width, height]);

  const polyline = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      preserveAspectRatio="none"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      <polyline
        points={polyline}
        fill="none"
        stroke={tone}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {data.length > 0 ? (
        <circle cx={last.x} cy={last.y} r={1.8} fill={tone} />
      ) : null}
    </svg>
  );
}
