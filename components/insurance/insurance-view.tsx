"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { anyApi } from "convex/server";
import { AlertTriangle, Plus, Search, ShieldCheck, ShieldOff, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilterSelect } from "@/components/ui/list-filter-select";
import { RecordEditDialog, type FieldSpec } from "@/components/record-edit-dialog";
import { ExpiringSection } from "@/components/insurance/expiring-section";
import {
  useBoaters,
  useStore,
  useVessels,
  upsertInsuranceCertificate as upsertInsurance,
  deleteInsuranceCertificate as deleteInsurance,
} from "@/lib/client-store";
import { formatMoney } from "@/lib/mock-data";
import { useTenantMutation } from "@/lib/use-tenant-mutation";
import { useTenantQuery } from "@/lib/use-tenant-query";
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

// Grid template column spec for the COI table. Inlined as a JS constant
// instead of a Tailwind arbitrary class because the JIT silently drops
// decimal `fr` units inside minmax(...) which made the rows collapse.
const COI_COLS =
  "minmax(0, 1.6fr) minmax(0, 1.4fr) minmax(0, 1.2fr) minmax(0, 1fr) 96px 120px";

// Static field shape (no tenant data) — boater + vessel options are
// injected per-render inside the component so the dropdown only ever
// shows the active tenant's records.
const COI_STATIC_FIELDS: FieldSpec<InsuranceCertificate>[] = [
  { key: "carrier", label: "Carrier", kind: "text", required: true, col: 2 },
  { key: "policy_number", label: "Policy #", kind: "text", required: true, col: 2 },
  { key: "liability_limit", label: "Liability limit ($)", kind: "money", col: 2, step: "1" },
  { key: "hull_value", label: "Hull value ($)", kind: "money", col: 2, step: "1" },
  { key: "effective_start", label: "Effective start", kind: "date", col: 2 },
  { key: "effective_end", label: "Effective end", kind: "date", col: 2 },
  { key: "pdf_url", label: "PDF URL (optional)", kind: "text" },
];

const EXPIRING_WINDOW_DAYS = 60;

// Convex shape of an `insuranceCertificates` row. The Convex schema
// today carries fewer fields than the mock — notably no `vessel_id`,
// `liability_limit` is `coverage_amount`, `hull_value` / `pdf_url` /
// `uploaded_at` / `uploaded_by` aren't in schema yet. We carry the
// gap forward in the adapter (mock-only fields land as undefined /
// 0 / "marina") so the page still renders. Convex schema extension
// for these is owned by the Insurance COI agent (see
// convex/insuranceCoi.ts in the in-flight plan).
interface ConvexInsuranceCertificate {
  _id: string;
  tenantId: string;
  _creationTime?: number;
  boater_id: string;
  carrier: string;
  policy_number: string;
  effective_start: string;
  effective_end: string;
  coverage_amount?: number;
  status?: "active" | "expiring_soon" | "expired" | "lapsed";
  upload_token?: string;
}

function convexCoiToMock(
  rows: ConvexInsuranceCertificate[],
): InsuranceCertificate[] {
  return rows.map((r) => ({
    id: r._id,
    // vessel_id has no Convex column yet — leave empty; the page
    // gracefully renders "—" for unknown vessels via the
    // `vessels.find()` fallback.
    vessel_id: "",
    boater_id: r.boater_id,
    carrier: r.carrier,
    policy_number: r.policy_number,
    liability_limit: r.coverage_amount ?? 0,
    effective_start: r.effective_start,
    effective_end: r.effective_end,
    uploaded_at: r._creationTime
      ? new Date(r._creationTime).toISOString()
      : new Date().toISOString(),
    uploaded_by: "marina",
    upload_token: r.upload_token,
  }));
}

const COI_EMPTY_ARGS = {} as const;

