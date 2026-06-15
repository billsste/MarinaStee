"use client";

import * as React from "react";
import { Copy, FileText, Send, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  deleteInsuranceCertificate,
  requestCoiRenewal,
  upsertInsuranceCertificate,
  useInsuranceForBoater,
} from "@/lib/client-store";
import { getVesselsForBoater } from "@/lib/mock-data";
import { AddCoiSheet } from "./add-coi-sheet";
import {
  RecordEditDialog,
  type FieldSpec,
} from "@/components/record-edit-dialog";
import { cn } from "@/lib/utils";
import type { InsuranceCertificate } from "@/lib/types";

/*
 * Shared card listing all COIs on file for a boater. Used by:
 *   - Boater detail → Vessels tab (uploadedBy="marina" — staff side)
 *   - Portal /portal/[boaterId] (uploadedBy="boater" — self-serve)
 *
 * Each row shows status (active / expiring soon / lapsed / superseded) and
 * key policy fields. The header has an "Add COI" button that opens the
 * sheet preset to this boater.
 */

export function InsuranceCard({
  boaterId,
  uploadedBy = "marina",
}: {
  boaterId: string;
  uploadedBy?: "marina" | "boater";
}) {
  const certs = useInsuranceForBoater(boaterId);
  const [addOpen, setAddOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<InsuranceCertificate | undefined>();
  const [editOpen, setEditOpen] = React.useState(false);
  const sorted = certs
    .slice()
    .sort((a, b) => (a.effective_end < b.effective_end ? 1 : -1));

  const vessels = getVesselsForBoater(boaterId);
  const COI_FIELDS: FieldSpec<InsuranceCertificate>[] = [
    { key: "carrier", label: "Carrier", kind: "text", required: true, placeholder: "BoatU.S. Insurance" },
    { key: "policy_number", label: "Policy number", kind: "text", required: true, col: 2 },
    {
      key: "vessel_id",
      label: "Vessel",
      kind: "select",
      required: true,
      col: 2,
      options: vessels.map((v) => ({ value: v.id, label: v.name })),
    },
    { key: "liability_limit", label: "Liability limit ($)", kind: "money", required: true, step: "10000", col: 2 },
    { key: "hull_value", label: "Hull value ($)", kind: "money", step: "1000", col: 2 },
    { key: "effective_start", label: "Effective start", kind: "date", required: true, col: 2 },
    { key: "effective_end", label: "Effective end", kind: "date", required: true, col: 2 },
    { key: "pdf_url", label: "PDF URL", kind: "text", placeholder: "/mock/coi.pdf" },
  ];

  // Per-vessel: the latest cert wins for status calc; older ones show
  // as "superseded" instead of expired/lapsed.
  const latestByVessel = new Map<string, string>();
  for (const c of sorted) {
    if (!latestByVessel.has(c.vessel_id)) latestByVessel.set(c.vessel_id, c.id);
  }

  return (
    <div className="rounded-[12px] border border-hairline bg-surface-1">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <h3 className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
          <Shield className="size-3.5" />
          Insurance / COI
          {certs.length > 0 && <Badge tone="neutral" size="sm">{certs.length}</Badge>}
        </h3>
        <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
          + Add COI
        </Button>
      </div>

      <div className="p-3">
        {sorted.length === 0 ? (
          <p className="px-1 text-[13px] text-fg-subtle">
            No insurance certificates on file. Vessels must have current COI to keep their slip
            (per Marina Stee's standard contract).
          </p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((c) => (
              <CoiRow
                key={c.id}
                cert={c}
                isLatest={latestByVessel.get(c.vessel_id) === c.id}
                onClick={() => {
                  setEditing(c);
                  setEditOpen(true);
                }}
              />
            ))}
          </ul>
        )}
      </div>

      <AddCoiSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultBoaterId={boaterId}
        uploadedBy={uploadedBy}
      />

      <RecordEditDialog<InsuranceCertificate>
        open={editOpen}
        onOpenChange={setEditOpen}
        title={editing ? `Edit COI — ${editing.policy_number}` : "Certificate"}
        description="Updates affect notification triage immediately. Lapsed certs auto-surface."
        record={editing}
        fields={COI_FIELDS}
        onSave={(values) => upsertInsuranceCertificate(values as InsuranceCertificate)}
        onDelete={editing ? (c) => deleteInsuranceCertificate(c.id) : undefined}
        entity="insurance"
      />
    </div>
  );
}

function CoiRow({
  cert,
  isLatest,
  onClick,
}: {
  cert: InsuranceCertificate;
  isLatest: boolean;
  onClick: () => void;
}) {
  const status = coiStatus(cert, isLatest);
  const [copied, setCopied] = React.useState(false);
  const [justSent, setJustSent] = React.useState(false);

  // Renewal CTA shows when this is the active row, it's lapsed or
  // within 60 days of expiry, and there's no successor cert yet.
  const showRenewalCta =
    isLatest &&
    !cert.renewed_by_coi_id &&
    (status.tone === "danger" || status.tone === "warn");
  const linkSent = !!cert.upload_token && !!cert.upload_link_sent_at;

  function sendOrResend(e: React.MouseEvent) {
    e.stopPropagation();
    requestCoiRenewal(cert.id);
    setJustSent(true);
    setTimeout(() => setJustSent(false), 1800);
  }
  async function copyLink(e: React.MouseEvent) {
    e.stopPropagation();
    if (!cert.upload_token) return;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    try {
      await navigator.clipboard.writeText(`${origin}/coi-upload/${cert.upload_token}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <li
      onClick={onClick}
      className={cn(
        "flex cursor-pointer flex-wrap items-start justify-between gap-3 rounded-[10px] border border-l-4 bg-surface-2 px-3 py-2.5 transition-colors hover:bg-surface-3",
        status.borderClass
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-medium text-fg">{cert.carrier}</span>
          <span className="font-mono text-[11px] text-fg-tertiary">{cert.policy_number}</span>
          <Badge tone={status.tone} size="sm">
            {status.icon}
            {status.label}
          </Badge>
          {linkSent && (
            <Badge tone="info" size="sm">
              renewal link sent
            </Badge>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-fg-tertiary">
          Liability ${cert.liability_limit.toLocaleString()}
          {cert.hull_value ? ` · Hull $${cert.hull_value.toLocaleString()}` : ""}
          {" · "}
          {cert.effective_start} → {cert.effective_end}
          {" · "}
          uploaded by {cert.uploaded_by}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {showRenewalCta && (
          <button
            type="button"
            onClick={sendOrResend}
            className="inline-flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            {justSent ? (
              <>
                <ShieldCheck className="size-3 text-status-ok" />
                Sent
              </>
            ) : (
              <>
                <Send className="size-3" />
                {linkSent ? "Resend" : "Request renewal"}
              </>
            )}
          </button>
        )}
        {linkSent && (
          <button
            type="button"
            onClick={copyLink}
            className="inline-flex items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 py-1 text-[11px] text-fg-subtle hover:bg-surface-2 hover:text-fg"
          >
            {copied ? (
              <>
                <ShieldCheck className="size-3 text-status-ok" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-3" />
                Copy link
              </>
            )}
          </button>
        )}
        {cert.pdf_url && (
          <Button variant="ghost" size="sm" asChild>
            <a
              href={cert.pdf_url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <FileText className="size-3.5" />
              PDF
            </a>
          </Button>
        )}
      </div>
    </li>
  );
}

function coiStatus(c: InsuranceCertificate, isLatest: boolean): {
  label: string;
  tone: "ok" | "warn" | "danger" | "neutral";
  icon: React.ReactNode;
  borderClass: string;
} {
  if (!isLatest) {
    return {
      label: "superseded",
      tone: "neutral",
      icon: <Shield className="size-3" />,
      borderClass: "border-l-fg-tertiary/40",
    };
  }
  const now = Date.now();
  const end = new Date(c.effective_end).getTime();
  const days = Math.round((end - now) / 86_400_000);
  if (days < 0) {
    return {
      label: `lapsed ${-days}d ago`,
      tone: "danger",
      icon: <ShieldAlert className="size-3" />,
      borderClass: "border-l-status-danger",
    };
  }
  if (days < 30) {
    return {
      label: `expires in ${days}d`,
      tone: "warn",
      icon: <ShieldAlert className="size-3" />,
      borderClass: "border-l-status-warn",
    };
  }
  if (days < 60) {
    return {
      label: `expires in ${days}d`,
      tone: "warn",
      icon: <ShieldAlert className="size-3" />,
      borderClass: "border-l-status-warn",
    };
  }
  return {
    label: "active",
    tone: "ok",
    icon: <ShieldCheck className="size-3" />,
    borderClass: "border-l-status-ok",
  };
}
