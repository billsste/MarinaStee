"use client";

/*
 * Marina Stee — shared "mock OR Convex" data hook.
 *
 * Purpose
 * -------
 * Phase 3 of the Convex migration (see `docs/architecture-convex.md`)
 * flips pages from `useStore()` mock subscriptions to live `useQuery()`
 * calls one at a time. Until a Convex deployment is provisioned
 * (i.e. `NEXT_PUBLIC_CONVEX_URL` is unset), the mock-data app must keep
 * rendering — Steven's prototype demos depend on it.
 *
 * This hook is the seam. Every migrated page wraps its read with
 * `useTenantQuery` and supplies BOTH sources:
 *
 *   const locations = useTenantQuery({
 *     mock: usePosLocations(),                  // existing mock subscription
 *     convexRef: anyApi.pos.listLocations,      // Convex function reference
 *     convexArgs: { activeOnly: false },        // args matching the query
 *   });
 *
 * When Convex is online the result is the live (and tenant-scoped) data;
 * when it's offline the result is whatever the mock store returned. The
 * call site is identical in both cases — including shape and identity-
 * over-renders semantics (React will re-render when either source
 * changes).
 *
 * Why this shape?
 * ---------------
 * 1. The mock hook MUST be called unconditionally so React's hook-order
 *    invariant holds. The caller passes its result in — they own the
 *    subscription, we just choose whether to return it.
 *
 * 2. `convexRef` is a function reference (e.g. `anyApi.pos.listLocations`
 *    or `api.pos.listLocations` once `convex/_generated` exists). Using
 *    `anyApi` lets pages start migrating BEFORE Steven runs
 *    `npx convex dev` — once the generated `api` lands the page just
 *    swaps `anyApi.foo.bar` for `api.foo.bar` (same shape, stronger
 *    types).
 *
 * 3. `convexArgs` defaults to `{}` (Convex queries that take no args).
 *
 * 4. The return type is generic over the mock's shape because the mock
 *    is the authoritative shape during migration. Convex's resolver is
 *    expected to return a structurally compatible shape (the schema is
 *    aligned to `lib/types.ts`). If a divergence sneaks in, a small
 *    adapter passed via `convexAdapter` reshapes the Convex result.
 *
 * 5. While the Convex query is loading (returns `undefined`), we fall
 *    back to the mock data so the UI never flashes empty. Once the
 *    Convex result arrives it takes over.
 *
 * Future migrations: follow the recipe at
 * `docs/migration-page-recipe.md` — one page at a time, same hook.
 */

import * as React from "react";
import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useConvexEnabled } from "@/components/providers/convex-clerk-provider";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

/**
 * A Convex query function reference. Loose enough to accept both
 * `anyApi.x.y` (untyped) and a typed `api.x.y` reference once
 * `convex/_generated/api` exists.
 */
type AnyQueryRef = FunctionReference<"query">;

/**
 * Options to `useTenantQuery`.
 *
 * The Convex side is optional: a page might want to subscribe to the
 * mock store today and only wire the Convex side in a follow-up commit.
 * In that case it behaves like a plain mock subscription.
 */
export interface UseTenantQueryOptions<TMock, TConvex = TMock> {
  /**
   * The mock-data subscription result. Always passed in — the caller
   * owns the hook (e.g. `usePosLocations()`) so React's hook order
   * stays stable regardless of which path is active.
   */
  mock: TMock;
  /**
   * Optional Convex query reference. Omit while a page is staged for
   * migration but the Convex resolver isn't wired yet.
   */
  convexRef?: AnyQueryRef;
  /**
   * Args for the Convex query (matches the resolver's `args`).
   * Defaults to `{}`. Memoize at the call site if these aren't stable —
   * Convex relies on referential identity to dedupe subscriptions.
   */
  convexArgs?: Record<string, unknown>;
  /**
   * Optional reshape Convex result → mock shape (e.g. when the Convex
   * doc has `_id` and the mock has `id`). Defaults to identity-cast.
   */
  convexAdapter?: (rows: TConvex) => TMock;
}

// ────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────

/**
 * Read a tenant-scoped list (or singleton) with automatic mock ↔ Convex
 * routing. See the file header for the full migration philosophy.
 *
 * NOTE on hook order: `enabled` is sourced from a module-level constant
 * (`NEXT_PUBLIC_CONVEX_URL`), not from a value that changes at runtime.
 * For any given mount of a given component the flag is constant, so the
 * branching `useQuery` call below has a stable hook order across the
 * component's lifetime. We assert this with the eslint-disable comment.
 */
export function useTenantQuery<TMock, TConvex = TMock>(
  opts: UseTenantQueryOptions<TMock, TConvex>,
): TMock {
  const enabled = useConvexEnabled();
  const { mock, convexRef, convexArgs, convexAdapter } = opts;

  // When Convex isn't online, or the page hasn't wired a Convex
  // reference yet, just return mock. We deliberately do NOT call
  // `useQuery` in this branch because the Convex provider is absent
  // (calling useQuery without a provider throws).
  if (!enabled || !convexRef) {
    return mock;
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useConvexBranch<TMock, TConvex>({
    mock,
    convexRef,
    convexArgs: convexArgs ?? {},
    convexAdapter,
  });
}

/**
 * Inner Convex-aware path. Split into its own function so the
 * `useQuery` call is only reached when the Convex provider is mounted.
 */
function useConvexBranch<TMock, TConvex>({
  mock,
  convexRef,
  convexArgs,
  convexAdapter,
}: {
  mock: TMock;
  convexRef: AnyQueryRef;
  convexArgs: Record<string, unknown>;
  convexAdapter?: (rows: TConvex) => TMock;
}): TMock {
  // `useQuery` returns `undefined` while the first sync is in flight.
  // We treat that window as "fall back to mock" so the UI never blanks.
  // Cast through unknown — `anyApi` references are typed as
  // `FunctionReference<"query">` without a concrete return type, so we
  // ask the caller to declare the Convex shape via the generic.
  const live = useQuery(convexRef, convexArgs) as TConvex | undefined;

  return React.useMemo<TMock>(() => {
    if (live === undefined) return mock;
    if (convexAdapter) return convexAdapter(live);
    return live as unknown as TMock;
  }, [live, mock, convexAdapter]);
}

// ────────────────────────────────────────────────────────────
// Convenience: detect "Convex result is authoritative" at the call site
// ────────────────────────────────────────────────────────────

/**
 * For pages that need to render different UI when the data they're
 * looking at is live-from-Convex vs mock (e.g. show a "live" pill in
 * dev). Most pages don't need this — `useTenantQuery` already returns
 * the right shape regardless of source.
 */
export function useDataSource(): "convex" | "mock" {
  return useConvexEnabled() ? "convex" : "mock";
}
