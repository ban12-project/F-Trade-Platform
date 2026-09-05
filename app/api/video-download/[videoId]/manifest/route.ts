import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { resolveWorkspaceApprovedVideoManifest } from "@/lib/video/download-delivery";
import { createVideoExportManifest, videoExportManifestHeaders } from "@/lib/video/export-manifest";

/** Authenticated native file download; reuses the MP4 authorization boundary. */
export async function GET(_request: Request, context: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await context.params;
  const session = await auth.api.getSession({ headers: await headers() });
  const result = await resolveWorkspaceApprovedVideoManifest(session, videoId);
  if (result.kind !== "ready") {
    const status = result.kind === "forbidden" ? 403 : result.kind === "not_found" ? 404 : 409;
    return new Response("Export manifest unavailable", {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return Response.json(createVideoExportManifest(result.artifact), {
    headers: videoExportManifestHeaders(result.filename.replace(/\.mp4$/, ".manifest.json")),
  });
}
