import { Zap, Droplets, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import {
  RENTAL_GROUPS,
  RENTAL_SPACES,
  formatInches,
} from "@/lib/mock-data";
import type { SpaceStatus } from "@/lib/types";

export const metadata = { title: "Spaces — Marina Stee Rentals" };

const STATUS_TONE: Record<SpaceStatus, "ok" | "warn" | "danger" | "neutral"> = {
  vacant: "ok",
  occupied: "danger",
  reserved: "warn",
  out_of_service: "neutral",
};

export default function SpacesPage() {
  return (
    <div className="space-y-5">
      <RentalsAsk
        placeholder="Ask about spaces — e.g. 'show me all 32-foot vacant slips with pump-out'"
        suggestions={[
          "Vacant > 30ft with power",
          "Out-of-service spaces",
          "Move David Emmons to A18",
        ]}
      />

      <div className="space-y-3">
        {RENTAL_GROUPS.map((g) => {
          const spaces = RENTAL_SPACES.filter((s) => s.group_id === g.id);
          if (spaces.length === 0) return null;
          return (
            <details key={g.id} className="group rounded-[12px] border border-hairline bg-surface-1" open={g.id === "rg_dsm_a"}>
              <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <div>
                  <h3 className="text-[14px] font-medium text-fg">{g.name}</h3>
                  <p className="text-[11px] text-fg-tertiary">
                    {g.occupied_spaces} of {g.total_spaces} occupied · {g.type.replace("_", " ")}
                  </p>
                </div>
                <div className="text-[11px] text-fg-tertiary">
                  {spaces.length} space{spaces.length === 1 ? "" : "s"} loaded
                </div>
              </summary>
              <div className="overflow-x-auto border-t border-hairline">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-hairline text-[11px] uppercase tracking-wide text-fg-tertiary">
                      <Th>#</Th>
                      <Th>Type</Th>
                      <Th>Length</Th>
                      <Th>Beam</Th>
                      <Th>Utilities</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {spaces.map((s) => (
                      <tr key={s.id} className="border-b border-hairline last:border-b-0 hover:bg-surface-2">
                        <Td className="font-mono text-[12px] font-medium text-fg">{s.number}</Td>
                        <Td className="text-fg-subtle">{s.occupancy_type}</Td>
                        <Td>{formatInches(s.length_inches)}</Td>
                        <Td>{formatInches(s.beam_inches)}</Td>
                        <Td>
                          <div className="flex items-center gap-1.5 text-fg-subtle">
                            <span className={s.has_power ? "text-status-info" : "text-fg-tertiary/50"} title="Power">
                              <Zap className="size-3.5" />
                            </span>
                            <span className={s.has_water ? "text-status-info" : "text-fg-tertiary/50"} title="Water">
                              <Droplets className="size-3.5" />
                            </span>
                            <span className={s.has_pump_out ? "text-status-info" : "text-fg-tertiary/50"} title="Pump-out">
                              <Trash2 className="size-3.5" />
                            </span>
                          </div>
                        </Td>
                        <Td>
                          <Badge tone={STATUS_TONE[s.status]} size="sm">
                            {s.status.replace("_", " ")}
                          </Badge>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2 text-left font-medium">{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={"px-4 py-2 align-middle " + (className ?? "")}>{children}</td>;
}
