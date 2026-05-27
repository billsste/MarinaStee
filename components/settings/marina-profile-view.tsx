"use client";

import * as React from "react";
import {
  Building2,
  Mail,
  MapPin,
  Clock,
  Percent,
  Send,
  Upload,
  X,
  Check,
  CheckCircle2,
} from "lucide-react";
import { Field, Select, TextInput, Textarea } from "@/components/create-sheet";
import {
  updateMarinaProfile,
  useMarinaProfile,
} from "@/lib/client-store";
import type { MarinaProfile } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * Marina Profile editor.
 *
 * UX: auto-save on blur. Each input is a self-contained controlled
 * field with its own local draft state; on blur (or Enter on a single-
 * line input) the field commits its value to the global profile via
 * updateMarinaProfile(). A short "Saved" pip flashes on the field that
 * just committed so the operator gets confirmation without a global
 * toast.
 *
 * The default_tax_rate field is displayed/edited as a percent string
 * (e.g. "8.25") but stored as a decimal (0.0825). All other numeric-ish
 * fields are stored as the canonical string.
 */
export function MarinaProfileView() {
  const profile = useMarinaProfile();

  // Save bar telemetry — track when the profile was last mutated so the
  // bottom status pill can render "Saved · Just now" / "Saved · 2 min
  // ago". Auto-save commits happen on field blur (see useAutoSave).
  const isFirstRender = React.useRef(true);
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);
  const [flashSaved, setFlashSaved] = React.useState(false);

  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // profile reference changed → store committed → confirm to operator
    setLastSavedAt(Date.now());
    setFlashSaved(true);
    const t = window.setTimeout(() => setFlashSaved(false), 1800);
    return () => window.clearTimeout(t);
  }, [profile]);

  return (
    <div className="space-y-4 pb-24">
      <Section
        icon={<Building2 className="size-4" />}
        title="Branding"
        subtitle="Name, tagline, and logo — used on receipts, portal, and contracts."
      >
        <LogoField value={profile.logo_url} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ProfileField
            label="Display name"
            field="display_name"
            value={profile.display_name}
            required
            hint='Full marina name. Appears in headers and on signed contracts.'
          />
          <ProfileField
            label="Short name"
            field="short_name"
            value={profile.short_name}
            required
            hint="Used in tight UI chrome and SMS-from labels."
          />
        </div>
        <ProfileField
          label="Tagline"
          field="tagline"
          value={profile.tagline ?? ""}
          hint="Optional. One line under the logo on receipts."
        />
      </Section>

      <Section
        icon={<Mail className="size-4" />}
        title="Contact"
        subtitle="The marina's public contact channels."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ProfileField
            label="Email"
            field="email"
            type="email"
            value={profile.email}
            required
          />
          <ProfileField
            label="Phone"
            field="phone"
            type="tel"
            value={profile.phone}
            required
          />
        </div>
        <ProfileField
          label="Website"
          field="website"
          type="url"
          value={profile.website ?? ""}
          hint="Optional. Linked from receipts and the public portal."
        />
      </Section>

      <Section
        icon={<MapPin className="size-4" />}
        title="Address"
        subtitle="Physical address. Shown on receipts and used for tax + remit-to."
      >
        <ProfileField
          label="Street address"
          field="address_line1"
          value={profile.address_line1}
          required
        />
        <ProfileField
          label="Suite / unit"
          field="address_line2"
          value={profile.address_line2 ?? ""}
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <ProfileField
            label="City"
            field="city"
            value={profile.city}
            required
          />
          <ProfileField
            label="State"
            field="state"
            value={profile.state}
            required
          />
          <ProfileField
            label="Postal code"
            field="postal_code"
            value={profile.postal_code}
            required
          />
          <ProfileField
            label="Country"
            field="country"
            value={profile.country}
            required
          />
        </div>
      </Section>

      <Section
        icon={<Clock className="size-4" />}
        title="Operations"
        subtitle="Timezone and dock-office hours."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <ProfileField
            label="Time zone"
            field="timezone"
            value={profile.timezone}
            required
            hint="IANA name (e.g. America/Denver)."
          />
          <TimeField
            label="Hours open"
            field="business_hours_open"
            value={profile.business_hours_open}
          />
          <TimeField
            label="Hours close"
            field="business_hours_close"
            value={profile.business_hours_close}
          />
        </div>
      </Section>

      <Section
        icon={<Percent className="size-4" />}
        title="Tax & accounting"
        subtitle="Defaults applied to new sales and the monthly close cadence."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <TaxRateField value={profile.default_tax_rate} />
          <AccountingCloseField value={profile.accounting_close} />
        </div>
      </Section>

      <Section
        icon={<Send className="size-4" />}
        title="Outbound sender labels"
        subtitle="How the marina identifies itself in email + SMS."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ProfileField
            label="Email from-name"
            field="outbound_email_from_name"
            value={profile.outbound_email_from_name}
            required
            hint='Appears in the "From" line of outbound email.'
          />
          <ProfileField
            label="SMS sender label"
            field="outbound_sms_sender_label"
            value={profile.outbound_sms_sender_label}
            required
            hint="Short label that prefixes outbound SMS (11 chars max on most carriers)."
          />
        </div>
      </Section>

      <SaveBar lastSavedAt={lastSavedAt} flashSaved={flashSaved} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sticky save-status bar — gives the operator constant visual confirmation
// that auto-save is working. Settings pages historically committed silently
// on blur; users want to see proof. Bar sits fixed at the bottom-right of
// the viewport and shows:
//   - "All changes saved" with a green check when clean
//   - "Saved · Just now" flashing green for ~2s after each commit
//   - "Saved · 5 min ago" stable state afterward

function SaveBar({
  lastSavedAt,
  flashSaved,
}: {
  lastSavedAt: number | null;
  flashSaved: boolean;
}) {
  const [, force] = React.useState(0);
  // Re-render once a minute so "5 min ago" stays current
  React.useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const label = !lastSavedAt
    ? "All changes saved"
    : flashSaved
    ? "Saved · Just now"
    : `Saved · ${formatRelative(lastSavedAt)}`;

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-40 flex justify-end">
      <div
        className={
          "pointer-events-auto inline-flex items-center gap-2 rounded-full border bg-surface-1 px-3 py-1.5 text-[12px] font-medium shadow-md transition-colors " +
          (flashSaved
            ? "border-status-ok/40 bg-status-ok/10 text-status-ok"
            : "border-hairline text-fg-subtle")
        }
      >
        <CheckCircle2
          className={
            "size-3.5 " + (flashSaved ? "text-status-ok" : "text-fg-tertiary")
          }
        />
        <span>{label}</span>
      </div>
    </div>
  );
}

