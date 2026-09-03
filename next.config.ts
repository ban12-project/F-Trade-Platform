import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
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
    exposeTestingApiInProductionBuild:
      process.env.NEXT_ENABLE_TESTING_API === "1",
    turbopackRustReactCompiler: true,
  },
};

export default withWorkflow(nextConfig);
