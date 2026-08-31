import { generatedVideoAssetRefSchema, type PrivateGeneratedVideoRead, VercelPrivateVideoAssetStore } from "./private-asset-store";

type PreviewSession = { user?: { role?: string | null } | null } | null;

export type PrivateVideoPreviewStore = Pick<VercelPrivateVideoAssetStore, "getGeneratedVideo">;

export type PrivateVideoPreviewResolution =
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "ready"; asset: PrivateGeneratedVideoRead };

/**
 * Resolves only an opaque generated-asset reference after the route handler has
 * authenticated the caller. Blob pathnames, provider URLs and credentials never
 * cross this boundary.
 */
export async function resolveAdminPrivateVideoPreview(
  session: PreviewSession,
  assetRefInput: string,
  store: PrivateVideoPreviewStore = new VercelPrivateVideoAssetStore(),
): Promise<PrivateVideoPreviewResolution> {
  if (session?.user?.role !== "admin") return { kind: "forbidden" };
  const assetRef = generatedVideoAssetRefSchema.safeParse(assetRefInput);
  if (!assetRef.success) return { kind: "not_found" };
  const asset = await store.getGeneratedVideo(assetRef.data);
  return asset ? { kind: "ready", asset } : { kind: "not_found" };
}

export function privateVideoPreviewHeaders(asset: Pick<PrivateGeneratedVideoRead, "contentType" | "sizeBytes">) {
  return {
    "Cache-Control": "private, no-cache",
    "Content-Disposition": "inline",
    "Content-Length": String(asset.sizeBytes),
    "Content-Type": asset.contentType,
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "same-origin",
    "Vary": "Cookie",
    "X-Content-Type-Options": "nosniff",
  };
}
