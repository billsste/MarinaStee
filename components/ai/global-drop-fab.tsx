"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  CheckCircle2,
  ChevronUp,
  FileText,
  Loader2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  persistFreshDraft,
} from "@/lib/ai-extract-executor";
import { useAiSettings } from "@/lib/client-store";
import type { ExtractionDraft, ExtractionModule } from "@/lib/types";

/*
 * Global Drop-zone FAB.
 *
 * Sits in the bottom-right of every admin page. Click to open a
 * small panel with: a module picker + a drop target. The operator
 * doesn't need to navigate to /vendors first — they drop a doc
 * anywhere and we route the resulting draft to the right inbox.
 *
 * Default module is "bill" (highest-frequency intake). When the
 * operator picks a different module from the chip row, the next
 * drop is extracted under that module's tool schema.
 *
 * Hidden on /dock + /portal + /onboarding because those surfaces
 * have their own dominant interactions and a floating bubble would
 * compete. Also hidden when none of the inbox features are enabled
 * — wouldn't make sense to expose intake without a destination.
 */

const MODULES: { key: ExtractionModule; label: string; settingsKey: keyof ReturnType<typeof useAiSettings> }[] = [
  { key: "bill", label: "Bill", settingsKey: "bills_inbox_enabled" },
  { key: "vendor", label: "Vendor", settingsKey: "bills_inbox_enabled" },
  { key: "certification", label: "Cert", settingsKey: "certs_photo_intake_enabled" },
  { key: "asset", label: "Asset", settingsKey: "assets_pm_auto_derive_from_manual" },
  { key: "packing_slip", label: "Packing slip", settingsKey: "bills_inbox_enabled" },
  { key: "staff_onboarding", label: "New hire", settingsKey: "staff_onboarding_doc_intake_enabled" },
];

const HIDDEN_PATH_PREFIXES = ["/dock", "/portal", "/onboarding"];

export function GlobalDropFab() {
  const pathname = usePathname();
  const router = useRouter();
  const ai = useAiSettings();
  const [open, setOpen] = React.useState(false);
  const [module, setModule] = React.useState<ExtractionModule>("bill");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<{
    count: number;
    routeTo: string;
    routeLabel: string;
  } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Hide on routes where a floating button competes with the surface.
  if (pathname && HIDDEN_PATH_PREFIXES.some((p) => pathname.startsWith(p))) {
    return null;
  }

  // Hide if no inbox is enabled at all — nothing for the drop to do.
  const anyInboxOn =
    ai.bills_inbox_enabled ||
    ai.certs_photo_intake_enabled ||
    ai.staff_onboarding_doc_intake_enabled ||
    ai.assets_pm_auto_derive_from_manual;
  if (!anyInboxOn) return null;

  // Show only the modules whose corresponding setting is on. The
  // setting key per module is mapped above — fall back to bills_inbox
  // for things like vendor / packing_slip which ride on AP.
  const availableModules = MODULES.filter((m) => {
    const enabled = ai[m.settingsKey];
    return Boolean(enabled);
  });
  if (availableModules.length === 0) return null;

  async function handleFiles(files: FileList | File[]) {
    setError(null);
    setBusy(true);
    setSuccess(null);
    let count = 0;
    try {
      for (const file of Array.from(files)) {
        const dataUrl = await fileToDataUrl(file);
        const meta = {
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
        persistFreshDraft(json.draft, meta);
        count++;
      }
      const { routeTo, routeLabel } = routeForModule(module);
      setSuccess({ count, routeTo, routeLabel });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-30 flex flex-col items-end gap-2 print:hidden">
      {open && (
        <div className="pointer-events-auto w-[320px] rounded-[14px] border border-hairline bg-surface-1 p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-fg">
              <Sparkles className="size-3.5 text-primary" />
              Drop a doc
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="rounded-[6px] p-1 text-fg-tertiary hover:bg-surface-2 hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {/* Module chips */}
          <div className="mb-2 flex flex-wrap gap-1">
            {availableModules.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setModule(m.key)}
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                  module === m.key
                    ? "bg-primary text-on-primary"
                    : "bg-surface-2 text-fg-subtle hover:bg-surface-3 hover:text-fg"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Drop target */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center rounded-[10px] border-2 border-dashed border-hairline px-3 py-5 text-center transition-colors hover:border-primary/40 hover:bg-surface-2/60",
              busy && "pointer-events-none opacity-60"
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {busy ? (
              <Loader2 className="size-5 animate-spin text-primary" />
            ) : (
              <FileText className="size-5 text-fg-subtle" />
            )}
            <div className="mt-1 text-[11px] font-medium text-fg">
              {busy ? "Extracting…" : "Drop or click to pick"}
            </div>
            <div className="mt-0.5 text-[10px] text-fg-tertiary">
              PDF or image · routed to the {labelFor(module)} inbox
            </div>
          </div>

          {success && (
            <div className="mt-2 flex items-start gap-2 rounded-[8px] border border-status-ok/30 bg-status-ok/[0.05] px-2 py-1.5 text-[11px] text-status-ok">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                {success.count} draft{success.count === 1 ? "" : "s"} created.{" "}
                <button
                  type="button"
                  className="font-medium underline hover:opacity-80"
                  onClick={() => {
                    setOpen(false);
                    router.push(success.routeTo);
                  }}
                >
                  Open {success.routeLabel} →
                </button>
              </div>
            </div>
          )}
          {error && (
            <div className="mt-2 rounded-[8px] border border-status-danger/30 bg-status-danger/10 px-2 py-1.5 text-[11px] text-status-danger">
              {error}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "pointer-events-auto flex h-11 items-center gap-2 rounded-full px-4 shadow-xl transition-transform active:scale-95",
          open
            ? "bg-surface-3 text-fg"
            : "bg-primary text-on-primary hover:bg-primary-hover"
        )}
        aria-label={open ? "Close drop panel" : "Drop a doc"}
        title={
          open
            ? "Close"
            : "Drop any PDF — bill, COI, contract, W-9 — we'll route it to the right place."
        }
      >
        {open ? (
          <ChevronUp className="size-4" />
        ) : (
          <>
            <Upload className="size-4" />
            <span className="text-[13px] font-medium">Drop a doc</span>
          </>
        )}
      </button>
    </div>
  );
}

function labelFor(m: ExtractionModule): string {
  switch (m) {
    case "bill":
      return "AP";
    case "vendor":
      return "AP";
    case "certification":
      return "Certifications";
    case "asset":
      return "Asset";
    case "packing_slip":
      return "Receive";
    case "staff_onboarding":
      return "Staff onboarding";
  }
}

function routeForModule(m: ExtractionModule): { routeTo: string; routeLabel: string } {
  switch (m) {
    case "bill":
    case "vendor":
      return { routeTo: "/vendors?section=inbox", routeLabel: "AP Inbox" };
    case "certification":
      return { routeTo: "/staff?section=certifications", routeLabel: "Certifications" };
    case "asset":
      return { routeTo: "/assets?section=inbox", routeLabel: "Asset Inbox" };
    case "packing_slip":
      return { routeTo: "/inventory?section=receive", routeLabel: "Receive" };
    case "staff_onboarding":
      return { routeTo: "/staff?section=onboarding", routeLabel: "Onboarding" };
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
