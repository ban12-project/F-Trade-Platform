/** Public messages must never derive from provider errors or signed media URLs. */
export function videoProcessingFailureMessage(code: string | null) {
  if (code === "AI_DRAFT_FAILED") return "AI 初稿生成失败，请检查素材与配置后重试。";
  if (code === "RENDER_FAILED") return "视频渲染失败，请检查素材授权和导出设置后重试。";
  return "视频处理失败，请检查输入后重试。";
}
