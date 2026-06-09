"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Boxes,
  Briefcase,
  Building2,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Coins,
  HardHat,
  Inbox,
  Mail,
  Mic,
  Sparkles,
  UserPlus,
  Wallet,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  markOnboardingStepComplete,
  updateAiSettings,
  useAiSettings,
  useStore,
} from "@/lib/client-store";
import type { OnboardingStepKey } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * /onboarding — AI activation checklist.
 *
 * The same checklist every marina sees. Each step flips one or more
 * TenantAiSettings flags so the corresponding module's AI features
 * light up across the app. Nothing is bespoke per tenant — onboarding
 * is the configuration surface.
 *
 * Step status is derived from settings + store state so the checklist
 * reflects real progress. Operators can drop in and out — what's done
 * stays done.
 */

type StepDef = {
  key: OnboardingStepKey;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  /** When this step is considered complete (read-only signal). */
  isComplete: (deps: Deps) => boolean;
  /** Optional render: a toggle + action area when the step is open. */
  control: (deps: Deps) => React.ReactNode;
  /** Whether this step is the productized "next step" priority. */
  group: "core" | "ai" | "integrations";
};

type Deps = {
  ai: ReturnType<typeof useAiSettings>;
  store: ReturnType<typeof useStore>;
};

const STEPS: StepDef[] = [
  {
    key: "marina_profile",
    title: "Marina profile",
    description: "Name, address, business hours, default tax. Powers every customer touchpoint.",
    icon: Building2,
    group: "core",
    isComplete: ({ store }) =>
      Boolean(
        store.marinaProfile?.display_name && store.marinaProfile?.address_line1
      ),
    control: () => (
      <Link
        href="/settings/profile"
        className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
      >
        Open marina profile →
      </Link>
    ),
  },
  {
    key: "chart_of_accounts",
    title: "Expense categories",
    description:
      "Default categories so vendor bills get classified correctly. Picklists ship pre-seeded — confirm or customize them.",
    icon: ClipboardList,
    group: "core",
    isComplete: ({ store }) =>
      // Use existence of any picklist as the seed completeness proxy.
      // Real backend will track per-tenant chart-of-accounts setup.
      (store.picklists ?? []).length > 0,
    control: () => (
      <Link
        href="/settings/picklists"
        className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
      >
        Review GL accounts →
      </Link>
    ),
  },
  {
    key: "vendor_seed",
    title: "Vendor seed",
    description:
      "Initial vendor list. New vendors get auto-created from incoming invoices once the AP Inbox is on — this is just the starter set.",
    icon: Briefcase,
    group: "core",
    isComplete: ({ store }) => (store.vendors ?? []).length > 0,
    control: () => (
      <Link
        href="/vendors?section=vendors"
        className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
      >
        Open vendors →
      </Link>
    ),
  },
  {
    key: "staff_seed",
    title: "Staff seed",
    description:
      "Add at least one staff member so timecards + payroll have a home. Future hires can come in via Onboarding doc-pack drop.",
    icon: UserPlus,
    group: "core",
    isComplete: ({ store }) => (store.staff ?? []).length > 0,
    control: () => (
      <Link
        href="/staff?section=roster"
        className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
      >
        Open roster →
      </Link>
    ),
  },
  {
    key: "bills_inbox",
    title: "Enable AP Inbox",
    description:
      "Vendors email or drop invoices → we extract them into draft bills. We set up the forwarding address for you.",
    icon: Inbox,
    group: "ai",
    isComplete: ({ ai }) => ai.bills_inbox_enabled,
    control: ({ ai }) => (
      <BoolToggle
        on={ai.bills_inbox_enabled}
        label={ai.bills_inbox_enabled ? "Enabled" : "Enable"}
        onToggle={() => {
          const enabling = !ai.bills_inbox_enabled;
          updateAiSettings({
            bills_inbox_enabled: enabling,
            // Auto-provision a forwarding address when enabling
            bills_email_address: enabling
              ? `bills+marina-${ai.tenant_id.slice(-6)}@marinastee.app`
              : undefined,
            // Enable vendor auto-create as part of the flow — they pair.
            vendors_auto_create_from_invoice: enabling,
          });
          if (enabling) markOnboardingStepComplete("bills_inbox");
        }}
        secondary={
          ai.bills_email_address && (
            <div className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-fg-subtle">
              <Mail className="size-3" /> {ai.bills_email_address}
            </div>
          )
        }
      />
    ),
  },
  {
    key: "auto_approve_threshold",
    title: "Auto-approve threshold",
    description:
      "Bills under this amount from familiar vendors post automatically. Audit trail still visible. Recommended: $500.",
    icon: Zap,
    group: "ai",
    isComplete: ({ ai }) => ai.bills_auto_approve_enabled,
    control: ({ ai }) => (
      <div className="space-y-2">
        <BoolToggle
          on={ai.bills_auto_approve_enabled}
          label={ai.bills_auto_approve_enabled ? "Enabled" : "Enable auto-approve"}
          onToggle={() => {
            const enabling = !ai.bills_auto_approve_enabled;
            updateAiSettings({ bills_auto_approve_enabled: enabling });
            if (enabling) markOnboardingStepComplete("auto_approve_threshold");
          }}
        />
        {ai.bills_auto_approve_enabled && (
          <ThresholdInput
            valueCents={ai.bills_auto_approve_threshold_cents}
            onChange={(cents) =>
              updateAiSettings({ bills_auto_approve_threshold_cents: cents })
            }
            requiresFamiliar={ai.bills_auto_approve_requires_familiar_vendor}
            onToggleFamiliar={(next) =>
              updateAiSettings({
                bills_auto_approve_requires_familiar_vendor: next,
              })
            }
          />
        )}
      </div>
    ),
  },
  {
    key: "velocity_reorder",
    title: "Inventory velocity reorder",
    description:
      "Watch sales velocity and draft purchase orders at the right time. Operator just confirms.",
    icon: Boxes,
    group: "ai",
    isComplete: ({ ai }) => ai.inventory_velocity_reorder_enabled,
    control: ({ ai }) => (
      <BoolToggle
        on={ai.inventory_velocity_reorder_enabled}
        label={ai.inventory_velocity_reorder_enabled ? "Enabled" : "Enable"}
        onToggle={() => {
          const enabling = !ai.inventory_velocity_reorder_enabled;
          updateAiSettings({ inventory_velocity_reorder_enabled: enabling });
          if (enabling) markOnboardingStepComplete("velocity_reorder");
        }}
      />
    ),
  },
  {
    key: "voice_input",
    title: "/dock voice input",
    description:
      "Staff log work orders + completion notes by speaking from the PWA. No typing on the dock.",
    icon: Mic,
    group: "ai",
    isComplete: ({ ai }) => ai.dock_voice_input_enabled,
    control: ({ ai }) => (
      <BoolToggle
        on={ai.dock_voice_input_enabled}
        label={ai.dock_voice_input_enabled ? "Enabled" : "Enable"}
        onToggle={() => {
          const enabling = !ai.dock_voice_input_enabled;
          updateAiSettings({ dock_voice_input_enabled: enabling });
          if (enabling) markOnboardingStepComplete("voice_input");
        }}
      />
    ),
  },
  {
    key: "quickbooks_link",
    title: "Connect QuickBooks",
    description:
      "Bills + payroll + paid invoices flow to QB nightly. Run the sync from Settings → Connections.",
    icon: Wallet,
    group: "integrations",
    isComplete: ({ store }) =>
      (store.providerConfigs ?? []).some(
        (p) => p.provider === "quickbooks" && p.status === "connected"
      ),
    control: () => (
      <Link
        href="/settings/connections"
        className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
      >
        Open Connections →
      </Link>
    ),
  },
  {
    key: "first_drop",
    title: "First doc-drop",
    description:
      "Drop your first invoice on the AP Inbox to see the extraction → draft → approve flow end to end.",
    icon: Sparkles,
    group: "ai",
    isComplete: ({ ai }) =>
      ai.onboarding_completed_steps.includes("first_drop"),
    control: () => (
      <Link
        href="/vendors?section=inbox"
        className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
      >
        Try the AP Inbox →
      </Link>
    ),
  },
];

