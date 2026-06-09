/*
 * Marina Stee — Bulk comm send.
 *
 * Operator picks a CommTemplate + an audience filter (cadence / dock /
 * club tier / vessel length / balance). Preview renders the merged
 * tokens for the first 3 recipients so the operator can verify the
 * merge is sane. Execute creates N comms and (when W2's
 * lib/notification-dispatch.ts is live) dispatches via the configured
 * provider.
 *
 * Audit log: one per-batch row + one per-recipient row. Per-recipient
 * is critical for compliance — when a boater later disputes whether a
 * notice went out, the audit timeline must show the exact send.
 *
 * Mock parity: lib/agent-actions.ts → `bulk_send_comms` branch fans the
 * same render+dispatch over `addCommunication` so the wizard works
 * offline.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { logAudit, requireTenant } from "./_helpers";

// ────────────────────────────────────────────────────────────
// Filter shape
// ────────────────────────────────────────────────────────────
//
// The filter is intentionally a small open-vocabulary shape rather
// than a free-form predicate — the operator UI translates dropdown
// selections into a discriminated `kind`. Adding a new audience type
// = new kind here + new dropdown in the wizard.

const filterV = v.union(
  v.object({
    kind: v.literal("all_boaters"),
  }),
  v.object({
    kind: v.literal("cadence"),
    cadence: v.union(
      v.literal("annual"),
      v.literal("seasonal"),
      v.literal("monthly"),
      v.literal("transient"),
    ),
  }),
  v.object({
    kind: v.literal("vessel_loa_over"),
    inches: v.number(),
  }),
  v.object({
    kind: v.literal("has_open_balance"),
  }),
);

export const previewBatch = query({
  args: { templateId: v.id("commTemplates"), filter: filterV },
  handler: async (ctx, { templateId, filter }) => {
    const tenantId = await requireTenant(ctx);
    const template = await ctx.db.get(templateId);
    if (!template || template.tenantId !== tenantId) {
      return { template: null, audience: [], previews: [] };
    }
    const audience = await resolveAudienceForTenant(ctx, tenantId, filter);
    const first3 = audience.slice(0, 3);
    const previews = first3.map((b) => ({
      boater_id: b._id,
      display_name: b.display_name,
      recipient:
        template.channel === "email"
          ? b.primary_contact.email ?? "—"
          : b.primary_contact.phone ?? "—",
      subject: renderTokens(template.subject, b),
      body: renderTokens(template.body_markdown, b),
    }));
    return {
      template: {
        id: template._id,
        name: template.name,
        channel: template.channel,
      },
      audience: audience.map((b) => ({
        boater_id: b._id,
        display_name: b.display_name,
      })),
      previews,
    };
  },
});

export const executeBatch = mutation({
  args: {
    templateId: v.id("commTemplates"),
    filter: filterV,
    dryRun: v.optional(v.boolean()),
    agent_prompt: v.optional(v.string()),
  },
  handler: async (ctx, { templateId, filter, dryRun, agent_prompt }) => {
    const tenantId = await requireTenant(ctx);
    const template = await ctx.db.get(templateId);
    if (!template || template.tenantId !== tenantId) {
      throw new Error("Template not found or not in current tenant");
    }
    const audience = await resolveAudienceForTenant(ctx, tenantId, filter);
    if (dryRun) return { count: audience.length, comm_ids: [] };

    const commIds: string[] = [];
    const marina = await ctx.db.get(tenantId);
    const senderLabel =
      template.channel === "sms"
        ? marina?.outbound_sms_sender_label ?? "Marina Stee"
        : marina?.outbound_email_from_name ?? "Marina Stee";
    const now = new Date().toISOString();

    for (const b of audience) {
      const subject = renderTokens(template.subject, b);
      const body = renderTokens(template.body_markdown, b);
      const recipient =
        template.channel === "email"
          ? b.primary_contact.email ?? "—"
          : b.primary_contact.phone ?? "—";
      const id = await ctx.db.insert("communications", {
        tenantId,
        boater_id: b._id,
        type: template.channel,
        direction: "outbound",
        subject,
        body_preview: body.slice(0, 200),
        body_full: body,
        sender_label: senderLabel,
        sender_is_system: true,
        recipient,
        sent_at: now,
        // Until W2's lib/notification-dispatch.ts lands, comms land as
        // `delivered`. When the dispatcher ships, the agent action
        // resolver feeds `dispatchCommunication` and the status flows
        // from the provider response. (The Convex side never imports
        // the client-only dispatcher — see lib/agent-actions.ts for
        // that wiring.)
        status: "delivered",
      });
      commIds.push(id);

      await logAudit(ctx, {
        action_type: "comm.send_via_bulk",
        target_entity: "communications",
        target_id: id,
        payload_delta: {
          template_id: template._id,
          template_kind: template.kind,
          boater_id: b._id,
          channel: template.channel,
        },
        via_agent: !!agent_prompt,
        agent_prompt,
      });
    }

    await logAudit(ctx, {
      action_type: "bulk_comms.execute",
      target_entity: "bulk_run",
      payload_delta: {
        template_id: template._id,
        template_kind: template.kind,
        filter_kind: filter.kind,
        count: commIds.length,
        via_bulk: true,
      },
      via_agent: !!agent_prompt,
      agent_prompt,
    });

    return { count: commIds.length, comm_ids: commIds };
  },
});

// ────────────────────────────────────────────────────────────
// Audience resolver
// ────────────────────────────────────────────────────────────

type BoaterRow = {
  _id: string;
  tenantId: string;
  active?: boolean;
  display_name: string;
  first_name: string;
  last_name: string;
  billing_cadence: string;
  primary_contact: { email?: string; phone?: string };
};

async function resolveAudienceForTenant(
  // Convex ctx is loosely-typed here so the file can be imported before
  // convex codegen has run; once `_generated` exists, ctx flows through
  // as QueryCtx | MutationCtx and this signature still satisfies.
  ctx: {
    db: {
      query: (table: string) => {
        withIndex: (
          name: string,
          fn: (q: { eq: (k: string, v: unknown) => { eq?: (k: string, v: unknown) => unknown } }) => unknown,
        ) => { collect: () => Promise<unknown[]> };
      };
    };
  },
  tenantId: string,
  filter:
    | { kind: "all_boaters" }
    | { kind: "cadence"; cadence: "annual" | "seasonal" | "monthly" | "transient" }
    | { kind: "vessel_loa_over"; inches: number }
    | { kind: "has_open_balance" },
): Promise<BoaterRow[]> {
  const boaters = (await ctx.db
    .query("boaters")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect()) as BoaterRow[];
  const active = boaters.filter((b) => b.active !== false);

  if (filter.kind === "all_boaters") return active;
  if (filter.kind === "cadence") {
    return active.filter((b) => b.billing_cadence === filter.cadence);
  }
  if (filter.kind === "vessel_loa_over") {
    const inches = filter.inches;
    const vessels = (await ctx.db
      .query("vessels")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect()) as Array<{ boater_id: string; loa_inches?: number }>;
    const matching = new Set(
      vessels
        .filter((v) => (v.loa_inches ?? 0) >= inches)
        .map((v) => v.boater_id),
    );
    return active.filter((b) => matching.has(b._id));
  }
  if (filter.kind === "has_open_balance") {
    const open = (await ctx.db
      .query("ledgerEntries")
      .withIndex("by_tenant_status", (q) =>
        // The inner eq narrows to "status" — pre-codegen typing flows
        // loosely; once _generated exists this becomes the standard
        // by_tenant_status index predicate.
        (q.eq("tenantId", tenantId) as { eq: (k: string, v: unknown) => unknown }).eq("status", "open"),
      )
      .collect()) as Array<{ boater_id: string; type: string; open_balance: number }>;
    const owed = new Map<string, number>();
    for (const inv of open) {
      if (inv.type !== "invoice") continue;
      owed.set(inv.boater_id, (owed.get(inv.boater_id) ?? 0) + inv.open_balance);
    }
    return active.filter((b) => (owed.get(b._id) ?? 0) > 0);
  }
  return [];
}

// ────────────────────────────────────────────────────────────
// Token renderer
// ────────────────────────────────────────────────────────────
// Mirrors the {{token}} convention used by ContractTemplate and
// broadcast-sheet.tsx. Keep the supported tokens in sync with what
// CommTemplate.available_tokens advertises.

function renderTokens(template: string, b: BoaterRow): string {
  if (!template) return "";
  return template
    .replace(/\{\{\s*boater\.first_name\s*\}\}/g, b.first_name)
    .replace(/\{\{\s*boater\.last_name\s*\}\}/g, b.last_name)
    .replace(/\{\{\s*boater\.display_name\s*\}\}/g, b.display_name)
    .replace(/\{\{\s*customer\.first_name\s*\}\}/g, b.first_name)
    .replace(/\{\{\s*customer\.display_name\s*\}\}/g, b.display_name)
    .replace(/\{\{\s*first_name\s*\}\}/g, b.first_name)
    .replace(/\{\{\s*last_name\s*\}\}/g, b.last_name)
    .replace(/\{\{\s*display_name\s*\}\}/g, b.display_name)
    .replace(/\{\{\s*marina\.short_name\s*\}\}/g, "Marina Stee");
}
