"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, CreditCard, Link2, Mail, MessageCircle, Cloud, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  updateProviderConfig,
  useProviderConfigs,
} from "@/lib/client-store";
import type { AppProviderConfig } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * Settings → Connections. Per-tenant provider configs for payments
 * (Stripe/Square), email (Postmark/Sendgrid), SMS (Twilio/MessageBird),
 * and accounting (QuickBooks/Xero). The UI persists config locally —
 * real network calls land when the backend does.
 */

const KIND_META: Record<AppProviderConfig["kind"], { label: string; icon: React.ReactNode; description: string; fields: { key: string; label: string; placeholder?: string; secret?: boolean }[] }> = {
  payment: {
    label: "Payments",
    icon: <CreditCard className="size-4" />,
    description: "Card + ACH processing. Stripe is the default; Square is a drop-in alternative.",
    fields: [
      { key: "publishable_key", label: "Publishable key", placeholder: "pk_live_…" },
      { key: "secret_key", label: "Secret key", placeholder: "sk_live_… or rk_live_…", secret: true },
      { key: "default_currency", label: "Default currency", placeholder: "usd" },
      { key: "webhook_secret", label: "Webhook signing secret", placeholder: "whsec_…", secret: true },
    ],
  },
  email: {
    label: "Email",
    icon: <Mail className="size-4" />,
    description: "Outbound transactional email (receipts, contract links, COI reminders).",
    fields: [
      { key: "server_token", label: "Server token", placeholder: "Postmark server token", secret: true },
      { key: "from_address", label: "From address", placeholder: "marina@example.com" },
      { key: "reply_to", label: "Reply-to (optional)", placeholder: "harbormaster@example.com" },
    ],
  },
  sms: {
    label: "SMS",
    icon: <MessageCircle className="size-4" />,
    description: "Outbound SMS — payment reminders, waitlist offers, storm alerts.",
    fields: [
      { key: "account_sid", label: "Account SID", placeholder: "AC…" },
      { key: "auth_token", label: "Auth token", placeholder: "Twilio auth token", secret: true },
      { key: "from_number", label: "From number", placeholder: "+15055550100" },
    ],
  },
  accounting: {
    label: "Accounting",
    icon: <Cloud className="size-4" />,
    description: "GL sync. QuickBooks Online today; Xero coming.",
    fields: [
      { key: "realm_id", label: "Company / realm ID", placeholder: "9341452847219000" },
      { key: "oauth_refresh", label: "OAuth refresh token", placeholder: "(set via Connect button)", secret: true },
      { key: "default_class", label: "Default class", placeholder: "Marina" },
    ],
  },
};

export function ConnectionsView() {
  const providers = useProviderConfigs();
  return (
    <div className="space-y-4">
      {(Object.keys(KIND_META) as AppProviderConfig["kind"][]).map((kind) => {
        const inGroup = providers.filter((p) => p.kind === kind);
        const meta = KIND_META[kind];
        return (
          <section
            key={kind}
            className="overflow-hidden rounded-[12px] border border-hairline bg-surface-1"
          >
            <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
              <div className="flex size-9 items-center justify-center rounded-[8px] bg-surface-3 text-primary">
                {meta.icon}
              </div>
              <div>
                <h2 className="text-[14px] font-medium text-fg">{meta.label}</h2>
                <p className="text-[11px] text-fg-tertiary">{meta.description}</p>
              </div>
            </header>
            <ul className="divide-y divide-hairline">
              {inGroup.length === 0 ? (
                <li className="px-4 py-6 text-center text-[12px] text-fg-subtle">
                  No {meta.label.toLowerCase()} providers configured.
                </li>
              ) : (
                inGroup.map((p) => <ProviderRow key={p.id} provider={p} kind={kind} />)
              )}
            </ul>
          </section>
        );
      })}
      <p className="text-center text-[11px] text-fg-tertiary">
        Network calls go live when the real backend lands. Configurations
        persist here so the UI shows the right connection state.
      </p>
    </div>
  );
}

