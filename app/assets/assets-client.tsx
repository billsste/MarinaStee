"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Boxes,
  Wrench,
  History,
  Plus,
  Play,
  Inbox,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { PageShell } from "@/components/page-shell";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { formatMoney } from "@/lib/mock-data";
import {
  deleteMarinaAsset,
  deletePmSchedule,
  nextMarinaAssetId,
  nextPmScheduleId,
  runPmCheck,
  upsertMarinaAsset,
  upsertPmSchedule,
  useExtractionDrafts,
  useMarinaAssets,
  usePmSchedules,
  useStore,
  useVendors,
} from "@/lib/client-store";
import {
  approveDraft,
  persistFreshDraft,
  rejectDraft,
} from "@/lib/ai-extract-executor";
import { DropZone } from "@/components/ai/drop-zone";
import { DraftCard, type DraftField } from "@/components/ai/draft-card";
import { cn } from "@/lib/utils";
import type { ExtractionDraft, MarinaAsset, MarinaAssetKind, PmCadence, PmSchedule } from "@/lib/types";
import { AssetKindIcon, KIND_OPTIONS, assetKindLabel } from "@/components/assets/asset-kind";
import { AssetWizard } from "@/components/assets/asset-wizard";

type SectionKey = "inbox" | "list" | "pm_due" | "history";

const NAV: {
  key: SectionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}[] = [
  {
    key: "inbox",
    label: "Asset inbox",
    icon: Inbox,
    description: "Drop a purchase invoice or manual — we draft the asset record.",
  },
  {
    key: "list",
    label: "All assets",
    icon: Boxes,
    description: "Forklifts, hoists, pump-outs — every piece of equipment.",
  },
  {
    key: "pm_due",
    label: "Service due",
    icon: Wrench,
    description: "Preventive-maintenance schedules coming due within 30 days.",
  },
  {
    key: "history",
    label: "Maintenance history",
    icon: History,
    description: "Every work order created against marina assets.",
  },
];

export function AssetsClient() {
  const params = useSearchParams();
  const initial: SectionKey =
    params?.get("section") === "pm-due" || params?.get("section") === "pm_due"
      ? "pm_due"
      : params?.get("section") === "history"
      ? "history"
      : params?.get("section") === "inbox"
      ? "inbox"
      : "list";
  const [section, setSection] = React.useState<SectionKey>(initial);
  const active = NAV.find((n) => n.key === section) ?? NAV[0];

  return (
    <PageShell title="Assets & Maintenance" description={active.description} width="wide" hideHeader>
      <div className="mb-5">
        <RentalsAsk
          placeholder="Ask the agent — e.g. 'what PMs are due this month?' or 'add the new forklift'"
          suggestions={[
            "What PMs are due in the next 30 days?",
            "Run PM check",
            "Schedule quarterly inspection on the hoist",
            "Show me maintenance history for the forklift",
          ]}
        />
      </div>
      <div
        className="grid gap-6"
        style={{ gridTemplateColumns: "200px minmax(0, 1fr)" }}
      >
        <nav
          aria-label="Assets sections"
          className="space-y-0.5 md:sticky md:top-20 md:self-start"
        >
          {NAV.map((item) => {
            const Icon = item.icon;
            const isActive = section === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSection(item.key)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] transition-colors",
                  isActive
                    ? "bg-surface-3 font-medium text-fg"
                    : "text-fg-subtle hover:bg-surface-2 hover:text-fg"
                )}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          {section === "inbox" && <AssetInboxView />}
          {section === "list" && <AssetListView />}
          {section === "pm_due" && <PmDueView />}
          {section === "history" && <MaintHistoryView />}
        </div>
      </div>
    </PageShell>
  );
}

// ── All assets ────────────────────────────────────────

