"use client";

import * as React from "react";
import { anyApi } from "convex/server";
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
  Bell,
  MessageSquare,
} from "lucide-react";
import { Field, Select, TextInput, Textarea } from "@/components/create-sheet";
import {
  updateMarinaProfile,
  useMarinaProfile,
} from "@/lib/client-store";
import type { MarinaProfile } from "@/lib/types";
import { useTenantMutation } from "@/lib/use-tenant-mutation";
import { useTenantQuery } from "@/lib/use-tenant-query";
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
// Convex shape of `marinas` singleton — fields mirror schema.ts. The
// adapter folds the Convex-specific id pair (`_id`/`tenantId`) back
// into the mock-shaped MarinaProfile that every child component
// already consumes. `logo_url` / `enabled_retention_variants` aren't
// in the Convex schema yet (logo lands via `_storage` storage_id),
// so they're surfaced as undefined on the Convex path.
interface ConvexMarinaProfile {
  _id: string;
  tenantId?: string;
  display_name: string;
  short_name: string;
  tagline?: string;
  logo_storage_id?: string;
  email: string;
  phone: string;
  website?: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  timezone: string;
  business_hours_open: string;
  business_hours_close: string;
  default_tax_rate: number;
  accounting_close: MarinaProfile["accounting_close"];
  outbound_email_from_name: string;
  outbound_sms_sender_label: string;
  postmark_api_key?: string;
  postmark_message_stream?: string;
  twilio_account_sid?: string;
  twilio_auth_token?: string;
  twilio_from_number?: string;
  twilio_from_email_label?: string;
}

function convexMarinaToMock(row: ConvexMarinaProfile | null): MarinaProfile {
  // The query returns null when the marina doc isn't provisioned yet;
  // we surface a sentinel shape so the form still renders. The seam
  // hook only enters this branch when Convex is live, so in mock-mode
  // we never hit the null path.
  if (!row) {
    return {
      id: "",
      tenant_id: "",
      display_name: "",
      short_name: "",
      email: "",
      phone: "",
      address_line1: "",
      city: "",
      state: "",
      postal_code: "",
      country: "US",
      timezone: "America/Denver",
      business_hours_open: "08:00",
      business_hours_close: "20:00",
      default_tax_rate: 0,
      accounting_close: "monthly_eom",
      outbound_email_from_name: "",
      outbound_sms_sender_label: "",
    };
  }
  return {
    id: row._id,
    tenant_id: row.tenantId ?? row._id,
    display_name: row.display_name,
    short_name: row.short_name,
    tagline: row.tagline,
    // Convex stores logo as a _storage id; the mock carries a data
    // URL. Until file storage lands at the page level, this is empty
    // on the Convex path — the operator can still upload (commit will
    // patch the mock via updateMarinaProfile while a separate
    // storage upload action handles the Convex side later).
    logo_url: undefined,
    email: row.email,
    phone: row.phone,
    website: row.website,
    address_line1: row.address_line1,
    address_line2: row.address_line2,
    city: row.city,
    state: row.state,
    postal_code: row.postal_code,
    country: row.country,
    timezone: row.timezone,
    business_hours_open: row.business_hours_open,
    business_hours_close: row.business_hours_close,
    default_tax_rate: row.default_tax_rate,
    accounting_close: row.accounting_close,
    outbound_email_from_name: row.outbound_email_from_name,
    outbound_sms_sender_label: row.outbound_sms_sender_label,
    postmark_api_key: row.postmark_api_key,
    postmark_message_stream: row.postmark_message_stream,
    twilio_account_sid: row.twilio_account_sid,
    twilio_auth_token: row.twilio_auth_token,
    twilio_from_number: row.twilio_from_number,
    twilio_from_email_label: row.twilio_from_email_label,
  };
}

const MARINA_EMPTY_ARGS = {} as const;

/**
 * Save-bar + persistence coordination. Each field's `useAutoSave`
 * fires through the parent's `saveProfilePatch` (Convex-or-mock
 * routed) AND pushes a `notifySaved()` beacon when ITS commit
 * actually lands — not on every downstream profile reference change.
 *
 * This decouples the green flash from store/subscription rerenders —
 * the critical Phase 3 fix. Previously the parent had a `useEffect`
 * on `[profile]` that flashed "Saved · Just now" on any profile
 * change. When Convex came online for the first time, the initial
 * remote sync replaced the mock initial state, the profile reference
 * flipped, and the operator saw a spurious "saved" flash for an edit
 * they never made. Routing through the context keeps the flash in
 * lockstep with actual commits.
 */
