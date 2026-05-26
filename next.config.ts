import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // Legacy URL redirects after the IA renames:
    //   /rentals → /slips      (Rentals → Slips umbrella)
    //   /docks   → /slips      (intermediate Docks rename, now reverted)
    //   /rentals/spaces → /slips/roster   (Spaces → Slips → Roster sub-tab)
    //   /docks/slips    → /slips/roster
    //   /boaters → /holders    (Boaters → Slip Holders)
    return [
      // /rentals/spaces lineage
      {
        source: "/rentals/spaces/:path*",
        destination: "/slips/roster/:path*",
        permanent: true,
      },
      {
        source: "/rentals/spaces",
        destination: "/slips/roster",
        permanent: true,
      },
      // /docks/slips intermediate lineage
      {
        source: "/docks/slips/:path*",
        destination: "/slips/roster/:path*",
        permanent: true,
      },
      {
        source: "/docks/slips",
        destination: "/slips/roster",
        permanent: true,
      },
      // /rentals/* and /docks/* → /slips/*
      {
        source: "/rentals/:path*",
        destination: "/slips/:path*",
        permanent: true,
      },
      {
        source: "/rentals",
        destination: "/slips",
        permanent: true,
      },
      {
        source: "/docks/:path*",
        destination: "/slips/:path*",
        permanent: true,
      },
      {
        source: "/docks",
        destination: "/slips",
        permanent: true,
      },
      // Boaters → Holders
      {
        source: "/boaters/:path*",
        destination: "/holders/:path*",
        permanent: true,
      },
      {
        source: "/boaters",
        destination: "/holders",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
