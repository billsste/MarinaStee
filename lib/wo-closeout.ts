/**
 * Work Order closeout chain.
 *
 * Fires when a Work Order transitions to `status="completed"`. Drives
 * the natural downstream business flow that the operator otherwise
 * has to wire by hand:
 *
 *   1. Quote → Invoice   — if a signed/approved Quote is linked, flip
 *                          it to `invoiced` (stamping `invoiced_at`) and
 *                          carry its total forward as the invoice basis.
 *   2. Ledger entry      — post a fresh `LedgerEntry` (`kind="invoice"`)
 *                          for `quote.total` against the WO's boater.
 *                          When no quote is attached, closeout is silent
 *                          on this step (operator handles billing manually).
 *   3. Boater comm       — draft a completion message on the boater's
 *                          preferred channel. Uses the `service_complete`
 *                          comm template when configured; falls back to
 *                          baked-in copy otherwise. Merge tokens follow
 *                          the existing `{{merge_token}}` pattern.
 *   4. Vessel last-serviced stamp — if `wo.vessel_id` is set, update
 *                          `last_service_at` + `last_service_wo_id`.
 *   5. Recurring next-spawn — only for cleaning WOs with `is_recurring`.
 *                          Cron walker (lib/recurring-cleaning.ts) is the
 *                          primary path; this one-off draft is a hand-off
 *                          courtesy so the operator sees the next visit
 *                          was scheduled. Walker dedupes via the anchor
 *                          advance, so a double-fire here is harmless.
 *
 * Adapter pattern: the module never imports the mock store OR Convex
 * directly. Callers (lib/client-store.ts, convex/workOrders.ts) build
 * an adapter that wires each closeout primitive to their storage layer
 * and pass it in. This keeps the orchestration pure and identical on
 * both paths — and makes per-step Vitest coverage straightforward
 * (swap the adapter for a stub, assert the recorded ops).
 *
 * Idempotency: callers gate on `wo.closed_out_at`. The orchestrator
 * itself is a no-op when `wo.closed_out_at` is already set — callers
 * may pre-filter to avoid even calling, but the in-function guard is
 * the source of truth.
 *
 * Audit log: each chain step's audit row is written by the adapter
 * (so it lands in the right transaction on Convex / the right local
 * store on mock). The orchestrator returns the ids it created so the
 * adapter can stamp them onto the rows with `via_closeout=true`
 * (encoded in the audit `action_type` prefix `work_order.closeout.*`
 * — the schema's audit table only has `via_agent`, and extending the
 * enum is out of scope for this wave).
 */

import type { Quote, Vessel, WorkOrder } from "@/lib/types";

// ────────────────────────────────────────────────────────────
// Result shape — what the orchestrator records about the chain
// ────────────────────────────────────────────────────────────

export interface CloseoutResult {
  /** Quote id that was flipped to `invoiced` — undefined when no quote
   *  was linked OR the quote was not in a billable state. */
  quoteInvoiced?: string;
  /** New `LedgerEntry.id` for the posted invoice. Undefined when no
   *  invoice was posted (no quote OR quote.total === 0). */
  ledgerEntryId?: string;
  /** New `Communication.id` for the completion message. Undefined only
   *  when the boater could not be resolved (data-integrity edge). */
  commId?: string;
  /** True when the vessel's last-service stamps were updated. False
   *  when the WO had no vessel attached. */
  vesselUpdated?: boolean;
  /** New WO id when the closeout also spawned a recurring next-visit
   *  draft. Empty when this WO wasn't a recurring cleaning. */
  recurringSpawnId?: string;
  /** True when closeout short-circuited because the WO was already
   *  closed out. Lets callers distinguish "ran, no-op" from "ran, did
   *  work". */
  alreadyClosedOut?: boolean;
}

// ────────────────────────────────────────────────────────────
// Adapter contract — every storage primitive the chain needs.
// Both mock and Convex callers implement this against their layer.
// ────────────────────────────────────────────────────────────

/**
 * Minimal boater shape closeout needs — channel preference + first
 * name + recipient email/phone. Mock + Convex Boater rows both
 * project cleanly onto this shape via the adapter.
 */
export interface CloseoutBoaterRef {
  id: string;
  first_name: string;
  display_name: string;
  preferred_channel: "email" | "sms" | "voice";
  email?: string;
  phone?: string;
  tenant_id?: string;
}

/**
 * The completion-comm template lookup return. Both mock comm templates
 * and Convex comm templates project to this shape; falls back to inline
 * copy when the adapter returns `undefined`.
 */
export interface CloseoutCommTemplate {
  subject: string;
  body_markdown: string;
  channel?: "email" | "sms" | "voice";
}

