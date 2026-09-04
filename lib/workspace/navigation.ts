import type { WorkspaceTaskSummary } from "./store";

export function workspaceTaskHref(task: WorkspaceTaskSummary, basePath = `/workspace/${task.projectId}`) {
  const canonicalProjectPath = `/workspace/${task.projectId}`;
  if (task.nodeKind === "video" && basePath === canonicalProjectPath) {
    return `${canonicalProjectPath}/video?item=${task.id}`;
  }
  return `${basePath}?panel=${task.nodeKind}&item=${task.id}`;
}
