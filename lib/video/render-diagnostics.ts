/** Only bounded categories leave the worker boundary; never emit raw errors or URLs. */
export type RenderStage =
  | "create"
  | "bundle_upload"
  | "source_download"
  | "props_write"
  | "render_command"
  | "probe"
  | "output_read"
  | "cleanup";

export function renderFailureCategory(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  if (/terminated|socket|ECONNRESET|UND_ERR/i.test(text)) return "transport_interrupted";
  if (/ENOSPC|no space left on device/i.test(text)) return "storage_exhausted";
  if (/out of memory|\boom\b|SIGKILL/i.test(text)) return "memory_exhausted";
  if (/timed?\s*out|timeout|deadline/i.test(text)) return "timeout";
  if (/expired|stopped|not running/i.test(text)) return "session_unavailable";
  if (/401|403|unauthorized|forbidden/i.test(text)) return "access_denied";
  if (/decode|invalid data|unsupported codec/i.test(text)) return "media_decode";
  return "unknown";
}

export async function renderStage<T>(stage: RenderStage, operation: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const result = await operation();
    console.info("video_render.stage", {
      stage,
      status: "succeeded",
      elapsedMs: Date.now() - started,
    });
    return result;
  } catch (error) {
    console.error("video_render.stage", {
      stage,
      status: "failed",
      elapsedMs: Date.now() - started,
      category: renderFailureCategory(error),
    });
    throw error;
  }
}
