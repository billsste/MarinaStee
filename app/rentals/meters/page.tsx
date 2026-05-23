import { AlertTriangle, Camera, Gauge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import {
  METER_READINGS,
  RENTAL_GROUPS,
  RENTAL_SPACES,
  formatMoney,
  meterAnomaly,
  meterCharge,
  meterDelta,
} from "@/lib/mock-data";

export const metadata = { title: "Meter Readings — Marina Stee Rentals" };

export default function MetersPage() {
  const totalCharges = METER_READINGS.reduce((sum, m) => sum + meterCharge(m), 0);
  const anomalies = METER_READINGS.filter(meterAnomaly);

  return (
    <div className="space-y-5">
      <RentalsAsk
        placeholder="Ask about meters — e.g. 'generate utility charges for May readings'"
        suggestions={[
          "Generate utility charges for May",
          "Why is pedestal A04 high?",
          "Schedule a meter walk for Damsite C",
        ]}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiCard label="Readings this period" value={`${METER_READINGS.length}`} sub="Across all spaces" />
        <KpiCard label="Anomalies flagged" value={`${anomalies.length}`} sub={anomalies.length > 0 ? "Review before billing" : "All clear"} tone={anomalies.length > 0 ? "warn" : "ok"} />
        <KpiCard label="Charges ready" value={formatMoney(totalCharges)} sub="Sum of deltas × rate" tone="info" />
      </div>

      <div className="rounded-[12px] border border-hairline bg-surface-1">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
          <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
            <Gauge className="size-3.5 text-fg-subtle" />
            Meter readings
          </h3>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm">
              <Camera className="size-3.5" />
              New reading
            </Button>
            <Button variant="primary" size="sm">Generate utility charges</Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-hairline text-[11px] uppercase tracking-wide text-fg-tertiary">
                <Th>Group</Th>
                <Th>Space</Th>
                <Th>Meter</Th>
                <Th className="text-right">Current</Th>
                <Th className="text-right">Prev</Th>
                <Th className="text-right">Delta</Th>
                <Th className="text-right">Charge</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {METER_READINGS.map((m) => {
                const space = RENTAL_SPACES.find((s) => s.id === m.space_id);
                const group = space ? RENTAL_GROUPS.find((g) => g.id === space.group_id) : undefined;
                const delta = meterDelta(m);
                const anomaly = meterAnomaly(m);
                return (
                  <tr
                    key={m.id}
                    className={
                      "border-b border-hairline last:border-b-0 " +
                      (anomaly ? "bg-status-danger/[0.04]" : "hover:bg-surface-2")
                    }
                  >
                    <Td className="text-fg-subtle">{group?.name ?? "—"}</Td>
                    <Td className="font-mono text-[12px] font-medium text-fg">{space?.number ?? "—"}</Td>
                    <Td className="font-mono text-[12px] text-fg-subtle">{m.meter_number}</Td>
                    <Td className="text-right text-fg">{m.current_reading}</Td>
                    <Td className="text-right text-fg-subtle">{m.prev_reading}</Td>
                    <Td className={"text-right font-medium " + (anomaly ? "text-status-danger" : "text-fg")}>
                      +{delta} {m.unit}
                    </Td>
                    <Td className="text-right text-fg">{formatMoney(meterCharge(m))}</Td>
                    <Td>
                      {anomaly ? (
                        <Badge tone="danger" size="sm">
                          <AlertTriangle className="size-3" />
                          Anomaly
                        </Badge>
                      ) : delta === 0 ? (
                        <Badge tone="neutral" size="sm">No use</Badge>
                      ) : (
                        <Badge tone="ok" size="sm">Normal</Badge>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-hairline px-4 py-2 text-[11px] text-fg-tertiary">
          Anomaly = delta &gt; 10 units between consecutive readings. Real impl would compute baseline per-space.
        </div>
      </div>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={"px-3 py-2 text-left font-medium " + (className ?? "")}>{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={"px-3 py-2 align-middle " + (className ?? "")}>{children}</td>;
}

function KpiCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "ok" | "warn" | "info" | "neutral";
}) {
  const valueTone =
    tone === "warn" ? "text-status-warn"
    : tone === "info" ? "text-fg"
    : tone === "ok" ? "text-fg"
    : "text-fg";
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">{label}</div>
      <div className={"mt-1 text-[20px] font-semibold tracking-tight " + valueTone}>{value}</div>
      <div className="mt-1 text-[11px] text-fg-tertiary">{sub}</div>
    </div>
  );
}
