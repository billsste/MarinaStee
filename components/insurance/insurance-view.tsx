"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Plus, Search, ShieldCheck, ShieldOff, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import {
  useStore,
  upsertInsuranceCertificate as upsertInsurance,
  deleteInsuranceCertificate as deleteInsurance,
} from "@/lib/client-store";
import { BOATERS, VESSELS, formatMoney } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import type { InsuranceCertificate } from "@/lib/types";

/*
 * Global COI / insurance pipeline. Surfaces every certificate across every
 * holder, bucketed by lifecycle state (Current / Expiring / Expired /
 * Missing). Designed for the "did the marina chase renewals this week?"
 * morning-coffee question.
 *
 * "Missing" rows are synthesized — they're holders whose vessels have no
 * matching certificate on file.
 */

type StatusBucket = "current" | "expiring" | "expired" | "missing";

const COI_FIELDS: FieldSpec<InsuranceCertificate>[] = [
  {
    key: "boater_id",
    label: "Holder",
    kind: "select",
    required: true,
    options: BOATERS.map((b) => ({ value: b.id, label: b.display_name })),
  },
  {
    key: "vessel_id",
    label: "Vessel",
    kind: "select",
    required: true,
    options: VESSELS.map((v) => ({ value: v.id, label: `${v.name} (${v.year ?? "?"})` })),
  },
  { key: "carrier", label: "Carrier", kind: "text", required: true, col: 2 },
  { key: "policy_number", label: "Policy #", kind: "text", required: true, col: 2 },
  { key: "liability_limit", label: "Liability limit ($)", kind: "money", col: 2, step: "1" },
  { key: "hull_value", label: "Hull value ($)", kind: "money", col: 2, step: "1" },
  { key: "effective_start", label: "Effective start", kind: "date", col: 2 },
  { key: "effective_end", label: "Effective end", kind: "date", col: 2 },
  { key: "pdf_url", label: "PDF URL (optional)", kind: "text" },
];

const EXPIRING_WINDOW_DAYS = 60;

