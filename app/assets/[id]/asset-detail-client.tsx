"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, MapPin, Plus, Wrench, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { PageShell } from "@/components/page-shell";
import { formatMoney } from "@/lib/mock-data";
import {
  nextPmScheduleId,
  upsertPmSchedule,
  useMarinaAssets,
  usePmSchedulesForAsset,
  useStaff,
  useStore,
  useVendors,
} from "@/lib/client-store";
import { cn } from "@/lib/utils";
import type { PmCadence } from "@/lib/types";
import { AssetKindIcon, assetKindLabel } from "@/components/assets/asset-kind";

export function AssetDetailClient({ id }: { id: string }) {
  const assets = useMarinaAssets();
  const asset = assets.find((a) => a.id === id);
  const schedules = usePmSchedulesForAsset(id);
  const { workOrders } = useStore();
  const vendors = useVendors();
  const staff = useStaff();
  const [creatingPm, setCreatingPm] = React.useState(false);

  const vendor = asset?.service_vendor_id
    ? vendors.find((v) => v.id === asset.service_vendor_id)
    : null;
  const linkedWos = workOrders.filter(
    (w) => w.boater_id === `__asset__${id}`
  );

  if (!asset) {
    return (
      <PageShell title="Asset" description="">
        <div className="rounded-[12px] border border-hairline bg-surface-1 p-6 text-center text-[13px] text-fg-tertiary">
          Asset not found.{" "}
          <Link href="/assets" className="text-primary hover:underline">
            Back to assets
          </Link>
        </div>
      </PageShell>
    );
  }

  // Depreciation estimate — straight-line over 7 years for v1.
  let depreciatedValue: number | null = null;
  if (asset.purchase_price && asset.purchase_date) {
    const yearsOwned =
      (Date.now() - new Date(asset.purchase_date).getTime()) /
      (365.25 * 86_400_000);
    depreciatedValue = Math.max(
      0,
      asset.purchase_price * Math.max(0, 1 - yearsOwned / 7)
    );
  }

  // Warranty days remaining
  const warrantyDays = asset.warranty_until
    ? Math.round(
        (new Date(asset.warranty_until).getTime() - Date.now()) / 86_400_000
      )
    : null;

  return (
    <PageShell
      title={asset.name}
      description={assetKindLabel(asset.kind)}
      width="wide"
    >
      <Link
        href="/assets"
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-fg-subtle hover:text-fg"
      >
        <ArrowLeft className="size-3.5" /> Back to assets
      </Link>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Identity">
          <div className="space-y-1.5 text-[13px]">
            <div className="inline-flex items-center gap-2 text-fg">
              <AssetKindIcon kind={asset.kind} className="size-4 text-fg-subtle" />
              <span>{assetKindLabel(asset.kind)}</span>
            </div>
            {asset.manufacturer && (
              <Row label="Make" value={asset.manufacturer} />
            )}
            {asset.model && <Row label="Model" value={asset.model} />}
            {asset.serial_number && (
              <Row
                label="Serial"
                value={<span className="font-mono">{asset.serial_number}</span>}
              />
            )}
            {asset.location && (
              <Row
                label="Location"
                value={
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" />
                    {asset.location}
                  </span>
                }
              />
            )}
            <Row
              label="Status"
              value={
                <Badge
                  tone={
                    asset.status === "active"
                      ? "ok"
                      : asset.status === "in_maintenance"
                      ? "warn"
                      : "neutral"
                  }
                  size="sm"
                >
                  {asset.status.replace("_", " ")}
                </Badge>
              }
            />
          </div>
        </Panel>

        <Panel title="Purchase + warranty">
          <div className="space-y-1.5 text-[13px]">
            {asset.purchase_date && <Row label="Bought" value={asset.purchase_date} />}
            {asset.purchase_price !== undefined && (
              <Row label="Price" value={formatMoney(asset.purchase_price)} />
            )}
            {depreciatedValue !== null && (
              <Row
                label="Depreciated (7yr SL)"
                value={
                  <span className="money-display text-[13px]">
                    {formatMoney(depreciatedValue)}
                  </span>
                }
              />
            )}
            {asset.warranty_until && (
              <Row
                label="Warranty until"
                value={
                  <span
                    className={cn(
                      warrantyDays !== null && warrantyDays <= 0
                        ? "text-status-danger"
                        : warrantyDays !== null && warrantyDays <= 90
                        ? "text-status-warn"
                        : "text-fg"
                    )}
                  >
                    {asset.warranty_until}
                    {warrantyDays !== null && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide">
                        {warrantyDays <= 0 ? "expired" : `${warrantyDays}d`}
                      </span>
                    )}
                  </span>
                }
              />
            )}
            {asset.notes && (
              <div className="mt-2 rounded-[8px] border border-hairline bg-surface-2 p-2 text-[12px] text-fg-subtle">
                {asset.notes}
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Service vendor">
          {vendor ? (
            <div className="space-y-1.5 text-[13px]">
              <Link
                href={`/vendors/${vendor.id}`}
                className="text-[14px] font-medium text-fg hover:underline"
              >
                {vendor.display_name ?? vendor.name}
              </Link>
              {vendor.contact_name && (
                <Row label="Contact" value={vendor.contact_name} />
              )}
              {vendor.email && <Row label="Email" value={vendor.email} />}
              {vendor.phone && <Row label="Phone" value={vendor.phone} />}
            </div>
          ) : (
            <p className="text-[12px] text-fg-tertiary">No service vendor on file.</p>
          )}
        </Panel>
      </div>

      {/* PM schedules */}
      <div className="mb-4 rounded-[12px] border border-hairline bg-surface-1">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
          <div className="inline-flex items-center gap-1.5 text-[13px] font-medium text-fg">
            <Wrench className="size-3.5" />
            PM schedules ({schedules.length})
          </div>
          <Button variant="primary" size="sm" onClick={() => setCreatingPm(true)}>
            <Plus className="size-3.5" />
            New PM
          </Button>
        </div>
        {schedules.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-fg-tertiary">
            No PM schedule yet. Add one to auto-create work orders before due dates.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {schedules.map((p) => {
              const days = Math.round(
                (new Date(p.next_due_at).getTime() - Date.now()) / 86_400_000
              );
              const assignedTo = p.assigned_to_staff_id
                ? staff.find((s) => s.id === p.assigned_to_staff_id)?.name
                : null;
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-fg">{p.name}</span>
                      <Badge tone="neutral" size="sm">
                        {p.cadence}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-fg-tertiary">
                      Due {p.next_due_at}
                      {p.last_completed_at ? ` · last ${p.last_completed_at}` : ""}
                      {assignedTo ? ` · ${assignedTo}` : ""}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "text-[12px] font-medium",
                      days <= 0
                        ? "text-status-danger"
                        : days <= p.auto_create_wo_days_ahead
                        ? "text-status-warn"
                        : "text-fg-subtle"
                    )}
                  >
                    {days <= 0 ? `${Math.abs(days)}d overdue` : `${days}d`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Linked WOs */}
      <div className="rounded-[12px] border border-hairline bg-surface-1">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
          <div className="inline-flex items-center gap-1.5 text-[13px] font-medium text-fg">
            <Calendar className="size-3.5" />
            Linked work orders ({linkedWos.length})
          </div>
        </div>
        {linkedWos.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-fg-tertiary">
            No work orders linked to this asset yet.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {linkedWos.map((w) => (
              <li
                key={w.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/work-orders/${w.id}`}
                    className="text-[13px] font-medium text-fg hover:underline"
                  >
                    {w.number} · {w.subject}
                  </Link>
                  <div className="text-[11px] text-fg-tertiary">
                    {w.due_date ? `Due ${w.due_date}` : ""}
                    {w.assignee_user_id ? ` · ${staff.find((s) => s.id === w.assignee_user_id)?.name ?? w.assignee_user_id}` : ""}
                  </div>
                </div>
                <Badge
                  tone={
                    w.status === "completed"
                      ? "ok"
                      : w.status === "blocked"
                      ? "danger"
                      : "info"
                  }
                  size="sm"
                >
                  {w.status.replace("_", " ")}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      {creatingPm && (
        <NewPmSheet
          assetId={asset.id}
          staff={staff}
          onClose={() => setCreatingPm(false)}
        />
      )}
    </PageShell>
  );
}

function NewPmSheet({
  assetId,
  staff,
  onClose,
}: {
  assetId: string;
  staff: ReturnType<typeof useStaff>;
  onClose: () => void;
}) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [cadence, setCadence] = React.useState<PmCadence>("annual");
  const [nextDueAt, setNextDueAt] = React.useState(
    new Date().toISOString().slice(0, 10)
  );
  const [autoDays, setAutoDays] = React.useState("14");
  const [assignedStaffId, setAssignedStaffId] = React.useState("");

  const staffOptions: ComboboxOption[] = staff.map((s) => ({
    value: s.id,
    label: s.name,
    hint: s.default_position ?? undefined,
  }));

  function save() {
    if (!name.trim() || !nextDueAt) return;
    upsertPmSchedule({
      id: nextPmScheduleId(),
      tenant_id: "",
      asset_id: assetId,
      name: name.trim(),
      description: description.trim() || undefined,
      cadence,
      next_due_at: nextDueAt,
      auto_create_wo_days_ahead: Number(autoDays) || 14,
      assigned_to_staff_id: assignedStaffId || undefined,
      active: true,
      created_at: new Date().toISOString(),
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[440px] rounded-[16px] border border-hairline bg-surface-1 p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-fg">New PM schedule</h3>
        <div className="mt-4 space-y-3">
          <PmField label="Name *">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Annual safety inspection"
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </PmField>
          <PmField label="Description">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
            />
          </PmField>
          <PmField label="Cadence">
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
          </PmField>
          <div className="grid grid-cols-2 gap-3">
            <PmField label="Next due *">
              <input
                type="date"
                value={nextDueAt}
                onChange={(e) => setNextDueAt(e.target.value)}
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
              />
            </PmField>
            <PmField label="Auto-create days ahead">
              <input
                value={autoDays}
                onChange={(e) => setAutoDays(e.target.value)}
                inputMode="numeric"
                className="block w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 py-1.5 text-[13px] text-fg focus:border-primary focus:outline-none"
              />
            </PmField>
          </div>
          <PmField label="Assigned to">
            <Combobox
              value={assignedStaffId}
              onChange={setAssignedStaffId}
              options={staffOptions}
              placeholder="Unassigned"
            />
          </PmField>
        </div>
        <div className="mt-4 flex justify-end gap-2">
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
            disabled={!name.trim() || !nextDueAt}
            className={cn(
              "rounded-[10px] px-3 py-2 text-[13px] font-medium transition-colors",
              name.trim() && nextDueAt
                ? "bg-primary text-on-primary hover:bg-primary-hover"
                : "cursor-not-allowed bg-surface-3 text-fg-tertiary"
            )}
          >
            Save PM
          </button>
        </div>
      </div>
    </div>
  );
}

function PmField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <h2 className="mb-3 text-[12px] font-medium uppercase tracking-wide text-fg-tertiary">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-fg-tertiary">{label}</span>
      <span className="text-right text-[13px] text-fg">{value}</span>
    </div>
  );
}
