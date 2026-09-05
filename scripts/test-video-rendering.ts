import assert from "node:assert/strict";

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
  console.log("PASS rendering boundary accepts only coherent private marketing timelines");
})();
