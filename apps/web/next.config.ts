import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb"
    }
  },
  async redirects() {
    return [
      {
        destination: "/waitlist",
        permanent: false,
        source: "/create-account",
      },
    ];
  },
  transpilePackages: [
    "@kyro/ai",
    "@kyro/api",
    "@kyro/contracts",
    "@kyro/core",
    "@kyro/db",
    "@kyro/jobs"
  ]
};

export default nextConfig;