function AssetListView() {
  const assets = useMarinaAssets();
  const schedules = usePmSchedules();
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<MarinaAsset | null>(null);

  function nextDueFor(assetId: string): string | null {
    const mine = schedules.filter((p) => p.asset_id === assetId && p.active);
    if (mine.length === 0) return null;
    return mine.reduce(
      (min, p) => (min < p.next_due_at ? min : p.next_due_at),
      mine[0].next_due_at
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <p className="text-[12px] text-fg-tertiary">
          Click a row to edit. Hover for the full asset detail + PM schedule.
        </p>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" />
          New asset
        </Button>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        {/* Column order follows the canonical identity > location >
            category > details > money > status pattern; status badge
            (Active / In maintenance / Retired) sits last. */}
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{
            gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.2fr) 130px 110px 110px 110px",
          }}
        >
          <span>Name</span>
          <span>Location</span>
          <span>Kind</span>
          <span>Serial</span>
          <span>Next service</span>
          <span>Status</span>
        </div>
        {assets.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-fg-tertiary">
            No assets yet. Click <span className="font-medium text-fg-subtle">New asset</span> to add one.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {assets.map((a) => {
              const due = nextDueFor(a.id);
              const dueDays = due
                ? Math.round((new Date(due).getTime() - Date.now()) / 86_400_000)
                : null;
              return (
                <li key={a.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setEditing(a)}
                    style={{
                      gridTemplateColumns:
                        "minmax(0, 2fr) minmax(0, 1.2fr) 130px 110px 110px 110px",
                    }}
                    className="grid w-full cursor-pointer items-center gap-x-3 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-2"
                  >
                    <div className="inline-flex min-w-0 items-center gap-2">
                      <AssetKindIcon kind={a.kind} className="size-3.5 text-fg-subtle" />
                      <span className="truncate text-[13px] font-medium text-fg">{a.name}</span>
                    </div>
                    <span className="truncate text-[12px] text-fg-subtle">{a.location ?? "—"}</span>
                    <span className="truncate text-[12px] text-fg-subtle">
                      {assetKindLabel(a.kind)}
                    </span>
                    <span className="font-mono text-[11px] text-fg-tertiary truncate">
                      {a.serial_number ?? "—"}
                    </span>
                    {due ? (
                      <span
                        className={cn(
                          "text-[12px]",
                          dueDays !== null && dueDays <= 0
                            ? "text-status-danger"
                            : dueDays !== null && dueDays <= 14
                            ? "text-status-warn"
                            : "text-fg-subtle"
                        )}
                      >
                        {due}
                      </span>
                    ) : (
                      <span className="text-[12px] text-fg-tertiary">No PMs</span>
                    )}
                    <Badge
                      tone={
                        a.status === "active"
                          ? "ok"
                          : a.status === "in_maintenance"
                          ? "warn"
                          : "neutral"
                      }
                      size="sm"
                    >
                      {a.status.replace("_", " ")}
                    </Badge>
                  </button>
                  <Link
                    href={`/assets/${a.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-[6px] p-1.5 text-fg-tertiary opacity-0 transition-opacity hover:bg-surface-3 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label="Open asset detail"
                    title="Open detail + PM history"
                  >
                    <ExternalLink className="size-3" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Create flows through the new multi-step modal wizard so we can
          collect a vendor + PM schedules in the same pass. Edit still
          uses the inline dialog below — it's the right surface for a
          single-record patch. */}
      <AssetWizard open={creating} onOpenChange={setCreating} />

      {editing && (
        <NewAssetSheet
          onClose={() => setEditing(null)}
          asset={editing}
        />
      )}
    </div>
  );
}

/** New + edit. Pass `asset` to pre-fill + upsert the same id. */
function NewAssetSheet({
  onClose,
  asset,
}: {
  onClose: () => void;
  asset?: MarinaAsset | null;
}) {
  const vendors = useVendors();
  const [name, setName] = React.useState(asset?.name ?? "");
  const [kind, setKind] = React.useState<MarinaAssetKind>(asset?.kind ?? "forklift");
  const [serial, setSerial] = React.useState(asset?.serial_number ?? "");
  const [location, setLocation] = React.useState(asset?.location ?? "");
  const [purchaseDate, setPurchaseDate] = React.useState(asset?.purchase_date ?? "");
  const [purchasePrice, setPurchasePrice] = React.useState(
    asset?.purchase_price ? String(asset.purchase_price) : ""
  );
  const [warrantyUntil, setWarrantyUntil] = React.useState(asset?.warranty_until ?? "");
  const [vendorId, setVendorId] = React.useState(asset?.service_vendor_id ?? "");
  const [notes, setNotes] = React.useState(asset?.notes ?? "");
  const [status, setStatus] = React.useState<MarinaAsset["status"]>(asset?.status ?? "active");

  const vendorOptions: ComboboxOption[] = vendors.map((v) => ({
    value: v.id,
    label: v.display_name ?? v.name,
  }));
  const kindOptions: ComboboxOption[] = KIND_OPTIONS;

  function save() {
    if (!name.trim()) return;
    const now = new Date().toISOString();
    upsertMarinaAsset({
      id: asset?.id ?? nextMarinaAssetId(),
      tenant_id: asset?.tenant_id ?? "",
      name: name.trim(),
      kind,
      serial_number: serial.trim() || undefined,
      model: asset?.model,
      manufacturer: asset?.manufacturer,
      location: location.trim() || undefined,
      purchase_date: purchaseDate || undefined,
      purchase_price: purchasePrice ? Number(purchasePrice) : undefined,
      warranty_until: warrantyUntil || undefined,
      status,
      photo_url: asset?.photo_url,
      service_vendor_id: vendorId || undefined,
      notes: notes.trim() || undefined,
      created_at: asset?.created_at ?? now,
      updated_at: now,
      attachment_ids: asset?.attachment_ids,
      extracted_from_draft_id: asset?.extracted_from_draft_id,
    });
    onClose();
  }

  function remove() {
    if (!asset) return;
    if (!window.confirm(`Delete ${asset.name}? PM schedules + work orders linked to this asset stay; only the asset record is removed.`)) return;
    deleteMarinaAsset(asset.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[560px] rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-fg">{asset ? `Edit ${asset.name}` : "New asset"}</h3>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Name *" col={2}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Forklift — Toyota 7FBCU25 #1"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Kind *" col={2}>
            <Combobox
              value={kind}
              onChange={(v) => setKind(v as MarinaAssetKind)}
              options={kindOptions}
              placeholder="Pick a kind"
            />
          </Field>
          <Field label="Serial number">
            <input
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] font-mono text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Location">
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Hoist bay — A side"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Purchase date">
            <input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Purchase price ($)">
            <input
              value={purchasePrice}
              onChange={(e) => setPurchasePrice(e.target.value)}
              inputMode="decimal"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Warranty until">
            <input
              type="date"
              value={warrantyUntil}
              onChange={(e) => setWarrantyUntil(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Service vendor">
            <Combobox
              value={vendorId}
              onChange={setVendorId}
              options={vendorOptions}
              placeholder="None"
            />
          </Field>
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as MarinaAsset["status"])}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            >
              <option value="active">Active</option>
              <option value="in_maintenance">In maintenance</option>
              <option value="retired">Retired</option>
            </select>
          </Field>
          <Field label="Notes" col={2}>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          {asset ? (
            <button
              type="button"
              onClick={remove}
              className="rounded-[8px] px-3 py-1.5 text-[12px] text-status-danger hover:bg-status-danger/10"
            >
              Delete asset
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[8px] px-3 py-1.5 text-[13px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!name.trim()}
              className={cn(
                "rounded-[10px] px-3 py-2 text-[13px] font-medium transition-colors",
                name.trim()
                  ? "bg-primary text-on-primary hover:bg-primary-hover"
                  : "cursor-not-allowed bg-surface-3 text-fg-tertiary"
              )}
            >
              {asset ? "Save changes" : "Save asset"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PM due ─────────────────────────────────────────────

function PmDueView() {
  const schedules = usePmSchedules();
  const assets = useMarinaAssets();
  const assetById = React.useMemo(
    () => new Map(assets.map((a) => [a.id, a])),
    [assets]
  );
  const [editing, setEditing] = React.useState<PmSchedule | null>(null);

  const dueWithin30 = schedules
    .filter((p) => {
      if (!p.active) return false;
      const days = Math.round(
        (new Date(p.next_due_at).getTime() - Date.now()) / 86_400_000
      );
      return days <= 30;
    })
    .sort((a, b) => (a.next_due_at < b.next_due_at ? -1 : 1));

  function doRunPm() {
    const result = runPmCheck();
    window.alert(
      result.created.length > 0
        ? `Created ${result.created.length} work order${result.created.length === 1 ? "" : "s"} for PMs within the auto-create window.`
        : "Nothing to do — no PMs within the auto-create window."
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <p className="text-[12px] text-fg-tertiary">
          PMs whose due date is within 30 days. Click &quot;Run PM check&quot; to auto-create work orders for anything inside the auto-create window.
        </p>
        <Button variant="primary" size="sm" onClick={doRunPm}>
          <Play className="size-3.5" />
          Run PM check
        </Button>
      </div>

      {dueWithin30.length === 0 ? (
        <div className="rounded-[12px] border border-hairline bg-surface-1 px-4 py-10 text-center text-[12px] text-fg-tertiary">
          Nothing due in the next 30 days. All caught up.
        </div>
      ) : (
        <ul className="divide-y divide-hairline rounded-[12px] border border-hairline bg-surface-1">
          {dueWithin30.map((p) => {
            const asset = assetById.get(p.asset_id);
            const days = Math.round(
              (new Date(p.next_due_at).getTime() - Date.now()) / 86_400_000
            );
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setEditing(p)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {asset && (
                        <AssetKindIcon
                          kind={asset.kind}
                          className="size-3.5 text-fg-subtle"
                        />
                      )}
                      <span className="text-[13px] font-medium text-fg">
                        {p.name}
                      </span>
                      <Badge tone="neutral" size="sm">
                        {p.cadence}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-fg-tertiary">
                      {asset ? asset.name : p.asset_id}
                      {" · due "}
                      {p.next_due_at}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "text-[12px] font-medium",
                      days <= 0
                        ? "text-status-danger"
                        : days <= 14
                        ? "text-status-warn"
                        : "text-status-info"
                    )}
                  >
                    {days <= 0 ? `${Math.abs(days)}d overdue` : `${days}d`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <PmEditSheet
          schedule={editing}
          assetName={assetById.get(editing.asset_id)?.name ?? editing.asset_id}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ── Maintenance history ───────────────────────────────

function MaintHistoryView() {
  const { workOrders } = useStore();
  const assets = useMarinaAssets();
  const assetById = React.useMemo(
    () => new Map(assets.map((a) => [a.id, a])),
    [assets]
  );

  const myWos = workOrders.filter((w) => w.boater_id.startsWith("__asset__"));
  const sorted = [...myWos].sort((a, b) =>
    (a.due_date ?? a.start_date ?? "") < (b.due_date ?? b.start_date ?? "") ? 1 : -1
  );

  if (sorted.length === 0) {
    return (
      <div className="rounded-[12px] border border-hairline bg-surface-1 px-4 py-10 text-center text-[12px] text-fg-tertiary">
        No PM work orders yet. Run a PM check to create them automatically.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-hairline rounded-[12px] border border-hairline bg-surface-1">
      {sorted.map((w) => {
        const assetId = w.boater_id.replace("__asset__", "");
        const asset = assetById.get(assetId);
        const tone =
          w.status === "completed" ? "ok" : w.status === "blocked" ? "danger" : "info";
        return (
          <li
            key={w.id}
            className="flex items-center justify-between gap-3 px-4 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-fg">
                <Link href={`/work-orders/${w.id}`} className="hover:underline">
                  {w.number} · {w.subject}
                </Link>
              </div>
              <div className="text-[11px] text-fg-tertiary">
                {asset ? (
                  <Link href={`/assets/${asset.id}`} className="hover:text-fg">
                    {asset.name}
                  </Link>
                ) : (
                  assetId
                )}
                {w.due_date ? ` · due ${w.due_date}` : ""}
              </div>
            </div>
            <Badge tone={tone} size="sm">
              {w.status.replace("_", " ")}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

function Field({
  label,
  col = 1,
  children,
}: {
  label: string;
  col?: 1 | 2;
  children: React.ReactNode;
}) {
  return (
    <div className={col === 2 ? "col-span-2" : ""}>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Asset inbox — drop purchase invoice or manual
// ────────────────────────────────────────────────────────────

function AssetInboxView() {
  const drafts = useExtractionDrafts("asset");
  const pending = drafts.filter((d) => d.status === "pending");
  const decided = drafts.filter(
    (d) => d.status === "approved" || d.status === "rejected"
  );

  return (
    <div className="space-y-6">
      <DropZone
        module="asset"
        onDraftsCreated={(results) => {
          for (const { draft, file } of results) {
            persistFreshDraft(draft, file);
          }
        }}
      />

      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          Awaiting review
          {pending.length > 0 && (
            <span className="ml-2 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-normal text-fg-subtle">
              {pending.length}
            </span>
          )}
        </div>
        {pending.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-hairline px-4 py-6 text-center text-[12px] text-fg-tertiary">
            Drop a purchase invoice or spec sheet above and we&apos;ll create
            the asset record.
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((d) => (
              <AssetDraftCard key={d.id} draft={d} />
            ))}
          </div>
        )}
      </div>

      {decided.length > 0 && (
        <details className="rounded-[12px] border border-hairline bg-surface-1">
          <summary className="cursor-pointer px-4 py-2.5 text-[12px] font-medium text-fg-subtle hover:text-fg">
            History — {decided.length} reviewed
          </summary>
          <div className="space-y-2 border-t border-hairline p-3">
            {decided.map((d) => {
              const a = d.staged_actions[0] as Record<string, unknown>;
              return (
                <div
                  key={d.id}
                  className="rounded-[8px] border border-hairline bg-surface-2/40 px-3 py-1.5 text-[12px] text-fg-subtle"
                >
                  {String(a.name ?? "Asset")} · {d.status}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

function AssetDraftCard({ draft }: { draft: ExtractionDraft }) {
  const a = draft.staged_actions[0] as Record<string, unknown>;
  const fields: DraftField[] = [
    { key: "name", label: "Name", value: String(a.name ?? "—"), editable: true },
    { key: "kind", label: "Type", value: String(a.kind ?? "—") },
    { key: "manufacturer", label: "Manufacturer", value: String(a.manufacturer ?? "—") },
    { key: "model", label: "Model", value: String(a.model ?? "—") },
    { key: "serial_number", label: "Serial #", value: String(a.serial_number ?? "—"), mono: true },
    { key: "purchase_price", label: "Purchase price", value: Number(a.purchase_price ?? 0), money: true, editable: true },
    { key: "purchase_date", label: "Purchase date", value: String(a.purchase_date ?? "—") },
    { key: "warranty_until", label: "Warranty until", value: String(a.warranty_until ?? "—") },
  ];

  return (
    <DraftCard
      draft={draft}
      title={String(a.name ?? "New asset")}
      subtitle={`${String(a.manufacturer ?? "")} ${String(a.model ?? "")}`.trim()}
      fields={fields}
      onApprove={() => approveDraft(draft.id)}
      onReject={() => rejectDraft(draft.id)}
      primaryActionLabel="Approve & create asset"
    />
  );
}

/**
 * Edit / delete a PM schedule from any list (PM Due or asset detail).
 * Lets the operator change cadence, next-due date, name, or the
 * auto-create window. Delete clears all future cycles.
 */
function PmEditSheet({
  schedule,
  assetName,
  onClose,
}: {
  schedule: PmSchedule;
  assetName: string;
  onClose: () => void;
}) {
  const [name, setName] = React.useState(schedule.name);
  const [cadence, setCadence] = React.useState<PmCadence>(schedule.cadence);
  const [nextDue, setNextDue] = React.useState(schedule.next_due_at);
  const [active, setActive] = React.useState(schedule.active);
  const [autoDays, setAutoDays] = React.useState(
    String(schedule.auto_create_wo_days_ahead ?? 14)
  );
  const [notes, setNotes] = React.useState(schedule.description ?? "");

  function save() {
    if (!name.trim()) return;
    upsertPmSchedule({
      ...schedule,
      name: name.trim(),
      cadence,
      next_due_at: nextDue,
      active,
      auto_create_wo_days_ahead: Number(autoDays) || 14,
      description: notes.trim() || undefined,
    });
    onClose();
  }

  function remove() {
    if (!window.confirm(`Delete PM "${schedule.name}"? Future cycles will stop.`)) return;
    deletePmSchedule(schedule.id);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[460px] rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-fg">Edit PM</h3>
        <p className="mt-0.5 text-[12px] text-fg-subtle">{assetName}</p>

        <div className="mt-4 space-y-3">
          <Field label="PM name *" col={2}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Annual safety inspection"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cadence">
              <select
                value={cadence}
                onChange={(e) => setCadence(e.target.value as PmCadence)}
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="semi_annual">Semi-annual</option>
                <option value="annual">Annual</option>
              </select>
            </Field>
            <Field label="Next due">
              <input
                type="date"
                value={nextDue}
                onChange={(e) => setNextDue(e.target.value)}
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
              />
            </Field>
          </div>
          <Field label="Auto-create WO days ahead">
            <input
              value={autoDays}
              onChange={(e) => setAutoDays(e.target.value)}
              inputMode="numeric"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Notes" col={2}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </Field>
          <label className="flex items-center gap-2 text-[12px] text-fg">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active — pause this PM by unchecking
          </label>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={remove}
            className="rounded-[8px] px-3 py-1.5 text-[12px] text-status-danger hover:bg-status-danger/10"
          >
            Delete PM
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[8px] px-3 py-1.5 text-[13px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="rounded-[10px] bg-primary px-3 py-2 text-[13px] font-medium text-on-primary hover:bg-primary-hover"
            >
              Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
