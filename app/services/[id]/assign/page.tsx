import { notFound } from "next/navigation";
import { SLIPS, RENTAL_SPACES } from "@/lib/mock-data";
import { AssignSlipClient } from "./assign-slip-client";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return { title: `Assign slip ${id} — Marina Stee` };
}

/*
 * Slip-assignment wizard route. Triggered by clicking a vacant slip in
 * the Roster. Replaces the old single-form NewContractSheet for the
 * slip-assignment flow with a guided multi-step experience modeled on
 * HomeField Raise's campaign-creation wizard.
 *
 * Steps:
 *   1. Holder       — pick existing or create new
 *   2. Rate         — pick from Rate cards matching this slip's type
 *   3. Services     — multi-select from AdditionalFee catalog (optional)
 *   4. Contract     — pick template, dates, attachments
 *   5. Review       — summary + Draft contract CTA
 */
export default async function AssignSlipPage({ params }: Props) {
  const { id } = await params;
  // Find slip in either inventory. Roster passes SLIPS-style ids ("A01");
  // older surfaces may still pass RENTAL_SPACES ids.
  const slip = SLIPS.find((s) => s.id === id);
  const space = !slip ? RENTAL_SPACES.find((s) => s.id === id) : null;
  if (!slip && !space) notFound();

  const slipMeta = slip
    ? {
        id: slip.id,
        number: slip.number,
        dock: slip.dock,
        loaInches: slip.max_loa_inches,
        beamInches: slip.max_beam_inches,
        hasPower: slip.has_power,
        hasWater: slip.has_water,
        occupancyType: "Standard" as const,
        // Pricing is intrinsic to the slip — covered/uncovered/T-head
        // each carry a different default that pre-fills the wizard.
        slipClass: slip.slip_class,
        defaultAnnualRate: slip.default_annual_rate,
        defaultMonthlyRate: slip.default_monthly_rate,
        defaultSeasonalRate: slip.default_seasonal_rate,
      }
    : {
        id: space!.id,
        number: space!.number,
        dock: space!.group_id,
        loaInches: space!.length_inches ?? 0,
        beamInches: space!.beam_inches ?? 0,
        hasPower: space!.has_power,
        hasWater: space!.has_water,
        occupancyType: space!.occupancy_type,
        slipClass: "uncovered" as const,
        defaultAnnualRate: 0,
      };

  return <AssignSlipClient slip={slipMeta} />;
}
