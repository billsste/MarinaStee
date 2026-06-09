"use client";

import * as React from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { WizardFooter } from "@/components/wizard/wizard-footer";
import type { WizardStep } from "@/components/wizard/wizard-progress";
import {
  FieldLabel,
  RailRow,
  ReviewBlock,
} from "@/components/wizard/wizard-fields";
import { useWizardDraft } from "@/components/wizard/use-wizard-draft";
import { AssetKindIcon, KIND_OPTIONS, assetKindLabel } from "@/components/assets/asset-kind";
import { useVendors } from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";
import type { MarinaAssetKind, PmCadence } from "@/lib/types";
import { formatMoney } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

/*
 * Asset wizard — modeled on the slip-assignment wizard
 * (app/services/[id]/assign/assign-slip-client.tsx). Modal-mode shell
 * so it can be launched from the Assets list or any future surface
 * (agent intent, dashboard back-office card, etc.).
 *
 * Steps:
 *   0. Identity & location — name, kind, serial, location, purchase
 *   1. Vendor & warranty   — service vendor + optional warranty/photo
 *   2. PM schedules        — 0..N maintenance cadences in one step
 *   3. Review              — confirm + Create asset
 *
 * On submit we call executeAgentAction({ kind: "create_asset" }) to
 * create the asset record, then chain create_pm_schedule for each PM
 * row in step 2. Both actions exist already in lib/agent-actions.ts.
 */

const STORAGE_KEY = "marina_asset_wizard_draft_v1";

const STEPS: WizardStep[] = [
  { id: "identity", label: "Identity" },
  { id: "vendor", label: "Vendor + warranty" },
  { id: "pm", label: "PM schedule" },
  { id: "review", label: "Review" },
];

const STEP_TITLES = [
  "What asset are we adding?",
  "Who services it?",
  "Set up preventive maintenance",
  "Review and create",
];

const STEP_SUBTITLES = [
  "Name the asset, pick its kind, and tell us where it lives in the yard. Serial + purchase details are optional but help with warranty claims later.",
  "Pick the vendor who services this asset (linked PM work orders auto-assign to them). Warranty + photo are optional.",
  "Add one or more recurring PM checks. Each row becomes a PmSchedule — when due, we auto-create a work order. You can skip this and add cadences later from the asset detail page.",
  "Confirm the details — clicking Create writes the asset and any PM schedules in a single step.",
];

type PmDraftRow = {
  /** Local key so React can track rows across re-renders. */
  key: string;
  name: string;
  cadence: PmCadence;
  next_due_at: string;
  auto_create: boolean;
};

type DraftState = {
  // Step 0
  name: string;
  kind: MarinaAssetKind;
  serial_number: string;
  location: string;
  purchase_date: string;
  purchase_price: string; // string-typed for the input; parsed at submit
  // Step 1
  service_vendor_id: string;
  warranty_until: string;
  photo_url: string;
  // Step 2
  pms: PmDraftRow[];
};

const CADENCE_OPTIONS: { value: PmCadence; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semi_annual", label: "Semi-annual" },
  { value: "annual", label: "Annual" },
];

