import assert from "node:assert/strict";
import reviews from "../docs/testing/reports/meta-rule-source-review-20260926.json";
import { videoExportPresets } from "../lib/video/export-presets";
import { videoRuleSourceReviewSchema } from "../lib/video/rule-source-review";

const parsed = videoRuleSourceReviewSchema.array().parse(reviews);
assert.equal(new Set(parsed.map((review) => review.platform)).size, 2);
for (const review of parsed) {
  const preset = videoExportPresets.find((candidate) => candidate.platform === review.platform);
  assert.ok(preset);
  assert.equal(preset.availability, "enabled");
  assert.deepEqual(review.projectPreset, {
    version: preset.version,
    minDurationSeconds: preset.minDurationSeconds,
    maxDurationSeconds: preset.maxDurationSeconds,
  });
  assert.equal(review.sourceApplicability, "unverified");
  assert.equal(review.platformAcceptance, "not_evaluated");
  // Readable references and enabled rendering never turn unresolved rules into a pass.
  for (const patch of [
    { sourceApplicability: "passed" },
    { platformAcceptance: "passed" },
    { unresolved: [] },
    { availability: "enabled" },
    { measurements: { ...review.measurements, missingValue: 0 } },
    { measurements: { ...review.measurements, peakBitrateBps: "measured" } },
  ])
    assert.equal(videoRuleSourceReviewSchema.safeParse({ ...review, ...patch }).success, false);
}
const facebook = parsed.find((review) => review.platform === "facebook");
assert.ok(facebook);
assert.equal(facebook.projectPublishingScope.path, "facebook_profile_browser");
assert.equal(facebook.sources.find((source) => source.kind === "vendor_sample")?.ruleVersion, null);
assert.equal(
  videoRuleSourceReviewSchema.safeParse({
    ...facebook,
    projectPublishingScope: { ...facebook.projectPublishingScope, apiVersion: "v99.0" },
  }).success,
  false,
);
const instagram = parsed.find((review) => review.platform === "instagram");
assert.ok(instagram);
assert.equal(
  videoRuleSourceReviewSchema.safeParse({
    ...instagram,
    projectPublishingScope: {
      ...instagram.projectPublishingScope,
      accountCategory: "personal_profile",
    },
  }).success,
  false,
);
console.log(
  "PASS independent source review: readable is not applicable, sample revision is not API version, enabled presets do not certify unknown platform rules",
);