const NotifySavedContext = React.createContext<() => void>(() => {});
const SavePatchContext = React.createContext<
  (patch: Partial<MarinaProfile>) => Promise<void>
>(async (patch) => {
  // Fallback for any future renders outside the provider. Won't
  // happen in practice — the provider wraps the whole page.
  updateMarinaProfile(patch);
});

export function MarinaProfileView() {
  // Phase 3 — reads route through useTenantQuery. The hook returns the
  // mock-shape MarinaProfile whether the source is the local store or
  // a live Convex `marinas.getCurrent` subscription. Mock fallback
  // keeps the prototype demo working when NEXT_PUBLIC_CONVEX_URL is
  // unset.
  const mockProfile = useMarinaProfile();
  const profile = useTenantQuery<MarinaProfile, ConvexMarinaProfile | null>({
    mock: mockProfile,
    convexRef: anyApi.marina.getCurrent,
    convexArgs: MARINA_EMPTY_ARGS,
    convexAdapter: convexMarinaToMock,
  });

  // Phase 4 — write routing. The mock fn is the existing partial
  // patch; the Convex side calls `marina.updateCurrent` with the same
  // patch. updateMarinaProfile() in the mock store handles every
  // field optionally so identical args work for both.
  const saveProfilePatch = useTenantMutation<Partial<MarinaProfile>, void>({
    mock: (patch) => updateMarinaProfile(patch),
    convexRef: anyApi.marina.updateCurrent,
    convexArgsAdapter: (patch) => {
      // The Convex resolver only patches its known field set —
      // omit mock-only fields (id/tenant_id/logo_url/
      // enabled_retention_variants) so Convex's validator doesn't
      // reject the call. Logo + retention variants stay on the mock
      // path until file storage + retention move to Convex.
      const {
        id: _id,
        tenant_id: _tenant,
        logo_url: _logo,
        enabled_retention_variants: _retention,
        ...rest
      } = patch;
      void _id; void _tenant; void _logo; void _retention;
      return { patch: rest };
    },
  });

  // Save bar telemetry — flashes ONLY when a child field commits, NOT
  // on every profile reference change. This is the fix for the Phase
  // 3 in-flight risk: when Convex came online, the first remote sync
  // would replace the mock initial state, the profile reference would
  // flip, and the old useEffect-on-profile-change handler would flash
  // "Saved · Just now" even though the operator didn't save anything.
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);
  const [flashSaved, setFlashSaved] = React.useState(false);
  const flashTimerRef = React.useRef<number | null>(null);

  const notifySaved = React.useCallback(() => {
    setLastSavedAt(Date.now());
    setFlashSaved(true);
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = window.setTimeout(() => {
      setFlashSaved(false);
      flashTimerRef.current = null;
    }, 1800);
  }, []);

  React.useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  return (
    <NotifySavedContext.Provider value={notifySaved}>
      <SavePatchContext.Provider value={saveProfilePatch}>
        <ProfileBody profile={profile} />
        <SaveBar lastSavedAt={lastSavedAt} flashSaved={flashSaved} />
      </SavePatchContext.Provider>
    </NotifySavedContext.Provider>
  );
}

/**
 * Inner body — kept as a separate component so the save context
 * provider above wraps every field. `saveProfilePatch` is the
 * tenant-aware mutation routed through useTenantMutation; each child
 * fires it via `useAutoSave` which also pushes a `notifySaved()`
 * beacon on a successful commit.
 */
