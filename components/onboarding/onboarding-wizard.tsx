"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Anchor,
  ArrowRight,
  Building2,
  CheckCircle2,
  CreditCard,
  Mail,
  Package,
  Sparkles,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  updateMarinaProfile,
  upsertSlip,
  upsertStaffMember,
  useMarinaProfile,
  usePosCatalog,
  usePosLocations,
  useProviderConfigs,
  useRoles,
  useSlips,
  useStaff,
} from "@/lib/client-store";
import type { Slip, SlipClass } from "@/lib/types";
import { cn } from "@/lib/utils";

/*
 * First-run setup wizard. 6 steps:
 *   1. Marina identity (name, address, hours, tax)
 *   2. Slips inventory (count + classes; bulk-create or skip)
 *   3. POS catalog confirm (uses seeded items; operator skips or edits later)
 *   4. Connections (Stripe + Postmark + Twilio + QB stubs)
 *   5. Invite staff (skip OK)
 *   6. Launch
 *
 * Each step lives in this single file as a small component. Progress
 * derived from store state — operator can leave and come back, the
 * step list reflects what's done. No sessionStorage needed because
 * the store is the source of truth.
 */

type StepKey = "identity" | "slips" | "catalog" | "connections" | "staff" | "launch";
const STEPS: { key: StepKey; label: string; icon: React.ReactNode }[] = [
  { key: "identity", label: "Marina identity", icon: <Building2 className="size-4" /> },
  { key: "slips", label: "Slips inventory", icon: <Anchor className="size-4" /> },
  { key: "catalog", label: "POS catalog", icon: <Package className="size-4" /> },
  { key: "connections", label: "Connections", icon: <CreditCard className="size-4" /> },
  { key: "staff", label: "Invite staff", icon: <Users className="size-4" /> },
  { key: "launch", label: "Launch", icon: <Sparkles className="size-4" /> },
];

