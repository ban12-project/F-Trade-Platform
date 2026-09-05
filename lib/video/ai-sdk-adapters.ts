import { createAlibaba } from "@ai-sdk/alibaba";
import { createByteDance } from "@ai-sdk/bytedance";
import { createFal } from "@ai-sdk/fal";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGoogleVertex } from "@ai-sdk/google-vertex";
import { createKlingAI } from "@ai-sdk/klingai";
import { createReplicate } from "@ai-sdk/replicate";
import { createXai } from "@ai-sdk/xai";
import { experimental_generateVideo } from "ai";
import { z } from "zod";

import type { VideoGenerationAdapter, VideoGenerationAdapterRequest } from "./execution";
import type { VideoProviderId } from "./provider-capabilities";

const privateAssetRef = z
  .string()
  .trim()
  .regex(/^asset-[a-z0-9][a-z0-9_-]{2,120}$/i);

export type PrivateVideoAssetStore = {
  putGeneratedVideo(input: {
    data: Uint8Array;
    contentType: string;
    provider: VideoProviderId;
    modelId: string;
  }): Promise<string>;
};

export type AiSdkVideoAdapterSettings = {
  /** Non-secret deployment settings. Credentials are resolved per request. */
  googleVertex?: { project: string; location: string };
};

function createVideoModel(
  request: VideoGenerationAdapterRequest,
  settings: AiSdkVideoAdapterSettings,
) {
  const modelId = request.model.modelId as never;
  switch (request.provider) {
    case "alibaba":
      return createAlibaba({ apiKey: request.credential }).video(modelId);
    case "bytedance":
      return createByteDance({ apiKey: request.credential }).video(modelId);
    case "fal":
      return createFal({ apiKey: request.credential }).video(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey: request.credential }).video(modelId);
    case "google-vertex": {
      const vertex = settings.googleVertex;
      if (!vertex?.project || !vertex.location)
        throw new Error("Google Vertex 视频适配器需要项目和区域配置。 ");
      return createGoogleVertex({
        apiKey: request.credential,
        project: vertex.project,
        location: vertex.location,
      }).video(modelId);
    }
    case "kling":
      return createKlingAI({ apiKey: request.credential }).video(modelId);
    case "replicate":
      return createReplicate({ apiToken: request.credential }).video(modelId);
    case "xai":
      return createXai({ apiKey: request.credential }).video(modelId);
  }
}

function adapterFor(
  provider: VideoProviderId,
  assetStore: PrivateVideoAssetStore,
  settings: AiSdkVideoAdapterSettings,
): VideoGenerationAdapter {
  return {
    provider,
    async submit(request) {
      const result = await experimental_generateVideo({
        model: createVideoModel(request, settings),
        prompt: request.prompt,
        aspectRatio: request.aspectRatio as `${number}:${number}`,
        duration: request.durationSeconds,
        resolution: request.resolution as `${number}x${number}`,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(600_000),
      });
      const assetRef = await assetStore.putGeneratedVideo({
        data: result.video.uint8Array,
        contentType: result.video.mediaType ?? "video/mp4",
        provider,
        modelId: request.model.modelId,
      });
      return { resultAssetRef: privateAssetRef.parse(assetRef) };
    },
  };
}

/**
 * Full current AI SDK provider surface. Constructing these adapters performs
 * no network I/O; execution remains blocked by the policy gate in execution.ts.
 */
export function createAiSdkVideoAdapters(
  assetStore: PrivateVideoAssetStore,
  settings: AiSdkVideoAdapterSettings = {},
) {
  return (
    ["alibaba", "bytedance", "fal", "google", "google-vertex", "kling", "replicate", "xai"] as const
  ).map((provider) => adapterFor(provider, assetStore, settings));
}
