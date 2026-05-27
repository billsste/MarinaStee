"use client";

import * as React from "react";
import Link from "next/link";
import {
  Anchor,
  Sun,
  MoonStar,
  Fuel,
  Gauge,
  Wrench,
  AlertTriangle,
  Sparkles,
  CheckCircle2,
  Camera,
  ChevronRight,
  ArrowLeft,
  Sailboat,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  BOATERS,
  FUEL_INVENTORY,
  METER_READINGS,
  RENTAL_GROUPS,
  RENTAL_SPACES,
  formatMoney,
  getArrivalsForDate,
  getDeparturesForDate,
  initialsOf,
  meterAnomaly,
  meterDelta,
  rentalDurationLabel,
} from "@/lib/mock-data";
import {
  addCommunication,
  addLedgerEntry,
  addPosOrder,
  checkInReservation,
  checkOutReservation,
  closeBoatRental,
  nextInvoiceNumber,
  nextLedgerId,
  nextPosOrderId,
  nextPosOrderNumber,
  useBoatRentals,
  usePosLocations,
  useRentalBoats,
  useStore,
} from "@/lib/client-store";
import type {
  BoatRental,
  Communication,
  LedgerEntry,
  PosOrder,
  RentalBoat,
  Reservation,
} from "@/lib/types";

type View = "home" | "arrivals" | "departures" | "meter" | "fuel" | "returns" | "done";

export default function DockPage() {
  const [view, setView] = React.useState<View>("home");
  const [lastAction, setLastAction] = React.useState<string | null>(null);

  function onDone(message: string) {
    setLastAction(message);
    setView("done");
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-canvas">
      <Header view={view} onBack={() => setView("home")} />
      <main className="flex-1 px-4 pb-10 pt-2">
        {view === "home" && <Home onSelect={setView} />}
        {view === "arrivals" && <ArrivalsView onDone={onDone} />}
        {view === "departures" && <DeparturesView onDone={onDone} />}
        {view === "meter" && <MeterView onDone={onDone} />}
        {view === "fuel" && <FuelView onDone={onDone} />}
        {view === "returns" && <ReturnsView onDone={onDone} />}
        {view === "done" && <DoneView message={lastAction} onContinue={() => setView("home")} />}
      </main>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Header
// ────────────────────────────────────────────────────────────

function Header({ view, onBack }: { view: View; onBack: () => void }) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-hairline bg-surface-1/90 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-2">
        {view !== "home" && view !== "done" ? (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 text-[13px] text-fg-subtle hover:text-fg"
            aria-label="Back"
          >
            <ArrowLeft className="size-4" />
            Back
          </button>
        ) : (
          <>
            <div className="flex size-7 items-center justify-center rounded-[6px] bg-primary text-on-primary">
              <span className="text-[13px] font-semibold">M</span>
            </div>
            <div className="text-[13px]">
              <div className="font-medium text-fg">Marina Stee</div>
              <div className="text-[10px] text-fg-tertiary">Dock view · J. Reyes</div>
            </div>
          </>
        )}
      </div>
      <Link
        href="/"
        className="text-[11px] text-fg-tertiary hover:text-fg"
        aria-label="Switch to admin"
      >
        Admin ↗
      </Link>
    </header>
  );
}

// ────────────────────────────────────────────────────────────
// Home (task picker)
// ────────────────────────────────────────────────────────────

