import { Anchor, ArrowLeftRight, Droplets, Snowflake, Move3D, PawPrint } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { ADDITIONAL_FEES, formatMoney } from "@/lib/mock-data";
import type { FeeBillingMode } from "@/lib/types";

export const metadata = { title: "Additional Fees — Marina Stee Rentals" };

const FEE_ICONS: Record<string, React.ReactNode> = {
  fee_hoist: <Anchor className="size-4" />,
  fee_transfer: <ArrowLeftRight className="size-4" />,
  fee_pump_out: <Droplets className="size-4" />,
  fee_winterize: <Snowflake className="size-4" />,
  fee_storage_move: <Move3D className="size-4" />,
  fee_pet_fee: <PawPrint className="size-4" />,
};

const BILLING_LABEL: Record<FeeBillingMode, string> = {
  single_billing: "One-time",
  bill_with_rental: "Add to rental invoice",
  recurring_monthly: "Recurring monthly",
  recurring_annual: "Recurring annual",
};

const BILLING_TONE: Record<FeeBillingMode, "ok" | "warn" | "info" | "neutral"> = {
  single_billing: "neutral",
  bill_with_rental: "info",
  recurring_monthly: "warn",
  recurring_annual: "warn",
};

export default function FeesPage() {
  return (
    <div className="space-y-5">
      <RentalsAsk
        placeholder="Apply, create, or analyze a fee — e.g. 'add a hoist fee to David Emmons next invoice'"
        suggestions={[
          "Add hoist fee to David Emmons",
          "Bulk-apply winterization to all annual boaters",
          "Add a new pump-out fee at $30",
        ]}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {ADDITIONAL_FEES.map((f) => (
          <div key={f.id} className="rounded-[12px] border border-hairline bg-surface-1 p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex size-9 items-center justify-center rounded-[8px] bg-surface-3 text-primary">
                {FEE_ICONS[f.id] ?? <Anchor className="size-4" />}
              </div>
              <Badge tone={BILLING_TONE[f.billing_mode]} size="sm">
                {BILLING_LABEL[f.billing_mode]}
              </Badge>
            </div>
            <h3 className="text-[14px] font-medium text-fg">{f.name}</h3>
            {f.description && (
              <p className="mt-1 line-clamp-2 text-[12px] text-fg-subtle">{f.description}</p>
            )}
            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="money-display text-[24px] text-fg">
                  {formatMoney(f.amount)}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
                  {f.accounting_line_item}
                </div>
              </div>
              <Button variant="secondary" size="sm">Apply</Button>
            </div>
          </div>
        ))}

        {/* "Create new" tile */}
        <button
          type="button"
          className="flex min-h-[180px] flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-hairline-strong bg-surface-1 p-4 text-fg-subtle transition-colors hover:border-primary/50 hover:text-fg"
        >
          <span className="text-[20px] font-semibold">+</span>
          <span className="text-[13px]">New additional fee</span>
          <span className="text-[11px] text-fg-tertiary">Or ask the agent to draft one</span>
        </button>
      </div>
    </div>
  );
}
