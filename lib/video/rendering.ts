import { z } from "zod";

import type { MarketingTimeline } from "./timeline";

const privateAssetRef = z.string().trim().regex(/^asset-[a-z0-9][a-z0-9_-]{2,120}$/i);

export type VideoRenderRequest = {
  timeline: MarketingTimeline;
  platform: "tiktok" | "youtube" | "instagram" | "facebook" | "x";
  width: number;
  height: number;
  fps: number;
};

export type VideoRenderer = {
  render(request: VideoRenderRequest): Promise<{ assetRef: string }>;
};

/**
 * Worker-only boundary for deterministic assembly. It never accepts URLs,
 * public destinations, model credentials, or free-form product facts.
 */
export async function renderApprovedMarketingTimeline(
  request: VideoRenderRequest,
  renderer: VideoRenderer,
) {
  if (!Number.isInteger(request.width) || !Number.isInteger(request.height) || request.width < 1 || request.height < 1) {
    throw new Error("渲染尺寸无效。 ");
  }
  if (!Number.isInteger(request.fps) || request.fps < 1 || request.fps > 120) throw new Error("渲染帧率无效。 ");
  if (!request.timeline.scenes.length || request.timeline.durationSeconds <= 0) throw new Error("没有可渲染的已审核镜头。 ");
  if (request.timeline.durationSeconds > 15) throw new Error("整条营销视频不能超过 15 秒。 ");
  const expectedEnd = request.timeline.scenes.at(-1)!.startSeconds + request.timeline.scenes.at(-1)!.durationSeconds;
  if (Math.abs(expectedEnd - request.timeline.durationSeconds) > 0.001) throw new Error("剪辑时间线不连续或总时长不一致。 ");
  const output = await renderer.render(request);
  return { assetRef: privateAssetRef.parse(output.assetRef) };
}
