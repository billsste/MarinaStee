import { notFound } from "next/navigation";
import { SignExperience } from "@/components/sign/sign-experience";
import {
  BOATERS,
  VESSELS,
  WORK_ORDERS,
  getQuoteByToken,
  getSlip,
} from "@/lib/mock-data";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props) {
  const { token } = await params;
  const quote = getQuoteByToken(token);
  return {
    title: quote
      ? `Sign quote ${quote.number} — Marina Stee`
      : "Quote not found — Marina Stee",
  };
}

export default async function SignTokenPage({ params }: Props) {
  const { token } = await params;
  const quote = getQuoteByToken(token);
  if (!quote) notFound();

  const boater = BOATERS.find((b) => b.id === quote.boater_id);
  const wo = WORK_ORDERS.find((w) => w.id === quote.work_order_id);
  const vessel = wo?.vessel_id ? VESSELS.find((v) => v.id === wo.vessel_id) : undefined;
  const slip = wo?.slip_id ? getSlip(wo.slip_id) : undefined;

  return (
    <SignExperience
      quote={quote}
      boater={boater}
      vessel={vessel}
      slip={slip}
      workOrderSubject={wo?.subject ?? quote.number}
    />
  );
}
