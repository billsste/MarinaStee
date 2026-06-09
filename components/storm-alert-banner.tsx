"use client";

import * as React from "react";
import { AlertTriangle, CloudLightning, Wind, X } from "lucide-react";
import {
  acknowledgeStormAlert,
  useActiveStormAlerts,
} from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { StormAlert } from "@/lib/types";

/*
 * Marine-safety banner — wraps the operator app shell + the /dock PWA.
 *
 * Why a marina-native feature: no incumbent (Dockwa, Molo, Marinaware)
 * has surfaced weather-driven operational guidance inside the operator
 * UI. Marina owners get NWS alerts on their phone; staff on the dock
 * get them on a separate text thread; the agent has no idea anything's
 * happening. This component closes the loop so EVERY operator surface
 * carries the safety signal until acknowledged.
 *
 * Visual rules:
 *  - severity drives color via the design tokens (--status-info / warn /
 *    danger) — same palette the operator already reads as signal
 *  - headline is bold + always visible; body line is shown one click in
 *    (or always, when there's room)
 *  - dismiss is per-session, NOT permanent — marina ownership of the
 *    "did I see this storm?" question outweighs "stop annoying me"
 *  - never mounts on /apply, /portal, /onboard, /coi-upload, /sign
 *    (public surfaces) — handled by the caller (app-shell + dock-shell
 *    already gate on isPublic)
 *
 * The Convex production version will surface alerts created by a cron
 * scraping NWS + OpenWeather; the agent can also mint one via the
 * `create_storm_alert` action (deferred — TODO).
 */
export function StormAlertBanner({
  className,
}: {
  className?: string;
}) {
  const alerts = useActiveStormAlerts();
  if (alerts.length === 0) return null;

  // Pick the most severe active alert if multiple are present.
  // Severity tiebreak: danger > warn > info; within a tier, the
  // earlier `issued_at` wins so a still-active hurricane warning
  // doesn't get displaced by a later thunderstorm watch.
  const sorted = [...alerts].sort((a, b) => {
    const rank = (s: StormAlert["severity"]) =>
      s === "danger" ? 0 : s === "warn" ? 1 : 2;
    const d = rank(a.severity) - rank(b.severity);
    if (d !== 0) return d;
    return new Date(a.issued_at).getTime() - new Date(b.issued_at).getTime();
  });
  const alert = sorted[0];

  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 border-b px-5 py-2.5",
        alert.severity === "danger"
          ? "border-status-danger/30 bg-status-danger/10 text-status-danger"
          : alert.severity === "warn"
            ? "border-status-warn/30 bg-status-warn/10 text-status-warn"
            : "border-status-info/30 bg-status-info/10 text-status-info",
        className,
      )}
    >
      <span aria-hidden className="mt-[1px] shrink-0">
        <SeverityIcon kind={alert.kind} severity={alert.severity} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-[13px]">
          <span className="font-semibold">{alert.headline}</span>
          <span className="text-[11px] uppercase tracking-wider opacity-70">
            {sourceLabel(alert.source)}
          </span>
        </div>
        <div className="mt-0.5 max-w-[80ch] text-[12.5px] leading-relaxed text-fg-muted">
          {alert.body}
        </div>
      </div>
      <button
        type="button"
        onClick={() => acknowledgeStormAlert(alert.id)}
        aria-label="Acknowledge alert"
        title="Acknowledge — hides this banner for the rest of the session"
        className="ml-2 mt-[1px] shrink-0 rounded-[6px] p-1 transition-colors hover:bg-fg/10"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

function SeverityIcon({
  kind,
  severity,
}: {
  kind: StormAlert["kind"];
  severity: StormAlert["severity"];
}) {
  // Severity is the loudest signal; kind picks the right glyph
  // within that signal. Triage:
  //   thunderstorm / lightning → cloud-lightning
  //   high_wind / storm / hurricane → wind
  //   everything else → triangle warning (the universal "pay
  //   attention" symbol — same one operators already see on
  //   work-orders flagged red)
  if (kind === "thunderstorm" || kind === "lightning") {
    return <CloudLightning className="size-4" />;
  }
  if (kind === "high_wind" || kind === "storm" || kind === "hurricane") {
    return <Wind className="size-4" />;
  }
  void severity;
  return <AlertTriangle className="size-4" />;
}

function sourceLabel(source: StormAlert["source"]): string {
  switch (source) {
    case "nws":
      return "NWS";
    case "openweather":
      return "OpenWeather";
    case "agent":
      return "Agent";
    case "operator":
      return "Marina";
    default:
      return source;
  }
}
