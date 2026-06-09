/*
 * Per-tenant rate limiting — primarily for /api/agent and /api/draft-contract.
 *
 * Day-bucketed counters. `checkAndIncrement` is idempotent within a
 * single window — calling it multiple times across the day accumulates
 * up to the cap, then throws.
 *
 * Buckets:
 *   - "agent.requests" — 500/day default
 *   - "agent.tokens"   — soft alarm at 50000/day (telemetry, no block)
 *   - "support.tickets" — 50/day (when support module ships)
 *
 * Limits live in the function; the table just stores the current counter.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireTenant } from "./_helpers";

const DEFAULT_CAPS: Record<string, { limit: number; window: "day" }> = {
  "agent.requests": { limit: 500, window: "day" },
  "agent.tokens": { limit: 50000, window: "day" },
  "support.tickets": { limit: 50, window: "day" },
  // PDF extraction is expensive — Claude vision call burns 10-100k
  // tokens per multi-page PDF, billed against the platform Anthropic
  // key. Cap at 100/day per tenant so a runaway operator (or hostile
  // actor with a stolen DEV_TOKEN) can't drain the budget.
  "pdf_extract.requests": { limit: 100, window: "day" },
};

function currentWindowStart(window: "day"): string {
  // ISO date for day-bucketed counters
  return new Date().toISOString().slice(0, 10);
}

export const status = query({
  args: { bucket: v.string() },
  handler: async (ctx, { bucket }) => {
    const tenantId = await requireTenant(ctx);
    const row = await ctx.db
      .query("rateLimits")
      .withIndex("by_tenant_bucket", (q) =>
        q.eq("tenantId", tenantId).eq("bucket_key", bucket),
      )
      .unique();
    const cap = DEFAULT_CAPS[bucket]?.limit ?? Infinity;
    return {
      bucket,
      counter: row?.counter ?? 0,
      cap,
      remaining: Math.max(0, cap - (row?.counter ?? 0)),
      window_started_at: row?.window_started_at ?? currentWindowStart("day"),
    };
  },
});

export const checkAndIncrement = mutation({
  args: { bucket: v.string(), amount: v.optional(v.number()) },
  handler: async (ctx, { bucket, amount }) => {
    const tenantId = await requireTenant(ctx);
    const cap = DEFAULT_CAPS[bucket]?.limit ?? Infinity;
    const inc = amount ?? 1;
    const now = currentWindowStart("day");
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_tenant_bucket", (q) =>
        q.eq("tenantId", tenantId).eq("bucket_key", bucket),
      )
      .unique();
    if (!existing) {
      await ctx.db.insert("rateLimits", {
        tenantId,
        bucket_key: bucket,
        counter: inc,
        window_started_at: now,
      });
      return { allowed: true, counter: inc, cap };
    }
    const counter =
      existing.window_started_at === now ? existing.counter + inc : inc;
    const window_started_at = now;
    if (counter > cap) {
      return { allowed: false, counter: existing.counter, cap };
    }
    await ctx.db.patch(existing._id, { counter, window_started_at });
    return { allowed: true, counter, cap };
  },
});

/**
 * Tenant-explicit variant for workspace-trusted callers (the Next.js
 * routes that authenticate via DEV_TOKEN or future Clerk session, not
 * via Convex's JWT path). Validates the tenantId is a real marina
 * before bumping. Used by /api/pdf-extract.
 *
 * SECURITY: this is a PUBLIC mutation but the caller must pass a real
 * tenantId. Defense in depth: enumeration of marina ids costs the
 * attacker a 1/day-per-bucket increment they can't spend.
 */
export const checkAndIncrementForTenant = mutation({
  args: {
    tenantId: v.id("marinas"),
    bucket: v.string(),
    amount: v.optional(v.number()),
  },
  handler: async (ctx, { tenantId, bucket, amount }) => {
    const marina = await ctx.db.get(tenantId);
    if (!marina) throw new Error("Unknown marina");
    const cap = DEFAULT_CAPS[bucket]?.limit ?? Infinity;
    const inc = amount ?? 1;
    const now = currentWindowStart("day");
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_tenant_bucket", (q) =>
        q.eq("tenantId", tenantId).eq("bucket_key", bucket),
      )
      .unique();
    if (!existing) {
      await ctx.db.insert("rateLimits", {
        tenantId,
        bucket_key: bucket,
        counter: inc,
        window_started_at: now,
      });
      return { allowed: true, counter: inc, cap };
    }
    const counter =
      existing.window_started_at === now ? existing.counter + inc : inc;
    const window_started_at = now;
    if (counter > cap) {
      return { allowed: false, counter: existing.counter, cap };
    }
    await ctx.db.patch(existing._id, { counter, window_started_at });
    return { allowed: true, counter, cap };
  },
});
