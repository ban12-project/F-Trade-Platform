import { timingSafeEqual } from "node:crypto";
import { cleanupExpiredVideoObjects } from "@/lib/video/retention-cleanup";

export const maxDuration = 60;

/** Platform scheduler integration; never accepts client-selected objects or paths. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  const expected = secret ? `Bearer ${secret}` : "";
  if (
    !secret ||
    Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  ) {
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  try {
    const result = await cleanupExpiredVideoObjects();
    return Response.json(result, {
      status: result.failed ? 503 : 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json(
      { error: "retention_unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
