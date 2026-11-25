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
  brandAssetRef: draft.clips[0].assetRef,
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

// Full-funnel objective requires >= 2 clips and at least one verified_fact caption.
assert.throws(
  () =>
    assertMarketingCreativeReady({
      ...ready,
      creativeBrief: { ...brief, objective: "full_funnel" },
    }),
  /全漏斗目标至少需要 2 个片段/,
);
const twoClipBase = marketingVideoDraftSchema.parse({
  version: 3,
  creativeFramework: "google_abcd",
  platform: "instagram",
  creativeBrief: { ...brief, objective: "full_funnel" },
  clips: [
    {
      clipId: "clip-001",
      assetRef: "asset-synthetic",
      mediaType: "image",
      trimStartMs: 0,
      durationMs: 4000,
      fitMode: "contain",
      audioMode: "muted",
      caption: { kind: "none" },
      abcdRoles: ["attention", "branding"],
      motionPreset: "hero_reveal",
    },
    {
      clipId: "clip-002",
      assetRef: "asset-other",
      mediaType: "image",
      trimStartMs: 0,
      durationMs: 4000,
      fitMode: "contain",
      audioMode: "muted",
      caption: { kind: "creative", text: "For distributor inquiries" },
      abcdRoles: ["connection", "direction"],
      motionPreset: "cta_hold",
    },
  ],
  ctaText: "Contact our sales team",
});
assert.throws(() => assertMarketingCreativeReady(twoClipBase), /已核实产品信息/);
const twoClipFullFunnel = marketingVideoDraftSchema.parse({
  ...twoClipBase,
  clips: [
    twoClipBase.clips[0],
    {
      ...twoClipBase.clips[1],
      caption: { kind: "verified_fact", claimRef: "product.product_name" },
    },
  ],
});
assert.equal(assertMarketingCreativeReady(twoClipFullFunnel).objective, "full_funnel");

// Action objective requires Connection context before Direction in multi-clip cuts.
assert.throws(
  () =>
    assertMarketingCreativeReady(
      marketingVideoDraftSchema.parse({
        ...twoClipFullFunnel,
        creativeBrief: { ...brief, objective: "action" },
        clips: [
          {
            ...twoClipFullFunnel.clips[0],
            abcdRoles: ["attention", "branding", "direction"],
          },
          {
            ...twoClipFullFunnel.clips[1],
            abcdRoles: ["connection", "direction"],
          },
        ],
      }),
    ),
  /先建立产品与需求上下文/,
);

// Shorts organic pacing allows Connection-first vertical cuts with organic Branding on clip 2.
const shortsDraft = marketingVideoDraftSchema.parse({
  version: 3,
  creativeFramework: "google_abcd",
  platform: "tiktok",
  creativeBrief: {
    ...brief,
    objective: "action",
    pacingMode: "shorts_organic",
    brandAssetRef: "asset-brand-clip",
  },
  clips: [
    {
      clipId: "clip-001",
      assetRef: "asset-synthetic",
      mediaType: "image",
      trimStartMs: 0,
      durationMs: 4000,
      fitMode: "cover",
      audioMode: "muted",
      caption: { kind: "verified_fact", claimRef: "product.product_name" },
      abcdRoles: ["connection", "attention"],
      motionPreset: "punch_in",
    },
    {
      clipId: "clip-002",
      assetRef: "asset-brand-clip",
      mediaType: "image",
      trimStartMs: 0,
      durationMs: 4000,
      fitMode: "contain",
      audioMode: "muted",
      caption: { kind: "creative", text: "Request product details" },
      abcdRoles: ["branding", "direction"],
      motionPreset: "cta_hold",
    },
  ],
  ctaText: "Contact our sales team",
});
assert.equal(assertMarketingCreativeReady(shortsDraft).pacingMode, "shorts_organic");
assert.throws(
  () =>
    marketingVideoDraftSchema.parse({
      ...shortsDraft,
      platform: "x",
    }),
  /竖屏短片叙事模式/,
);

console.log(
  "PASS creative brief persistence, full_funnel, shorts_organic, and objective/brand/connection guards",
);
