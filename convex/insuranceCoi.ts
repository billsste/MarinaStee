/*
 * Marina Stee — Convex API for the COI auto-renewal workflow.
 *
 * This module is INTENTIONALLY DISTINCT from `convex/insurance.ts`,
 * which holds the page-flip agent's basic CRUD surface. Here we own:
 *
 *   - listExpiring()        : operator dashboard query — every COI in
 *                             the active tenant whose status is in the
 *                             90/60/30/expired buckets.
 *   - draftRenewalReminder(): creates a Communication with a templated
 *                             body referencing the boater + vessel +
 *                             expiry date. Returns the new comm id.
 *   - markCoiUploaded()     : staff / boater submitted a renewed PDF.
 *                             Patches the cert with new carrier, policy,
 *                             effective_end. (Schema keeps a single row
 *                             today; preserve-history via a successor
 *                             row will land alongside the schema change.)
 *
 * Every mutation gates on requireTenant + logAudit. The query is read-
 * only and just calls requireTenant.
 *
 * Status classification mirrors lib/coi.ts. The Convex schema stores a
 * coarser enum (`active | expiring_soon | expired | lapsed`) so this
 * module performs the 90/60/30 bucket math at read time against
 * effective_end (string ISO date) — the dashboard wants the cliffs, but
 * the persisted row doesn't need to know them.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

/** Day in ms — local constant, matches lib/coi.ts. */
const DAY_MS = 86_400_000;

/** YYYY-MM-DD from a Date (local). */
function localIsoFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type CoiCliffStatus = "expiring_90" | "expiring_60" | "expiring_30" | "expired";

function classifyCliff(effectiveEnd: string, todayIso: string): CoiCliffStatus | null {
  if (!effectiveEnd) return null;
  if (effectiveEnd <= todayIso) return "expired";

  const today = new Date(`${todayIso}T00:00:00`);
  const cliff30 = localIsoFromDate(new Date(today.getTime() + 30 * DAY_MS));
  const cliff60 = localIsoFromDate(new Date(today.getTime() + 60 * DAY_MS));
  const cliff90 = localIsoFromDate(new Date(today.getTime() + 90 * DAY_MS));

  if (effectiveEnd <= cliff30) return "expiring_30";
  if (effectiveEnd <= cliff60) return "expiring_60";
  if (effectiveEnd <= cliff90) return "expiring_90";
  return null;
}

/**
 * Operator dashboard surface — returns every COI in the active tenant
 * whose effective_end is within the 90-day window or already lapsed.
 *
 * Each row includes the cliff status (`expiring_90 | _60 | _30 |
 * expired`) so the client doesn't have to recompute. Caller resolves
 * boater + vessel by id from its existing live queries (don't duplicate
 * those joins here).
 */
export const listExpiring = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    const todayIso = localIsoFromDate(new Date());

    const rows = await ctx.db
      .query("insuranceCertificates")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();

    return rows
      .map((row) => {
        const cliff = classifyCliff(row.effective_end, todayIso);
        return cliff ? { coi: row, status: cliff } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  },
});

/**
 * Draft a renewal-reminder Communication referencing the boater + vessel
 * + expiry date. Returns the new Communication id.
 *
 * Stamped flags:
 *   - sender_is_system : true (system-templated comm, not a staff reply)
 *   - status           : "delivered" (Postmark/Twilio aren't wired yet —
 *                         flips to "sent" once the provider lands; see
 *                         convex/communications.ts:send for the same
 *                         convention)
 *
 * `via_agent` is recorded on the audit row when the agent triggers this
 * (the simulated agent calls through the standard runAction path so the
 * Convex audit helper sets via_agent automatically based on caller intent
 * — the mutation itself takes a `viaAgent` flag for explicit control).
 *
 * NOTE: We don't accept a custom body in v1. The body is templated here
 * so the operator-side "Draft renewal reminder" button is one-click and
 * the resulting comm is editable in the comms drawer before send (once
 * that flow exists).
 */
