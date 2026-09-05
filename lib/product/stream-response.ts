import type { ProductStreamEvent } from "./stream-contract";

/** Bound multipart input before parsing, even when Content-Length is absent or dishonest. */
export async function readProductStreamForm(request: Request, maximumBytes = 26 * 1024 * 1024) {
  if (!request.body) throw new Error("缺少导入资料。");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) throw new Error("导入资料超过大小限制。");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return new Response(body, {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  }).formData();
}

/** Cancellation aborts provider IO before waiting for the generator's durable cleanup. */
export function productStreamResponse(
  events: AsyncGenerator<ProductStreamEvent>,
  controller: AbortController,
  onCancel: () => Promise<void> = async () => {},
) {
  const encoder = new TextEncoder();
  let closed = false;
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(output) {
        try {
          const result = await events.next();
          if (closed) return;
          if (result.done) {
            closed = true;
            output.close();
          } else output.enqueue(encoder.encode(`${JSON.stringify(result.value)}\n`));
        } catch {
          if (!closed) {
            closed = true;
            output.error(new Error("生成连接已中断，已保存字段仍可在草稿中查看。"));
          }
        }
      },
      async cancel() {
        closed = true;
        controller.abort();
        try {
          await events.return(undefined);
        } finally {
          await onCancel();
        }
      },
    }),
    {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
