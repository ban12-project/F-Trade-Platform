import { authorizeFacebookPublication } from "@/lib/social/facebook-media-store";
export async function POST(request: Request) {
  const reply = (active: boolean, status = 200) =>
    Response.json({ active }, { status, headers: { "Cache-Control": "no-store" } });
  try {
    if (process.env.SOCIAL_FACEBOOK_WORKER_ENABLED !== "1") throw new Error("worker_disabled");
    if (!request.body) return reply(false, 400);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 128_000) {
          await reader.cancel();
          return reply(false, 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || Object.keys(body).sort().join() !== "command,payload") return reply(false, 400);
    await authorizeFacebookPublication(body.command, body.payload);
    return reply(true);
  } catch {
    return reply(false, 403);
  }
}
