/*
 * Marina Stee — Convex function helpers.
 *
 * Two responsibilities here:
 *
 *  1. `requireTenant(ctx)` — pulls the Clerk org_id from the JWT and
 *     resolves it to a `marinas._id`. Every query/mutation that returns
 *     or modifies tenant-scoped data MUST call this first. If it throws,
 *     the caller is not authenticated, not in an org, or in an org that
 *     hasn't been provisioned in Marina Stee yet.
 *
 *  2. `logAudit(ctx, ...)` — append-only audit log entry. Called from
 *     mutations (typically wrapped via `withAudit` which captures the
 *     before/after diff automatically).
 *
 * Both helpers are intentionally tiny — they're the only thing standing
 * between an HTTP request and the database, so they need to be obvious.
 */

import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// ────────────────────────────────────────────────────────────
// Tenant resolution
// ────────────────────────────────────────────────────────────

/**
 * Resolve the current user's tenant (marina) from their Clerk JWT.
 *
 * Throws if:
 *   - No JWT on the request (`401`-equivalent)
 *   - JWT has no org claim (user not in an org → cannot scope)
 *   - The Clerk org is not provisioned as a Marina Stee tenant yet
 */
export async function requireTenant(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"marinas">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthenticated — no Clerk session on this request");
  }

  // Clerk publishes `org_id` when the user is operating inside an Organization.
  // Falls back to undefined for personal-mode sessions. The JWT template in
  // Clerk dashboard must include `{ "org_id": "{{org.id}}" }` for this to be
  // present.
  const clerkOrgId = (identity as { org_id?: string }).org_id;
  if (!clerkOrgId) {
    throw new Error(
      "No organization on session — sign in with an organization or switch via the OrganizationSwitcher",
    );
  }

  const marina = await ctx.db
    .query("marinas")
    .withIndex("by_clerk_org", (q) => q.eq("clerkOrgId", clerkOrgId))
    .unique();

  if (!marina) {
    throw new Error(
      `Marina not provisioned for Clerk org ${clerkOrgId}. ` +
        `Run marina.provision() to add it.`,
    );
  }

  return marina._id;
}

/**
 * Same as requireTenant but also returns the resolving user's identity —
 * for mutations that need actor_id on the audit row.
 */
export async function requireTenantAndUser(
  ctx: QueryCtx | MutationCtx,
): Promise<{
  tenantId: Id<"marinas">;
  userId: string;
  userLabel: string;
}> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthenticated");
  }
  const clerkOrgId = (identity as { org_id?: string }).org_id;
  if (!clerkOrgId) {
    throw new Error("No organization on session");
  }
  const marina = await ctx.db
    .query("marinas")
    .withIndex("by_clerk_org", (q) => q.eq("clerkOrgId", clerkOrgId))
    .unique();
  if (!marina) {
    throw new Error(`Marina not provisioned for Clerk org ${clerkOrgId}`);
  }
  return {
    tenantId: marina._id,
    userId: identity.subject, // Clerk userId
    userLabel: identity.name ?? identity.email ?? identity.subject,
  };
}

// ────────────────────────────────────────────────────────────
// Audit log
// ────────────────────────────────────────────────────────────

/**
 * Append one row to the audit log. Caller passes:
 *  - action_type: dot-separated path like "boater.update"
 *  - target: entity kind + id touched
 *  - payload_delta: small JSON describing what changed (best-effort)
 *  - via_agent + agent_prompt: set when the agent initiated the mutation
 *
 * The helper looks up tenant + actor from auth automatically.
 */
export async function logAudit(
  ctx: MutationCtx,
  args: {
    action_type: string;
    target_entity: string;
    target_id?: string;
    payload_delta?: unknown;
    via_agent?: boolean;
    agent_prompt?: string;
  },
): Promise<void> {
  const { tenantId, userId, userLabel } = await requireTenantAndUser(ctx);
  await ctx.db.insert("auditLog", {
    tenantId,
    actor_user_id: userId,
    actor_label: userLabel,
    action_type: args.action_type,
    target_entity: args.target_entity,
    target_id: args.target_id,
    payload_delta:
      args.payload_delta !== undefined
        ? JSON.stringify(args.payload_delta)
        : undefined,
    via_agent: args.via_agent,
    agent_prompt: args.agent_prompt,
    created_at: new Date().toISOString(),
  });
}

