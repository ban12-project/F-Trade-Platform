import "server-only";
import { and, eq } from "drizzle-orm";
import { cache } from "react";
import { listStoredProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import { getDatabase } from "@/lib/db/client";
import { aggregateRecord, socialPublication, workspaceProjectItem } from "@/lib/db/schema";
import { defaultProjectStage } from "./stages";
import {
  getWorkspaceProject,
  listWorkspaceProjects,
  listWorkspaceTasks,
  type WorkspaceProjectSummary,
} from "./store";

// Deduplicate only inside a single RSC request. Do not use a cross-user persistent cache here.
export const readWorkspaceProjects = cache((actorId: string) => listWorkspaceProjects(actorId));
export const readWorkspaceTasks = cache((actorId: string, projectId?: string) =>
  listWorkspaceTasks(actorId, undefined, projectId),
);
export const readWorkspaceProject = cache((projectId: string, actorId: string) =>
  getWorkspaceProject(projectId, actorId),
);
export const readWorkspaceModelSettings = cache(() => listStoredProductAgentModelSettings());

// Called only after readWorkspaceProject has authenticated project membership.
// Explicit ?panel= navigation never calls this lightweight entry-point fallback.
export async function readDefaultProjectStage(project: WorkspaceProjectSummary, actorId: string) {
  const tasks = project.kind === "marketing" ? await readWorkspaceTasks(actorId, project.id) : [];
  if (tasks.length && project.kind === "marketing") {
    const next = defaultProjectStage(project.kind, tasks, [], false);
    if (tasks.some((task) => task.nodeKind === next)) return next;
  }
  const database = getDatabase();
  const [records, publications] = await Promise.all([
    database
      .select({ type: aggregateRecord.type, state: aggregateRecord.state })
      .from(workspaceProjectItem)
      .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
      .where(
        and(
          eq(workspaceProjectItem.projectId, project.id),
          eq(workspaceProjectItem.relation, "owned"),
        ),
      ),
    project.kind === "marketing"
      ? database
          .select({ id: socialPublication.id })
          .from(socialPublication)
          .where(eq(socialPublication.projectId, project.id))
          .limit(1)
      : Promise.resolve([]),
  ]);
  return defaultProjectStage(project.kind, tasks, records, publications.length > 0);
}
