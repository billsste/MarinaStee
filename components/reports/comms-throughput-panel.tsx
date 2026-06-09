"use client";

/*
 * Communications throughput — last 8 weeks, stacked bar by channel.
 *
 * Email / SMS / Voice stack vertically per week. Hovering a bar shows
 * delivered vs failed split via the native <title>. The stacked bar
 * doubles as a delivery-health signal: when "failed" creeps up week
 * over week the marina's provider config is drifting.
 */

import * as React from "react";
import { Megaphone } from "lucide-react";
import { anyApi } from "convex/server";
import { useStore } from "@/lib/client-store";
import { useTenantQuery } from "@/lib/use-tenant-query";

interface ChannelCounts {
  delivered: number;
  failed: number;
}
export interface CommsWeekRow {
  iso: string;
  label: string;
  email: ChannelCounts;
  sms: ChannelCounts;
  voice: ChannelCounts;
}
export interface CommsThroughputShape {
  weeks: CommsWeekRow[];
}

const EMPTY_ARGS = {} as const;
const DAY_MS = 86_400_000;

const CHANNEL_TONE = {
  email: "var(--primary)",
  sms: "var(--status-info)",
  voice: "#c084fc",
} as const;

export function CommsThroughputPanel() {
  const { communications } = useStore();

  const mock = React.useMemo<CommsThroughputShape>(() => {
    const now = new Date();
    const weeks: CommsWeekRow[] = [];
    for (let i = 7; i >= 0; i -= 1) {
      const weekStart = new Date(now.getTime() - i * 7 * DAY_MS);
      weeks.push({
        iso: weekStart.toISOString().slice(0, 10),
        label: weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        email: { delivered: 0, failed: 0 },
        sms: { delivered: 0, failed: 0 },
        voice: { delivered: 0, failed: 0 },
      });
    }
    const oldestMs = new Date(weeks[0].iso).getTime();

    for (const c of communications) {
      const sentMs = new Date(c.sent_at).getTime();
      if (sentMs < oldestMs) continue;
      const weekIdx = Math.min(7, Math.floor((sentMs - oldestMs) / (7 * DAY_MS)));
      const bucket = weeks[weekIdx];
      if (!bucket) continue;
      const channelKey = c.type === "email" ? "email" : c.type === "sms" ? "sms" : "voice";
      const isFail = c.status === "failed" || c.status === "bounced";
      if (isFail) bucket[channelKey].failed += 1;
      else bucket[channelKey].delivered += 1;
    }
    return { weeks };
  }, [communications]);

  const data = useTenantQuery<CommsThroughputShape>({
    mock,
    convexRef: anyApi.reports.commsThroughputWeekly,
    convexArgs: EMPTY_ARGS,
  });

  // Max stacked height (delivered + failed across all channels) drives
  // the y-axis. Avoid /0 by floor-clamping to 1.
  const max = Math.max(
    1,
    ...data.weeks.map(
      (w) =>
        w.email.delivered + w.email.failed + w.sms.delivered + w.sms.failed + w.voice.delivered + w.voice.failed,
    ),
  );
  const total = data.weeks.reduce(
    (s, w) =>
      s + w.email.delivered + w.email.failed + w.sms.delivered + w.sms.failed + w.voice.delivered + w.voice.failed,
    0,
  );
  const failedTotal = data.weeks.reduce(
    (s, w) => s + w.email.failed + w.sms.failed + w.voice.failed,
    0,
  );

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
          <Megaphone className="size-3.5" />
          Comms throughput · last 8 weeks
        </h3>
        <span className="text-[11px] text-fg-tertiary">
          {total} sent · {failedTotal} failed
        </span>
      </div>
      <div className="p-4">
        {total === 0 ? (
          <div className="rounded-[8px] border border-dashed border-hairline px-3 py-6 text-center text-[12px] text-fg-tertiary">
            No comms sent in the last 8 weeks.
          </div>
        ) : (
          <>
            <div className="flex h-32 items-end gap-2">
              {data.weeks.map((w) => {
                const wkTotal =
                  w.email.delivered + w.email.failed +
                  w.sms.delivered + w.sms.failed +
                  w.voice.delivered + w.voice.failed;
                const heightPct = (wkTotal / max) * 100;
                const titleStr =
                  `Week of ${w.label}\n` +
                  `Email: ${w.email.delivered} delivered, ${w.email.failed} failed\n` +
                  `SMS: ${w.sms.delivered} delivered, ${w.sms.failed} failed\n` +
                  `Voice: ${w.voice.delivered} delivered, ${w.voice.failed} failed`;
                return (
                  <div key={w.iso} className="flex flex-1 flex-col items-stretch justify-end" title={titleStr}>
                    <div
                      className="flex flex-col-reverse overflow-hidden rounded-sm transition-colors hover:opacity-90"
                      style={{ height: `${Math.max(2, heightPct)}%` }}
                    >
                      {(["email", "sms", "voice"] as const).map((ch) => {
                        const delivered = w[ch].delivered;
                        const failed = w[ch].failed;
                        const segTotal = delivered + failed;
                        if (segTotal === 0) return null;
                        const segHeightPct = wkTotal > 0 ? (segTotal / wkTotal) * 100 : 0;
                        return (
                          <div key={ch} className="flex flex-col" style={{ height: `${segHeightPct}%` }}>
                            {/* Failed sits on top of the delivered segment so it
                              reads as a danger overlay. */}
                            {failed > 0 && (
                              <div
                                className="bg-status-danger/70"
                                style={{ height: `${(failed / segTotal) * 100}%` }}
                              />
                            )}
                            {delivered > 0 && (
                              <div
                                style={{
                                  height: `${(delivered / segTotal) * 100}%`,
                                  backgroundColor: CHANNEL_TONE[ch],
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-fg-tertiary">
              {data.weeks.map((w) => (
                <span key={w.iso} className="flex-1 text-center">
                  {w.label}
                </span>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-fg-subtle">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-sm" style={{ background: CHANNEL_TONE.email }} />
                Email
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-sm" style={{ background: CHANNEL_TONE.sms }} />
                SMS
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-sm" style={{ background: CHANNEL_TONE.voice }} />
                Voice
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-sm bg-status-danger/70" />
                Failed overlay
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