export function InsuranceView() {
  // Mock subscription kept unconditional. `useTenantQuery` swaps in
  // the live Convex result when online.
  const { insurance: mockInsurance } = useStore();
  const insurance = useTenantQuery<
    InsuranceCertificate[],
    ConvexInsuranceCertificate[]
  >({
    mock: mockInsurance,
    convexRef: anyApi.insurance.list,
    convexArgs: COI_EMPTY_ARGS,
    convexAdapter: convexCoiToMock,
  });
  // Tenant-scoped: only the active marina's boaters + vessels are
  // pickable in the New COI dialog and used for resolution below.
  const boaters = useBoaters();
  const vessels = useVessels();
  const searchParams = useSearchParams();
  // Deep-link support: `?bucket=expiring` lands directly on the
  // expiring tab. Dashboard Quick Action ("Chase expiring COIs")
  // uses this. Anything unrecognized falls back to "all".
  const initialBucket: StatusBucket | "all" = (() => {
    const v = searchParams?.get("bucket");
    if (v === "current" || v === "expiring" || v === "expired" || v === "missing") return v;
    return "all";
  })();
  const [bucket, setBucket] = React.useState<StatusBucket | "all">(initialBucket);
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<InsuranceCertificate | undefined>();
  const [open, setOpen] = React.useState(false);

  // Combine static fields with tenant-scoped option lists, keyed off
  // boaters/vessels so the dropdown stays fresh after a tenant switch.
  const COI_FIELDS = React.useMemo<FieldSpec<InsuranceCertificate>[]>(
    () => [
      {
        key: "boater_id",
        label: "Holder",
        kind: "select",
        required: true,
        options: boaters.map((b) => ({ value: b.id, label: b.display_name })),
      },
      {
        key: "vessel_id",
        label: "Vessel",
        kind: "select",
        required: true,
        options: vessels.map((v) => ({ value: v.id, label: `${v.name} (${v.year ?? "?"})` })),
      },
      ...COI_STATIC_FIELDS,
    ],
    [boaters, vessels]
  );

  // Phase 4 — Convex-or-mock routed writes. Create + update branch on
  // `editing` at the callsite (the mock store's upsert does both via
  // id-presence; Convex separates them). Delete is a hard remove,
  // matching the mock-store `deleteInsuranceCertificate` semantics.
  const createCoi = useTenantMutation<InsuranceCertificate, void>({
    mock: (c) => upsertInsurance(c),
    convexRef: anyApi.insurance.create,
    convexArgsAdapter: (c) => ({
      boater_id: c.boater_id,
      carrier: c.carrier,
      policy_number: c.policy_number,
      effective_start: c.effective_start,
      effective_end: c.effective_end,
      // Mock stores `liability_limit` as the primary coverage figure;
      // Convex calls it `coverage_amount`. Hull value stays mock-only
      // until the COI agent's schema extension lands.
      coverage_amount: c.liability_limit || undefined,
    }),
  });
  const updateCoi = useTenantMutation<InsuranceCertificate, void>({
    mock: (c) => upsertInsurance(c),
    convexRef: anyApi.insurance.update,
    convexArgsAdapter: (c) => ({
      id: c.id,
      patch: {
        carrier: c.carrier,
        policy_number: c.policy_number,
        effective_start: c.effective_start,
        effective_end: c.effective_end,
        coverage_amount: c.liability_limit || undefined,
      },
    }),
  });
  const removeCoi = useTenantMutation<string, void>({
    mock: (id) => deleteInsurance(id),
    convexRef: anyApi.insurance.remove,
    convexArgsAdapter: (id) => ({ id }),
  });

  function openAdd() {
    setEditing(undefined);
    setOpen(true);
  }
  function openEdit(c: InsuranceCertificate) {
    setEditing(c);
    setOpen(true);
  }
  function handleSave(values: InsuranceCertificate) {
    const stamped: InsuranceCertificate = {
      ...values,
      id: values.id || `ins_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      liability_limit: Number(values.liability_limit) || 0,
      hull_value: values.hull_value ? Number(values.hull_value) : undefined,
      uploaded_at: values.uploaded_at || new Date().toISOString(),
      uploaded_by: values.uploaded_by || "marina",
    };
    // Fire-and-forget — read hook re-syncs.
    if (editing) {
      void updateCoi(stamped);
    } else {
      void createCoi(stamped);
    }
  }
  function handleDelete(c: InsuranceCertificate) {
    void removeCoi(c.id);
  }

  // Bucket every certificate. Filter to certs whose boater is in the
  // active tenant — keeps the COI list isolated when staff switches
  // marinas (insurance.boater_id is the only join key).
  const rows = React.useMemo(() => {
    const now = Date.now();
    const boaterIds = new Set(boaters.map((b) => b.id));
    const tenantInsurance = insurance.filter((c) => boaterIds.has(c.boater_id));
    const certs = tenantInsurance.map((c) => {
      const endMs = new Date(c.effective_end).getTime();
      const daysUntilExpiry = Math.round((endMs - now) / 86_400_000);
      const status: StatusBucket =
        daysUntilExpiry < 0
          ? "expired"
          : daysUntilExpiry <= EXPIRING_WINDOW_DAYS
            ? "expiring"
            : "current";
      const boater = boaters.find((b) => b.id === c.boater_id);
      const vessel = vessels.find((v) => v.id === c.vessel_id);
      return { kind: "cert" as const, cert: c, boater, vessel, daysUntilExpiry, status };
    });

    // Synthesize "missing" rows — vessels with no insurance on file
    const insuredVesselIds = new Set(tenantInsurance.map((c) => c.vessel_id));
    const missingRows = vessels.filter((v) => v.active && !insuredVesselIds.has(v.id)).map((v) => ({
      kind: "missing" as const,
      vessel: v,
      boater: boaters.find((b) => b.id === v.boater_id),
      status: "missing" as StatusBucket,
      daysUntilExpiry: null,
    }));

    return [...certs, ...missingRows];
  }, [insurance, boaters, vessels]);

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

      {/* Auto-renewal workflow — 90/60/30 cliff buckets with per-row
          "Draft renewal reminder" action. Sits above the full ledger
          so the operator's morning-coffee question ("what needs
          chasing this week?") is answered before the list. */}
      <ExpiringSection />

      {/* Toolbar — canonical pill (matches Bookings/Members/Rentals).
          Status collapsed into ListFilterSelect with live counts in
          labels so the reader can scan bucket sizes at a glance even
          when the filter isn't active. */}
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-hairline bg-surface-1 p-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Carrier, policy #, holder, or vessel…"
            className="w-full rounded-[8px] border border-hairline bg-surface-2 py-1.5 pl-8 pr-3 text-[12px] text-fg placeholder:text-fg-tertiary focus:border-hairline-strong focus:outline-none"
          />
        </div>
        <ListFilterSelect
          value={bucket}
          onChange={(v) => setBucket(v as StatusBucket | "all")}
          label="Status"
          options={[
            { value: "all", label: `All · ${rows.length}` },
            { value: "current", label: `Current · ${counts.current}` },
            { value: "expiring", label: `Expiring · ${counts.expiring}` },
            { value: "expired", label: `Expired · ${counts.expired}` },
            { value: "missing", label: `Missing · ${counts.missing}` },
          ]}
        />
        <Button variant="primary" size="sm" className="ml-auto" onClick={openAdd}>
          <Plus className="size-3.5" />
          Upload COI
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div
          className="grid gap-3 border-b border-hairline bg-surface-2 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{ gridTemplateColumns: COI_COLS }}
        >
          <span>Member</span>
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
                    className="grid cursor-pointer items-center gap-3 px-3 py-2 text-[13px] transition-colors hover:bg-surface-2"
                    style={{ gridTemplateColumns: COI_COLS }}
                    onClick={openAdd}
                  >
                    <span className="truncate">
                      {r.boater ? (
                        <Link
                          href={`/members/${r.boater.id}`}
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
                  className="grid cursor-pointer items-center gap-3 px-3 py-2 text-[13px] transition-colors hover:bg-surface-2"
                    style={{ gridTemplateColumns: COI_COLS }}
                >
                  <span className="truncate">
                    {r.boater ? (
                      <Link
                        href={`/members/${r.boater.id}`}
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