function Home({ onSelect }: { onSelect: (v: View) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const arrivals = getArrivalsForDate(today);
  const departures = getDeparturesForDate(today);
  const anomalies = METER_READINGS.filter(meterAnomaly);
  const gasInv = FUEL_INVENTORY.find((i) => i.fuel_type === "gasoline");
  const dieselInv = FUEL_INVENTORY.find((i) => i.fuel_type === "diesel");
  const rentalsOnWater = useBoatRentals().filter((r) => r.status === "checked_out");

  return (
    <div className="space-y-5 pt-5">
      <div className="space-y-1.5">
        <h1 className="display-tight text-[28px] font-semibold text-fg">
          What needs doing?
        </h1>
        <p className="text-[17px] leading-6 text-fg-subtle">
          Today&apos;s queue. Tap any tile to do it now.
        </p>
      </div>

      {anomalies.length > 0 && (
        <Link
          href="#"
          className="flex items-start gap-3 rounded-[12px] border border-status-danger/30 bg-status-danger/[0.06] p-3"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-danger" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-fg">
              {anomalies.length} meter anomal{anomalies.length === 1 ? "y" : "ies"} flagged
            </div>
            <div className="truncate text-[12px] text-fg-subtle">
              Pedestal {anomalies[0].meter_number} on slip A04 — +12 kWh in 4 days
            </div>
          </div>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Tile
          icon={<Sun className="size-5" />}
          label="Check in"
          count={arrivals.length}
          tone="ok"
          onClick={() => onSelect("arrivals")}
        />
        <Tile
          icon={<MoonStar className="size-5" />}
          label="Check out"
          count={departures.length}
          tone="warn"
          onClick={() => onSelect("departures")}
        />
        <Tile
          icon={<Gauge className="size-5" />}
          label="Log meter"
          count={METER_READINGS.length}
          tone="info"
          onClick={() => onSelect("meter")}
        />
        <Tile
          icon={<Fuel className="size-5" />}
          label="Fuel sale"
          sub={gasInv ? `Gas ${formatMoney(gasInv.current_price_per_gallon)}/gal` : undefined}
          tone="neutral"
          onClick={() => onSelect("fuel")}
        />
        <Tile
          icon={<Sailboat className="size-5" />}
          label="Rental return"
          count={rentalsOnWater.length}
          tone={rentalsOnWater.length > 0 ? "info" : "neutral"}
          onClick={() => onSelect("returns")}
        />
      </div>

      <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          <Fuel className="size-3" />
          Tank levels
        </div>
        <div className="grid grid-cols-2 gap-3">
          {gasInv && <TankRow label="Gasoline" pct={(gasInv.current_level_gallons / gasInv.tank_capacity_gallons) * 100} />}
          {dieselInv && <TankRow label="Diesel" pct={(dieselInv.current_level_gallons / dieselInv.tank_capacity_gallons) * 100} />}
        </div>
      </div>

      <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
        <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-fg-subtle">
          <Sparkles className="size-3 text-primary" />
          Ask the agent
        </div>
        <input
          type="text"
          placeholder="e.g. 'slip A29 needs pump-out' or 'storm coming'"
          className="w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2.5 text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
        />
      </div>
    </div>
  );
}

function Tile({
  icon,
  label,
  count,
  sub,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  sub?: string;
  tone: "ok" | "warn" | "info" | "neutral";
  onClick: () => void;
}) {
  const toneClass =
    tone === "ok" ? "border-status-ok/30 bg-status-ok/[0.06] text-status-ok"
    : tone === "warn" ? "border-status-warn/30 bg-status-warn/[0.06] text-status-warn"
    : tone === "info" ? "border-status-info/30 bg-status-info/[0.06] text-status-info"
    : "border-hairline bg-surface-1 text-fg-muted";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "tap-scale flex aspect-square flex-col items-start justify-between rounded-[18px] border p-5 transition-colors",
        toneClass
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-surface-1/80">
        {icon}
      </span>
      <div>
        <div className="display-tight text-[19px] font-semibold text-fg">{label}</div>
        {count !== undefined ? (
          <div className="mt-0.5 text-[13px] text-fg-subtle">{count} pending</div>
        ) : sub ? (
          <div className="mt-0.5 text-[13px] text-fg-subtle">{sub}</div>
        ) : null}
      </div>
    </button>
  );
}

function TankRow({ label, pct }: { label: string; pct: number }) {
  const bar = pct <= 25 ? "bg-status-danger" : pct < 50 ? "bg-status-warn" : "bg-status-ok";
  return (
    <div>
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-fg">{label}</span>
        <span className="font-medium text-fg-subtle">{Math.round(pct)}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className={"h-full " + bar} style={{ width: `${Math.max(2, Math.min(pct, 100))}%` }} />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Arrivals / Departures
// ────────────────────────────────────────────────────────────

function ArrivalsView({ onDone }: { onDone: (m: string) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const arrivals = getArrivalsForDate(today);
  return (
    <ListView
      title="Arrivals today"
      empty="No arrivals on the schedule for today."
      items={arrivals}
      cta="Check in"
      onAction={(r) => {
        const b = BOATERS.find((x) => x.id === r.boater_id);
        // Runs the full chain: posts a transient invoice (if applicable),
        // dispatches the arrival comm, flips reservation → occupied.
        const invoiceId = checkInReservation(r.id);
        onDone(
          invoiceId
            ? `${b?.first_name ?? "Boater"} checked in to slip ${r.slip_id}. Stay pre-billed + welcome comm sent.`
            : `${b?.first_name ?? "Boater"} checked in to slip ${r.slip_id}. Welcome comm sent.`
        );
      }}
    />
  );
}

function DeparturesView({ onDone }: { onDone: (m: string) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const departures = getDeparturesForDate(today);
  return (
    <ListView
      title="Departures today"
      empty="No departures scheduled."
      items={departures}
      cta="Check out"
      onAction={(r) => {
        const b = BOATERS.find((x) => x.id === r.boater_id);
        // Full chain: auto-charges the card on file (if any), dispatches
        // the receipt comm, flips → completed, fires waitlist for the
        // freed slip (transient only).
        const receiptId = checkOutReservation(r.id);
        onDone(
          receiptId
            ? `${b?.first_name ?? "Boater"} checked out from slip ${r.slip_id}. Card on file charged · receipt sent.`
            : `${b?.first_name ?? "Boater"} checked out from slip ${r.slip_id}. Final balance pending — no card on file.`
        );
      }}
    />
  );
}

function ListView({
  title,
  empty,
  items,
  cta,
  onAction,
}: {
  title: string;
  empty: string;
  items: Reservation[];
  cta: string;
  onAction: (r: Reservation) => void;
}) {
  return (
    <div className="space-y-3 pt-4">
      <h2 className="text-[20px] font-semibold tracking-tight text-fg">{title}</h2>
      {items.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-hairline px-4 py-10 text-center text-[13px] text-fg-tertiary">
          {empty}
        </p>
      ) : (
        items.map((r) => {
          const b = BOATERS.find((x) => x.id === r.boater_id);
          return (
            <div key={r.id} className="rounded-[12px] border border-hairline bg-surface-1 p-3">
              <div className="flex items-start gap-3">
                <Avatar className="size-10">
                  <AvatarFallback>{b ? initialsOf(b.display_name) : "??"}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-fg">{b?.display_name ?? "Unknown"}</div>
                  <div className="text-[11px] text-fg-subtle">
                    {r.number} · slip {r.slip_id} · {r.type}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onAction(r)}
                className="tap-scale pill mt-4 inline-flex h-12 w-full items-center justify-center gap-2 bg-primary text-[16px] font-semibold text-on-primary"
              >
                <CheckCircle2 className="size-4" />
                {cta}
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Meter reading
// ────────────────────────────────────────────────────────────

function MeterView({ onDone }: { onDone: (m: string) => void }) {
  const [spaceId, setSpaceId] = React.useState<string>("");
  const [reading, setReading] = React.useState<string>("");

  const space = RENTAL_SPACES.find((s) => s.id === spaceId);
  const last = METER_READINGS.find((m) => m.space_id === spaceId);
  const numReading = Number(reading);
  const delta = last && reading ? numReading - last.current_reading : 0;
  const anomalous = delta > 10;

  return (
    <div className="space-y-3 pt-4">
      <h2 className="text-[20px] font-semibold tracking-tight text-fg">Log a meter reading</h2>

      <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          Slip
        </label>
        <select
          value={spaceId}
          onChange={(e) => setSpaceId(e.target.value)}
          className="mt-1 h-11 w-full rounded-[10px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg"
        >
          <option value="">Pick a slip…</option>
          {RENTAL_GROUPS.map((g) => (
            <optgroup key={g.id} label={g.name}>
              {RENTAL_SPACES.filter((s) => s.group_id === g.id).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {last && (
          <p className="mt-2 text-[12px] text-fg-tertiary">
            Last reading: <span className="font-mono text-fg">{last.current_reading}</span>{" "}
            on {new Date(last.current_ts).toLocaleDateString()}
          </p>
        )}
      </div>

      <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          Current reading
        </label>
        <input
          type="number"
          inputMode="decimal"
          value={reading}
          onChange={(e) => setReading(e.target.value)}
          placeholder="0"
          className="mt-1 h-14 w-full rounded-[10px] border border-hairline bg-surface-2 px-3 text-[24px] font-semibold tabular-nums text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
        />
        {last && reading && (
          <div
            className={
              "mt-2 inline-flex items-center gap-1 text-[12px] " +
              (anomalous ? "text-status-danger font-medium" : "text-fg-subtle")
            }
          >
            {anomalous && <AlertTriangle className="size-3" />}
            Δ {delta > 0 ? "+" : ""}{delta} kWh
            {anomalous && " · flagged"}
          </div>
        )}
      </div>

      <button
        type="button"
        className="flex h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-hairline-strong bg-surface-1 text-[14px] text-fg-subtle"
      >
        <Camera className="size-4" />
        Snap a photo
      </button>

      <button
        type="button"
        disabled={!space || !reading}
        onClick={() => onDone(`Reading logged for slip ${space?.number}. Δ +${delta} kWh${anomalous ? " (flagged for review)" : ""}.`)}
        className={
          "tap-scale pill h-14 w-full text-[16px] font-semibold transition-colors " +
          (space && reading
            ? "bg-primary text-on-primary"
            : "bg-surface-3 text-fg-tertiary")
        }
      >
        Submit reading
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Quick fuel sale
// ────────────────────────────────────────────────────────────

function FuelView({ onDone }: { onDone: (m: string) => void }) {
  const [boaterId, setBoaterId] = React.useState<string>("");
  const [fuelType, setFuelType] = React.useState<"gasoline" | "diesel">("gasoline");
  const [gallons, setGallons] = React.useState<string>("");
  const locations = usePosLocations();

  const inv = FUEL_INVENTORY.find((i) => i.fuel_type === fuelType);
  const boater = BOATERS.find((b) => b.id === boaterId);
  const price = inv?.current_price_per_gallon ?? 0;
  const total = (Number(gallons) || 0) * price;

  function submit() {
    if (!boater || !inv || !gallons) return;
    const now = new Date().toISOString();
    const orderId = nextPosOrderId();
    const orderNumber = nextPosOrderNumber();
    const invoiceId = nextLedgerId();
    const invoiceNum = nextInvoiceNumber();
    const fuelLoc = locations.find((l) => l.key === "fuel_dock") ?? locations[0];
    if (!fuelLoc) return;

    const order: PosOrder = {
      id: orderId,
      number: orderNumber,
      location_id: fuelLoc.id,
      customer_kind: "boater",
      boater_id: boater.id,
      line_items: [
        {
          sku: fuelType === "gasoline" ? "FUEL-GAS" : "FUEL-DSL",
          name: `${fuelType} (${gallons} gal)`,
          qty: Number(gallons),
          unit_price: price,
          total,
        },
      ],
      subtotal: total,
      tax: 0,
      total,
      payment_method: "charge_to_account",
      status: "paid",
      created_at: now,
      closed_at: now,
      linked_ledger_entry_id: invoiceId,
    };
    const invoice: LedgerEntry = {
      id: invoiceId,
      boater_id: boater.id,
      type: "invoice",
      number: invoiceNum,
      date: now.slice(0, 10),
      amount: total,
      open_balance: total,
      method: null,
      status: "open",
      line_items: [{ description: `${gallons} gal ${fuelType}`, amount: total }],
      linked_pos_order_id: orderId,
    };
    const receipt: Communication = {
      id: `cm_dock_${Date.now()}`,
      boater_id: boater.id,
      type: boater.communication_prefs.preferred_channel,
      direction: "outbound",
      subject: "Marina Stee Receipt — Fuel Dock",
      body_preview: `${gallons} gal ${fuelType} charged to your account — ${formatMoney(total)}.`,
      sender_label: "Sync, Service",
      sender_is_system: true,
      recipient:
        boater.communication_prefs.preferred_channel === "email"
          ? boater.primary_contact.email ?? "—"
          : boater.primary_contact.phone ?? "—",
      sent_at: now,
      status: "delivered",
      related_entity: { type: "invoice", id: orderId },
    };
    addLedgerEntry(invoice);
    addPosOrder(order);
    addCommunication(receipt);
    onDone(
      `${gallons} gal ${fuelType} → ${boater.first_name}'s account. ${formatMoney(total)} pending QuickBooks.`
    );
  }

  const canSubmit = !!boater && !!gallons && Number(gallons) > 0;

  return (
    <div className="space-y-3 pt-4">
      <h2 className="text-[20px] font-semibold tracking-tight text-fg">Quick fuel sale</h2>

      <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          Boater
        </label>
        <select
          value={boaterId}
          onChange={(e) => setBoaterId(e.target.value)}
          className="mt-1 h-11 w-full rounded-[10px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg"
        >
          <option value="">Pick a boater…</option>
          {BOATERS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.display_name} · {b.code ?? ""}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
        <label className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          Fuel
        </label>
        <div className="grid grid-cols-2 gap-2">
          {(["gasoline", "diesel"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFuelType(t)}
              className={cn(
                "flex flex-col items-start rounded-[10px] border p-3 text-left",
                fuelType === t
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-hairline bg-surface-2 text-fg-muted"
              )}
            >
              <span className="text-[11px] font-medium uppercase tracking-wide">{t}</span>
              <span className="mt-0.5 text-[16px] font-semibold tabular-nums text-fg">
                {formatMoney(FUEL_INVENTORY.find((i) => i.fuel_type === t)?.current_price_per_gallon ?? 0)}/gal
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          Gallons
        </label>
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0"
          value={gallons}
          onChange={(e) => setGallons(e.target.value)}
          placeholder="0"
          className="mt-1 h-14 w-full rounded-[10px] border border-hairline bg-surface-2 px-3 text-[24px] font-semibold tabular-nums text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
        />
        {gallons && (
          <div className="mt-2 text-[12px] text-fg-subtle">
            Total: <span className="font-mono font-medium text-fg">{formatMoney(total)}</span>
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className={
          "tap-scale pill h-14 w-full text-[16px] font-semibold transition-colors " +
          (canSubmit ? "bg-primary text-on-primary" : "bg-surface-3 text-fg-tertiary")
        }
      >
        Charge to account · {formatMoney(total || 0)}
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Rental returns — mobile dockhand surface for closing out a
// checked-out boat rental. Records fuel level + hours + damage,
// closeBoatRental() computes final charges + posts to ledger +
// dispatches receipt comm + flips the boat back to available.
// ────────────────────────────────────────────────────────────

function ReturnsView({ onDone }: { onDone: (m: string) => void }) {
  const rentals = useBoatRentals();
  const fleet = useRentalBoats();
  const onWater = rentals.filter((r) => r.status === "checked_out");
  const [selectedId, setSelectedId] = React.useState<string>(() => {
    // Honor ?return=br_xxx deep-link from the booking detail page
    if (typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    const ret = url.searchParams.get("return");
    return ret && onWater.some((r) => r.id === ret) ? ret : "";
  });

  if (onWater.length === 0) {
    return (
      <div className="space-y-3 pt-4">
        <h2 className="text-[20px] font-semibold tracking-tight text-fg">Rental returns</h2>
        <p className="rounded-[10px] border border-dashed border-hairline px-4 py-10 text-center text-[13px] text-fg-tertiary">
          No boats out right now. When something returns, it&apos;ll show up here.
        </p>
      </div>
    );
  }

  if (!selectedId) {
    return (
      <div className="space-y-3 pt-4">
        <h2 className="text-[20px] font-semibold tracking-tight text-fg">Pick a returning rental</h2>
        {onWater.map((r) => {
          const boat = fleet.find((b) => b.id === r.boat_id);
          const late =
            new Date(r.end_at).getTime() < Date.now();
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className="tap-scale flex w-full items-center justify-between rounded-[12px] border border-hairline bg-surface-1 p-3 text-left"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Sailboat className="size-3.5 text-fg-subtle" />
                  <span className="text-[14px] font-medium text-fg">
                    {boat?.name ?? "—"}
                  </span>
                  {late && <Badge tone="warn" size="sm">LATE</Badge>}
                </div>
                <div className="text-[11px] text-fg-subtle">
                  {r.number} · {r.patron_name ?? (BOATERS.find((b) => b.id === r.boater_id)?.display_name ?? "—")}
                </div>
                <div className="text-[11px] text-fg-tertiary">
                  Due back {new Date(r.end_at).toLocaleString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
              </div>
              <ChevronRight className="size-4 text-fg-tertiary" />
            </button>
          );
        })}
      </div>
    );
  }

  const rental = onWater.find((r) => r.id === selectedId);
  if (!rental) {
    setSelectedId("");
    return null;
  }
  const boat = fleet.find((b) => b.id === rental.boat_id);
  if (!boat) return null;

  return (
    <ReturnForm
      rental={rental}
      boat={boat}
      onCancel={() => setSelectedId("")}
      onDone={onDone}
    />
  );
}

function ReturnForm({
  rental,
  boat,
  onCancel,
  onDone,
}: {
  rental: BoatRental;
  boat: RentalBoat;
  onCancel: () => void;
  onDone: (m: string) => void;
}) {
  const [fuelIn, setFuelIn] = React.useState<string>(
    String(boat.current_fuel_pct ?? "")
  );
  const [hoursIn, setHoursIn] = React.useState<string>(
    String(boat.hour_meter_reading ?? "")
  );
  const [damageNotes, setDamageNotes] = React.useState("");
  const [damageCharge, setDamageCharge] = React.useState("");

  const fuelInNum = Number(fuelIn);
  const hoursInNum = Number(hoursIn);
  const damageNum = Number(damageCharge) || 0;

  // Live preview of charges using the same math the helper will use
  const consumedPct = Math.max(0, (rental.fuel_out_pct ?? 0) - fuelInNum);
  const gasPrice = 4.5; // fallback if no inventory hook here
  const consumedGal = boat.fuel_capacity_gal
    ? (consumedPct / 100) * boat.fuel_capacity_gal
    : 0;
  const fuelCharge =
    consumedGal * gasPrice + (fuelInNum < 25 ? 25 : 0);
  const lateMs = Date.now() - new Date(rental.end_at).getTime();
  const lateFee = lateMs > 0 ? Math.ceil(lateMs / (30 * 60_000)) * 50 : 0;
  const previewTotal = +(rental.base_amount + fuelCharge + damageNum + lateFee).toFixed(2);

  const canSubmit = fuelIn.length > 0 && !isNaN(fuelInNum) && fuelInNum >= 0 && fuelInNum <= 100;

  function submit() {
    if (!canSubmit) return;
    closeBoatRental(rental.id, {
      fuel_in_pct: fuelInNum,
      hours_in: hoursInNum,
      damage_notes: damageNotes.trim() || undefined,
      damage_charge: damageNum > 0 ? damageNum : undefined,
    });
    onDone(
      `${boat.name} closed · ${rental.number} · ${formatMoney(previewTotal)} charged to card on file.`
    );
  }

  return (
    <div className="space-y-3 pt-4">
      <button
        type="button"
        onClick={onCancel}
        className="text-[12px] text-fg-subtle hover:text-fg"
      >
        ← Pick another
      </button>
      <div>
        <h2 className="text-[20px] font-semibold tracking-tight text-fg">
          Return {boat.name}
        </h2>
        <p className="text-[12px] text-fg-subtle">
          {rental.number} · {rental.patron_name ?? "—"}
        </p>
      </div>

      <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          Fuel level on return
        </label>
        <div className="mt-1 flex items-baseline gap-2">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            max="100"
            value={fuelIn}
            onChange={(e) => setFuelIn(e.target.value)}
            placeholder="0"
            className="h-14 w-full rounded-[10px] border border-hairline bg-surface-2 px-3 text-[24px] font-semibold tabular-nums text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
          />
          <span className="text-[16px] text-fg-subtle">%</span>
        </div>
        <p className="mt-1 text-[11px] text-fg-tertiary">
          Out at {rental.fuel_out_pct ?? "—"}% · {boat.fuel_capacity_gal ?? "—"} gal tank
        </p>
      </div>

      {boat.hour_meter_reading != null && (
        <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
            Engine hours
          </label>
          <input
            type="number"
            inputMode="decimal"
            value={hoursIn}
            onChange={(e) => setHoursIn(e.target.value)}
            className="mt-1 h-14 w-full rounded-[10px] border border-hairline bg-surface-2 px-3 text-[24px] font-semibold tabular-nums text-fg focus:border-hairline-strong focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-fg-tertiary">
            Out at {rental.hours_out ?? "—"}
          </p>
        </div>
      )}

      <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          Damage notes (optional)
        </label>
        <textarea
          rows={2}
          value={damageNotes}
          onChange={(e) => setDamageNotes(e.target.value)}
          placeholder="Scratch on starboard, missing fender, etc."
          className="mt-1 w-full rounded-[10px] border border-hairline bg-surface-2 px-3 py-2 text-[14px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
        />
        <div className="mt-2 grid grid-cols-2 items-center gap-2">
          <span className="text-[12px] text-fg-subtle">Damage charge</span>
          <div className="flex items-center gap-1">
            <span className="text-[14px] text-fg-subtle">$</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={damageCharge}
              onChange={(e) => setDamageCharge(e.target.value)}
              placeholder="0"
              className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-right text-[14px] tabular-nums text-fg focus:border-hairline-strong focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Live charge preview */}
      <div className="rounded-[12px] border border-hairline bg-surface-2 p-3 text-[12px]">
        <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">Charge preview</div>
        <div className="mt-2 space-y-1">
          <PreviewLine label="Base rental" amount={rental.base_amount} />
          {fuelCharge > 0 && (
            <PreviewLine
              label={`Fuel${fuelInNum < 25 ? " + refueling fee" : ""}`}
              amount={fuelCharge}
            />
          )}
          {damageNum > 0 && <PreviewLine label="Damage" amount={damageNum} />}
          {lateFee > 0 && <PreviewLine label="Late fee" amount={lateFee} warn />}
        </div>
        <div className="mt-2 border-t border-hairline pt-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-medium text-fg">Total</span>
            <span className="money-display text-[20px] text-fg">
              {formatMoney(previewTotal)}
            </span>
          </div>
        </div>
        <p className="mt-2 text-[10px] text-fg-tertiary">
          Charged to card on file. Deposit hold {formatMoney(rental.deposit_hold)} released.
        </p>
      </div>

      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className={
          "tap-scale pill h-14 w-full text-[16px] font-semibold transition-colors " +
          (canSubmit
            ? "bg-primary text-on-primary"
            : "bg-surface-3 text-fg-tertiary")
        }
      >
        Close · {formatMoney(previewTotal)}
      </button>
    </div>
  );
}

function PreviewLine({
  label,
  amount,
  warn,
}: {
  label: string;
  amount: number;
  warn?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={warn ? "text-status-warn" : "text-fg-subtle"}>{label}</span>
      <span className={"tabular " + (warn ? "text-status-warn" : "text-fg")}>
        {formatMoney(amount)}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Done state
// ────────────────────────────────────────────────────────────

function DoneView({
  message,
  onContinue,
}: {
  message: string | null;
  onContinue: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <CheckCircle2 className="size-12 text-status-ok" />
      <h2 className="text-[20px] font-semibold tracking-tight text-fg">Done</h2>
      {message && <p className="max-w-xs text-[14px] text-fg-subtle">{message}</p>}
      <button
        type="button"
        onClick={onContinue}
        className="tap-scale pill mt-2 inline-flex h-12 items-center justify-center gap-2 bg-primary px-6 text-[15px] font-semibold text-on-primary"
      >
        Next task
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

// Silence unused-import warnings; reserved for future tiles
export const _unused = {
  Anchor,
  Wrench,
  useStore,
};
