import assert from "node:assert/strict";
import { videoModelCapabilitySchema } from "../lib/video/provider-capabilities";
import { saveVideoProviderModelSettingsSchema } from "../lib/video/provider-config-store";

const model = {
  provider: "fal" as const,
  modelId: "synthetic-fal-video-701",
  capabilities: ["text-to-video" as const],
  aspectRatios: ["9:16" as const],
  durationSeconds: { min: 1, max: 10 },
  resolutions: ["1080x1920"],
  verifiedAt: new Date("2026-08-28T00:00:00Z"),
  verificationRef: "evidence-provider-701",
  enabled: true,
};

assert.equal(
  saveVideoProviderModelSettingsSchema.parse({
    provider: "fal",
    providerEnabled: true,
    credential: "synthetic-secret",
    clearCredential: false,
    maximumConcurrentJobs: 1,
    maximumAttempts: 3,
    budgetLimitCents: 5000,
    budgetCommittedCents: 0,
    runtimeSettings: {},
    model,
    actorId: "synthetic-admin",
  }).model.modelId,
  model.modelId,
);
assert.throws(
  () =>
    saveVideoProviderModelSettingsSchema.parse({
      provider: "google",
      providerEnabled: false,
      clearCredential: false,
      maximumConcurrentJobs: 1,
      maximumAttempts: 3,
      budgetLimitCents: 5000,
      budgetCommittedCents: 0,
      runtimeSettings: {},
      model,
      actorId: "synthetic-admin",
    }),
  /模型必须属于/,
);
assert.throws(
  () =>
    videoModelCapabilitySchema.parse({
      ...model,
      verifiedAt: new Date("2099-01-01T00:00:00Z"),
      enabled: false,
    }),
  /不能在未来/,
);

console.log("PASS video provider settings reject mismatched or future-unverified configuration");
