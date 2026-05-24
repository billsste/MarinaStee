import type { MetadataRoute } from "next";

// Marina Stee web app manifest.
// Installable from any mobile browser → adds to home screen → standalone mode.
// Dock view is the primary install target for marina staff.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Marina Stee",
    short_name: "Marina Stee",
    description:
      "Agent-native marina management. Slips, boaters, ledger, POS — orchestrated by a single agent.",
    start_url: "/dock",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fafafa",
    theme_color: "#0d9488",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [
      {
        name: "Check in",
        short_name: "Check in",
        url: "/dock?tile=arrivals",
      },
      {
        name: "Fuel sale",
        short_name: "Fuel",
        url: "/dock?tile=fuel",
      },
      {
        name: "Log meter",
        short_name: "Meter",
        url: "/dock?tile=meter",
      },
    ],
  };
}
