/**
 * Convex-side Work Order closeout chain.
 *
 * Mirrors `lib/wo-closeout.ts` (mock orchestrator) but written against
 * Convex's `ctx.db` / `ctx.db.patch` / `ctx.db.insert`. Same chain, same
 * step ordering, same idempotency guard — kept in lockstep with the
 * mock module so the demo and the live deployment behave identically
 * when an operator marks a WO complete.
 *
 * We intentionally do NOT import lib/wo-closeout.ts here: that module
 * uses synchronous getters keyed off the React-side mock store. Convex
 * mutations are async and must use `ctx.db` lookups; even though the
 * orchestration logic is the same, fan-out + adapter would force every
 * accessor through Promises that the mock side doesn't need. The
 * orchestration is short — duplicating it here is cheaper than the
 * abstraction.
 *
 * See `lib/wo-closeout.ts` for the canonical commentary on each step;
 * the divergences are flagged inline where Convex schema differs from
 * the mock shape (Quote.status enum is narrower on Convex, ledger
 * has fewer denormalized link fields, etc.).
 */

import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { logAudit } from "./_helpers";

export interface ConvexCloseoutResult {
  quoteInvoiced?: Id<"quotes">;
  ledgerEntryId?: Id<"ledgerEntries">;
  commId?: Id<"communications">;
  vesselUpdated?: boolean;
  /** True when the WO was already closed out — chain short-circuited. */
  alreadyClosedOut?: boolean;
}

/**
 * Drive the closeout chain for a WO that just transitioned to
 * `status="completed"`. Safe to call multiple times — the
 * `closed_out_at` stamp guards re-fires.
 */
