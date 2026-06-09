"use client";

import * as React from "react";
import { Loader2, Sparkles, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExtractionDraft, ExtractionModule } from "@/lib/types";

/*
 * <DropZone module="bill" /> — universal file intake.
 *
 * One primitive used by every back-office page that accepts a document.
 * Operator drags or picks a PDF / image. We base64-encode it, POST to
 * /api/extract with the module hint, and call onDraftsCreated with the
 * resulting ExtractionDraft(s). The page renders them via <DraftCard>.
 *
 * Multi-file is supported: each file becomes its own draft. Real-world
 * "drop 12 invoices at once" is the killer flow — we want it from day 1.
 *
 * Design notes:
 *   - Single tall affordance, never tiny. This is the primary entry
 *     point for the page, not a hidden cog setting.
 *   - Drag overlay tints the whole drop area to confirm the gesture.
 *   - Empty state copy is module-specific so the operator knows what
 *     to drop ("Drop a vendor invoice", "Drop a packing slip"…).
 */

const MODULE_COPY: Record<
  ExtractionModule,
  { title: string; sub: string; accept: string }
> = {
  bill: {
    title: "Drop a vendor invoice",
    sub: "PDF or photo. We'll parse vendor, amount, category, and due date.",
    accept: "application/pdf,image/png,image/jpeg,image/heic,image/webp",
  },
  vendor: {
    title: "Drop a vendor W-9, contract, or invoice",
    sub: "We'll extract the vendor profile and create the record.",
    accept: "application/pdf,image/png,image/jpeg,image/heic,image/webp",
  },
  certification: {
    title: "Photo of a staff certification",
    sub: "Forklift, First Aid, TWIC — we read the issuer + expiration.",
    accept: "image/png,image/jpeg,image/heic,image/webp,application/pdf",
  },
  asset: {
    title: "Drop a purchase invoice or spec sheet",
    sub: "We'll create the asset row and link the source doc.",
    accept: "application/pdf,image/png,image/jpeg,image/heic,image/webp",
  },
  packing_slip: {
    title: "Drop a supplier packing slip",
    sub: "We'll match the lines to your POS catalog and stage receive movements.",
    accept: "application/pdf,image/png,image/jpeg,image/heic,image/webp",
  },
  staff_onboarding: {
    title: "Drop the new hire's onboarding pack",
    sub: "DL + W-4 + offer letter. We'll create the staff record with wage profile.",
    accept: "application/pdf,image/png,image/jpeg,image/heic,image/webp",
  },
};

export type DroppedFile = {
  name: string;
  mime: string;
  size_bytes: number;
  data_url: string;
};

export function DropZone({
  module,
  onDraftsCreated,
  className,
  multiple = true,
}: {
  module: ExtractionModule;
  /**
   * Called with one entry per uploaded file, paired with the file
   * metadata so callers can persist the attachment alongside the
   * draft.
   */
  onDraftsCreated: (
    drafts: Array<{ draft: ExtractionDraft; file: DroppedFile }>
  ) => void;
  className?: string;
  multiple?: boolean;
}) {
  const [dragging, setDragging] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const copy = MODULE_COPY[module];

  async function handleFiles(files: FileList | File[]) {
    setError(null);
    setBusy(true);
    const results: Array<{ draft: ExtractionDraft; file: DroppedFile }> = [];
    try {
      for (const file of Array.from(files)) {
        const dataUrl = await fileToDataUrl(file);
        const meta: DroppedFile = {
          name: file.name,
          mime: file.type || "application/octet-stream",
          size_bytes: file.size,
          data_url: dataUrl,
        };
        const res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ module, file: meta }),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Extract failed (${res.status}): ${body.slice(0, 200)}`);
        }
        const json = (await res.json()) as { draft: ExtractionDraft };
        results.push({ draft: json.draft, file: meta });
      }
      onDraftsCreated(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) {
            void handleFiles(e.dataTransfer.files);
          }
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={cn(
          "group flex cursor-pointer flex-col items-center justify-center rounded-[16px] border-2 border-dashed px-6 py-8 text-center transition-colors",
          dragging
            ? "border-primary bg-primary/5"
            : "border-hairline bg-surface-1 hover:border-primary/40 hover:bg-surface-2",
          busy && "pointer-events-none opacity-60"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={copy.accept}
          multiple={multiple}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          {busy ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <Upload className="size-5" />
          )}
        </div>
        <div className="text-[14px] font-semibold text-fg">
          {busy ? "Extracting…" : copy.title}
        </div>
        <div className="mt-1 max-w-[420px] text-[12px] text-fg-subtle">
          {copy.sub}
        </div>
        <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-fg-tertiary">
          <Sparkles className="size-3" />
          Powered by AI — review the draft before posting.
        </div>
      </div>
      {error && (
        <div className="mt-2 rounded-[8px] border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-[12px] text-status-danger">
          {error}
        </div>
      )}
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
