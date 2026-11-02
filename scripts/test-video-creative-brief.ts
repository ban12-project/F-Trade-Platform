import assert from "node:assert/strict";
import {
  assertMarketingCreativeReady,
  marketingVideoDraftSchema,
} from "../lib/video/edit-contracts";

const draft = marketingVideoDraftSchema.parse({
  version: 3,
  creativeFramework: "google_abcd",
  platform: "facebook",
  clips: [
    {
      clipId: "clip-001",
      assetRef: "asset-synthetic",
      mediaType: "image",
      trimStartMs: 0,
      durationMs: 6000,
      fitMode: "contain",
      audioMode: "muted",
      caption: { kind: "creative", text: "Contact our sales team" },
      abcdRoles: ["attention", "branding", "connection", "direction"],
      motionPreset: "cta_hold",
    },
  ],
  ctaText: "Contact our sales team",
});
assert.throws(() => assertMarketingCreativeReady(draft));
const brief = {
  objective: "action" as const,
  audience: "Distributors",
  buyerNeed: "Identify relevant products",
  nextAction: "Submit requirements to sales",
  platformAssumptions: "Silent viewing assumed; captions required",
  brandAssetRef: draft.clips[0]!.assetRef,
};
const ready = marketingVideoDraftSchema.parse({ ...draft, creativeBrief: brief });
assert.equal(assertMarketingCreativeReady(ready).audience, brief.audience);
assert.deepEqual(
  marketingVideoDraftSchema.parse(JSON.parse(JSON.stringify(ready))).creativeBrief,
  brief,
);
assert.throws(() =>
  assertMarketingCreativeReady({
    ...ready,
    creativeBrief: { ...brief, brandAssetRef: "asset-other" },
  }),
);
assert.throws(() =>
  assertMarketingCreativeReady({
    ...ready,
    creativeBrief: { ...brief, objective: "consideration" },
  }),
);
assert.throws(() =>
  assertMarketingCreativeReady({
    ...ready,
    clips: ready.clips.map((clip) => ({ ...clip, caption: { kind: "none" as const } })),
  }),
);
console.log("PASS creative brief persistence and objective/brand/connection guards");
