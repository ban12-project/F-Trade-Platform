import { type ProductStreamEvent, productStreamEventSchema } from "./stream-contract";

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
    if (text.length > 128000) throw new Error("生成事件超过大小限制。");
    const event = productStreamEventSchema.parse(JSON.parse(text));
    if (terminal || event.sequence !== sequence + 1 || (runId && event.runId !== runId))
      throw new Error("生成事件顺序无效。");
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
      if (buffer.length > 128000) throw new Error("生成事件超过大小限制。");
      if (done) break;
    }
    if (buffer.trim()) line(buffer);
    if (!terminal) throw new Error("生成连接已中断，已保存字段仍可在草稿中查看。");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
