import { and, eq, inArray } from "drizzle-orm";
import type { DatabaseExecutor } from "@/lib/db/client";
import { aggregateRecord, evidence } from "@/lib/db/schema";
import {
  assertVideoObjectRetained,
  isVideoWorkingEvidence,
  VideoRetentionError,
} from "./retention-policy";

/** Caller already owns the video lock; keep it through the final write. */
export async function assertVideoRetentionForId(
  database: Pick<DatabaseExecutor, "select">,
  videoId: string,
) {
  const [row] = await database
    .select({ createdAt: aggregateRecord.createdAt, payload: aggregateRecord.payload })
    .from(aggregateRecord)
    .where(and(eq(aggregateRecord.id, videoId), eq(aggregateRecord.type, "video")));
  if (!row) throw new VideoRetentionError();
  assertVideoObjectRetained(row.createdAt);
  const refs = Array.isArray(row.payload.sourceAssets)
    ? row.payload.sourceAssets.flatMap((asset) => {
        if (
          !asset ||
          typeof asset !== "object" ||
          !("assetRef" in asset) ||
          typeof asset.assetRef !== "string"
        )
          return [];
        return [
          asset.assetRef,
          ...("rightsEvidenceRef" in asset && typeof asset.rightsEvidenceRef === "string"
            ? [asset.rightsEvidenceRef]
            : []),
        ];
      })
    : [];
  if (refs.length) await assertVideoWorkingEvidenceRetained(database, refs);
  assertVideoObjectRetained(row.createdAt);
}

export async function assertVideoWorkingEvidenceRetained(
  database: Pick<DatabaseExecutor, "select">,
  refs: string[],
) {
  if (!refs.length) return;
  const rows = await database
    .select({
      createdAt: evidence.createdAt,
      sourceLabel: evidence.sourceLabel,
      blobKey: evidence.blobKey,
    })
    .from(evidence)
    .where(inArray(evidence.id, refs));
  for (const row of rows) {
    if (row.blobKey.startsWith("retired/")) throw new VideoRetentionError();
    if (isVideoWorkingEvidence(row.sourceLabel)) assertVideoObjectRetained(row.createdAt);
  }
}
