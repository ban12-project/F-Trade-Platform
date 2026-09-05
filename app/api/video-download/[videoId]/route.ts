import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import {
  approvedVideoDownloadHeaders,
  resolveWorkspaceApprovedVideoDownload,
} from "@/lib/video/download-delivery";

/** Native downloads require an authenticated streaming HTTP contract. */
export async function GET(request: Request, context: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await context.params;
  const session = await auth.api.getSession({ headers: await headers() });
  const result = await resolveWorkspaceApprovedVideoDownload(
    session,
    videoId,
    request.headers.get("range"),
  );
  if (result.kind === "forbidden")
    return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  if (result.kind === "not_found")
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (result.kind === "unavailable")
    return new Response("Approved video is no longer current", {
      status: 409,
      headers: { "Cache-Control": "no-store" },
    });
  return new Response(result.asset.body, {
    status: result.asset.contentRange ? 206 : 200,
    headers: approvedVideoDownloadHeaders(result.asset, result.filename),
  });
}

export async function HEAD(request: Request, context: { params: Promise<{ videoId: string }> }) {
  const response = await GET(request, context);
  return new Response(null, { status: response.status, headers: response.headers });
}
