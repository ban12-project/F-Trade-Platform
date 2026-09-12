import "server-only";

import { type Database, getDatabase } from "@/lib/db/client";

import type { VideoProject } from "./contracts";
import {
  approvedVideoDownloadHeaders,
  type DownloadSession,
  resolveApprovedVideoAccess,
  resolveApprovedVideoDownload,
} from "./download-policy";
import { VercelPrivateVideoAssetStore } from "./private-asset-store";
import { assertCurrentProductFactsForVideo } from "./product-fact-runtime-store";
import { assertCurrentProductMediaUsageForVideo } from "./product-media-runtime-store";

import { loadWorkspaceVideoForActor } from "./workspace-access";

async function revalidateVideo(project: VideoProject, database: Database = getDatabase()) {
  await Promise.all([
    assertCurrentProductFactsForVideo(project, database),
    assertCurrentProductMediaUsageForVideo(project, "organic", new Date(), database),
  ]);
}

export async function resolveWorkspaceApprovedVideoDownload(
  session: DownloadSession,
  videoIdInput: string,
  range?: string | null,
) {
  const database = getDatabase();
  return resolveApprovedVideoDownload(
    session,
    videoIdInput,
    range,
    new VercelPrivateVideoAssetStore(database),
    (videoId, actorId) => loadWorkspaceVideoForActor(videoId, actorId, database),
    (project) => revalidateVideo(project, database),
  );
}

export { approvedVideoDownloadHeaders };

export async function resolveWorkspaceApprovedVideoManifest(
  session: DownloadSession,
  videoIdInput: string,
) {
  const database = getDatabase();
  return resolveApprovedVideoAccess(
    session,
    videoIdInput,
    (videoId, actorId) => loadWorkspaceVideoForActor(videoId, actorId, database),
    (project) => revalidateVideo(project, database),
  );
}
