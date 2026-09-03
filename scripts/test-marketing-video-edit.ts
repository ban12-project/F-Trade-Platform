import assert from "node:assert/strict";

import type { VideoProject } from "../lib/video/contracts";
import { marketingVideoAiDraftSchema, marketingVideoDraftSchema } from "../lib/video/edit-contracts";
import { renderApprovedMarketingTimeline } from "../lib/video/rendering";
import { compileMarketingVideoAiDraft, type MarketingShotCandidate } from "../lib/video/shot-candidates";
import { createMarketingEditTimeline } from "../lib/video/timeline";

const baseClip = {
  clipId: "clip-001",
  assetRef: "evidence-source-001",
  mediaType: "video" as const,
  trimStartMs: 0,
  durationMs: 10_000,
  fitMode: "cover" as const,
  audioMode: "muted" as const,
  caption: { kind: "verified_fact" as const, claimRef: "product.oe_number" },
};
const aiBaseClip = {
  shotCandidateId: "shot-001-001",
  durationMs: 2_000,
  fitMode: "contain" as const,
  audioMode: "muted" as const,
};
const exact = marketingVideoDraftSchema.parse({ version: 2, platform: "facebook", clips: [baseClip, { ...baseClip, clipId: "clip-002", durationMs: 5_000 }], ctaText: "Contact us" });
const { caption: _caption, ...legacyBaseClip } = baseClip;
assert.equal(exact.clips.reduce((sum, clip) => sum + clip.durationMs, 0), 15_000);
assert.throws(() => marketingVideoDraftSchema.parse({ ...exact, clips: [baseClip, { ...baseClip, clipId: "clip-002", durationMs: 5_001 }] }), /15 秒/);
assert.throws(() => marketingVideoDraftSchema.parse({ ...exact, clips: [{ ...baseClip, durationMs: 10_001 }] }), /10 秒/);
assert.throws(() => marketingVideoDraftSchema.parse({ ...exact, clips: [{ ...baseClip, mediaType: "image", trimStartMs: 1 }] }), /图片素材/);

const legacy = marketingVideoDraftSchema.parse({
  version: 1,
  platform: "facebook",
  clips: [{ ...legacyBaseClip, subtitle: "Incorrect OE 99999", claimRefs: ["product.oe_number"] }],
  ctaText: "Contact us",
});
assert.equal(legacy.version, 2);
assert.deepEqual(legacy.clips[0]?.caption, { kind: "verified_fact", claimRef: "product.oe_number" });
assert.throws(() => marketingVideoDraftSchema.parse({
  version: 1,
  platform: "facebook",
  clips: [{ ...legacyBaseClip, subtitle: "Ambiguous facts", claimRefs: ["product.oe_number", "commercial.moq"] }],
  ctaText: "Contact us",
}), /多个事实/);
assert.equal(marketingVideoAiDraftSchema.safeParse({
  clips: [{ ...legacyBaseClip, subtitle: "Incorrect OE 99999", claimRefs: ["product.oe_number"] }],
  ctaText: "Contact us",
}).success, false);
assert.equal(marketingVideoAiDraftSchema.safeParse({
  clips: [{ ...aiBaseClip, assetRef: "evidence-source-001", trimStartMs: 999 }],
  ctaText: "Contact our sales team",
}).success, false);

assert.equal(marketingVideoAiDraftSchema.safeParse({
  clips: [{ ...aiBaseClip, caption: { kind: "creative", text: "Built with ten splines" } }],
  ctaText: "Contact our sales team",
}).success, false);
assert.equal(marketingVideoAiDraftSchema.safeParse({
  clips: [{ ...aiBaseClip, caption: { kind: "creative", text: "For distributor inquiries" } }],
  ctaText: "Request product details",
}).success, true);
assert.equal(marketingVideoAiDraftSchema.safeParse({
  clips: [{ ...aiBaseClip, caption: { kind: "verified_fact", claimRef: "product.oe_number" } }],
  ctaText: "Start a distributor inquiry",
}).success, true);
for (const text of ["OE 99999", "Diameter 300 mm", "Spline 10", "MOQ 1", "Lead time 7 days"]) {
  assert.equal(marketingVideoAiDraftSchema.safeParse({
    clips: [{ ...aiBaseClip, caption: { kind: "creative", text } }],
    ctaText: "Contact our sales team",
  }).success, false);
}
assert.throws(() => marketingVideoDraftSchema.parse({ ...exact, ctaText: "MOQ 1" }), /核验事实/);

