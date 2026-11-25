import assert from "node:assert/strict";

import { buildMarketingAssDocument } from "../lib/video/ass-subtitles";
import { renderApprovedMarketingTimeline } from "../lib/video/rendering";

void (async () => {
  const timeline = {
    durationSeconds: 5,
    scenes: [
      {
        sceneId: "scene-001",
        assetRef: "asset-video-901",
        startSeconds: 0,
        durationSeconds: 5,
        prompt: "真实产品素材",
        claimRefs: [],
        subtitles: [],
      },
    ],
  };
  const result = await renderApprovedMarketingTimeline(
    { timeline, platform: "tiktok", width: 1080, height: 1920, fps: 30 },
    {
      async render(request) {
        assert.equal(request.platform, "tiktok");
        return { assetRef: "asset-rendered-901" };
      },
    },
  );
  assert.equal(result.assetRef, "asset-rendered-901");
  await assert.rejects(
    () =>
      renderApprovedMarketingTimeline(
        {
          timeline: { ...timeline, durationSeconds: 4 },
          platform: "tiktok",
          width: 1080,
          height: 1920,
          fps: 30,
        },
        {
          async render() {
            return { assetRef: "asset-rendered-901" };
          },
        },
      ),
    /时间线/,
  );
  await assert.rejects(
    () =>
      renderApprovedMarketingTimeline(
        { timeline, platform: "tiktok", width: 1080, height: 1920, fps: 30 },
        {
          async render() {
            return { assetRef: "https://example.com/public.mp4" };
          },
        },
      ),
    /Invalid string/,
  );

  const ass = buildMarketingAssDocument({
    timeline: {
      durationSeconds: 6,
      scenes: [
        {
          sceneId: "scene-001",
          assetRef: "asset-video-901",
          startSeconds: 0,
          durationSeconds: 6,
          prompt: "真实产品素材",
          claimRefs: [],
          subtitles: [
            {
              text: "Verified product detail",
              startSeconds: 0,
              endSeconds: 6,
              claimRefs: [],
            },
          ],
        },
      ],
      cta: { text: "Contact our sales team", startSeconds: 4, endSeconds: 6 },
    },
    platform: "tiktok",
    width: 1080,
    height: 1920,
    fps: 30,
  });
  assert.ok(ass.includes("Style: CTA,Noto Sans,"), "CTA style must exist");
  assert.equal(ass.includes(",5,80,80,80,1"), false, "CTA must not use center Alignment=5");
  assert.ok(ass.includes(",0,0,0,,Verified product detail") && ass.includes("CaptionAboveCta"));
  assert.ok(
    ass.includes("Dialogue: 0,0:00:00.00,0:00:04.00,Caption,,0,0,0,,Verified product detail"),
  );
  assert.ok(
    ass.includes(
      "Dialogue: 0,0:00:04.00,0:00:06.00,CaptionAboveCta,,0,0,0,,Verified product detail",
    ),
  );
  assert.ok(ass.includes("Dialogue: 1,0:00:04.00,0:00:06.00,CTA,,0,0,0,,Contact our sales team"));

  console.log("PASS rendering boundary and non-competing ASS subtitle layout verified");
})();
