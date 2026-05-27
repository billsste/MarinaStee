"use client";

import * as React from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, FileText, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  upsertBoater,
  upsertSlip,
  upsertVessel,
} from "@/lib/client-store";
import type { Boater, Slip, SlipClass, Vessel } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * CSV importer — used for Slips, Boaters, Vessels. Browser-only CSV
 * parse (no external dep), preview rows, map columns, then commit.
 *
 * Real onboarding for a 200-slip marina would route this through the
 * server for validation + a real DB transaction. For the prototype we
 * parse client-side and call the store mutations row-by-row.
 */

type EntityKind = "slips" | "boaters" | "vessels";

const TEMPLATES: Record<
  EntityKind,
  { label: string; columns: string[]; sample: string }
> = {
  slips: {
    label: "Slips",
    columns: ["id", "dock", "number", "slip_class", "max_loa_inches", "max_beam_inches", "has_power", "has_water", "default_annual_rate"],
    sample:
      "id,dock,number,slip_class,max_loa_inches,max_beam_inches,has_power,has_water,default_annual_rate\nA-01,A Dock,1,uncovered,360,144,true,true,3500\nA-02,A Dock,2,uncovered,360,144,true,true,3500\nB-01,B Dock,1,covered,420,180,true,true,4800",
  },
  boaters: {
    label: "Boaters / Holders",
    columns: ["id", "first_name", "last_name", "email", "phone", "billing_cadence", "city", "state"],
    sample:
      "id,first_name,last_name,email,phone,billing_cadence,city,state\nb_001,David,Emmons,david@example.com,(505) 555-0100,annual,Santa Fe,NM\nb_002,Sarah,Peterson,sarah@example.com,(505) 555-0101,annual,Albuquerque,NM",
  },
  vessels: {
    label: "Vessels",
    columns: ["id", "boater_id", "name", "year", "make", "model", "loa_ft", "beam_ft", "vessel_type", "fuel_type"],
    sample:
      "id,boater_id,name,year,make,model,loa_ft,beam_ft,vessel_type,fuel_type\nv_001,b_001,Sea Hawk,2014,Sea Ray,240 Sundancer,24,8.5,powerboat,gasoline\nv_002,b_002,Reverie,2020,Chaparral,270 OSX,27,9,powerboat,gasoline",
  },
};