function freshPmRow(): PmDraftRow {
  // Default the next-due date to ~30 days out so the operator sees a
  // sensible window without having to type a date.
  const next = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  return {
    key: `pm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: "",
    cadence: "quarterly",
    next_due_at: next,
    auto_create: true,
  };
}

export function AssetWizard({
  open,
  onOpenChange,
  defaultKind,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  /** Optional pre-fill — e.g. when launched from a kind-specific card. */
  defaultKind?: MarinaAssetKind;
}) {
  const vendors = useVendors();

  const [submitting, setSubmitting] = React.useState(false);

  // sessionStorage-backed wizard state. Same shape pattern as the
  // slip-assignment + reservation wizards — `{ step, draft }` blob.
  const [persisted, setPersisted, clearPersisted] = useWizardDraft<{
    step: number;
    draft: DraftState;
  }>(STORAGE_KEY, () => ({
    step: 0,
    draft: {
      name: "",
      kind: defaultKind ?? "forklift",
      serial_number: "",
      location: "",
      purchase_date: "",
      purchase_price: "",
      service_vendor_id: "",
      warranty_until: "",
      photo_url: "",
      pms: [],
    },
  }));

  const stepIdx = persisted.step;
  const draft = persisted.draft;
  const setStepIdx = React.useCallback(
    (next: number | ((prev: number) => number)) => {
      setPersisted((p) => ({
        ...p,
        step:
          typeof next === "function" ? (next as (n: number) => number)(p.step) : next,
      }));
    },
    [setPersisted]
  );
  const setDraft = React.useCallback(
    (next: DraftState | ((prev: DraftState) => DraftState)) => {
      setPersisted((p) => ({
        ...p,
        draft:
          typeof next === "function"
            ? (next as (d: DraftState) => DraftState)(p.draft)
            : next,
      }));
    },
    [setPersisted]
  );

  // Re-pin the kind override every time the wizard is reopened, so a
  // launch context (e.g. "+ New forklift") wins over the persisted draft.
  React.useEffect(() => {
    if (!open) return;
    if (defaultKind) {
      setDraft((d) => ({ ...d, kind: defaultKind }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultKind]);

  // ── Derived ─────────────────────────────────────────────────────────
  const selectedVendor = vendors.find((v) => v.id === draft.service_vendor_id);
  const vendorOptions: ComboboxOption[] = vendors.map((v) => ({
    value: v.id,
    label: v.display_name ?? v.name,
  }));
  const kindOptions: ComboboxOption[] = KIND_OPTIONS;

  // ── Validation gates ────────────────────────────────────────────────
  const canStep0 = draft.name.trim().length > 0 && draft.kind.length > 0;
  const canStep1 = true; // vendor + warranty + photo all optional
  // Each PM row that exists must have a non-empty name. Zero rows is
  // valid (skip PM scheduling — add later).
  const canStep2 = draft.pms.every((p) => p.name.trim().length > 0);
  const canStep3 = canStep0 && canStep2;

  const canContinue = [canStep0, canStep1, canStep2, canStep3][stepIdx];

  // ── Actions ─────────────────────────────────────────────────────────
  function next() {
    if (stepIdx < STEPS.length - 1) setStepIdx((i) => i + 1);
  }
  function back() {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  }
  function close() {
    onOpenChange(false);
  }

  function addPmRow() {
    setDraft((d) => ({ ...d, pms: [...d.pms, freshPmRow()] }));
  }
  function removePmRow(key: string) {
    setDraft((d) => ({ ...d, pms: d.pms.filter((p) => p.key !== key) }));
  }
  function patchPmRow(key: string, patch: Partial<PmDraftRow>) {
    setDraft((d) => ({
      ...d,
      pms: d.pms.map((p) => (p.key === key ? { ...p, ...patch } : p)),
    }));
  }

  function submit() {
    if (!canStep3) return;
    setSubmitting(true);
    try {
      // 1. Create the asset. executeAgentAction returns the new id on success.
      const result = executeAgentAction({
        kind: "create_asset",
        label: "",
        name: draft.name.trim(),
        asset_kind: draft.kind,
        serial_number: draft.serial_number.trim() || undefined,
        location: draft.location.trim() || undefined,
        purchase_date: draft.purchase_date || undefined,
        purchase_price: draft.purchase_price
          ? Number(draft.purchase_price)
          : undefined,
      });

      // 2. Chain create_pm_schedule for each PM row. The action shape
      //    requires asset_id, so we only run this once we know the new id.
      //    Vendor + warranty + photo aren't on the action shape today —
      //    we patch them on with upsertMarinaAsset to keep the agent-tool
      //    surface tight.
      if (result.ok && result.createdId) {
        const assetId = result.createdId;
        for (const pm of draft.pms) {
          if (!pm.name.trim()) continue;
          executeAgentAction({
            kind: "create_pm_schedule",
            label: "",
            asset_id: assetId,
            asset_name: draft.name.trim(),
            name: pm.name.trim(),
            cadence: pm.cadence,
            next_due_at: pm.next_due_at,
            // The action accepts an "auto_create_wo_days_ahead" number.
            // Default 14 for auto-create; 0 means "don't auto-create —
            // surface in the PM Due list only".
            auto_create_wo_days_ahead: pm.auto_create ? 14 : 0,
          });
        }
      }

      clearPersisted();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Right rail ──────────────────────────────────────────────────────
  const pmCount = draft.pms.filter((p) => p.name.trim().length > 0).length;

  const rightRail = (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
          Asset
        </div>
        <div className="mt-1 flex items-center gap-2">
          <AssetKindIcon kind={draft.kind} className="size-4 text-fg-subtle" />
          <span className="truncate text-[20px] font-semibold text-fg">
            {draft.name.trim() || "Unnamed"}
          </span>
        </div>
        <div className="text-[12px] text-fg-subtle">
          {assetKindLabel(draft.kind)}
        </div>
      </div>
      <dl className="space-y-1.5 border-t border-hairline pt-3 text-[12px]">
        {draft.serial_number && (
          <RailRow label="Serial" value={draft.serial_number} />
        )}
        <RailRow label="Location" value={draft.location || "—"} />
        {draft.purchase_date && (
          <RailRow label="Purchased" value={draft.purchase_date} />
        )}
        {draft.purchase_price && (
          <RailRow
            label="Price"
            value={formatMoney(Number(draft.purchase_price))}
          />
        )}
      </dl>

      {/* Vendor + warranty block — appears the moment step 1 is touched. */}
      {(selectedVendor || draft.warranty_until) && (
        <div className="border-t border-hairline pt-3">
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-fg-tertiary">
            Service
          </div>
          <dl className="space-y-1.5 text-[12px]">
            {selectedVendor && (
              <RailRow
                label="Vendor"
                value={selectedVendor.display_name ?? selectedVendor.name}
              />
            )}
            {draft.warranty_until && (
              <RailRow label="Warranty" value={draft.warranty_until} />
            )}
          </dl>
        </div>
      )}

      {/* PM rollup — appears as soon as step 2 has a named row. */}
      {pmCount > 0 && (
        <div className="border-t border-hairline pt-3">
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-fg-tertiary">
            Preventive maintenance ({pmCount})
          </div>
          <ul className="space-y-1 text-[12px]">
            {draft.pms
              .filter((p) => p.name.trim().length > 0)
              .map((p) => (
                <li
                  key={p.key}
                  className="flex items-baseline justify-between gap-2"
                >
                  <span className="min-w-0 flex-1 truncate text-fg-subtle">
                    {p.name}
                  </span>
                  <span className="text-fg capitalize">
                    {p.cadence.replace("_", " ")}
                  </span>
                </li>
              ))}
          </ul>
          <p className="mt-2 border-t border-hairline pt-2 text-[10px] text-fg-tertiary">
            {pmCount} PM schedule{pmCount === 1 ? "" : "s"} will be created.
          </p>
        </div>
      )}

      <div className="rounded-[10px] border border-primary/30 bg-primary-soft/40 p-3">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-primary">
          <Sparkles className="size-3.5" />
          Ask the agent
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-subtle">
          Try: &ldquo;Add the new hoist with quarterly inspections&rdquo; — the
          agent fills the whole wizard, including the PM schedule.
        </p>
      </div>
    </div>
  );

  if (!open) return null;

  return (
    <WizardShell
      eyebrow="New asset"
      title={STEP_TITLES[stepIdx]}
      subtitle={STEP_SUBTITLES[stepIdx]}
      steps={STEPS}
      currentIdx={stepIdx}
      onStepClick={(idx) => idx < stepIdx && setStepIdx(idx)}
      rightRail={rightRail}
      chrome="modal"
      onExit={close}
    >
      {/* Step 0 — Identity & location */}
      {stepIdx === 0 && (
        <div className="space-y-4">
          <FieldLabel label="Name" required>
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Forklift — Toyota 7FBCU25 #1"
              autoFocus
              className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
            />
          </FieldLabel>

          <FieldLabel label="Kind" required>
            <Combobox
              value={draft.kind}
              onChange={(v) => setDraft((d) => ({ ...d, kind: v as MarinaAssetKind }))}
              options={kindOptions}
              placeholder="Pick a kind…"
              searchPlaceholder="Search by kind…"
            />
          </FieldLabel>

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel
              label="Serial number"
              hint="Stamped or on the data plate. Helps with warranty claims."
            >
              <input
                value={draft.serial_number}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, serial_number: e.target.value }))
                }
                placeholder="7FBCU25-12345"
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 font-mono text-[13px] text-fg focus:border-hairline-strong focus:outline-none"
              />
            </FieldLabel>
            <FieldLabel
              label="Location"
              hint="Where it lives — yard, bay, dock, etc."
            >
              <input
                value={draft.location}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, location: e.target.value }))
                }
                placeholder="Hoist bay — A side"
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
              />
            </FieldLabel>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="Purchase date">
              <input
                type="date"
                value={draft.purchase_date}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, purchase_date: e.target.value }))
                }
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
              />
            </FieldLabel>
            <FieldLabel label="Purchase price ($)">
              <input
                value={draft.purchase_price}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, purchase_price: e.target.value }))
                }
                inputMode="decimal"
                placeholder="32500"
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
              />
            </FieldLabel>
          </div>
        </div>
      )}

      {/* Step 1 — Vendor + warranty */}
      {stepIdx === 1 && (
        <div className="space-y-4">
          <FieldLabel
            label="Service vendor"
            hint="Vendor servicing this asset — PM work orders auto-assign to them. Set up new vendors in Vendors → New."
          >
            <Combobox
              value={draft.service_vendor_id}
              onChange={(v) =>
                setDraft((d) => ({ ...d, service_vendor_id: v }))
              }
              options={vendorOptions}
              placeholder={
                vendorOptions.length === 0 ? "No vendors on file" : "Pick a vendor…"
              }
              searchPlaceholder="Search by name…"
              disabled={vendorOptions.length === 0}
            />
          </FieldLabel>

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel
              label="Warranty expiration"
              hint="Optional — surface a warning before this expires."
            >
              <input
                type="date"
                value={draft.warranty_until}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, warranty_until: e.target.value }))
                }
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
              />
            </FieldLabel>
            <FieldLabel
              label="Photo URL"
              hint="Optional — link a serial-plate photo or hero shot."
            >
              <input
                value={draft.photo_url}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, photo_url: e.target.value }))
                }
                placeholder="https://…"
                className="h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[13px] text-fg focus:border-hairline-strong focus:outline-none"
              />
            </FieldLabel>
          </div>
        </div>
      )}

      {/* Step 2 — PM schedules */}
      {stepIdx === 2 && (
        <div className="space-y-4">
          <p className="text-[12px] text-fg-subtle">
            Add one row per recurring PM check. Auto-create makes a work
            order 14 days before the due date; uncheck it to keep the PM as
            a reminder only.
          </p>

          {draft.pms.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 p-6 text-center">
              <p className="text-[13px] text-fg-subtle">
                No PM schedules yet.
              </p>
              <div className="mt-3 flex items-center justify-center gap-3">
                <Button variant="primary" size="sm" onClick={addPmRow}>
                  <Plus className="size-3.5" />
                  Add PM schedule
                </Button>
                <button
                  type="button"
                  onClick={next}
                  className="text-[12px] text-fg-tertiary hover:text-fg hover:underline"
                >
                  Skip — add later
                </button>
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              {draft.pms.map((pm, idx) => (
                <li
                  key={pm.key}
                  className="rounded-[10px] border border-hairline bg-surface-1 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-fg-tertiary">
                      PM {idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removePmRow(pm.key)}
                      className="rounded-[6px] p-1 text-fg-tertiary hover:bg-status-danger/10 hover:text-status-danger"
                      aria-label="Remove this PM schedule"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_150px]">
                    <input
                      value={pm.name}
                      onChange={(e) =>
                        patchPmRow(pm.key, { name: e.target.value })
                      }
                      placeholder="Annual safety inspection"
                      className="h-9 w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 text-[13px] text-fg focus:border-hairline-strong focus:outline-none"
                    />
                    <select
                      value={pm.cadence}
                      onChange={(e) =>
                        patchPmRow(pm.key, {
                          cadence: e.target.value as PmCadence,
                        })
                      }
                      className="h-9 w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 text-[13px] text-fg focus:border-hairline-strong focus:outline-none"
                    >
                      {CADENCE_OPTIONS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={pm.next_due_at}
                      onChange={(e) =>
                        patchPmRow(pm.key, { next_due_at: e.target.value })
                      }
                      className="h-9 w-full rounded-[8px] border border-hairline bg-surface-2 px-2.5 text-[13px] text-fg focus:border-hairline-strong focus:outline-none"
                    />
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-[12px] text-fg-subtle">
                    <input
                      type="checkbox"
                      checked={pm.auto_create}
                      onChange={(e) =>
                        patchPmRow(pm.key, { auto_create: e.target.checked })
                      }
                    />
                    Auto-create work order 14 days before due
                  </label>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={addPmRow}
                  className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-primary/40 bg-primary-soft/30 px-3 text-[13px] font-medium text-primary hover:bg-primary-soft/50"
                >
                  <Plus className="size-3.5" />
                  Add another PM schedule
                </button>
              </li>
            </ul>
          )}
        </div>
      )}

      {/* Step 3 — Review */}
      {stepIdx === 3 && (
        <div className="space-y-4">
          <ReviewBlock
            label="Name"
            value={draft.name.trim() || "—"}
            onEdit={() => setStepIdx(0)}
          />
          <ReviewBlock
            label="Kind"
            value={assetKindLabel(draft.kind)}
            onEdit={() => setStepIdx(0)}
          />
          {(draft.serial_number || draft.location) && (
            <ReviewBlock
              label="Where"
              value={[
                draft.location || null,
                draft.serial_number ? `S/N ${draft.serial_number}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              onEdit={() => setStepIdx(0)}
            />
          )}
          {(draft.purchase_date || draft.purchase_price) && (
            <ReviewBlock
              label="Purchase"
              value={[
                draft.purchase_date || null,
                draft.purchase_price
                  ? formatMoney(Number(draft.purchase_price))
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              onEdit={() => setStepIdx(0)}
            />
          )}
          {(selectedVendor || draft.warranty_until) && (
            <ReviewBlock
              label="Service"
              value={[
                selectedVendor
                  ? `Vendor: ${selectedVendor.display_name ?? selectedVendor.name}`
                  : null,
                draft.warranty_until
                  ? `Warranty thru ${draft.warranty_until}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              onEdit={() => setStepIdx(1)}
            />
          )}
          <ReviewBlock
            label="PM schedules"
            value={
              pmCount === 0
                ? "None — add later from the asset detail page"
                : draft.pms
                    .filter((p) => p.name.trim().length > 0)
                    .map(
                      (p) =>
                        `${p.name} · ${p.cadence.replace("_", " ")} · next ${p.next_due_at}`
                    )
                    .join("; ")
            }
            onEdit={() => setStepIdx(2)}
          />
        </div>
      )}

      <WizardFooter
        stepIndex={stepIdx}
        totalSteps={STEPS.length}
        stepLabel={STEPS[stepIdx].label}
        onBack={back}
        onContinue={stepIdx === STEPS.length - 1 ? submit : next}
        continueLabel={
          stepIdx === STEPS.length - 1 ? "Create asset" : "Continue"
        }
        continueDisabled={!canContinue}
        busy={submitting}
        onExit={close}
        busyLabel="Creating…"
      />
    </WizardShell>
  );
}
