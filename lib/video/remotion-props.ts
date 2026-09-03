import type { AbcdMarketingVideoProps } from "@/remotion/abcd-types";

import type { VideoRenderRequest } from "./rendering";
import type { SandboxVideoSource } from "./sandbox-sources";

type SignedSources = ReadonlyMap<string, SandboxVideoSource>;

/**
 * Compiles a validated edit timeline into renderer-only Remotion props.
 * Signed URLs originate from the server-side evidence map and are never accepted
 * from the browser or persisted in the video project.
 */
export function createRemotionCompositionProps(
  request: VideoRenderRequest,
  sources: SignedSources,
  productName: string,
): AbcdMarketingVideoProps {
  if (request.width !== 1080 || request.height !== 1920 || request.fps !== 30) {
    throw new Error("ABCD 工业品模板当前只支持 1080×1920、30fps 的竖屏导出。");
  }
  const safeProductName = productName.trim();
  if (!safeProductName || safeProductName.length > 80) throw new Error("ABCD 模板需要有效的已核验产品名称。");
  if (!request.timeline.cta?.text) throw new Error("ABCD Direction 节拍必须包含 CTA。");

  return {
    productName: safeProductName,
    ctaText: request.timeline.cta.text,
    fps: request.fps,
    clips: request.timeline.scenes.map((scene) => {
      const source = sources.get(scene.assetRef);
      if (!source) throw new Error(`ABCD 模板无法读取片段 ${scene.sceneId} 的私有素材。`);
      if (!scene.mediaType || !scene.fitMode || !scene.audioMode || !scene.abcdRoles?.length || !scene.motionPreset) {
        throw new Error(`片段 ${scene.sceneId} 缺少 ABCD 合成参数。`);
      }
      return {
        id: scene.sceneId,
        src: source.signedGetUrl,
        mediaType: scene.mediaType,
        trimStartFrame: Math.round((scene.trimStartSeconds ?? 0) * request.fps),
        durationInFrames: Math.round(scene.durationSeconds * request.fps),
        fitMode: scene.fitMode,
        audioMode: scene.audioMode,
        caption: scene.subtitles[0]?.text,
        abcdRoles: scene.abcdRoles,
        motionPreset: scene.motionPreset,
      };
    }),
  };
}

