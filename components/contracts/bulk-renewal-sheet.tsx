"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { CreateSheet, Field, NumberInput, Select } from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BOATERS, SLIPS, formatMoney } from "@/lib/mock-data";
import {
  bulkAddContracts,
  nextContractId,
  nextContractNumber,
  useContracts,
} from "@/lib/client-store";
import type { Contract } from "@/lib/types";

/*
 * Bulk renewal sheet — the centerpiece of the annual cycle.
 *
 * Operator picks target season year + a rate lift % + a scope filter, and
 * Marina Stee drafts ONE successor contract per matching active contract.
 * Each draft inherits the same boater + vessel + slip + cadence; only the
 * effective dates shift forward and the annual_rate gets the lift applied.
 *
 * No agent approval needed — this is a deliberate operator action with an
 * explicit recipient count preview.
 */
export function BulkRenewalSheet({
  open,
  onOpenChange,
  defaultExpiryYear,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  defaultExpiryYear: number;
}) {
  const contracts = useContracts();

  const [targetYear, setTargetYear] = React.useState(defaultExpiryYear + 1);
  const [rateLiftPct, setRateLiftPct] = React.useState("5");
  const [dockScope, setDockScope] = React.useState("all");
  const [cadenceScope, setCadenceScope] = React.useState<"all" | "annual" | "seasonal">("all");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setTargetYear(defaultExpiryYear + 1);
      setRateLiftPct("5");
      setDockScope("all");
      setCadenceScope("all");
      setSubmitting(false);
    }
  }, [open, defaultExpiryYear]);

  const docks = React.useMemo(() => Array.from(new Set(SLIPS.map((s) => s.dock))).sort(), []);

  // What's in scope? Active contracts whose effective_end year matches the
  // year we're renewing FROM (defaultExpiryYear).
  const scope = React.useMemo(() => {
    return contracts.filter((c) => {
      if (c.status !== "active") return false;
      const endYear = new Date(c.effective_end).getFullYear();
      if (endYear !== defaultExpiryYear) return false;
      // Don't double-draft: skip if a successor already exists for this slip
      // with effective_end in the target year.
      const hasSuccessor = contracts.some(
        (other) =>
          other.id !== c.id &&
          other.slip_id === c.slip_id &&
          new Date(other.effective_end).getFullYear() === targetYear
      );
      if (hasSuccessor) return false;
      // Dock filter (resolves through SLIPS)
      if (dockScope !== "all") {
        const slip = c.slip_id ? SLIPS.find((s) => s.id === c.slip_id) : undefined;
        if (slip?.dock !== dockScope) return false;
      }
      // Cadence filter — boater's billing_cadence
      if (cadenceScope !== "all") {
        const boater = BOATERS.find((b) => b.id === c.boater_id);
        const cad = boater?.billing_cadence;
        if (cadenceScope === "annual" && cad !== "annual" && cad !== "monthly") return false;
        if (cadenceScope === "seasonal" && cad !== "seasonal") return false;
      }
      return true;
    });
  }, [contracts, defaultExpiryYear, targetYear, dockScope, cadenceScope]);

  const lift = (Number(rateLiftPct) || 0) / 100;
  const projectedARRDelta = scope.reduce(
    (s, c) => s + (c.annual_rate ?? 0) * lift,
    0
  );

  const canSubmit = scope.length > 0 && !submitting;

  function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    const successors: Contract[] = scope.map((c) => {
      const newRate = Math.round((c.annual_rate ?? 0) * (1 + lift));
      const startDate = `${targetYear - 1}-04-01`;
      const endDate = `${targetYear}-03-31`;
      return {
        id: nextContractId(),
        number: nextContractNumber(),
        boater_id: c.boater_id,
        template_id: c.template_id,
        template_version: c.template_version,
        vessel_id: c.vessel_id,
        slip_id: c.slip_id,
        status: "draft",
        effective_start: startDate,
        effective_end: endDate,
        annual_rate: newRate,
        billing_cadence: c.billing_cadence,
      };
    });
    setTimeout(() => {
      bulkAddContracts(successors);
      onOpenChange(false);
    }, 350);
  }

  return (
    <CreateSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Draft ${targetYear} renewals`}
      description="Generates one successor contract per matching active contract. Each draft inherits holder, vessel, slip, and cadence — only the term shifts and the annual rate gets the lift applied."
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            <Sparkles className="size-3.5" />
            {submitting
              ? "Drafting…"
              : `Draft ${scope.length} renewal${scope.length === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target season year" required hint="The year the new contracts will END.">
            <NumberInput
              value={String(targetYear)}
              onChange={(e) => setTargetYear(Number(e.target.value) || targetYear)}
              min={defaultExpiryYear}
              max={defaultExpiryYear + 5}
            />
          </Field>
          <Field label="Rate lift %" required hint="Applied to current annual_rate.">
            <NumberInput
              value={rateLiftPct}
              onChange={(e) => setRateLiftPct(e.target.value)}
              step="0.5"
              min="-25"
              max="50"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Dock scope">
            <Select value={dockScope} onChange={setDockScope}>
              <option value="all">All docks</option>
              {docks.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cadence scope">
            <Select value={cadenceScope} onChange={(v) => setCadenceScope(v as typeof cadenceScope)}>
              <option value="all">All cadences</option>
              <option value="annual">Annual / Monthly</option>
              <option value="seasonal">Seasonal</option>
            </Select>
          </Field>
        </div>

        <div className="rounded-[12px] border border-hairline bg-surface-2 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-fg-tertiary">
              Preview
            </span>
            <Badge tone={scope.length > 0 ? "primary" : "warn"} size="sm">
              {scope.length} renewal{scope.length === 1 ? "" : "s"}
            </Badge>
          </div>
          {scope.length === 0 ? (
            <p className="text-[12px] text-status-warn">
              No matching contracts. Either nothing's expiring in {defaultExpiryYear} that fits, or successors already exist.
            </p>
          ) : (
            <>
              <p className="text-[12px] text-fg-subtle">
                {scope.slice(0, 4).map((c) => {
                  const b = BOATERS.find((x) => x.id === c.boater_id);
                  return b?.last_name ?? c.number;
                }).join(", ")}
                {scope.length > 4 ? ` and ${scope.length - 4} more.` : "."}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-3 text-[11px]">
                <Stat
                  label="Current ARR"
                  value={formatMoney(scope.reduce((s, c) => s + (c.annual_rate ?? 0), 0))}
                />
                <Stat
                  label={`+${rateLiftPct}% lift`}
                  value={`+${formatMoney(projectedARRDelta)}`}
                  tone="ok"
                />
                <Stat
                  label={`Projected ${targetYear} ARR`}
                  value={formatMoney(
                    scope.reduce((s, c) => s + (c.annual_rate ?? 0) * (1 + lift), 0)
                  )}
                />
              </div>
            </>
          )}
        </div>

        <p className="text-[11px] text-fg-tertiary">
          Drafts are created in <code>status: "draft"</code>. Send for signature from the
          renewal-pipeline view, individually or in bulk.
        </p>
      </div>
    </CreateSheet>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">{label}</div>
      <div
        className={
          "tabular text-[13px] font-medium " +
          (tone === "ok" ? "text-status-ok" : "text-fg")
        }
      >
        {value}
      </div>
    </div>
  );
}