export function InsuranceView() {
  const { insurance } = useStore();
  const [bucket, setBucket] = React.useState<StatusBucket | "all">("all");
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<InsuranceCertificate | undefined>();
  const [open, setOpen] = React.useState(false);

  function openAdd() {
    setEditing(undefined);
    setOpen(true);
  }
  function openEdit(c: InsuranceCertificate) {
    setEditing(c);
    setOpen(true);
  }
  function handleSave(values: InsuranceCertificate) {
    upsertInsurance({
      ...values,
      id: values.id || `ins_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      liability_limit: Number(values.liability_limit) || 0,
      hull_value: values.hull_value ? Number(values.hull_value) : undefined,
      uploaded_at: values.uploaded_at || new Date().toISOString(),
      uploaded_by: values.uploaded_by || "marina",
    });
  }
  function handleDelete(c: InsuranceCertificate) {
    deleteInsurance(c.id);
  }

  // Bucket every certificate
  const rows = React.useMemo(() => {
    const now = Date.now();
    const certs = insurance.map((c) => {
      const endMs = new Date(c.effective_end).getTime();
      const daysUntilExpiry = Math.round((endMs - now) / 86_400_000);
      const status: StatusBucket =
        daysUntilExpiry < 0
          ? "expired"
          : daysUntilExpiry <= EXPIRING_WINDOW_DAYS
            ? "expiring"
            : "current";
      const boater = BOATERS.find((b) => b.id === c.boater_id);
      const vessel = VESSELS.find((v) => v.id === c.vessel_id);
      return { kind: "cert" as const, cert: c, boater, vessel, daysUntilExpiry, status };
    });

    // Synthesize "missing" rows — vessels with no insurance on file
    const insuredVesselIds = new Set(insurance.map((c) => c.vessel_id));
    const missingRows = VESSELS.filter((v) => v.active && !insuredVesselIds.has(v.id)).map((v) => ({
      kind: "missing" as const,
      vessel: v,
      boater: BOATERS.find((b) => b.id === v.boater_id),
      status: "missing" as StatusBucket,
      daysUntilExpiry: null,
    }));

    return [...certs, ...missingRows];
  }, [insurance]);

  const counts = React.useMemo(() => {
    const c = { current: 0, expiring: 0, expired: 0, missing: 0 };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (bucket !== "all" && r.status !== bucket) return false;
      if (!q) return true;
      const hay = [
        r.kind === "cert" ? r.cert.carrier : "",
        r.kind === "cert" ? r.cert.policy_number : "",
        r.boater?.display_name ?? "",
        r.vessel?.name ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, bucket, query]);

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Current" value={counts.current} tone="ok" icon={<ShieldCheck className="size-4" />} />
        <KpiCard
          label={`Expiring ≤ ${EXPIRING_WINDOW_DAYS}d`}
          value={counts.expiring}
          tone="warn"
          icon={<AlertTriangle className="size-4" />}
        />
        <KpiCard label="Expired" value={counts.expired} tone="danger" icon={<ShieldOff className="size-4" />} />
        <KpiCard label="Missing" value={counts.missing} tone="neutral" icon={<Upload className="size-4" />} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-surface-1 px-3 py-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Carrier, policy #, holder, or vessel..."
            className="w-full rounded-[8px] border border-hairline bg-surface-2 py-1.5 pl-7 pr-2.5 text-[12px] text-fg outline-none placeholder:text-fg-tertiary focus:border-primary"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { v: "all", label: `All · ${rows.length}` },
              { v: "current", label: `Current · ${counts.current}` },
              { v: "expiring", label: `Expiring · ${counts.expiring}` },
              { v: "expired", label: `Expired · ${counts.expired}` },
              { v: "missing", label: `Missing · ${counts.missing}` },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setBucket(o.v as StatusBucket | "all")}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                bucket === o.v
                  ? "border-primary/40 bg-primary-soft text-primary"
                  : "border-hairline bg-surface-1 text-fg-muted hover:bg-surface-2"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <Button variant="primary" size="sm" className="ml-auto" onClick={openAdd}>
          <Plus className="size-3.5" />
          Upload COI
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_96px_120px] gap-3 border-b border-hairline bg-surface-2 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
          <span>Holder</span>
          <span>Vessel</span>
          <span>Carrier / Policy</span>
          <span className="text-right">Liability</span>
          <span className="text-right">Days</span>
          <span>Status</span>
        </div>
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-fg-subtle">
            No certificates match these filters.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {filtered.map((r) => {
              if (r.kind === "missing") {
                return (
                  <li
                    key={`miss-${r.vessel.id}`}
                    className="grid cursor-pointer grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_96px_120px] items-center gap-3 px-4 py-2.5 text-[13px] transition-colors hover:bg-surface-2"
                    onClick={openAdd}
                  >
                    <span className="truncate">
                      {r.boater ? (
                        <Link
                          href={`/holders/${r.boater.id}`}
                          className="font-medium text-fg hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.boater.display_name}
                        </Link>
                      ) : (
                        <span className="italic text-fg-tertiary">— unknown holder —</span>
                      )}
                    </span>
                    <span className="truncate text-fg-subtle">
                      {r.vessel.name}
                      {r.vessel.year ? ` · ${r.vessel.year}` : ""}
                    </span>
                    <span className="text-fg-tertiary italic">— no certificate uploaded —</span>
                    <span className="text-right text-fg-tertiary">—</span>
                    <span className="text-right text-fg-tertiary">—</span>
                    <span>
                      <Badge tone="neutral" size="sm">
                        <Upload className="size-3" />
                        Missing
                      </Badge>
                    </span>
                  </li>
                );
              }
              const tone =
                r.status === "current"
                  ? "ok"
                  : r.status === "expiring"
                    ? "warn"
                    : r.status === "expired"
                      ? "danger"
                      : "neutral";
              return (
                <li
                  key={r.cert.id}
                  onClick={() => openEdit(r.cert)}
                  className="grid cursor-pointer grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_96px_120px] items-center gap-3 px-4 py-2.5 text-[13px] transition-colors hover:bg-surface-2"
                >
                  <span className="truncate">
                    {r.boater ? (
                      <Link
                        href={`/holders/${r.boater.id}`}
                        className="font-medium text-fg hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.boater.display_name}
                      </Link>
                    ) : (
                      <span className="text-fg-tertiary">—</span>
                    )}
                  </span>
                  <span className="truncate text-fg-subtle">
                    {r.vessel?.name ?? "—"}
                    {r.vessel?.year ? ` · ${r.vessel.year}` : ""}
                  </span>
                  <span className="truncate text-fg-subtle">
                    <span className="text-fg">{r.cert.carrier}</span>
                    <span className="text-fg-tertiary"> · {r.cert.policy_number}</span>
                  </span>
                  <span className="text-right tabular text-fg">
                    {formatMoney(r.cert.liability_limit)}
                  </span>
                  <span
                    className={cn(
                      "text-right tabular text-[12px]",
                      r.status === "expired" && "text-status-danger",
                      r.status === "expiring" && "text-status-warn",
                      r.status === "current" && "text-fg-subtle"
                    )}
                  >
                    {r.daysUntilExpiry === null
                      ? "—"
                      : r.daysUntilExpiry < 0
                        ? `${-r.daysUntilExpiry}d ago`
                        : `${r.daysUntilExpiry}d`}
                  </span>
                  <span>
                    <Badge tone={tone} size="sm">
                      {r.status}
                    </Badge>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="text-[11px] text-fg-tertiary">
        <Badge tone="primary" size="sm">Agent</Badge>{" "}
        Try: "Send renewal reminders to everyone with COIs expiring in 30 days." Lapsed coverage is a liability risk — the
        "Missing" bucket lists vessels that need a certificate uploaded for the first time.
      </div>

      <RecordEditDialog<InsuranceCertificate>
        open={open}
        onOpenChange={setOpen}
        title={editing ? `Edit COI — ${editing.policy_number}` : "Upload COI"}
        description="Certificates are linked to a vessel and inherit the holder from there."
        record={editing}
        fields={COI_FIELDS}
        onSave={handleSave}
        onDelete={editing ? handleDelete : undefined}
        entity="insurance"
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "danger" | "neutral";
  icon: React.ReactNode;
}) {
  const toneClass =
    tone === "ok"
      ? "text-status-ok"
      : tone === "warn"
        ? "text-status-warn"
        : tone === "danger"
          ? "text-status-danger"
          : "text-fg-subtle";
  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
      <div className={cn("inline-flex items-center gap-1.5 text-[12px] font-medium", toneClass)}>
        {icon}
        {label}
      </div>
      <div className="money-display mt-1 text-[24px] text-fg">{value}</div>
    </div>
  );
}
