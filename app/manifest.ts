import type { MetadataRoute } from "next";

// Marina Stee web app manifest.
// Installable from any mobile browser → adds to home screen → standalone mode.
// Dock view is the primary install target for marina staff.
//
// Spec hygiene:
//   - `id` pins the install identity so the OS doesn't treat /dock vs /
//     as different installable apps after a redirect.
//   - `display_override` falls back gracefully: window-controls-overlay
//     on desktop PWA, standalone on iOS/Android, browser as last resort.
//   - Icons published twice — `any` for the OS launcher mask and
//     `maskable` for Android's adaptive-icon framing. Skipping `any`
//     made the icon look corner-clipped in Chrome's install card.

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/dock",
    name: "Marina Stee — Dock",
    short_name: "Marina",
    description:
      "Agent-native marina ops. Check-ins, fuel, meters, rentals — from the dock.",
    start_url: "/dock",
    scope: "/",
    lang: "en-US",
    dir: "ltr",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "browser"],
    orientation: "portrait",
    // Nantucket palette — deepened Soft Navy splash + Hydrangea theme.
    background_color: "#1F2A38",
    theme_color: "#7E9BB8",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
    // PWA manifest shortcuts — surfaced from the OS launcher icon's
    // long-press / right-click menu. Each entry deep-links straight into
    // a Dock sub-view via ?tile=… (handled by useSearchParams effect in
    // app/dock/page.tsx) so a dockhand opens the app already on the
    // right task instead of going through Home → tile → form.
    //
    // Spec hygiene:
    //   - `description` is shown by some launchers (desktop PWAs, Android)
    //     under the shortcut name; keep it operator-readable, not marketing.
    //   - `icons` are technically optional but Android/Chrome render a
    //     placeholder square when omitted. Reuse the generated /icon at
    //     96×96 — the spec minimum — to avoid asset bloat.
    //   - Keep the list ≤ ~4 shortcuts; some OSes truncate past that.
    shortcuts: [
      {
        name: "Check in arrivals",
        short_name: "Check in",
        description: "Jump to today's arrivals queue and check a boater in.",
        url: "/dock?tile=arrivals",
        icons: [{ src: "/icon", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "Quick fuel sale",
        short_name: "Fuel",
        description: "Record a fuel sale and charge to a boater's account.",
        url: "/dock?tile=fuel",
        icons: [{ src: "/icon", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "Log meter reading",
        short_name: "Meter",
        description: "Log a slip's pedestal kWh reading from the dock.",
        url: "/dock?tile=meter",
        icons: [{ src: "/icon", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "Close a rental",
        short_name: "Returns",
        description: "Close out a rental boat returning to the dock.",
        url: "/dock?tile=returns",
        icons: [{ src: "/icon", sizes: "96x96", type: "image/png" }],
      },
    ],
  };
}
