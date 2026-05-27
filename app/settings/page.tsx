import Link from "next/link";
import {
  Building2,
  Users,
  CreditCard,
  Bell,
  Server,
  Tag,
  ChevronRight,
  Mail,
  Package,
  Store,
  Upload,
  Sparkles,
} from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { MarinaIdentityCard } from "@/components/settings/marina-identity-card";

export const metadata = { title: "Settings — Marina Stee" };

/*
 * Settings landing page — primarily a router into focused editors. Each
 * tile is a real configurable page now; the old static cards were
 * replaced with the per-area editors built in the operator-config
 * sweep.
 */
export default function SettingsPage() {
  return (
    <PageShell
      title="Settings"
      description="Configure your marina end-to-end — identity, staff, POS catalog + locations, comm templates, connections, and picklists."
    >
      <RentalsAsk
        placeholder="Ask the agent — e.g. 'add Tiffany as a Manager' or 'connect QuickBooks'"
        suggestions={[
          "Add Tiffany as Manager",
          "Connect QuickBooks",
          "Edit the receipt template",
          "Add a new POS location",
        ]}
      />

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
        <MarinaIdentityCard />

        <SettingsLink
          href="/settings/staff"
          icon={<Users className="size-4" />}
          title="Staff & Roles"
          subtitle="Invite team, assign roles, manage permission matrix"
        />

        <SettingsLink
          href="/settings/pos-locations"
          icon={<Store className="size-4" />}
          title="POS Locations"
          subtitle="Fuel Dock, Ship Store, Restaurant, Harbormaster — register configuration"
        />

        <SettingsLink
          href="/ledger?tab=catalog"
          icon={<Package className="size-4" />}
          title="POS Catalog"
          subtitle="Items, prices, costs, category groupings — edit from Ledger / POS → Catalog"
        />

        <SettingsLink
          href="/settings/comm-templates"
          icon={<Mail className="size-4" />}
          title="Comm Templates"
          subtitle="Receipt, contract, COI reminder, payment failure — system message copy"
        />

        <SettingsLink
          href="/settings/connections"
          icon={<CreditCard className="size-4" />}
          title="Connections"
          subtitle="Stripe · Postmark · Twilio · QuickBooks · MCP"
        />

        <SettingsLink
          href="/settings/customization"
          icon={<Tag className="size-4" />}
          title="Picklists"
          subtitle="Tune dropdown values across the tool"
          tone="primary"
        />

        <SettingsLink
          href="/notifications"
          icon={<Bell className="size-4" />}
          title="Notification rules"
          subtitle="Quiet hours, channel defaults, storm triggers, reminders"
        />

        <SettingsLink
          href="/settings/import"
          icon={<Upload className="size-4" />}
          title="Data Import"
          subtitle="CSV import for slips, boaters, vessels"
        />

        <SettingsLink
          href="/onboarding"
          icon={<Sparkles className="size-4" />}
          title="Re-run setup wizard"
          subtitle="Step through the first-run flow again"
        />

        <SettingsLink
          href="#"
          icon={<Server className="size-4" />}
          title="MCP server (inbound)"
          subtitle="Expose Marina Stee to your desktop client · coming soon"
          disabled
        />
      </div>
    </PageShell>
  );
}

function SettingsLink({
  href,
  icon,
  title,
  subtitle,
  tone,
  disabled,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  tone?: "primary";
  disabled?: boolean;
}) {
  const body = (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div
          className={
            tone === "primary"
              ? "flex size-9 items-center justify-center rounded-[8px] bg-primary text-on-primary"
              : "flex size-9 items-center justify-center rounded-[8px] bg-surface-3 text-primary"
          }
        >
          {icon}
        </div>
        <div>
          <div className="text-[14px] font-medium text-fg">{title}</div>
          <p className="text-[12px] text-fg-subtle">{subtitle}</p>
        </div>
      </div>
      <ChevronRight className="size-4 text-fg-subtle" />
    </div>
  );

  const baseClass =
    tone === "primary"
      ? "rounded-[12px] border border-primary/30 bg-primary-soft/30 px-4 py-3 transition-colors hover:bg-primary-soft/50"
      : "rounded-[12px] border border-hairline bg-surface-1 px-4 py-3 transition-colors hover:border-hairline-strong hover:bg-surface-2";

  if (disabled) {
    return <div className={`${baseClass} opacity-50`}>{body}</div>;
  }
  return (
    <Link href={href} className={baseClass}>
      {body}
    </Link>
  );
}
