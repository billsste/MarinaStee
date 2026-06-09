// Centralized client-side date/time renderer.
//
// Why suppressHydrationWarning lives here (and not at the callsite):
// `toLocaleString` / `toLocaleDateString` / `toLocaleTimeString` are
// locale- AND timezone-sensitive. The server renders with its own
// system locale + UTC, while the browser renders with the user's locale
// + their local timezone — those two strings almost never match, so
// React logs a hydration mismatch warning for every date span.
//
// Wrapping every date render in <LocalTime> means:
//   1. The suppression is in one place, not sprinkled across ~100 files.
//   2. Future contributors physically can't forget it — they pick a
//      preset fmt and the span is correct by construction.
//   3. If we ever ship a tz-stable formatter (e.g. always render in the
//      marina's local tz on both server + client), only this file changes.

type LocalTimeFmt =
  | "time"
  | "date"
  | "datetime"
  | "short_datetime"
  | "weekday"
  | "short_date"
  | "long_date";

interface LocalTimeProps {
  iso: string;
  fmt?: LocalTimeFmt;
  className?: string;
}

// Single source of truth for every date format string used in the app.
// If a callsite needs a new shape, add an entry here — do NOT inline a
// fresh options object at the call site.
const FMT_OPTS: Record<
  LocalTimeFmt,
  { kind: "date" | "time" | "datetime"; options?: Intl.DateTimeFormatOptions }
> = {
  time: {
    kind: "time",
    options: { hour: "numeric", minute: "2-digit" },
  },
  date: {
    kind: "date",
  },
  datetime: {
    kind: "datetime",
  },
  // Compact "Apr 5, 3:42 PM" — for inline comm/activity timestamps
  // where the full toLocaleString() is too noisy.
  short_datetime: {
    kind: "datetime",
    options: {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
  },
  weekday: {
    kind: "date",
    options: { weekday: "long", month: "short", day: "numeric" },
  },
  short_date: {
    kind: "date",
    options: { month: "short", day: "numeric" },
  },
  long_date: {
    kind: "date",
    options: {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    },
  },
};

function format(date: Date, fmt: LocalTimeFmt): string {
  const entry = FMT_OPTS[fmt];
  switch (entry.kind) {
    case "time":
      return date.toLocaleTimeString(undefined, entry.options);
    case "date":
      return date.toLocaleDateString(undefined, entry.options);
    case "datetime":
      return entry.options
        ? date.toLocaleString(undefined, entry.options)
        : date.toLocaleString();
  }
}

// Bare YYYY-MM-DD ISO strings (no time component) are parsed by
// `new Date()` as UTC midnight, which then renders as the *previous*
// calendar day in any negative UTC offset (US in particular). Detect
// that shape and construct a Date from the local-tz calendar
// components instead — keeps "the date someone wrote on a contract"
// rendering as the same day on both server and client.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIso(iso: string): Date {
  if (DATE_ONLY_RE.test(iso)) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(iso);
}

export function LocalTime({ iso, fmt = "date", className }: LocalTimeProps) {
  const date = parseIso(iso);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <span className={className} suppressHydrationWarning>
      {format(date, fmt)}
    </span>
  );
}

export type { LocalTimeFmt, LocalTimeProps };
