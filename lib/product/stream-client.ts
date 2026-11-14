import { type ProductStreamEvent, productStreamEventSchema } from "./stream-contract";

// Only these deliberate user-facing messages cross the client transport boundary.
export class ProductStreamError extends Error {}

export async function consumeProductStream(
  body: ReadableStream<Uint8Array>,
  receive: (event: ProductStreamEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sequence = 0;
  let runId: string | undefined;
  let terminal = false;
  const line = (text: string) => {
    if (!text.trim()) return;
    if (text.length > 128000) throw new ProductStreamError("生成事件超过大小限制。");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ProductStreamError(
        "生成数据格式异常；若已有草稿，请先核对已保存字段，再决定是否重新生成。",
      );
    }
    const result = productStreamEventSchema.safeParse(parsed);
    if (!result.success)
      throw new ProductStreamError(
        "生成数据格式异常；若已有草稿，请先核对已保存字段，再决定是否重新生成。",
      );
    const event = result.data;
    if (terminal || event.sequence !== sequence + 1 || (runId && event.runId !== runId))
      throw new ProductStreamError("生成事件顺序无效。");
    runId = event.runId;
    sequence = event.sequence;
    terminal =
      event.type === "stage" && ["completed", "failed", "interrupted"].includes(event.stage);
    receive(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        line(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (buffer.length > 128000) throw new ProductStreamError("生成事件超过大小限制。");
      if (done) break;
    }
    if (buffer.trim()) line(buffer);
    if (!terminal) throw new ProductStreamError("生成连接已中断，已保存字段仍可在草稿中查看。");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
