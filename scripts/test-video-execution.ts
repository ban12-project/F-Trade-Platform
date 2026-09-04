import assert from "node:assert/strict";

import { submitVideoGeneration, type VideoGenerationAdapter } from "../lib/video/execution";

const project = {
  id: "00000000-0000-4000-8000-000000000301",
  productId: "00000000-0000-4000-8000-000000000302",
  status: "review_required" as const,
  objective: "Synthetic introduction",
  targetAudience: "Synthetic distributor",
  platforms: ["youtube"] as Array<"youtube">,
  factualClaims: [
    {
      field: "product.product_name",
      value: "Synthetic clutch",
      evidenceRef: "evidence-product-301",
    },
  ],
  sourceAssets: [
    {
      assetRef: "asset-product-301",
      mediaType: "image" as const,
      rightsEvidenceRef: "evidence-rights-301",
    },
  ],
  scenes: [
    {
      sceneId: "scene-301",
      prompt: "Show only the approved synthetic product image.",
      durationSeconds: 5,
      claimRefs: ["product.product_name"],
      assetRefs: ["asset-product-301"],
    },
  ],
  approvalRefs: [],
};
const generation = {
  provider: "google" as const,
  modelId: "synthetic-video-301",
  requiredCapabilities: ["text-to-video" as const],
  aspectRatio: "16:9" as const,
  durationSeconds: 5,
  resolution: "1280x720",
};
const catalog = [
  {
    provider: "google" as const,
    modelId: "synthetic-video-301",
    capabilities: ["text-to-video" as const],
    aspectRatios: ["16:9" as const],
    durationSeconds: { min: 1, max: 10 },
    resolutions: ["1280x720"],
    verifiedAt: new Date("2026-08-28T00:00:00Z"),
    verificationRef: "evidence-provider-301",
    enabled: true,
  },
];
const adapter: VideoGenerationAdapter = {
  provider: "google",
  async submit(request) {
    assert.equal(request.credential, "synthetic-secret");
    return { providerJobRef: "provider-job-301", resultAssetRef: "asset-video-301" };
  },
};
const dependencies = {
  catalog,
  policies: [
    {
      provider: "google",
      enabled: true,
      credentialRef: "credential-google-301",
      maximumConcurrentJobs: 1,
      maximumAttempts: 2,
      budgetLimitCents: 500,
      budgetCommittedCents: 100,
    },
  ],
  adapters: [adapter],
  activeJobsByProvider: {},
  resolveCredential: async () => "synthetic-secret",
};

async function main() {
  const result = await submitVideoGeneration(
    { project, generation, expectedCostCents: 100 },
    dependencies,
  );
  assert.deepEqual(result, {
    providerJobRef: "provider-job-301",
    resultAssetRef: "asset-video-301",
  });
  await assert.rejects(
    () => submitVideoGeneration({ project, generation, expectedCostCents: 401 }, dependencies),
    /预算上限/,
  );
  await assert.rejects(
    () =>
      submitVideoGeneration(
        { project, generation, expectedCostCents: 100 },
        { ...dependencies, activeJobsByProvider: { google: 1 } },
      ),
    /并发配额/,
  );
  await assert.rejects(
    () =>
      submitVideoGeneration(
        { project, generation, expectedCostCents: 100 },
        { ...dependencies, adapters: [] },
      ),
    /适配器/,
  );
  console.log(
    "PASS video execution rejects unsafe configuration and submits a private-asset result",
  );
}

void main();
