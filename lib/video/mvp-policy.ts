/** Video generation is deliberately outside MVP1; enabling it requires an explicit server deployment decision. */
export function assertVideoGenerationEnabled(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.VIDEO_GENERATION_ENABLED !== "1") {
    throw new Error("MVP1 仅提供已有素材剪辑；视频生成能力当前未启用。");
  }
}
