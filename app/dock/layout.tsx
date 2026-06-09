import type { Metadata, Viewport } from "next";

// Standalone dockhand mobile layout — no admin shell, no agent bar.
// The app-shell short-circuits on /dock/* to render just this.
//
// Safe-area handling lives in the dock-shell component (not on a wrapper
// here), because a wrapper with `paddingTop: env(safe-area-inset-top)`
// pushes the sticky header AWAY from the device top — exactly the wrong
// place for a status-bar-aware header. Instead, the shell uses the
// safe-area inset to pad the *contents inside* the sticky header, and the
// FAB/footer use it for the bottom inset. Net effect: notch + home
// indicator are honored without losing edge-to-edge paint.

export const metadata: Metadata = {
  title: "Dock — Marina Stee",
  description:
    "Mobile dock view for marina staff. Check-ins, fuel, meters, rentals, time clock.",
  // black-translucent lets the page paint under the iOS status bar so
  // the dock surface really is edge-to-edge in standalone mode. The
  // shell paints its own dark canvas behind it.
  appleWebApp: {
    capable: true,
    title: "Marina",
    statusBarStyle: "black-translucent",
  },
};

// viewport-fit=cover unlocks env(safe-area-inset-*) on iOS notched
// devices. Without it, the dock view leaves a black bar at the top.
// user-scalable + maximumScale stay default-permissive (pinch-to-zoom
// on) for accessibility — boaters with reading glasses, sunlight, etc.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0c10" },
  ],
};

export default function DockLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-canvas">{children}</div>;
}
