"use client";

import * as React from "react";
import { AlertTriangle, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LocalTime } from "@/components/ui/local-time";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import { useFuelInventory, upsertFuelInventory } from "@/lib/client-store";
import { formatMoney, fuelMargin, fuelPct } from "@/lib/mock-data";
import type { FuelInventory } from "@/lib/types";

/*
 * Editable fuel tank cards. Click a card → opens RecordEditDialog with
 * price/gal, cost/gal, tank capacity, current level, reorder threshold.
 * Mutations flow through the store so the page recomputes margins live.
 */

const FUEL_FIELDS: FieldSpec<FuelInventory>[] = [
  {
    key: "fuel_type",
    label: "Fuel type",
    kind: "select",
    required: true,
    col: 2,
    options: [
      { value: "gasoline", label: "Gasoline" },
      { value: "diesel", label: "Diesel" },
    ],
  },
  { key: "current_price_per_gallon", label: "Price / gallon ($)", kind: "money", col: 2, step: "0.01", required: true },
  { key: "cost_per_gallon", label: "Cost / gallon ($)", kind: "money", col: 2, step: "0.01", required: true },
  { key: "tank_capacity_gallons", label: "Tank capacity (gal)", kind: "number", col: 2, required: true },
  { key: "current_level_gallons", label: "Current level (gal)", kind: "number", col: 2, required: true },
  { key: "reorder_threshold_pct", label: "Reorder threshold (%)", kind: "number", col: 2 },
];

export function FuelTanks() {
  const inventory = useFuelInventory();
  const [editing, setEditing] = React.useState<FuelInventory | undefined>();
  const [open, setOpen] = React.useState(false);

  function openEdit(inv: FuelInventory) {
    setEditing(inv);
    setOpen(true);
  }

  function handleSave(values: FuelInventory) {
    upsertFuelInventory({
      ...values,
      current_price_per_gallon: Number(values.current_price_per_gallon) || 0,
      cost_per_gallon: Number(values.cost_per_gallon) || 0,
      tank_capacity_gallons: Number(values.tank_capacity_gallons) || 0,
      current_level_gallons: Number(values.current_level_gallons) || 0,
      reorder_threshold_pct: Number(values.reorder_threshold_pct) || 25,
      last_updated_at: new Date().toISOString(),
    });
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {inventory.map((inv) => (
          <TankCard key={inv.id} inv={inv} onEdit={() => openEdit(inv)} />
        ))}
      </div>

      <RecordEditDialog<FuelInventory>
        open={open}
        onOpenChange={setOpen}
        title={editing ? `Edit fuel — ${editing.fuel_type}` : "New fuel tank"}
        description="Price and tank level update live. Margin auto-recalculates."
        record={editing}
        fields={FUEL_FIELDS}
        onSave={handleSave}
        entity="gas"
      />
    </>
  );
}

function TankCard({ inv, onEdit }: { inv: FuelInventory; onEdit: () => void }) {
  const pct = fuelPct(inv);
  const margin = fuelMargin(inv);
  const lowFuel = pct <= inv.reorder_threshold_pct;
  const barTone = lowFuel ? "bg-status-danger" : pct < 50 ? "bg-status-warn" : "bg-status-ok";

  return (
    <button
      type="button"
      onClick={onEdit}
      className="group rounded-[12px] border border-hairline bg-surface-1 p-5 text-left transition-colors hover:border-hairline-strong hover:bg-surface-2"
    >
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="flex items-center gap-1.5 text-[15px] font-medium capitalize text-fg">
            {inv.fuel_type}
            <Pencil className="size-3 text-fg-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
          </h3>
          <p className="text-[11px] text-fg-tertiary">
            Last updated <LocalTime iso={inv.last_updated_at} fmt="datetime" />
          </p>
        </div>
        {lowFuel && (
          <Badge tone="danger">
            <AlertTriangle className="size-3" />
            Reorder
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">Price / gal</div>
          <div className="money-display text-[22px] text-fg">
            {formatMoney(inv.current_price_per_gallon)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">Cost / gal</div>
          <div className="money-display text-[22px] text-fg-subtle">
            {formatMoney(inv.cost_per_gallon)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">Margin</div>
          <div className="money-display text-[22px] text-status-ok">
            {formatMoney(margin)}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-[11px] text-fg-subtle">
          <span>Tank level</span>
          <span>
            {inv.current_level_gallons.toLocaleString()} / {inv.tank_capacity_gallons.toLocaleString()} gal
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-3">
          <div className={"h-full transition-all " + barTone} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-fg-tertiary">
          <span>{Math.round(pct)}%</span>
          <span>Reorder at {inv.reorder_threshold_pct}%</span>
        </div>
      </div>
    </button>
  );
}
