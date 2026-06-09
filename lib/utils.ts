import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Display-side phone formatter. Strips non-digits, formats 10-digit
 * North-American numbers as `(xxx) xxx-xxxx`. 11-digit numbers starting
 * with "1" drop the leading 1 first. Anything else (international, short,
 * partial) is returned as-is so legacy data still renders.
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return value;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/**
 * Live formatter for typing into a phone input. Accepts whatever the user
 * has typed and renders the best partial form of `(xxx) xxx-xxxx`. Caps
 * at 10 digits so paste-in junk gets trimmed.
 */
export function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Returns the count of digits in a phone string. Use to validate that
 * a phone is a complete 10-digit NANP number before submit.
 */
export function phoneDigitCount(value: string | null | undefined): number {
  if (!value) return 0;
  return value.replace(/\D/g, "").length;
}

/**
 * Days between two ISO date strings (YYYY-MM-DD). Positive when `toIso`
 * is after `fromIso`, negative when before, 0 same day. Uses UTC-midnight
 * anchoring to avoid the timezone-DST drift that bites `new Date("YYYY-MM-DD")`.
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + "T00:00:00Z").getTime();
  const b = new Date(toIso + "T00:00:00Z").getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Capitalize the first character. Returns "" for empty input. */
export function capitalize(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Escape a single CSV cell value. RFC 4180 compatible:
 *  - null / undefined → empty
 *  - contains comma, double quote, or newline → wrap in double quotes
 *    and escape embedded quotes by doubling them
 *  - everything else → stringified as-is
 *
 * Use this for every CSV cell. Do NOT strip commas — that silently
 * corrupts names like "Smith, Jr." into "Smith Jr" which then loads
 * to the wrong row in downstream tools (Gusto, ADP, QuickBooks).
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Build a CSV blob from rows + headers and trigger a browser download.
 * Browser-only — guard on `typeof document !== "undefined"` if you
 * ever import this from a server context (currently all call sites
 * are operator-facing client components).
 *
 * `rows` may be objects keyed by column or arrays of cell values; the
 * helper resolves cells via the `columns[i].key` when rows are
 * objects. Each cell goes through csvEscape.
 */
export function downloadCsv(args: {
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, unknown>>;
  /** Optional footer row (e.g. totals). Same shape as a data row. */
  totalRow?: Record<string, unknown>;
  /** File basename without .csv extension. */
  filename: string;
}): void {
  const { columns, rows, totalRow, filename } = args;
  const lines: string[] = [];
  lines.push(columns.map((c) => csvEscape(c.label)).join(","));
  for (const r of rows) {
    lines.push(columns.map((c) => csvEscape(r[c.key])).join(","));
  }
  if (totalRow) {
    lines.push(columns.map((c) => csvEscape(totalRow[c.key])).join(","));
  }
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