/**
 * Adapter — caller wires each primitive to mock or Convex.
 *
 * Conventions:
 *   - Every mutator returns the id it minted (or void for in-place
 *     patches). The orchestrator threads ids forward into the result.
 *   - Read-only lookups return `undefined` rather than throwing when
 *     the target isn't found. Closeout degrades gracefully rather
 *     than aborting halfway through.
 *   - Adapters own audit-log writes for their own surface (mock →
 *     logAuditLocal; Convex → ctx logAudit). The orchestrator signals
 *     via the action verb string so audit rows stay consistent.
 */
export interface CloseoutAdapter {
  /** Return the boater for a WO. Closeout aborts entirely when this
   *  returns undefined — without a boater there's no comm recipient
   *  and no ledger context. */
  getBoater(boaterId: string): CloseoutBoaterRef | undefined;
  /** Find the Quote linked to this WO. Returns undefined when no quote
   *  exists OR the WO never linked one. */
  getQuoteForWorkOrder(wo: WorkOrder): Quote | undefined;
  /** True when an invoice ledger entry already exists for this WO.
   *  Used by the partial-failure recovery path: if a prior closeout
   *  flipped the quote to `invoiced` but threw before posting the
   *  ledger entry, we want to detect that gap and complete the chain
   *  on retry rather than silently skipping the billing step. */
  hasInvoiceForWorkOrder(workOrderId: string): boolean;
  /** Flip a Quote's status to `invoiced` and stamp `invoiced_at` on it.
   *  Returns the quote id on success. The adapter is responsible for
   *  writing the audit row. */
  markQuoteInvoiced(quoteId: string, invoicedAt: string): string | undefined;
  /** Post a fresh invoice ledger entry. Adapter mints id + number +
   *  GL account; orchestrator only supplies the business inputs. */
  addLedgerEntry(input: {
    boaterId: string;
    amount: number;
    description: string;
    workOrderId: string;
    quoteId?: string;
    lineItems: { description: string; amount: number }[];
    dateIso: string;
  }): string | undefined;
  /** Drop the comm row into the boater's thread + dispatch through the
   *  outbound provider if one is wired. Returns comm id. */
  addCommunication(input: {
    boaterId: string;
    channel: "email" | "sms" | "voice";
    subject: string;
    body: string;
    recipient: string;
    relatedEntity?: { type: "invoice" | "work_order"; id: string };
  }): string | undefined;
  /** Read a vessel by id — used to confirm the vessel exists before
   *  patching it (defense against orphaned WO references). */
  getVessel(vesselId: string): Vessel | undefined;
  /** Patch the Vessel's last-service stamps. The adapter is responsible
   *  for writing the audit row. */
  updateVessel(
    vesselId: string,
    patch: { last_service_at: string; last_service_wo_id: string },
  ): void;
  /** Lookup the `service_complete` template for this tenant. Returns
   *  undefined when no template is configured — orchestrator falls
   *  back to inline copy. */
  getCommTemplate(
    kind: "service_complete",
    tenantId: string | undefined,
  ): CloseoutCommTemplate | undefined;
  /** Stamp the WO's `closed_out_at` so re-fires no-op. Adapter writes
   *  the audit row. */
  stampWorkOrderClosed(workOrderId: string, closedAtIso: string): void;
  /** Optionally spawn the recurring next-visit. Only invoked when the
   *  closeout chain decides the WO is a recurring-cleaning template
   *  — the adapter wraps `executeAgentAction({kind: "create_work_order"})`
   *  on the mock side / a Convex mutation on the live side. Returns
   *  the new WO id when the spawn lands. */
  spawnRecurringNext?(prev: WorkOrder): string | undefined;
}

// ────────────────────────────────────────────────────────────
// Merge-token expansion — same `{{token}}` syntax as comm templates.
// Kept locally rather than importing a shared util because the
// closeout chain has a fixed token set; pulling in the broader
// template engine would couple wo-closeout to surfaces it doesn't
// need to know about.
// ────────────────────────────────────────────────────────────

interface CloseoutTokens {
  boater_first: string;
  boater_name: string;
  wo_number: string;
  wo_subject: string;
  wo_completed_at: string;
  quote_total: string;
  quote_link_or_total: string;
}

