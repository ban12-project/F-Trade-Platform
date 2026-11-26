import { handleBrowserNodeRequest } from "@/lib/browser-fleet/store";
import { parseFacebookMedia } from "@/lib/social/facebook-media-contract";

const knownOperations = new Set([
  "sync",
  "recover",
  "claim",
  "heartbeat",
  "finish",
  "admit",
  "publication-media",
  "authorize-publication",
  "publication-result",
  "publication-setup",
  "inbox-messages",
  "inbox-agent-decide",
  "inbox-setup",
  "claim-login",
  "login-result",
  "login-challenge",
]);

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
  let operation = "unknown";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 262_144) {
        await reader.cancel();
        return response({ error: "request_too_large" }, 413);
      }
      parts.push(value);
    }
    const body = JSON.parse(Buffer.concat(parts).toString("utf8")) as {
      operation?: unknown;
    } | null;
    if (typeof body?.operation === "string" && knownOperations.has(body.operation))
      operation = body.operation;
    const result = await handleBrowserNodeRequest(accessKey, body);
    if (result.stream instanceof ReadableStream) {
      const media = parseFacebookMedia(result.media);
      return new Response(result.stream, {
        headers: {
          "Content-Type": media.contentType,
          "Content-Length": String(media.sizeBytes),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": "attachment",
        },
      });
    }
    return response(result);
  } catch (error) {
    const code =
      error instanceof Error && /^[a-z0-9_]{2,64}$/.test(error.message)
        ? error.message
        : "unclassified";
    const errorName =
      error instanceof Error && /^[A-Za-z0-9_]{1,48}$/.test(error.name)
        ? error.name
        : "UnknownError";
    console.warn(
      JSON.stringify({ event: "browser_node.request_denied", code, operation, errorName }),
    );
    return response({ error: "node_request_denied" }, 403);
  } finally {
    reader.releaseLock();
  }
}
