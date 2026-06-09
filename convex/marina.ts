/*
 * Marina (tenant) provisioning + identity reads.
 *
 * `provision` is called once per new marina — either from the admin
 * onboarding flow or by hand when wiring a new Clerk Organization to
 * Marina Stee. It creates the `marinas` row and seeds the default
 * picklists / roles / comm templates for that tenant.
 *
 * `getCurrent` returns the marina profile for the requester's tenant.
 * Used by every "what's my marina?" page (Settings → Marina Profile,
 * receipt headers, portal branding, etc.).
 *
 * `updateCurrent` patches the singleton — auto-saves from the marina
 * profile form, same field set as before, just persisted now.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { logAudit, requireTenant } from "./_helpers";

export const getCurrent = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    const marina = await ctx.db.get(tenantId);
    return marina;
  },
});

export const updateCurrent = mutation({
  args: {
    patch: v.object({
      display_name: v.optional(v.string()),
      short_name: v.optional(v.string()),
      tagline: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      website: v.optional(v.string()),
      address_line1: v.optional(v.string()),
      address_line2: v.optional(v.string()),
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      postal_code: v.optional(v.string()),
      country: v.optional(v.string()),
      timezone: v.optional(v.string()),
      business_hours_open: v.optional(v.string()),
      business_hours_close: v.optional(v.string()),
      default_tax_rate: v.optional(v.number()),
      accounting_close: v.optional(
        v.union(
          v.literal("monthly_eom"),
          v.literal("monthly_15th"),
          v.literal("weekly_friday"),
        ),
      ),
      outbound_email_from_name: v.optional(v.string()),
      outbound_sms_sender_label: v.optional(v.string()),
      // H2 wave — per-tenant notification provider config. All
      // optional so the marina-profile form can patch one field at a
      // time. See convex/schema.ts for the field-level docstrings.
      postmark_api_key: v.optional(v.string()),
      postmark_message_stream: v.optional(v.string()),
      twilio_account_sid: v.optional(v.string()),
      twilio_auth_token: v.optional(v.string()),
      twilio_from_number: v.optional(v.string()),
      twilio_from_email_label: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { patch }) => {
    const tenantId = await requireTenant(ctx);
    await ctx.db.patch(tenantId, patch);
    // SECRET REDACTION: provider auth tokens (postmark_api_key,
    // twilio_auth_token, twilio_webhook_secret) are persisted on the
    // marina row but MUST NOT survive into audit_log.payload_delta —
    // the audit log is exported, attached to support tickets, and
    // shown across the operator team. A token rotation event would
    // otherwise leave the prior token visible in audit history
    // forever. Replace each secret with a `<redacted>` sentinel; the
    // operator audit trail still shows "the field was changed" but
    // not the value.
    const SECRET_KEYS = new Set([
      "postmark_api_key",
      "twilio_auth_token",
      "twilio_webhook_secret",
    ]);
    const redactedPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      redactedPatch[k] = SECRET_KEYS.has(k) ? "<redacted>" : v;
    }
    await logAudit(ctx, {
      action_type: "marina.update",
      target_entity: "marinas",
      target_id: tenantId,
      payload_delta: redactedPatch,
    });
    return tenantId;
  },
});

/**
 * Bootstrap a new marina from a Clerk org_id. Called by the operator
 * onboarding flow (or by hand from the dashboard).
 *
 * Idempotent — if the Clerk org is already provisioned, returns the
 * existing tenantId.
 */
export const provision = mutation({
  args: {
    clerkOrgId: v.string(),
    display_name: v.string(),
    short_name: v.string(),
    email: v.string(),
    phone: v.string(),
    address_line1: v.string(),
    city: v.string(),
    state: v.string(),
    postal_code: v.string(),
    timezone: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("marinas")
      .withIndex("by_clerk_org", (q) => q.eq("clerkOrgId", args.clerkOrgId))
      .unique();
    if (existing) return existing._id;

    const tenantId = await ctx.db.insert("marinas", {
      clerkOrgId: args.clerkOrgId,
      display_name: args.display_name,
      short_name: args.short_name,
      email: args.email,
      phone: args.phone,
      address_line1: args.address_line1,
      city: args.city,
      state: args.state,
      postal_code: args.postal_code,
      country: "US",
      timezone: args.timezone,
      business_hours_open: "08:00",
      business_hours_close: "20:00",
      default_tax_rate: 0.06,
      accounting_close: "monthly_eom",
      outbound_email_from_name: args.short_name,
      outbound_sms_sender_label: args.short_name.slice(0, 11),
    });
    return tenantId;
  },
});