export async function runWorkOrderCloseout(
  ctx: MutationCtx,
  args: {
    woId: Id<"workOrders">;
    tenantId: Id<"marinas">;
    todayIso: string;
  },
): Promise<ConvexCloseoutResult> {
  const result: ConvexCloseoutResult = {};
  const wo = await ctx.db.get(args.woId);
  if (!wo) return result;

  // ── Idempotency guard ──
  if (wo.closed_out_at) {
    result.alreadyClosedOut = true;
    return result;
  }

  // ── Boater lookup (required for invoice + comm) ──
  const boater = await ctx.db.get(wo.boater_id);
  if (!boater || boater.tenantId !== args.tenantId) {
    // Without a boater we can't continue — stamp closed_out_at so the
    // chain doesn't keep re-trying. Operator can clear the stamp once
    // the boater link is restored.
    await ctx.db.patch(args.woId, { closed_out_at: args.todayIso });
    return result;
  }

  // ── Step 1 + 2: Quote → Invoice + ledger entry ──
  // Convex schema only declares quote.status ∈ {draft,sent,signed,
  // declined,expired} — there's no "invoiced" literal. We flip to
  // "signed" + stamp the linkage via the back-pointer on the ledger
  // entry (`linked_work_order_id` + the closeout audit trail), then
  // surface the "invoiced" state externally via the existence of a
  // matching ledger entry. When the schema picks up the wider status
  // enum from lib/types.ts the mutator below can flip to "invoiced".
  //
  // Idempotency: mirrors the partial-failure recovery in the mock
  // orchestrator (lib/wo-closeout.ts). If a prior closeout attempt
  // threw between the quote-flip and the ledger insert, the retry
  // would otherwise double-post. We scan for an existing invoice
  // linked to this WO and skip the post when one exists. Same logic
  // lives behind `hasInvoiceForWorkOrder` on the mock-side adapter.
  const quote = wo.quote_id ? await ctx.db.get(wo.quote_id) : null;
  const existingInvoiceForWo = await ctx.db
    .query("ledgerEntries")
    .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
    .filter((q) =>
      q.and(
        q.eq(q.field("type"), "invoice"),
        q.eq(q.field("linked_work_order_id"), wo._id),
      ),
    )
    .first();
  if (
    quote &&
    quote.tenantId === args.tenantId &&
    quote.status === "signed" &&
    quote.total > 0 &&
    !existingInvoiceForWo
  ) {
    // The schema doesn't allow status="invoiced", so we don't flip
    // status here — the ledger entry's linked_work_order_id is the
    // canonical "this quote was invoiced" signal until a schema bump
    // widens the enum. Audit row makes the intent legible.
    result.quoteInvoiced = quote._id;
    await logAudit(ctx, {
      action_type: "work_order.closeout.quote_invoiced",
      target_entity: "quotes",
      target_id: quote._id,
      payload_delta: { invoiced_at: args.todayIso },
    });

    // Mint the invoice ledger entry. Count existing ledger entries to
    // synthesize an invoice number that matches the mutator pattern in
    // ledger.ts → recordPayment.
    const existingLedger = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const invoiceNumber = `MG${String(5500 + existingLedger.length + 1).padStart(4, "0")}`;
    const lineItems = quote.line_items.map((li) => ({
      description: li.description,
      amount: li.total,
    }));
    const ledgerId = await ctx.db.insert("ledgerEntries", {
      tenantId: args.tenantId,
      boater_id: wo.boater_id,
      type: "invoice",
      number: invoiceNumber,
      date: args.todayIso.slice(0, 10),
      amount: quote.total,
      open_balance: quote.total,
      method: undefined,
      status: "open",
      line_items: lineItems,
      linked_work_order_id: wo._id,
      qb_sync_status: "pending",
    });
    result.ledgerEntryId = ledgerId;

    // Back-link the ledger entry onto the WO so the kanban detail rail
    // shows the invoice without a secondary join.
    await ctx.db.patch(args.woId, {
      linked_ledger_entry_ids: [
        ...(wo.linked_ledger_entry_ids ?? []),
        ledgerId,
      ],
    });

    await logAudit(ctx, {
      action_type: "work_order.closeout.invoice_posted",
      target_entity: "ledgerEntries",
      target_id: ledgerId,
      payload_delta: {
        amount: quote.total,
        work_order_id: wo._id,
      },
    });
  }

  // ── Step 3: Boater comm ──
  // Resolve the service_complete template; fall back to inline copy
  // when no active template is configured for this tenant.
  const templates = await ctx.db
    .query("commTemplates")
    .withIndex("by_tenant_kind", (q) =>
      q.eq("tenantId", args.tenantId).eq("kind", "service_complete"),
    )
    .collect();
  const tpl = templates.find((t) => t.active) ?? null;
  const channel: "email" | "sms" | "voice" =
    (tpl?.channel as "email" | "sms" | "voice" | undefined) ??
    boater.communication_prefs.preferred_channel;

  const tokens: Record<string, string> = {
    boater_first: boater.first_name,
    boater_name: boater.display_name,
    wo_number: wo.number,
    wo_subject: wo.subject,
    wo_completed_at: args.todayIso.slice(0, 10),
    quote_total: quote ? `$${quote.total.toFixed(2)}` : "(no charge this time)",
    quote_link_or_total: quote
      ? `Your invoice is $${quote.total.toFixed(2)}.`
      : "No invoice this time.",
  };
  const expand = (s: string): string =>
    s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => tokens[k] ?? `{{${k}}}`);
  const subject = expand(
    tpl?.subject ?? "Work complete — {{wo_subject}}",
  );
  const body = expand(
    tpl?.body_markdown ??
      "Hi {{boater_first}},\n\n" +
        "We finished {{wo_subject}} on {{wo_completed_at}}. {{quote_link_or_total}}\n\n" +
        "Reach out if anything's off — happy to fix it.\n\n" +
        "Marina Stee",
  );
  const recipient =
    channel === "email"
      ? boater.primary_contact.email ?? "—"
      : boater.primary_contact.phone ?? "—";
  const marina = await ctx.db.get(args.tenantId);
  const senderLabel =
    channel === "sms"
      ? marina?.outbound_sms_sender_label ?? "Marina Stee"
      : marina?.outbound_email_from_name ?? "Marina Stee";

  const relatedEntity = result.ledgerEntryId
    ? { type: "invoice", id: String(result.ledgerEntryId) }
    : { type: "work_order", id: String(wo._id) };

  const commId = await ctx.db.insert("communications", {
    tenantId: args.tenantId,
    boater_id: wo.boater_id,
    type: channel,
    direction: "outbound",
    subject,
    body_preview: body.slice(0, 200),
    body_full: body,
    sender_label: senderLabel,
    sender_is_system: true,
    recipient,
    sent_at: args.todayIso,
    status: "delivered",
    related_entity: relatedEntity,
  });
  result.commId = commId;
  await logAudit(ctx, {
    action_type: "work_order.closeout.comm_sent",
    target_entity: "communications",
    target_id: commId,
    payload_delta: { channel, boater_id: wo.boater_id },
  });

  // ── Step 4: Vessel last-service stamp ──
  if (wo.vessel_id) {
    const vessel = await ctx.db.get(wo.vessel_id);
    if (vessel && vessel.tenantId === args.tenantId) {
      await ctx.db.patch(wo.vessel_id, {
        last_service_at: args.todayIso,
        last_service_wo_id: wo._id,
      });
      result.vesselUpdated = true;
      await logAudit(ctx, {
        action_type: "work_order.closeout.vessel_stamped",
        target_entity: "vessels",
        target_id: wo.vessel_id,
        payload_delta: {
          last_service_at: args.todayIso,
          last_service_wo_id: wo._id,
        },
      });
    }
  }

  // ── Step 5: Recurring next-cleanup spawn ──
  // Deferred on the Convex side. The walker job (eventual Convex
  // scheduled function) advances the recurring chain on its own
  // cadence; the closeout chain on the mock path fires a one-off
  // courtesy spawn but the Convex walker doesn't exist yet, so there's
  // nothing meaningful to duplicate. Once the walker lands, the same
  // pattern as the mock side (lib/client-store.ts → spawnRecurringNext)
  // can move here. Logged for follow-up.
  //
  // NOTE: when the Convex walker is implemented, mirror the
  // `status !== "completed"` filter from
  // `lib/recurring-cleaning.ts → advanceRecurringCleanings`. Closeout
  // already creates the next-spawn; without that filter the walker
  // would double-fire on parents that the operator has already marked
  // complete (the `recurring_next_date` anchor stays unmoved until the
  // walker advances it, so the parent re-qualifies forever).

  // ── Stamp closed_out_at last so partial failures can be retried ──
  await ctx.db.patch(args.woId, { closed_out_at: args.todayIso });
  await logAudit(ctx, {
    action_type: "work_order.closeout.completed",
    target_entity: "workOrders",
    target_id: args.woId,
    payload_delta: { closed_out_at: args.todayIso },
  });

  return result;
}

/**
 * Tiny helper exposed for type-safety on the WO doc — the closeout
 * fires only when the patch flips status from non-completed to
 * completed AND closed_out_at isn't already set. Both `updateStatus`
 * (UI path) and `updateWorkOrderStatus` (agent path) call this gate.
 */
export function shouldFireCloseout(
  before: Doc<"workOrders"> | null,
  patchStatus: string | undefined,
): boolean {
  if (!before) return false;
  if (before.closed_out_at) return false;
  if (patchStatus !== "completed") return false;
  if (before.status === "completed") return false;
  return true;
}
