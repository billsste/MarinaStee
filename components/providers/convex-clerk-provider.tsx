"use client";

/*
 * Convex + Clerk client-side wiring.
 *
 * Wraps the app so:
 *   - Clerk owns the session (cookies, sign-in flow, organization switching)
 *   - Convex auto-attaches the Clerk JWT to every query/mutation call
 *   - `useQuery(api.boaters.list)` etc. just work, tenant-scoped, no manual headers
 *
 * The whole tree is feature-flagged on the presence of NEXT_PUBLIC_CONVEX_URL
 * so the existing mock-data app keeps working in development before the
 * Convex deployment is provisioned. Once that env var is set, the real
 * provider kicks in and Convex hooks come online — but reading from
 * lib/mock-data.ts continues to work for any component that hasn't been
 * migrated yet.
 *
 * The provider ALSO publishes a `ConvexEnabledContext` so the rest of the
 * app can detect — at the React layer, not via raw process.env — whether
 * Convex is online. Migrated pages use `useConvexEnabled()` (or
 * `useTenantQuery()` in `lib/use-tenant-query.ts`) to decide whether to
 * read from Convex or fall back to the mock store. This keeps the hook
 * order stable across renders (the flag is constant for a session) and
 * lets us strip env reads out of render bodies entirely.
 */

import * as React from "react";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ConvexReactClient } from "convex/react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

// Module-level client — created once, reused across renders.
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

// ────────────────────────────────────────────────────────────
// Feature-flag context
// ────────────────────────────────────────────────────────────
//
// `enabled` is constant for the lifetime of the app — it's set at module
// load from NEXT_PUBLIC_CONVEX_URL. Pages should read it via
// `useConvexEnabled()` (or the higher-level `useTenantQuery` helper)
// rather than touching process.env directly: that keeps client/server
// rendering aligned, plays nicely with React strict mode, and means we
// only have one switch to flip when Convex comes online.
const ConvexEnabledContext = React.createContext<boolean>(false);

export function useConvexEnabled(): boolean {
  return React.useContext(ConvexEnabledContext);
}

export function ConvexClerkProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Migration gate — when the backend isn't provisioned yet, render kids
  // without the providers but still publish `enabled = false` so hooks
  // downstream get a definitive signal (rather than reading process.env
  // themselves and racing with the provider tree).
  if (!convex) {
    return (
      <ConvexEnabledContext.Provider value={false}>
        {children}
      </ConvexEnabledContext.Provider>
    );
  }
  return (
    <ConvexEnabledContext.Provider value={true}>
      <ClerkProvider>
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
          {children}
        </ConvexProviderWithClerk>
      </ClerkProvider>
    </ConvexEnabledContext.Provider>
  );
}
