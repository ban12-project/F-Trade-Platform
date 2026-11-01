/** Public messages must never derive from provider errors or signed media URLs. */
export function videoProcessingFailureMessage(code: string | null) {
  if (code === "RETENTION_EXPIRED") return "视频或工作素材已超过保留期，处理任务已停止。";
  if (code === "AI_DRAFT_SOURCE_INVALID")
    return "无法确认产品事实或素材授权，AI 初稿未保存。请核对来源后重试。";
  if (code === "AI_DRAFT_STALE")
    return "剪辑稿已更新，旧 AI 初稿未保存。请确认最新草稿后重新生成。";
  if (code === "AI_DRAFT_FAILED") return "AI 初稿生成失败，请检查素材与配置后重试。";
  if (code === "RENDER_STORAGE_EXHAUSTED")
    return "视频合成服务的临时存储空间不足，请联系管理员处理后重试。";
  if (code === "RENDER_FAILED") return "视频合成未完成，请重试；若持续失败，请联系管理员。";
  return "视频处理失败，请检查输入后重试。";
}

/** Inspect worker stderr without returning or logging private renderer output. */
export function renderCommandFailureCode(stderr: string) {
  return /\bENOSPC\b|no space left on device/i.test(stderr)
    ? "RENDER_STORAGE_EXHAUSTED"
    : "RENDER_FAILED";
}

export class VideoRenderCommandError extends Error {
  constructor(readonly failureCode: ReturnType<typeof renderCommandFailureCode>) {
    super(failureCode);
  }
}