function formatRelative(ts: number): string {
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleDateString();
}

// ─────────────────────────────────────────────────────────────────────
// Section card — matches the SettingsCard pattern in app/settings/page.tsx
// (border-hairline + rounded-[12px] + bg-surface-1, padded header
// + body) so this page reads as part of the same family.

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[12px] border border-hairline bg-surface-1">
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-[6px] bg-surface-3 text-primary">
            {icon}
          </div>
          <div>
            <h3 className="text-[14px] font-medium text-fg">{title}</h3>
            {subtitle && (
              <p className="text-[11px] text-fg-tertiary">{subtitle}</p>
            )}
          </div>
        </div>
      </header>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Auto-save hook. Hands back a stable `commit` function that diffs the
// draft against the canonical value and only writes when they differ —
// and only when the value is non-empty (or the field is allowed to be
// blank). Returns the savedAt timestamp so consumers can flash a "Saved"
// chip when the value changes.

function useAutoSave<K extends keyof MarinaProfile>(
  field: K,
  canonical: MarinaProfile[K],
  options?: { allowEmpty?: boolean; transform?: (raw: string) => MarinaProfile[K] }
) {
  const [savedAt, setSavedAt] = React.useState(0);

  function commit(rawDraft: string) {
    const allowEmpty = options?.allowEmpty ?? false;
    const transform = options?.transform;
    const next = transform
      ? transform(rawDraft)
      : (rawDraft as unknown as MarinaProfile[K]);

    if (!allowEmpty && typeof next === "string" && next.trim() === "") {
      // Don't blow away required fields on accidental blank.
      return false;
    }
    if (next === canonical) return false;

    updateMarinaProfile({ [field]: next } as Partial<MarinaProfile>);
    setSavedAt(Date.now());
    return true;
  }

  // savedAt → "show pip for 1.4s"
  const showSavedPip = savedAt > 0 && Date.now() - savedAt < 1400;
  React.useEffect(() => {
    if (savedAt === 0) return;
    const id = window.setTimeout(() => setSavedAt(0), 1400);
    return () => window.clearTimeout(id);
  }, [savedAt]);

  return { commit, showSavedPip };
}

