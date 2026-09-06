import { readFacebookPublicationMedia } from "@/lib/social/facebook-media-store";
export async function POST(request: Request) {
  try {
    if (process.env.SOCIAL_FACEBOOK_WORKER_ENABLED !== "1") throw new Error("worker_disabled");
    // Bound the entire signed metadata request; never accepts an upload URL/path.
    if (!request.body) throw new Error("missing_body");
    const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 128_000) { await reader.cancel(); throw new Error("body_limit"); } chunks.push(value); }
    } finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (Object.keys(body).sort().join() !== "command,payload") throw new Error("invalid_body");
    const asset = await readFacebookPublicationMedia(body.command, body.payload);
    return new Response(asset.stream, { headers: { "Content-Type": asset.media.contentType, "Content-Length": String(asset.media.sizeBytes),
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "attachment" } });
  } catch { return Response.json({ error: "media_access_denied" }, { status: 403, headers: { "Cache-Control": "no-store" } }); }
}
