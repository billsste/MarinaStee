import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertOwnedByTenant, logAudit, requireTenant } from "./_helpers";

const kindV = v.union(
  v.literal("payment"),
  v.literal("email"),
  v.literal("sms"),
  v.literal("accounting"),
);

export const list = query({
  args: {},
  handler: async (ctx) => {
    const tenantId = await requireTenant(ctx);
    return await ctx.db
      .query("providerConfigs")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
  },
});

export const connect = mutation({
  args: {
    kind: kindV,
    provider: v.string(),
    public_config: v.optional(v.string()),
    has_secret: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const tenantId = await requireTenant(ctx);
    // Upsert by kind + provider
    const existing = await ctx.db
      .query("providerConfigs")
      .withIndex("by_tenant_kind", (q) =>
        q.eq("tenantId", tenantId).eq("kind", args.kind),
      )
      .collect();
    const match = existing.find((p) => p.provider === args.provider);
    if (match) {
      await ctx.db.patch(match._id, {
        enabled: true,
        public_config: args.public_config,
        has_secret: args.has_secret ?? match.has_secret,
      });
      await logAudit(ctx, {
        action_type: "provider.update",
        target_entity: "providerConfigs",
        target_id: match._id,
        payload_delta: { kind: args.kind, provider: args.provider },
      });
      return match._id;
    }
    const id = await ctx.db.insert("providerConfigs", {
      tenantId,
      kind: args.kind,
      provider: args.provider,
      enabled: true,
      public_config: args.public_config,
      has_secret: args.has_secret ?? false,
    });
    await logAudit(ctx, {
      action_type: "provider.connect",
      target_entity: "providerConfigs",
      target_id: id,
      payload_delta: { kind: args.kind, provider: args.provider },
    });
    return id;
  },
});

export const disconnect = mutation({
  args: { id: v.id("providerConfigs") },
  handler: async (ctx, { id }) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);
    await ctx.db.patch(id, { enabled: false });
    await logAudit(ctx, {
      action_type: "provider.disconnect",
      target_entity: "providerConfigs",
      target_id: id,
    });
    return id;
  },
});

/**
 * Settings → Connections page-side update. The Convex schema for
 * `providerConfigs` is intentionally narrow (kind / provider / enabled
 * / public_config / has_secret), but the page (`components/settings/
 * connections-view.tsx`) tracks a richer surface: display_name, status,
 * a per-field config map, connected_at, last_error. We pack the full
 * page-side state into `public_config` (a JSON blob) so the schema
 * doesn't need to grow. The page's adapter parses + reshapes both
 * directions.
 *
 * `enabled` stays in lockstep with status === "connected" so the
 * agent-facing connect/disconnect paths and the page-side write
 * surface stay consistent — we derive `enabled` from `patch.status`
 * server-side rather than asking the caller to track it.
 *
 * Phase 4 (Wave 3) — wired through `useTenantMutation` from the
 * connections view. The caller passes a JSON-serialized patch covering
 * only the fields it wants to change; we merge it on top of the
 * existing `public_config` blob so callers don't have to re-send the
 * whole state.
 */
