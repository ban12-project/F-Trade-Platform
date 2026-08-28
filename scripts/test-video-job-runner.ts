import assert from "node:assert/strict";

import { classifyVideoJobFailure, executeLeasedVideoJob, retryVideoJobAt, runNextConfiguredVideoJob } from "../lib/video/job-runner";
import type { VideoProject } from "../lib/video/contracts";

async function main() {
  assert.equal(typeof runNextConfiguredVideoJob, "function");
  const job = { id: "job-901", provider: "google", modelId: "synthetic-video-901", requiredCapabilities: ["text-to-video"], aspectRatio: "9:16", durationSeconds: 5, resolution: "1080x1920", expectedCostCents: 200, reservedCostCents: 200 } as never;
  const project: VideoProject = { id: "00000000-0000-4000-8000-000000000901", productId: "00000000-0000-4000-8000-000000000902", status: "approved", objective: "Synthetic objective", targetAudience: "Synthetic audience", platforms: ["tiktok"], factualClaims: [{ field: "product.name", value: "Synthetic", evidenceRef: "evidence-product-901" }], sourceAssets: [], scenes: [{ sceneId: "scene-901", prompt: "Synthetic prompt", durationSeconds: 5, claimRefs: ["product.name"], assetRefs: [] }], approvalRefs: ["approval-901"] };
  const catalog = [{ provider: "google" as const, modelId: "synthetic-video-901", capabilities: ["text-to-video" as const], aspectRatios: ["9:16" as const], durationSeconds: { min: 1, max: 10 }, resolutions: ["1080x1920"], verifiedAt: new Date("2026-08-28T00:00:00Z"), verificationRef: "evidence-provider-901", enabled: true }];
  const policies = [{ provider: "google", enabled: true, credentialRef: "video-provider:google", maximumConcurrentJobs: 1, maximumAttempts: 3, budgetLimitCents: 1000, budgetCommittedCents: 200 }];
  const result = await executeLeasedVideoJob(job, "google", { project, catalog, policies, adapters: [{ provider: "google", async submit(request) { assert.equal(request.credential, "synthetic-secret"); return { resultAssetRef: "asset-video-901" }; } }], resolveCredential: async () => "synthetic-secret" });
  assert.equal(result.result.resultAssetRef, "asset-video-901");
  assert.equal(result.maximumAttempts, 3);
  assert.equal(classifyVideoJobFailure(new Error("retryable: temporary provider fault")), "provider_retryable");
  assert.ok(retryVideoJobAt(new Error("retryable: temporary provider fault"), 1));
  assert.equal(retryVideoJobAt(new Error("invalid request"), 1), undefined);
  console.log("PASS video job runner executes a leased synthetic request and classifies retry behavior");
}

void main();
