import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AppShell } from "@/components/app-shell";
import { ServiceWorkerRegister } from "@/components/service-worker-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Marina Stee — Admin",
  description:
    "Agent-native marina management. Slips, boaters, ledger, POS — orchestrated by a single agent.",
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#050608" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/*
         * Pre-hydration theme bootstrap. Runs before React paints so the
         * correct class lands on <html> immediately (no FOUC). Replaces the
         * inline script next-themes used to inject — which React 19 warns
         * against inside the component tree.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('marina-stee-theme');if(!t){t='dark';}var r=document.documentElement;r.classList.remove('light','dark');r.classList.add(t);}catch(e){document.documentElement.classList.add('dark');}})();",
          }}
        />
      </head>
      <body className="min-h-full">
        <ThemeProvider defaultTheme="dark">
          <AppShell>{children}</AppShell>
          <ServiceWorkerRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
