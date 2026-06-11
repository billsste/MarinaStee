"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
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
  Sailboat,
  Clock4,
  Delete,
  Mic,
  MicOff,
  Loader2,
  Check,
} from "lucide-react";
import { DockShell, DockH1 } from "@/components/dock/dock-shell";
import { UpNextRail } from "@/components/dock/up-next-rail";
import { ClockInTile } from "@/components/dock/clock-in-tile";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
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
  useBoaters,
  usePosLocations,
  useRentalBoats,
  useStaff,
  useStore,
  useTimeEntries,
  clockInByPin,
  clockOutByPin,
  useAiSettings,
} from "@/lib/client-store";
import type {
  BoatRental,
  Communication,
  LedgerEntry,
  PosOrder,
  RentalBoat,
  Reservation,
} from "@/lib/types";

type View = "home" | "arrivals" | "departures" | "meter" | "fuel" | "returns" | "clock" | "done";

// Tiles the PWA manifest shortcut menu can deep-link into. Kept as a
// runtime Set (not just the View union) so we can validate ?tile=…
// without trusting the URL — any unknown value falls back to "home"
// silently, matching the global "deep-link should never crash" rule.
const DEEP_LINK_TILES = new Set<View>([
  "arrivals",
  "departures",
  "meter",
  "fuel",
  "returns",
  "clock",
]);

// Outer component is a Suspense shell because useSearchParams forces
// the closest boundary to client-render in prod. Without this, the
// static prerender of /dock fails with "Missing Suspense boundary with
// useSearchParams". The fallback mirrors the real shell so the layout
// doesn't pop during hydration on cold installs from the home screen.
export default function DockPage() {
  return (
    <React.Suspense fallback={<DockPageFallback />}>
      <DockPageInner />
    </React.Suspense>
  );
}

function DockPageFallback() {
  // Render the shell with the Home view so first paint matches the
  // most common case (no ?tile param). When the client-side
  // useSearchParams resolves, DockPageInner replaces this with the
  // deep-linked view if one was requested.
  return (
    <DockShell staffLabel="Dock view" showBack={false} onBack={() => {}}>
      <Home onSelect={() => {}} />
    </DockShell>
  );
}

function DockPageInner() {
  const searchParams = useSearchParams();
  const [view, setView] = React.useState<View>("home");
  const [lastAction, setLastAction] = React.useState<string | null>(null);

  // Wire the manifest-shortcut deep-link. PWA shortcuts launch the app
  // at e.g. /dock?tile=fuel — we read it once on mount and once per
  // change of the `tile` param, jumping the operator straight into the
  // requested sub-view. Unknown values are silently ignored so a stale
  // bookmark or a hand-typed URL can't strand the dock on a blank page.
  //
  // Only takes effect while we're still on the home view — we don't
  // want to yank an operator out of mid-task if the param happens to
  // change underneath them (e.g. browser back/forward across tabs).
  React.useEffect(() => {
    const tile = searchParams.get("tile");
    if (!tile) return;
    if (!DEEP_LINK_TILES.has(tile as View)) return;
    setView((current) => (current === "home" ? (tile as View) : current));
  }, [searchParams]);

  // Surface whoever is currently on the clock as the dock identity.
  // Falls back to the first active staff member, then to a generic
  // "Dock view" label so the shell is never empty. When auth lands,
  // this gets replaced with the signed-in user — but the prop shape
  // on DockShell stays the same.
  const staffLabel = useDockStaffLabel();

  function onDone(message: string) {
    setLastAction(message);
    setView("done");
  }

  return (
    <DockShell
      staffLabel={staffLabel}
      showBack={view !== "home" && view !== "done"}
      onBack={() => setView("home")}
    >
      {view === "home" && <Home onSelect={setView} />}
      {view === "arrivals" && <ArrivalsView onDone={onDone} />}
      {view === "departures" && <DeparturesView onDone={onDone} />}
      {view === "meter" && <MeterView onDone={onDone} />}
      {view === "fuel" && <FuelView onDone={onDone} />}
      {view === "returns" && <ReturnsView onDone={onDone} />}
      {view === "clock" && <ClockView onDone={onDone} />}
      {view === "done" && (
        <DoneView message={lastAction} onContinue={() => setView("home")} />
      )}
      <VoiceFab onDone={onDone} />
    </DockShell>
  );
}

/**
 * Resolves the staff label shown in the dock header. Currently:
 *   - whoever is on the clock right now, or
 *   - the first active dock staff member, or
 *   - a generic "Dock view".
 *
 * The hardcoded "J. Reyes" string used to live here, which made every
 * screenshot from any tenant look like the same person was running the
 * dock. Pulling from the store keeps demos and screenshots truthful.
 */
