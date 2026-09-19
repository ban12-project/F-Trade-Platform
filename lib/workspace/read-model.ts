import "server-only";
import { cache } from "react";
import { listStoredProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import { deriveWorkspaceLibrary } from "./library-model";
import { defaultProjectStage } from "./stages";
import {
  getWorkspaceProject,
  listWorkspaceProjects,
  readWorkspaceTaskSnapshot,
  type WorkspaceProjectSummary,
} from "./store";
import { deriveWorkspacePipeline, deriveWorkspaceTasks, leadTaskType } from "./task-model";

// Request-local only. Never persist another actor's records, permissions or time-based tasks in a shared cache.
export const readWorkspaceProjects = cache((actorId: string) => listWorkspaceProjects(actorId));
const readWorkspaceWork = cache(async (actorId: string) => {
  const snapshot = await readWorkspaceTaskSnapshot(actorId);
  const tasks = deriveWorkspaceTasks(snapshot, new Date());
  return { snapshot, tasks, pipeline: deriveWorkspacePipeline(snapshot, tasks) };
});
export const readWorkspaceTasks = cache(async (actorId: string, projectId?: string) => {
  const { tasks } = await readWorkspaceWork(actorId);
  return projectId ? tasks.filter((task) => task.projectId === projectId) : tasks;
});
export const readWorkspacePipeline = cache(
  async (actorId: string) => (await readWorkspaceWork(actorId)).pipeline,
);
export const readWorkspaceProject = cache((projectId: string, actorId: string) =>
  getWorkspaceProject(projectId, actorId),
);
export const readWorkspaceModelSettings = cache(() => listStoredProductAgentModelSettings());

export async function readDefaultProjectStage(project: WorkspaceProjectSummary, actorId: string) {
  const summary = (await readWorkspacePipeline(actorId)).find((item) => item.id === project.id);
  return summary?.currentStageId ?? defaultProjectStage(project.kind, [], [], false);
}

// Legacy links keep their meaning after their original task is completed or deduplicated.
export const readLegacyLeadTaskType = cache(
  async (actorId: string, projectId: string, leadId: string) => {
    const { snapshot } = await readWorkspaceWork(actorId);
    const record = snapshot.records.find(
      (row) =>
        row.projectId === projectId &&
        row.id === leadId &&
        row.type === "lead" &&
        row.relation === "owned",
    );
    return record ? leadTaskType(record) : undefined;
  },
);

export const readWorkspaceLibrary = cache(async (actorId: string) =>
  deriveWorkspaceLibrary((await readWorkspaceWork(actorId)).snapshot),
);
