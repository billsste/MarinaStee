"use client";

import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Link2,
  Mail,
  MessageCircle,
  Cloud,
  ChevronDown,
} from "lucide-react";
import { anyApi } from "convex/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineEditCell } from "@/components/ui/inline-edit-cell";
import {
  updateProviderConfig,
  useProviderConfigs,
} from "@/lib/client-store";
import type { AppProviderConfig } from "@/lib/types";
import { useTenantMutation } from "@/lib/use-tenant-mutation";
import { useTenantQuery } from "@/lib/use-tenant-query";
import { cn } from "@/lib/utils";

/*
 * Settings → Connections. One flat table with a row per provider.
 *
 * Click the provider name row to expand the credential editor. Each
 * credential field is its own inline-editable cell — click to edit,
 * Enter / blur to save, Escape to cancel. No "Save" button needed.
 *
 * Status pills flip automatically based on credential presence: if a
 * secret is set + at least one identifying field is filled, the provider
 * shows "connected".
 */

// Inlined grid template — Tailwind v4 JIT silently drops arbitrary
// `grid-cols-[…minmax(0,Xfr)…]` so the rows collapse to a single column.
const CONNECTIONS_COLS = "28px minmax(0, 1.4fr) 120px minmax(0, 2fr) 28px";

type ProviderField = {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
};

const KIND_META: Record<
  AppProviderConfig["kind"],
  {
    label: string;
    icon: React.ReactNode;
    fields: ProviderField[];
  }
> = {
  payment: {
    label: "Payments",
    icon: <CreditCard className="size-3.5" />,
    fields: [
      { key: "publishable_key", label: "Publishable key", placeholder: "pk_live_…" },
      { key: "secret_key", label: "Secret key", placeholder: "sk_live_…", secret: true },
      { key: "default_currency", label: "Default currency", placeholder: "usd" },
      { key: "webhook_secret", label: "Webhook signing secret", placeholder: "whsec_…", secret: true },
    ],
  },
  email: {
    label: "Email",
    icon: <Mail className="size-3.5" />,
    fields: [
      { key: "server_token", label: "Server token", placeholder: "Postmark server token", secret: true },
      { key: "from_address", label: "From address", placeholder: "marina@example.com" },
      { key: "reply_to", label: "Reply-to (optional)", placeholder: "harbormaster@example.com" },
    ],
  },
  sms: {
    label: "SMS",
    icon: <MessageCircle className="size-3.5" />,
    fields: [
      { key: "account_sid", label: "Account SID", placeholder: "AC…" },
      { key: "auth_token", label: "Auth token", placeholder: "Twilio auth token", secret: true },
      { key: "from_number", label: "From number", placeholder: "+15055550100" },
    ],
  },
  accounting: {
    label: "Accounting",
    icon: <Cloud className="size-3.5" />,
    fields: [
      { key: "realm_id", label: "Company / realm ID", placeholder: "9341452847219000" },
      { key: "oauth_refresh", label: "OAuth refresh token", placeholder: "(set via Connect)", secret: true },
      { key: "default_class", label: "Default class", placeholder: "Marina" },
    ],
  },
};

/*
 * Phase 3 + 4 (Wave 3) migration. Reads flow through `useTenantQuery`
 * (mock fallback when Convex isn't online); writes flow through
 * `useTenantMutation` declared inside `CredentialEditor`.
 *
 * The Convex schema for `providerConfigs` is intentionally narrow
 * (kind / provider / enabled / public_config / has_secret) — Wave 3's
 * directive forbade extending existing tables. We pack the page-level
 * surface (display_name, status, the config map, connected_at,
 * last_error) into the existing `public_config` JSON blob. See
 * `convex/providers.ts → update` for the server-side merge semantics
 * and `PackedPublicConfig` below for the wire shape.
 */

// Shape returned by `convex/providers.ts:list`. The Convex schema is
// intentionally narrow — `public_config` is a JSON blob that carries
// the full page-level state (display_name, status, config map,
// connected_at, last_error). We pack everything there so the schema
// doesn't need to grow per Wave 3's "no extending existing tables"
// directive.
interface ConvexProviderConfig {
  _id: string;
  tenantId: string;
  kind: AppProviderConfig["kind"];
  provider: string;
  enabled: boolean;
  has_secret: boolean;
  public_config?: string;
}

