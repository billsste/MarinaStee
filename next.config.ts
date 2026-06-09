import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for production Docker images. The build emits a
  // self-contained .next/standalone tree that the runner stage copies
  // directly — no node_modules in the final image, ~60% smaller.
  // Local `next dev` is unaffected (standalone only applies to `next build`).
  output: "standalone",
  // Nginx-equivalent: serve `public/` directly. Without this, Next.js
  // tries to optimize remote images at request time, which both burns
  // CPU on the droplet and requires Sharp at runtime.
  images: { unoptimized: true },
  async redirects() {
    // Legacy URL redirects after the IA renames:
    //   /rentals → /slips → /services      (Rentals → Slips umbrella → Services umbrella)
    //   /docks   → /slips → /services      (intermediate Docks rename)
    //   /rentals/spaces → /services/roster (Spaces → Roster sub-tab)
    //   /docks/slips    → /services/roster
    //   /boaters → /holders → /members
    //   /holders → /members
    return [
      // /rentals/spaces lineage
      {
        source: "/rentals/spaces/:path*",
        destination: "/services/roster/:path*",
        permanent: true,
      },
      {
        source: "/rentals/spaces",
        destination: "/services/roster",
        permanent: true,
      },
      // /docks/slips intermediate lineage
      {
        source: "/docks/slips/:path*",
        destination: "/services/roster/:path*",
        permanent: true,
      },
      {
        source: "/docks/slips",
        destination: "/services/roster",
        permanent: true,
      },
      // /slips → /services (latest rename; /slips became the umbrella's
      // own intermediate name before Services landed)
      {
        source: "/slips/:path*",
        destination: "/services/:path*",
        permanent: true,
      },
      {
        source: "/slips",
        destination: "/services",
        permanent: true,
      },
      // /rentals/* and /docks/* → /services/*
      {
        source: "/rentals/:path*",
        destination: "/services/:path*",
        permanent: true,
      },
      {
        source: "/rentals",
        destination: "/services",
        permanent: true,
      },
      {
        source: "/docks/:path*",
        destination: "/services/:path*",
        permanent: true,
      },
      {
        source: "/docks",
        destination: "/services",
        permanent: true,
      },
      // Boaters → Holders → Members
      {
        source: "/boaters/:path*",
        destination: "/members/:path*",
        permanent: true,
      },
      {
        source: "/boaters",
        destination: "/members",
        permanent: true,
      },
      {
        source: "/holders/:path*",
        destination: "/members/:path*",
        permanent: true,
      },
      {
        source: "/holders",
        destination: "/members",
        permanent: true,
      },
    ];
  },
  async headers() {
    // SECURITY: tighten Referrer-Policy on the magic-link surfaces.
    // /apply/[token] + /apply/waitlist/[token] + /portal/[token] all
    // carry the auth token in the URL. If the holder clicks an
    // external link from these pages (or a browser extension reads
    // history with Referer-attached requests), the token leaks. The
    // applicant-safe projection from convex/applications.lookupByToken
    // limits the blast radius, but a clean Referer policy closes the
    // leak path entirely.
    //
    // `no-referrer` = no Referer header at all on outgoing requests
    // from these pages. Same-origin Next.js navigation is unaffected
    // (Next uses its own router, not browser navigation, for in-app
    // links).
    return [
      {
        source: "/apply/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/portal/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/onboard/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/sign/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/coi-upload/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
