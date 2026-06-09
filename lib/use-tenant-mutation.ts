"use client";

/*
 * Marina Stee — shared "mock OR Convex" write hook.
 *
 * Phase 4 companion to `lib/use-tenant-query.ts`. Where the query hook
 * picks between a mock subscription and a live `useQuery` at *read*
 * time, this hook picks between a mock mutation and a live `useMutation`
 * at *write* time.
 *
 * Migration philosophy
 * --------------------
 * Phase 3 flipped reads on the first 4 pages (pos-locations, docks,
 * comm-templates, audit-log) but left the page's "+ New X" / "Save" /
 * "Delete" buttons calling the mock-store mutations directly. Phase 4
 * swaps each of those callsites to `useTenantMutation()` so they fire
 * the corresponding Convex mutation when `NEXT_PUBLIC_CONVEX_URL` is
 * set, and fall back to the mock store otherwise.
 *
 * Usage
 * -----
 *   // Read side (unchanged Phase 3 pattern)
 *   const locations = useTenantQuery({ mock: usePosLocations(), … });
 *
 *   // Write side (Phase 4)
 *   const saveLocation = useTenantMutation<PosLocation, void>({
 *     mock: (loc) => upsertPosLocation(loc),
 *     convexRef: anyApi.pos.createLocation,
 *     convexArgsAdapter: (loc) => ({
 *       key: loc.key,
 *       name: loc.name,
 *       default_tax_rate: loc.default_tax_rate,
 *       // …
 *     }),
 *   });
 *
 *   await saveLocation(values);   // identical call site, both modes
 *
 * Hook-order safety
 * -----------------
 * The Convex enabled flag is sourced from a module-level constant
 * (`NEXT_PUBLIC_CONVEX_URL` via `useConvexEnabled()`), constant for the
 * lifetime of a session. Like `useTenantQuery`, we split the Convex
 * branch into its own component-scoped subhook so `useMutation` is only
 * called when a `ConvexReactClient` is actually mounted in the tree.
 * `useMutation` outside a `<ConvexProvider>` throws.
 */

import * as React from "react";
import { useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useConvexEnabled } from "@/components/providers/convex-clerk-provider";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

/**
 * A Convex mutation function reference. Loose enough to accept both
 * `anyApi.x.y` (untyped) and a typed `api.x.y` reference once
 * `convex/_generated/api` exists.
 */
type AnyMutationRef = FunctionReference<"mutation">;

/**
 * Options to `useTenantMutation`.
 *
 * Like `useTenantQuery`, the Convex side is optional — a page can wire
 * the mock side first and bolt the Convex ref on in a follow-up. In
 * that case the hook returns a plain async wrapper around the mock.
 */
export interface UseTenantMutationOptions<TArgs, TReturn = void> {
  /**
   * The mock-store mutation. Always provided. Called when Convex is
   * disabled or `convexRef` is omitted. May be sync or async; the
   * returned wrapper always resolves to a `Promise<TReturn>`.
   */
  mock: (args: TArgs) => TReturn | Promise<TReturn>;
  /**
   * Optional Convex mutation reference. Omit while staging a page for
   * migration before the Convex resolver is in place.
   */
  convexRef?: AnyMutationRef;
  /**
   * Optional reshape of caller args → Convex resolver args. Defaults
   * to passing `args` straight through, which is the right shape when
   * the mock-store function and the Convex mutation match argument
   * names (the common case after Phase 4 hardening).
   */
  convexArgsAdapter?: (args: TArgs) => Record<string, unknown>;
  /**
   * Optional error handler invoked when the mutation throws. Without
   * this, callers that fire-and-forget via `void mutate(args)` silently
   * lose Convex schema-validation failures, auth errors, tenant-mismatch
   * (`assertOwnedByTenant` throws), rate-limit failures, and server
   * errors — the operator sees the SaveBar flash "Saved" but the
   * change never persisted.
   *
   * The hook ALSO emits a `marina-stee:mutation-error` CustomEvent on
   * the global `window` object regardless of whether `onError` is
   * supplied — install a global listener in your app shell to surface
   * a default toast. This way pages don't each have to wire individual
   * error handling.
   *
   *   window.addEventListener("marina-stee:mutation-error", (e) => {
   *     toast.error(e.detail.message);
   *   });
   */
  onError?: (error: Error) => void;
}

