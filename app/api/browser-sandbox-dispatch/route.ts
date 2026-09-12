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
  if (process.env.BROWSER_SANDBOX_ENABLED !== "1")
    return Response.json({ delivered: 0, disabled: true });
  try {
    const { deliverQueuedBrowserSandboxes } = await import(
      "@/lib/browser-fleet/sandbox-workflow-delivery"
    );
    return Response.json(await deliverQueuedBrowserSandboxes());
  } catch {
    return Response.json({ error: "dispatch_unavailable" }, { status: 503 });
  }
}
