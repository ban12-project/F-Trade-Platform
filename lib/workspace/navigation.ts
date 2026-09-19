import { taskProjectStage } from "./stages";
import type { WorkspaceTaskSummary } from "./store";

export const recordKinds = [
  "product",
  "content",
  "publication",
  "rfq",
  "quotation",
  "lead",
  "delivery",
  "video",
] as const;
export type WorkspaceRecordKind = (typeof recordKinds)[number];
export type WorkspaceCollection = "products" | "content" | "customers";
export function isWorkspaceRecordKind(value: string): value is WorkspaceRecordKind {
  return (recordKinds as readonly string[]).includes(value);
}
export function workspaceCollection(kind: string): WorkspaceCollection {
  return kind === "product"
    ? "products"
    : ["content", "publication", "video"].includes(kind)
      ? "content"
      : "customers";
}
export function workspaceRecordHref(projectId: string, kind: WorkspaceRecordKind, id: string) {
  return kind === "video"
    ? `/workspace/${projectId}/video?item=${id}`
    : `/workspace/${projectId}/records/${kind}/${id}`;
}
export function workspaceCreateHref(
  projectId: string,
  kind: WorkspaceRecordKind,
  source?: { kind: "product" | "rfq" | "lead"; id: string },
) {
  const path =
    kind === "video" ? `/workspace/${projectId}/video` : `/workspace/${projectId}/new/${kind}`;
  return source ? `${path}?${source.kind}=${source.id}` : path;
}
export function workspaceTaskHref(
  task: WorkspaceTaskSummary,
  basePath = `/workspace/${task.projectId}`,
) {
  if (basePath === `/workspace/${task.projectId}`) {
    if (task.source) return workspaceCreateHref(task.projectId, task.nodeKind, task.source);
    if (task.nodeKind === "lead" && task.taskType === "rfq")
      return workspaceCreateHref(task.projectId, "rfq", { kind: "lead", id: task.id });
    return workspaceRecordHref(task.projectId, task.nodeKind, task.id);
  }
  // Test/demo surfaces can still provide their own routes; existing external query links remain supported.
  if (task.source)
    return `${basePath}?panel=${taskProjectStage(task)}&${task.source.kind}=${task.source.id}`;
  const itemKey = task.nodeKind === "lead" && task.taskType === "rfq" ? "lead" : "item";
  return `${basePath}?panel=${taskProjectStage(task)}&${itemKey}=${task.id}`;
}