// Shape we serialize into `public_config`. Matches the mock
// `AppProviderConfig` minus identity fields the Convex doc already
// carries (`id`/`tenant_id`/`kind`/`provider`).
interface PackedPublicConfig {
  display_name?: string;
  status?: AppProviderConfig["status"];
  config?: Record<string, string | number | boolean | null>;
  connected_at?: string;
  last_error?: string;
}

function parsePublicConfig(raw?: string): PackedPublicConfig {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as PackedPublicConfig;
  } catch {
    // Legacy / corrupt JSON — page renders with an empty config map
    // so the operator can still re-enter credentials.
  }
  return {};
}

function convexProvidersToMock(
  rows: ConvexProviderConfig[]
): AppProviderConfig[] {
  return rows.map((r) => {
    const packed = parsePublicConfig(r.public_config);
    return {
      id: r._id,
      tenant_id: r.tenantId,
      kind: r.kind,
      provider: r.provider as AppProviderConfig["provider"],
      display_name:
        packed.display_name ??
        `${r.provider.charAt(0).toUpperCase()}${r.provider.slice(1)}`,
      status:
        packed.status ??
        (r.enabled
          ? "connected"
          : ("disconnected" as AppProviderConfig["status"])),
      config: packed.config ?? {},
      connected_at: packed.connected_at,
      last_error: packed.last_error,
    };
  });
}

const EMPTY_ARGS = {} as const;

