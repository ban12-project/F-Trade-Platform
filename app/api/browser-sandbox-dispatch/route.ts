import { timingSafeEqual } from "node:crypto";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  const expected = secret ? `Bearer ${secret}` : "";
  if (
    !secret ||
    Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    return Response.json({ error: "unauthorized" }, { status: 401 });
  // A stale cron or enabled environment flag cannot dispatch retired compute.
  return Response.json({ delivered: 0, disabled: true });
}
