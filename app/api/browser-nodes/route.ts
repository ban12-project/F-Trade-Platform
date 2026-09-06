import { handleBrowserNodeRequest } from "@/lib/browser-fleet/store";

export async function POST(request: Request) {
  const response = (body: unknown, status = 200) =>
    Response.json(body, {
      status,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  const accessKey = request.headers
    .get("authorization")
    ?.match(/^Bearer (fbn_[A-Za-z0-9_.-]+)$/)?.[1];
  if (!accessKey || accessKey.length > 128) return response({ error: "unauthorized" }, 401);
  if (process.env.BROWSER_FLEET_ENABLED !== "1")
    return response({ error: "browser_fleet_disabled" }, 503);
  if (!request.headers.get("content-type")?.startsWith("application/json") || !request.body)
    return response({ error: "invalid_request" }, 400);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) {
        await reader.cancel();
        return response({ error: "request_too_large" }, 413);
      }
      parts.push(value);
    }
    return response(
      await handleBrowserNodeRequest(accessKey, JSON.parse(Buffer.concat(parts).toString("utf8"))),
    );
  } catch {
    return response({ error: "node_request_denied" }, 403);
  } finally {
    reader.releaseLock();
  }
}
