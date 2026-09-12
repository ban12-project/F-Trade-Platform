import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { type Database, getDatabase } from "@/lib/db/client";
import { aggregateRecord, workspaceProjectItem, workspaceProjectMember } from "@/lib/db/schema";
import { videoProjectSchema } from "./contracts";

function ownedVideos(actorId: string, database: Database) {
  return database
    .select({
      id: aggregateRecord.id,
      state: aggregateRecord.state,
      payload: aggregateRecord.payload,
    })
    .from(aggregateRecord)
    .innerJoin(
      workspaceProjectItem,
      and(
        eq(workspaceProjectItem.aggregateId, aggregateRecord.id),
        eq(workspaceProjectItem.role, "marketing_video"),
        eq(workspaceProjectItem.relation, "owned"),
      ),
    )
    .innerJoin(
      workspaceProjectMember,
      and(
        eq(workspaceProjectMember.projectId, workspaceProjectItem.projectId),
        eq(workspaceProjectMember.userId, actorId),
        inArray(workspaceProjectMember.role, ["owner", "editor", "viewer"]),
      ),
    );
}

export async function loadWorkspaceVideoForActor(
  videoId: string,
  actorId: string,
  database: Database = getDatabase(),
) {
  const [row] = await ownedVideos(actorId, database)
    .where(and(eq(aggregateRecord.type, "video"), eq(aggregateRecord.id, videoId)))
    .limit(1);
  return row;
}

export async function isWorkspaceRenderedAssetForActor(
  assetRef: string,
  actorId: string,
  database: Database = getDatabase(),
) {
  const rows = await ownedVideos(actorId, database).where(
    and(
      eq(aggregateRecord.type, "video"),
      eq(sql<string>`${aggregateRecord.payload}->>'renderedAssetRef'`, assetRef),
    ),
  );
  return rows.some((row) => {
    const project = videoProjectSchema.safeParse(row.payload);
    return (
      project.success &&
      project.data.id === row.id &&
      !!project.data.editDraft &&
      project.data.renderedAssetRef === assetRef
    );
  });
}
