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

// Theme color flips automatically between light + dark via media query.
// viewport-fit=cover lets the dock view paint edge-to-edge on notched iPhones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Nantucket palette — White on light, Soft Navy on dark.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBFBF8" },
    { media: "(prefers-color-scheme: dark)", color: "#1F2A38" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fraunces.variable} ${outfit.variable} ${plexMono.variable} h-full antialiased`}
    >
      <head>
        {/*
         * Pre-hydration theme bootstrap. suppressHydrationWarning silences
         * React 19's "script tag inside component" console error while still
         * letting the script run before React paints (no FOUC).
         * next/script with beforeInteractive also triggers the warning in
         * Next 16 when placed in <head>, so we use the raw tag + suppress.
         */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('marina-stee-theme');if(!t){t='dark';}var r=document.documentElement;r.classList.remove('light','dark');r.classList.add(t);}catch(e){document.documentElement.classList.add('dark');}})();",
          }}
        />
      </head>
      <body className="min-h-full">
        <ConvexClerkProvider>
          <ThemeProvider defaultTheme="dark">
            <AppShell>{children}</AppShell>
            <ServiceWorkerRegister />
          </ThemeProvider>
        </ConvexClerkProvider>
      </body>
    </html>
  );
}
