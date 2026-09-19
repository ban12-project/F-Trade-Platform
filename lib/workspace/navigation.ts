import { taskProjectStage } from "./stages";
import type { WorkspaceTaskSummary } from "./store";

export function workspaceTaskHref(
  task: WorkspaceTaskSummary,
  basePath = `/workspace/${task.projectId}`,
) {
  const canonicalProjectPath = `/workspace/${task.projectId}`;
  if (task.nodeKind === "video" && basePath === canonicalProjectPath) {
    return `${canonicalProjectPath}/video?item=${task.id}`;
  }
  if (task.source)
    return `${basePath}?panel=${taskProjectStage(task)}&${task.source.kind}=${task.source.id}`;
  const itemKey = task.nodeKind === "lead" && task.taskType === "rfq" ? "lead" : "item";
  return `${basePath}?panel=${taskProjectStage(task)}&${itemKey}=${task.id}`;
}