export function CsvImportView() {
  const [kind, setKind] = React.useState<EntityKind>("slips");
  const [text, setText] = React.useState("");
  const [imported, setImported] = React.useState<{
    success: number;
    errors: string[];
  } | null>(null);

  const meta = TEMPLATES[kind];
  const rows = parseCsv(text);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setText(reader.result);
    };
    reader.readAsText(file);
  }

  function loadSample() {
    setText(meta.sample);
  }

  function commit() {
    if (rows.length === 0) return;
    const result = { success: 0, errors: [] as string[] };
    for (const [idx, row] of rows.entries()) {
      try {
        if (kind === "slips") {
          const slip: Slip = {
            id: row.id || `S-${idx + 1}`,
            dock: row.dock || "Unsorted",
            invoice_category: "Marina Slip Fees",
            number: row.number || String(idx + 1),
            slip_class: (row.slip_class as SlipClass) || "uncovered",
            max_loa_inches: Number(row.max_loa_inches) || 0,
            max_beam_inches: Number(row.max_beam_inches) || 0,
            has_power: row.has_power?.toLowerCase() !== "false",
            has_water: row.has_water?.toLowerCase() !== "false",
            default_annual_rate: Number(row.default_annual_rate) || 0,
          };
          upsertSlip(slip);
        } else if (kind === "boaters") {
          const id = row.id || `b_runtime_${Date.now()}_${idx}`;
          const first = row.first_name || "";
          const last = row.last_name || "";
          const boater: Boater = {
            id,
            first_name: first,
            last_name: last,
            display_name: `${last}, ${first}`.trim(),
            code: row.id || "",
            active: true,
            billing_cadence:
              (row.billing_cadence as Boater["billing_cadence"]) || "transient",
            primary_contact: {
              id: `c_${id}_primary`,
              name: `${first} ${last}`.trim() || "Primary",
              role: "self",
              email: row.email || "",
              phone: row.phone || "",
              preferred_channel: "email",
              can_be_billed: true,
            },
            communication_prefs: {
              preferred_channel: "email",
              language: "en",
            },
            address: {
              line1: "",
              city: row.city || "",
              state: row.state || "",
              zip: "",
              country: "USA",
            },
            additional_contacts: [],
            tags: [],
          };
          upsertBoater(boater);
        } else if (kind === "vessels") {
          const loaFt = Number(row.loa_ft) || 0;
          const beamFt = Number(row.beam_ft) || 0;
          const vessel: Vessel = {
            id: row.id || `v_runtime_${Date.now()}_${idx}`,
            boater_id: row.boater_id || "",
            co_owner_ids: [],
            name: row.name || "Vessel",
            year: row.year ? Number(row.year) : undefined,
            make: row.make,
            model: row.model,
            vessel_type:
              (row.vessel_type as Vessel["vessel_type"]) || "powerboat",
            fuel_type: (row.fuel_type as Vessel["fuel_type"]) || "gasoline",
            loa_inches: Math.round(loaFt * 12),
            beam_inches: Math.round(beamFt * 12),
            active: true,
          };
          upsertVessel(vessel);
        }
        result.success += 1;
      } catch (err) {
        result.errors.push(
          `Row ${idx + 1}: ${err instanceof Error ? err.message : "import failed"}`
        );
      }
    }
    setImported(result);
  }

  return (
    <div className="space-y-4">
      {/* Entity tabs */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-[12px] border border-hairline bg-surface-1 p-2">
        {(Object.keys(TEMPLATES) as EntityKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k);
              setText("");
              setImported(null);
            }}
            className={cn(
              "rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition-colors",
              k === kind
                ? "bg-primary text-on-primary"
                : "text-fg-muted hover:bg-surface-2"
            )}
          >
            {TEMPLATES[k].label}
          </button>
        ))}
      </div>

      {/* Column reference */}
      <div className="rounded-[12px] border border-hairline bg-surface-1">
        <header className="border-b border-hairline px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
          Expected columns
        </header>
        <div className="flex flex-wrap gap-1.5 p-3">
          {meta.columns.map((c) => (
            <span
              key={c}
              className="rounded-full border border-hairline bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-fg-subtle"
            >
              {c}
            </span>
          ))}
        </div>
        <div className="border-t border-hairline px-4 py-2.5 text-[11px] text-fg-tertiary">
          Extra columns are ignored. Missing optional columns fall back to
          sensible defaults. The <span className="font-mono">id</span> column
          is optional — we'll generate one if blank.
        </div>
      </div>

      {/* Upload */}
      <div className="rounded-[12px] border border-hairline bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-[14px] font-medium text-fg">Upload CSV</h3>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={loadSample}>
              <FileText className="size-3.5" />
              Load sample
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-hairline bg-surface-2 px-3 py-1.5 text-[12px] text-fg-muted hover:bg-surface-3">
              <Upload className="size-3.5" />
              Choose file
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFile}
              />
            </label>
          </div>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste CSV here, or upload a file."
          rows={8}
          className="mt-3 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 font-mono text-[12px] leading-5 text-fg focus:border-hairline-strong focus:outline-none"
        />
      </div>

      {/* Preview */}
      {rows.length > 0 && (
        <div className="rounded-[12px] border border-hairline bg-surface-1">
          <header className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
              Preview · {rows.length} rows
            </div>
            <Button variant="primary" size="sm" onClick={commit}>
              Import {rows.length} {meta.label.toLowerCase()}
              <ArrowRight className="size-3.5" />
            </Button>
          </header>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-surface-2">
                <tr>
                  {Object.keys(rows[0]).map((col) => (
                    <th
                      key={col}
                      className="border-b border-hairline px-3 py-1.5 text-left font-medium text-fg-tertiary"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-b border-hairline">
                    {Object.keys(rows[0]).map((col) => (
                      <td
                        key={col}
                        className="px-3 py-1.5 font-mono text-[11px] text-fg-muted"
                      >
                        {r[col]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 50 && (
              <div className="px-4 py-2 text-[11px] text-fg-tertiary">
                + {rows.length - 50} more rows (not shown)
              </div>
            )}
          </div>
        </div>
      )}

      {/* Result */}
      {imported && (
        <div
          className={cn(
            "rounded-[12px] border p-4",
            imported.errors.length === 0
              ? "border-status-ok/30 bg-status-ok/[0.05]"
              : "border-status-warn/40 bg-status-warn/[0.05]"
          )}
        >
          <div className="flex items-center gap-2">
            {imported.errors.length === 0 ? (
              <CheckCircle2 className="size-4 text-status-ok" />
            ) : (
              <AlertTriangle className="size-4 text-status-warn" />
            )}
            <div className="text-[13px] font-medium text-fg">
              Imported {imported.success} of {imported.success + imported.errors.length} rows
            </div>
            {imported.errors.length === 0 && (
              <Badge tone="ok" size="sm">
                All clean
              </Badge>
            )}
          </div>
          {imported.errors.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11px] text-fg-subtle">
              {imported.errors.slice(0, 10).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── CSV parser ──────────────────────────────────────────────────
// Tiny browser-side parser; handles quoted strings and commas inside
// quoted cells. Good enough for hand-prepared marina exports.
function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const headers = parseRow(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseRow(line);
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = cells[i] ?? "";
    }
    return obj;
  });
}

function parseRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else {
      if (c === ",") {
        out.push(cur);
        cur = "";
      } else if (c === '"') {
        inQuotes = true;
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out.map((x) => x.trim());
}
