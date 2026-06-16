import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono, Outfit } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AppShell } from "@/components/app-shell";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { ConvexClerkProvider } from "@/components/providers/convex-clerk-provider";

/*
 * Marina Stee — Nantucket type system.
 *
 *  - Fraunces (light)  → display warmth (h1, hero numbers, large titles)
 *  - Outfit            → interface text (body, UI, controls)
 *  - IBM Plex Mono     → labels + tabular readings (money, units, counts)
 *
 * Numbers use tabular figures (`font-variant-numeric: tabular-nums`)
 * so columns of money / occupancy / hours stay vertically aligned.
 * Plex Mono is bound to `--font-mono` so any existing Tailwind
 * `font-mono` class picks it up automatically; the `.tabular` and
 * `.money-display` utilities in globals.css also resolve to Plex Mono.
 */

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Marina Stee — Admin",
  description:
    "Agent-native marina management. Services, members, ledger, POS — orchestrated by a single agent.",
  applicationName: "Marina Stee",
  appleWebApp: {
    capable: true,
    title: "Marina Stee",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
};

// Marina Stee v1 is light-only — the Nantucket palette + Fraunces / Outfit /
// Plex Mono treatment IS the brand. Dark mode is deferred to v2 as a deliberate
// second skin (note: feedback_marina_stee_theme_is_locked.md). Single
// themeColor pinned to White (#FBFBF8) so the iOS status bar + Android
// theme-color reads consistent across surfaces.
// viewport-fit=cover lets the dock view paint edge-to-edge on notched iPhones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FBFBF8",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fraunces.variable} ${outfit.variable} ${plexMono.variable} light h-full antialiased`}
    >
      {/*
       * v1 is light-only — `light` class is now baked into the SSR
       * className above. Previously we ran an inline pre-hydration
       * <script> to strip `dark` + add `light`, but Next.js 16 emits
       * a "Encountered a script tag while rendering React component"
       * console warning for that pattern. With light baked statically
       * there's nothing to bootstrap; the ThemeProvider below picks up
       * `defaultTheme="light"` and the brand renders consistently
       * regardless of OS prefers-color-scheme or stale localStorage.
       *
       * If dark mode comes back as a v2 skin: switch className to a
       * dynamic value AND restore the ThemeToggle component. For
       * persisted-preference bootstrap, use next/script with
       * strategy="beforeInteractive" rather than a raw inline tag.
       */}
      <body className="min-h-full">
        <ConvexClerkProvider>
          <ThemeProvider defaultTheme="light">
            <AppShell>{children}</AppShell>
            <ServiceWorkerRegister />
          </ThemeProvider>
        </ConvexClerkProvider>
      </body>
    </html>
  );
}
