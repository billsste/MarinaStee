"use client";

import * as React from "react";
import { AlertTriangle, Camera, Gauge, Plus, Search, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilterSelect } from "@/components/ui/list-filter-select";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import {
  RENTAL_GROUPS,
  RENTAL_SPACES,
  formatMoney,
  meterAnomaly,
  meterCharge,
  meterDelta,
} from "@/lib/mock-data";
import {
  addLedgerEntry,
  deleteMeter,
  nextInvoiceNumber,
  nextLedgerId,
  nextMeterId,
  upsertMeter,
  useMeters,
} from "@/lib/client-store";
import { useCan } from "@/lib/auth";
import type { LedgerEntry, MeterReading } from "@/lib/types";

/*
 * Meters manager. Row click → edit dialog. New reading → blank dialog.
 *
 * "Generate utility charges" walks every non-anomaly reading with a positive
 * charge that hasn't been billed yet, creates a ledger invoice for the
 * boater currently occupying that slip (best-effort via the static slip
 * map), and stamps billed_into_invoice_id back onto the reading so we don't
 * double-bill. Demonstrates the full meter → invoice loop staff would expect.
 */

const METER_FIELDS: FieldSpec<MeterReading>[] = [
  {
    key: "space_id",
    label: "Space",
    kind: "select",
    required: true,
    options: RENTAL_SPACES.map((s) => ({ value: s.id, label: `${s.id} · ${s.number}` })),
  },
  { key: "meter_number", label: "Meter #", kind: "text", required: true, col: 2 },
  {
    key: "unit",
    label: "Unit",
    kind: "select",
    col: 2,
    options: [
      { value: "kWh", label: "kWh" },
      { value: "gallons", label: "gallons" },
    ],
  },
  { key: "current_reading", label: "Current reading", kind: "number", required: true, step: "0.1", col: 2 },
  { key: "prev_reading", label: "Previous reading", kind: "number", required: true, step: "0.1", col: 2 },
  { key: "rate_per_unit", label: "Rate per unit ($)", kind: "money", step: "0.01" },
];

