import type { WorkspaceTaskSummary } from "./types";

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
export const createKinds = ["product", "content", "rfq", "quotation", "video"] as const;
export type WorkspaceCreateKind = (typeof createKinds)[number];

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

// Return addresses are list locations only, never external URLs or arbitrary application routes.
export function workspaceReturnTo(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    !value.startsWith("/workspace") ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    return undefined;
  let url: URL;
  try {
    url = new URL(value, "https://workspace.invalid");
  } catch {
    return undefined;
  }
  if (
    url.origin !== "https://workspace.invalid" ||
    url.hash ||
    !["/workspace", "/workspace/products", "/workspace/content", "/workspace/customers"].includes(
      url.pathname,
    )
  )
    return undefined;
  if (value.split(/[?#]/)[0] !== url.pathname || value.includes("#") || value.length > 2048)
    return undefined;
  for (const entry of url.searchParams.values())
    if ([...entry].some((character) => character.charCodeAt(0) < 32 || character === "\\"))
      return undefined;
  const allowed = url.pathname === "/workspace" ? ["view"] : ["project", "type", "state"];
  if (
    [...url.searchParams.keys()].some(
      (key) => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1,
    )
  )
    return undefined;
  return url.pathname + url.search;
}
export function withWorkspaceReturnTo(href: string, returnTo?: string) {
  const target = workspaceReturnTo(returnTo);
  return target
    ? `${href + (href.includes("?") ? "&" : "?")}returnTo=${encodeURIComponent(target)}`
    : href;
}
export function workspaceRecordHref(
  projectId: string,
  kind: WorkspaceRecordKind,
  id: string,
  returnTo?: string,
) {
  return withWorkspaceReturnTo(
    kind === "video"
      ? `/workspace/${projectId}/video?item=${id}`
      : `/workspace/${projectId}/records/${kind}/${id}`,
    returnTo,
  );
}
export function workspaceCreateHref(
  projectId: string,
  kind: WorkspaceRecordKind,
  source?: { kind: "product" | "rfq" | "lead"; id: string },
  returnTo?: string,
) {
  const path =
    kind === "video"
      ? `/workspace/${projectId}/video?new=1`
      : `/workspace/${projectId}/new/${kind}`;
  return withWorkspaceReturnTo(
    source ? `${path}${kind === "video" ? "&" : "?"}${source.kind}=${source.id}` : path,
    returnTo,
  );
}
export function workspaceTaskHref(task: WorkspaceTaskSummary, returnTo?: string) {
  const target = task.destination;
  return target.type === "create"
    ? workspaceCreateHref(task.projectId, target.kind, target.source, returnTo)
    : workspaceRecordHref(task.projectId, target.kind, target.id, returnTo);
}
