"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Lock, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, NumberInput, Select, TextInput, Textarea } from "@/components/create-sheet";
import { cn } from "@/lib/utils";
import { useCurrentUser, can, ROLE_META, type Entity } from "@/lib/auth";

/*
 * Universal centered edit modal for ANY row of data.
 *
 * Schema-driven: caller passes a list of FieldSpec entries describing each
 * editable field. Component renders inputs, tracks local state, fires
 * onSave(values) when the user clicks Save. Also handles Add (no initial)
 * and Delete (when onDelete is provided and a record was passed in).
 *
 * Used by /docks/rates, /docks/fees, and (eventually) every other
 * list view that has editable rows — fulfills the user's mandate:
 *   "On any of these pages, I should be able to Edit/Remove/Add any row
 *    of data for any data type ... select the row & edit the row data
 *    via a pop up box"
 */

export type FieldKind = "text" | "number" | "money" | "date" | "select" | "textarea" | "boolean";

export type FieldSpec<T> = {
  /** Property name on the record */
  key: Extract<keyof T, string>;
  label: string;
  kind: FieldKind;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  /** For select kind: ordered list of options */
  options?: Array<{ value: string; label: string }>;
  /** Half-width side-by-side when paired (display hint only) */
  col?: 1 | 2;
  /** Step for number/money */
  step?: string;
  min?: number | string;
  max?: number | string;
};