export const update = mutation({
  args: {
    id: v.id("providerConfigs"),
    /**
     * JSON-serialized patch of PackedPublicConfig — see `connections-view.tsx`.
     * Callers that want to overwrite the WHOLE packed blob still pass this
     * (legacy path, kept for compatibility with existing callers).
     */
    public_config_patch: v.optional(v.string()),
    /**
     * Narrow shallow merge inside `public_config.config` (the per-field
     * credential map). When set, the resolver reads the prior config,
     * merges `config_patch` field-by-field, and writes back atomically
     * inside this mutation. Use this for inline-edit-cell saves where
     * the caller knows only ONE field changed — passing the full closure-
     * snapshot map back as `public_config_patch.config` clobbers
     * concurrent writes to other fields (operator tabbing through
     * pk/sk/whsec rapid-fire each carried its own snapshot, and the
     * last write erased the earlier ones).
     *
     * Server-side merge means each field hits its own atomic mutation
     * — no closure-snapshot races, no client-side merge required.
     */
    config_patch: v.optional(
      v.record(
        v.string(),
        v.union(v.string(), v.number(), v.boolean(), v.null()),
      ),
    ),
    /**
     * Status override applied alongside `config_patch`. The legacy path
     * packs status inside `public_config_patch`; when using the narrow
     * `config_patch` surface, pass status through this dedicated arg so
     * the server can derive `enabled` without reparsing the blob.
     */
    status_patch: v.optional(
      v.union(
        v.literal("connected"),
        v.literal("disconnected"),
        v.literal("needs_attention"),
      ),
    ),
    /**
     * `connected_at` ISO timestamp — applied when transitioning into the
     * connected state. Passed alongside `config_patch` so the narrow
     * surface can stamp it without round-tripping the whole blob.
     */
    connected_at_patch: v.optional(v.string()),
    /**
     * Clears `last_error` when set explicitly to undefined; otherwise
     * overwrites. Kept narrow + optional so concurrent writes to
     * unrelated fields don't trample the error state.
     */
    last_error_patch: v.optional(v.union(v.string(), v.null())),
    has_secret: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    {
      id,
      public_config_patch,
      config_patch,
      status_patch,
      connected_at_patch,
      last_error_patch,
      has_secret,
    },
  ) => {
    const tenantId = await requireTenant(ctx);
    const before = await ctx.db.get(id);
    assertOwnedByTenant(before, tenantId);

    type PackedShape = {
      display_name?: string;
      status?: "connected" | "disconnected" | "needs_attention";
      config?: Record<string, string | number | boolean | null>;
      connected_at?: string;
      last_error?: string;
    };

    let prev: PackedShape = {};
    if (before.public_config) {
      try {
        const parsed = JSON.parse(before.public_config);
        if (parsed && typeof parsed === "object") prev = parsed as PackedShape;
      } catch {
        // ignore — corrupt JSON resets cleanly
      }
    }

    // Two-mode merge. The narrow surface (`config_patch` + friends) wins
    // when present — that's the race-safe path used by inline-edit
    // cells. The legacy `public_config_patch` blob path is preserved so
    // any caller still sending whole-state JSON keeps working.
    let next: PackedShape;
    let effectiveStatus: PackedShape["status"];

    if (
      config_patch !== undefined ||
      status_patch !== undefined ||
      connected_at_patch !== undefined ||
      last_error_patch !== undefined
    ) {
      // Atomic shallow-merge inside `public_config.config`. Read the
      // prior config from the freshly-fetched row, merge field-by-field,
      // write back. Concurrent writes to different keys both land
      // because each mutation does its own read-merge-write.
      const mergedConfig: Record<string, string | number | boolean | null> = {
        ...(prev.config ?? {}),
        ...(config_patch ?? {}),
      };
      next = {
        ...prev,
        config: mergedConfig,
      };
      if (status_patch !== undefined) next.status = status_patch;
      if (connected_at_patch !== undefined)
        next.connected_at = connected_at_patch;
      if (last_error_patch !== undefined) {
        if (last_error_patch === null) {
          delete next.last_error;
        } else {
          next.last_error = last_error_patch;
        }
      }
      effectiveStatus = status_patch;
    } else {
      // Legacy path — whole-blob shallow merge. Used by any caller still
      // packing the full PackedShape into `public_config_patch`.
      let incoming: PackedShape = {};
      if (public_config_patch !== undefined) {
        try {
          const parsed = JSON.parse(public_config_patch);
          if (parsed && typeof parsed === "object")
            incoming = parsed as PackedShape;
        } catch {
          // ignore — invalid JSON patch is a no-op for safety
        }
      }
      next = { ...prev, ...incoming };
      effectiveStatus = incoming.status;
    }

    const dbPatch: Record<string, unknown> = {
      public_config: JSON.stringify(next),
    };
    if (has_secret !== undefined) dbPatch.has_secret = has_secret;
    // Derive `enabled` from the merged status if the caller's patch
    // mentioned it — otherwise leave it alone.
    if (effectiveStatus !== undefined) {
      dbPatch.enabled = effectiveStatus === "connected";
    }
    await ctx.db.patch(id, dbPatch);
    await logAudit(ctx, {
      action_type: "provider.update",
      target_entity: "providerConfigs",
      target_id: id,
      payload_delta: { status: effectiveStatus, has_secret },
    });
    return id;
  },
});
