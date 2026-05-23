import {
  Building2,
  Users,
  CreditCard,
  Plug,
  Bell,
  Server,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { USERS } from "@/lib/mock-data";

export const metadata = { title: "Settings — Marina Stee" };

export default function SettingsPage() {
  return (
    <PageShell
      title="Settings"
      description="Marina identity, staff, payment processors, MCP connections, and notification rules."
    >
      <RentalsAsk
        placeholder="Ask the agent — e.g. 'add Tiffany as a Manager' or 'connect QuickBooks'"
        suggestions={[
          "Add Tiffany as Manager",
          "Connect QuickBooks",
          "Enable Marina Stee MCP server",
          "Mute SMS reminders before 8am",
        ]}
      />

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SettingsCard
          icon={<Building2 className="size-4" />}
          title="Marina identity"
          subtitle="Name, branding, tax + accounting defaults"
        >
          <FieldRow label="Marina name" value="Marina Stee" />
          <FieldRow label="Time zone" value="America/Denver" />
          <FieldRow label="Tax rate (default)" value="8.25%" />
          <FieldRow label="Accounting close" value="Monthly · last day of month" />
        </SettingsCard>

        <SettingsCard
          icon={<Users className="size-4" />}
          title="Staff &amp; roles"
          subtitle={`${USERS.filter((u) => u.role !== "system").length} active users`}
          action={<Button variant="secondary" size="sm">Invite</Button>}
        >
          <ul className="divide-y divide-hairline">
            {USERS.filter((u) => u.role !== "system").map((u) => (
              <li key={u.id} className="flex items-center justify-between py-2 text-[13px]">
                <div>
                  <div className="text-fg">{u.name}</div>
                  <div className="text-[11px] text-fg-tertiary capitalize">{u.role}</div>
                </div>
                <Badge tone="ok" size="sm">Active</Badge>
              </li>
            ))}
          </ul>
        </SettingsCard>

        <SettingsCard
          icon={<CreditCard className="size-4" />}
          title="Payment processors"
          subtitle="Card + ACH routing"
        >
          <IntegrationRow
            name="Stripe"
            status="connected"
            detail="acct_1OqXyz · default for card payments"
          />
          <IntegrationRow
            name="Plaid"
            status="disconnected"
            detail="ACH not configured"
          />
          <IntegrationRow
            name="QuickBooks Online"
            status="needs_attention"
            detail="Re-authorize — token expires in 3 days"
          />
        </SettingsCard>

        <SettingsCard
          icon={<Plug className="size-4" />}
          title="MCP connections (outbound)"
          subtitle="What Marina Stee can talk to"
        >
          <IntegrationRow name="QuickBooks MCP" status="connected" detail="Used for invoice export + GL sync" />
          <IntegrationRow name="Twilio MCP" status="connected" detail="SMS for boater comms + storm alerts" />
          <IntegrationRow name="OpenWeather MCP" status="connected" detail="Storm-trigger workflows" />
          <IntegrationRow name="Square MCP" status="disconnected" detail="Optional alternate POS processor" />
        </SettingsCard>

        <SettingsCard
          icon={<Server className="size-4" />}
          title="MCP server (inbound)"
          subtitle="Expose Marina Stee to your desktop client"
          action={<Button variant="secondary" size="sm">Generate token</Button>}
        >
          <FieldRow label="Local URL" value="mcp://marina-stee.local:9930" mono />
          <FieldRow label="Allowed tools" value="query_boater, list_slips, send_message" />
          <FieldRow label="Token rotation" value="Every 30 days" />
          <p className="mt-2 text-[11px] text-fg-tertiary">
            Owners can talk to their marina data from Claude Desktop or any MCP-aware client.
          </p>
        </SettingsCard>

        <SettingsCard
          icon={<Bell className="size-4" />}
          title="Notification rules"
          subtitle="Quiet hours + channel defaults"
        >
          <FieldRow label="Default channel" value="SMS for boaters · Email for staff" />
          <FieldRow label="Quiet hours" value="8pm — 8am local" />
          <FieldRow label="Storm trigger" value="≥ 25 mph sustained · auto-text" />
          <FieldRow label="Payment reminders" value="3 / 7 / 14 days past due" />
        </SettingsCard>
      </div>

      <p className="mt-6 text-center text-[11px] text-fg-tertiary">
        Most settings can also be changed by asking the agent — &ldquo;mute SMS reminders before 8am.&rdquo;
      </p>
    </PageShell>
  );
}

function SettingsCard({
  icon,
  title,
  subtitle,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
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
            {subtitle && <p className="text-[11px] text-fg-tertiary">{subtitle}</p>}
          </div>
        </div>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function FieldRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[13px]">
      <span className="text-fg-tertiary">{label}</span>
      <span className={"text-fg " + (mono ? "font-mono text-[12px]" : "")}>{value}</span>
    </div>
  );
}

function IntegrationRow({
  name,
  status,
  detail,
}: {
  name: string;
  status: "connected" | "disconnected" | "needs_attention";
  detail: string;
}) {
  const tone =
    status === "connected" ? "ok"
    : status === "needs_attention" ? "warn"
    : "neutral";
  const icon =
    status === "connected" ? <CheckCircle2 className="size-3" />
    : status === "needs_attention" ? <AlertCircle className="size-3" />
    : null;
  return (
    <div className="flex items-center justify-between border-b border-hairline py-2 last:border-b-0 text-[13px]">
      <div className="min-w-0">
        <div className="text-fg">{name}</div>
        <div className="truncate text-[11px] text-fg-tertiary">{detail}</div>
      </div>
      <Badge tone={tone} size="sm">
        {icon}
        {status.replace("_", " ")}
      </Badge>
    </div>
  );
}
