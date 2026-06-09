import Link from "next/link";
import { notFound } from "next/navigation";
import { Calendar, Clock, Flag, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import { QuoteSection } from "@/components/work-orders/quote-section";
import { LinkedEntitiesRail } from "@/components/work-orders/linked-entities-rail";
import { WorkOrderBackLink } from "@/components/work-orders/back-link";
import { RentalsAsk } from "@/components/rentals/rentals-ask";
import { EstimateRow } from "@/components/work-orders/estimate-row";
import { CleaningSourcePanel } from "@/components/work-orders/cleaning-source-panel";
import { ChecklistEditor } from "@/components/work-orders/checklist-editor";
import { RecurringPreview } from "@/components/work-orders/recurring-preview";
import { InternalNotesPanel } from "@/components/work-orders/internal-notes-panel";
import { AttachmentsPanel } from "@/components/work-orders/attachments-panel";
import { AdvanceRecurringButton } from "@/components/work-orders/advance-recurring-button";
import { BOATERS, getQuoteForWorkOrder, getWorkOrder } from "@/lib/mock-data";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const wo = getWorkOrder(id);
  return { title: wo ? `${wo.number} ${wo.subject} — Marina Stee` : "Work Order — Marina Stee" };
}

const STATUS_TONE = {
  open: "neutral",
  scheduled: "info",
  in_progress: "warn",
  blocked: "danger",
  completed: "ok",
  cancelled: "outline",
} as const;

const PRIORITY_TONE = {
  urgent: "danger",
  high: "warn",
  normal: "neutral",
  low: "outline",
} as const;

export default async function WorkOrderDetailPage({ params }: Props) {
  const { id } = await params;
  const wo = getWorkOrder(id);
  if (!wo) notFound();
  const boater = BOATERS.find((b) => b.id === wo.boater_id);
  const quote = getQuoteForWorkOrder(wo.id);

  return (
    <div className="mx-auto w-full max-w-[1280px] px-5 pt-6 pb-32">
      <WorkOrderBackLink fallbackBoaterId={wo.boater_id} />

      {/* Identity bar */}
      <div className="rounded-[12px] border border-hairline bg-surface-1 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[12px] text-fg-tertiary">
              <span className="font-mono">{wo.number}</span>
              {wo.flagged && (
                <Badge tone="warn" size="sm">
                  <Flag className="size-3" />
                  Flagged
                </Badge>
              )}
            </div>
            <h1 className="mt-1 text-[20px] font-semibold tracking-tight text-fg">
              {wo.subject}
            </h1>
            {wo.description && (
              <p className="mt-1 max-w-2xl text-[13px] text-fg-subtle">
                {wo.description}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone={STATUS_TONE[wo.status]}>{wo.status.replace("_", " ")}</Badge>
              <Badge tone={PRIORITY_TONE[wo.priority]}>priority {wo.priority}</Badge>
              {/* work_class chip — cleaning vs. service drives the
                  presence of the checklist + recurrence cards below, so
                  surface it next to the status so the operator can
                  pattern-match the WO shape at a glance. */}
              <Badge tone={wo.work_class === "cleaning" ? "info" : "neutral"}>
                {wo.work_class}
              </Badge>
              {wo.activity_type && (
                <Badge tone="outline">{wo.activity_type.replace("_", " ")}</Badge>
              )}
              {/* From-holder marker — staff need to know inbound portal
                  requests at a glance because the SLA / first-touch
                  clock differs from staff-initiated work. */}
              {wo.submitted_via === "holder_portal" && (
                <Badge tone="primary">
                  <Send className="size-3" />
                  From holder
                </Badge>
              )}
              {boater && (
                <Badge tone="neutral">
                  for{" "}
                  <Link href={`/members/${boater.id}`} className="ml-1 text-primary hover:underline">
                    {boater.display_name}
                  </Link>
                </Badge>
              )}
              {wo.start_date && (
                <Badge tone="outline">
                  <Calendar className="size-3" />
                  <LocalTime iso={wo.start_date} fmt="short_date" />
                  {wo.end_date && wo.end_date !== wo.start_date ? (
                    <>
                      {" → "}
                      <LocalTime iso={wo.end_date} fmt="short_date" />
                    </>
                  ) : null}
                </Badge>
              )}
              {wo.billable_minutes != null && (
                <Badge tone="outline">
                  <Clock className="size-3" />
                  {Math.round(wo.billable_minutes / 60)}h logged
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="md">Edit</Button>
            <Button variant="ghost" size="md">Flag</Button>
          </div>
        </div>
      </div>

      {/* Main 2-col layout */}
      <div className="mt-4 flex gap-5">
        {/* space-y-5 on the left column to match the canonical agent →
            next gap used across every other top-level page. */}
        <div className="min-w-0 flex-1 space-y-5">
          <RentalsAsk
            placeholder={`Ask about ${wo.number} — e.g. 'reassign to J. Reyes' or 'mark urgent'`}
            suggestions={[
              `Reassign ${wo.number} to J. Reyes`,
              `Mark ${wo.number} urgent`,
              `Complete ${wo.number}`,
              "What's the boater's open balance?",
            ]}
          />

          {/* The new WO-wizard fields land between the agent rail and
              the formal quote. Order is intentional:
                1. EstimateRow — pre-quote ballpark frames the quote
                2. CleaningSourcePanel — context for *why* this WO exists
                3. ChecklistEditor — primary daily action for cleaning
                4. RecurringPreview — next-spawn confidence
                5. InternalNotesPanel — dispatcher freeform
                6. AttachmentsPanel — supporting media last
              Each card no-ops when its gating condition isn't met, so
              service WOs render a clean left column. */}
          <EstimateRow wo={wo} />
          <CleaningSourcePanel wo={wo} />
          {wo.work_class === "cleaning" && <ChecklistEditor wo={wo} />}
          {wo.work_class === "cleaning" && wo.is_recurring && (
            <RecurringPreview wo={wo} />
          )}
          <InternalNotesPanel wo={wo} />
          <AttachmentsPanel wo={wo} />
          {wo.work_class === "cleaning" && wo.is_recurring && (
            <AdvanceRecurringButton />
          )}

          <QuoteSection wo={wo} initialQuote={quote} />
        </div>

        <LinkedEntitiesRail wo={wo} />
      </div>
    </div>
  );
}
