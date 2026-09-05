import "server-only";

import { and, eq } from "drizzle-orm";

import { type Database, getDatabase } from "@/lib/db/client";
import { aggregateRecord } from "@/lib/db/schema";

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

async function loadVideo(videoId: string, database: Database = getDatabase()) {
  const [record] = await database
    .select({ state: aggregateRecord.state, payload: aggregateRecord.payload })
    .from(aggregateRecord)
    .where(and(eq(aggregateRecord.id, videoId), eq(aggregateRecord.type, "video")))
    .limit(1);
  return record;
}

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
    (videoId) => loadVideo(videoId, database),
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
    (videoId) => loadVideo(videoId, database),
    (project) => revalidateVideo(project, database),
  );
}