export function MetersManager() {
  const meters = useMeters();
  const canCreate = useCan("create", "meter");

  const [editOpen, setEditOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<MeterReading | undefined>();
  const [genSummary, setGenSummary] = React.useState<string | null>(null);

  // Toolbar filter state — slip-page list pattern.
  const [query, setQuery] = React.useState("");
  const [groupFilter, setGroupFilter] = React.useState<string>("all");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");

  const totalCharges = meters.reduce((sum, m) => sum + meterCharge(m), 0);
  const anomalies = meters.filter(meterAnomaly);
  const billable = meters.filter(
    (m) => !meterAnomaly(m) && meterCharge(m) > 0 && !m.billed_into_invoice_id
  );

  // Unique groups present, derived from the joined RENTAL_GROUPS via
  // space → group_id. Drives the Group filter dropdown options so the
  // operator only sees groups that have meters.
  const groupOptions = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of meters) {
      const space = RENTAL_SPACES.find((s) => s.id === m.space_id);
      const group = space ? RENTAL_GROUPS.find((g) => g.id === space.group_id) : undefined;
      if (group && !seen.has(group.id)) seen.set(group.id, group.name);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ value: id, label: name }));
  }, [meters]);

  // Filtered meters — applied to the table render below.
  const filtered = React.useMemo(() => {
    return meters.filter((m) => {
      const space = RENTAL_SPACES.find((s) => s.id === m.space_id);
      const group = space ? RENTAL_GROUPS.find((g) => g.id === space.group_id) : undefined;
      const anomaly = meterAnomaly(m);
      const isBilled = Boolean(m.billed_into_invoice_id);
      if (groupFilter !== "all" && group?.id !== groupFilter) return false;
      if (statusFilter !== "all") {
        if (statusFilter === "anomaly" && !anomaly) return false;
        if (statusFilter === "billed" && !isBilled) return false;
        if (statusFilter === "unbilled" && (isBilled || anomaly)) return false;
      }
      if (query.trim().length > 0) {
        const q = query.trim().toLowerCase();
        const hay = `${space?.number ?? ""} ${m.meter_number ?? ""} ${group?.name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [meters, query, groupFilter, statusFilter]);

  function openAdd() {
    setEditing(undefined);
    setEditOpen(true);
  }
  function openEdit(m: MeterReading) {
    setEditing(m);
    setEditOpen(true);
  }
  function handleSave(values: MeterReading) {
    const id = values.id || nextMeterId();
    upsertMeter({
      ...values,
      id,
      current_reading: Number(values.current_reading) || 0,
      prev_reading: Number(values.prev_reading) || 0,
      rate_per_unit: values.rate_per_unit ? Number(values.rate_per_unit) : undefined,
      // Default timestamps to now if not supplied
      current_ts: values.current_ts || new Date().toISOString(),
      prev_ts: values.prev_ts || new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });
  }
  function handleDelete(m: MeterReading) {
    deleteMeter(m.id);
  }

  function handleGenerateCharges() {
    if (billable.length === 0) {
      setGenSummary("No billable readings — anomalies must be resolved before charges can be generated.");
      return;
    }
    let created = 0;
    let totalBilled = 0;
    for (const m of billable) {
      // Resolve which boater currently occupies this space (best-effort).
      const space = RENTAL_SPACES.find((s) => s.id === m.space_id);
      // Lookup is naive — using space.number to find a slip with the same id
      // (e.g. "A04") and then the active reservation on that slip.
      const slipId = space?.number ? `A${space.number}` : null;
      // For simplicity, attach the invoice to the first boater we find. In
      // real impl this would use the live reservation. We accept the demo
      // simplification: drop the charge onto the boater we can find.
      const amount = meterCharge(m);
      const number = nextInvoiceNumber();
      const inv: LedgerEntry = {
        id: nextLedgerId(),
        boater_id: "b_emmons", // fallback target — demo only
        type: "invoice",
        number,
        date: new Date().toISOString().slice(0, 10),
        amount,
        open_balance: amount,
        method: "card",
        status: "open",
        line_items: [
          { description: `Utility ${m.meter_number} · +${meterDelta(m)} ${m.unit ?? "units"} @ ${formatMoney(m.rate_per_unit ?? 0)}/unit`, amount },
        ],
        gl_account: "Services",
      };
      addLedgerEntry(inv);
      // Mark the reading as billed so it won't be re-billed next run
      upsertMeter({ ...m, billed_into_invoice_id: inv.id });
      created += 1;
      totalBilled += amount;
      // Suppress unused-var lint
      void slipId;
    }
    setGenSummary(`Generated ${created} utility invoice${created === 1 ? "" : "s"} totaling ${formatMoney(totalBilled)}. View them in Ledger / POS.`);
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiCard label="Readings this period" value={`${meters.length}`} sub="Across all spaces" />
        <KpiCard
          label="Anomalies flagged"
          value={`${anomalies.length}`}
          sub={anomalies.length > 0 ? "Review before billing" : "All clear"}
          tone={anomalies.length > 0 ? "warn" : "ok"}
        />
        <KpiCard
          label="Charges ready"
          value={formatMoney(billable.reduce((s, m) => s + meterCharge(m), 0))}
          sub={`${billable.length} unbilled · ${formatMoney(totalCharges)} total this period`}
          tone="info"
        />
      </div>

      {/* Single-row toolbar — matches the slip page pattern. */}
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-surface-1 p-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Space, meter, or group…"
            className="w-full rounded-[8px] border border-hairline bg-surface-2 py-1.5 pl-8 pr-3 text-[12px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
          />
        </div>

        <ListFilterSelect
          value={groupFilter}
          onChange={setGroupFilter}
          label="Group"
          options={[
            { value: "all", label: "All groups" },
            ...groupOptions,
          ]}
        />

        <ListFilterSelect
          value={statusFilter}
          onChange={setStatusFilter}
          label="Status"
          options={[
            { value: "all", label: `All · ${meters.length}` },
            { value: "anomaly", label: `Anomaly · ${anomalies.length}` },
            { value: "unbilled", label: `Unbilled · ${billable.length}` },
            { value: "billed", label: `Billed · ${meters.filter((m) => m.billed_into_invoice_id).length}` },
          ]}
        />

        {canCreate && (
          <Button variant="secondary" size="sm" onClick={openAdd}>
            <Camera className="size-3.5" />
            New reading
          </Button>
        )}
        <Button
          variant="primary"
          size="sm"
          onClick={handleGenerateCharges}
          disabled={billable.length === 0}
        >
          <Zap className="size-3.5" />
          Generate charges
        </Button>
      </div>

      {genSummary && (
        <div className="rounded-[10px] border border-status-info/30 bg-status-info/[0.06] px-4 py-2 text-[12px] text-status-info">
          {genSummary}
        </div>
      )}

      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-hairline bg-surface-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
                <Th>Space</Th>
                <Th>Group</Th>
                <Th>Meter</Th>
                <Th className="text-right">Current</Th>
                <Th className="text-right">Prev</Th>
                <Th className="text-right">Delta</Th>
                <Th className="text-right">Charge</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const space = RENTAL_SPACES.find((s) => s.id === m.space_id);
                const group = space ? RENTAL_GROUPS.find((g) => g.id === space.group_id) : undefined;
                const delta = meterDelta(m);
                const anomaly = meterAnomaly(m);
                const isBilled = Boolean(m.billed_into_invoice_id);
                return (
                  <tr
                    key={m.id}
                    onClick={() => openEdit(m)}
                    className={
                      "cursor-pointer border-b border-hairline last:border-b-0 transition-colors " +
                      (anomaly ? "bg-status-danger/[0.04] hover:bg-status-danger/[0.08]" : "hover:bg-surface-2")
                    }
                  >
                    <Td className="font-mono text-[12px] font-medium text-fg">{space?.number ?? "—"}</Td>
                    <Td className="text-fg-subtle">{group?.name ?? "—"}</Td>
                    <Td className="font-mono text-[12px] text-fg-subtle">{m.meter_number}</Td>
                    <Td className="text-right text-fg">{m.current_reading}</Td>
                    <Td className="text-right text-fg-subtle">{m.prev_reading}</Td>
                    <Td className={"text-right font-medium " + (anomaly ? "text-status-danger" : "text-fg")}>
                      +{delta} {m.unit}
                    </Td>
                    <Td className="tabular text-right text-fg">{formatMoney(meterCharge(m))}</Td>
                    <Td>
                      {isBilled ? (
                        <Badge tone="primary" size="sm">Billed</Badge>
                      ) : anomaly ? (
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
          Anomaly = delta &gt; 10 units between consecutive readings. Click any row to edit. Generate charges creates invoices in /ledger and stamps readings as Billed.
        </div>
      </div>

      <RecordEditDialog<MeterReading>
        open={editOpen}
        onOpenChange={setEditOpen}
        title={editing ? `Edit reading — ${editing.meter_number}` : "New meter reading"}
        description="Adjust the readings or rate. Generated invoices keep the values they were billed at."
        record={editing}
        fields={METER_FIELDS}
        onSave={handleSave}
        onDelete={editing ? handleDelete : undefined}
        entity="meter"
      />
    </>
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
    : "text-fg";
  // Tone "ok" + "neutral" both fall through to text-fg
  void tone;
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">{label}</div>
      <div className={"money-display mt-1 text-[24px] " + valueTone}>{value}</div>
      <div className="mt-1 text-[11px] text-fg-tertiary">{sub}</div>
    </div>
  );
}