export function RecordEditDialog<T>({
  open,
  onOpenChange,
  title,
  description,
  record,
  fields,
  onSave,
  onDelete,
  submitLabel,
  entity,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  title: string;
  description?: string;
  /** undefined => Add mode. defined => Edit mode. */
  record?: T;
  fields: FieldSpec<T>[];
  /** Called with the merged values when the user clicks Save. */
  onSave: (values: T) => void;
  /** Optional delete handler — only shown in Edit mode. */
  onDelete?: (record: T) => void;
  submitLabel?: string;
  /**
   * If provided, the dialog gates Save/Delete by the current user's role
   * via can(role, action, entity). Without `entity` the dialog runs ungated
   * (kept for back-compat with non-RBAC callsites).
   */
  entity?: Entity;
}) {
  const user = useCurrentUser();
  const isEdit = Boolean(record);
  const canEdit = entity ? can(user.role, isEdit ? "edit" : "create", entity) : true;
  const canDelete = entity ? can(user.role, "delete", entity) : true;
  // Local field state — seeded from record or empty strings on open.
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [deleteConfirming, setDeleteConfirming] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const seed: Record<string, unknown> = {};
    for (const f of fields) {
      const v = record ? (record as unknown as Record<string, unknown>)[f.key] : undefined;
      seed[f.key] = v === undefined || v === null ? (f.kind === "boolean" ? false : "") : v;
    }
    setValues(seed);
    setDeleteConfirming(false);
  }, [open, record, fields]);

  function setField(key: string, v: unknown) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function submit() {
    // Coerce numbers/money back to numbers, leave others as-is.
    const out: Record<string, unknown> = { ...values };
    for (const f of fields) {
      if (f.kind === "number" || f.kind === "money") {
        const raw = out[f.key];
        if (raw === "" || raw === null || raw === undefined) {
          if (f.required) return; // missing required
          out[f.key] = undefined;
        } else {
          out[f.key] = Number(raw);
        }
      }
      // Empty strings on optional text fields → undefined for cleanliness
      if (!f.required && (f.kind === "text" || f.kind === "textarea" || f.kind === "date") && out[f.key] === "") {
        out[f.key] = undefined;
      }
    }
    // Preserve any record fields not represented in the schema (e.g. id)
    const merged = { ...((record ?? {}) as object), ...out } as T;
    onSave(merged);
    onOpenChange(false);
  }

  function canSave(): boolean {
    for (const f of fields) {
      if (!f.required) continue;
      const v = values[f.key];
      if (v === undefined || v === null) return false;
      if (typeof v === "string" && v.trim() === "") return false;
    }
    return true;
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-[560px] -translate-x-1/2 -translate-y-1/2",
            "max-h-[90vh] overflow-hidden rounded-[14px] border border-hairline bg-surface-1 shadow-2xl focus:outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95"
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-3.5">
            <div>
              <DialogPrimitive.Title className="display-tight text-[16px] font-semibold text-fg">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-0.5 text-[12px] text-fg-subtle">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label="Close"
              className="rounded-md p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>

          <div className="max-h-[60vh] space-y-3 overflow-y-auto p-5">
            {entity && !canEdit && (
              <div className="flex items-center gap-2 rounded-[10px] border border-status-warn/30 bg-status-warn/10 px-3 py-2 text-[12px] text-status-warn">
                <Lock className="size-3.5 shrink-0" />
                Read-only — {ROLE_META[user.role].label} can&rsquo;t {isEdit ? "edit" : "create"} {entity.replace("_", " ")}s. Switch role from the top bar.
              </div>
            )}
            {paired(fields).map((row, idx) => (
              <div
                key={idx}
                className={cn(
                  "grid gap-3",
                  row.length === 2 ? "grid-cols-2" : "grid-cols-1"
                )}
              >
                {row.map((f) => (
                  <FieldRenderer
                    key={f.key}
                    field={f}
                    value={values[f.key]}
                    onChange={(v) => setField(f.key, v)}
                    disabled={!canEdit}
                  />
                ))}
              </div>
            ))}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t border-hairline bg-surface-2/40 px-5 py-3">
            <div>
              {isEdit && onDelete && canDelete && (
                deleteConfirming ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-status-danger">Sure?</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (record) onDelete(record);
                        onOpenChange(false);
                      }}
                      className="text-status-danger hover:bg-status-danger/10"
                    >
                      Yes, delete
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteConfirming(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteConfirming(true)}
                    className="text-fg-subtle hover:bg-status-danger/10 hover:text-status-danger"
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </Button>
                )
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
                {canEdit ? "Cancel" : "Close"}
              </Button>
              {canEdit && (
                <Button variant="primary" size="md" onClick={submit} disabled={!canSave()}>
                  {submitLabel ?? (isEdit ? "Save changes" : "Add")}
                </Button>
              )}
            </div>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function FieldRenderer<T>({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FieldSpec<T>;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const v = (value as string | number | boolean | undefined) ?? "";

  if (field.kind === "select") {
    return (
      <Field label={field.label} required={field.required} hint={field.hint}>
        <Select value={String(v)} onChange={onChange} disabled={disabled}>
          {!field.required && <option value="">—</option>}
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  if (field.kind === "textarea") {
    return (
      <Field label={field.label} required={field.required} hint={field.hint}>
        <Textarea
          value={String(v)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={4}
          disabled={disabled}
          readOnly={disabled}
        />
      </Field>
    );
  }

  if (field.kind === "number" || field.kind === "money") {
    return (
      <Field label={field.label} required={field.required} hint={field.hint}>
        <NumberInput
          value={String(v)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          step={field.step ?? (field.kind === "money" ? "1" : undefined)}
          min={field.min}
          max={field.max}
          disabled={disabled}
          readOnly={disabled}
        />
      </Field>
    );
  }

  if (field.kind === "date") {
    return (
      <Field label={field.label} required={field.required} hint={field.hint}>
        <TextInput
          type="date"
          value={String(v)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          readOnly={disabled}
        />
      </Field>
    );
  }

  if (field.kind === "boolean") {
    return (
      <Field label={field.label} required={field.required} hint={field.hint}>
        <label className="flex items-center gap-2 text-[13px] text-fg">
          <input
            type="checkbox"
            checked={Boolean(v)}
            onChange={(e) => onChange(e.target.checked)}
            className="size-3.5"
            disabled={disabled}
          />
          {field.placeholder ?? "Enabled"}
        </label>
      </Field>
    );
  }

  // text
  return (
    <Field label={field.label} required={field.required} hint={field.hint}>
      <TextInput
        type="text"
        value={String(v)}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        disabled={disabled}
        readOnly={disabled}
      />
    </Field>
  );
}

// Pair fields side-by-side when both have col=2.
function paired<T>(fields: FieldSpec<T>[]): FieldSpec<T>[][] {
  const rows: FieldSpec<T>[][] = [];
  let i = 0;
  while (i < fields.length) {
    const f = fields[i];
    if (f.col === 2 && i + 1 < fields.length && fields[i + 1].col === 2) {
      rows.push([f, fields[i + 1]]);
      i += 2;
    } else {
      rows.push([f]);
      i += 1;
    }
  }
  return rows;
}
