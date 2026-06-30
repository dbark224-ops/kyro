import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb"
    }
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
