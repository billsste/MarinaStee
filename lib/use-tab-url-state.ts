"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Tab-state hook backed by a URL query param.
 *
 * Reads the initial value from `?<paramName>=...`, falls back to the
 * default if the URL value isn't a valid tab key. Every time the caller
 * setter fires, the URL is updated with `router.replace` so the tab is
 * shareable, bookmarkable, and survives browser back/forward.
 *
 * Why a hook and not raw React state:
 *   - Sub-tabs on /members/[id], /staff, /ledger, /vendors etc. all
 *     deserve the same deep-linking semantics. Inlining the read+write
 *     dance at every call site is error-prone.
 *   - Mark the validator with a type predicate so callers can keep
 *     strong `SectionKey` typing without casts.
 *   - Use `router.replace`, not `push`, so tab switches don't pollute
 *     browser history with one entry per click.
 *   - `scroll: false` keeps the viewport pinned where the operator is
 *     working — tab swaps shouldn't reset scroll position.
 *
 * Example:
 *   type Tab = "overview" | "financials" | "comms";
 *   const [tab, setTab] = useTabUrlState<Tab>(
 *     "tab",
 *     (v): v is Tab => v === "overview" || v === "financials" || v === "comms",
 *     "overview",
 *   );
 */
export function useTabUrlState<T extends string>(
  paramName: string,
  isValid: (v: string | null | undefined) => v is T,
  defaultValue: T,
): [T, (next: T) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [state, setStateRaw] = React.useState<T>(() => {
    const v = params?.get(paramName);
    return isValid(v) ? v : defaultValue;
  });

  // Sync external URL changes (browser back/forward, agent deep-link
  // navigation) into local state. Without this the tab UI would lock
  // to the value at mount even if the URL changed.
  React.useEffect(() => {
    const v = params?.get(paramName);
    if (isValid(v) && v !== state) setStateRaw(v);
    // Only listen on the URL — the validator + paramName are stable
    // references from the caller's perspective.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, paramName]);

  const setState = React.useCallback(
    (next: T) => {
      setStateRaw(next);
      // Use window.location.search instead of params.toString() so
      // we never accidentally drop a query param another component
      // wrote between the React render and this callback firing.
      const sp = new URLSearchParams(
        typeof window === "undefined" ? "" : window.location.search,
      );
      sp.set(paramName, next);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [router, pathname, paramName],
  );

  return [state, setState];
}
