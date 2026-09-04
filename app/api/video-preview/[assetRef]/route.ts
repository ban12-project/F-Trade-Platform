import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import {
  privateVideoPreviewHeaders,
  resolveWorkspacePrivateVideoPreview,
} from "@/lib/video/preview-delivery";

/**
 * A Route Handler is necessary here because a native <video> element needs an
 * authenticated GET stream; a Server Action cannot represent that HTTP contract.
 */
export async function GET(request: Request, context: { params: Promise<{ assetRef: string }> }) {
  const { assetRef } = await context.params;
  const session = await auth.api.getSession({ headers: await headers() });
  const preview = await resolveWorkspacePrivateVideoPreview(
    session,
    assetRef,
    undefined,
    undefined,
    request.headers.get("range"),
  );

  if (preview.kind === "forbidden")
    return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  if (preview.kind === "not_found")
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  return new Response(preview.asset.body, {
    status: preview.asset.contentRange ? 206 : 200,
    headers: privateVideoPreviewHeaders(preview.asset),
  });
}

export async function HEAD(request: Request, context: { params: Promise<{ assetRef: string }> }) {
  const response = await GET(request, context);
  return new Response(null, { status: response.status, headers: response.headers });
}