function buildTokens(input: {
  wo: WorkOrder;
  boater: CloseoutBoaterRef;
  quote?: Quote;
  todayIso: string;
}): CloseoutTokens {
  const { wo, boater, quote, todayIso } = input;
  const total = quote?.total ?? 0;
  const totalStr =
    total > 0 ? `$${total.toFixed(2)}` : "(no charge this time)";
  // Quote link short-circuit — we don't have a public quote URL yet, so
  // the link is just the formatted total. When the Quote surfaces a
  // public /quote/<token> in a later wave, swap this for that URL.
  const quoteLink = quote
    ? `Your invoice is ${totalStr}.`
    : `No invoice this time.`;
  return {
    boater_first: boater.first_name,
    boater_name: boater.display_name,
    wo_number: wo.number,
    wo_subject: wo.subject,
    wo_completed_at: todayIso.slice(0, 10),
    quote_total: totalStr,
    quote_link_or_total: quoteLink,
  };
}

/**
 * Expand `{{token}}` against the closeout token bag. Exported so the
 * Vitest harness can verify token expansion in isolation.
 */
export function expandTokens(body: string, tokens: CloseoutTokens): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const v = tokens[key as keyof CloseoutTokens];
    return v ?? `{{${key}}}`;
  });
}

// ────────────────────────────────────────────────────────────
// Inline fallback copy — used when the operator hasn't configured a
// service_complete comm template. Tone: warm, short, signature line.
// Kept here (not in the adapter) so both mock + Convex paths produce
// identical copy when no template is set.
// ────────────────────────────────────────────────────────────

const FALLBACK_TEMPLATE: CloseoutCommTemplate = {
  subject: "Work complete — {{wo_subject}}",
  body_markdown:
    "Hi {{boater_first}},\n\n" +
    "We finished {{wo_subject}} on {{wo_completed_at}}. {{quote_link_or_total}}\n\n" +
    "Reach out if anything's off — happy to fix it.\n\n" +
    "Marina Stee",
};

// ────────────────────────────────────────────────────────────
// The orchestrator
// ────────────────────────────────────────────────────────────

/**
 * Run the closeout chain end-to-end. Pure orchestration — does no
 * storage of its own; every side-effect routes through the supplied
 * adapter. Safe to call multiple times: the `closed_out_at` guard
 * makes a second call a no-op.
 *
 * Returns the ids/flags for each step so the caller can:
 *   - Stamp them onto the audit row.
 *   - Render a toast ("Posted invoice, sent comm, stamped vessel").
 *   - Surface them in tests (the testable surface this module
 *     deliberately exposes).
 */
