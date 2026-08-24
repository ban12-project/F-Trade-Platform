import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    exposeTestingApiInProductionBuild:
      process.env.NEXT_ENABLE_TESTING_API === "1",
  },
};

export default nextConfig;