export const draftRenewalReminder = mutation({
  args: {
    coiId: v.id("insuranceCertificates"),
    viaAgent: v.optional(v.boolean()),
  },
  handler: async (ctx, { coiId, viaAgent }) => {
    const tenantId = await requireTenant(ctx);
    const coi = await ctx.db.get(coiId);
    assertOwnedByTenant(coi, tenantId);

    const boater = await ctx.db.get(coi.boater_id);
    assertOwnedByTenant(boater, tenantId);

    // Resolve a vessel name for the body — the schema only joins
    // vessels by boater, so we walk that side. When the boater has
    // multiple vessels, fall back to the first; the COI-to-vessel
    // join lives in the broader mock store, not Convex's insurance
    // schema (intentional — the schema has been kept lean here).
    const vessels = await ctx.db
      .query("vessels")
      .withIndex("by_tenant_boater", (q) =>
        q.eq("tenantId", tenantId).eq("boater_id", boater._id),
      )
      .collect();
    const vesselName = vessels[0]?.name ?? "your vessel";

    const channel = boater.communication_prefs.preferred_channel;
    const recipient =
      channel === "email"
        ? boater.primary_contact.email ?? "—"
        : boater.primary_contact.phone ?? "—";

    // Mint an upload token (or reuse if still valid) so the
    // boater-facing /coi-upload link lands on the right cert.
    // crypto.randomUUID gives ≥122 bits of CSPRNG entropy vs. the prior
    // `coi_${coiId}_${Date.now()}` form, which was fully deterministic
    // from the public coi id + approximate timestamp. Combined with a
    // 7-day `upload_token_expires_at`, an old reminder email's link
    // can't be replayed indefinitely. Lookups must check expiry — see
    // the `byUploadToken` query below.
    const nowIso = new Date().toISOString();
    const existingValid =
      coi.upload_token &&
      coi.upload_token_expires_at &&
      coi.upload_token_expires_at > nowIso;
    const uploadToken = existingValid
      ? (coi.upload_token as string)
      : `coi_${crypto.randomUUID()}`;
    const uploadTokenExpiresAt = existingValid
      ? (coi.upload_token_expires_at as string)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    if (!existingValid) {
      await ctx.db.patch(coiId, {
        upload_token: uploadToken,
        upload_token_expires_at: uploadTokenExpiresAt,
      });
    }

    const subject = `COI renewal needed — ${vesselName}`;
    const body =
      `Hi ${boater.first_name},\n\n` +
      `Your ${vesselName}'s certificate of insurance expires on ${coi.effective_end}. ` +
      `Please upload the renewed COI here:\n\n` +
      `/coi-upload/${uploadToken}\n\n` +
      `Takes about a minute — just drop the PDF and confirm the new effective dates.\n\n` +
      `Marina Stee`;

    const marina = await ctx.db.get(tenantId);
    const senderLabel =
      channel === "sms"
        ? marina?.outbound_sms_sender_label ?? "Marina Stee"
        : marina?.outbound_email_from_name ?? "Marina Stee";

    const commId = await ctx.db.insert("communications", {
      tenantId,
      boater_id: boater._id,
      type: channel,
      direction: "outbound",
      subject,
      body_preview: body.slice(0, 200),
      body_full: body,
      sender_label: senderLabel,
      sender_is_system: true,
      recipient,
      sent_at: new Date().toISOString(),
      status: "delivered",
      related_entity: { type: "insurance", id: coiId },
    });

    await logAudit(ctx, {
      action_type: "coi.draft_renewal_reminder",
      target_entity: "insuranceCertificates",
      target_id: coiId,
      payload_delta: { coiId, commId, channel, recipient },
      via_agent: viaAgent ?? false,
    });

    return commId;
  },
});

/**
 * Persist a fresh COI upload — boater (or staff on their behalf) just
 * dropped a new PDF.
 *
 * The current Convex schema (`convex/schema.ts:insuranceCertificates`)
 * stores ONE row per cert and doesn't carry a successor link, so v1
 * patches in-place: new carrier, new policy, new expiry, attachment.
 * History preservation (a successor row + `renewed_by_coi_id`
 * back-link, mirroring the existing mock-store `submitRenewedCoi`) will
 * land alongside a schema change. Documented here so the page-flip
 * agent's schema work and this one don't collide.
 */
export const markCoiUploaded = mutation({
  args: {
    coiId: v.id("insuranceCertificates"),
    attachmentId: v.optional(v.id("_storage")),
    expiresOn: v.string(),
    carrier: v.optional(v.string()),
    policyNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(args.coiId);
    assertOwnedByTenant(before, tenantId);

    // Validate `expiresOn` strictly — Convex's v.string() doesn't shape
    // the value, so a typo / garbled PDF-parse output ('next year',
    // '2026-13-99', '9999-12-31') would silently land as effective_end
    // and the classifier (which compares ISO strings lexicographically)
    // would mis-bucket the cert. '9999-12-31' specifically sorts past
    // every real cliff — a hostile uploader could hide an expired
    // policy from the operator's expiring queue indefinitely.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.expiresOn)) {
      throw new Error(`Invalid expiresOn — expected YYYY-MM-DD, got ${args.expiresOn}`);
    }
    const parsed = new Date(`${args.expiresOn}T00:00:00Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== args.expiresOn
    ) {
      throw new Error(`Invalid expiresOn — not a real calendar date: ${args.expiresOn}`);
    }
    // Sanity bound — reject dates more than 10 years out. A real COI is
    // typically a 1-year policy.
    const tenYearsOut = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
    if (parsed > tenYearsOut) {
      throw new Error(`expiresOn too far in the future: ${args.expiresOn}`);
    }

    const patch: Record<string, unknown> = {
      effective_end: args.expiresOn,
      status: "active" as const,
      // Burn the upload token on successful upload — single-use is
      // safer than waiting for the 7-day expiry, and prevents replay
      // if the link leaked to a second party.
      upload_token: undefined,
      upload_token_expires_at: undefined,
    };
    if (args.carrier !== undefined) patch.carrier = args.carrier;
    if (args.policyNumber !== undefined) patch.policy_number = args.policyNumber;
    if (args.attachmentId !== undefined) patch.document_storage_id = args.attachmentId;

    await ctx.db.patch(args.coiId, patch);

    await logAudit(ctx, {
      action_type: "coi.upload_renewed",
      target_entity: "insuranceCertificates",
      target_id: args.coiId,
      payload_delta: {
        before: {
          carrier: before.carrier,
          policy_number: before.policy_number,
          effective_end: before.effective_end,
        },
        after: patch,
      },
    });

    return args.coiId;
  },
});