/** CustomEvent detail for the global mutation-error broadcast. */
export interface MutationErrorEventDetail {
  message: string;
  error: unknown;
  // The args the caller passed — useful for log/replay. Caller should
  // assume PII could appear here and scrub before logging if needed.
  args: unknown;
}

const MUTATION_ERROR_EVENT = "marina-stee:mutation-error" as const;

function broadcastMutationError(error: unknown, args: unknown): void {
  if (typeof window === "undefined") return;
  const message =
    error instanceof Error ? error.message : String(error ?? "Mutation failed");
  const detail: MutationErrorEventDetail = { message, error, args };
  window.dispatchEvent(new CustomEvent(MUTATION_ERROR_EVENT, { detail }));
}

// ────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────

/**
 * Returns a stable function the caller invokes to fire the mutation.
 * In Convex mode the call routes through `useMutation(convexRef)`; in
 * mock mode it routes through `opts.mock`. The shape is identical so
 * callers don't have to branch.
 */
export function useTenantMutation<TArgs, TReturn = void>(
  opts: UseTenantMutationOptions<TArgs, TReturn>,
): (args: TArgs) => Promise<TReturn> {
  const enabled = useConvexEnabled();
  const { mock, convexRef, convexArgsAdapter, onError } = opts;

  // When Convex isn't online or the page hasn't wired a ref yet, run
  // the mock directly. We deliberately do NOT call `useMutation` here:
  // it throws when a ConvexProvider isn't mounted, and the mock-mode
  // bundle is the prototype demo that has to keep working.
  if (!enabled || !convexRef) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return React.useCallback(
      async (args: TArgs) => {
        try {
          return await mock(args);
        } catch (err) {
          // Mock-path failures (e.g. `deleteDock` throws when a slip
          // still references it) used to vanish under `void mutate()`.
          // Broadcast + optionally invoke onError so the page can toast.
          broadcastMutationError(err, args);
          if (onError) onError(err instanceof Error ? err : new Error(String(err)));
          throw err;
        }
      },
      [mock, onError],
    );
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useConvexBranch<TArgs, TReturn>({
    convexRef,
    convexArgsAdapter,
    onError,
  });
}

/**
 * Inner Convex-aware path. Split so `useMutation` is only reached when
 * the provider is mounted (matches the pattern in `useTenantQuery`).
 */
function useConvexBranch<TArgs, TReturn>({
  convexRef,
  convexArgsAdapter,
  onError,
}: {
  convexRef: AnyMutationRef;
  convexArgsAdapter?: (args: TArgs) => Record<string, unknown>;
  onError?: (error: Error) => void;
}): (args: TArgs) => Promise<TReturn> {
  // `useMutation` returns a callable ReactMutation. We narrow the
  // arg/return types via the generic — `anyApi.*` refs come in as
  // `FunctionReference<"mutation">` with `any` arg/return, so the cast
  // through unknown is the only way to give the caller a typed handle.
  const fire = useMutation(convexRef) as unknown as (
    args: Record<string, unknown>,
  ) => Promise<TReturn>;

  return React.useCallback(
    async (args: TArgs) => {
      const payload = convexArgsAdapter ? convexArgsAdapter(args) : (args as unknown as Record<string, unknown>);
      try {
        return await fire(payload);
      } catch (err) {
        // Convex throws on: schema-validation, auth/tenant-mismatch
        // (`assertOwnedByTenant`), rate-limit, server errors. Without
        // this catch, `void hook(args)` callsites silently lose every
        // failure — including security-adjacent cross-tenant rejections.
        broadcastMutationError(err, args);
        if (onError) onError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
    },
    [fire, convexArgsAdapter, onError],
  );
}
