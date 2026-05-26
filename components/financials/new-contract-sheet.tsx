"use client";

import * as React from "react";
import { CreateSheet, Field, NumberInput, Select, TextInput } from "@/components/create-sheet";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { NewBoaterSheet } from "@/components/boaters/new-boater-sheet";
import { BOATERS, CONTRACT_TEMPLATES, RENTAL_SPACES, SLIPS, VESSELS } from "@/lib/mock-data";
import { useBoaters } from "@/lib/client-store";
import { executeAgentAction } from "@/lib/agent-actions";

export function NewContractSheet({
  open,
  onOpenChange,
  defaultBoaterId,
  defaultSlipId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  defaultBoaterId?: string;
  defaultSlipId?: string;
}) {
  const liveBoaters = useBoaters();
  const boaters = liveBoaters.length > 0 ? liveBoaters : BOATERS;

  const [boaterId, setBoaterId] = React.useState(defaultBoaterId ?? "");
  const [templateId, setTemplateId] = React.useState<string>(
    CONTRACT_TEMPLATES[0]?.id ?? ""
  );
  const [vesselId, setVesselId] = React.useState("");
  const [slipId, setSlipId] = React.useState("");
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");
  const [annualRate, setAnnualRate] = React.useState("");
  const [cadence, setCadence] = React.useState<"annual" | "seasonal" | "monthly" | "transient">("monthly");
  const [newHolderOpen, setNewHolderOpen] = React.useState(false);
  // Attachments (signed PDF, addenda, supporting docs). Stored locally
  // as { name, dataUrl, type } and passed through to executeAgentAction
  // when the contract is drafted. In the prototype, the data URL goes
  // into Contract.attachments[]; in production it would upload to S3
  // and the URL would replace the data URL.
  type LocalAttachment = { name: string; dataUrl: string; mime: string; sizeBytes: number };
  const [attachments, setAttachments] = React.useState<LocalAttachment[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setBoaterId(defaultBoaterId ?? "");
      const firstTpl = CONTRACT_TEMPLATES[0];
      setTemplateId(firstTpl?.id ?? "");
      setVesselId("");
      setSlipId(defaultSlipId ?? "");
      const today = new Date().toISOString().slice(0, 10);
      setStart(today);
      const monthsAhead = firstTpl?.default_term_months ?? 12;
      const endDate = new Date(Date.now() + monthsAhead * 30 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      setEnd(endDate);
      setAnnualRate(firstTpl?.default_annual_rate?.toString() ?? "");
      setCadence(firstTpl?.default_billing_cadence ?? "monthly");
      setAttachments([]);
    }
  }, [open, defaultBoaterId, defaultSlipId]);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const reads = await Promise.all(
      files.map(
        (f) =>
          new Promise<LocalAttachment>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                name: f.name,
                dataUrl: typeof reader.result === "string" ? reader.result : "",
                mime: f.type || "application/octet-stream",
                sizeBytes: f.size,
              });
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(f);
          })
      )
    );
    setAttachments((prev) => [...prev, ...reads]);
    // Reset input so selecting the same file again still fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  // When template changes, reset rate + cadence + suggested end date
  React.useEffect(() => {
    const tpl = CONTRACT_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    setCadence(tpl.default_billing_cadence);
    if (tpl.default_annual_rate) {
      setAnnualRate(tpl.default_annual_rate.toString());
    }
    if (start) {
      const endDate = new Date(
        new Date(start).getTime() + tpl.default_term_months * 30 * 86_400_000
      )
        .toISOString()
        .slice(0, 10);
      setEnd(endDate);
    }
  }, [templateId, start]);

  const boater = boaters.find((b) => b.id === boaterId);
  const vesselOptions = boater
    ? VESSELS.filter((v) => v.boater_id === boater.id || v.co_owner_ids.includes(boater.id))
    : VESSELS;

  const canSubmit =
    boaterId.length > 0 &&
    templateId.length > 0 &&
    start.length > 0 &&
    end.length > 0 &&
    start <= end;

  function submit() {
    if (!canSubmit) return;
    executeAgentAction({
      kind: "create_contract",
      label: "",
      boater_id: boaterId,
      template_id: templateId,
      vessel_id: vesselId || undefined,
      slip_id: slipId || undefined,
      effective_start: start,
      effective_end: end,
      annual_rate: annualRate ? Number(annualRate) : undefined,
      billing_cadence: cadence,
      attachments: attachments.length > 0
        ? attachments.map((a) => ({
            name: a.name,
            url: a.dataUrl,
            mime_type: a.mime,
            size_bytes: a.sizeBytes,
            type: "supporting_doc",
          }))
        : undefined,
    });
    onOpenChange(false);
  }

  function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  // Context-aware framing: when launched from a vacant slip (defaultSlipId
  // present), the user mental model is "assign this slip to a holder" —
  // the underlying contract is an implementation detail. Reframe the
  // title + CTA accordingly. Otherwise it's a free-standing new contract.
  const fromSlip = Boolean(defaultSlipId);
  // Look up the slip in BOTH inventories — Roster uses SLIPS (ids like
  // "A01") while the older RENTAL_SPACES uses ids like "sp_dsm_a_29".
  const slipForTitle = fromSlip
    ? SLIPS.find((s) => s.id === defaultSlipId) ??
      RENTAL_SPACES.find((s) => s.id === defaultSlipId)
    : null;
  const dialogTitle = fromSlip
    ? `Assign slip ${slipForTitle?.number ?? defaultSlipId}`
    : "New contract";
  const dialogDescription = fromSlip
    ? "Pick a holder and term to claim this slip. The system drafts the underlying contract — you can send it for signature from the holder's Contracts list after."
    : "Pick a template, set the term, and Marina Stee drafts the agreement. Send for signature from the holder's Contracts list after.";
  const ctaLabel = fromSlip ? "Assign holder" : "Draft contract";

  return (
    <CreateSheet
      open={open}
      onOpenChange={onOpenChange}
      title={dialogTitle}
      description={dialogDescription}
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
            {ctaLabel}
          </Button>
        </>
      }
    >
      {/* Inline create-new-holder dialog launched from the Holder selector */}
      <NewBoaterSheet
        open={newHolderOpen}
        onOpenChange={(b) => {
          setNewHolderOpen(b);
          // When the holder sheet closes, the new holder lands in the
          // useBoaters store; auto-pick the most recently created one so
          // the contract flow continues without an extra selection step.
          if (!b) {
            const sorted = [...liveBoaters].sort((a, c) => (a.id < c.id ? 1 : -1));
            const latest = sorted[0];
            if (latest && !boaters.find((x) => x.id === boaterId)) {
              setBoaterId(latest.id);
            }
          }
        }}
      />

      <div className="space-y-3">
        <Field label="Holder" required>
          <Combobox
            value={boaterId}
            onChange={setBoaterId}
            options={boaters.map((b) => ({
              value: b.id,
              label: b.display_name,
              hint: b.code ? `· ${b.code}` : undefined,
            }))}
            placeholder="Pick a holder…"
            searchPlaceholder="Search by name, code…"
            onCreateNew={() => setNewHolderOpen(true)}
            createNewLabel="Create new holder"
          />
        </Field>

        <Field label="Template" required>
          <Select value={templateId} onChange={setTemplateId}>
            {CONTRACT_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · v{t.version}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Vessel">
            <Select value={vesselId} onChange={setVesselId}>
              <option value="">No vessel</option>
              {vesselOptions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Slip">
            <Combobox
              value={slipId}
              onChange={setSlipId}
              options={SLIPS.map((s) => ({
                value: s.id,
                label: s.id,
                hint: `· ${s.dock}`,
              }))}
              placeholder="No slip"
              searchPlaceholder="Search by slip ID, dock…"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Effective start" required>
            <TextInput type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Effective end" required>
            <TextInput type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Annual rate ($)">
            <NumberInput
              step="1"
              value={annualRate}
              onChange={(e) => setAnnualRate(e.target.value)}
              placeholder="3900"
            />
          </Field>
          <Field label="Billing cadence">
            <Select value={cadence} onChange={(v) => setCadence(v as typeof cadence)}>
              <option value="monthly">Monthly</option>
              <option value="seasonal">Seasonal (lump)</option>
              <option value="annual">Annual (lump)</option>
              <option value="transient">Transient (per-stay)</option>
            </Select>
          </Field>
        </div>

        {start && end && start > end && (
          <p className="text-[12px] text-status-danger">End must be on or after start.</p>
        )}

        {/* Attachments — signed PDF, addenda, supporting docs */}
        <Field
          label="Attachments"
          hint="Optional. PDFs, DOCX, scans of signed contracts, addenda, COI riders, etc."
        >
          <div className="space-y-2">
            <label className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 px-4 py-3 text-[12px] text-fg-subtle hover:bg-surface-3">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
                onChange={handleFileSelect}
                className="hidden"
              />
              <span>+ Add attachment(s)</span>
            </label>
            {attachments.length > 0 && (
              <ul className="space-y-1.5">
                {attachments.map((a, idx) => (
                  <li
                    key={`${a.name}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded-[8px] border border-hairline bg-surface-2 px-3 py-1.5 text-[12px]"
                  >
                    <div className="min-w-0 flex-1 truncate">
                      <span className="font-medium text-fg">{a.name}</span>
                      <span className="ml-2 text-fg-tertiary">{fmtSize(a.sizeBytes)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttachment(idx)}
                      className="text-[11px] text-fg-subtle hover:text-status-danger"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Field>
      </div>
    </CreateSheet>
  );
}