export function ConnectionsView() {
  const mockProviders = useProviderConfigs();
  const providers = useTenantQuery<AppProviderConfig[], ConvexProviderConfig[]>(
    {
      mock: mockProviders,
      convexRef: anyApi.providers.list,
      convexArgs: EMPTY_ARGS,
      convexAdapter: convexProvidersToMock,
    }
  );

  // Sort: connected first, then needs_attention, then disconnected; secondary by kind label
  const sorted = [...providers].sort((a, b) => {
    const order: Record<AppProviderConfig["status"], number> = {
      connected: 0,
      needs_attention: 1,
      disconnected: 2,
    };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return KIND_META[a.kind].label.localeCompare(KIND_META[b.kind].label);
  });

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1">
        <div
          className="grid gap-x-3 border-b border-hairline bg-surface-2 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-fg-tertiary"
          style={{ gridTemplateColumns: CONNECTIONS_COLS }}
        >
          <span></span>
          <span>Provider</span>
          <span>Status</span>
          <span>Detail</span>
          <span></span>
        </div>
        {sorted.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-fg-tertiary">
            No providers configured.
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {sorted.map((p) => (
              <ProviderRow key={p.id} provider={p} />
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11px] text-fg-tertiary">
        Click any row to edit credentials. Network calls go live when the real
        backend lands — configurations persist here so the UI reflects the
        right connection state.
      </p>
    </div>
  );
}

function ProviderRow({ provider }: { provider: AppProviderConfig }) {
  const [expanded, setExpanded] = React.useState(false);
  const meta = KIND_META[provider.kind];
  const tone =
    provider.status === "connected"
      ? "ok"
      : provider.status === "needs_attention"
      ? "warn"
      : "neutral";
  const statusIcon =
    provider.status === "connected" ? (
      <CheckCircle2 className="size-3" />
    ) : provider.status === "needs_attention" ? (
      <AlertCircle className="size-3" />
    ) : (
      <Link2 className="size-3" />
    );

  // Build a short detail summary — primary identifier or "Not connected"
  const primary = meta.fields.find((f) => !f.secret);
  const primaryValue = primary ? provider.config[primary.key] : null;
  const summary =
    provider.last_error ||
    (primaryValue ? String(primaryValue) : "Not configured");

  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="grid w-full items-center gap-x-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
        style={{ gridTemplateColumns: CONNECTIONS_COLS }}
      >
        <span className="text-fg-subtle">{meta.icon}</span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-fg">
            {provider.display_name}
          </span>
          <span className="block text-[10px] uppercase tracking-wide text-fg-tertiary">
            {meta.label}
          </span>
        </span>
        <span>
          <Badge tone={tone} size="sm">
            {statusIcon}
            {provider.status.replace("_", " ")}
          </Badge>
        </span>
        <span
          className={cn(
            "min-w-0 truncate text-[12px]",
            provider.last_error ? "text-status-warn" : "text-fg-subtle"
          )}
        >
          {summary}
        </span>
        <ChevronDown
          className={cn(
            "size-4 text-fg-tertiary transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>
      {expanded && <CredentialEditor provider={provider} fields={meta.fields} />}
    </li>
  );
}

function CredentialEditor({
  provider,
  fields,
}: {
  provider: AppProviderConfig;
  fields: ProviderField[];
}) {
  // Phase 4 — page-side update routed through useTenantMutation.
  // Mock side hits `updateProviderConfig` directly (partial patch on
  // the in-memory store). Convex side has two arg surfaces:
  //   - `config_patch`: narrow per-field shallow-merge. Used by
  //     `saveField` so operator-rapid-fire across pk/sk/whsec doesn't
  //     trample siblings via a stale closure snapshot of `provider.config`.
  //   - `public_config_patch`: legacy whole-blob shape. Still used by
  //     `disconnect()` where we want to overwrite the entire config map
  //     atomically (clear all credentials at once).
  // See `convex/providers.ts:update` for the server-side merge semantics.
  const patchProvider = useTenantMutation<
    {
      id: string;
      patch: Partial<AppProviderConfig>;
      /** When true, encode as the legacy whole-blob shape (used by disconnect). */
      legacyBlob?: boolean;
      /** Narrow per-field config patch — wins over `patch.config`. */
      configPatch?: Record<string, string | number | boolean | null>;
    },
    void
  >({
    mock: ({ id, patch }) => updateProviderConfig(id, patch),
    convexRef: anyApi.providers.update,
    convexArgsAdapter: ({ id, patch, legacyBlob, configPatch }) => {
      // Helper: derive has_secret from a (full) config map.
      const deriveHasSecret = (
        cfg: Record<string, string | number | boolean | null>,
      ): boolean =>
        Object.entries(cfg).some(
          ([k, v]) => k.endsWith("_set") && v === true,
        );

      if (legacyBlob) {
        const packed: PackedPublicConfig = {};
        if (patch.display_name !== undefined)
          packed.display_name = patch.display_name;
        if (patch.status !== undefined) packed.status = patch.status;
        if (patch.config !== undefined) packed.config = patch.config;
        if (patch.connected_at !== undefined)
          packed.connected_at = patch.connected_at;
        if (patch.last_error !== undefined)
          packed.last_error = patch.last_error;
        const has_secret =
          patch.config !== undefined
            ? deriveHasSecret(patch.config)
            : undefined;
        const args: Record<string, unknown> = {
          id,
          public_config_patch: JSON.stringify(packed),
        };
        if (has_secret !== undefined) args.has_secret = has_secret;
        return args;
      }

      // Narrow surface. Each field becomes its own arg so the server-
      // side resolver merges atomically — no client-side closure-
      // snapshot involved in deciding which siblings survive.
      const args: Record<string, unknown> = { id };
      if (configPatch !== undefined) args.config_patch = configPatch;
      if (patch.status !== undefined) args.status_patch = patch.status;
      if (patch.connected_at !== undefined)
        args.connected_at_patch = patch.connected_at;
      if (patch.last_error !== undefined)
        args.last_error_patch = patch.last_error ?? null;
      // has_secret is only meaningful when the patched field IS a secret
      // — pass through when the caller provided a configPatch that
      // touches a `${field}_set` key.
      if (configPatch !== undefined) {
        const touchesSecret = Object.keys(configPatch).some((k) =>
          k.endsWith("_set"),
        );
        if (touchesSecret) {
          // Mirror the prior derive: if the patch sets ANY _set flag to
          // true, has_secret becomes true. If a patch only clears flags,
          // we don't know whether siblings still hold true → omit
          // has_secret rather than overwriting it incorrectly. The
          // server will leave the field alone when omitted.
          const setsTrue = Object.entries(configPatch).some(
            ([k, v]) => k.endsWith("_set") && v === true,
          );
          if (setsTrue) args.has_secret = true;
        }
      }
      return args;
    },
  });

  function fieldDisplayValue(f: ProviderField): string {
    if (f.secret) {
      const setKey = `${f.key}_set`;
      return provider.config[setKey] === true ? "••••••••" : "";
    }
    const v = provider.config[f.key];
    return v != null ? String(v) : "";
  }

  function saveField(f: ProviderField, next: string | number) {
    const value = String(next);
    // NARROW patch: only the field the operator actually changed.
    // Operators tabbing through pk → sk → whsec each fire `saveField`
    // with a snapshot of `provider.config` from when their tab opened
    // the row; if we send the FULL config map every time, the second
    // and third writes carry stale snapshots and clobber each other on
    // the server merge. Sending only the delta lets Convex shallow-
    // merge each call atomically — no closure race.
    const configPatch: Record<string, string | number | boolean | null> = {};
    if (f.secret) {
      if (value && value !== "••••••••") {
        configPatch[`${f.key}_set`] = true;
      } else if (value === "") {
        configPatch[`${f.key}_set`] = false;
      }
    } else {
      configPatch[f.key] = value;
    }

    // Recompute status. This still has to consider the projected next
    // state of ALL fields (config gets merged on the server, so we
    // derive status against the merged shape locally). The status
    // itself flows through its own dedicated arg on the server, so
    // even if the closure snapshot of siblings is stale, the only
    // thing affected is `status` and `connected_at` — both of which
    // are non-secret summary fields the operator can re-toggle if
    // needed.
    const projected: Record<string, string | number | boolean | null> = {
      ...provider.config,
      ...configPatch,
    };
    const hasSecret = fields.some(
      (ff) => ff.secret && projected[`${ff.key}_set`] === true
    );
    const hasIdentifier = fields.some((ff) => {
      if (ff.secret) return false;
      const v = projected[ff.key];
      return v != null && String(v).length > 0;
    });
    const nextStatus: AppProviderConfig["status"] =
      hasSecret && hasIdentifier ? "connected" : "disconnected";

    void patchProvider({
      id: provider.id,
      patch: {
        // Full config still goes on the mock-side patch — mock store's
        // `updateProviderConfig` does its own shallow merge so passing
        // a single-key map would drop siblings. Convex side ignores
        // `patch.config` because we pass `configPatch` instead.
        config: projected,
        status: nextStatus,
        connected_at:
          nextStatus === "connected" && provider.status !== "connected"
            ? new Date().toISOString()
            : provider.connected_at,
        last_error: undefined,
      },
      configPatch,
    });
  }

  function disconnect() {
    if (
      !window.confirm(
        `Disconnect ${provider.display_name}? Stored credentials will be cleared.`
      )
    )
      return;
    const cleared: Record<string, string | number | boolean | null> = {};
    for (const f of fields) {
      if (f.secret) {
        cleared[`${f.key}_set`] = false;
      } else {
        cleared[f.key] = "";
      }
    }
    // Use the legacy whole-blob shape — disconnect intentionally clears
    // ALL credentials atomically, so sending the full config map (rather
    // than a narrow patch) is the right semantic.
    void patchProvider({
      id: provider.id,
      patch: {
        config: cleared,
        status: "disconnected",
        last_error: undefined,
        connected_at: undefined,
      },
      legacyBlob: true,
    });
  }

  return (
    <div className="border-t border-hairline bg-surface-2 px-4 py-3">
      <ul className="divide-y divide-hairline rounded-[8px] border border-hairline bg-surface-1">
        {fields.map((f) => {
          const display = fieldDisplayValue(f);
          return (
            <li
              key={f.key}
              className="group grid grid-cols-[180px_1fr] items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-2"
            >
              <span className="text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
                {f.label}
              </span>
              <span className={cn("min-w-0", f.secret && "font-mono")}>
                <InlineEditCell
                  value={display}
                  placeholder={f.placeholder ?? "Not set"}
                  inputClassName="w-full max-w-md"
                  onSave={(next) => saveField(f, next)}
                />
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex items-center justify-end">
        {provider.status === "connected" && (
          <Button variant="ghost" size="sm" onClick={disconnect}>
            Disconnect
          </Button>
        )}
      </div>
    </div>
  );
}