function useDockStaffLabel(): string {
  const staff = useStaff();
  const timeEntries = useTimeEntries();
  const onClock = timeEntries.find((t) => !t.clock_out_at);
  const onClockMember = onClock ? staff.find((s) => s.id === onClock.staff_id) : undefined;
  if (onClockMember) return `Dock view · ${onClockMember.name}`;
  const fallback = staff.find((s) => s.status === "active");
  if (fallback) return `Dock view · ${fallback.name}`;
  return "Dock view";
}

/*
 * Voice FAB — bottom-right mic button with streaming agent response.
 *
 * Tap to dictate. The transcript streams through the existing
 * `streamAgent()` loop so the operator sees text response inline
 * and, when the model proposes an AgentAction, a small approve /
 * reject card so the same human-approval gate as anywhere else.
 *
 * Web Speech API for capture (vendor-prefixed). Hidden when
 * dock_voice_input_enabled is false. The card lifts above the
 * iOS home-indicator via safe-area-inset.
 */
function VoiceFab({ onDone }: { onDone: (m: string) => void }) {
  const ai = useAiSettings();
  const { ledger } = useStore();
  const [listening, setListening] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [transcript, setTranscript] = React.useState("");
  const [response, setResponse] = React.useState("");
  const [pendingAction, setPendingAction] = React.useState<
    import("@/lib/simulated-agent").AgentAction | null
  >(null);
  const [supported, setSupported] = React.useState<boolean | null>(null);
  const recRef = React.useRef<unknown>(null);
  const [collapsed, setCollapsed] = React.useState(true);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const SR =
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    setSupported(Boolean(SR));
  }, []);

  if (!ai.dock_voice_input_enabled) return null;

  function clearAll() {
    setTranscript("");
    setResponse("");
    setPendingAction(null);
  }

  function start() {
    if (typeof window === "undefined") return;
    const SR =
      (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR() as {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: (e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    };
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      let t = "";
      const results = Array.from(e.results as ArrayLike<{ 0: { transcript: string } }>);
      for (const r of results) t += r[0].transcript;
      setTranscript(t);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
    recRef.current = rec;
    setListening(true);
    setResponse("");
    setPendingAction(null);
    setTranscript("");
    setCollapsed(false);
  }

  async function stop() {
    setListening(false);
    const rec = recRef.current as { stop: () => void } | null;
    rec?.stop();
    const text = transcript.trim();
    if (!text) return;
    setSubmitting(true);
    setResponse("");
    setPendingAction(null);
    try {
      const { streamAgent } = await import("@/lib/agent-fetch");
      for await (const ev of streamAgent(text, ledger)) {
        if (ev.kind === "text") {
          setResponse((prev) => prev + ev.text);
        } else if (ev.kind === "action") {
          setPendingAction(ev.action);
        } else if (ev.kind === "error") {
          setResponse((prev) => prev + `\n[Error: ${ev.message}]`);
        }
      }
    } catch (e) {
      setResponse(`Voice command failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function approve() {
    if (!pendingAction) return;
    const { executeAgentAction } = await import("@/lib/agent-actions");
    const result = executeAgentAction(pendingAction);
    if (result?.ok) {
      onDone(pendingAction.label || "Voice command approved.");
      clearAll();
      setCollapsed(true);
    } else {
      setResponse(`Couldn't apply: ${result?.reason ?? "unknown error"}`);
    }
  }

  function reject() {
    clearAll();
    setCollapsed(true);
  }

  const showPanel =
    !collapsed && (listening || submitting || transcript || response || pendingAction);

  return (
    // Mobile: centered 480px column (matches DockShell) so the FAB
    // hugs the right edge of the dock view. Desktop: widen to match the
    // 1280px shell so the FAB sits at the bottom-right of the real
    // content area, not the middle of the viewport.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-[480px] flex-col items-end gap-2 p-4 pb-[max(env(safe-area-inset-bottom),16px)] lg:max-w-[1280px] lg:px-8">
      {showPanel && (
        <div className="pointer-events-auto w-full space-y-2 rounded-[14px] border border-hairline bg-surface-1 p-3 shadow-xl">
          {/* Transcript */}
          {transcript && (
            <div className="text-[12px]">
              <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
                {listening ? "Listening…" : "You said"}
              </div>
              <div className="mt-0.5 text-fg">{transcript}</div>
            </div>
          )}

          {/* Agent response stream */}
          {submitting && !response && (
            <div className="inline-flex items-center gap-1.5 text-[12px] text-fg-subtle">
              <Loader2 className="size-3.5 animate-spin" /> Thinking…
            </div>
          )}
          {response && (
            <div className="text-[12px]">
              <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
                Marina Stee
              </div>
              <div className="mt-0.5 whitespace-pre-wrap text-fg">{response}</div>
            </div>
          )}

          {/* Action approve card */}
          {pendingAction && (
            <div className="rounded-[10px] border border-primary/30 bg-primary/[0.04] p-2.5 text-[12px]">
              <div className="text-[10px] uppercase tracking-wide text-primary">
                Proposed action
              </div>
              <div className="mt-0.5 font-medium text-fg">
                {pendingAction.label}
              </div>
              <div className="mt-2 flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={reject}
                  className="rounded-[6px] px-2 py-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => void approve()}
                  className="inline-flex items-center gap-1 rounded-[6px] bg-primary px-2 py-1 font-medium text-on-primary hover:bg-primary-hover"
                >
                  <Check className="size-3" />
                  Approve
                </button>
              </div>
            </div>
          )}

          {/* Footer — clear */}
          {!listening && !submitting && (response || pendingAction) && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  clearAll();
                  setCollapsed(true);
                }}
                className="text-[10px] text-fg-tertiary hover:text-fg-subtle"
              >
                Done
              </button>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          if (listening) void stop();
          else start();
        }}
        disabled={supported === false || submitting}
        className={cn(
          "pointer-events-auto flex size-14 items-center justify-center rounded-full shadow-xl transition-transform active:scale-95",
          supported === false
            ? "bg-surface-3 text-fg-tertiary"
            : listening
            ? "bg-status-danger text-on-primary animate-pulse"
            : "bg-primary text-on-primary"
        )}
        aria-label={listening ? "Stop voice input" : "Start voice input"}
        title={
          supported === false ? "Voice not supported in this browser" : "Tap to dictate"
        }
      >
        {listening ? <MicOff className="size-6" /> : <Mic className="size-6" />}
      </button>
    </div>
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

  // Anomaly banner — extracted so the same markup renders in both the
  // single-column mobile flow and the desktop 2-col grid without
  // duplicating the click handler / copy.
  const anomalyAlert = anomalies.length > 0 && (
    <button
      type="button"
      onClick={() => onSelect("meter")}
      className="tap-scale flex w-full items-start gap-3 rounded-[12px] border border-status-danger/30 bg-status-danger/[0.06] p-3 text-left"
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
    </button>
  );

  const tileGrid = (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
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
      {/* Clock-in/out — the count badge updates live from the time
          entries store so dockhands see "3 on the clock" at a glance.
          Tapping opens the PIN flow (ClockView). */}
      <ClockInTile onClick={() => onSelect("clock")} />
    </div>
  );

  const tankPanel = (
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
  );

  const askAgentPanel = (
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
  );

  // Mobile (default) — single stacked column, untouched from the
  // original PWA-install layout. Desktop (lg+) — fan the same content
  // into a 2-col grid so a 1440px iMac viewport isn't 60% empty.
  // Left column = context (what's happening). Right column = action
  // tiles (what to do). Matches the connection-layer mandate: situation
  // and action visible side-by-side without a click chain.
  //
  // Two parallel trees (lg:hidden / hidden lg:block) rather than a
  // single tree with reflow classes — UpNextRail order differs between
  // mobile (above the tiles) and desktop (left rail), and the tile grid
  // also widens to 3-col on lg. Cleanest to keep the two layouts
  // explicit and let Tailwind drop one out via display:none.
  return (
    <>
      {/* Mobile / PWA install target */}
      <div className="space-y-5 lg:hidden">
        <DockH1
          title="What needs doing?"
          description="Today's queue. Tap any tile to do it now."
        />

        {/* Inline connection-layer band — boater + slip + ETA visible
            BEFORE any tile is tapped. Per the Marina Stee connection-layer
            mandate, dockhand context should never be hidden behind a click. */}
        <UpNextRail onSelect={onSelect} />

        {anomalyAlert}

        {tileGrid}

        {tankPanel}

        {askAgentPanel}
      </div>

      {/* Desktop fallback — widens the same content across the viewport
          so a marina owner on an iMac doesn't see an empty page. */}
      <div className="hidden lg:block">
        <DockH1
          title="What needs doing?"
          description="Today's queue. Tap any tile to do it now."
        />
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-6">
          {/* Left rail — situational context */}
          <div className="space-y-4">
            <UpNextRail onSelect={onSelect} />
            {anomalyAlert}
            {tankPanel}
            {askAgentPanel}
          </div>

          {/* Right rail — primary action tiles, wider so they breathe */}
          <div>{tileGrid}</div>
        </div>
      </div>
    </>
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
    <div className="space-y-3">
      <DockH1 title={title} />
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

  // Slip options flattened from the (group → spaces) tree. The group
  // name rides as the combobox `hint` so the typeahead still surfaces
  // it on the right side of each row. Past 40+ slips a native picker
  // is touch-hostile (per global §6.3 + dock UX).
  const slipOptions = React.useMemo<ComboboxOption[]>(() => {
    const out: ComboboxOption[] = [];
    for (const g of RENTAL_GROUPS) {
      for (const s of RENTAL_SPACES) {
        if (s.group_id !== g.id) continue;
        out.push({ value: s.id, label: s.number, hint: g.name });
      }
    }
    return out;
  }, []);

  return (
    <div className="space-y-3">
      <DockH1 title="Log a meter reading" />

      <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          Slip
        </label>
        <div className="mt-1">
          <Combobox
            value={spaceId}
            onChange={setSpaceId}
            options={slipOptions}
            placeholder="Pick a slip…"
            searchPlaceholder="Search slips…"
          />
        </div>

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
          type="text"
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
  // Tenant-scoped — keeps Lakeside boaters out of Marina Stee's
  // dockhand picker when staff switches tenants mid-shift.
  const boaters = useBoaters();

  const inv = FUEL_INVENTORY.find((i) => i.fuel_type === fuelType);
  const boater = boaters.find((b) => b.id === boaterId);
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
    <div className="space-y-3">
      <DockH1 title="Quick fuel sale" />


      <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          Boater
        </label>
        <div className="mt-1">
          <Combobox
            value={boaterId}
            onChange={setBoaterId}
            options={boaters.map((b) => ({
              value: b.id,
              label: b.display_name,
              hint: b.code ?? undefined,
            }))}
            placeholder="Pick a boater…"
            searchPlaceholder="Search boaters…"
          />
        </div>
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
          type="text"
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
      <div className="space-y-3">
        <DockH1 title="Rental returns" />
        <p className="rounded-[10px] border border-dashed border-hairline px-4 py-10 text-center text-[13px] text-fg-tertiary">
          No boats out right now. When something returns, it&apos;ll show up here.
        </p>
      </div>
    );
  }

  if (!selectedId) {
    return (
      <div className="space-y-3">
        <DockH1 title="Pick a returning rental" />
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
                  {/* Surface club provenance so the dockhand knows this
                      rental is membership-covered before they tap in. */}
                  {r.source === "club" && (
                    <Badge tone="info" size="sm">CLUB</Badge>
                  )}
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

  // Live preview of charges using the same math the helper will use.
  // Club rentals are subscription-covered, so base = 0 here too.
  const isClubRental = rental.source === "club";
  const consumedPct = Math.max(0, (rental.fuel_out_pct ?? 0) - fuelInNum);
  const gasPrice = 4.5; // fallback if no inventory hook here
  const consumedGal = boat.fuel_capacity_gal
    ? (consumedPct / 100) * boat.fuel_capacity_gal
    : 0;
  const fuelCharge =
    consumedGal * gasPrice + (fuelInNum < 25 ? 25 : 0);
  const lateMs = Date.now() - new Date(rental.end_at).getTime();
  const lateFee = lateMs > 0 ? Math.ceil(lateMs / (30 * 60_000)) * 50 : 0;
  const baseForPreview = isClubRental ? 0 : rental.base_amount;
  const previewTotal = +(baseForPreview + fuelCharge + damageNum + lateFee).toFixed(2);

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
      isClubRental && previewTotal === 0
        ? `${boat.name} returned · ${rental.number} · covered by Rental Club, no charges.`
        : `${boat.name} closed · ${rental.number} · ${formatMoney(previewTotal)} charged to card on file.`
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onCancel}
        className="-ml-1 inline-flex h-9 items-center rounded-[6px] px-1 text-[12px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
      >
        ← Pick another
      </button>
      <DockH1
        title={`Return ${boat.name}`}
        description={`${rental.number} · ${rental.patron_name ?? "—"}`}
      />

      <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          Fuel level on return
        </label>
        <div className="mt-1 flex items-baseline gap-2">
          <input
            type="text"
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
            type="text"
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
              type="text"
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
          {isClubRental ? (
            <div className="flex items-baseline justify-between text-fg-subtle">
              <span>Base rental</span>
              <span className="text-[11px] italic">
                Covered by Rental Club
              </span>
            </div>
          ) : (
            <PreviewLine label="Base rental" amount={rental.base_amount} />
          )}
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
          {isClubRental && previewTotal === 0
            ? "No charges — covered by membership. Receipt still goes out."
            : `Charged to card on file. Deposit hold ${formatMoney(rental.deposit_hold)} released.`}
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
        {isClubRental && previewTotal === 0
          ? "Return"
          : `Close · ${formatMoney(previewTotal)}`}
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
      <h2 className="display-tight text-[26px] font-semibold text-fg">Done</h2>
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

// ────────────────────────────────────────────────────────────
// Clock in / out — staff PIN keypad
// ────────────────────────────────────────────────────────────

function ClockView({ onDone }: { onDone: (m: string) => void }) {
  const [pin, setPin] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const timeEntries = useTimeEntries();
  const activeCount = timeEntries.filter((t) => !t.clock_out_at).length;

  function press(digit: string) {
    setError(null);
    if (pin.length >= 4) return;
    setPin((p) => p + digit);
  }
  function back() {
    setError(null);
    setPin((p) => p.slice(0, -1));
  }
  function clear() {
    setError(null);
    setPin("");
  }

  function submit() {
    if (pin.length !== 4) {
      setError("PIN must be 4 digits.");
      return;
    }
    // First try clock-out — if there's an open entry, this wins.
    const out = clockOutByPin(pin);
    if (out.ok && out.staff) {
      onDone(
        `Clocked out — ${out.staff.name} · ${(out.hours ?? 0).toFixed(2)} hrs`
      );
      return;
    }
    if (out.reason === "bad_pin") {
      setError("PIN not recognized.");
      return;
    }
    // out.reason === "not_clocked_in" → fall through to clock-in
    const inResult = clockInByPin(pin);
    if (inResult.ok && inResult.staff) {
      onDone(
        `Clocked in — ${inResult.staff.name}${inResult.staff.default_position ? ` (${inResult.staff.default_position})` : ""}`
      );
      return;
    }
    if (inResult.reason === "bad_pin") {
      setError("PIN not recognized.");
    } else if (inResult.reason === "already_clocked_in") {
      setError(`${inResult.staff?.name ?? "Someone"} is already on the clock.`);
    }
  }

  return (
    <div className="space-y-4">
      <DockH1
        title="Clock in / out"
        description="Enter your 4-digit PIN. If you're already on the clock, this clocks you out and shows your hours."
      />

      {/* Live tile — who's currently on the clock */}
      <div className="rounded-[12px] border border-hairline bg-surface-1 p-3">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-fg">
            <Clock4 className="size-3.5 text-status-info" />
            Currently on the clock
          </span>
          <span className="money-display text-[18px] text-fg">{activeCount}</span>
        </div>
      </div>

      {/* PIN display */}
      <div className="flex items-center justify-center gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              "flex size-12 items-center justify-center rounded-[10px] border text-[24px] font-mono",
              pin.length > i
                ? "border-primary bg-primary-soft/40 text-fg"
                : "border-hairline bg-surface-1 text-fg-tertiary"
            )}
          >
            {pin.length > i ? "•" : ""}
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-[10px] border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-center text-[12px] text-status-danger">
          {error}
        </div>
      )}

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => press(d)}
            className="h-14 rounded-[12px] border border-hairline bg-surface-1 text-[20px] font-medium text-fg transition-colors hover:bg-surface-2 active:bg-surface-3"
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={clear}
          className="h-14 rounded-[12px] border border-hairline bg-surface-1 text-[12px] font-medium text-fg-subtle transition-colors hover:bg-surface-2"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => press("0")}
          className="h-14 rounded-[12px] border border-hairline bg-surface-1 text-[20px] font-medium text-fg transition-colors hover:bg-surface-2 active:bg-surface-3"
        >
          0
        </button>
        <button
          type="button"
          onClick={back}
          className="flex h-14 items-center justify-center rounded-[12px] border border-hairline bg-surface-1 text-fg-subtle transition-colors hover:bg-surface-2"
          aria-label="Backspace"
        >
          <Delete className="size-5" />
        </button>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={pin.length !== 4}
        className={cn(
          "block w-full rounded-[12px] py-3 text-[15px] font-medium transition-colors",
          pin.length === 4
            ? "bg-primary text-on-primary hover:bg-primary-hover"
            : "cursor-not-allowed bg-surface-3 text-fg-tertiary"
        )}
      >
        Submit
      </button>
    </div>
  );
}
