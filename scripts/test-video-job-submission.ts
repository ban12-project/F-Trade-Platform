import assert from "node:assert/strict";

import {
  videoAspectRatioSchema,
  videoCapabilitySchema,
  videoProviderIdSchema,
} from "../lib/video/provider-capabilities";
import { videoProviderModelSettingsFormSchema } from "../lib/video/provider-form-schemas";
import { videoJobIdempotencyKey, videoJobSubmissionSchema } from "../lib/video/submission";

const input = videoJobSubmissionSchema.parse({
  videoId: "00000000-0000-4000-8000-000000000801",
  provider: "google",
  modelId: "synthetic-video-801",
  requiredCapabilities: ["text-to-video"],
  aspectRatio: "9:16",
  durationSeconds: 5,
  resolution: "1080x1920",
  expectedCostCents: 300,
});
for (const provider of videoProviderIdSchema.options) {
  assert.equal(videoProviderModelSettingsFormSchema.shape.provider.parse(provider), provider);
  assert.equal(videoJobSubmissionSchema.parse({ ...input, provider }).provider, provider);
}
for (const aspectRatio of videoAspectRatioSchema.options)
  assert.equal(videoJobSubmissionSchema.parse({ ...input, aspectRatio }).aspectRatio, aspectRatio);
assert.deepEqual(
  videoJobSubmissionSchema.parse({ ...input, requiredCapabilities: videoCapabilitySchema.options })
    .requiredCapabilities,
  videoCapabilitySchema.options,
);
assert.equal(
  videoJobIdempotencyKey(input),
  videoJobIdempotencyKey({ ...input, requiredCapabilities: ["text-to-video"] }),
);
assert.throws(
  () => videoJobSubmissionSchema.parse({ ...input, expectedCostCents: 0 }),
  /too_small/,
);
assert.throws(
  () => videoJobSubmissionSchema.parse({ ...input, requiredCapabilities: [] }),
  /too_small/,
);
console.log("PASS reviewed video job submission schema and opaque idempotency key");
