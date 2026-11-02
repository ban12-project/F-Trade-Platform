import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const browserLayer = process.env.PLAYWRIGHT_LAYER;
if (browserLayer && !["ui", "database"].includes(browserLayer))
  throw new Error("Unknown Playwright layer");

const nextConfig: NextConfig = {
  distDir: browserLayer ? `.next-playwright-${browserLayer}` : ".next",
  typescript: browserLayer ? { tsconfigPath: `.tsconfig-playwright-${browserLayer}.json` } : {},
  allowedDevOrigins: ["127.0.0.1"],
  cacheComponents: true,
  reactCompiler: true,
  outputFileTracingIncludes: {
    "/.well-known/workflow/v1/*": [".remotion/**/*"],
  },
  async redirects() {
    return [
      {
        source: "/admin/:path*",
        destination: "/workspace",
        permanent: true,
      },
    ];
  },
  experimental: {
    exposeTestingApiInProductionBuild: process.env.NEXT_ENABLE_TESTING_API === "1",
    turbopackRustReactCompiler: true,
  },
};

export default withWorkflow(nextConfig);
