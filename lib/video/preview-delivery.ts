import { generatedVideoAssetRefSchema, type PrivateGeneratedVideoRead, VercelPrivateVideoAssetStore } from "./private-asset-store";
import { eq } from "drizzle-orm";

import { hasPermission } from "@/lib/authz";
import { getDatabase } from "@/lib/db/client";
import { aggregateRecord } from "@/lib/db/schema";
import { videoProjectSchema } from "./contracts";

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

async function isMvpRenderedAsset(assetRef: string) {
  const rows = await getDatabase().select({ payload: aggregateRecord.payload }).from(aggregateRecord).where(eq(aggregateRecord.type, "video"));
  return rows.some(({ payload }) => {
    const project = videoProjectSchema.safeParse(payload);
    return project.success && project.data.editDraft && project.data.renderedAssetRef === assetRef;
  });
}

export async function resolveWorkspacePrivateVideoPreview(
  session: PreviewSession,
  assetRefInput: string,
  store: PrivateVideoPreviewStore = new VercelPrivateVideoAssetStore(),
  isAuthorizedAsset: (assetRef: string) => Promise<boolean> = isMvpRenderedAsset,
  range?: string | null,
): Promise<PrivateVideoPreviewResolution> {
  if (!hasPermission(session?.user?.role, "workspace:view")) return { kind: "forbidden" };
  const assetRef = generatedVideoAssetRefSchema.safeParse(assetRefInput);
  if (!assetRef.success || !await isAuthorizedAsset(assetRef.data)) return { kind: "not_found" };
  const asset = await store.getGeneratedVideo(assetRef.data, range);
  return asset ? { kind: "ready", asset } : { kind: "not_found" };
}

export function privateVideoPreviewHeaders(asset: Pick<PrivateGeneratedVideoRead, "contentType" | "responseSizeBytes" | "contentRange" | "etag">) {
  return {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
    "Content-Disposition": "inline",
    "Content-Length": String(asset.responseSizeBytes),
    ...(asset.contentRange ? { "Content-Range": asset.contentRange } : {}),
    "Content-Type": asset.contentType,
    "ETag": asset.etag,
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "same-origin",
    "Vary": "Cookie",
    "X-Content-Type-Options": "nosniff",
  };
}
