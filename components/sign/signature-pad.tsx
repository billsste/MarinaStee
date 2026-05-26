"use client";

import * as React from "react";
import { Eraser } from "lucide-react";

/*
 * Reusable signature pad — promoted from sign-experience.tsx so the
 * /onboard/[token] contract flow and /sign/[token] quote flow share
 * one canvas implementation. High-DPI canvas, pointer events for
 * mouse + trackpad + touch, auto-sign by typing the name + clicking
 * the cursive autoshim.
 *
 * Consumers pass `canvasRef` so they can grab the PNG dataURL via
 * `capturePadDataUrl(canvasRef.current)` at submit time.
 */
export function SignaturePad({
  canvasRef,
  hasSignature,
  onChange,
  signerName,
  height = 140,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  hasSignature: boolean;
  onChange: (b: boolean) => void;
  signerName: string;
  height?: number;
}) {
  const drawing = React.useRef(false);
  const last = React.useRef<{ x: number; y: number } | null>(null);

  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const rect = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = getComputedStyle(c).getPropertyValue("color");
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, [canvasRef]);

  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    if (hasSignature && !drawing.current && !last.current && signerName.trim()) {
      const rect = c.getBoundingClientRect();
      ctx.font = "italic 32px 'Segoe Script', 'Bradley Hand', cursive";
      ctx.fillStyle = getComputedStyle(c).getPropertyValue("color");
      ctx.fillText(signerName, 20, rect.height / 2 + 12);
    }
  }, [hasSignature, signerName, canvasRef]);

  function pointer(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    last.current = pointer(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx || !last.current) return;
    const p = pointer(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasSignature) onChange(true);
  }

  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = false;
    last.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function clear() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    onChange(false);
  }

  return (
    <div>
      <div className="relative rounded-[8px] border border-hairline bg-surface-2">
        <canvas
          ref={canvasRef}
          className="block w-full touch-none rounded-[8px] text-fg"
          style={{ height: `${height}px` }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
        {!hasSignature && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] italic text-fg-tertiary">
            Draw your signature here
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-fg-tertiary">
          Sign with mouse, trackpad, or finger
        </span>
        {hasSignature && (
          <button
            type="button"
            onClick={clear}
            className="inline-flex items-center gap-1 text-[11px] text-fg-subtle hover:text-fg"
          >
            <Eraser className="size-3" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Snapshot a SignaturePad's canvas via its ref.
 */
export function capturePadDataUrl(canvas: HTMLCanvasElement | null): string {
  if (!canvas) return "";
  return canvas.toDataURL("image/png");
}
