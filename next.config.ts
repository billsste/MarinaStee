import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // Legacy URL redirects after Batch C IA rename:
    // /rentals → /docks (covers /rentals/*)
    // /rentals/spaces → /docks/slips
    // /boaters → /holders (covers /boaters/*)
    return [
      {
        source: "/rentals/spaces/:path*",
        destination: "/docks/slips/:path*",
        permanent: true,
      },
      {
        source: "/rentals/:path*",
        destination: "/docks/:path*",
        permanent: true,
      },
      {
        source: "/rentals",
        destination: "/docks",
        permanent: true,
      },
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