const shotCandidates: MarketingShotCandidate[] = [{
  id: "shot-001-001",
  assetRef: "evidence-source-001",
  mediaType: "video",
  trimStartMs: 4_000,
  maximumDurationMs: 3_000,
}];
const aiSuggestion = marketingVideoAiDraftSchema.parse({
  clips: [{ ...aiBaseClip, caption: { kind: "verified_fact", claimRef: "product.oe_number" } }],
  ctaText: "Contact our sales team",
});
const compiledAiDraft = compileMarketingVideoAiDraft({ suggestion: aiSuggestion, candidates: shotCandidates, platform: "facebook" });
assert.equal(compiledAiDraft.clips[0]?.assetRef, "evidence-source-001");
assert.equal(compiledAiDraft.clips[0]?.trimStartMs, 4_000);
assert.throws(() => compileMarketingVideoAiDraft({ suggestion: { ...aiSuggestion, clips: [{ ...aiSuggestion.clips[0]!, shotCandidateId: "shot-999-999" }] }, candidates: shotCandidates, platform: "facebook" }), /未知候选镜头/);
assert.throws(() => compileMarketingVideoAiDraft({ suggestion: { ...aiSuggestion, clips: [{ ...aiSuggestion.clips[0]!, durationMs: 3_001 }] }, candidates: shotCandidates, platform: "facebook" }), /可用时长/);
assert.throws(() => compileMarketingVideoAiDraft({ suggestion: { ...aiSuggestion, clips: [aiSuggestion.clips[0]!, aiSuggestion.clips[0]!] }, candidates: shotCandidates, platform: "facebook" }), /重复选择/);
assert.throws(() => compileMarketingVideoAiDraft({
  suggestion: { ...aiSuggestion, clips: [{ ...aiSuggestion.clips[0]!, audioMode: "source" }] },
  candidates: [{ ...shotCandidates[0]!, mediaType: "image", trimStartMs: 0, maximumDurationMs: 10_000 }],
  platform: "facebook",
}), /图片候选镜头/);

const project: VideoProject = {
  id: "00000000-0000-4000-8000-000000000501", productId: "00000000-0000-4000-8000-000000000502", status: "draft",
  objective: "Inquiry", targetAudience: "Distributor", platforms: ["facebook"],
  factualClaims: [{ field: "product.oe_number", value: "12345", evidenceRef: "evidence-product-501" }],
  sourceAssets: [{ assetRef: "evidence-source-001", mediaType: "video", rightsEvidenceRef: "evidence-rights-501" }],
  scenes: [{ sceneId: "scene-001", prompt: "Authorized source", durationSeconds: 10, claimRefs: [], assetRefs: ["evidence-source-001"] }], approvalRefs: [], editDraft: marketingVideoDraftSchema.parse({ version: 2, platform: "facebook", clips: [baseClip], ctaText: "Contact us" }),
};

void (async () => {
  const timeline = createMarketingEditTimeline(project, project.editDraft!);
  assert.equal(timeline.durationSeconds, 10);
  assert.equal(timeline.scenes[0]?.trimStartSeconds, 0);
  assert.equal(timeline.scenes[0]?.subtitles[0]?.text, "12345");
  assert.deepEqual(timeline.scenes[0]?.subtitles[0]?.claimRefs, ["product.oe_number"]);
  assert.equal(timeline.cta?.startSeconds, 8);
  assert.throws(() => createMarketingEditTimeline(project, { ...project.editDraft!, clips: [{ ...baseClip, caption: { kind: "verified_fact", claimRef: "specifications.diameter" } }] }), /未绑定证据/);
  await assert.rejects(() => renderApprovedMarketingTimeline({ timeline: { ...timeline, durationSeconds: 16, scenes: [{ ...timeline.scenes[0]!, durationSeconds: 16 }] }, platform: "facebook", width: 1080, height: 1920, fps: 30 }, { async render() { return { assetRef: "asset-invalid" }; } }), /15 秒/);
  console.log("PASS MVP1 marketing edit compiles verified captions server-side and enforces 15 seconds");
})();
