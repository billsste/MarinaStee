"use client";

import * as React from "react";

/*
 * Lightweight theme provider — replaces next-themes.
 *
 * next-themes injects an inline <script> for FOUC suppression which React 19
 * now warns against ("Encountered a script tag while rendering React
 * component"). We don't need its full feature set; we toggle a single class
 * on <html> and persist the choice in localStorage. The same FOUC suppression
 * is handled by a small inline script in app/layout.tsx that runs before
 * React hydration.
 */

type Theme = "light" | "dark";
type ResolvedTheme = Theme;

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "marina-stee-theme";

function readInitialTheme(defaultTheme: Theme): Theme {
  if (typeof document === "undefined") return defaultTheme;
  const root = document.documentElement;
  // The pre-hydration script already set the class — trust it.
  if (root.classList.contains("dark")) return "dark";
  if (root.classList.contains("light")) return "light";
  return defaultTheme;
}

export function ThemeProvider({
  children,
  defaultTheme = "dark",
}: {
  children: React.ReactNode;
  // Kept for back-compat with the next-themes call site — these props are
  // accepted but currently unused; we always toggle `class` on <html>.
  attribute?: string;
  enableSystem?: boolean;
  disableTransitionOnChange?: boolean;
  defaultTheme?: Theme;
}) {
  const [theme, setThemeState] = React.useState<Theme>(defaultTheme);

  // Sync from DOM/localStorage after mount so SSR + client agree.
  React.useEffect(() => {
    setThemeState(readInitialTheme(defaultTheme));
  }, [defaultTheme]);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore quota / privacy errors */
      }
    }
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme: theme, setTheme }),
    [theme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    // Permissive fallback so consumers don't crash if mounted outside the
    // provider — matches next-themes' lenient behavior.
    return {
      theme: "dark" as Theme,
      resolvedTheme: "dark" as ResolvedTheme,
      setTheme: () => {},
    };
  }
  return ctx;
}