// ────────────────────────────────────────────────────────────
// Cross-tenant guard
// ────────────────────────────────────────────────────────────

/**
 * Defensive check — given a record fetched by id, confirm it actually
 * belongs to the current tenant. Throws on cross-tenant access attempts.
 *
 * Use this after `ctx.db.get(someId)` for sensitive entities (contracts,
 * payments, etc.) to catch URL-tampering / token-replay attacks.
 *
 *   const wo = await ctx.db.get(args.work_order_id);
 *   assertOwnedByTenant(wo, tenantId);
 *   // safe to read/write wo
 */
export function assertOwnedByTenant<T extends { tenantId: Id<"marinas"> } | null>(
  record: T,
  tenantId: Id<"marinas">,
): asserts record is NonNullable<T> {
  if (!record) {
    throw new Error("Record not found");
  }
  if (record.tenantId !== tenantId) {
    throw new Error("Cross-tenant access denied");
  }
}

/**
 * Atomic per-tenant sequence number.
 *
 * Mints the next number for (tenantId, kind) by reading the counter row,
 * incrementing it inside the same mutation transaction, and returning
 * the new value. Convex serializes mutations on the same document, so
 * two parallel calls with the same (tenant, kind) cannot mint the same
 * number — the second one retries after the first commits.
 *
 * Why this exists: every numbered entity (APP-####, WO-####, INV-####,
 * Q-####, K-####, PMT-####, R-####, BIL-####) used to mint by counting
 * rows: `existing.length + 1`. Two concurrent inserts both observe the
 * same count and mint the same number. This helper replaces every such
 * site.
 *
 * Usage:
 *
 *   const seq = await nextSequenceNumber(ctx, tenantId, "APP", 1000);
 *   const number = `APP-${seq}`;
 *
 * @param ctx mutation context (NOT query — we patch the counter row)
 * @param tenantId tenant we're minting for
 * @param kind short label, conventionally the prefix of the rendered
 *             number ("APP", "WO", etc.)
 * @param start the value the first issued number should equal (defaults
 *              to 1; pass 1000 if you want APP-1001 to be the first).
 */
export async function nextSequenceNumber(
  ctx: MutationCtx,
  tenantId: Id<"marinas">,
  kind: string,
  start: number = 1,
): Promise<number> {
  // STARVATION FIX: use `.collect()` not `.unique()`. Two parallel
  // mutations on a fresh tenant both see no row and both insert one —
  // .unique() would then throw on every subsequent call ("more than
  // one row"). Instead, accept that the duplicate insert can happen,
  // reconcile by patching the SURVIVING row (lowest _id) to max+1 of
  // both observed values, and delete the dupes.
  const rows = await ctx.db
    .query("counters")
    .withIndex("by_tenant_kind", (q) =>
      q.eq("tenantId", tenantId).eq("kind", kind),
    )
    .collect();
  if (rows.length === 0) {
    const value = start;
    await ctx.db.insert("counters", { tenantId, kind, value });
    return value;
  }
  // Reconcile any prior race: keep the lowest-_id row (stable winner),
  // bump it to one past the highest value across ALL observed dupes,
  // and delete the rest. This is idempotent — on the next call the
  // table is back to a single row.
  rows.sort((a, b) => (a._id < b._id ? -1 : 1));
  const winner = rows[0];
  const maxValue = rows.reduce((acc, r) => Math.max(acc, r.value), winner.value);
  const next = maxValue + 1;
  await ctx.db.patch(winner._id, { value: next });
  for (let i = 1; i < rows.length; i++) {
    await ctx.db.delete(rows[i]._id);
  }
  return next;
}
