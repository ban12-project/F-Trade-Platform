import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    exposeTestingApiInProductionBuild:
      process.env.NEXT_ENABLE_TESTING_API === "1",
  },
};

export default withWorkflow(nextConfig);
