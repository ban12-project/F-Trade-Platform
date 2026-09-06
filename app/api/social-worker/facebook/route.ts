import { timingSafeEqual } from "node:crypto";

import { configuredFacebookWorkerScope, verifyFacebookWorkerRequest } from "@/lib/social/facebook-worker-protocol";
import { handleFacebookWorkerRequest } from "@/lib/social/facebook-worker-store";

const MAX_BODY_BYTES = 256 * 1024;
const response = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

function authorized(request: Request) {
  const expected = process.env.SOCIAL_WORKER_API_KEY;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || expected.length < 32 || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function boundedJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("invalid_content_type");
  if (!request.body) throw new Error("missing_body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("body_too_large");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally { reader.releaseLock(); }
}

/** External transport boundary; never accepts browser cookies or proxy settings. */
export async function POST(request: Request) {
  if (!authorized(request)) return response({ error: "unauthorized" }, 401);
  let input;
  try {
    input = verifyFacebookWorkerRequest(await boundedJson(request), configuredFacebookWorkerScope());
  } catch {
    return response({ error: "invalid_worker_request" }, 400);
  }
  if (process.env.SOCIAL_FACEBOOK_WORKER_ENABLED !== "1" && input.operation !== "pause") {
    return response({ active: false, accepted: 0, duplicates: 0, job: null });
  }
  try {
    return response(await handleFacebookWorkerRequest(input));
  } catch {
    // Never return an ORM, signature, browser or message error to the caller.
    return response({ error: "worker_request_failed" }, 503);
  }
}
