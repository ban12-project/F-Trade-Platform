import { z } from "zod";

import { hasPermission } from "@/lib/authz";

import {
  isPrivateTestOnlyVideo,
  type VideoExportArtifact,
  type VideoProject,
  videoProjectSchema,
} from "./contracts";
import type { PrivateGeneratedVideoRead } from "./private-asset-store";

export type DownloadSession = { user?: { role?: string | null } | null } | null;
export type DownloadRecord = { state: string; payload: unknown };
export type DownloadStore = {
  getGeneratedVideo(
    assetRef: string,
    range?: string | null,
  ): Promise<PrivateGeneratedVideoRead | null>;
};
export type LoadVideo = (videoId: string) => Promise<DownloadRecord | undefined>;
export type RevalidateVideo = (project: VideoProject) => Promise<void>;

export type ApprovedVideoDownloadResolution =
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "unavailable" }
  | { kind: "ready"; asset: PrivateGeneratedVideoRead; filename: string };

type ApprovedVideoAccess =
  | { kind: "forbidden" | "not_found" | "unavailable" }
  | { kind: "ready"; artifact: VideoExportArtifact; assetRef: string; filename: string };

export async function resolveApprovedVideoAccess(
  session: DownloadSession,
  videoIdInput: string,
  findVideo: LoadVideo,
  assertCurrent: RevalidateVideo,
): Promise<ApprovedVideoAccess> {
  if (!hasPermission(session?.user?.role, "workspace:view")) return { kind: "forbidden" };
  const videoId = z.uuid().safeParse(videoIdInput);
  if (!videoId.success) return { kind: "not_found" };
  const record = await findVideo(videoId.data);
  if (!record || record.state !== "VIDEO_APPROVED") return { kind: "not_found" };
  const parsed = videoProjectSchema.safeParse(record.payload);
  if (!parsed.success) return { kind: "unavailable" };
  const project = parsed.data;
  if (isPrivateTestOnlyVideo(project)) return { kind: "unavailable" };
  if (
    !project.renderedAssetRef ||
    project.exportArtifact?.status !== "approved" ||
    project.exportArtifact.sourceAssetRef !== project.renderedAssetRef
  ) {
    return { kind: "unavailable" };
  }
  try {
    await assertCurrent(project);
  } catch {
    return { kind: "unavailable" };
  }
  return {
    kind: "ready",
    artifact: project.exportArtifact,
    assetRef: project.renderedAssetRef,
    filename: `f-trade-${project.exportArtifact.platform}-${videoId.data.slice(0, 8)}.mp4`,
  };
}

export async function resolveApprovedVideoDownload(
  session: DownloadSession,
  videoIdInput: string,
  range: string | null | undefined,
  store: DownloadStore,
  findVideo: LoadVideo,
  assertCurrent: RevalidateVideo,
): Promise<ApprovedVideoDownloadResolution> {
  const access = await resolveApprovedVideoAccess(session, videoIdInput, findVideo, assertCurrent);
  if (access.kind !== "ready") return { kind: access.kind };
  const asset = await store.getGeneratedVideo(access.assetRef, range);
  if (!asset) return { kind: "not_found" };
  return { kind: "ready", asset, filename: access.filename };
}

export function approvedVideoDownloadHeaders(asset: PrivateGeneratedVideoRead, filename: string) {
  return {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": String(asset.responseSizeBytes),
    ...(asset.contentRange ? { "Content-Range": asset.contentRange } : {}),
    "Content-Type": asset.contentType,
    ETag: asset.etag,
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "same-origin",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  };
}
