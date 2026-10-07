import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@repo/ui",
    "@repo/astra-core",
    "@repo/volt-core",
    "@repo/tensorgrid-core",
    "@repo/pulse-core",
    "@repo/tracelens-core",
  ],
};

export default nextConfig;
