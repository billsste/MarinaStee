"use client";

import * as React from "react";

/*
 * Theme provider — Marina Stee v1 is light-only.
 *
 * The Nantucket palette + Fraunces / Outfit / Plex Mono treatment IS the
 * brand and renders in light mode only. Dark mode is deferred to v2 as a
 * deliberate second skin (see ~/.claude/projects/-Users-stevengbills/memory/
 * feedback_marina_stee_theme_is_locked.md).
 *
 * The provider is preserved so `useTheme()` consumers keep type-checking and
 * any conditional `resolvedTheme === "dark"` branches in the codebase
 * gracefully no-op. setTheme is a no-op — if dark mode comes back as v2,
 * restore the localStorage write + class flip and re-mount the ThemeToggle
 * component.
 */

type Theme = "light" | "dark";
type ResolvedTheme = Theme;

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
  // Kept for back-compat with prior call sites — accepted but ignored.
  attribute?: string;
  enableSystem?: boolean;
  disableTransitionOnChange?: boolean;
  defaultTheme?: Theme;
}) {
  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme: "light",
      resolvedTheme: "light",
      // No-op. Locked to light for v1 — see file header.
      setTheme: () => {},
    }),
    [],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    return {
      theme: "light" as Theme,
      resolvedTheme: "light" as ResolvedTheme,
      setTheme: () => {},
    };
  }
  return ctx;
}