// ─────────────────────────────────────────────────────────────────────
// String field. Local draft state so typing isn't blocked on the store
// roundtrip; commits to the store on blur or Enter.

function ProfileField({
  label,
  field,
  value,
  type = "text",
  required,
  hint,
}: {
  label: string;
  field: keyof MarinaProfile;
  value: string;
  type?: React.HTMLInputTypeAttribute;
  required?: boolean;
  hint?: string;
}) {
  // The "required" fields per the type are required to be non-empty,
  // but tagline/website/address_line2/logo_url are optional.
  const allowEmpty = !required;

  const [draft, setDraft] = React.useState(value);
  // If the canonical value changes from outside (e.g. agent edit), sync.
  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  const { commit, showSavedPip } = useAutoSave(field, value as MarinaProfile[typeof field], {
    allowEmpty,
  });

  function handleCommit() {
    const didCommit = commit(draft);
    if (!didCommit && draft !== value) {
      // Rejected (e.g. empty on required) — snap back so UI matches state.
      setDraft(value);
    }
  }

  return (
    <Field label={label} required={required} hint={hint}>
      <div className="relative">
        <TextInput
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            }
            if (e.key === "Escape") {
              setDraft(value);
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
        />
        <SavedPip show={showSavedPip} />
      </div>
    </Field>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Time field — HH:MM. Native time input; commits on change since the
// picker UX commits-on-selection naturally.

function TimeField({
  label,
  field,
  value,
}: {
  label: string;
  field: "business_hours_open" | "business_hours_close";
  value: string;
}) {
  const { commit, showSavedPip } = useAutoSave(field, value);
  return (
    <Field label={label}>
      <div className="relative">
        <input
          type="time"
          value={value}
          onChange={(e) => commit(e.target.value)}
          className={cn(
            "tabular h-10 w-full rounded-[8px] border border-hairline bg-surface-2 px-3 text-[14px] text-fg focus:border-hairline-strong focus:outline-none"
          )}
        />
        <SavedPip show={showSavedPip} />
      </div>
    </Field>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tax rate — display percent, store decimal.

function TaxRateField({ value }: { value: number }) {
  // Draft is the percent string, e.g. "8.25" for stored 0.0825.
  const formatted = React.useMemo(
    () => formatPercent(value),
    [value]
  );
  const [draft, setDraft] = React.useState(formatted);
  React.useEffect(() => {
    setDraft(formatted);
  }, [formatted]);

  const { commit, showSavedPip } = useAutoSave("default_tax_rate", value, {
    transform: (raw) => {
      const pct = parseFloat(raw);
      if (Number.isNaN(pct)) return value;
      // Clamp 0..100 then convert to 0..1 decimal.
      const clamped = Math.max(0, Math.min(100, pct));
      return Math.round((clamped / 100) * 100_000) / 100_000;
    },
  });

  function handleCommit() {
    const pct = parseFloat(draft);
    if (Number.isNaN(pct)) {
      setDraft(formatted); // snap back on garbage
      return;
    }
    const committed = commit(draft);
    if (!committed) setDraft(formatted);
  }

  return (
    <Field
      label="Default tax rate"
      hint="Percent (e.g. 8.25 for 8.25%). Stored as a decimal under the hood."
    >
      <div className="relative">
        <div className="flex items-center gap-2 rounded-[8px] border border-hairline bg-surface-2 px-3 focus-within:border-hairline-strong">
          <input
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              }
              if (e.key === "Escape") {
                setDraft(formatted);
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            className="tabular h-10 flex-1 bg-transparent text-[14px] text-fg placeholder:text-fg-tertiary focus:outline-none"
            placeholder="0.00"
          />
          <span className="text-[12px] text-fg-tertiary">%</span>
        </div>
        <SavedPip show={showSavedPip} />
      </div>
    </Field>
  );
}

function formatPercent(decimal: number): string {
  // Avoid floating-point junk like "8.249999".
  const pct = decimal * 100;
  const rounded = Math.round(pct * 1000) / 1000;
  return rounded.toString();
}

// ─────────────────────────────────────────────────────────────────────
// Accounting close — 3-option select. Native <select> via Select atom
// is fine here (3 options, well under the 5-option combobox cutoff).

function AccountingCloseField({
  value,
}: {
  value: MarinaProfile["accounting_close"];
}) {
  const { commit, showSavedPip } = useAutoSave("accounting_close", value);
  return (
    <Field label="Accounting close cadence">
      <div className="relative">
        <Select
          value={value}
          onChange={(v) => commit(v)}
        >
          <option value="monthly_eom">Monthly · last day of month</option>
          <option value="monthly_15th">Monthly · 15th of month</option>
          <option value="weekly_friday">Weekly · Friday</option>
        </Select>
        <SavedPip show={showSavedPip} />
      </div>
    </Field>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Logo — file upload that converts to a data URL via FileReader, with
// a small preview and a clear button.

function LogoField({ value }: { value?: string }) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const { commit, showSavedPip } = useAutoSave("logo_url", value, {
    allowEmpty: true,
  });

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        commit(reader.result);
      }
    };
    reader.readAsDataURL(file);
    // Reset input so re-selecting the same file still fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function clearLogo() {
    commit("");
  }

  return (
    <Field label="Logo" hint="PNG or SVG, square works best. Stored inline for the prototype.">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-hairline bg-surface-2",
            value && "border-hairline-strong"
          )}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt="Marina logo preview"
              className="size-full object-contain"
            />
          ) : (
            <Building2 className="size-5 text-fg-tertiary" aria-hidden />
          )}
        </div>
        <div className="flex flex-1 items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-hairline bg-surface-2 px-3 text-[13px] text-fg hover:bg-surface-3"
          >
            <Upload className="size-3.5" />
            {value ? "Replace" : "Upload"}
          </button>
          {value && (
            <button
              type="button"
              onClick={clearLogo}
              className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-hairline bg-surface-2 px-3 text-[13px] text-fg-subtle hover:bg-surface-3 hover:text-fg"
            >
              <X className="size-3.5" />
              Remove
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFile}
            className="hidden"
          />
          <div className="relative ml-auto">
            <SavedPip show={showSavedPip} inline />
          </div>
        </div>
      </div>
    </Field>
  );
}

// ─────────────────────────────────────────────────────────────────────
// "Saved" pip. Inline mode floats next to a sibling; default mode
// absolute-positions in the top-right of the input shell.

function SavedPip({ show, inline }: { show: boolean; inline?: boolean }) {
  if (!show) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-status-ok/15 px-1.5 py-0.5 text-[10px] font-medium text-status-ok",
        inline
          ? ""
          : "pointer-events-none absolute -top-2 right-2 bg-surface-1 px-1.5 py-0 shadow-[0_0_0_1px_var(--color-hairline)]"
      )}
    >
      <Check className="size-3" />
      Saved
    </span>
  );
}

// Textarea import preserved for future fields (e.g. multi-line tagline).
// Not currently used but worth keeping consistent with create-sheet API.
void Textarea;