export function AiChecklist() {
  const ai = useAiSettings();
  const store = useStore();
  const deps: Deps = { ai, store };

  const completed = STEPS.filter((s) => s.isComplete(deps)).length;
  const pct = Math.round((completed / STEPS.length) * 100);

  const groups: { key: "core" | "ai" | "integrations"; label: string }[] = [
    { key: "core", label: "Core setup" },
    { key: "ai", label: "AI activation" },
    { key: "integrations", label: "Integrations" },
  ];

  return (
    <div className="mx-auto w-full max-w-[920px] px-6 pb-24 pt-10">
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold text-fg">Set up Marina Stee</h1>
        <p className="mt-1 text-[13px] text-fg-subtle">
          One checklist. The same for every marina. Each step turns on a
          piece of the AI-first workflow — no custom setup required.
        </p>

        <div className="mt-4 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-[12px] tabular-nums text-fg-subtle">
            {completed} / {STEPS.length} done · {pct}%
          </div>
        </div>
      </div>

      {groups.map((g) => {
        const groupSteps = STEPS.filter((s) => s.group === g.key);
        return (
          <section key={g.key} className="mb-8">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
              {g.label}
            </div>
            <div className="space-y-2">
              {groupSteps.map((step) => (
                <StepCard key={step.key} step={step} deps={deps} />
              ))}
            </div>
          </section>
        );
      })}

      {completed === STEPS.length && (
        <div className="rounded-[12px] border border-status-ok/30 bg-status-ok/[0.05] p-4 text-center">
          <CheckCircle2 className="mx-auto size-5 text-status-ok" />
          <div className="mt-2 text-[14px] font-semibold text-fg">
            You&apos;re fully onboarded
          </div>
          <p className="mt-0.5 text-[12px] text-fg-subtle">
            Every AI surface is live. The dashboard is your home base from
            here.
          </p>
          <Link
            href="/"
            className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
          >
            Go to dashboard <ArrowRight className="size-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

function StepCard({ step, deps }: { step: StepDef; deps: Deps }) {
  const done = step.isComplete(deps);
  const Icon = step.icon;
  const [open, setOpen] = React.useState(!done);
  React.useEffect(() => {
    setOpen(!done);
  }, [done]);

  return (
    <div
      className={cn(
        "rounded-[12px] border bg-surface-1 transition-colors",
        done ? "border-hairline" : "border-hairline-strong"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <div
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ring-1",
            done
              ? "bg-status-ok/10 text-status-ok ring-status-ok/30"
              : "bg-surface-2 text-fg-subtle ring-hairline"
          )}
        >
          {done ? <CheckCircle2 className="size-4" /> : <Icon className="size-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-fg">{step.title}</span>
            {done && (
              <Badge tone="ok" size="sm">
                Done
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-[12px] text-fg-subtle">{step.description}</p>
        </div>
        <CircleDot
          className={cn(
            "size-4 shrink-0 text-fg-tertiary transition-transform",
            open && "rotate-90"
          )}
        />
      </button>

      {open && (
        <div className="border-t border-hairline px-4 py-3">{step.control(deps)}</div>
      )}
    </div>
  );
}

function BoolToggle({
  on,
  label,
  onToggle,
  secondary,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
  secondary?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors",
          on
            ? "bg-status-ok/15 text-status-ok hover:bg-status-ok/25"
            : "bg-primary text-on-primary hover:bg-primary-hover"
        )}
      >
        {on ? <CheckCircle2 className="size-3.5" /> : <Zap className="size-3.5" />}
        {label}
      </button>
      {secondary}
    </div>
  );
}

function ThresholdInput({
  valueCents,
  onChange,
  requiresFamiliar,
  onToggleFamiliar,
}: {
  valueCents: number;
  onChange: (cents: number) => void;
  requiresFamiliar: boolean;
  onToggleFamiliar: (next: boolean) => void;
}) {
  const [dollars, setDollars] = React.useState(String(valueCents / 100));
  React.useEffect(() => {
    setDollars(String(valueCents / 100));
  }, [valueCents]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-fg-subtle">
          Threshold ($)
          <input
            value={dollars}
            inputMode="decimal"
            onChange={(e) => setDollars(e.target.value)}
            onBlur={() => {
              const n = Number(dollars);
              if (!Number.isFinite(n) || n < 0) return;
              onChange(Math.round(n * 100));
            }}
            className="ml-2 inline-block w-24 rounded-[6px] border border-hairline bg-surface-2 px-2 py-1 text-[12px] tabular-nums text-fg focus:border-primary focus:outline-none"
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-fg-subtle">
        <input
          type="checkbox"
          checked={requiresFamiliar}
          onChange={(e) => onToggleFamiliar(e.target.checked)}
        />
        Only auto-approve when vendor matches a record I already have
      </label>
      <div className="inline-flex items-center gap-1 text-[10px] text-fg-tertiary">
        <AlertCircle className="size-3" />
        Auto-approved bills still show up in the inbox marked &quot;Auto&quot; for audit.
      </div>
    </div>
  );
}