function ProviderRow({ provider, kind }: { provider: AppProviderConfig; kind: AppProviderConfig["kind"] }) {
  const [expanded, setExpanded] = React.useState(false);
  const meta = KIND_META[kind];
  const tone =
    provider.status === "connected"
      ? "ok"
      : provider.status === "needs_attention"
      ? "warn"
      : "neutral";
  const icon =
    provider.status === "connected" ? (
      <CheckCircle2 className="size-3" />
    ) : provider.status === "needs_attention" ? (
      <AlertCircle className="size-3" />
    ) : (
      <Link2 className="size-3" />
    );

  return (
    <li>
      <div className="px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-medium text-fg">{provider.display_name}</span>
              <Badge tone={tone} size="sm">
                {icon}
                {provider.status.replace("_", " ")}
              </Badge>
            </div>
            {provider.last_error && (
              <p className="mt-0.5 text-[11px] text-status-warn">{provider.last_error}</p>
            )}
          </div>
          <span className="text-[11px] text-fg-tertiary">
            {expanded ? "Close" : "Configure"}
          </span>
        </button>
        {expanded && <ConfigEditor provider={provider} fields={meta.fields} />}
      </div>
    </li>
  );
}

function ConfigEditor({
  provider,
  fields,
}: {
  provider: AppProviderConfig;
  fields: { key: string; label: string; placeholder?: string; secret?: boolean }[];
}) {
  const [draft, setDraft] = React.useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of fields) {
      const v = provider.config[f.key];
      // Mask secret fields when they're stored as boolean "_set" flags
      if (f.secret) {
        const setKey = `${f.key}_set`;
        init[f.key] = provider.config[setKey] === true ? "••••••••" : "";
      } else {
        init[f.key] = v != null ? String(v) : "";
      }
    }
    return init;
  });
  const [savedFlash, setSavedFlash] = React.useState(false);

  function save() {
    const newConfig: Record<string, string | number | boolean | null> = { ...provider.config };
    for (const f of fields) {
      const v = draft[f.key];
      if (f.secret) {
        // Only update secret if it's been changed away from the mask
        if (v && v !== "••••••••") {
          newConfig[`${f.key}_set`] = true;
        }
      } else {
        newConfig[f.key] = v;
      }
    }
    // Heuristic: if any secret + identifying field is now filled, mark connected
    const hasSecret = fields.some(
      (f) => f.secret && newConfig[`${f.key}_set`] === true
    );
    const hasIdentifier = fields.some(
      (f) => !f.secret && draft[f.key] && draft[f.key].length > 0
    );
    updateProviderConfig(provider.id, {
      config: newConfig,
      status: hasSecret && hasIdentifier ? "connected" : "disconnected",
      connected_at: hasSecret ? new Date().toISOString() : provider.connected_at,
      last_error: undefined,
    });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }

  function disconnect() {
    if (!window.confirm(`Disconnect ${provider.display_name}? Stored credentials will be cleared.`)) return;
    const cleared: Record<string, string | number | boolean | null> = {};
    for (const f of fields) {
      if (f.secret) {
        cleared[`${f.key}_set`] = false;
      } else {
        cleared[f.key] = "";
      }
    }
    updateProviderConfig(provider.id, {
      config: cleared,
      status: "disconnected",
      last_error: undefined,
      connected_at: undefined,
    });
  }

  return (
    <div className="mt-3 space-y-3 rounded-[10px] border border-hairline bg-surface-2 p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
              {f.label}
            </div>
            <input
              type={f.secret ? "password" : "text"}
              value={draft[f.key] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className={cn(
                "w-full rounded-[8px] border border-hairline bg-surface-1 px-3 py-2 text-[13px] text-fg focus:border-hairline-strong focus:outline-none",
                f.secret && "font-mono"
              )}
            />
          </label>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2">
        {provider.status === "connected" && (
          <Button variant="ghost" size="sm" onClick={disconnect}>
            Disconnect
          </Button>
        )}
        <Button variant="primary" size="sm" onClick={save}>
          <Save className="size-3.5" />
          {savedFlash ? "Saved" : "Save"}
        </Button>
      </div>
    </div>
  );
}
