import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  reactCompiler: true,
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
    serverActions: {
      bodySizeLimit: "26mb",
    },
    exposeTestingApiInProductionBuild:
      process.env.NEXT_ENABLE_TESTING_API === "1",
    turbopackRustReactCompiler: true,
  },
};

export default withWorkflow(nextConfig);