export function OnboardingWizard() {
  const [active, setActive] = React.useState<StepKey>("identity");
  const profile = useMarinaProfile();
  const slips = useSlips();
  const catalog = usePosCatalog();
  const providers = useProviderConfigs();
  const staff = useStaff();

  // Derived completion flags
  const identityDone =
    profile.display_name.length > 0 &&
    profile.email.length > 0 &&
    profile.city.length > 0;
  const slipsDone = slips.length > 0;
  const catalogDone = catalog.length > 0;
  const connectionsDone = providers.some((p) => p.status === "connected");
  const staffDone = staff.length > 1; // owner counts as 1

  const completion: Record<StepKey, boolean> = {
    identity: identityDone,
    slips: slipsDone,
    catalog: catalogDone,
    connections: connectionsDone,
    staff: staffDone,
    launch: false,
  };
  const completedCount = Object.values(completion).filter(Boolean).length;
  const totalSteps = STEPS.length - 1; // exclude launch from progress denominator

  return (
    <div className="min-h-screen bg-surface-app">
      <header className="border-b border-hairline bg-surface-1 px-6 py-4">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-[8px] bg-primary text-on-primary">
              <Sparkles className="size-4" />
            </div>
            <div>
              <h1 className="display-tight text-[18px] font-semibold text-fg">
                Set up your marina
              </h1>
              <p className="text-[12px] text-fg-subtle">
                {completedCount}/{totalSteps} sections complete
              </p>
            </div>
          </div>
          <Link
            href="/"
            className="text-[12px] text-fg-subtle hover:text-fg"
          >
            Skip for now →
          </Link>
        </div>
        <div className="mx-auto mt-3 max-w-[1200px]">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(completedCount / totalSteps) * 100}%` }}
            />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1200px] gap-6 px-6 py-6 md:grid-cols-[240px_1fr]">
        {/* Step nav */}
        <aside>
          <ul className="space-y-1">
            {STEPS.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => setActive(s.key)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-left text-[13px] transition-colors",
                    active === s.key
                      ? "bg-primary-soft/50 text-fg"
                      : "text-fg-subtle hover:bg-surface-2"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full",
                      completion[s.key]
                        ? "bg-status-ok text-on-primary"
                        : active === s.key
                        ? "bg-primary text-on-primary"
                        : "bg-surface-2 text-fg-tertiary"
                    )}
                  >
                    {completion[s.key] ? (
                      <CheckCircle2 className="size-3" />
                    ) : (
                      <span className="text-[10px]">{STEPS.indexOf(s) + 1}</span>
                    )}
                  </span>
                  <span className="flex-1">{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Step body */}
        <main className="rounded-[12px] border border-hairline bg-surface-1">
          {active === "identity" && <IdentityStep onNext={() => setActive("slips")} />}
          {active === "slips" && <SlipsStep onNext={() => setActive("catalog")} />}
          {active === "catalog" && <CatalogStep onNext={() => setActive("connections")} />}
          {active === "connections" && <ConnectionsStep onNext={() => setActive("staff")} />}
          {active === "staff" && <StaffStep onNext={() => setActive("launch")} />}
          {active === "launch" && <LaunchStep />}
        </main>
      </div>
    </div>
  );
}

// ── Step 1: Identity ─────────────────────────────────────────────
function IdentityStep({ onNext }: { onNext: () => void }) {
  const profile = useMarinaProfile();
  const [name, setName] = React.useState(profile.short_name);
  const [email, setEmail] = React.useState(profile.email);
  const [phone, setPhone] = React.useState(profile.phone);
  const [city, setCity] = React.useState(profile.city);
  const [state, setState] = React.useState(profile.state);
  const [tax, setTax] = React.useState(
    (profile.default_tax_rate * 100).toFixed(2).replace(/\.00$/, "")
  );

  function save() {
    updateMarinaProfile({
      short_name: name,
      display_name: name,
      email,
      phone,
      city,
      state,
      default_tax_rate: Number(tax) / 100 || 0,
    });
    onNext();
  }

  return (
    <StepShell
      title="Tell us about your marina"
      description="The basics — name, where you are, how to reach you. You can fill in the full profile (logo, hours, sender labels) later in Settings."
      onNext={save}
      canContinue={name.length > 0 && email.length > 0 && city.length > 0}
    >
      <FieldGrid>
        <WizField label="Marina name" required>
          <WizInput value={name} onChange={setName} placeholder="Marina Stee" />
        </WizField>
        <WizField label="Contact email" required>
          <WizInput value={email} onChange={setEmail} placeholder="harbormaster@…" />
        </WizField>
        <WizField label="Phone">
          <WizInput value={phone} onChange={setPhone} placeholder="(555) 555-0100" />
        </WizField>
        <WizField label="Default tax rate (%)">
          <WizInput value={tax} onChange={setTax} placeholder="8.25" />
        </WizField>
        <WizField label="City" required>
          <WizInput value={city} onChange={setCity} placeholder="Santa Fe" />
        </WizField>
        <WizField label="State">
          <WizInput value={state} onChange={setState} placeholder="NM" />
        </WizField>
      </FieldGrid>
      <p className="text-[11px] text-fg-tertiary">
        You can edit anything later from{" "}
        <Link href="/settings/marina-profile" className="text-primary hover:underline">
          Settings → Marina Profile
        </Link>
        .
      </p>
    </StepShell>
  );
}

// ── Step 2: Slips ────────────────────────────────────────────────
function SlipsStep({ onNext }: { onNext: () => void }) {
  const slips = useSlips();
  const [dockName, setDockName] = React.useState("A Dock");
  const [count, setCount] = React.useState("20");
  const [klass, setKlass] = React.useState<SlipClass>("uncovered");
  const [rate, setRate] = React.useState("3500");

  function bulkCreate() {
    const n = Math.max(0, Math.min(500, Number(count) || 0));
    const r = Number(rate) || 0;
    const dockPrefix = dockName.replace(/\s+/g, "").slice(0, 3).toUpperCase();
    // Derive a stable dock_id from the dock name so all bulk-created
    // slips for this dock share it. Real Settings → Docks records get a
    // proper id; this wizard path creates a runtime one if the dock is
    // new.
    const dockId = `dock_wiz_${dockPrefix.toLowerCase()}`;
    for (let i = 1; i <= n; i++) {
      const id = `${dockPrefix}-${String(i).padStart(2, "0")}`;
      const slip: Slip = {
        id,
        dock_id: dockId,
        dock: dockName,
        invoice_category: "Marina Slip Fees",
        number: String(i),
        max_loa_inches: 360,
        max_beam_inches: 144,
        has_power: true,
        has_water: true,
        slip_class: klass,
        default_annual_rate: r,
      };
      upsertSlip(slip);
    }
  }

  return (
    <StepShell
      title="Add your slips"
      description="Bulk-create slips for one dock at a time. You can fine-tune dimensions, power/water, and rates per-slip later from the Slips → Roster page."
      onNext={onNext}
      canContinue={slips.length > 0}
      nextLabel={slips.length > 0 ? "Continue" : "Skip — I'll import via CSV later"}
    >
      <div className="rounded-[10px] border border-hairline bg-surface-2 p-4">
        <h3 className="mb-3 text-[13px] font-medium text-fg">Bulk-create one dock</h3>
        <FieldGrid>
          <WizField label="Dock name">
            <WizInput value={dockName} onChange={setDockName} placeholder="A Dock" />
          </WizField>
          <WizField label="Number of slips">
            <WizInput value={count} onChange={setCount} placeholder="20" />
          </WizField>
          <WizField label="Slip class">
            <select
              value={klass}
              onChange={(e) => setKlass(e.target.value as SlipClass)}
              className="w-full rounded-[8px] border border-hairline bg-surface-1 px-3 py-2 text-[13px] text-fg focus:border-hairline-strong focus:outline-none"
            >
              <option value="uncovered">Uncovered</option>
              <option value="covered">Covered</option>
              <option value="t_head">T-head</option>
              <option value="buoy">Buoy</option>
              <option value="dry_storage">Dry storage</option>
            </select>
          </WizField>
          <WizField label="Default annual rate ($)">
            <WizInput value={rate} onChange={setRate} placeholder="3500" />
          </WizField>
        </FieldGrid>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-[11px] text-fg-tertiary">
            Currently in inventory: <strong>{slips.length}</strong>{" "}
            {slips.length === 1 ? "slip" : "slips"}.
          </p>
          <Button variant="primary" size="sm" onClick={bulkCreate}>
            Create {count || "0"} slips
          </Button>
        </div>
      </div>
      <div className="rounded-[10px] border border-dashed border-hairline-strong bg-surface-2 p-4 text-center">
        <Upload className="mx-auto size-5 text-fg-tertiary" />
        <p className="mt-2 text-[12px] text-fg-subtle">
          Have an existing slip list? CSV import coming next — for now bulk-
          create above or skip and add slips one-at-a-time from Roster.
        </p>
      </div>
    </StepShell>
  );
}

// ── Step 3: Catalog confirm ──────────────────────────────────────
function CatalogStep({ onNext }: { onNext: () => void }) {
  const catalog = usePosCatalog();
  const locations = usePosLocations();
  return (
    <StepShell
      title="POS catalog is ready"
      description="We've seeded a default catalog with common marina SKUs (fuel, dock lines, restaurant items, service fees). Edit prices, add items, or remove what doesn't apply — Settings → POS Catalog or the Ledger → Catalog tab."
      onNext={onNext}
      canContinue={true}
      nextLabel="Looks good — continue"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {locations.map((loc) => {
          const count = catalog.filter((c) => c.location_keys.includes(loc.key)).length;
          return (
            <div
              key={loc.id}
              className="rounded-[10px] border border-hairline bg-surface-2 px-4 py-3"
            >
              <div className="text-[13px] font-medium text-fg">{loc.name}</div>
              <div className="text-[11px] text-fg-tertiary">
                {count} {count === 1 ? "item" : "items"} ·{" "}
                {(loc.default_tax_rate * 100).toFixed(2).replace(/\.00$/, "")}% tax
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-center gap-3">
        <Link
          href="/ledger?tab=catalog"
          className="inline-flex items-center gap-1 rounded-[8px] border border-hairline bg-surface-1 px-3 py-1.5 text-[12px] text-fg-muted hover:bg-surface-2"
        >
          Open POS Catalog editor →
        </Link>
        <Link
          href="/settings/pos-locations"
          className="inline-flex items-center gap-1 rounded-[8px] border border-hairline bg-surface-1 px-3 py-1.5 text-[12px] text-fg-muted hover:bg-surface-2"
        >
          Edit POS Locations →
        </Link>
      </div>
    </StepShell>
  );
}

// ── Step 4: Connections ──────────────────────────────────────────
function ConnectionsStep({ onNext }: { onNext: () => void }) {
  const providers = useProviderConfigs();
  const connected = providers.filter((p) => p.status === "connected");
  return (
    <StepShell
      title="Connect your providers"
      description="Hook up Stripe (or Square) to take card payments, Postmark + Twilio for outbound comms, and QuickBooks for accounting. You can connect them later — this step is optional."
      onNext={onNext}
      canContinue={true}
      nextLabel={connected.length > 0 ? "Continue" : "Skip for now"}
    >
      <ul className="space-y-2">
        {providers.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between rounded-[10px] border border-hairline bg-surface-2 px-4 py-3"
          >
            <div>
              <div className="text-[13px] font-medium text-fg">{p.display_name}</div>
              <div className="text-[11px] text-fg-tertiary capitalize">
                {p.kind}
                {p.last_error ? ` · ${p.last_error}` : ""}
              </div>
            </div>
            <Badge
              tone={
                p.status === "connected"
                  ? "ok"
                  : p.status === "needs_attention"
                  ? "warn"
                  : "neutral"
              }
              size="sm"
            >
              {p.status.replace("_", " ")}
            </Badge>
          </li>
        ))}
      </ul>
      <div className="text-center">
        <Link
          href="/settings/connections"
          className="inline-flex items-center gap-1 rounded-[8px] border border-hairline bg-surface-1 px-3 py-1.5 text-[12px] text-fg-muted hover:bg-surface-2"
        >
          Open Connections editor →
        </Link>
      </div>
    </StepShell>
  );
}

// ── Step 5: Staff ────────────────────────────────────────────────
function StaffStep({ onNext }: { onNext: () => void }) {
  const staff = useStaff();
  const roles = useRoles();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [roleId, setRoleId] = React.useState(roles[0]?.id ?? "");

  function invite() {
    if (!name.trim() || !email.trim()) return;
    upsertStaffMember({
      id: `staff_runtime_${Date.now()}`,
      tenant_id: staff[0]?.tenant_id ?? "",
      name: name.trim(),
      email: email.trim(),
      role_id: roleId,
      status: "invited",
      mfa_enabled: false,
      created_at: new Date().toISOString(),
    });
    setName("");
    setEmail("");
  }

  return (
    <StepShell
      title="Invite your team"
      description="Anyone who needs to log in. You can add more later from Settings → Staff. Each invite gets an email with a setup link."
      onNext={onNext}
      canContinue={true}
      nextLabel={staff.length > 1 ? "Continue" : "Skip — I'm flying solo"}
    >
      <div className="rounded-[10px] border border-hairline bg-surface-2 p-4">
        <h3 className="mb-3 text-[13px] font-medium text-fg">Invite a teammate</h3>
        <FieldGrid>
          <WizField label="Name">
            <WizInput value={name} onChange={setName} placeholder="Tiffany Smith" />
          </WizField>
          <WizField label="Email">
            <WizInput value={email} onChange={setEmail} placeholder="tiffany@…" />
          </WizField>
          <WizField label="Role">
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="w-full rounded-[8px] border border-hairline bg-surface-1 px-3 py-2 text-[13px] text-fg focus:border-hairline-strong focus:outline-none"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </WizField>
        </FieldGrid>
        <div className="mt-3 flex items-center justify-end">
          <Button variant="primary" size="sm" onClick={invite} disabled={!name || !email}>
            <UserPlus className="size-3.5" />
            Send invite
          </Button>
        </div>
      </div>
      {staff.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
            Current team
          </div>
          <ul className="space-y-1.5">
            {staff.map((s) => {
              const role = roles.find((r) => r.id === s.role_id);
              return (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-[8px] border border-hairline bg-surface-2 px-3 py-2 text-[12px]"
                >
                  <span>
                    <span className="font-medium text-fg">{s.name}</span>
                    <span className="ml-2 text-fg-tertiary">
                      {role?.name} · {s.status}
                    </span>
                  </span>
                  <Mail className="size-3 text-fg-tertiary" />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </StepShell>
  );
}

// ── Step 6: Launch ───────────────────────────────────────────────
function LaunchStep() {
  const router = useRouter();
  const profile = useMarinaProfile();
  return (
    <StepShell
      title="You're ready to go"
      description={`Welcome to your new marina dashboard, ${profile.short_name}. From here you can run reservations, slip leases, work orders, POS — and ask the agent to do most of it.`}
      onNext={() => router.push("/")}
      canContinue={true}
      nextLabel="Launch dashboard"
    >
      <div className="rounded-[10px] border border-primary/30 bg-primary-soft/30 p-4 text-[13px] text-fg-muted">
        <p>
          A few things you can try first:
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-[12px]">
          <li>Open the Dashboard → ask the agent &ldquo;Show me everyone expiring in the next 60 days&rdquo;</li>
          <li>Slips → Roster → click any slip to edit class + rate</li>
          <li>Ledger / POS → Catalog → add or edit an item</li>
          <li>/dock → the mobile surface for your dockhands</li>
        </ul>
      </div>
    </StepShell>
  );
}

// ── Shared step shell ────────────────────────────────────────────
function StepShell({
  title,
  description,
  children,
  onNext,
  canContinue,
  nextLabel = "Continue",
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onNext: () => void;
  canContinue: boolean;
  nextLabel?: string;
}) {
  return (
    <div className="p-6">
      <h2 className="display-tight text-[20px] font-semibold text-fg">{title}</h2>
      <p className="mt-1 text-[13px] text-fg-subtle">{description}</p>
      <div className="mt-5 space-y-4">{children}</div>
      <div className="mt-6 flex items-center justify-end">
        <Button variant="primary" size="md" onClick={onNext} disabled={!canContinue}>
          {nextLabel}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>;
}

function WizField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
        {required && <span className="ml-1 text-status-danger">*</span>}
      </div>
      {children}
    </label>
  );
}

function WizInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-[8px] border border-hairline bg-surface-1 px-3 py-2 text-[13px] text-fg focus:border-hairline-strong focus:outline-none"
    />
  );
}