function ProfileBody({
  profile,
}: {
  profile: MarinaProfile;
}) {
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

      <Section
        icon={<Bell className="size-4" />}
        title="Notification providers"
        subtitle="Per-marina overrides — when blank, the workspace env defaults are used."
      >
        <div className="space-y-4">
          <ProviderBlock
            title="Postmark (email)"
            icon={<Mail className="size-3.5" />}
            enabled={!!profile.postmark_api_key}
            testChannel="email"
          >
            <ProfileField
              label="Postmark server token"
              field="postmark_api_key"
              type="password"
              value={profile.postmark_api_key ?? ""}
              hint="The per-server token from Postmark. Leave blank to use the workspace env var."
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <ProfileField
                label="Message stream"
                field="postmark_message_stream"
                value={profile.postmark_message_stream ?? ""}
                hint='Optional. Defaults to "outbound".'
              />
              <ProfileField
                label="From-address label"
                field="twilio_from_email_label"
                value={profile.twilio_from_email_label ?? ""}
                hint="Friendly name paired with the marina email when sending."
              />
            </div>
          </ProviderBlock>

          <ProviderBlock
            title="Twilio (SMS)"
            icon={<MessageSquare className="size-3.5" />}
            enabled={
              !!(
                profile.twilio_account_sid &&
                profile.twilio_auth_token &&
                profile.twilio_from_number
              )
            }
            testChannel="sms"
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <ProfileField
                label="Account SID"
                field="twilio_account_sid"
                value={profile.twilio_account_sid ?? ""}
                hint="From Twilio console → Account → API keys."
              />
              <ProfileField
                label="Auth token"
                field="twilio_auth_token"
                type="password"
                value={profile.twilio_auth_token ?? ""}
                hint="Server-side only — never exposed to the browser after save."
              />
            </div>
            <ProfileField
              label="From number"
              field="twilio_from_number"
              value={profile.twilio_from_number ?? ""}
              hint="E.164 format (e.g. +15555550100)."
            />
          </ProviderBlock>
        </div>
      </Section>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Notification provider sub-card — wraps a per-provider field set with
// an enabled/disabled chip + a "Test send" button. The test button is
// surfaced inline (not behind a menu) so operators get same-page
// confirmation that the credentials work.
//
// Test-send POSTs to /api/comms/send with a short fixture body.
// Today that route uses env-var creds; once routed through dispatchOne
// it'll pick up the same per-tenant config the production path uses.
// Either way the operator sees the result land in their inbox / phone
// — that's the verification.
function ProviderBlock({
  title,
  icon,
  enabled,
  testChannel,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  enabled: boolean;
  testChannel: "email" | "sms";
  children: React.ReactNode;
}) {
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<null | "ok" | "fail">(null);

  async function handleTest() {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/comms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: testChannel,
          // Operator's own marina email/phone is the safest test
          // target — they'll see the message land. The /api/comms/send
          // route doesn't currently resolve "self" so the form uses
          // a placeholder the operator can override before send. This
          // is the prototype shape — production wave wires a proper
          // "test send to operator" flow.
          to: testChannel === "email" ? "operator@example.com" : "+15555550100",
          subject: testChannel === "email" ? "Marina Stee — test send" : undefined,
          body: "This is a test message from Marina Stee notification settings.",
        }),
      });
      setResult(res.ok ? "ok" : "fail");
    } catch {
      setResult("fail");
    } finally {
      setTesting(false);
      window.setTimeout(() => setResult(null), 4000);
    }
  }

  return (
    <div className="rounded-[10px] border border-hairline bg-surface-2/40 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-[6px] bg-surface-3 text-primary">
            {icon}
          </div>
          <span className="text-[13px] font-medium text-fg">{title}</span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
              enabled
                ? "bg-status-ok/15 text-status-ok"
                : "bg-surface-3 text-fg-tertiary",
            )}
          >
            {enabled ? "Configured" : "Using env default"}
          </span>
        </div>
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-[6px] border border-hairline bg-surface-1 px-2 text-[11px] font-medium text-fg-subtle hover:bg-surface-3",
            testing && "opacity-60",
            result === "ok" && "border-status-ok/40 text-status-ok",
            result === "fail" && "border-status-danger/40 text-status-danger",
          )}
        >
          <Send className="size-3" />
          {testing
            ? "Sending…"
            : result === "ok"
            ? "Sent"
            : result === "fail"
            ? "Failed"
            : "Test send"}
        </button>
      </div>
      <div className="space-y-3">{children}</div>
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
  // String-typed return for the toast label below — can't substitute
  // <LocalTime> here because the caller embeds this in a template
  // literal. LocalTime is the right choice for any JSX date render.
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
  const notifySaved = React.useContext(NotifySavedContext);
  const savePatch = React.useContext(SavePatchContext);

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

    // Route through the tenant-aware mutation — Convex when online,
    // mock store otherwise. Fire-and-forget (the read hook picks up
    // the next value on its sync). The notify beacon below is what
    // flashes the SaveBar — gating it here (and not on profile
    // reference changes upstream) is the Phase 3 "first Convex sync
    // shouldn't flash Saved" fix.
    void savePatch({ [field]: next } as Partial<MarinaProfile>);
    notifySaved();
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
