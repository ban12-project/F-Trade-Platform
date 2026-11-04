import "server-only";
import { cache } from "react";
import { listStoredProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import { deriveBusinessFunnel } from "./business-funnel";
import { readHumanOpportunityIds } from "./business-funnel-store";
import { deriveWorkspaceLibrary } from "./library-model";
import { getWorkspaceProject, listWorkspaceProjects, readWorkspaceTaskSnapshot } from "./store";
import { deriveWorkspaceProjectOverview, deriveWorkspaceTasks } from "./task-model";

// Request-local only. Never persist another actor's records, permissions or time-based tasks in a shared cache.
export const readWorkspaceProjects = cache((actorId: string) => listWorkspaceProjects(actorId));
const readWorkspaceWork = cache(async (actorId: string) => {
  const snapshot = await readWorkspaceTaskSnapshot(actorId);
  const tasks = deriveWorkspaceTasks(snapshot, new Date());
  return { snapshot, tasks, overview: deriveWorkspaceProjectOverview(snapshot, tasks) };
});
export const readWorkspaceTasks = cache(async (actorId: string, projectId?: string) => {
  const { tasks } = await readWorkspaceWork(actorId);
  return projectId ? tasks.filter((task) => task.projectId === projectId) : tasks;
});
export const readWorkspaceProjectOverview = cache(
  async (actorId: string) => (await readWorkspaceWork(actorId)).overview,
);
export const readWorkspaceProject = cache((projectId: string, actorId: string) =>
  getWorkspaceProject(projectId, actorId),
);
export const readWorkspaceModelSettings = cache(() => listStoredProductAgentModelSettings());

export const readWorkspaceLibrary = cache(async (actorId: string) =>
  deriveWorkspaceLibrary((await readWorkspaceWork(actorId)).snapshot),
);

export const readWorkspaceBusinessFunnel = cache(async (actorId: string) => {
  const { snapshot } = await readWorkspaceWork(actorId);
  const ids = snapshot.records
    .filter(
      (record) =>
        record.type === "lead" && record.state === "OPPORTUNITY" && record.relation === "owned",
    )
    .map((record) => record.id);
  // Failure to load confirmation evidence is unknown, never a zero or inferred success.
  let humanOpportunityIds: string[] | null = null;
  try {
    humanOpportunityIds = await readHumanOpportunityIds(actorId, ids);
  } catch {
    /* Render explicit unavailable state. */
  }
  return deriveBusinessFunnel(snapshot, humanOpportunityIds);
});