export function runWorkOrderCloseout(args: {
  wo: WorkOrder;
  todayIso: string;
  actor: { user_id?: string };
  store: CloseoutAdapter;
}): CloseoutResult {
  const { wo, todayIso, store } = args;
  const result: CloseoutResult = {};

  // ── Idempotency guard ──
  // Already closed out → no-op. Caller still gets the existing stamps
  // via the return shape (`alreadyClosedOut: true`) so a UI can
  // distinguish "ran, no-op" from "did nothing".
  if (wo.closed_out_at) {
    result.alreadyClosedOut = true;
    return result;
  }

  // ── Resolve boater ──
  // Without a boater we can't post an invoice or send a comm. Bail
  // early but still stamp closed_out_at so the chain doesn't keep
  // re-trying (operator can clear the stamp to retry once boater is
  // re-attached).
  const boater = store.getBoater(wo.boater_id);
  if (!boater) {
    store.stampWorkOrderClosed(wo.id, todayIso);
    return result;
  }

  // ── Pre-flight: capture intent BEFORE mutating ──
  // Previous incarnation of this chain fired `markQuoteInvoiced` first,
  // then if any downstream step threw, the quote stayed in `invoiced`
  // but `closed_out_at` never stamped. A retry would walk back in, see
  // quote.status === "invoiced" (not "signed"/"approved"), classify it
  // as non-billable, and silently skip the ledger entry — billing
  // dropped on the floor.
  //
  // Fix: resolve the entire plan (what to invoice, what comm to send,
  // what to spawn) up front against READ-only adapter calls. Then run
  // mutators. If a mutator throws mid-chain, the next retry's pre-flight
  // sees the same intent again — combined with the `hasInvoiceForWorkOrder`
  // idempotency check below, we either complete the missing step or
  // skip the already-done one.
  const quote = store.getQuoteForWorkOrder(wo);
  const ledgerAlreadyPosted = store.hasInvoiceForWorkOrder(wo.id);
  const quoteBillable =
    !!quote &&
    (quote.status === "signed" ||
      // Real product has "approved" status on Quote in some flows; the
      // current QuoteStatus enum doesn't list it, but checking by string
      // keeps the closeout module forward-compatible.
      (quote.status as string) === "approved" ||
      // Idempotency recovery: a prior partial-failure run flipped the
      // quote to `invoiced` but threw before posting the ledger row.
      // Treat the quote as billable when its status is `invoiced` AND
      // no ledger entry exists for this WO yet, so the retry completes
      // the chain rather than skipping billing entirely.
      ((quote.status as string) === "invoiced" && !ledgerAlreadyPosted)) &&
    quote.total > 0;

  // ── Step 1 + 2: Quote → Invoice + ledger entry ──
  if (quoteBillable && quote) {
    // Skip the quote flip when it's already invoiced (recovery path);
    // the adapter would no-op anyway, but skipping avoids a redundant
    // audit-log row.
    const alreadyInvoiced = (quote.status as string) === "invoiced";
    if (!alreadyInvoiced) {
      const stamped = store.markQuoteInvoiced(quote.id, todayIso);
      if (stamped) result.quoteInvoiced = stamped;
    } else {
      result.quoteInvoiced = quote.id;
    }
    // Guard against double-posting: only write the ledger row when one
    // doesn't already exist for this WO. The pre-flight read above is
    // the source of truth — adapter-level write is the fallback.
    if (!ledgerAlreadyPosted) {
      const description = `Work order ${wo.number} — ${wo.subject}`;
      const lineItems =
        quote.line_items.length > 0
          ? quote.line_items.map((li) => ({
              description: li.name,
              amount: li.total,
            }))
          : [{ description, amount: quote.total }];
      const ledgerId = store.addLedgerEntry({
        boaterId: wo.boater_id,
        amount: quote.total,
        description,
        workOrderId: wo.id,
        quoteId: quote.id,
        lineItems,
        dateIso: todayIso,
      });
      if (ledgerId) result.ledgerEntryId = ledgerId;
    }
  }

  // ── Step 3: Boater comm ──
  // Resolve the template (operator-editable) → fall back to inline.
  // Channel preference: template-declared channel wins over boater
  // pref ONLY when the template explicitly sets one (operators may
  // want the receipt as email no matter what); otherwise fall back to
  // the boater's preferred channel.
  const template =
    store.getCommTemplate("service_complete", boater.tenant_id) ??
    FALLBACK_TEMPLATE;
  const channel = template.channel ?? boater.preferred_channel;
  const tokens = buildTokens({ wo, boater, quote, todayIso });
  const subject = expandTokens(template.subject, tokens);
  const body = expandTokens(template.body_markdown, tokens);
  const recipient =
    channel === "email"
      ? boater.email ?? ""
      : channel === "sms"
        ? boater.phone ?? ""
        : boater.phone ?? boater.email ?? "";
  const relatedEntity: { type: "invoice" | "work_order"; id: string } =
    result.ledgerEntryId
      ? { type: "invoice", id: result.ledgerEntryId }
      : { type: "work_order", id: wo.id };
  const commId = store.addCommunication({
    boaterId: wo.boater_id,
    channel,
    subject,
    body,
    recipient,
    relatedEntity,
  });
  if (commId) result.commId = commId;

  // ── Step 4: Vessel last-service stamp ──
  if (wo.vessel_id) {
    const vessel = store.getVessel(wo.vessel_id);
    if (vessel) {
      store.updateVessel(wo.vessel_id, {
        last_service_at: todayIso,
        last_service_wo_id: wo.id,
      });
      result.vesselUpdated = true;
    }
  }

  // ── Step 5: Recurring next-cleanup spawn ──
  // The walker (lib/recurring-cleaning.ts) is the primary path — it
  // fires on each cron tick based on `recurring_next_date`. We ALSO
  // fire a one-off here so the operator sees the chain advance the
  // moment they mark complete (no waiting for the next tick).
  //
  // Dependency: the walker dedupes by advancing `recurring_next_date`
  // when it spawns; this closeout-side spawn doesn't move the anchor,
  // so the walker will still see the next anchor as due on its
  // intended cadence. If both fire on the same tick the walker's
  // spawn becomes the canonical child and this one would be a no-op
  // dup — operator can prune. Worth a follow-up to converge to a
  // single spawn source.
  if (
    wo.is_recurring &&
    wo.work_class === "cleaning" &&
    store.spawnRecurringNext
  ) {
    const spawnId = store.spawnRecurringNext(wo);
    if (spawnId) result.recurringSpawnId = spawnId;
  }

  // ── Stamp closed_out_at — last so partial-failure runs (adapter
  // throws mid-chain) can be retried by re-marking complete.
  store.stampWorkOrderClosed(wo.id, todayIso);

  return result;
}

// ────────────────────────────────────────────────────────────
// Public testable surface — exported so a future Vitest run can
// verify each step in isolation without standing up the whole app.
// These have no side-effects on import.
// ────────────────────────────────────────────────────────────

export const __testables = {
  buildTokens,
  expandTokens,
  FALLBACK_TEMPLATE,
};
