"use client";

import * as React from "react";
import {
  Check,
  Edit3,
  FileText,
  Image as ImageIcon,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/mock-data";
import { getAttachmentById } from "@/lib/client-store";
import type { ExtractionDraft } from "@/lib/types";

/*
 * <DraftCard /> — generic reviewable AI extraction card.
 *
 * Used by every module's inbox. Shows the source-doc thumbnail on
 * the left, the parsed fields as Field/Value rows on the right (with
 * inline edit), and three actions: Approve / Reject / Open doc. The
 * confidence chip surfaces the model's self-rated certainty.
 *
 * The card is intentionally schema-agnostic — the parent supplies
 * `fields` (an array of label+value pairs to display) so this works
 * across Bill / Vendor / Cert / Asset / Staff drafts without per-
 * module variants. Parents pass `onApprove` + `onReject` callbacks
 * that route to the right executor.
 */

export type DraftField = {
  key: string;
  label: string;
  value: string | number;
  /** Optional confidence 0-1 from the model. Renders a per-field dot. */
  confidence?: number;
  /** When true the value is rendered with .money-display formatting. */
  money?: boolean;
  /** When true, value is shown as a mono code. */
  mono?: boolean;
  /** Mark fields editable inline. */
  editable?: boolean;
};

export function DraftCard({
  draft,
  title,
  subtitle,
  fields,
  onApprove,
  onReject,
  onEditField,
  busy,
  primaryActionLabel,
}: {
  draft: ExtractionDraft;
  title: string;
  subtitle?: string;
  fields: DraftField[];
  onApprove: () => void;
  onReject: () => void;
  onEditField?: (key: string, next: string) => void;
  busy?: boolean;
  primaryActionLabel?: string;
}) {
  const attachment = React.useMemo(
    () => getAttachmentById(draft.source_attachment_id),
    [draft.source_attachment_id]
  );

  const confidenceLabel =
    draft.confidence >= 0.9
      ? "High confidence"
      : draft.confidence >= 0.7
      ? "Medium confidence"
      : "Low confidence — review carefully";

  const confidenceTone =
    draft.confidence >= 0.9
      ? "bg-status-ok/10 text-status-ok ring-status-ok/30"
      : draft.confidence >= 0.7
      ? "bg-status-warn/10 text-status-warn ring-status-warn/30"
      : "bg-status-danger/10 text-status-danger ring-status-danger/30";

  return (
    <div
      className={cn(
        "rounded-[14px] border border-hairline bg-surface-1 p-4 transition-opacity",
        busy && "pointer-events-none opacity-60"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-[14px] font-semibold text-fg">{title}</div>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1",
                confidenceTone
              )}
            >
              <Sparkles className="size-2.5" />
              {Math.round(draft.confidence * 100)}%
            </span>
            {draft.status === "auto_approved" && (
              <span className="inline-flex items-center rounded-full bg-status-info/10 px-1.5 py-0.5 text-[10px] font-medium text-status-info ring-1 ring-status-info/30">
                Auto-approved
              </span>
            )}
          </div>
          {subtitle && (
            <div className="mt-0.5 text-[12px] text-fg-subtle">{subtitle}</div>
          )}
          <div className="mt-0.5 text-[11px] text-fg-tertiary">
            {confidenceLabel}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-[140px_1fr]">
        {/* Source doc thumbnail / preview */}
        <div>
          {attachment ? (
            <a
              href={attachment.data_url}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-[10px] border border-hairline bg-surface-2"
              title="Open source document"
            >
              {attachment.mime.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={attachment.data_url}
                  alt={attachment.name}
                  className="aspect-[3/4] w-full object-cover"
                />
              ) : (
                <div className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 text-fg-subtle">
                  {attachment.mime === "application/pdf" ? (
                    <FileText className="size-7" />
                  ) : (
                    <ImageIcon className="size-7" />
                  )}
                  <div className="px-2 text-center text-[10px] text-fg-tertiary line-clamp-2">
                    {attachment.name}
                  </div>
                </div>
              )}
            </a>
          ) : (
            <div className="flex aspect-[3/4] w-full items-center justify-center rounded-[10px] border border-hairline bg-surface-2 text-fg-tertiary">
              <FileText className="size-7" />
            </div>
          )}
        </div>

        {/* Parsed fields */}
        <div>
          <div className="grid grid-cols-1 gap-y-1.5 sm:grid-cols-2 sm:gap-x-4">
            {fields.map((f) => (
              <FieldRow
                key={f.key}
                field={f}
                onEdit={onEditField ? (v) => onEditField(f.key, v) : undefined}
              />
            ))}
          </div>

          {draft.notes && (
            <div className="mt-3 rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[11px] text-fg-subtle">
              <span className="font-medium text-fg-muted">Model note:</span>{" "}
              {draft.notes}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-hairline pt-3">
        <button
          type="button"
          onClick={onReject}
          className="inline-flex items-center gap-1.5 rounded-[8px] border border-hairline px-3 py-1.5 text-[12px] text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <X className="size-3.5" />
          Reject
        </button>
        <button
          type="button"
          onClick={onApprove}
          className="inline-flex items-center gap-1.5 rounded-[8px] bg-primary px-3 py-1.5 text-[12px] font-medium text-on-primary hover:bg-primary-hover"
        >
          <Check className="size-3.5" />
          {primaryActionLabel ?? "Approve"}
        </button>
      </div>
    </div>
  );
}

function FieldRow({
  field,
  onEdit,
}: {
  field: DraftField;
  onEdit?: (next: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [val, setVal] = React.useState(String(field.value));

  React.useEffect(() => {
    setVal(String(field.value));
  }, [field.value]);

  const display = field.money
    ? formatMoney(Number(field.value) || 0)
    : String(field.value);

  return (
    <div className="flex items-start justify-between gap-3 rounded-[8px] px-2 py-1 hover:bg-surface-2/60">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
          {field.label}
          {field.confidence !== undefined && field.confidence < 0.85 && (
            <span
              className="ml-1 inline-block size-1.5 rounded-full bg-status-warn"
              title={`Field confidence ${Math.round(field.confidence * 100)}%`}
            />
          )}
        </div>
        {editing ? (
          <input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (val !== String(field.value)) onEdit?.(val);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setEditing(false);
                if (val !== String(field.value)) onEdit?.(val);
              }
              if (e.key === "Escape") {
                setVal(String(field.value));
                setEditing(false);
              }
            }}
            className={cn(
              "mt-0.5 w-full rounded-[6px] border border-primary/40 bg-surface-2 px-1.5 py-0.5 text-[13px] text-fg outline-none focus:border-primary",
              field.mono && "font-mono"
            )}
          />
        ) : (
          <div
            className={cn(
              "mt-0.5 truncate text-[13px] text-fg",
              field.money && "money-display",
              field.mono && "font-mono"
            )}
          >
            {display || <span className="text-fg-tertiary">—</span>}
          </div>
        )}
      </div>
      {onEdit && !editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-3 inline-flex shrink-0 items-center text-fg-tertiary opacity-0 transition-opacity hover:text-fg group-hover:opacity-100"
          title={`Edit ${field.label}`}
        >
          <Edit3 className="size-3" />
        </button>
      )}
    </div>
  );
}
