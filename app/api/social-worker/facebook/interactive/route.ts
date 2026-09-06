import { handleFacebookInteractiveEvent } from "@/lib/social/facebook-account-store";
import { verifyInteractiveEvent } from "@/lib/social/facebook-interactive-protocol";

export async function POST(request: Request) {
  const respond = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  try {
    if (process.env.SOCIAL_FACEBOOK_WORKER_ENABLED !== "1") return respond({ active: false }, 503);
    if (!request.body) return respond({ active: false }, 400);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) {
          await reader.cancel();
          return respond({ active: false }, 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const event = verifyInteractiveEvent(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
      process.env.FACEBOOK_INTERACTIVE_SIGNING_KEY ?? "",
    );
    return respond(await handleFacebookInteractiveEvent(event));
  } catch {
    return respond({ active: false }, 403);
  }
}
